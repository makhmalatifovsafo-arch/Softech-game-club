import { getFinancialBreakdown } from './financialBreakdown.js';
import { createSessionAttribution } from './sessionTransferHistory.js';
import { getRetainedPayments } from './netSessionReceipts.js';

const pad = value => String(value).padStart(2, '0');
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function salesFor(db, from, to, clubId) {
  const report = getFinancialBreakdown(db, from, to, clubId);
  // Source distribution is cash flow: a top-up must not be counted once as
  // TOPUP and then a second time when that stored balance is spent.
  const games = report.gameReceipts;
  const bar = report.receipts.BAR.CASH + report.receipts.BAR.CARD;
  // The daily cash-flow chart follows the financial report's retained receipts.
  // Balance spending is shown in its sales category but is not counted twice as new cash.
  return { games, bar, topup: report.topupReceipts, total: report.total, rows: report.rows || [] };
}

function sessionEnd(session, nowMs) {
  const start = Date.parse(session.started_at);
  if (!Number.isFinite(start)) return start;
  const end = Date.parse(session.ends_at);
  if (session.status === 'ACTIVE') return Math.min(Number.isFinite(end) ? end : nowMs, nowMs);
  return Number.isFinite(end) ? end : start;
}

function addHourlyMinutes(buckets, startMs, endMs) {
  let cursor = startMs;
  while (cursor < endMs) {
    const point = new Date(cursor);
    const boundary = new Date(point);
    boundary.setMinutes(60, 0, 0);
    const sliceEnd = Math.min(endMs, boundary.getTime());
    buckets[point.getHours()] += Math.max(0, (sliceEnd - cursor) / 60000);
    cursor = sliceEnd;
  }
}

