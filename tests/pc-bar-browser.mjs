import { chromium } from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync('NetCafeServer/public/app.js','utf8');
const code = source.slice(source.indexOf('async function openPcBarOrder('),source.indexOf('async function submitBarOrder('));
const moneyCode=fs.readFileSync('NetCafeServer/public/money-requests.js','utf8');
const browser = await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage();
 await page.setContent('<html><body></body></html>');
 await page.addScriptTag({content:`
 const computersData=[{id:'pc_uuid_42',name:'PC-7',activeSession:{sessionId:'session-original'}}];
 const authToken='fixture';const calls=[];let failure=false;
 function showToast(){} async function fetchData(){} async function loadBarProducts(){} async function loadBarOrders(){}
 async function fetch(url,options){
  if(options?.method==='POST'){const body=JSON.parse(options.body);calls.push(body);return {status:failure?400:201,json:async()=>failure?{error:'Seans almashgan',requestId:body.requestId,operationNotApplied:true}:{requestId:body.requestId,order:{totalAmount:10000}}};}
  return {ok:true,json:async()=>({items:[{id:1,name:'Cola',sellPrice:5000,stockQuantity:3},{id:2,name:'Tugagan',sellPrice:1,stockQuantity:0}]})};
 }
 ${moneyCode}
 const pendingMoney=new Map();
 const money=SoftechMoneyRequests.create({storage:{getItem:k=>pendingMoney.get(k)||null,setItem:(k,v)=>pendingMoney.set(k,v),removeItem:k=>pendingMoney.delete(k)},execute:async(url,body)=>{const r=await fetch(url,{method:'POST',body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}});
 postMoneyOperation=(url,body,summary)=>money.post('fixture',url,body,summary);
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
 const sent=await page.evaluate(()=>calls[0]);assert.match(sent.requestId,/^[a-f0-9]{32}$/);delete sent.requestId;
 assert.deepEqual(sent,{items:[{barItemId:1,quantity:2}],computerId:'pc_uuid_42',sessionId:'session-original',paymentMethod:'ON_PC_SESSION',paymentStatus:'PENDING_AT_CHECKOUT'});
 await page.evaluate(()=>{failure=true;return openPcBarOrder('pc_uuid_42');});
 await page.getByLabel('Cola miqdori').fill('1');
 await page.evaluate(()=>{computersData[0].activeSession.sessionId='replacement';});
 await page.locator('[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('[data-error]').textContent==='Seans almashgan');
 assert.equal(await page.evaluate(()=>calls[1].sessionId),'session-original');
 assert.equal(await page.getByLabel('Cola miqdori').inputValue(),'1');
 console.log('PASS PC bar dialog: product availability, quantity, total, search, session binding, successful close and failure retention');
} finally { await browser.close(); }
