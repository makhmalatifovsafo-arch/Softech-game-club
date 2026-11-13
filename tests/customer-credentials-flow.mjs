import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import {once} from 'node:events';

export async function checkCustomerCredentials({localUrl,token,databasePath}) {
 const api=async(route,method,body,bearer=token)=>{
  const response=await fetch(localUrl+route,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 const db=new DatabaseSync(databasePath);
 // The isolated server also writes heartbeats; wait for its short transactions.
 db.exec("PRAGMA busy_timeout=5000");
 const ws=new WebSocket(localUrl.replace('http','ws')+'/ws');
 const exchange=(type,payload,reply)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.off('message',listen);reject(Error('Timeout '+reply));},5000);
  function listen(raw){const m=JSON.parse(raw);if((m.type||m.event)!==reply)return;clearTimeout(timer);ws.off('message',listen);resolve(m.payload||m);}
  ws.on('message',listen);ws.send(JSON.stringify({type,payload}));
 });
 try {
  const created=await api('/api/admin/users','POST',{username:'account_before',password:'before123',role:'client',balance:50000});
  assert.equal(created.status,201);const userId=created.body.user.id;
  const pc=await api('/api/admin/computers','POST',{name:'Account PC',pcNumber:981});assert.equal(pc.status,201);
  const zone=await api('/api/zones','POST',{name:'Account room',tariffs:[{name:'Account hourly',price_per_hour:10000,start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7]}]});assert.equal(zone.status,201);
  db.prepare('UPDATE computers SET zone_id=? WHERE id=?').run(zone.body.zone.id,pc.body.computer.id);
  if(ws.readyState!==WebSocket.OPEN) await once(ws,'open');
  await exchange('CLIENT_HELLO',{pcNumber:'PC-981'},'CONFIG_UPDATE');
  const login=await exchange('CLIENT_MEMBER_LOGIN',{username:'account_before',password:'before123',durationMinutes:30},'MEMBER_LOGIN_SUCCESS');
  const sessionId=login.sessionId;
  const before=db.prepare('SELECT balance FROM users WHERE id=?').get(userId).balance;
  const sessionBefore=db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  let seq=0;
  const change=payload=>exchange('CLIENT_ACCOUNT_UPDATE',{sessionId,requestId:String(++seq),username:'account_after',currentPassword:'before123',password:'after123',...payload},'CLIENT_ACCOUNT_RESULT');
  assert.equal((await change({sessionId:'other-session'})).success,false);
  assert.equal((await change({currentPassword:'wrong'})).success,false);
  assert.equal((await change({username:'invalid login'})).success,false);
  assert.equal((await change({password:'123'})).success,false);
  const changed=await change({userId:999999});assert.equal(changed.success,true);assert.equal(changed.userId,userId);
  assert.equal(db.prepare('SELECT username FROM users WHERE id=?').get(userId).username,'account_after');
  assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(userId).balance,before);
  const after=db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  for(const key of ['user_id','started_at','ends_at','paid_amount','prepaid_rate_plan'])assert.equal(after[key],sessionBefore[key],key);
  const route='/api/clients/'+userId+'/credentials';
  assert.equal((await api(route,'PUT',{username:'account_staff',password:'staff123'},'invalid')).status,401);
  const staff=await api(route,'PUT',{username:'account_staff',password:'staff123'});assert.equal(staff.status,200);
  assert.equal((await change({currentPassword:'after123'})).success,false,'Reset invalidates old password');
  assert.equal((await change({username:'account_final',currentPassword:'staff123',password:undefined})).success,true,'Login-only change retains password');
  const admin=db.prepare("SELECT id,username FROM users WHERE role='club_owner' LIMIT 1").get();
  assert.equal((await api('/api/clients/'+admin.id+'/credentials','PUT',{username:'hijack',password:'abcd'})).status,404);
  assert.equal((await api(route,'PUT',{username:admin.username,password:'abcd'})).status,409);
  db.prepare("UPDATE sessions SET client_self_service=0 WHERE id=?").run(sessionId);
  assert.equal((await change({currentPassword:'staff123'})).success,false,'Cashier sessions cannot change customer credentials');
  db.prepare("UPDATE sessions SET client_self_service=1 WHERE id=?").run(sessionId);
  await api('/api/sessions/stop','POST',{sessionId,paymentType:'CASH'});
  assert.equal((await change({currentPassword:'staff123'})).success,false,'Ended sessions cannot change credentials');
  const relogin=await exchange('CLIENT_MEMBER_LOGIN',{username:'account_final',password:'staff123',durationMinutes:10},'MEMBER_LOGIN_SUCCESS');
  assert.ok(relogin.sessionId);
  await api('/api/sessions/stop','POST',{sessionId:relogin.sessionId,paymentType:'CASH'});
  console.log('PASS real customer credential changes: WS self-service, staff HTTP reset, identity/balance preservation, permissions and new login');
 } finally {ws.terminate();db.close();}
}
