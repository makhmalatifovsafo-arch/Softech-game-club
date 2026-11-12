// Super Admin and Manager consume the same daily ledger snapshot. Deposits are
// receipts, not game sales; spending a balance must not count its deposit twice.
export function mergeFinancialReports(metrics, snapshots) {
  const rows = new Map(metrics.map(m => {
    const date=(m.record_date instanceof Date ? m.record_date.toISOString() : String(m.record_date)).slice(0,10);
    return [m.club_id+':'+date, {...m,record_date:date}];
  }));
  for (const snapshot of snapshots) {
    const report = typeof snapshot.payload === 'string' ? JSON.parse(snapshot.payload) : snapshot.payload;
    if (report?.accountingVersion !== 2 || !snapshot.data_key.startsWith('report:')) continue;
    const date = snapshot.data_key.slice(7), summary = report.summary;
    if (!summary || !['salesRevenue','gameRevenue','barRevenue','cashReceipts','topupRevenue'].every(k => Number.isFinite(Number(summary[k])))) continue;
    const key = snapshot.club_id+':'+date;
    rows.set(key, {...rows.get(key), club_id:snapshot.club_id, record_date:date,
      total_daily_revenue:Number(summary.salesRevenue), bar_revenue:Number(summary.barRevenue),
      game_revenue:Number(summary.gameRevenue), cash_receipts:Number(summary.cashReceipts),
      topup_revenue:Number(summary.topupRevenue), accounting_version:2, captured_at:snapshot.captured_at});
  }
  return [...rows.values()];
}

export function localFinancialReports(db, from, to='9999-12-31', clubId=null) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_dashboard_data'").get()) return [];
  return db.prepare('SELECT * FROM mobile_dashboard_data WHERE data_key BETWEEN ? AND ? AND (? IS NULL OR club_id=?)').all('report:'+from,'report:'+to,clubId,clubId);
}

export async function cloudFinancialReports(client, from, to='9999-12-31', clubId=null) {
  const rows=[];
  for (let offset=0;;offset+=1000) {
    let query=client.from('mobile_dashboard_data').select('club_id,data_key,payload,captured_at')
      .gte('data_key','report:'+from).lte('data_key','report:'+to).order('club_id').order('data_key').range(offset,offset+999);
    if (clubId!==null) query=query.eq('club_id',clubId);
    const result=await query;
    if(result.error) throw Object.assign(Error('Sinxronlangan moliyaviy hisobotlarni o‘qib bo‘lmadi.'),{statusCode:503});
    rows.push(...(result.data||[]));
    if(!result.data || result.data.length<1000)return rows;
  }
}

export function platformAnalytics(clubs, metrics, days) {
  const dates=new Map();
  for(const m of metrics){
    const row=dates.get(m.record_date)||{date:m.record_date,totalRevenue:0,barRevenue:0,sessionsCount:0,playHours:0};
    row.totalRevenue+=Number(m.total_daily_revenue||0);row.barRevenue+=Number(m.bar_revenue||0);
    row.sessionsCount+=Number(m.total_sessions_count||0);row.playHours+=Number(m.total_play_hours||0);dates.set(m.record_date,row);
  }
  let cumulative=0;
  const dynamicRevenue=[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({...r,formattedDate:r.date,
    dayOfWeek:new Date(r.date).toLocaleDateString('uz-UZ',{weekday:'short'}),sessionsRevenue:r.totalRevenue-r.barRevenue,cumulativeRevenue:cumulative+=r.totalRevenue}));
  const topClubs=clubs.map(c=>{
    const rows=metrics.filter(m=>Number(m.club_id)===Number(c.id));
    return {id:c.id,name:c.name,city:c.city,workstations:Number(c.total_workstations),status:c.status,
      totalRevenue:rows.reduce((n,m)=>n+Number(m.total_daily_revenue||0),0),barRevenue:rows.reduce((n,m)=>n+Number(m.bar_revenue||0),0),
      occupancyRate:rows.length&&c.total_workstations?Math.min(100,Math.round(rows.reduce((n,m)=>n+Number(m.peak_concurrent_pcs||0),0)/rows.length/Number(c.total_workstations)*100)):0};
  }).sort((a,b)=>b.totalRevenue-a.totalRevenue).slice(0,5).map((c,i)=>({...c,rank:i+1}));
  return {success:true,timeframeDays:days,summary:{totalRevenue:cumulative,avgDailyRevenue:dynamicRevenue.length?Math.round(cumulative/dynamicRevenue.length):0,
    totalSessions:dynamicRevenue.reduce((n,r)=>n+r.sessionsCount,0),totalPlayHours:dynamicRevenue.reduce((n,r)=>n+r.playHours,0),
    topClub:topClubs[0]?.name??'Ma’lumot yo‘q',topCity:null,peakHour:'Ma’lumot yo‘q'},dynamicRevenue,topClubs,hourlyPeakOccupancy:[]};
}
