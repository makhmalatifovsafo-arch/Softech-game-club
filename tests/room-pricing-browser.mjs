// Real editor and database writer served only on loopback, no production data.
import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {roomTariffState,saveRoomTariffs} from '../NetCafeServer/src/services/roomTariffs.js';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
assert.equal(html.includes('id="generalTariffSettings"'),false);
const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('NetCafeServer/schema.sql','utf8'));
db.exec("ALTER TABLE grid_layout ADD COLUMN zone_id INTEGER; INSERT INTO clubs(id,name,owner_name,phone,expires_at) VALUES(1,'Test','Owner','phone','2099-01-01'); INSERT INTO zones(id,club_id,name) VALUES(1,1,'Asosiy zal'),(2,1,'VIP'); INSERT INTO tariffs(id,club_id,zone_id,name,type,price_per_hour,start_time,end_time) VALUES('day',1,1,'Kunlik','HOURLY',12000,'00:00','00:00'),('vip',1,2,'VIP','HOURLY',20000,'00:00','00:00');");
const writes=[];let fail=false,delay=0;
const server=createServer(async(req,res)=>{
 const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 if(req.url.startsWith('/api/')){
  if(req.headers.authorization!=='Bearer fixture')return json(403,{error:'Denied'});
  if(fail)return json(503,{error:'Fixture offline'});
  if(req.url==='/api/zones')return json(200,{zones:db.prepare('SELECT * FROM zones').all()});
  const id=Number(req.url.match(/^\/api\/zones\/(\d+)\/tariffs$/)?.[1]);
  if(!id)return json(404,{error:'Unknown route'});
  try{
   if(req.method==='PUT'){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push(body);
    const result=saveRoomTariffs(db,1,id,body);if(delay)await new Promise(r=>setTimeout(r,delay));return json(200,result);
   }
   return json(200,roomTariffState(db,1,id));
  }catch(error){return json(error.statusCode||400,{error:error.message});}
 }
 if(req.url==='/room-pricing.js'||req.url==='/room-pricing.css'){
  res.setHeader('Content-Type',req.url.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync('NetCafeServer/public'+req.url));return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end('<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#09090b;font-family:Arial}main{max-width:850px;margin:auto}</style><link rel="stylesheet" href="/room-pricing.css"><main><div id="roomPricingSettings"></div></main><script src="/room-pricing.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 const load=()=>page.evaluate(()=>SoftechRoomPricing.load({token:'fixture',preferredZoneId:1}));
 const saved=()=>page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Saqlandi.'));
 await load();assert.equal(await page.locator('#pricingRoom').inputValue(),'1');
 await page.locator('[name=name]').fill('Kunlik <img src=x>');
 await page.locator('[name=price_per_hour]').fill('7000');
 await page.locator('[name=is_vip_postpaid_allowed]').uncheck();
 await page.locator('#pricingRoom').selectOption('2');await page.locator('[name=price_per_hour]').waitFor();
 assert.equal(await page.locator('[name=price_per_hour]').inputValue(),'20000');
 await page.locator('#pricingRoom').selectOption('1');assert.equal(await page.locator('[name=price_per_hour]').inputValue(),'7000','draft survives room switch');
 await load();assert.equal(await page.locator('[name=price_per_hour]').inputValue(),'7000','refresh cannot overwrite typed prices');
 delay=250;await page.locator('[data-save]').click();assert.equal(await page.locator('#pricingRoom').isDisabled(),true);await saved();delay=0;
 assert.equal(writes.length,1);assert.equal(writes[0].tariffs[0].price_per_hour,7000);assert.equal(roomTariffState(db,1,2).tariffs[0].price_per_hour,20000);
 assert.equal(await page.locator('#roomPricingSettings img').count(),0);
 await page.locator('[name=end_time]').fill('1800');assert.equal(await page.locator('[name=end_time]').inputValue(),'18:00');
 await page.locator('[name=day][value="1"]').uncheck();
 await page.locator('[data-add]').click();
 const second=page.locator('[data-rate="1"]');await second.locator('[name=start_time]').fill('18:00');await second.locator('[name=price_per_hour]').fill('10000');
 await page.locator('[data-save]').click();await saved();assert.deepEqual(JSON.parse(roomTariffState(db,1,1).tariffs.find(t=>t.price_per_hour===7000).days_of_week),[2,3,4,5,6,7]);
 assert.equal(roomTariffState(db,1,1).tariffs.find(t=>t.price_per_hour===7000).is_vip_postpaid_allowed,0);
 // Overlapping interval is blocked before a write; deletion is a draft until Save.
 const before=writes.length;await page.locator('[data-add]').click();await page.locator('[data-rate="2"] [name=price_per_hour]').fill('9000');await page.locator('[data-save]').click();
 assert.match(await page.locator('[data-status]').innerText(),/ustma-ust/);assert.equal(writes.length,before);
 await page.locator('[data-remove="2"]').click();await page.locator('[data-remove="1"]').click();assert.equal(roomTariffState(db,1,1).tariffs.length,2);
 await page.locator('[data-save]').click();await saved();assert.equal(roomTariffState(db,1,1).tariffs.length,1);
 // Another window cannot be silently overwritten; server-side error preserves input.
 await page.locator('[name=price_per_hour]').fill('8000');
 const current=roomTariffState(db,1,1);saveRoomTariffs(db,1,1,{revision:current.revision,tariffs:current.tariffs.map(t=>({...t,price_per_hour:9000}))});
 await page.locator('[data-save]').click();await page.getByText('Tariflar boshqa oynada o‘zgargan.',{exact:false}).waitFor();assert.equal(await page.locator('[name=price_per_hour]').inputValue(),'8000');
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-reload]').click();assert.equal(await page.locator('[name=price_per_hour]').inputValue(),'8000');
 page.once('dialog',dialog=>dialog.accept());await page.locator('[data-reload]').click();await page.waitForFunction(()=>document.querySelector('[name=price_per_hour]')?.value==='9000');
 for(const viewport of [{width:1100,height:800},{width:900,height:600},{width:390,height:844}]){
  await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(viewport));
 }
 fs.mkdirSync('.test-output/tariff-ui',{recursive:true});await page.screenshot({path:'.test-output/tariff-ui/room-pricing-mobile.png',fullPage:true});
 await page.setViewportSize({width:1100,height:800});await page.screenshot({path:'.test-output/tariff-ui/room-pricing.png',fullPage:true});
 await page.locator('[data-remove]').click();page.once('dialog',dialog=>dialog.accept());await page.locator('[data-save]').click();await saved();assert.equal(roomTariffState(db,1,1).tariffs.length,0);assert.equal(roomTariffState(db,1,1).inherited,false);
 fail=true;await load();assert.equal(await page.locator('[data-save]').count(),0);assert.match(await page.locator('#roomPricingSettings').innerText(),/Fixture offline/);
 fail=false;await page.getByRole('button',{name:'Qayta urinish'}).click();await page.locator('[data-add]').waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS room tariff UI: exact database saves, weekdays/VIP, interval deletion, room isolation, stale drafts, errors and responsive layout');
}finally{await browser.close();await new Promise(r=>server.close(r));db.close();}
