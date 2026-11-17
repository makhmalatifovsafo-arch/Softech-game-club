// Local browser QA only. Uses the repository's existing Playwright installation.
import { chromium } from '../../../.tools/browser-test/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const origin=process.env.SOFTECH_SITE_TEST_URL||'http://127.0.0.1:5187';
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(origin);await page.evaluate(()=>document.fonts.ready);
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`home overflow ${width}`);
 }
 await page.setViewportSize({width:1440,height:1000});
 assert.equal(await page.locator('[data-demo],#experience,#pc-dialog,#pc-grid').count(),0);
 async function seek(p){await page.evaluate(p=>{const el=document.querySelector('.cinema-scroll'),stage=document.querySelector('.cinema-stage');scrollTo({top:scrollY+el.getBoundingClientRect().top+(el.offsetHeight-stage.offsetHeight)*p,behavior:'instant'});},p);await page.waitForTimeout(130);}
 for(const index of [0,1,2,3,2,1,0]){await seek([.005,.2,.52,.84][index]);assert.equal(await page.locator('#cinema').getAttribute('data-scene'),String(index));assert.equal(await page.locator('.cinema-scene:not([inert])').count(),1);}
 await seek(.10);const opacity=await page.locator('.cinema-scene').first().evaluate(e=>Number(getComputedStyle(e).opacity));assert.ok(opacity>0&&opacity<1,'Continuous crossfade between chapters');
 await seek(.24);await page.screenshot({path:'.test-output/softech-cinema-desktop.png'});
 await seek(.005);await page.locator('.cinema-next').click();assert.equal(await page.locator('#cinema').getAttribute('data-scene'),'1');
 await page.locator('.cinema-rail a').nth(3).click();assert.equal(await page.locator('#cinema').getAttribute('data-scene'),'3');
 await page.locator('[name="club"]').fill('Test <Club>');await page.locator('[name="city"]').fill('Toshkent');await page.locator('[name="pcs"]').fill('18');await page.locator('[name="phone"]').fill('+998 99 123 45 67');await page.locator('[name="note"]').fill('Sinov so‘rovi');
 await page.locator('#prepare-order').click();assert.match(await page.locator('#order-draft').inputValue(),/Test <Club>/);assert.match(await page.locator('#order-draft').inputValue(),/18 ta/);assert.match(await page.locator('#order-status').innerText(),/Hali yuborilmadi/);
 // Simulate clipboard rejection and verify a usable manual-copy fallback.
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('denied'))}}));
 await page.locator('#copy-order').click();assert.match(await page.locator('#order-status').innerText(),/qo‘lda nusxalab/);
 await page.locator('[name="pcs"]').fill('20');assert.equal(await page.locator('#order-result').isVisible(),false);
 await page.locator('#prepare-order').click();assert.match(await page.locator('#order-draft').inputValue(),/20 ta/);
 await page.locator('.cinema-next').click();await page.locator('#mobile').scrollIntoViewIfNeeded();assert.equal(await page.locator('#mobile .device-frame img').getAttribute('src'),'assets/mobile-administrator.webp');await page.locator('#mobile img').evaluate(img=>img.decode());await page.locator('#mobile').screenshot({path:'.test-output/softech-phone-section.png'});
 const routes=['/help/','/help/seans-ochish/','/help/bar-savdosi/','/help/seansni-yopish/','/help/mobil-panel/','/help/vip-postpaid/','/help/dinamik-tariflar/'];
 const links=new Set();
 for(const route of ['/',...routes]){
  const response=await page.goto(origin+route);assert.equal(response.status(),200);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${route} overflow ${width}`);}
  for(const href of await page.locator('a[href]').evaluateAll(as=>as.map(a=>a.href)))if(href.startsWith(origin))links.add(href);
  assert.ok(await page.locator('h1').count());
 }
 for(const href of links){const u=new URL(href);const response=await page.request.get(u.origin+u.pathname);assert.equal(response.status(),200,href);if(u.hash){const html=await response.text();assert.ok(html.includes(`id="${decodeURIComponent(u.hash.slice(1))}"`),`Missing anchor ${href}`);}}
 await page.goto(origin+'/help/');await page.locator('#help-search').fill('qaytim');assert.equal(await page.locator('.help-card:visible').count(),1);
 await page.locator('#help-search').fill('not_a_topic');assert.equal(await page.locator('#help-empty').isVisible(),true);
 await page.locator('#help-search').fill('to\'lov');assert.equal(await page.locator('.help-card:visible').count(),1);
 await page.goto(origin+'/help/seansni-yopish/');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.test-output/softech-help-mobile.png',fullPage:true});
 await page.goto(origin);await page.setViewportSize({width:390,height:844});await seek(.54);await page.screenshot({path:'.test-output/softech-cinema-mobile.png'});
 await page.setViewportSize({width:390,height:600});assert.equal(await page.locator('#cinema').evaluate(e=>e.classList.contains('cinema-motion')),false);assert.equal(await page.locator('.cinema-scene[inert]').count(),0);
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('#cinema').classList.contains('cinema-motion'));await seek(.22);assert.equal(await page.locator('#cinema').getAttribute('data-scene'),'1');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);assert.equal(await page.locator('.cinema-scene[inert]').count(),0);
 const reduced=await browser.newPage({reducedMotion:'reduce',viewport:{width:390,height:844}});await reduced.goto(origin);assert.equal(await reduced.locator('.reveal-ready').count(),0);assert.equal(await reduced.locator('#cinema').evaluate(e=>e.classList.contains('cinema-motion')),false);await reduced.close();
 const nojs=await browser.newPage({javaScriptEnabled:false});await nojs.goto(origin);assert.equal(await nojs.locator('#prepare-order').isDisabled(),true);assert.equal(await nojs.locator('.cinema-scene').count(),4);await nojs.goto(origin+'/help/seans-ochish/');assert.equal(await nojs.locator('.help-step').count(),4);await nojs.close();
 assert.deepEqual(errors,[]);console.log('PASS responsive layouts, continuous scene animation, reverse scroll, chapter navigation and demo removal, form draft and clipboard fallback, edit invalidation, 7 help routes and all local links, search, reduced motion and no-JS content. No business requests sent.');
}finally{await browser.close();}
