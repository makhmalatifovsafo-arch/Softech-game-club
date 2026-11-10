import assert from 'node:assert/strict';import {makeRequest,open} from '../public/mobile/crypto.js';
export async function checkMobileFlow({cloudUrl,localUrl,clubId,ownerToken,reconnect}){
 async function cloud(route,body){const r=await fetch(cloudUrl+'/api/mobile/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 let c;for(let i=0;i<100;i++){c=await cloud('connection?club='+clubId);if(c.status===200)break;await new Promise(r=>setTimeout(r,100));}assert.equal(c.status,200,JSON.stringify(c));
 async function mobile(path,method='GET',body,token){const p=await makeRequest(c.body.publicKey,clubId,{path,method,body,...(typeof token==='object'?{cloudGrant:token}:{token})});assert.equal((await cloud('request',p.job)).status,200);assert.equal((await cloud('request',p.job)).status,200,'same request retry must be accepted');assert.equal((await cloud('result',{id:p.job.id,receipt:'wrong'})).status,404);for(let i=0;i<250;i++){const r=await cloud('result',p.job);if(r.body.state==='DONE')return open(p.key,r.body.result,p.aad+':reply');await new Promise(r=>setTimeout(r,40));}throw Error('Mobile timeout '+path);}
 const login=await mobile('/api/auth/login','POST',{username:'manager',password:'central-owner-password'});assert.equal(login.status,200,JSON.stringify(login));const token=login.body.token;
 const pcs=await mobile('/api/computers','GET',undefined,token);assert.equal(pcs.status,200);const pc=pcs.body[0];assert.ok(pc);
 const cloudLogin=await cloud('dashboard/login',{clubId,username:'manager',password:'central-owner-password'});assert.equal(cloudLogin.status,200,JSON.stringify(cloudLogin));
 const granted=await mobile('/api/computers/'+pc.id+'/power','POST',{action:'lock'},cloudLogin.body.grant);assert.equal(granted.status,403,JSON.stringify(granted));
 const cloudCashier=await cloud('dashboard/login',{clubId,username:'shift_admin',password:'cashier-operating-password'});assert.equal(cloudCashier.status,200);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'lock'},cloudCashier.body.grant)).status,403,'Cloud grants must preserve local cashier permissions');

 const cashier=await mobile('/api/auth/login','POST',{username:'shift_admin',password:'cashier-operating-password'});assert.equal(cashier.status,200);const cashierToken=cashier.body.token;
 assert.equal((await mobile('/api/reports/financial','GET',undefined,cashierToken)).status,403);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown'},cashierToken)).status,403);
 const changed=await fetch(localUrl+'/api/admin/users/'+cashier.body.user.id+'/permissions',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ownerToken},body:JSON.stringify({permissions:[...cashier.body.user.permissions,'computers:manage']})});assert.equal(changed.status,200);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'lock'},cashierToken)).status,200,'Freshly granted power permission must work without relogin');
 await fetch(localUrl+'/api/admin/users/'+cashier.body.user.id+'/permissions',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ownerToken},body:JSON.stringify({permissions:cashier.body.user.permissions})});
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'lock'},cashierToken)).status,403,'Revoked permission must apply immediately');
 await fetch(localUrl+'/api/admin/users/'+cashier.body.user.id+'/permissions',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ownerToken},body:JSON.stringify({permissions:[...cashier.body.user.permissions,'computers:manage']})});

 const started=await mobile('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:20,paymentType:'CASH',customerName:'Mobile test'},cashierToken);assert.equal(started.status,201,JSON.stringify(started));
 const warning=await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown'},cashierToken);assert.equal(warning.status,409);assert.equal(warning.body.code,'ACTIVE_SESSION_CONFIRMATION_REQUIRED');assert.equal(warning.body.session.sessionId,started.body.sessionId);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown',sessionDecision:'close',sessionId:'stale-id'},cashierToken)).status,409);
 const kept=await mobile('/api/computers/'+pc.id+'/power','POST',{action:'shutdown',sessionDecision:'keep',sessionId:started.body.sessionId},cashierToken);assert.equal(kept.status,200,JSON.stringify(kept));assert.equal(kept.body.settlement,null);
 const stillActive=await mobile('/api/computers','GET',undefined,token);assert.equal(stillActive.body.find(x=>x.id===pc.id).activeSession.sessionId,started.body.sessionId);
 if(reconnect){const restored=await reconnect();assert.equal(restored.sessionId,started.body.sessionId,'Reconnect must restore the preserved session');}

 const extra=await mobile('/api/sessions/'+started.body.sessionId+'/extend','POST',{additionalMinutes:10,paymentType:'CARD'},cashierToken);assert.equal(extra.status,200,JSON.stringify(extra));
 const ended=await mobile('/api/sessions/'+started.body.sessionId+'/stop-early','POST',{paymentType:'CASH'},cashierToken);assert.equal(ended.status,200,JSON.stringify(ended));
 const again=await mobile('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:20,paymentType:'CASH'},cashierToken);assert.equal(again.status,201);
 const closed=await mobile('/api/computers/'+pc.id+'/power','POST',{action:'reboot',sessionDecision:'close',sessionId:again.body.sessionId,paymentMethod:'CARD'},cashierToken);assert.equal(closed.status,200,JSON.stringify(closed));assert.equal(closed.body.settlement.sessionId,again.body.sessionId);
 const afterClose=await mobile('/api/computers','GET',undefined,token);assert.equal(afterClose.body.find(x=>x.id===pc.id).activeSession,null);
 assert.equal((await mobile('/api/computers/'+pc.id+'/power','POST',{action:'reboot',sessionDecision:'close',sessionId:again.body.sessionId},cashierToken)).status,409);
 const items=await mobile('/api/bar/items','GET',undefined,cashierToken);const item=(items.body.items||items.body).find(i=>i.stockQuantity>0);assert.ok(item);
 const sold=await mobile('/api/bar/orders','POST',{items:[{barItemId:item.id,quantity:1}],paymentMethod:'CARD'},cashierToken);assert.equal(sold.status,201,JSON.stringify(sold));
 assert.equal((await mobile('/api/bar/orders','POST',{items:[{barItemId:item.id,quantity:1}],paymentMethod:'CASH'},token)).status,403,'Manager must not sell via mobile');
 assert.equal((await mobile('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:20},token)).status,403,'Manager must not start mobile sessions');
 const desktopSale=await fetch(localUrl+'/api/bar/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cashierToken},body:JSON.stringify({items:[{barItemId:item.id,quantity:1}],paymentMethod:'CASH'})});assert.equal(desktopSale.status,201);
 const invalidBalance=await fetch(localUrl+'/api/bar/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cashierToken},body:JSON.stringify({items:[{barItemId:item.id,quantity:1}],paymentMethod:'CLIENT_BALANCE'})});assert.notEqual(invalidBalance.status,201);
 const cloudReportResponse=await fetch(cloudUrl+'/api/mobile/dashboard/data?resource=reports',{headers:{Authorization:'Bearer '+cloudLogin.body.token}});
 assert.equal(cloudReportResponse.status,200);const cloudReport=await cloudReportResponse.json();
 const localReport=await(await fetch(localUrl+'/api/reports/financial',{headers:{Authorization:'Bearer '+ownerToken}})).json();
 // Desktop writes schedule a sync; wait until both channels' sales have arrived.
 let mirrored=cloudReport;for(let i=0;i<60&&JSON.stringify(mirrored.data.breakdown)!==JSON.stringify(localReport.breakdown);i++){await new Promise(r=>setTimeout(r,100));mirrored=await(await fetch(cloudUrl+'/api/mobile/dashboard/data?resource=reports',{headers:{Authorization:'Bearer '+cloudLogin.body.token}})).json();}
 assert.deepEqual(mirrored.data.breakdown,localReport.breakdown,'Mobile and desktop sales must reach one cloud report, without duplicate retries');
 assert.equal((await mobile('/api/shifts/current','GET',undefined,cashierToken)).body.shift?.systemCash,undefined,'Cashier cannot see aggregate receipts');
 const newBooking=await mobile('/api/bookings','POST',{computerId:pc.id,customerName:'Mobile booking',startTime:new Date(Date.now()+172800000).toISOString(),endTime:new Date(Date.now()+176400000).toISOString()},cashierToken);assert.equal(newBooking.status,201,JSON.stringify(newBooking));
 assert.equal((await mobile('/api/bookings/'+newBooking.body.booking.id+'/status','PUT',{status:'CANCELLED'},cashierToken)).status,200);

 const after=await mobile('/api/bar/items','GET',undefined,cashierToken);assert.equal((after.body.items||after.body).find(i=>i.id===item.id).stockQuantity,item.stockQuantity-2,'Retries must not sell twice');
 const report=await mobile('/api/reports/financial','GET',undefined,token);assert.equal(report.status,200,JSON.stringify(report));const direct=await(await fetch(localUrl+'/api/reports/financial',{headers:{Authorization:'Bearer '+ownerToken}})).json();assert.deepEqual(report.body.breakdown,direct.breakdown,'Mobile and server financial ledger must match exactly');assert.deepEqual(report.body.summary,direct.summary);assert.deepEqual(report.body.shifts,direct.shifts);
 const staff=await mobile('/api/admin/users','GET',undefined,cloudLogin.body.grant);assert.equal(staff.status,200);
 const added=await mobile('/api/admin/users','POST',{username:'mobile_staff_test',password:'1234',role:'administrator',permissions:['session:manage']},cloudLogin.body.grant);assert.equal(added.status,201,JSON.stringify(added));
 assert.equal((await mobile('/api/admin/users/'+added.body.user.id+'/permissions','PUT',{permissions:['message:send']},cashierToken)).status,403);
 assert.equal((await mobile('/api/admin/users/'+added.body.user.id+'/permissions','PUT',{permissions:['message:send']},cloudLogin.body.grant)).status,200);
 const localStaff=await(await fetch(localUrl+'/api/admin/users',{headers:{Authorization:'Bearer '+ownerToken}})).json();assert.deepEqual(localStaff.find(u=>u.id===added.body.user.id).permissions,['message:send']);
 assert.equal((await mobile('/api/admin/users/'+added.body.user.id,'DELETE',undefined,cloudLogin.body.grant)).status,200);
 const rates=await mobile('/api/tariffs','GET',undefined,cloudLogin.body.grant);assert.equal(rates.status,200);const tariff=rates.body[0];assert.ok(tariff);
 assert.equal((await mobile('/api/admin/tariffs','PUT',{tariffs:[{id:tariff.id,name:tariff.name,price_per_hour:12345}]},cashierToken)).status,403);
 const updated=await mobile('/api/admin/tariffs','PUT',{tariffs:[{id:tariff.id,name:tariff.name,price_per_hour:12345,start_time:'09:00',end_time:'19:00',days_of_week:[1,2,3,4,5]}]},cloudLogin.body.grant);assert.equal(updated.status,200,JSON.stringify(updated));
 const directRates=await(await fetch(localUrl+'/api/tariffs',{headers:{Authorization:'Bearer '+ownerToken}})).json();const changedRate=directRates.find(t=>t.id===tariff.id);assert.equal(changedRate.price_per_hour,12345);assert.equal(changedRate.start_time,'09:00');
 const badRates=await mobile('/api/admin/tariffs','PUT',{tariffs:[{id:tariff.id,name:'Should not save',price_per_hour:777},{id:'unknown',name:'Invalid',price_per_hour:100}]},cloudLogin.body.grant);assert.equal(badRates.status,400);
 const afterBad=await mobile('/api/tariffs','GET',undefined,token);assert.equal(afterBad.body.find(t=>t.id===tariff.id).price_per_hour,12345,'Invalid batch must not partially update tariffs');
 const schedule=await mobile('/api/admin/tariff-schedules','POST',{name:'Mobile schedule',start_time:'10:00',end_time:'12:00',price_per_hour:15000,days_of_week:[1,2],priority:2},cloudLogin.body.grant);assert.equal(schedule.status,201,JSON.stringify(schedule));
 assert.equal((await mobile('/api/admin/tariff-schedules/'+schedule.body.id,'DELETE',undefined,cloudLogin.body.grant)).status,200);
 assert.equal((await mobile('/api/admin/settings','PUT',{vip_enabled:true,vip_pricing_mode:'CUSTOM',vip_custom_price:19000},cloudLogin.body.grant)).status,200);
 assert.equal((await mobile('/api/settings','GET',undefined,token)).body.settings.vip_custom_price,19000);
 // User scenario: change the PC room's rate from mobile, then start on desktop.
 async function desktop(path,method='GET',body){const response=await fetch(localUrl+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+ownerToken},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
 const room=await desktop('/api/zones','POST',{name:'Mobile tariff parity',tariffs:[{name:'Room hourly',price_per_hour:23000,start_time:'00:00',end_time:'23:59',days_of_week:[1,2,3,4,5,6,7]}]});assert.equal(room.status,201,JSON.stringify(room));
 assert.equal((await desktop('/api/admin/computers/'+pc.id,'PUT',{zoneId:room.body.zone.id,zone:'STANDARD'})).status,200);
 const roomRate=room.body.tariffs[0];
 assert.equal((await mobile('/api/admin/tariffs','PUT',{tariffs:[{id:roomRate.id,name:roomRate.name,price_per_hour:10000}]},cloudLogin.body.grant)).status,200);
 const desktopRoom=await desktop('/api/zones/'+room.body.zone.id+'/tariffs');assert.equal(desktopRoom.body.tariffs[0].price_per_hour,10000,'Desktop manager must see the mobile price');
 const quote=await desktop('/api/tariffs/calculate','POST',{computerId:pc.id,durationHours:1});assert.equal(quote.body.price,10000,JSON.stringify(quote));assert.equal(quote.body.currentRate,10000);
 const hour=await desktop('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:60,amount:23000,paymentType:'CASH'});assert.equal(hour.status,201,JSON.stringify(hour));assert.equal(hour.body.amount,10000,'Desktop one-hour session must charge the new mobile rate, even with a stale UI quote');
 assert.equal((await desktop('/api/sessions/'+hour.body.sessionId+'/stop-early','POST',{paymentType:'CASH'})).status,200);
 console.log('PASS mobile tariff 10000 -> desktop manager rate 10000 -> desktop quote 10000 -> one-hour session charged 10000');
 assert.equal((await mobile('/api/auth/logout','POST',{},token)).status,200);assert.equal((await mobile('/api/computers','GET',undefined,token)).status,401);
 console.log('PASS real mobile relay: login, RBAC, session start/extend/refund, bar sale, duplicate retry, power safety, exact server report parity and logout');
}
