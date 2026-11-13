import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
function fn(name){const a=html.indexOf('    function '+name+'(');assert.ok(a>=0,name);const b=html.indexOf('\n    }',a);return html.slice(a,b+6);}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
 await page.evaluate(()=>{const grid=document.getElementById('pcGrid'),table=document.getElementById('pcTableBody').closest('table'),menu=document.getElementById('pcContextMenu');document.body.replaceChildren(grid,table,menu);grid.classList.remove('hidden');});
 await page.addStyleTag({content:'.hidden{display:none!important}#pcContextMenu{position:fixed;width:256px;max-height:calc(100vh - 24px);overflow:auto;background:white}button{min-height:24px}'});
 await page.addScriptTag({path:'NetCafeServer/public/computer-state.js'});
 await page.evaluate(()=>{
  window.computersData=[{id:'pc-off',name:'Offline PC',status:'OFFLINE',isOnline:false},{id:'pc-on',name:'Online PC',status:'AVAILABLE',isOnline:true},{id:'pc-busy',name:'Busy PC',status:'OCCUPIED',isOnline:true,activeSession:{sessionId:'s1',remainingSeconds:600,barPendingAmount:4000}}];
  Object.assign(window,{currentZoneFilter:'ALL',pcSearchQuery:'',selectedPcIds:new Set(),isMainLayoutEdit:false,currentCtxPcId:null,calls:[],escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),formatTime:()=> '00:10:00',sessionBillLabel:()=> '7000',postpaidTimeLabel:()=> '00:10:00',handleCardClick(){}});
  for(const name of ['openStartModal','openExtendModal','requestStopSession','openTransferModal','openMessageModal','openPcBarOrder','openPowerMenu','setPowerActionChoice'])window[name]=(...args)=>calls.push([name,...args]);
 });
 for(const name of ['openPcActions','startPcSession','pcActionsHtml','openContextMenu','closeContextMenu','handleCtxTransfer','handleCtxSendMessage','handleCtxStartSession','handleCtxPower','renderPcTable','renderComputers'])await page.addScriptTag({content:fn(name)});
 await page.evaluate(()=>{renderComputers(computersData);renderPcTable(computersData);});
 for(const selector of ['#pc-card-pc-off','#pcTableBody tr[data-pc-id="pc-off"]']){
  const card=page.locator(selector);assert.equal(await card.getByRole('button',{name:'Seans ochish',exact:true}).count(),1);assert.doesNotMatch(await card.innerText(),/WoL/);
  await card.getByRole('button',{name:'Seans ochish',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['openStartModal','pc-off','Offline PC']);
  await card.getByRole('button',{name:'Kompyuter amallari',exact:true}).click();
  assert.equal(await page.locator('#ctxBtnWol').isVisible(),true);assert.equal(await page.locator('#ctxBtnShutdown').isVisible(),false);
  await page.locator('#ctxBtnWol').click();assert.deepEqual(await page.evaluate(()=>calls.slice(-2)),[['openPowerMenu','pc-off',true],['setPowerActionChoice','wake']]);
 }
 for(const selector of ['#pc-card-pc-busy','#pcTableBody tr[data-pc-id="pc-busy"]']){
  await page.locator(selector).getByRole('button',{name:'Kompyuter amallari',exact:true}).click();
  assert.equal(await page.locator('#ctxBtnWol').isVisible(),false);assert.equal(await page.locator('#ctxBtnShutdown').isVisible(),true);
  await page.locator('#ctxActiveSessionGroup button').first().click();assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['openPcBarOrder','pc-busy']);
 }
 await page.locator('#pcTableBody tr[data-pc-id="pc-on"]').click({button:'right'});assert.equal(await page.evaluate(()=>currentCtxPcId),'pc-on');
 assert.deepEqual(errors,[]);console.log('PASS real grid/table share map menu, offline primary starts a session, wake-only stays in menu, active bar action targets same PC');
}finally{await browser.close();}
