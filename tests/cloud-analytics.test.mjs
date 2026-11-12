import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync('.test-output',{recursive:true});
process.env.SOFTECH_CLOUD_DATA_DIR=fs.mkdtempSync(path.resolve('.test-output/analytics-'));
process.env.SUPERADMIN_INITIAL_PASSWORD='isolated-analytics-password';
process.env.SUPERADMIN_INITIAL_PIN='2468';
process.env.VERCEL='';process.env.AWS_LAMBDA_FUNCTION_NAME='';
for(const prefix of ['', 'SoftechCloudAdmin/']){
 test(prefix+'analytics is read-only on empty and small clubs databases',async()=>{
  const {db,initDatabase}=await import('../'+prefix+'src/db/connection.js');initDatabase();
  const {AnalyticsService}=await import('../'+prefix+'src/services/analyticsService.js');
  db.exec('DELETE FROM club_metrics; DELETE FROM clubs;');
  for(let i=0;i<3;i++){const result=AnalyticsService.getPlatformAnalytics();assert.equal(result.summary.totalRevenue,0);assert.equal(result.topClubs.length,0);assert.equal(result.hourlyPeakOccupancy.length,0);}
  db.prepare('INSERT INTO clubs (name,slug,total_workstations,owner_name,owner_phone,city,license_expires_at) VALUES (?,?,?,?,?,?,?)').run('Test Club','single-club',10,'Test Owner','+998900000000','Toshkent','2099-01-01');
  const id=db.prepare('SELECT id FROM clubs').get().id;
  db.prepare('INSERT INTO club_metrics (club_id,record_date,total_daily_revenue,bar_revenue,total_sessions_count,peak_concurrent_pcs) VALUES (?,?,?,?,?,?)').run(id,new Date().toISOString().slice(0,10),12000,2000,3,0);
  for(let i=0;i<3;i++){const r=AnalyticsService.getPlatformAnalytics();assert.equal(r.summary.totalRevenue,12000);assert.equal(r.topClubs[0].occupancyRate,0);assert.equal(r.topClubs.length,1);}
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clubs').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM club_metrics').get().n,1);
  const {TelemetryService}=await import('../'+prefix+'src/db/telemetryService.js');
  const inspector=TelemetryService.getClubDetailedInspector(id);
  assert.equal(inspector.workstations.length,0,'Inspector must not create imaginary PCs');
  assert.equal(inspector.club.ping_ms,null);
  assert.equal(inspector.kassa.refundsSum,null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM club_workstations_cache').get().n,0);
  for (const pcs of [[{pcNumber:1,status:'AVAILABLE'},{pcNumber:2,status:'OFFLINE'}],[{pcNumber:2,status:'OFFLINE'}],[]]) {
    TelemetryService.updateClubHeartbeat(id,{workstations:pcs,totalWorkstations:999});
    const row=TelemetryService.getAllClubsWithLiveMetrics().find(c=>c.id===id);
    assert.equal(row.actual_workstations,pcs.length);
    assert.equal(row.total_workstations,10,'Reported inventory must not modify the license limit');
    assert.equal(TelemetryService.getGlobalMetricsSummary().workstations.totalNetwork,pcs.length);
    assert.equal(TelemetryService.getClubDetailedInspector(id).workstations.length,pcs.length);
    TelemetryService.updateClubHeartbeat(id,{});
    assert.equal(TelemetryService.getClubDetailedInspector(id).workstations.length,pcs.length,'Missing snapshot must preserve the last inventory');
  }
  db.close();
 });
}
