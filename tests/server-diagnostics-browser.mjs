import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  let releaseFirst,unavailable=false;
  const holdFirst=new Promise(resolve=>releaseFirst=resolve);
  await page.route('http://diagnostics.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/views/'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('public'+url.pathname,'utf8')});
    const main=url.pathname.match(/^\/api\/telemetry\/clubs\/(\d+)$/);
    if(main)return route.fulfill({json:{success:true,club:{id:Number(main[1]),name:'Club '+main[1],status:'OFFLINE',last_heartbeat_at:'2026-01-01T00:00:00Z'},kassa:{},workstations:[]}});
    const diag=url.pathname.match(/^\/api\/clubs\/(\d+)\/diagnostics$/);
    if(diag){
      if(diag[1]==='10')await holdFirst;
      if(unavailable)return route.fulfill({status:503,json:{success:false}});
      return route.fulfill({json:{success:true,diagnostic:{receivedAt:new Date().toISOString(),report:{observedAt:new Date().toISOString(),backendState:'FAILED',errorCode:'CONFIG_INVALID',configState:'INVALID',serverVersion:'1.1.'+diag[1],launcherVersion:'1.1.18',freeDiskBytes:100,lastBackupAt:null,backupError:'UNKNOWN'}}}});
    }
    return route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><div id="dashboardContent"></div><script>localStorage.setItem("softech_access_token","fixture")</script><script type="module">import * as app from "/views/clubDetail.js";window.app=app;</script>'});
  });
  await page.goto('http://diagnostics.test/');await page.waitForFunction(()=>window.app);
  await page.evaluate(()=>window.openClubDetailInspector(10));
  assert.match(await page.locator('#dashboardContent').innerText(),/Club 10/);
  assert.match(await page.locator('[data-server-diagnostics]').innerText(),/yuklanmoqda/,'Slow diagnostics must not block the club screen');
  await page.evaluate(()=>window.openClubDetailInspector(11));
  await page.getByText('Launcher bilan aloqa bor',{exact:true}).waitFor();
  releaseFirst();
  await page.waitForFunction(()=>window.app.clubInspectorState.diagnostic?.report.serverVersion==='1.1.11');
  assert.equal(await page.locator('[data-server-diagnostics]').getAttribute('data-server-diagnostics'),'11');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Diagnostikani yuklab olish'}).click();
  const download=await downloadPromise;assert.equal(download.suggestedFilename(),'Softech-Club-11-Diagnostics.json');
  const contents=fs.readFileSync(await download.path(),'utf8');assert.ok(!contents.includes('signedLicense'));assert.equal(JSON.parse(contents).report.errorCode,'CONFIG_INVALID');
  unavailable=true;await page.evaluate(()=>window.refreshClubDetailInspector());
  await page.getByText(/Diagnostikani yuklab bo‘lmadi/).waitFor();
  assert.match(await page.locator('#dashboardContent').innerText(),/Club 11/);
  assert.deepEqual(errors,[]);
  console.log('PASS diagnostic UI: nonblocking fetch, club isolation, safe download, missing migration and no browser errors');
}finally{await browser.close();}
