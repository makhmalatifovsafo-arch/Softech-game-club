import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const source=[section('    function formatTime(', '    // MODAL INTERACTION HELPERS'),section('    function renderComputers(', '    // SEANS OCHISH MODALI'),section('    function renderPcTable(', '    function togglePcTableSelect'),section('    function renderFloorPlan(', '    function handleZoneSelect'),section('    function sessionBillLabel', '    // AUTHENTICATION LOGIC')].join('\n');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
 await page.addScriptTag({path:'NetCafeServer/public/vendor/tailwind-3.4.17.js'});
 await page.addStyleTag({path:'NetCafeServer/public/style.css'});
 await page.addScriptTag({path:'NetCafeServer/public/computer-state.js'});
 await page.addScriptTag({content:`
 let currentZoneFilter='ALL',pcSearchQuery='',selectedPcIds=new Set(),isMainLayoutEdit=false,selectedDeskId=null,selectedZoneId=null,zonesData=[],authToken=null;
 const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.intervals=[];window.setInterval=(fn,ms)=>intervals.push({fn,ms});
 window.fixtureNow=Date.now();Date.now=()=>fixtureNow;
 let computersData=[{id:'vip',pcNumber:1,name:'VeryLongComputerNameWithoutSpaces123456789',roomName:'VIP room with a very long descriptive name',zone:'VIP',status:'OCCUPIED',isOnline:true,x:0,y:0,
 activeSession:{sessionId:'vip-1',isPostpaid:true,totalAmount:5320,barPendingAmount:12000,customerName:'A very long customer name',tariffName:'VeryLongTariffNameWithoutSpaces123456',remainingSeconds:-1,startedAt:new Date(fixtureNow-1800000).toISOString()}},
 {id:'paid',pcNumber:2,name:'PC 2',zone:'STANDARD',status:'OCCUPIED',isOnline:true,x:160,y:0,activeSession:{sessionId:'paid-1',totalAmount:10000,barPendingAmount:5000,paymentType:'BALANCE',isMember:true,memberBalance:123456789,memberId:42,remainingSeconds:1800,customerName:'A'.repeat(80),startedAt:new Date(fixtureNow-1800000).toISOString(),endsAt:new Date(fixtureNow+1800000).toISOString()}},
 {id:'new',pcNumber:3,name:'New computer with a long name',zone:'STANDARD',status:'LOCKED',isOnline:false}];
 ${source}
 renderComputers(computersData);renderPcTable(computersData);renderFloorPlan();
 document.getElementById('loginModal').style.display='none';
 document.getElementById('pcGrid').classList.remove('hidden');
 `});
 const grid=page.locator('#pcGrid');await grid.scrollIntoViewIfNeeded();
 for(const width of [280,560,960]) {
  await grid.evaluate((el,w)=>{el.style.width=w+'px';el.style.maxWidth='none';},width);
  await page.waitForTimeout(120);
  const overflow=await grid.locator('.pc-grid-card').evaluateAll(cards=>cards.flatMap(card=>{
   const box=card.getBoundingClientRect();return [...card.querySelectorAll('*')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>box.right+1||r.left<box.left-1||r.bottom>box.bottom+1);}).map(el=>el.textContent.slice(0,70));
  }));assert.deepEqual(overflow,[],`No card overflow at ${width}px`);
 }
 const result=await page.evaluate(()=>({bills:[...document.querySelectorAll('[data-session-bill="vip"]')].map(el=>el.textContent),gridBar:document.getElementById('pc-card-vip').textContent,tableBar:document.getElementById('pcTableBody').textContent,mapBar:document.querySelector('[data-session-bar="vip"]').title}));
 assert.equal(result.bills.length,3);assert.ok(result.bills.every(b=>b===result.bills[0]));
 for(const text of [result.gridBar,result.tableBar,result.mapBar])assert.match(text,/12\D?000/);
 await page.evaluate(()=>{fixtureNow+=90000;intervals.find(i=>i.ms===1000).fn();});
 for(const prefix of ['timer-','desk-timer-','table-timer-'])assert.match(await page.locator('#'+prefix+'paid').textContent(),/00:28:30/);
 assert.equal(await page.locator('#timer-vip').textContent(),await page.locator('#desk-timer-vip').textContent());
 fs.mkdirSync('.test-output',{recursive:true});await grid.screenshot({path:'.test-output/classic-grid.png'});
 assert.deepEqual(errors,[]);console.log('PASS grid/table/map share VIP bill, bar debt and delayed timer; long names and large amounts fit cards at 280/560/960px');
} finally {await browser.close();}
