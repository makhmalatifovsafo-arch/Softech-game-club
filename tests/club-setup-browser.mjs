// Real editor + real validation, isolated HTTP fixture. No production requests.
import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {emptySetupDraft,normalizeSetupDraft,evaluateSetupDraft} from '../NetCafeServer/src/services/clubSetup.js';
const root=resolve('NetCafeServer/public');
let state={installationKind:'NEW',revision:0,draft:emptySetupDraft()},delay=0,failSave=false,failRead=false;
let live=[1,2].map(number=>({number,ip:'192.168.1.'+(100+number),mac:'02:00:00:00:00:0'+number,connected:true,lastHeartbeat:Date.now()}));
let baseline=emptySetupDraft();const writes=[];
const fingerprint='a'.repeat(64);let activeSessions=2,loseCompletion=false,receipt=null,applyCount=0,completionRequests=[];
let gateRequired=false,gateError=false;
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://test').pathname;
  function json(status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<h1 id="cashier">Kassa tayyor</h1>');return;}
  if(pathname==='/gate-fixture.html'){
    const role=new URL(req.url,'http://test').searchParams.get('role');
    res.setHeader('Content-Type','text/html');res.end(`<script src="/setup-gate.js"></script><body><h1 id="cashier" hidden>Kassa</h1><script>window.addEventListener('load',async()=>{document.getElementById('cashier').hidden=!await SoftechSetupGate.check(localStorage.getItem('softech_token'),{role:${JSON.stringify(role)}});});</script></body>`);return;
  }
  if(pathname.startsWith('/api/')){
    if(req.headers.authorization!=='Bearer setup-fixture')return json(403,{error:'Menejer kerak'});
    if(req.method==='GET'&&failRead)return json(503,{error:'Test connection unavailable'});
    if(pathname==='/api/setup/status')return json(gateError?503:200,gateError?{error:'Unavailable'}:{required:gateRequired});
    if(pathname==='/api/setup/context')return json(200,{fingerprint,clubName:'Softech Test Arena',maxComputers:20,initialDraft:baseline,liveClients:live,activeSessions,notices:[],otherTariffs:[]});
    if(pathname==='/api/setup/complete'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);completionRequests.push(body);
      if(!receipt){assert.equal(body.revision,state.revision);applyCount++;receipt={requestId:body.requestId,completedAt:new Date().toISOString()};state.revision++;}
      else assert.equal(body.requestId,receipt.requestId,'lost completion retries must use the same key');
      if(loseCompletion){loseCompletion=false;return json(503,{error:'Saqlash javobi yo‘qoldi'});}
      return json(200,{success:true,receipt});
    }
    if(pathname==='/api/setup/draft'){
      if(req.method==='PUT'){
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
        if(body.revision!==state.revision)return json(409,{error:'Conflict'});
        state={...state,baseFingerprint:body.baseFingerprint||state.baseFingerprint,revision:state.revision+1,draft:normalizeSetupDraft(body.draft)};writes.push(structuredClone(state));
        if(delay)await new Promise(r=>setTimeout(r,delay));
        if(failSave){failSave=false;return json(503,{error:'Javob yetib kelmadi'});}
      }
      return json(200,{...state,readiness:evaluateSetupDraft(state.draft,{maxComputers:20,liveClients:live.map(c=>({...c,lastHeartbeat:Date.now()}))})});
    }
    throw Error('Unexpected business endpoint: '+pathname);
  }
  const file=resolve(root,'.'+pathname);
  if(!file.startsWith(root+sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]||'text/plain');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await context.addInitScript(()=>localStorage.setItem('softech_token','setup-fixture'));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const saved=()=>page.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('✓'));
  async function layout(){
    for(const viewport of [{width:1366,height:768},{width:1024,height:600},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(viewport));
      const box=await page.locator('#saveDraft').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height,JSON.stringify(box));
    }
    await page.setViewportSize({width:1366,height:768});
  }
  await page.goto(origin+'/club-setup.html');await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(await page.locator('#nextStep').isDisabled(),true);
  // Draw a room in logical map coordinates (letterboxing does not change geometry).
  await page.locator('#drawTool').click();
  const points=await page.locator('#roomMapHost svg').evaluate(svg=>[new DOMPoint(40,40),new DOMPoint(400,300)].map(p=>{const q=p.matrixTransform(svg.getScreenCTM());return {x:q.x,y:q.y};}));
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:8});await page.mouse.up();
  assert.equal(await page.locator('#roomList button').count(),1);
  await page.locator('#roomEditor [name=name]').fill('Oddiy zal');await page.locator('#expectedComputers').fill('2');await saved();
  assert.equal(state.draft.rooms[0].width,360);assert.equal(state.draft.rooms[0].height,260);
  await page.locator('#addRoom').click();await page.locator('#roomEditor [name=name]').fill('VIP xona');await saved();
  await layout();
  // Canceling a drag restores the local geometry and must not persist a half move.
  const original=structuredClone(state.draft.rooms);const capturing=page.locator('#roomMapHost svg');
  await page.locator('#roomMapHost').scrollIntoViewIfNeeded();
  const start=await capturing.evaluate((svg,r)=>{const p=new DOMPoint(r.x+50,r.y+50).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y};},state.draft.rooms[0]);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+45,start.y+35);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await page.waitForTimeout(750);
  assert.deepEqual(state.draft.rooms,original);
  await page.locator('#roomsStage [data-map-view=selected]').click();assert.ok((await capturing.getAttribute('viewBox')).split(' ').map(Number)[2]<800);
  await page.locator('#roomsStage [data-map-view=all]').click();
  mkdirSync('.test-output/setup-ui',{recursive:true});
  await page.screenshot({path:'.test-output/setup-ui/01-rooms.png',fullPage:true});
  await page.locator('#nextStep').click();await page.locator('#computersStage').waitFor({state:'visible'});
  await page.locator('#fillComputers').click();await saved();assert.equal(state.draft.computers.length,2);
  const ids=state.draft.computers.map(c=>c.id);
  await page.locator(`[data-pc="${ids[0]}"]`).click();await page.locator('#bindClient').selectOption('1');await saved();
  await page.locator(`[data-pc="${ids[1]}"]`).click();assert.equal(await page.locator('#bindClient option[value="1"]').isDisabled(),true);
  await page.locator('#bindClient').selectOption('2');await page.locator('#pcEditor [name=roomId]').selectOption(state.draft.rooms[0].id);await saved();
  const x=state.draft.computers[1].x;await page.locator(`[data-map-pc="${ids[1]}"]`).focus();await page.keyboard.press('ArrowRight');await saved();assert.equal(state.draft.computers[1].x,x+10);
  assert.equal(state.draft.computers.length,2);assert.match(await page.locator('#liveStatus').innerText(),/2 ta/);
  await layout();
  await page.locator('#nextStep').click();await page.locator('#tariffsStage').waitFor({state:'visible'});
  await page.locator('#tariffRoom').selectOption(state.draft.rooms[0].id);
  await page.locator('#addTariff').click();await page.locator('[name=price_per_hour]').fill('7000');await page.locator('[name=vipAllowed]').uncheck();await saved();
  await page.locator('#tariffRoom').selectOption(state.draft.rooms[1].id);await page.locator('#addTariff').click();await page.locator('[name=price_per_hour]').fill('10000');await saved();
  assert.equal(state.draft.tariffs[0].vipAllowed,false);
  assert.equal(await page.locator('[name=start_time]').getAttribute('type'),'text');
  assert.equal(await page.locator('[name=start_time]').inputValue(),'00:00');
  await page.locator('[name=start_time]').fill('2400');await saved();assert.equal(await page.locator('#nextStep').isDisabled(),true);
  await page.locator('[name=start_time]').fill('0000');await saved();assert.equal(await page.locator('[name=start_time]').inputValue(),'00:00');
  await layout();
  await page.screenshot({path:'.test-output/setup-ui/03-tariffs.png',fullPage:true});
  await page.locator('#nextStep').click();await page.locator('#reviewStage').waitFor({state:'visible'});await saved();
  assert.match(await page.locator('#reviewChecks').innerText(),/o‘tdi/);assert.match(await page.locator('#draftChanges').innerText(),/Yangi/);
  assert.equal(await page.locator('#nextStep').isVisible(),false);
  assert.equal(await page.locator('#completeSetup').isDisabled(),true,'active sessions prevent reconfiguration');
  const readyDraft=structuredClone(state.draft);
  await page.reload();await page.locator('#reviewStage').waitFor({state:'visible'});assert.equal(state.draft.computers.length,2);
  for(const viewport of [{width:1366,height:768},{width:1024,height:600},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(viewport));
    const box=await page.locator('#saveDraft').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height,JSON.stringify(box));
    const finish=await page.locator('#completeSetup').boundingBox();assert.ok(finish.x>=0&&finish.x+finish.width<=viewport.width&&finish.y+finish.height<=viewport.height,JSON.stringify(finish));
  }
  await page.screenshot({path:'.test-output/setup-ui/04-review-mobile.png',fullPage:true});
  await page.setViewportSize({width:1366,height:768});await page.locator('[data-step=rooms]').click();await page.locator('#roomsStage').waitFor({state:'visible'});await saved();
  // Input stays focused and newer typing survives an in-flight save.
  delay=900;await page.locator('#roomEditor [name=name]').fill('Birinchi yozuv');await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='Saqlanmoqda…');
  await page.locator('#roomEditor [name=name]').fill('Eng yangi yozuv');await saved();delay=0;
  assert.equal(await page.locator('#roomEditor [name=name]').inputValue(),'Eng yangi yozuv');assert.ok(state.draft.rooms.some(r=>r.name==='Eng yangi yozuv'));
  assert.equal(await page.locator('#roomEditor [name=name]').evaluate(el=>el===document.activeElement),true);
  // A saved request whose response was lost must never overwrite another revision.
  failSave=true;await page.locator('#roomEditor [name=name]').fill('Javobsiz saqlangan');await page.locator('#saveError').waitFor({state:'visible'});
  await page.locator('#retrySave').click();await page.locator('#loadRemote').waitFor({state:'visible'});
  assert.equal(await page.locator('#roomEditor [name=name]').inputValue(),'Javobsiz saqlangan');
  await page.locator('#loadRemote').click();await page.locator('#cancelConfirm').click();assert.equal(await page.locator('#loadRemote').isVisible(),true);
  await page.locator('#loadRemote').click();await page.locator('#acceptConfirm').click();await saved();
  assert.equal(await page.locator('#roomEditor [name=name]').inputValue(),'Javobsiz saqlangan');
  // Offline indications clear even if last server response said all clients were online.
  await page.locator('[data-step=computers]').click();await page.locator('#computersStage').waitFor({state:'visible'});await saved();
  failRead=true;await page.locator('#refreshClients').click();await page.waitForFunction(()=>document.getElementById('liveStatus').textContent.includes('tekshirilmagan'));
  assert.equal(await page.locator('#pcList .online').count(),0);failRead=false;
  // Existing club import is read-only until explicit editing/saving.
  baseline=structuredClone(state.draft);baseline.step='rooms';state={installationKind:'EXISTING',revision:0,draft:emptySetupDraft()};
  const beforeWrites=writes.length;await page.reload();await page.locator('#roomsStage').waitFor({state:'visible'});
  await page.waitForTimeout(800);assert.equal(writes.length,beforeWrites);assert.equal(await page.locator('#roomList button').count(),2);
  await page.locator('#saveDraft').click();await saved();assert.deepEqual(state.draft,baseline);
  const denied=await browser.newContext();const deniedPage=await denied.newPage();await deniedPage.goto(origin+'/club-setup.html');await deniedPage.locator('#loadError').waitFor({state:'visible'});
  assert.equal(await deniedPage.locator('#workspace').isVisible(),false);await denied.close();
  // All-day coverage is mandatory, not merely an advisory warning.
  activeSessions=0;baseline=emptySetupDraft();state={installationKind:'NEW',revision:1,baseFingerprint:fingerprint,draft:structuredClone(readyDraft)};
  state.draft.tariffs[0].days_of_week=[1];await page.reload();await page.locator('#reviewStage').waitFor({state:'visible'});
  assert.equal(await page.locator('#completeSetup').isDisabled(),true);
  state.draft=structuredClone(readyDraft);await page.reload();await page.locator('#reviewStage').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('completeSetup').disabled);
  // Completion is atomic on the API side; a lost response and page reload must
  // use the original request rather than apply the setup again.
  loseCompletion=true;await page.locator('#completeSetup').click();await page.locator('#acceptConfirm').click();
  await page.waitForFunction(()=>document.getElementById('completeSetup').textContent==='Natijani tekshirish'&&!document.getElementById('completeSetup').disabled);
  assert.equal(await page.locator('#workspace').evaluate(el=>el.inert),true);
  await page.reload();await page.waitForURL(origin+'/');assert.equal(applyCount,1);assert.equal(completionRequests.length,2);
  assert.deepEqual(completionRequests[0],completionRequests[1]);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('softech-setup-completion:')).length),0);
  // Real gate: existing club, administrator waiting/recovery, unavailable API,
  // then a fresh manager redirected into the standalone wizard.
  await page.goto(origin+'/gate-fixture.html?role=club_owner');await page.locator('#cashier').waitFor({state:'visible'});
  assert.equal(await page.locator('#setupGate').count(),0);
  gateRequired=true;await page.goto(origin+'/gate-fixture.html?role=administrator');await page.getByText('Menejer klubni sozlamoqda.',{exact:false}).waitFor();
  assert.equal(await page.locator('#cashier').isVisible(),false);
  gateRequired=false;await page.getByRole('button',{name:'Qayta tekshirish'}).click();await page.locator('#cashier').waitFor({state:'visible'});
  gateError=true;await page.goto(origin+'/gate-fixture.html?role=club_owner');await page.getByText('Server bilan aloqa tiklanishi kutilmoqda.').waitFor();
  assert.equal(await page.locator('#cashier').isVisible(),false);
  gateError=false;gateRequired=true;await page.getByRole('button',{name:'Qayta tekshirish'}).click();await page.waitForURL(origin+'/club-setup.html');
  assert.deepEqual(errors,[]);
  console.log('PASS setup UI: editor, layouts, 24/7 coverage, completion retry/reload, new manager redirect, administrator wait and existing club access');
}finally{await browser.close();await new Promise(r=>server.close(r));}
