// Actual pointer/keyboard editing against a loopback draft-only fixture.
import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {emptySetupDraft,normalizeSetupDraft,evaluateSetupDraft} from '../NetCafeServer/src/services/clubSetup.js';

const root=resolve('NetCafeServer/public'),writes=[],errors=[];
let state={revision:0,installationKind:'NEW',draft:emptySetupDraft()};
const baseline=emptySetupDraft();
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://test').pathname;
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(pathname.startsWith('/api/')){
    if(req.headers.authorization!=='Bearer map-fixture')return json(403,{error:'Menejer kerak'});
    if(pathname==='/api/setup/context')return json(200,{initialDraft:baseline,fingerprint:'a'.repeat(64),clubName:'Xona chizish sinovi',maxComputers:20,liveClients:[],activeSessions:0,notices:[],otherTariffs:[]});
    if(pathname==='/api/setup/draft'){
      if(req.method==='PUT'){
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
        assert.equal(body.revision,state.revision);state={...state,revision:state.revision+1,draft:normalizeSetupDraft(body.draft)};writes.push(structuredClone(state.draft));
      }
      return json(200,{...state,readiness:evaluateSetupDraft(state.draft,{maxComputers:20})});
    }
    errors.push('Unexpected business endpoint: '+pathname);return json(500,{error:'Unexpected business endpoint'});
  }
  const file=resolve(root,'.'+pathname);
  if(!file.startsWith(root+sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]||'text/plain');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const context=await browser.newContext({viewport:{width:1366,height:900},reducedMotion:'reduce'});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await context.addInitScript(()=>localStorage.setItem('softech_token','map-fixture'));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const saved=()=>page.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('✓'));
  const map=page.locator('#roomMapHost');
  const coords=async points=>{
    await map.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    return map.locator('svg').evaluate((svg,points)=>points.map(p=>{const q=new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM());return {x:q.x,y:q.y};}),points);
  };
  const clickPoint=async p=>{const [q]=await coords([p]);await page.mouse.click(q.x,q.y);};
  const moveHandle=async(selector,dx,dy,cancel)=>{
    await map.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    const el=map.locator(selector),b=await el.boundingBox(),s=await map.locator('svg').evaluate(svg=>svg.getScreenCTM().a);
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx*s,b.y+b.height/2+dy*s,{steps:5});
    if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
  };
  await page.goto(origin+'/club-setup.html');await page.locator('#workspace').waitFor({state:'visible'});
  await page.locator('#drawTool').click();
  const [a,b]=await coords([{x:40,y:40},{x:400,y:300}]);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();await saved();
  assert.equal(state.draft.rooms.length,1);const roomId=state.draft.rooms[0].id;
  assert.equal(await map.locator('[data-resize]').count(),8);
  await moveHandle('[data-resize=se]',80,60);await saved();assert.equal(state.draft.rooms[0].width,440);assert.equal(state.draft.rooms[0].height,320);
  await moveHandle('[data-resize=nw]',-20,-20);await saved();assert.equal(state.draft.rooms[0].x,20);assert.equal(state.draft.rooms[0].y,20);
  const before=structuredClone(state.draft);const count=writes.length;
  await moveHandle('[data-resize=se]',60,50,true);await page.waitForTimeout(750);assert.deepEqual(state.draft,before);assert.equal(writes.length,count,'Escape must not save an incomplete resize');
  // Preserve existing PC bindings and rates when resizing an imported room.
  state.draft.computers=[{id:'pc_9',number:9,name:'PC-09',roomId,ip:'192.168.1.9',mac:'02:00:00:00:00:09',x:250,y:190}];state.draft.expectedComputers=1;
  state.draft.tariffs=[{id:'rate_7',roomId,name:'Kun',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:7000,vipAllowed:false}];
  const preserved=structuredClone(state.draft);await page.reload();await page.locator('#workspace').waitFor({state:'visible'});
  await moveHandle('[data-resize=se]',460,340);await saved();
  assert.deepEqual(state.draft.computers[0],{...preserved.computers[0],x:480,y:360});assert.deepEqual(state.draft.tariffs,preserved.tariffs);
  // A pen stroke remains local until explicitly closed. Undo and Escape are safe.
  await page.locator('#penTool').click();await clickPoint({x:100,y:80});await clickPoint({x:400,y:80});
  const penWrites=writes.length;await page.waitForTimeout(750);assert.equal(writes.length,penWrites);assert.equal(await page.locator('#nextStep').isDisabled(),true);
  await page.locator('#undoPoint').click();assert.match(await page.locator('#penCount').innerText(),/1 ta/);
  await map.focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#penActions').isVisible(),false);assert.equal(state.draft.rooms.length,1);
  // Concave L-shaped room, closed by clicking the starting vertex.
  await page.locator('#penTool').click();
  for(const p of [{x:100,y:80},{x:500,y:80},{x:500,y:240},{x:260,y:240},{x:260,y:480},{x:100,y:480},{x:100,y:80}])await clickPoint(p);
  await saved();assert.equal(state.draft.rooms.length,2);const polyId=state.draft.rooms[1].id;
  assert.equal(state.draft.rooms[1].polygonPoints.length,6);assert.equal(await map.locator('[data-vertex]').count(),6);
  await moveHandle('[data-vertex="3"]',30,20);await saved();assert.deepEqual(state.draft.rooms[1].polygonPoints[3],{x:290,y:260});
  await map.locator('[data-add-vertex="0"]').click();await saved();assert.equal(state.draft.rooms[1].polygonPoints.length,7);
  await map.locator('[data-vertex="1"]').focus();await page.keyboard.press('Delete');await saved();assert.equal(state.draft.rooms[1].polygonPoints.length,6);
  // A crossed wall is rejected and the previous room restored without a write.
  const valid=structuredClone(state.draft),validWrites=writes.length;
  await moveHandle('[data-vertex="1"]',-300,350);await page.waitForTimeout(750);
  assert.deepEqual(state.draft,valid);assert.equal(writes.length,validWrites);assert.equal(await page.locator('#mapMessage').isVisible(),true);
  // Invalid new pen polygon also cannot reach draft storage.
  await page.locator('#penTool').click();for(const p of [{x:100,y:80},{x:500,y:480},{x:100,y:480},{x:500,y:80}])await clickPoint(p);
  await page.locator('#finishPolygon').click();assert.match(await page.locator('#mapMessage').innerText(),/kesish/);assert.equal(state.draft.rooms.length,2);
  await page.locator('#cancelPolygon').click();
  // Zoom and pan affect only the viewport; shape, PC and pricing data stay intact.
  const originalView=await map.locator('svg').getAttribute('viewBox');await page.locator('#zoomIn').click();assert.notEqual(await map.locator('svg').getAttribute('viewBox'),originalView);
  await page.locator('#panTool').click();const [p]=await coords([{x:300,y:260}]);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+50,p.y+30);await page.mouse.up();
  assert.deepEqual(state.draft,valid);assert.equal(writes.length,validWrites);
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.locator(`[data-room="${polyId}"]`).click();
  assert.equal(await map.locator('[data-vertex]').count(),6);assert.deepEqual(state.draft,valid);
  mkdirSync('.test-output/setup-map-ui',{recursive:true});
  await page.screenshot({path:'.test-output/setup-map-ui/room-editor.png',fullPage:true});
  for(const viewport of [{width:1024,height:600},{width:390,height:844}]){
    await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('#penTool').click();assert.equal(await page.locator('#penActions').isVisible(),true);
    await page.locator('#cancelPolygon').click();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS room drawing: corner/edge resize, cancel, PC/tariff preservation, pen, concave geometry, vertex edits, invalid shapes, pan/zoom, persistence and narrow screens');
}finally{await browser.close();await new Promise(r=>server.close(r));}
