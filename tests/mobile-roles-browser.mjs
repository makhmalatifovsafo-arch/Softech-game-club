import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import {DatabaseSync} from 'node:sqlite';
import {MobileDashboard,handleMobileDashboard} from '../src/services/mobileDashboard.js';
import {MobileRelay,handleMobileRoute} from '../src/services/mobileRelay.js';
import {MobileAgent} from '../NetCafeServer/src/services/mobileAgent.js';
import {ManagerAccountService} from '../src/services/managerAccountService.js';
import fs from 'node:fs';import http from 'node:http';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const db=new DatabaseSync(':memory:'),local=new DatabaseSync(':memory:');db.exec(`CREATE TABLE clubs(id INTEGER PRIMARY KEY,name TEXT,status TEXT,license_expires_at TEXT,hardware_fingerprint TEXT);INSERT INTO clubs VALUES(1,'Role Test Club','ACTIVE','2099-01-01','ROLE-BROWSER-HWID');CREATE TABLE remote_commands(id INTEGER PRIMARY KEY,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);`);
await new ManagerAccountService({db}).save(1,{username:'manager',password:'1234'});
const admin=await new ManagerAccountService({db,role:'administrator'}).save(1,{username:'cashier',password:'5678'});
const payload={clubId:1,status:'ACTIVE',expiresAt:'2099-01-01',hardwareFingerprint:'ROLE-BROWSER-HWID'},signedLicense={payload,signature:crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest('hex')};
const dashboard=new MobileDashboard({db}),relay=new MobileRelay({db});
const pcs=[{id:'pc_1',pcNumber:1,name:'PC-1',isOnline:true,status:'AVAILABLE',zone:'VIP',currentRate:10000}],items=[{id:1,name:'Cola',sellPrice:10000,buyPrice:6000,stockQuantity:10}];
const report={filter:{from:'2026-11-10',to:'2026-11-10'},summary:{barProfit:4000,barRevenue:10000},breakdown:{total:10000,cash:10000,card:0,receipts:{BAR:{CASH:10000,CARD:0}},rows:[]}};
async function upload(){const capturedAt=new Date().toISOString();await dashboard.upload({signedLicense,entries:[{key:'metadata',capturedAt,data:{serverDate:'2026-11-10',staff:[{role:'administrator',username:'cashier',revision:admin.revision,permissions:['session:manage','customers:view','message:send','computers:manage']}]}},{key:'computers',capturedAt,data:pcs},{key:'bar',capturedAt,data:items},{key:'cash',capturedAt,data:{shift:{id:1,openedAt:'2026-11-10',systemCash:111111,systemCard:222222,expectedCash:333333}}},{key:'report:2026-11-10',capturedAt,data:report}]});}
await upload();const calls=[];
const staff=[{id:5,role:'client',username:'Player',balance:50000},{id:6,role:'administrator',username:'cashier',permissions:['session:manage']}],tariffs=[{id:'zone-rate',zone_id:1,zone_name:'VIP',name:'Daily',type:'HOURLY',price_per_hour:10000,start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7]}];
const agent=new MobileAgent({db:local,getLicense:()=>signedLicense,getCloudUrl:()=>'',isOperational:()=>true,localPort:5000,
 staffSession:token=>({role:token==='manager'?'club_owner':'administrator',clubId:1}),logout(){},resolveCloudSession:async grant=>grant.payload.role==='manager'?'manager':'cashier',onMutation:async()=>{await upload();return true;},
 fetcher:async(url,options={})=>{
  if(url==='/api/mobile/agent')return new Response(JSON.stringify(await relay.poll(JSON.parse(options.body))));
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;calls.push({path:u.pathname,method:options.method,body});let data={success:true};
  if(u.pathname==='/api/admin/users'&&options.method==='GET')data=staff;
  else if(u.pathname==='/api/admin/users'&&options.method==='POST'){const user={id:7,...body};staff.push(user);data={success:true,user};}
  else if(u.pathname==='/api/admin/users/7/permissions'){staff.find(u=>u.id===7).permissions=body.permissions;}
  else if(u.pathname==='/api/admin/users/7'&&options.method==='DELETE'){staff.splice(staff.findIndex(u=>u.id===7),1);}
  else if(u.pathname==='/api/tariffs')data=tariffs;
  else if(u.pathname==='/api/admin/tariffs'){Object.assign(tariffs[0],body.tariffs[0]);}
  else if(u.pathname==='/api/tariff-schedules')data=[];
  else if(u.pathname==='/api/settings')data={settings:{vip_enabled:1,vip_pricing_mode:'SCHEDULE',vip_custom_price:15000}};
  else if(u.pathname==='/api/computers')data=pcs;
  else if(u.pathname==='/api/bar/orders'&&options.method==='POST'){items[0].stockQuantity-=body.items[0].quantity;data={success:true,message:'Savdo saqlandi'};}
  else if(u.pathname==='/api/sessions/start'){pcs[0].activeSession={sessionId:'test-session',remainingSeconds:1800,totalWithBar:5000};data={success:true,message:'Seans ochildi'};}
  else if(u.pathname==='/api/bookings'&&options.method==='GET')data={bookings:[]};
  return new Response(JSON.stringify(data));
 }});
