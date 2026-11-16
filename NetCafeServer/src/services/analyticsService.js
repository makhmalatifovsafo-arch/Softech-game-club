import { getFinancialBreakdown } from './financialBreakdown.js';

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

  const dailyRevenue = [];
  for (let i = 0; i < daysCount; i++) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + i);
    const date = dateKey(day), sales = salesFor(db, date, date, clubId);
    dailyRevenue.push({ date, label: `${pad(day.getDate())}.${pad(day.getMonth() + 1)}`, revenue: sales.total, barRevenue: sales.bar });
  }

  const computers = clubId === null
    ? db.prepare('SELECT id,name,pc_number,zone,club_id FROM computers ORDER BY pc_number').all()
    : db.prepare('SELECT id,name,pc_number,zone,club_id FROM computers WHERE club_id=? ORDER BY pc_number').all(clubId);
  const sessions = clubId === null
    ? db.prepare("SELECT id,club_id,computer_id,started_at,ends_at,status FROM sessions WHERE started_at IS NOT NULL AND datetime(started_at) <= datetime(?) AND datetime(COALESCE(ends_at,?)) >= datetime(?)").all(today.toISOString(), today.toISOString(), firstDay.toISOString())
    : db.prepare("SELECT id,club_id,computer_id,started_at,ends_at,status FROM sessions WHERE club_id=? AND started_at IS NOT NULL AND datetime(started_at) <= datetime(?) AND datetime(COALESCE(ends_at,?)) >= datetime(?)").all(clubId, today.toISOString(), today.toISOString(), firstDay.toISOString());
  const byIdentity = new Map(), stats = new Map();
  for (const pc of computers) {
    const row = { id:pc.id, name:pc.name, pcNumber:pc.pc_number, zone:pc.zone, totalRevenue:0, totalHours:0, sessionsCount:0 };
    stats.set(`${pc.club_id}:${pc.id}`, row);
    byIdentity.set(`${pc.club_id}:id:${pc.id}`, row);
    byIdentity.set(`${pc.club_id}:number:${pc.pc_number}`, row);
  }

  const hourlyOccupied = Array(24).fill(0), sessionToPc = new Map();
  let occupiedMinutes = 0, durationTotal = 0, durationCount = 0, todayChecks = 0;
  for (const session of sessions) {
    const start = Date.parse(session.started_at), rawEnd = sessionEnd(session, nowMs);
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd < start) continue;
    const end = Math.min(rawEnd, nowMs), clippedStart = Math.max(start, firstDay.getTime());
    if (end <= clippedStart) continue;
    const pc = byIdentity.get(`${session.club_id}:id:${session.computer_id}`) || byIdentity.get(`${session.club_id}:number:${session.computer_id}`);
    if (!pc) continue;
    sessionToPc.set(String(session.id), pc);
    const minutes = (end - clippedStart) / 60000;
    pc.totalHours += minutes / 60;
    pc.sessionsCount += 1;
    occupiedMinutes += minutes;
    addHourlyMinutes(hourlyOccupied, clippedStart, end);
    if (start >= firstDay.getTime()) { durationTotal += Math.max(0, end - start) / 60000; durationCount += 1; }
    if (dateKey(new Date(start)) === toDate) todayChecks += 1;
  }

  const rangeSales = salesFor(db, fromDate, toDate, clubId);
  for (const row of rangeSales.rows) {
    if (row.category !== 'GAME' || !row.sessionId) continue;
    const pc = sessionToPc.get(String(row.sessionId));
    if (pc) pc.totalRevenue += Number(row.amount || 0);
  }
  const computerStats = [...stats.values()].map(pc => ({ ...pc, totalRevenue:Math.round(pc.totalRevenue), totalHours:Number(pc.totalHours.toFixed(1)) }))
    .sort((a,b) => b.totalRevenue-a.totalRevenue || b.totalHours-a.totalHours || Number(a.pcNumber)-Number(b.pcNumber));
  const capacity = hourlyCapacity(fromDate, today, computers.length);
  const peakHours = hourlyOccupied.map((minutes,index) => capacity[index] > 0 ? clamp(Math.round(minutes / capacity[index] * 100), 0, 100) : 0);
  const peakValue = Math.max(...peakHours, 0), peakHour = peakValue > 0 ? peakHours.indexOf(peakValue) : null;
  const totalCapacity = capacity.reduce((sum,value) => sum + value, 0);

  return {
    success:true, period:{ from:fromDate, to:toDate, days:daysCount }, dailyRevenue, computerStats,
    revenueSources:{ games:rangeSales.games, bar:rangeSales.bar, topup:rangeSales.topup }, peakHours,
    kpis:{
      averageOccupancy:totalCapacity > 0 ? clamp(Math.round(occupiedMinutes / totalCapacity * 100), 0, 100) : 0,
      peakHour, peakTime:peakHour === null ? '—' : `${pad(peakHour)}:00–${pad((peakHour + 1) % 24)}:00`,
      averageSessionMinutes:durationCount ? Math.round(durationTotal / durationCount) : 0,
      todayChecks
    }
  };
}
