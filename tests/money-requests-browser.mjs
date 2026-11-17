import { chromium } from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const helper=fs.readFileSync('NetCafeServer/public/money-requests.js','utf8');
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
const topup=html.slice(html.indexOf('    async function handleTopupSubmit('),html.indexOf('    async function handleCreateClientAccount('));
const app=fs.readFileSync('NetCafeServer/public/app.js','utf8');
const bar=app.slice(app.indexOf('async function submitBarOrder('),app.indexOf('function renderBarRecentOrders('));
const pageHtml=`<html><head><meta charset="utf-8"></head><body>
<form id="topup" onsubmit="handleTopupSubmit(event)"><select id="topupUserSelect"><option value="2">Test customer</option></select>
<input id="topupAmount" value="10000"><select id="topupMethod"><option value="CASH">Naqd</option></select><button type="submit">Top-up</button></form>
<input type="radio" name="barDirectPayMethod" value="CASH" checked><button id="btnSubmitBarOrder" onclick="submitBarOrder()"><span id="btnSubmitBarOrderText">Bar</span></button>
<p id="message"></p><script>
let currentUser={id:1,clubId:1},authToken='test',barCart=[{id:1,name:'Cola',qty:1,price:5000}],barSaleMode='DIRECT';
async function loadClientsManagement(){} async function fetchData(){} async function loadBarProducts(){} async function loadBarOrders(){}
function showToast(text){document.getElementById('message').textContent=text;}
function clearBarCart(){barCart=[];} function setBarSaleMode(){document.getElementById('btnSubmitBarOrder').disabled=barCart.length===0;}
${helper}
${topup}
${bar}
</script></body></html>`;
const browser=await chromium.launch({headless:true,channel:'msedge'});
let balance=0,stock=10,dropTopup=true,dropBar=true;
const receipts=new Map(),calls=[],alerts=[];
try {
  const page=await browser.newPage();
  page.on('dialog',async dialog=>{alerts.push(dialog.message());await dialog.accept();});
  await page.route('http://money.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(!pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:pageHtml});
    const body=route.request().postDataJSON();calls.push({pathname,body});
    const key=pathname+body.requestId,prior=receipts.get(key);
    let result=prior;
    if(!result){
      if(pathname.endsWith('/topup')){balance+=body.amount;result={requestId:body.requestId,newBalance:balance};}
      else {stock--;result={requestId:body.requestId,order:{id:receipts.size+1,totalAmount:5000,orderNumber:'test'}};}
      receipts.set(key,result);
    }
    if(pathname.endsWith('/topup')&&dropTopup){dropTopup=false;return route.abort();}
    if(pathname.endsWith('/orders')&&dropBar){dropBar=false;return route.abort();}
    return route.fulfill({status:pathname.endsWith('/topup')?200:201,contentType:'application/json',body:JSON.stringify({...result,replayed:!!prior})});
  });
  await page.goto('http://money.test/');
  await page.locator('#topup button').click();
  await page.waitForFunction(()=>document.querySelector('#topup').dataset.pending==='false');
  assert.equal(balance,10000);assert.match(alerts.at(-1),/Javob olinmadi/);
  await page.reload();
  await page.locator('#topup button').click();
  await page.waitForFunction(()=>document.querySelector('#topup').dataset.pending==='false');
  assert.equal(balance,10000);assert.equal(calls[0].body.requestId,calls[1].body.requestId);
  assert.match(alerts.at(-1),/ikkinchi marta pul qo‘shilmadi/);
  assert.equal(await page.locator('#topupAmount').inputValue(),'','A confirmed payment requires a fresh amount for the next payment');
  balance=0;
  await page.locator('#topupAmount').fill('10000');
  await page.evaluate(()=>{const form=document.querySelector('#topup');form.requestSubmit();form.requestSubmit();});
  await page.waitForFunction(()=>document.querySelector('#topup').dataset.pending==='false');
  assert.equal(balance,10000);assert.equal(calls.length,3);assert.notEqual(calls[1].body.requestId,calls[2].body.requestId);
  await page.locator('#btnSubmitBarOrder').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Javob olinmadi'));
  assert.equal(stock,9);
  await page.reload();
  await page.locator('#btnSubmitBarOrder').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Savdo qabul qilindi'));
  assert.equal(stock,9);assert.equal(calls[3].body.requestId,calls[4].body.requestId);
  await page.evaluate(()=>{barCart=[{id:1,name:'Cola',qty:1,price:5000}];setBarSaleMode();});
  await page.locator('#btnSubmitBarOrder').click();
  await page.waitForFunction(()=>document.querySelector('#btnSubmitBarOrder').disabled);
  await page.waitForFunction(()=>barCart.length===0);
  assert.equal(stock,8);assert.notEqual(calls[4].body.requestId,calls[5].body.requestId);
  console.log('PASS real cashier forms: lost replies, reload, double click, spent balance/new top-up, bar stock and new sale');
} finally {await browser.close();}
