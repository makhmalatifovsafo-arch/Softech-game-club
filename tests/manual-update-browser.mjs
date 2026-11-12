// Optional real Edge check of the production sidebar markup and update controller.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '../.tools/browser-test/node_modules/playwright/index.mjs';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
const panel=html.match(/<section id="sidebarUpdate"[\s\S]*?<\/section>/)[0];
const controller=html.slice(html.indexOf('    let currentServerUpdateStatus = null;'),html.indexOf('    function renderStats(stats)'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  let requests=[],healthChecks=0,navigations=0,fail=false;
  const status={currentVersion:'1.0.28',latestVersion:'1.0.29',stagedVersion:'1.0.29',updateAvailable:true,isStaged:true,activeSessions:3,silent:true};
  await page.route('http://fixture.local/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/updates/status')return route.fulfill({json:status});
    if(url.pathname==='/api/updates/apply'){
      requests.push(route.request().postDataJSON());
      await new Promise(r=>setTimeout(r,300));
      return route.fulfill({status:fail?400:200,json:fail?{success:false,error:'Test preparation failed'}:{success:true}});
    }
    if(url.pathname==='/api/health'){healthChecks++;return route.fulfill({json:{version:healthChecks>1?'1.0.29':'1.0.28'}});}
    navigations++;
    return route.fulfill({contentType:'text/html',body:`<style>.hidden{display:none}</style><div id="sidebarFooter">${panel}</div><script>const authToken='fixture'; const showToast=(message)=>window.toast=message; ${controller}</script>`});
  });
  await page.goto('http://fixture.local/');
  await page.evaluate(s=>renderUpdateBadge({...s,isStaged:false,isDownloading:true}),status);
  const button=page.locator('#sidebarUpdateInstall');
  assert.equal(await button.isVisible(),true);
  assert.equal(await button.isDisabled(),true);
  await page.evaluate(s=>renderUpdateBadge(s),status);
  assert.equal(await button.isEnabled(),true,'Busy sessions must not disable an explicit install');
  await button.click();
  await page.evaluate(()=>{void applyServerUpdate(true);});
  assert.equal(await button.isDisabled(),true);
  await page.waitForFunction(()=>window.location.pathname==='/' && document.querySelector('#sidebarUpdate').classList.contains('hidden'),{},{timeout:10000});
  assert.equal(navigations,2,'Reload only after the target version answers health');
  assert.equal(healthChecks,2);
  assert.deepEqual(requests,[{force:true}],'One click, one explicit manual request; duplicate is ignored');
  fail=true;
  await page.evaluate(s=>renderUpdateBadge(s),status);
  await button.click();
  await page.waitForFunction(()=>window.toast==='Test preparation failed');
  assert.equal(await button.isEnabled(),true,'Failed preparation allows retry');
  await page.evaluate(s=>renderUpdateBadge({...s,isStaged:false,updateAvailable:false}),status);
  assert.equal(await button.isVisible(),false);
  console.log('PASS: real Edge sidebar download/ready/busy states, manual click, duplicate suppression, version-aware reload and retry');
}finally{await browser.close();}