function hourlyCapacity(fromDate, now, computerCount) {
  const buckets = Array(24).fill(0);
  if (!computerCount) return buckets;
  const cursor = new Date(`${fromDate}T00:00:00`);
  while (cursor.getTime() < now.getTime()) {
    const dayEnd = new Date(cursor);
    dayEnd.setHours(24, 0, 0, 0);
    const end = Math.min(dayEnd.getTime(), now.getTime());
    addHourlyMinutes(buckets, cursor.getTime(), end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets.map(minutes => minutes * computerCount);
}

export function buildServerAnalytics(db, { clubId = null, days = 30, now = new Date() } = {}) {
  const daysCount = clamp(Number.isFinite(Number(days)) ? Math.trunc(Number(days)) : 30, 1, 365);
  const today = new Date(now);
  const firstDay = new Date(today);
  firstDay.setHours(0, 0, 0, 0);
  firstDay.setDate(firstDay.getDate() - daysCount + 1);
  const fromDate = dateKey(firstDay), toDate = dateKey(today), nowMs = today.getTime();

  const rangeSales = salesFor(db, fromDate, toDate, clubId);
  // Calculate retained receipts once for the entire period, including refunds
  // outside it. Previously each day rebuilt the complete financial report.
  const dailyTotals=new Map(), localDay=db.prepare("SELECT date(?,'localtime') AS day");
  for(const row of getRetainedPayments(db,fromDate,toDate,clubId)){
    if(!['CASH','CARD'].includes(row.paymentMethod))continue;
    const day=localDay.get(row.created_at).day;
    const totals=dailyTotals.get(day)||{total:0,bar:0};
    totals.total+=row.amount;if(row.category==='BAR')totals.bar+=row.amount;dailyTotals.set(day,totals);
  }
  const dailyRevenue = [];
  for (let i = 0; i < daysCount; i++) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + i);
    const date = dateKey(day), sales = dailyTotals.get(date)||{total:0,bar:0};
    dailyRevenue.push({ date, label: `${pad(day.getDate())}.${pad(day.getMonth() + 1)}`, revenue: sales.total, barRevenue: sales.bar });
  }

  const computerRows = clubId === null
    ? db.prepare('SELECT id,name,pc_number,zone,club_id FROM computers ORDER BY pc_number').all()
    : db.prepare('SELECT id,name,pc_number,zone,club_id FROM computers WHERE club_id=? ORDER BY pc_number').all(clubId);
  // PC-0 and archive rows preserve old references; they are not workstations.
  const computers = computerRows.filter(pc => Number(pc.pc_number) > 0);
  const placeholderIds = new Set(computerRows.filter(pc => !(Number(pc.pc_number) > 0))
    .map(pc => `${pc.club_id}:${pc.id}`));
  const sessions = clubId === null
    ? db.prepare("SELECT * FROM sessions WHERE started_at IS NOT NULL AND datetime(started_at) <= datetime(?) AND datetime(COALESCE(ends_at,?)) >= datetime(?)").all(today.toISOString(), today.toISOString(), firstDay.toISOString())
    : db.prepare("SELECT * FROM sessions WHERE club_id=? AND started_at IS NOT NULL AND datetime(started_at) <= datetime(?) AND datetime(COALESCE(ends_at,?)) >= datetime(?)").all(clubId, today.toISOString(), today.toISOString(), firstDay.toISOString());
  const byIdentity = new Map(), stats = new Map();
  for (const pc of computers) {
    const row = { id:pc.id, name:pc.name, pcNumber:pc.pc_number, zone:pc.zone, totalRevenue:0, totalHours:0, sessionsCount:0 };
    stats.set(`${pc.club_id}:${pc.id}`, row);
    byIdentity.set(`${pc.club_id}:id:${pc.id}`, row);
    byIdentity.set(`${pc.club_id}:number:${pc.pc_number}`, row);
  }

  const sessionMap = new Map(sessions.map(session=>[String(session.id),session]));
  const sessionLookup = db.prepare('SELECT * FROM sessions WHERE id=? AND (? IS NULL OR club_id=?)');
  // A receipt can be recorded after a session ended. It still needs its PC history.
  for(const row of rangeSales.rows)if(row.category==='GAME' && row.sessionId && !sessionMap.has(String(row.sessionId))){
    const session=sessionLookup.get(row.sessionId,clubId,clubId);
    if(session)sessionMap.set(String(session.id),session);
  }
  const attribution=createSessionAttribution(db), distributions=new Map(), offsets=new Map();
  const unattributed={totalRevenue:0,totalHours:0,sessionsCount:0}, unknownSessions=new Set();
  function isPlaceholder(session, pc) {
    const id=String(pc?.id ?? session.computer_id);
    return placeholderIds.has(`${session.club_id}:${id}`) || id===`archived_${session.club_id}` ||
      (pc?.pc_number != null && !(Number(pc.pc_number)>0)) ||
      (id==='0' && !byIdentity.has(`${session.club_id}:id:0`));
  }
  function pcStats(session, pc) {
    if(!pc || isPlaceholder(session,pc))return unattributed;
    let row=byIdentity.get(`${session.club_id}:id:${pc.id}`) || (!pc.name && byIdentity.get(`${session.club_id}:number:${pc.id}`));
    if(!row && pc.name){
      row={id:pc.id,name:pc.name,pcNumber:pc.pc_number ?? null,zone:pc.zone ?? null,archived:true,totalRevenue:0,totalHours:0,sessionsCount:0};
      stats.set(`${session.club_id}:${pc.id}`,row);byIdentity.set(`${session.club_id}:id:${pc.id}`,row);
    }
    return row || unattributed;
  }
  const hourlyOccupied = Array(24).fill(0);
  let occupiedMinutes = 0, durationTotal = 0, durationCount = 0, todayChecks = 0;
  for (const session of sessionMap.values()) {
    const start = Date.parse(session.started_at), rawEnd = sessionEnd(session, nowMs);
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd < start) continue;
    const end = Math.min(rawEnd, nowMs), clippedStart = Math.max(start, firstDay.getTime());
    const parts=attribution.distribution(session,end);
    distributions.set(String(session.id),parts);
    const visited=new Set();
    let sessionMinutes=0;
    for(const part of parts.time){
      const from=Math.max(part.start,firstDay.getTime()), to=Math.min(part.end,nowMs);
      if(to<=from)continue;
      const pc=pcStats(session,part.pc), minutes=(to-from)/60000;
      pc.totalHours+=minutes/60;
      if(!visited.has(pc)){pc.sessionsCount++;visited.add(pc);}
      if(pc===unattributed)unknownSessions.add(String(session.id));
      // Keep historical receipts/duration separate, but never let a placeholder
      // increase occupied time, session KPIs, or the capacity denominator.
      if(!isPlaceholder(session,part.pc)){
        sessionMinutes+=minutes;occupiedMinutes+=minutes;
        addHourlyMinutes(hourlyOccupied,from,to);
      }
    }
    if (end <= clippedStart || sessionMinutes<=0) continue;
    if (start >= firstDay.getTime()) { durationTotal += sessionMinutes; durationCount += 1; }
    if (dateKey(new Date(start)) === toDate) todayChecks += 1;
  }

  for (const row of rangeSales.rows) {
    if (row.category !== 'GAME') continue;
    const id=String(row.sessionId), session=sessionMap.get(id), parts=distributions.get(id);
    const amount=Number(row.amount || 0);
    if(!session || !parts || amount<0){unattributed.totalRevenue+=amount;unknownSessions.add(id);continue;}
    let from=0;
    if(parts.transferred){
      if(!offsets.has(id))offsets.set(id,attribution.paymentOffsets(session));
      from=offsets.get(id).get(row.id);
      if(from===undefined){unattributed.totalRevenue+=amount;unknownSessions.add(id);continue;}
    }
    for(const part of parts.money){
      const share=Math.max(0,Math.min(from+amount,part.end)-Math.max(from,part.start));
      if(!share)continue;
      const pc=pcStats(session,part.pc);pc.totalRevenue+=share;
      if(pc===unattributed)unknownSessions.add(id);
    }
  }
  // Round the aggregate once; splitting one receipt must not invent/lose a som.
  const rounded=[...stats.values(),unattributed];
  let remainder=Math.round(rounded.reduce((sum,pc)=>sum+pc.totalRevenue,0))-rounded.reduce((sum,pc)=>sum+Math.floor(pc.totalRevenue),0);
  const fractions=new Map(rounded.map(pc=>[pc,pc.totalRevenue-Math.floor(pc.totalRevenue)]));
  for(const pc of rounded)pc.totalRevenue=Math.floor(pc.totalRevenue);
  for(const pc of [...rounded].sort((a,b)=>fractions.get(b)-fractions.get(a)))if(remainder>0){pc.totalRevenue++;remainder--;}
  const computerStats = [...stats.values()].map(pc => ({ ...pc, totalMinutes:Number((pc.totalHours*60).toFixed(2)), totalHours:Number(pc.totalHours.toFixed(2)) }))
    .sort((a,b) => b.totalRevenue-a.totalRevenue || b.totalHours-a.totalHours || Number(a.pcNumber)-Number(b.pcNumber));
  const capacity = hourlyCapacity(fromDate, today, computers.length);
  const peakHours = hourlyOccupied.map((minutes,index) => capacity[index] > 0 ? clamp(Math.round(minutes / capacity[index] * 100), 0, 100) : 0);
  const peakValue = Math.max(...peakHours, 0), peakHour = peakValue > 0 ? peakHours.indexOf(peakValue) : null;
  const totalCapacity = capacity.reduce((sum,value) => sum + value, 0);

  return {
    success:true, period:{ from:fromDate, to:toDate, days:daysCount }, dailyRevenue, computerStats,
    unattributed:{...unattributed,totalHours:Number(unattributed.totalHours.toFixed(2)),sessionsCount:unknownSessions.size},
    revenueSources:{ games:rangeSales.games, bar:rangeSales.bar, topup:rangeSales.topup }, peakHours,
    kpis:{
      averageOccupancy:totalCapacity > 0 ? clamp(Math.round(occupiedMinutes / totalCapacity * 100), 0, 100) : 0,
      peakHour, peakTime:peakHour === null ? '—' : `${pad(peakHour)}:00–${pad((peakHour + 1) % 24)}:00`,
      averageSessionMinutes:durationCount ? Math.round(durationTotal / durationCount) : 0,
      todayChecks
    }
  };
}
