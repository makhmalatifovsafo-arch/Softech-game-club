import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
const quote={sessionId:'s1',fromComputerId:'pc2',toComputerId:'pc3',oldRate:7000,newRate:14000,oldRemainingSeconds:1800,newRemainingSeconds:900,remainingAmount:3500,isPostpaid:false,quoteRevision:'fixture-review'};
const pcs=[{id:'pc2',name:'PC-02',isOnline:true,status:'OCCUPIED',activeSession:{sessionId:'s1',remainingSeconds:1800,customerName:'Mijoz'}},{id:'pc3',name:'PC-03',isOnline:true,status:'AVAILABLE'}];
fs.mkdirSync('.test-output',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
 await page.addScriptTag({path:'NetCafeServer/public/vendor/tailwind-3.4.17.js'});
 await page.addStyleTag({path:'NetCafeServer/public/style.css'});
 const source=html.slice(html.indexOf('    let transferQuote = null;'),html.indexOf('    // 8. MASOFAVIY'));
 const duration=html.slice(html.indexOf('    function quoteDurationLabel'),html.indexOf('    async function fetchStartQuote'));
 await page.addScriptTag({content:`let authToken='fixture',computersData=${JSON.stringify(pcs)},selectedTransferTargetPcId=null;
   window.fixtureQuote=${JSON.stringify(quote)};window.requests=[];window.failQuote=false;
   const computerState=pc=>({online:pc.isOnline});const formatTime=seconds=>Math.floor(seconds/60)+' daqiqa';
   const closeModal=id=>document.getElementById(id).classList.add('hidden');const fetchData=()=>{};window.alert=()=>{};
   window.fetch=async(url,options={})=>{if(options.method==='POST'){requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({remainingSeconds:900,destinationOnline:true})};}
     return {ok:!failQuote,json:async()=>failQuote?{error:'Tarif belgilanmagan'}:fixtureQuote};};
   ${duration}\n${source}`});
 await page.evaluate(()=>openTransferModal('pc2'));
 await page.waitForFunction(()=>!document.getElementById('btnSubmitTransfer').disabled);
 const panel=page.locator('#transferCalculation');
 assert.match(await panel.innerText(),/30 daqiqa/);assert.match(await panel.innerText(),/15 daqiqa/);
 assert.equal(await panel.locator('[style*="line-through"]').evaluate(el=>getComputedStyle(el).textDecorationLine),'line-through');
 assert.ok(await panel.locator('strong').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>=28);
 await page.locator('#transferModal > div').screenshot({path:'.test-output/transfer-desktop.png'});
 await page.locator('#btnSubmitTransfer').click();assert.equal((await page.evaluate(()=>requests[0])).quoteRevision,quote.quoteRevision);
 await page.evaluate(()=>{fixtureQuote={...fixtureQuote,isPostpaid:true,carriedAmount:5320};openTransferModal('pc2');});
 await page.waitForFunction(()=>document.getElementById('transferCalculation').textContent.includes('5'));
 assert.match(await panel.innerText(),/5.?320/);
 await page.evaluate(()=>{failQuote=true;return selectTransferTarget('pc3');});
 assert.equal(await page.locator('#btnSubmitTransfer').isDisabled(),true);assert.match(await panel.innerText(),/Tarif belgilanmagan/);
 assert.deepEqual(errors,[]);await page.close();

 const mobile=await browser.newPage({viewport:{width:390,height:844}});
 await mobile.setContent('<dialog id="dialog"><h2 id="title"></h2><div id="body"></div><button id="actionSubmit">Tasdiqlash</button></dialog>');
 await mobile.addStyleTag({path:'public/mobile/style.css'});
 const tools=fs.readFileSync('public/mobile/operator-tools.js','utf8').replace('export function createOperatorTools','function createOperatorTools');
 await mobile.addScriptTag({content:`${tools}
   window.calls=[];window.state={pcs:${JSON.stringify(pcs)},meta:{serverOnline:true}};
   const modal=(title,html,action)=>{document.getElementById('title').textContent=title;document.getElementById('body').innerHTML=html;window.action=action;document.getElementById('dialog').showModal();};
   window.tools=createOperatorTools({state,modal,esc:s=>String(s),money:n=>Number(n).toLocaleString()+" so'm",notice:console.log,can:()=>true,refresh:()=>{},
    remote:async(path,method,body)=>{calls.push({path,method,body});return ${JSON.stringify(quote)};}});
   tools.transfer(state.pcs[0]);`});
 await mobile.waitForFunction(()=>document.getElementById('transferPreview').textContent.includes('15 daqiqa'));
 assert.equal(await mobile.locator('#transferPreview [style*="line-through"]').count(),1);
 await mobile.locator('#dialog').screenshot({path:'.test-output/transfer-mobile.png'});
 await mobile.evaluate(()=>action({target:'pc3'}));
 const submitted=await mobile.evaluate(()=>calls.find(call=>call.method==='POST'));
 assert.equal(submitted.body.quoteRevision,quote.quoteRevision);
 console.log('PASS desktop/mobile transfer preview: crossed-out old time, prominent new time, VIP carried sum, blocked missing quote, submitted revision');
} finally {await browser.close();}
