import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
function fn(name){let a=html.indexOf('    function '+name+'(');if(a<0)a=html.indexOf('    async function '+name+'(');assert.ok(a>=0,name);return html.slice(a,html.indexOf('\n    }',a)+6);}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://booking.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));await page.goto('http://booking.test/');
 await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
 await page.evaluate(()=>{const booking=document.getElementById('view-bookings'),modal=document.getElementById('startSessionModal');document.body.replaceChildren(booking,modal);booking.classList.remove('hidden');});
 await page.addStyleTag({content:'.hidden{display:none!important}dialog{max-height:95vh;overflow:auto}button{min-height:22px}'});await page.addStyleTag({path:'NetCafeServer/public/booking-ui.css'});
 await page.evaluate(()=>{
  const now=Date.now();window.row={id:1,revision:1,computerRef:'a',customerName:'Booking <test>',startTime:new Date(now-60000).toISOString(),endTime:new Date(now+3600000).toISOString(),noShowAt:new Date(now+540000).toISOString(),status:'CONFIRMED',paymentKind:'CASH',funds:{source:{amount:3000},cashRefundPending:0},computerName:'PC-01'};
  Object.assign(window,{authToken:'test',currentUser:{id:1,clubId:1,role:'administrator',permissions:['session:manage']},computersData:[{id:'a',pcNumber:1,name:'PC-01',currentRate:10000},{id:'b',pcNumber:2,name:'PC-02',currentRate:10000}],currentStartMode:'hours',currentDurationInputUnit:'hours',selectedCustomer:null,targetSelectedPcIds:[],priceCalculationRevision:0,calcDebounceTimer:null,clubSettingsData:{vip_enabled:true},calls:[],showToast:(...x)=>calls.push({toast:x}),fetchData(){},clearMultiSelect(){},updateVipUiState(){},setDurationInputUnit(v){currentDurationInputUnit=v;},setStartQuotePending(){}});
  window.fetch=async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body});let data;
   if(path.startsWith('/api/bookings?'))data={bookings:[row],serverNow:Date.now(),page:{date:row.startTime.slice(0,10),offset:0,limit:100,total:1,hasMore:false},timeZone:'Asia/Tashkent'};
   else if(path.endsWith('check-in-preview'))data={price:10000,durationMinutes:60,depositApplied:3000,additionalPayment:7000,quoteRevision:'quote-'+body.mode,isPostpaid:body.mode==='postpaid'};
   else if(path.endsWith('/check-in')){row.status='ACTIVE';data={success:true,requestId:body.requestId};}
   else if(path==='/api/booking-settings'){if(options.method==='PUT'&&window.loseSettingsReply){window.loseSettingsReply=false;throw Error('network');}data={settings:{graceMinutes:10,revision:1,creationEnabled:false}};}
   else if(path==='/api/admin/users')data=[{id:4,username:'Member',role:'client',balance:20000}];
   else if(path==='/api/bookings'&&options.method==='POST'){if(window.loseReply){window.loseReply=false;throw Error('network');}data={success:true,requestId:body.requestId};}
   else throw Error('Unexpected '+path);
   return {ok:true,status:200,json:async()=>data};};
 });
 for(const name of ['openStartModal','setStartMode','calcFromHours','calcFromPrice','calcFromEndTime','calcClientHours','closeModal','handleStartSession'])await page.addScriptTag({content:fn(name)});
 await page.addScriptTag({path:'NetCafeServer/public/money-requests.js'});await page.addScriptTag({path:'NetCafeServer/public/booking-ui.js'});
 await page.evaluate(()=>BookingUI.load());
 // Main PC action must not depend on a historical day/filter/page in Booking UI.
 await page.evaluate(async()=>{computersData[0].upcomingBooking={id:1,isCurrent:true};const d=document.getElementById('bookingDate');d.value='2020-01-01';d.dispatchEvent(new Event('change'));await startSessionFromBookingDirect('a');});
 await page.waitForFunction(()=>!document.getElementById('btnSubmitStart').disabled&&document.getElementById('bookingQuote')?.textContent.includes('7'));
 assert.equal(await page.evaluate(()=>currentStartMode),'endtime');assert.match(await page.locator('#bookingQuote').innerText(),/3.*000/);
 await page.locator('#bookingWorkspace').screenshot({path:'.test-output/booking-desktop.png'});
 for(const mode of ['hours','price','postpaid','client','endtime']){await page.evaluate(mode=>{if(mode==='client')selectedCustomer={id:4};setStartMode(mode);},mode);await page.waitForFunction(mode=>calls.some(c=>c.path?.endsWith('check-in-preview')&&c.body.mode===mode),mode);}
 await page.waitForFunction(()=>!document.getElementById('btnSubmitStart').disabled);await page.evaluate(()=>handleStartSession({preventDefault(){}}));
 assert.equal(await page.evaluate(()=>BookingUI.active),false);assert.equal(await page.evaluate(()=>calls.filter(c=>c.path?.endsWith('/check-in')).length),1);
 const started=await page.evaluate(()=>calls.find(c=>c.path?.endsWith('/check-in')).body);assert.equal(started.expectedRevision,1);assert.equal(started.quoteRevision,'quote-endtime');assert.ok(started.requestId);
 // Reopening the ordinary modal must not inherit the booking ID or deposit.
 await page.evaluate(()=>{window.calcFromHours=()=>{};openStartModal('b','PC-02');});assert.equal(await page.evaluate(()=>BookingUI.active),false);await page.evaluate(()=>closeModal('startSessionModal'));
 await page.locator('#bookingCreate').click();await page.locator('#bookingDialog [name=customerName]').fill('Test');await page.locator('#bookingDialog [name=kind]').selectOption('CASH');await page.locator('#bookingDialog [name=amount]').fill('4000');
 await page.evaluate(()=>window.loseReply=true);await page.locator('#bookingDialog [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#bookingDialog [role=alert]').textContent.length>0);await page.locator('#bookingDialog [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('bookingDialog').open);
 const creates=await page.evaluate(()=>calls.filter(c=>c.path==='/api/bookings'&&c.body));assert.equal(creates.length,2);assert.equal(creates[0].body.requestId,creates[1].body.requestId);assert.equal(creates[0].body.payment.amount,4000);
 await page.locator('#bookingSettings').click();assert.equal(await page.locator('#bookingDialog [name=enabled]').inputValue(),'0');
 await page.evaluate(()=>window.loseSettingsReply=true);await page.locator('#bookingDialog [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#bookingDialog [role=alert]').textContent.length>0);
 await page.locator('#bookingDialog [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('bookingDialog').open);
 const settingsWrites=await page.evaluate(()=>calls.filter(c=>c.path==='/api/booking-settings'&&c.body));assert.equal(settingsWrites.length,2);assert.equal(settingsWrites[0].body.creationEnabled,false);assert.equal(settingsWrites[0].body.requestId,settingsWrites[1].body.requestId);
 assert.deepEqual(errors,[]);console.log('PASS desktop booking UI: five modes, deposit/check-in, clean context, pause setting and lost-response retry IDs');

 const mobile=await browser.newPage({viewport:{width:390,height:844}});mobile.on('pageerror',e=>errors.push(e.message));
 await mobile.route('https://mobile.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;if(pathname.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('public/mobile/'+pathname.split('/').at(-1),'utf8')});return route.fulfill({contentType:'text/html',body:'<div id="content"></div><dialog id="dialog"><form id="actionForm"></form></dialog>'});});await mobile.goto('https://mobile.test/');
 await mobile.evaluate(async()=>{
  const {createOperatorTools}=await import('/operator-tools.js');window.calls=[];window.state={pcs:[{id:'a',pcNumber:1,name:'PC-01',isOnline:true}],meta:{serverOnline:true}};
  window.booking={id:1,revision:2,computerRef:'a',customerName:'Test',startTime:'2030-01-01T17:00:00Z',endTime:'2030-01-01T19:30:00Z',noShowAt:'2030-01-01T18:10:00Z',status:'CONFIRMED',timeZone:'Asia/Tashkent',paymentKind:'BALANCE',userId:4,funds:{source:{amount:3000}}};
  window.modal=(title,markup,action)=>{const f=document.getElementById('actionForm');f.innerHTML=markup+'<p id="dialogError"></p><button id="actionSubmit" type="submit">OK</button>';f.onsubmit=async e=>{e.preventDefault();try{await action(Object.fromEntries(new FormData(f)));document.getElementById('dialog').close();}catch(error){document.getElementById('dialogError').textContent=error.message;}};document.getElementById('dialog').showModal();};
  window.remote=async(path,method='GET',body)=>{calls.push({path,body});if(path.startsWith('/api/bookings?'))return {bookings:[booking],serverNow:Date.parse('2030-01-01T18:00Z'),timeZone:'Asia/Tashkent',page:{date:'2030-01-01',offset:0,limit:100,total:1}};if(path.endsWith('check-in-preview'))return {price:10000,depositApplied:3000,additionalPayment:7000,durationMinutes:60,currentRate:10000,quoteRevision:'q'};if(path.endsWith('/check-in'))return {success:true};throw Error(path);};
  window.tools=createOperatorTools({state,remote,modal,esc:s=>String(s??'').replace(/</g,'&lt;'),money:n=>n+' UZS',notice:e=>{throw Error(e);},can:()=>true,refresh:()=>{}});
  await tools.startSession(state.pcs[0],booking);
 });
 await mobile.waitForFunction(()=>!document.getElementById('actionSubmit').disabled);
 await mobile.addStyleTag({path:'public/mobile/style.css'});await mobile.locator('#dialog').screenshot({path:'.test-output/booking-mobile.png'});
 assert.equal(await mobile.locator('[name=endTime]').inputValue(),'00:30');assert.equal(await mobile.locator('[name=endDate]').inputValue(),'2030-01-02');
 await mobile.locator('[name=paymentType]').selectOption('BALANCE');await mobile.waitForFunction(()=>!document.getElementById('actionSubmit').disabled);
 assert.equal(await mobile.locator('[name=customerId]').isDisabled(),true);await mobile.locator('#actionSubmit').click();
 const startedMobile=await mobile.evaluate(()=>calls.find(c=>c.path.endsWith('/check-in')).body);assert.equal(startedMobile.targetEndTime,'2030-01-01T19:30:00.000Z');assert.equal(startedMobile.customerId,4);assert.equal(startedMobile.paymentType,'BALANCE');assert.equal(startedMobile.expectedRevision,2);assert.equal(startedMobile.quoteRevision,'q');assert.ok(startedMobile.requestId);
 await mobile.evaluate(()=>tools.renderMenu());await mobile.locator('[data-operation=bookings]').click();await mobile.locator('[data-arrive="1"]').waitFor();assert.equal(await mobile.locator('[data-arrive="1"]').isEnabled(),true);await mobile.locator('[data-arrive="1"]').click();await mobile.locator('[name=mode]').selectOption('price');await mobile.locator('[name=amount]').fill('18000');await mobile.waitForFunction(()=>calls.some(c=>c.body?.amount===18000));
 assert.equal(await mobile.locator('[name=amount]').getAttribute('inputmode'),'numeric');assert.deepEqual(errors,[]);console.log('PASS mobile booking UI: server timezone at midnight, bound wallet owner, existing session modal, amount input and preview/check-in route');
}finally{await browser.close();}