await agent.tick();const timer=setInterval(()=>agent.tick(),70);
const server=http.createServer(async(req,res)=>{try{
 if(await handleMobileDashboard(req,res,{db}))return;if(await handleMobileRoute(req,res,{db}))return;
 const p=new URL(req.url,'http://localhost').pathname;if(p==='/api/version'){res.setHeader('Content-Type','application/json');return res.end('{"version":"1.0.20"}');}
 const file='public'+(p==='/mobile/'?'/mobile/index.html':p);if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));
}catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 console.log('Browser ready');await page.goto('http://127.0.0.1:'+server.address().port+'/mobile/');
 async function login(username,password){await page.locator('[name=club]').fill('1');await page.locator('[name=username]').fill(username);await page.locator('[name=password]').fill(password);await page.locator('#loginForm button').click();await page.locator('#workspace').waitFor({state:'visible'});}
 await login('manager','1234');console.log('Manager signed in');await page.locator('#reportFilter').waitFor();assert.equal(await page.locator('[data-tab=bar]').isVisible(),false);assert.equal(await page.locator('[data-tab=operations]').isVisible(),false);
 await page.locator('[data-tab=computers]').click();await page.locator('.pc-number').waitFor();assert.equal(await page.locator('[data-action]').count(),0);
 await page.locator('[data-tab=cash]').click();await page.getByText('Smenani administrator boshqaradi. Bu sahifa kuzatish uchun.').waitFor();assert.equal(await page.locator('#closeShift').count(),0);
 console.log('Settings test');await page.locator('[data-tab=settings]').click();await page.locator('[data-manager-section=tariffs]').click();await page.locator('[data-edit-tariff]').click();await page.locator('[name=price_per_hour]').fill('14000');await page.locator('[name=start_time]').fill('08:00');await page.locator('#actionSubmit').click();await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('[data-edit-tariff]').waitFor();assert.equal(tariffs[0].price_per_hour,14000);assert.equal(tariffs[0].start_time,'08:00');
 console.log('Tariff saved; staff test');await page.locator('[data-manager-section=staff]').click();await page.locator('#newStaff').click();await page.locator('#dialog [name=username]').fill('newadmin');await page.locator('#dialog [name=password]').fill('1234');await page.locator('#actionSubmit').click();await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('[data-staff-permissions="7"]').click();await page.locator('[name=permission0]').uncheck();await page.locator('[name=permission3]').check();await page.locator('#actionSubmit').click();await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('[data-delete-staff="7"]').waitFor();assert.ok(staff.find(u=>u.id===7).permissions.includes('computers:manage'));assert.ok(!staff.find(u=>u.id===7).permissions.includes('session:manage'));
 await page.screenshot({path:'.test-output/mobile-manager-settings-390.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('[data-delete-staff="7"]').click();await page.locator('#actionSubmit').click();await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('#newStaff').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-delete-staff="7"]'));assert.ok(!staff.some(u=>u.id===7));
 await page.locator('[data-tab=account]').click();await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});
 await login('cashier','5678');await page.locator('[data-action=start]').waitFor();assert.equal(await page.locator('[data-tab=reports]').isVisible(),false);assert.equal(await page.locator('[data-tab=settings]').isVisible(),false);
 await page.locator('[data-tab=cash]').click();await page.locator('#shiftAction').waitFor();assert.equal((await page.locator('#content').textContent()).includes('333333'),false);assert.equal((await page.locator('#content').textContent()).includes('Kutilayotgan naqd'),false);
 await page.locator('[data-tab=bar]').click();await page.locator('[data-quantity="1"]').fill('2');await page.locator('#saleCheckout').click();await page.locator('#dialog').waitFor({state:'visible'});await page.locator('[name=paymentMethod]').selectOption('CARD');await page.locator('#actionSubmit').click();await page.locator('#dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('Qoldiq: 8'));
 const sale=calls.find(c=>c.path==='/api/bar/orders'&&c.method==='POST');assert.deepEqual(sale.body.items,[{barItemId:1,quantity:2}]);assert.equal(sale.body.paymentMethod,'CARD');
 await page.locator('[data-tab=computers]').click();await page.locator('[data-action=start]').click();await page.locator('#dialog').waitFor({state:'visible'});await page.locator('[name=minutes]').fill('30');await page.locator('#actionSubmit').click();await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('[data-action=end]').waitFor();assert.equal(calls.find(c=>c.path==='/api/sessions/start').body.durationMinutes,30);
 await page.locator('[data-tab=operations]').click();await page.locator('[data-operation=bookings]').click();await page.locator('#newBooking').click();await page.locator('[name=customerName]').fill('Booking customer');await page.locator('[name=startTime]').fill('2026-11-11T10:00');await page.locator('[name=endTime]').fill('2026-11-11T11:00');await page.locator('#actionSubmit').click();await page.locator('#dialog').waitFor({state:'hidden'});assert.ok(calls.find(c=>c.path==='/api/bookings'&&c.method==='POST'));
 await page.screenshot({path:'.test-output/mobile-operator-390.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS real mobile UI + encrypted relay: manager tariff/staff controls, cashier menus, hidden totals, multi-item sale body, session start and booking forms');
}finally{clearInterval(timer);await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();local.close();}
