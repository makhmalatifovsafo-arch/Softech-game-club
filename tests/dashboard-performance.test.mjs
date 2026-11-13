import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL='1';
process.env.SUPERADMIN_JWT_SECRET='dashboard-performance-test-secret-32-bytes';
process.env.SUPABASE_URL='';process.env.SUPABASE_SERVICE_ROLE_KEY='';

for(const prefix of ['','SoftechCloudAdmin/']) {
 test(prefix+'mobile data reuses request metadata without caching permissions across requests',async()=>{
  const {MobileDashboard}=await import('../'+prefix+'src/services/mobileDashboard.js');
  const service=new MobileDashboard({});let reads=0;
  service.row=async(id,key)=>{assert.equal(id,7);if(key==='metadata'){reads++;return {captured_at:new Date().toISOString(),payload:{serverDate:'2026-11-13',staff:[{role:'administrator',username:'cashier',revision:2,permissions:reads===1?['customers:view']:[]}]}};}return {payload:[],captured_at:new Date().toISOString()};};
  const session={role:'administrator',username:'cashier',revision:2},club={id:7,name:'Test',hardware_fingerprint:'fixture'};
  const url=new URL('https://test/api/mobile/dashboard/data?resource=computers');
  const first=await service.read(session,club,url);assert.equal(reads,1);assert.deepEqual(first.user.permissions,['customers:view']);
  const second=await service.read(session,club,url);assert.equal(reads,2);assert.deepEqual(second.user.permissions,[]);
  assert.equal(second.grant.payload.clubId,7);
 });
 test(prefix+'super admin overview reads metrics once and returns matching club cards',async()=>{
  const {default:handler}=await import('../'+prefix+'api/index.js');
  const {SupabaseCloudService:cloud}=await import('../'+prefix+'src/services/supabaseClient.js');
  const {CloudDashboardService}=await import('../'+prefix+'src/services/cloudDashboardService.js');
  const {signAccessToken}=await import('../'+prefix+'src/utils/jwt.js');
  const originalClient=cloud.client,originalMetrics=CloudDashboardService.prototype.dailyMetrics;
  let metricsReads=0,clubReads=0,pcReads=0;
  cloud.client={from(table){const q={select(){return q;},order(){clubReads++;return Promise.resolve({data:[{id:7,status:'ACTIVE',occupied_pcs:1,online_pcs:2,last_heartbeat_at:new Date().toISOString()}]});},eq(){pcReads++;return Promise.resolve({count:2});}};assert.ok(['clubs','club_workstations_cache'].includes(table));return q;}};
  CloudDashboardService.prototype.dailyMetrics=async()=>{metricsReads++;return [{club_id:7,total_daily_revenue:4000,total_sessions_count:1,bar_revenue:1000}];};
  try {
   let result;
   await handler({method:'GET',url:'/api/telemetry/summary',headers:{host:'test',authorization:'Bearer '+signAccessToken({id:1,sub:1,role:'superadmin'})}},{setHeader(){},end(raw){result={status:this.statusCode,...JSON.parse(raw)};}});
   assert.equal(result.status,200);assert.equal(metricsReads,1);assert.equal(clubReads,1);assert.equal(pcReads,1);
   assert.equal(result.summary.revenue.todayTotal,4000);assert.equal(result.clubs[0].today_revenue,4000);assert.equal(result.summary.workstations.totalNetwork,2);
  } finally {cloud.client=originalClient;CloudDashboardService.prototype.dailyMetrics=originalMetrics;}
 });
}
