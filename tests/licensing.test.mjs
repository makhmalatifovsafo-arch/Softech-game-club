import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
mkdirSync('.test-output', { recursive: true });
process.env.SOFTECH_CLOUD_DATA_DIR = mkdtempSync(path.resolve('.test-output/licensing-'));
process.env.SUPERADMIN_INITIAL_PASSWORD = 'test-activation-password';
process.env.SUPERADMIN_INITIAL_PIN = '2468';
process.env.SUPERADMIN_JWT_SECRET = 'test-jwt-secret-with-at-least-32-bytes';
process.env.REFRESH_SECRET = 'test-refresh-secret-with-at-least-32-bytes';
process.env.TELEGRAM_BOT_TOKEN = 'MOCK_TEST';
process.env.TELEGRAM_ADMIN_CHAT_ID = '123';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';
const { CloudActivationService: activation } = await import('../src/services/cloudActivationService.js');
const { SupabaseCloudService: cloud } = await import('../src/services/supabaseClient.js');
const { TelegramBotService: telegram } = await import('../src/services/telegramBot.js');
const { default: handler } = await import('../api/index.js');
const { signAccessToken } = await import('../src/utils/jwt.js');

function database() {
  const rows = [];
  const client = { rows, failure: null, from(table) {
    assert.equal(table, 'clubs');
    let op = 'select', values, filters = [], single = false, options;
    const q = {
      select() { return q; }, eq(k,v) { filters.push(r => String(r[k]) === String(v)); return q; },
      is(k,v) { filters.push(r => (r[k] ?? null) === v); return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(v) { op='insert'; values=v; return q; }, upsert(v,o) { op='upsert'; values=v; options=o; return q; },
      update(v) { op='update'; values=v; return q; }, delete() { op='delete'; return q; },
      then(resolve, reject) {
        try {
          if(client.failure) return Promise.resolve({ data:null, error:{message:client.failure} }).then(resolve,reject);
          let selected=rows.filter(r=>filters.every(f=>f(r)));
          if(op==='insert'||op==='upsert') {
            const duplicate=rows.find(r=>values.hardware_fingerprint && r.hardware_fingerprint===values.hardware_fingerprint);
            if(duplicate && options?.ignoreDuplicates) selected=[];
            else { const row={id:Math.max(0,...rows.map(r=>r.id))+1,hardware_fingerprint:null,...values}; rows.push(row); selected=[row]; }
          } else if(op==='update') selected.forEach(r=>Object.assign(r,values));
          else if(op==='delete') selected.forEach(r=>rows.splice(rows.indexOf(r),1));
          return Promise.resolve({data:single?(selected[0]?{...selected[0]}:null):selected.map(r=>({...r})),error:null}).then(resolve,reject);
        } catch(e) { return Promise.reject(e).then(resolve,reject); }
      }
    }; return q;
  }};
  return client;
}
async function api(url, method='GET', body={}, authorized=true) {
  let result;
  const req={url,method,body,headers:{host:'localhost',...(authorized?{authorization:'Bearer '+signAccessToken({id:1,sub:1,role:'superadmin',username:'admin'})}:{})}};
  const res={setHeader(){},end(text){result={status:this.statusCode,body:JSON.parse(text)};}};
  await handler(req,res);
  return result;
}
test('cloud registration -> key activation preserves subscription and PC limit', async()=>{
  cloud.client=database();
  const result=await api('/api/telemetry/clubs','POST',{name:"O'yin & Club",licenseDays:365,totalWorkstations:42,tariffType:'FIXED'});
  assert.equal(result.status,201);
  const club=result.body.club;
  assert.equal(club.tariff_type,'FIXED_MONTHLY');
  assert.ok(Date.parse(club.license_expires_at)>Date.now()+364*86400000);
  await activation.createActivationRequest({hardwareFingerprint:'HWID-TEST-12345'});
  const active=await activation.activateByKey({licenseKey:club.api_secret_token,hardwareFingerprint:'HWID-TEST-12345',totalPcs:16});
  assert.equal(active.signedLicense.payload.maxPcs,42);
  assert.equal(active.signedLicense.payload.expiresAt,club.license_expires_at);
  assert.equal(cloud.client.rows.length,1);
  await assert.rejects(()=>activation.activateByKey({licenseKey:club.api_secret_token,hardwareFingerprint:'HWID-OTHER-12345'}),/boshqa/);
  await assert.rejects(()=>activation.activateByKey({licenseKey:club.slug,hardwareFingerprint:'HWID-TEST-12345'}),/topilmadi/);
});
test('request -> panel approval -> poll, retries do not reset active license',async()=>{
  cloud.client=database();
  const request=await api('/api/telemetry/activation-request','POST',{clubName:"O'yin <Club>",hardwareFingerprint:'HWID-REQUEST-123',totalPcs:25},false);
  assert.equal(request.body.notification.success,false);
  assert.equal(request.body.success,true);
  const pending=await api('/api/telemetry/activation-requests');
  assert.equal(pending.body.requests[0].club_name,"O'yin <Club>");
  assert.equal(pending.body.requests[0].total_pcs,25);
  const url='/api/telemetry/activation-requests/'+request.body.requestId+'/approve';
  assert.equal((await api(url,'POST',{days:7},false)).status,401);
  assert.equal((await api(url,'POST',{days:7})).status,200);
  assert.equal((await activation.createActivationRequest({hardwareFingerprint:'HWID-REQUEST-123'})).status,'APPROVED');
  const poll=await activation.getActivationStatus('HWID-REQUEST-123');
  assert.equal(poll.status,'APPROVED');
  assert.equal(poll.signedLicense.payload.maxPcs,25);
  assert.ok(Date.parse(poll.signedLicense.payload.expiresAt)<Date.now()+8*86400000);
  assert.equal((await api(url,'POST',{days:7})).status,409);
});
test('database failure cannot report successful request or registration',async()=>{
  cloud.client=database();cloud.client.failure='missing unique constraint';
  assert.equal((await api('/api/telemetry/activation-request','POST',{hardwareFingerprint:'HWID-FAILURE-123'},false)).status,503);
  assert.equal((await api('/api/telemetry/clubs','POST',{name:'Test'})).body.success,false);
});
test('blocked and expired clubs cannot activate, rejection remains rejected',async()=>{
  cloud.client=database();
  await activation.createActivationRequest({hardwareFingerprint:'HWID-REJECT-123'});
  assert.equal((await api('/api/telemetry/activation-requests/1/reject','POST',{})).status,200);
  assert.equal((await activation.getActivationStatus('HWID-REJECT-123')).status,'REJECTED');
  await assert.rejects(()=>activation.activateByKey({licenseKey:cloud.client.rows[0].api_secret_token,hardwareFingerprint:'HWID-REJECT-123'}),/faol emas/);
  cloud.client.rows[0].status='ACTIVE';cloud.client.rows[0].license_expires_at='2020-01-01';
  await assert.rejects(()=>activation.activateByKey({licenseKey:cloud.client.rows[0].api_secret_token,hardwareFingerprint:'HWID-REJECT-123'}),/tugagan/);
});
test('Telegram delivery reports actual failure and callback uses cloud service',async()=>{
  const original=globalThis.fetch;
  try {
    telegram.botToken='';assert.equal((await telegram.sendMessage('test')).success,false);
    telegram.botToken='test-token';
    globalThis.fetch=async()=>({ok:false,json:async()=>({ok:false,error_code:403,description:'bot blocked'})});
    assert.equal((await telegram.sendMessage('test')).success,false);
    assert.equal(telegram.getRecentLogs()[0].status,'FAILED');
    globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,result:{message_id:1}})});
    cloud.client=database();
    await activation.createActivationRequest({hardwareFingerprint:'HWID-BOT-12345'});
    const callback={callback_query:{id:'test',data:'approve_1',message:{chat:{id:999}}}};
    assert.equal((await telegram.handleWebhookUpdate(callback,activation)).handled,false);
    callback.callback_query.message.chat.id=123;
    assert.equal((await telegram.handleWebhookUpdate(callback,activation)).handled,true);
    assert.equal((await activation.getActivationStatus('HWID-BOT-12345')).status,'APPROVED');
    assert.equal((await api('/api/telegram/webhook','POST',callback,false)).status,403);
  } finally { globalThis.fetch=original;telegram.botToken='MOCK_TEST'; }
});
test('local SQLite key activation respects original license and rejects hardware takeover',async()=>{
  const { initDatabase, db }=await import('../src/db/connection.js');initDatabase();
  const { TelemetryService }=await import('../src/db/telemetryService.js');
  const { ActivationService }=await import('../src/services/activationService.js');
  const club=TelemetryService.registerClub({name:'Local Test',licenseDays:365,totalWorkstations:28});
  const active=await ActivationService.activateByKey({licenseKey:club.api_secret_token,hardwareFingerprint:'HWID-LOCAL-12345',totalPcs:16});
  assert.equal(active.signedLicense.payload.maxPcs,28);
  assert.equal(active.signedLicense.payload.expiresAt,club.license_expires_at);
  assert.equal(ActivationService.getActivationStatus('HWID-LOCAL-12345').status,'APPROVED');
  await assert.rejects(()=>ActivationService.activateByKey({licenseKey:club.api_secret_token,hardwareFingerprint:'HWID-LOCAL-OTHER'}),/boshqa/);
  db.close();
});
test('Vercel rejects unauthenticated telemetry and invalid license proof',async()=>{
  cloud.client=database();
  assert.equal((await api('/api/telemetry/heartbeat','POST',{clubId:1,todayRevenue:99999},false)).status,401);
  assert.equal((await api('/api/telemetry/heartbeat','POST',{clubId:1,signedLicense:{payload:{clubId:1},signature:'bad'}},false)).status,401);
});
test('root and standalone cloud use identical licensing implementations',()=>{
  for(const file of ['api/index.js','src/services/cloudActivationService.js','src/services/activationService.js','src/services/telegramBot.js','src/services/supabaseClient.js'])
    assert.equal(readFileSync(file,'utf8'),readFileSync('SoftechCloudAdmin/'+file,'utf8'),file);
});
