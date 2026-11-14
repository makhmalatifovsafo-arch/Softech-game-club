import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
 await page.addScriptTag({path:'NetCafeServer/public/room-pricing.js'});
 await page.evaluate(()=>{
  // Test fixture only: use the real settings markup and editor, without a club database.
  const root=document.getElementById('roomPricingSettings'),general=document.getElementById('generalTariffSettings');
  document.body.replaceChildren(root,general);
  window.rooms=[{id:1,name:'Asosiy zal',currentRate:12000,currentRateName:'Kunlik',tariffs:[{id:'room-1',name:'Kunlik',type:'HOURLY',is_active:1,price_per_hour:12000,start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5]}]},
    {id:2,name:'VIP',currentRate:20000,tariffs:[{id:'room-2',name:'VIP',type:'HOURLY',price_per_hour:20000,start_time:'00:00',end_time:'00:00'}]}];
  window.writes=[];window.fetch=async(path,options)=>{
   if(path==='/api/admin/tariffs') {const body=JSON.parse(options.body);writes.push(body);const t=body.tariffs[0];const room=rooms.find(r=>r.tariffs.some(x=>x.id===t.id));Object.assign(room.tariffs.find(x=>x.id===t.id),t);room.currentRate=t.price_per_hour;return {ok:true,json:async()=>({success:true})};}
   if(path==='/api/zones')return {ok:true,json:async()=>({zones:structuredClone(rooms)})};
   throw Error('Unexpected '+path);
  };
 });
 await page.evaluate(()=>SoftechRoomPricing.load({token:'fixture',preferredZoneId:1}));
 assert.equal(await page.locator('#pricingRoom').inputValue(),'1');assert.equal(await page.locator('#generalTariffSettings').isVisible(),true);
 await page.locator('[data-edit-room-rate]').click();await page.locator('dialog [name=name]').fill('Tungi tarif');await page.locator('dialog [name=start]').fill('22:00');await page.locator('dialog [name=end]').fill('06:00');await page.locator('dialog [name=price]').fill('7000');await page.locator('dialog [name=days]').nth(0).uncheck();await page.locator('dialog [type=submit]').click();
 await page.waitForFunction(()=>writes.length===1);
 assert.deepEqual(await page.evaluate(()=>writes),[{tariffs:[{id:'room-1',name:'Tungi tarif',price_per_hour:7000,start_time:'22:00',end_time:'06:00',days_of_week:[2,3,4,5]}]}]);
 assert.match(await page.locator('#roomPricingRows').innerText(),/7.?000/);
 await page.locator('#pricingRoom').selectOption('2');assert.match(await page.locator('#roomPricingRows').innerText(),/20.?000/);
 await page.evaluate(()=>SoftechRoomPricing.load({token:'fixture',preferredZoneId:2}));assert.equal(await page.locator('#pricingRoom').inputValue(),'2');
 await page.evaluate(()=>{window.fetch=async()=>{throw Error('Fixture offline');};});
 await page.evaluate(()=>SoftechRoomPricing.load({token:'fixture'}));
 assert.equal(await page.locator('[data-edit-room-rate]').count(),0);assert.equal(await page.locator('#generalTariffSettings').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS full room tariff editing, exact tariff-ID update, other-room isolation and resilient general schedule UI');
}finally{await browser.close();}
