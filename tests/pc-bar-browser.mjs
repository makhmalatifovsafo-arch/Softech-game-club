import { chromium } from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync('NetCafeServer/public/app.js','utf8');
const code = source.slice(source.indexOf('async function openPcBarOrder('),source.indexOf('async function submitBarOrder('));
const browser = await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage();
 await page.setContent('<html><body></body></html>');
 await page.addScriptTag({content:`
 const computersData=[{id:'pc_uuid_42',name:'PC-7',activeSession:{sessionId:'session-original'}}];
 const authToken='fixture';const calls=[];let failure=false;
 function showToast(){} async function fetchData(){} async function loadBarProducts(){} async function loadBarOrders(){}
 async function fetch(url,options){
  if(options?.method==='POST'){calls.push(JSON.parse(options.body));return {ok:!failure,json:async()=>failure?{error:'Seans almashgan'}:{order:{totalAmount:10000}}};}
  return {ok:true,json:async()=>({items:[{id:1,name:'Cola',sellPrice:5000,stockQuantity:3},{id:2,name:'Tugagan',sellPrice:1,stockQuantity:0}]})};
 }
 ${code}`});
 await page.evaluate(()=>openPcBarOrder('pc_uuid_42'));
 assert.equal(await page.locator('input[type=number]').count(),1);
 await page.getByLabel('Cola miqdori').fill('2');
 assert.match(await page.locator('[data-total]').innerText(),/10.*000/);
 await page.locator('[type=search]').fill('yoq');
 assert.equal(await page.getByLabel('Cola miqdori').isVisible(),false);
 await page.locator('[type=search]').fill('Cola');
 await page.locator('[type=submit]').click();
 await page.waitForFunction(()=>!document.getElementById('pcBarOrderDialog'));
 assert.deepEqual(await page.evaluate(()=>calls[0]),{items:[{barItemId:1,quantity:2}],computerId:'pc_uuid_42',sessionId:'session-original',paymentMethod:'ON_PC_SESSION',paymentStatus:'PENDING_AT_CHECKOUT'});
 await page.evaluate(()=>{failure=true;return openPcBarOrder('pc_uuid_42');});
 await page.getByLabel('Cola miqdori').fill('1');
 await page.evaluate(()=>{computersData[0].activeSession.sessionId='replacement';});
 await page.locator('[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('[data-error]').textContent==='Seans almashgan');
 assert.equal(await page.evaluate(()=>calls[1].sessionId),'session-original');
 assert.equal(await page.getByLabel('Cola miqdori').inputValue(),'1');
 console.log('PASS PC bar dialog: product availability, quantity, total, search, session binding, successful close and failure retention');
} finally { await browser.close(); }
