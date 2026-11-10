import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {PGlite} from '../.tools/postgres-test/node_modules/@electric-sql/pglite/dist/index.js';
process.env.VERCEL='1';process.env.SUPERADMIN_JWT_SECRET='audit-secret-with-at-least-thirty-two-bytes';process.env.SUPABASE_URL='';process.env.SUPABASE_SERVICE_ROLE_KEY='';
const db=await PGlite.create();
const ident=v=>{if(!/^[a-z_][a-z0-9_]*$/.test(v))throw Error('Invalid SQL identifier');return '"'+v+'"';};
const json=v=>JSON.parse(JSON.stringify(v));
// Supabase-shaped test adapter executes real PostgreSQL SQL, including RPC and constraints.
const client={from(table){let operation='SELECT',values,filters=[],sort=table==='mobile_agents'?'club_id':'id',ascending=true,start=0,end=999,one=false,conflict;
 const q={select(){return q;},eq(k,v){filters.push([k,'=',v]);return q;},is(k,v){filters.push([k,'IS',v]);return q;},gt(k,v){filters.push([k,'>',v]);return q;},neq(k,v){filters.push([k,'<>',v]);return q;},gte(k,v){filters.push([k,'>=',v]);return q;},in(k,v){filters.push([k,'IN',v]);return q;},contains(k,v){filters.push([k,'@>',JSON.stringify(v)]);return q;},order(k,o={}){sort=k;ascending=o.ascending!==false;return q;},range(a,b){start=a;end=b;return q;},limit(n){start=0;end=n-1;return q;},maybeSingle(){one=true;return q;},single(){one=true;return q;},insert(v){operation='INSERT';values=v;return q;},upsert(v,o){operation='INSERT';values=v;conflict=o.onConflict;return q;},update(v){operation='UPDATE';values=v;return q;},delete(){operation='DELETE';return q;},then(resolve,reject){return (async()=>{try{
  const args=[],param=v=>{args.push(typeof v==='object'&&v!==null?JSON.stringify(v):v);return '$'+args.length;};
  let statement;
  if(operation==='INSERT'){
   const keys=Object.keys(values);statement='INSERT INTO '+ident(table)+'('+keys.map(ident).join(',')+') VALUES('+keys.map(k=>param(values[k])).join(',')+')';
   if(conflict)statement+=' ON CONFLICT('+conflict.split(',').map(ident).join(',')+') DO UPDATE SET '+keys.filter(k=>!conflict.split(',').includes(k)).map(k=>ident(k)+'=excluded.'+ident(k)).join(',');
  }else{
   statement=operation==='SELECT'?'SELECT * FROM '+ident(table):operation==='DELETE'?'DELETE FROM '+ident(table):'UPDATE '+ident(table)+' SET '+Object.keys(values).map(k=>ident(k)+'='+param(values[k])).join(',');
   if(filters.length)statement+=' WHERE '+filters.map(([k,op,v])=>ident(k)+(op==='IS'?' IS NULL':op==='IN'?' IN ('+v.map(param).join(',')+')':' '+op+' '+param(v))).join(' AND ');
  }
  statement+=operation==='SELECT'?' ORDER BY '+ident(sort)+(ascending?' ASC':' DESC')+' LIMIT '+(end-start+1)+' OFFSET '+start:' RETURNING *';
  const result=await db.query(statement,args);return {data:json(one?(result.rows[0]??null):result.rows),error:null};
 }catch(error){return {data:null,error:{message:error.message,code:error.code}};}})().then(resolve,reject);}};return q;},
 async rpc(name,args){try{const keys=Object.keys(args);const r=await db.query('SELECT '+ident(name)+'('+keys.map((k,i)=>ident(k)+'=> $'+(i+1)).join(',')+') AS result',Object.values(args));return {data:json(r.rows[0].result),error:null};}catch(error){return {data:null,error:{message:error.message,code:error.code}};}}
};
try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE PUBLICATION supabase_realtime;');
 await db.exec(fs.readFileSync('supabase_schema.sql','utf8'));await db.exec(fs.readFileSync('migrations/20261031_cloud_audit.sql','utf8'));await db.exec(fs.readFileSync('migrations/20261031_mobile_relay.sql','utf8'));await db.exec(fs.readFileSync('migrations/20261031_mobile_relay.sql','utf8'));
 await db.exec("INSERT INTO clubs(id,name,slug,hardware_fingerprint,api_secret_token,total_workstations,tariff_type,tariff_fixed_price) VALUES(1,'API Club','api-club','HWID-API-TEST-123','private-test-token',24,'FIXED_MONTHLY',500000);");
 const {default:handler}=await import('../api/index.js');const {SupabaseCloudService}=await import('../src/services/supabaseClient.js');SupabaseCloudService.client=client;
 const {signAccessToken}=await import('../src/utils/jwt.js');const {signClubLicense}=await import('../src/services/cloudActivationService.js');
 const token=signAccessToken({id:1,sub:1,username:'admin',role:'superadmin'});
 async function api(url,method='GET',body={},auth=true){let result;await handler({url,method,body,headers:{host:'localhost',...(auth?{authorization:'Bearer '+token}:{})}},{setHeader(){},end(text){result={status:this.statusCode,body:JSON.parse(text)};}});return result;}
 await db.exec('SET ROLE service_role');
 for(const route of ['/api/billing/summary','/api/billing/clubs','/api/analytics/platform'])assert.equal((await api(route,'GET',{},false)).status,401);
 const summary=await api('/api/billing/summary');assert.equal(summary.status,200,JSON.stringify(summary));assert.equal(summary.body.summary.mrr,500000);assert.equal(summary.body.summary.totalClubs,1);
 assert.equal((await api('/api/billing/clubs')).body.clubs[0].tariff.type,'FIXED');
 assert.equal((await api('/api/billing/tariff/1','POST',{tariffType:'PER_PC',pricePerPc:25000,fixedPrice:500000})).status,200);assert.equal((await api('/api/billing/summary')).body.summary.mrr,600000);
 const payment={clubId:1,amount:600000,paymentMethod:'CASH',monthsAdded:1,requestId:crypto.randomUUID()};
 const paid=await api('/api/billing/payments','POST',payment);assert.equal(paid.status,200,JSON.stringify(paid));const twice=await api('/api/billing/payments','POST',payment);assert.equal(twice.body.paymentId,paid.body.paymentId);
 assert.equal((await api('/api/billing/summary')).body.summary.currentMonthCollected,600000);
 assert.equal((await api('/api/admin/clear-demo-data','POST')).status,409);assert.equal((await db.query('SELECT count(*)::int n FROM clubs')).rows[0].n,1);
 const command=await api('/api/telemetry/commands/1','POST',{action:'BROADCAST_ANNOUNCEMENT',payload:{title:'Test',message:'Hello'}});assert.equal(command.status,200,JSON.stringify(command));
 assert.equal((await api('/api/clubs/1/manager','PUT',{username:'owner',password:'private-owner-pass'})).status,200);
 const club=(await db.query('SELECT * FROM clubs WHERE id=1')).rows[0];const license=signClubLicense(json(club),club.hardware_fingerprint);
 const cashierSaved=await api('/api/clubs/1/administrator','PUT',{username:'cashier_sync',password:'cashier-sync-password'});
 assert.equal(cashierSaved.status,200,JSON.stringify(cashierSaved));
 assert.equal((await api('/api/telemetry/staff-accounts','POST',{clubId:1},false)).status,401);
 const staffSync=await api('/api/telemetry/staff-accounts','POST',{clubId:1,signedLicense:license},false);
 assert.equal(staffSync.status,200,JSON.stringify(staffSync));
 assert.equal(staffSync.body.administratorAccount.payload.username,'cashier_sync');
 assert.equal(staffSync.body.managerAccount.payload.username,'owner');
 const staffAck=await api('/api/telemetry/staff-accounts','POST',{clubId:1,signedLicense:license,administratorRevision:staffSync.body.administratorAccount.payload.revision},false);
 assert.equal(staffAck.status,200);
 assert.equal((await api('/api/clubs/1/administrator')).body.administrator.applied,true);
 const {MobileRelay}=await import('../src/services/mobileRelay.js');const {makeRequest}=await import('../public/mobile/crypto.js');
 const relay=new MobileRelay({client});const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});const jwk=publicKey.export({format:'jwk'});
 const registration=await api('/api/mobile/agent','POST',{signedLicense:license,publicKey:jwk},false);assert.equal(registration.status,200,JSON.stringify(registration));
 const connection=await api('/api/mobile/connection?club=1','GET',{},false);assert.equal(connection.status,200,JSON.stringify(connection));
 const packet=await makeRequest(connection.body.publicKey,1,{path:'/api/computers',method:'GET',token:'test'});
 assert.equal((await api('/api/mobile/request','POST',packet.job,false)).status,200);assert.equal((await api('/api/mobile/request','POST',packet.job,false)).status,200);
 const pending=await relay.poll({signedLicense:license,publicKey:jwk});assert.equal(pending.jobs.length,1);assert.equal((await relay.result(packet.job)).state,'PENDING');
 await relay.poll({signedLicense:license,publicKey:jwk,results:[{id:packet.job.id,result:{iv:'test',data:'encrypted-result'}}]});assert.equal((await relay.result(packet.job)).state,'DONE');
 assert.equal((await db.query('SELECT count(*)::int n FROM mobile_requests')).rows[0].n,1);
 await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(()=>db.query('SELECT * FROM mobile_requests'));await assert.rejects(()=>db.query('SELECT * FROM mobile_agents'));await db.exec('RESET ROLE;SET ROLE service_role');
 console.log('PASS PostgreSQL mobile relay migration, API, retry deduplication, result acknowledgement and public-role restrictions');
 const report={clubId:1,signedLicense:license,reportDate:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'}),totalSessionsCount:3,todayRevenue:150000,barRevenue:30000,onlinePcsCount:1,occupiedPcsCount:1,workstations:[{pc:1,status:'OCCUPIED',zone:'VIP',minutesLeft:15}]};
 let heartbeat=await api('/api/telemetry/heartbeat','POST',report,false);assert.equal(heartbeat.status,200,JSON.stringify(heartbeat));assert.ok(heartbeat.body.managerAccount);assert.equal(heartbeat.body.signedCommands.length,1);
 heartbeat=await api('/api/telemetry/heartbeat','POST',{...report,managerRevision:heartbeat.body.managerAccount.payload.revision,commandResults:[{id:command.body.queuedCommand.id,status:'EXECUTED'}]},false);assert.equal(heartbeat.body.signedCommands.length,0);
 assert.equal((await api('/api/clubs/1/manager')).body.manager.applied,true);
 assert.equal((await db.query('SELECT total_workstations FROM clubs WHERE id=1')).rows[0].total_workstations,24);
 const detail=await api('/api/telemetry/clubs/1');assert.equal(detail.status,200,JSON.stringify(detail));assert.equal(detail.body.workstations.length,1);assert.equal(detail.body.kassa.barRevenue,30000);assert.equal(detail.body.club.ping_ms,null);
 const overview=await api('/api/telemetry/summary');assert.equal(overview.body.summary.revenue.sessionsCount,3);assert.equal(overview.body.summary.revenue.barTotal,30000);
 const analytics=await api('/api/analytics/platform?days=365');assert.equal(analytics.status,200,JSON.stringify(analytics));assert.equal(analytics.body.summary.totalRevenue,150000);
 assert.equal((await api('/api/telemetry/commands/1','POST',{action:'LOCK_CLUB_LICENSE',payload:{reason:'Test lock'}})).status,200);
 assert.equal((await db.query('SELECT status FROM clubs WHERE id=1')).rows[0].status,'BLOCKED');
 assert.equal((await api('/api/telemetry/commands/1','POST',{action:'UNLOCK_CLUB_LICENSE',payload:{extensionDays:7}})).status,200);
 console.log('PASS Vercel API + real PostgreSQL adapter: billing, tariff, duplicate payment, analytics, telemetry, staff delivery, remote aliases, ban/unban and safe bulk-delete rejection');
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.close();}
