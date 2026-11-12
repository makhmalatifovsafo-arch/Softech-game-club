export function formatClubInspector(club,metrics={},workstations=[]){
 const stamp=club.last_heartbeat_at||club.last_heartbeat;
 const normalized=stamp&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(String(stamp))?String(stamp).replace(' ','T')+'Z':stamp;
 const elapsed=Date.now()-Date.parse(normalized),online=Number.isFinite(elapsed)&&elapsed>=0&&elapsed<=90000;
 const days=Math.ceil((Date.parse(club.license_expires_at)-Date.now())/86400000);
 return {club:{...club,actual_workstations:workstations.length,is_online_now:online,offline_minutes:Number.isFinite(elapsed)?Math.max(0,Math.floor(elapsed/60000)):null,license_days_left:Number.isFinite(days)?days:0,duty_cashier:null,ping_ms:null},
  kassa:{totalDailyRevenue:Number(metrics.total_daily_revenue||0),sessionsRevenue:Math.max(0,Number(metrics.total_daily_revenue||0)-Number(metrics.bar_revenue||0)),barRevenue:Number(metrics.bar_revenue||0),refundsSum:null,totalSessionsCount:Number(metrics.total_sessions_count||0),totalPlayHours:Number(metrics.total_play_hours||0)},
  workstations:workstations.map(pc=>({id:pc.id,pcNumber:pc.pc_number,zoneName:pc.zone_name||'STANDARD',status:online?pc.status:'OFFLINE',session:online&&pc.status==='OCCUPIED'?{gamerName:pc.active_gamer_name||'Ma’lumot yo‘q',startedAt:pc.current_session_started_at?new Date(pc.current_session_started_at).toLocaleTimeString(): '—',playedMinutes:pc.current_session_started_at?Math.max(0,Math.floor((Date.now()-Date.parse(pc.current_session_started_at))/60000)):null,remainingMinutes:pc.minutes_left??null,hourlyRate:null,spentAmount:null}:null}))};
}
