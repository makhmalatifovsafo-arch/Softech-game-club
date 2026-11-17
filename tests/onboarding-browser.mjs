// Real cashier markup and tutorial, served entirely from a local browser fixture.
import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('NetCafeServer/public');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],writes=[];
fs.mkdirSync('.test-output/onboarding',{recursive:true});
try{
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin!=='http://onboarding.test')return route.abort();
    if(u.pathname.startsWith('/api/')){writes.push(route.request().method+' '+u.pathname);return route.fulfill({status:500,json:{error:'No business calls allowed'}});}
    if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
    const file=path.resolve(root,'.'+u.pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'image/svg+xml',body:fs.readFileSync(file)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function load(){
    await page.goto('http://onboarding.test/');
    await page.addScriptTag({url:'/vendor/tailwind-3.4.17.js'});
    await page.addStyleTag({url:'/style.css'});await page.addStyleTag({url:'/onboarding.css'});
    await page.evaluate(()=>{
      localStorage.setItem('softech_token','fixture');window.softechSetupReady=true;
      document.getElementById('loginModal').classList.add('hidden');
      document.getElementById('canvasViewport').classList.add('hidden');
      const grid=document.getElementById('pcGrid');grid.classList.remove('hidden');
      grid.innerHTML='<button data-pc-id="fixture" onclick="window.realOperations++" style="height:160px;border:1px solid #47815b;background:#14251c;border-radius:14px;color:white">PC-01<br>Seans ochish</button>';
      document.getElementById('pcSearchInput').value='Saqlangan qidiruv';window.realOperations=0;window.keyOperations=0;
      document.addEventListener('keydown',()=>window.keyOperations++);
    });
    await page.addScriptTag({url:'/onboarding.js'});
  }
  const owner={id:1,clubId:18,role:'club_owner',clubName:'Test Arena'};
  const status={required:false,installationKind:'NEW',completedAt:'2026-11-17T05:00:00.000Z'};
  const auth=(user=owner,state=status)=>page.evaluate(([u,s])=>SoftechOnboarding.onAuthenticated(u,s),[user,state]);
  const next=()=>page.locator('#softechOnboarding [data-action=next]').last().click();
  const title=()=>page.locator('#ob-title').innerText();
  await load();await auth(owner,{required:false,installationKind:'EXISTING',completedAt:null});
  assert.equal(await page.locator('#softechOnboarding').count(),0,'existing clubs have no automatic lesson');
  await auth();await page.locator('.ob-activation').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({path:'.test-output/onboarding/01-activation.png'});
  await page.locator('#ob-title').waitFor();assert.match(await title(),/Boshqaruv/);
  await page.screenshot({path:'.test-output/onboarding/02-welcome.png',animations:'disabled'});
  await page.addScriptTag({url:'/release-presentation.js',type:'module'});
  await page.waitForFunction(()=>!!window.SoftechReleasePresentation);
  await page.evaluate(()=>SoftechReleasePresentation.open('club_owner',1));
  assert.equal(await page.locator('#softechReleasePresentation').count(),0,'release notes do not overlap onboarding');
  await next();assert.match(await title(),/kompyuterni/);
  assert.equal(await page.locator('.ob-target').isVisible(),true,'grid PC highlighted');
  await page.locator('.ob-target').click();assert.match(await page.locator('.ob-demo').innerText(),/PC tanlandi/);
  await page.locator('#pcGrid > [data-pc-id]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>realOperations),0,'highlight click never reaches real PC action');
  await page.screenshot({path:'.test-output/onboarding/03-pc.png',animations:'disabled'});
  // Redrawing the underlying grid or switching to the other two real view
  // containers never detaches the highlight or calls a business operation.
  for(const view of ['table','map']){
    await page.evaluate(view=>{
      document.getElementById('pcGrid').classList.add('hidden');
      const table=document.getElementById('pcTableContainer'),canvas=document.getElementById('canvasViewport');
      table.classList.toggle('hidden',view!=='table');canvas.classList.toggle('hidden',view!=='map');
      if(view==='table')document.getElementById('pcTableBody').innerHTML='<tr data-pc-id="fixture"><td style="height:80px">PC-01</td></tr>';
      else document.getElementById('floorPlanDesksContainer').innerHTML='<div class="floor-desk" data-pc-id="fixture" style="position:absolute;top:20px;left:80px;width:160px;height:100px;background:#143b25">PC-01</div>';
    },view);
    await page.waitForTimeout(300);assert.equal(await page.locator('.ob-target').isVisible(),true,view);
  }
  await next();assert.match(await title(),/mos seans/);
  for(const mode of ['amount','until','vip','time']){await page.locator(`[data-mode=${mode}]`).click();assert.equal(await page.locator(`[data-mode=${mode}]`).getAttribute('aria-pressed'),'true');}
  await next();await page.locator('[data-action=cola]').click();assert.match(await page.locator('.ob-demo strong').innerText(),/5 000/);
  await next();await page.locator('[data-checkout=due]').click();assert.match(await page.locator('.ob-demo').innerText(),/3 333/);
  await page.locator('[data-checkout=refund]').click();assert.match(await page.locator('.ob-demo').innerText(),/qaytim/);
  await page.screenshot({path:'.test-output/onboarding/04-checkout.png',animations:'disabled'});
  for(const viewport of [{width:1024,height:600},{width:390,height:844},{width:568,height:320}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(300);
    const box=await page.locator('.ob-panel').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,JSON.stringify(box));
    assert.equal(await page.locator('.ob-panel').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.locator('[data-action=later]').first().scrollIntoViewIfNeeded();
    if(viewport.width===390)await page.screenshot({path:'.test-output/onboarding/05-mobile.png'});
  }
  await page.setViewportSize({width:1366,height:768});await next();assert.match(await title(),/xonaning/);
  await next();assert.match(await title(),/Natijalar/);await next();assert.match(await title(),/tayyorsiz/);await next();
  assert.equal(await page.locator('#softechOnboarding').count(),0);
  assert.equal(await page.locator('#pcSearchInput').inputValue(),'Saqlangan qidiruv');assert.equal(await page.evaluate(()=>realOperations),0);
  // Completion persists, while settings can replay the lesson at any time.
  await load();await auth();assert.equal(await page.locator('#softechOnboarding').count(),0);
  await page.evaluate(()=>SoftechOnboarding.open());await page.locator('#ob-title').waitFor();assert.match(await title(),/Boshqaruv/);
  await next();await page.keyboard.press('Escape');assert.equal(await page.locator('#softechOnboarding').count(),0);
  assert.equal(await page.evaluate(()=>keyOperations),0,'cashier shortcuts blocked during the lesson');
  await load();await auth();assert.equal(await page.locator('#softechOnboarding').count(),0,'Keyinroq does not nag on next login');
  await page.evaluate(()=>SoftechOnboarding.open());assert.match(await title(),/kompyuterni/,'manual replay resumes a paused lesson');
  // Administrator has their own progress, and never gets manager report/tariff lessons.
  const admin={id:2,clubId:18,role:'administrator'};await auth(admin);await page.locator('#ob-title').waitFor();
  const seen=[];for(let i=0;i<10&&await page.locator('#softechOnboarding').count();i++){seen.push(await title());await next();}
  assert.equal(seen.length,6);
  assert.ok(!seen.some(t=>/xonaning|Natijalar/.test(t)));assert.equal(await page.locator('#softechOnboarding').count(),0);
  // License interruption and logout always release modal keyboard capture.
  await page.evaluate(()=>SoftechOnboarding.open());
  await page.evaluate(()=>{const lock=document.createElement('div');lock.id='softechLicenseLockOverlay';lock.textContent='Blocked';document.body.append(lock);});
  await page.waitForFunction(()=>!SoftechOnboarding.isActive());
  await page.evaluate(()=>document.getElementById('softechLicenseLockOverlay').remove());
  await page.evaluate(()=>SoftechOnboarding.open());await page.evaluate(()=>{localStorage.removeItem('softech_token');});
  await page.waitForFunction(()=>!SoftechOnboarding.isActive());
  // Reduced motion, missing target and unavailable local storage must remain usable.
  await page.emulateMedia({reducedMotion:'reduce'});await load();
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('Quota');};document.getElementById('pcGrid').replaceChildren();});
  await auth({id:3,clubId:19,role:'administrator'},status);await page.locator('#ob-title').waitFor();await next();
  assert.equal(await page.locator('.ob-target').isVisible(),false);assert.match(await page.locator('.ob-hint').innerText(),/ko‘rinmayapti/);
  assert.equal(await page.locator('.ob-panel').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.keyboard.press('Escape');
  await auth({id:4,clubId:20,role:'administrator'},{...status,required:true});
  assert.equal(await page.evaluate(()=>SoftechOnboarding.open()),false,'unfinished setup cannot launch a practice lesson');
  await auth({id:5,clubId:20,role:'superadmin'},status);
  assert.equal(await page.evaluate(()=>SoftechOnboarding.open()),false,'only the intended staff audience');
  await auth(owner,{required:false,installationKind:'EXISTING',completedAt:null});
  await page.evaluate(()=>document.querySelectorAll('link[href$="/onboarding.css"]').forEach(link=>link.remove()));
  assert.equal(await page.evaluate(()=>SoftechOnboarding.open()),false,'missing stylesheet must not capture the cashier keyboard');
  assert.equal(await page.locator('#softechOnboarding').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log('PASS onboarding: verified activation, all three PC views, read-only practice, billing examples, roles, persistence/resume, keyboard isolation, interruption, responsive and reduced-motion layouts');
}finally{await browser.close();}
