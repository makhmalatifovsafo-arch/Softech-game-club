// Isolated UI checks: no database, club process or production API requests.
import { chromium } from '../.tools/browser-test/node_modules/playwright/index.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('website/softech/dist');
const server=createServer((req,res)=>{
  let path=resolve(root,'.'+new URL(req.url,'http://test').pathname);
  if(!path.startsWith(root)) {res.writeHead(403);res.end();return;}
  if(!extname(path))path+='/index.html';
  if(!existsSync(path)){res.writeHead(404);res.end();return;}
  const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'};
  res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(readFileSync(path));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext();const errors=[];const external=[];
 await context.route('**/*',route=>{
   const url=route.request().url();
   if(url.startsWith(origin))return route.continue();
   external.push(url);return route.fulfill({status:200,contentType:'text/html',body:'Help opened'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const html=readFileSync('NetCafeServer/public/index.html','utf8');
 const links=await page.evaluate(html=>{
   const doc=new DOMParser().parseFromString(html,'text/html');
   return [...doc.querySelectorAll('a[data-help-topic]')].map(a=>({html:a.outerHTML,url:a.href,nested:!!a.parentElement.closest('button,a')}));
 },html);
 assert.equal(links.length,7);assert.ok(links.every(l=>!l.nested));
 for(const {url} of links){const u=new URL(url);assert.equal(u.search,'');assert.equal(u.hash,'');assert.ok(existsSync(root+u.pathname.replace(/^\/site/, '')+'index.html'));}
 await page.setContent('<form id="cashier"><input id="amount" value="18000">'+links.map(l=>l.html).join('')+'<button type="submit">Save</button></form>');
 await page.addStyleTag({path:'NetCafeServer/public/context-help.css'});
 await page.addScriptTag({path:'NetCafeServer/public/context-help.js'});
 await page.evaluate(()=>{window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++;};});
 await page.locator('#amount').fill('25000');
 const popupPromise=context.waitForEvent('page');await page.locator('[data-help-topic="session.start"]').click();
 const popup=await popupPromise;await popup.waitForLoadState();
 assert.equal(popup.url(),'https://softech-game-club.vercel.app/site/help/seans-ochish/');await popup.close();
 assert.equal(await page.locator('#amount').inputValue(),'25000');assert.equal(await page.evaluate(()=>window.submits),0);
 await context.setOffline(true);
 await page.locator('[data-help-topic="session.vip"]').click();
 assert.equal(await page.locator('dialog[open] h2').textContent(),'VIP Postpaid');
 await page.locator('dialog button').click();assert.equal(await page.locator('dialog[open]').count(),0);
 // Dynamic PC-bar link retains keyboard access and opens help without submitting the sale.
 const app=readFileSync('NetCafeServer/public/app.js','utf8');const dynamic=app.match(/<a class="softech-help-link" data-help-topic="bar.sale"[^]*?<\/a>/)[0];
 await page.locator('form').evaluate((form,html)=>form.insertAdjacentHTML('beforeend',html),dynamic);
 await page.locator('[data-help-topic="bar.sale"]').last().focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('dialog[open] h2').textContent(),'PC hisobiga bar qo‘shish');
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.submits),0);
 await context.setOffline(false);
 const slugs=['seans-ochish','vip-postpaid','seansni-yopish','bar-savdosi','dinamik-tariflar','mobil-panel'];
 for(const slug of slugs){
   await page.goto(origin+'/help/'+slug+'/');
   assert.equal(await page.locator('.help-step').count(),4);
   const words=(await page.locator('article').innerText()).split(/\s+/).length;assert.ok(words<280,`${slug}: ${words} words`);
   for(const width of [320,390,1366]){await page.setViewportSize({width,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),slug+' overflow '+width);}
 }
 await page.goto(origin+'/help/');assert.equal(await page.locator('.help-card').count(),6);
 await page.locator('#help-search').fill('qaytim');assert.ok(await page.locator('.help-card:visible').count()>0);
 await page.goto(origin+'/help/seansni-yopish/');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.test-output/context-help-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.equal(external.length,1,'Only the clicked help destination was opened');
 console.log('PASS: 7 contextual links + dynamic bar help, topic destinations, new tab, preserved form values, no submit, offline explanation, keyboard/Escape, 6 short responsive help pages.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
