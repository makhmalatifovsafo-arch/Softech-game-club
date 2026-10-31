import assert from 'node:assert/strict';import {makeRequest,open} from '../public/mobile/crypto.js';
export async function checkMobileFlow({cloudUrl,localUrl,clubId,ownerToken,reconnect}){
 async function cloud(route,body){const r=await fetch(cloudUrl+'/api/mobile/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 let c;for(let i=0;i<100;i++){c=await cloud('connection?club='+clubId);if(c.status===200)break;await new Promise(r=>setTimeout(r,100));}assert.equal(c.status,200,JSON.stringify(c));
 async function mobile(path,method='GET',body,token){const p=await makeRequest(c.body.publicKey,clubId,{path,method,body,token});assert.equal((await cloud('request',p.job)).status,200);assert.equal((await cloud('request',p.job)).status,200,'same request retry must be accepted');assert.equal((await cloud('result',{id:p.job.id,receipt:'wrong'})).status,404);for(let i=0;i<250;i++){const r=await cloud('result',p.job);if(r.body.state==='DONE')return open(p.key,r.body.result,p.aad+':reply');await new Promise(r=>setTimeout(r,40));}throw Error('Mobile timeout '+path);}
 const login=await mobile('/api/auth/login','POST',{username:'manager',password:'central-owner-password'});assert.equal(login.status,200,JSON.stringify(login));const token=login.body.token;
 const pcs=await mobile('/api/computers','GET',undefined,token);assert.equal(pcs.status,200);const pc=pcs.body[0];assert.ok(pc);
 const cashier=await mobile('/api/auth/login','POST',{username:'shift_admin',password:'cashier-operating-password'});assert.equal(cashier.status,200);const cashierToken=cashier.body.token;
 assert.equal((await mobile('/api/reports/financial','GET',undefined,cashierToken)).status,403);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown'},cashierToken)).status,403);
 const changed=await fetch(localUrl+'/api/admin/users/'+cashier.body.user.id+'/permissions',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ownerToken},body:JSON.stringify({permissions:[...cashier.body.user.permissions,'computers:manage']})});assert.equal(changed.status,200);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'lock'},cashierToken)).status,200,'Freshly granted power permission must work without relogin');
 await fetch(localUrl+'/api/admin/users/'+cashier.body.user.id+'/permissions',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ownerToken},body:JSON.stringify({permissions:cashier.body.user.permissions})});
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'lock'},cashierToken)).status,403,'Revoked permission must apply immediately');
 const started=await mobile('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:20,paymentType:'CASH',customerName:'Mobile test'},cashierToken);assert.equal(started.status,201,JSON.stringify(started));
 const warning=await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown'},token);assert.equal(warning.status,409);assert.equal(warning.body.code,'ACTIVE_SESSION_CONFIRMATION_REQUIRED');assert.equal(warning.body.session.sessionId,started.body.sessionId);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown',sessionDecision:'close',sessionId:'stale-id'},token)).status,409);
 const kept=await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown',sessionDecision:'keep',sessionId:started.body.sessionId},token);assert.equal(kept.status,200,JSON.stringify(kept));assert.equal(kept.body.settlement,null);
 const stillActive=await mobile('/api/computers','GET',undefined,token);assert.equal(stillActive.body.find(x=>x.id===pc.id).activeSession.sessionId,started.body.sessionId);
 if(reconnect){const restored=await reconnect();assert.equal(restored.sessionId,started.body.sessionId,'Reconnect must restore the preserved session');}

 const extra=await mobile('/api/sessions/'+started.body.sessionId+'/extend','POST',{additionalMinutes:10,paymentType:'CARD'},cashierToken);assert.equal(extra.status,200,JSON.stringify(extra));
 const ended=await mobile('/api/sessions/'+started.body.sessionId+'/stop-early','POST',{paymentType:'CASH'},cashierToken);assert.equal(ended.status,200,JSON.stringify(ended));
 const again=await mobile('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:20,paymentType:'CASH'},cashierToken);assert.equal(again.status,201);
 const closed=await mobile('/api/computers/'+pc.id+'/power','POST',{action:'reboot',sessionDecision:'close',sessionId:again.body.sessionId,paymentMethod:'CARD'},token);assert.equal(closed.status,200,JSON.stringify(closed));assert.equal(closed.body.settlement.sessionId,again.body.sessionId);
 const afterClose=await mobile('/api/computers','GET',undefined,token);assert.equal(afterClose.body.find(x=>x.id===pc.id).activeSession,null);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'reboot',sessionDecision:'close',sessionId:again.body.sessionId},token)).status,409);
 const items=await mobile('/api/bar/items','GET',undefined,cashierToken);const item=(items.body.items||items.body).find(i=>i.stockQuantity>0);assert.ok(item);
 const sold=await mobile('/api/bar/orders','POST',{items:[{barItemId:item.id,quantity:1}],paymentMethod:'CARD'},cashierToken);assert.equal(sold.status,201,JSON.stringify(sold));
 const after=await mobile('/api/bar/items','GET',undefined,cashierToken);assert.equal((after.body.items||after.body).find(i=>i.id===item.id).stockQuantity,item.stockQuantity-1,'Retries must not sell twice');
 const report=await mobile('/api/reports/financial','GET',undefined,token);assert.equal(report.status,200,JSON.stringify(report));const direct=await(await fetch(localUrl+'/api/reports/financial',{headers:{Authorization:'Bearer '+ownerToken}})).json();assert.deepEqual(report.body.breakdown,direct.breakdown,'Mobile and server financial ledger must match exactly');assert.deepEqual(report.body.summary,direct.summary);assert.deepEqual(report.body.shifts,direct.shifts);
 assert.equal((await mobile('/api/admin/users','GET',undefined,token)).status,403);
 assert.equal((await mobile('/api/auth/logout','POST',{},token)).status,200);assert.equal((await mobile('/api/computers','GET',undefined,token)).status,401);
 console.log('PASS real mobile relay: login, RBAC, session start/extend/refund, bar sale, duplicate retry, power safety, exact server report parity and logout');
}