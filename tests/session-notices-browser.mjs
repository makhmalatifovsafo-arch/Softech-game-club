import { chromium } from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();await page.clock.install();
  let dismissed=false,fail=true;
  const notice={sessionId:'one',computerName:'PC-7',durationMinutes:60,barDebt:22000,barSummary:'1 ta Cola, 2 ta Fanta <img src=x onerror=alert(1)>'};
  const script=fs.readFileSync('NetCafeServer/public/session-end-notices.js','utf8');
  await page.route('http://fixture.local/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/session-end-notices')return route.fulfill({json:{notices:dismissed?[]:[notice]}});
    if(path.endsWith('/dismiss')){if(!fail)dismissed=true;return route.fulfill({status:fail?500:200,json:{success:!fail}});}
    return route.fulfill({contentType:'text/html',body:`<script>const authToken='fixture';${script}</script>`});
  });
  await page.goto('http://fixture.local/');await page.locator('[role=alertdialog]').waitFor();
  assert.match(await page.locator('[data-title]').innerText(),/PC-7.*1 soatlik/);
  assert.match(await page.locator('[data-items]').innerText(),/1 ta Cola, 2 ta Fanta/);
  assert.equal(await page.locator('img').count(),0,'Product names are text, never executable HTML');
  await page.evaluate(n=>showSessionEndNotice(n),notice);assert.equal(await page.locator('[role=alertdialog]').count(),1);
  await page.clock.fastForward(20000);assert.equal(await page.locator('[role=alertdialog]').isVisible(),true);
  await page.getByLabel('Eslatmani yopish').click();await page.locator('[data-error]').filter({hasText:'saqlanmadi'}).waitFor();
  assert.equal(await page.locator('[role=alertdialog]').isVisible(),true);
  fail=false;await page.getByLabel('Eslatmani yopish').click();await page.locator('[role=alertdialog]').waitFor({state:'detached'});
  await page.reload();await page.clock.fastForward(11000);assert.equal(await page.locator('[role=alertdialog]').count(),0);
  console.log('PASS cashier notice: exact items, no timeout, duplicates, safe text, durable dismissal and retry');

  const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
  const quoteHelper=html.slice(html.indexOf('    async function fetchStartQuote('),html.indexOf('    // 1. Soat'));
  const hours=html.slice(html.indexOf('    function calcFromHours('),html.indexOf('    function setHoursPreset('));
  await page.goto('about:blank');
  await page.setContent(['hoursCalculatedMins','startModalDurationSummary','startModalPerPcPrice','startModalPrice','startModalTotalLabel'].map(id=>`<span id="${id}"></span>`).join(''));
  await page.addScriptTag({content:`let priceCalculationRevision=0,calcDebounceTimer=null;const targetSelectedPcIds=['pc'],currentHourlyRate=7000,authToken='test';
    const pending=[];function fetch(url,options){return new Promise(resolve=>pending.push({hours:JSON.parse(options.body).durationHours,resolve}));}
    ${quoteHelper}\n${hours}`});
  await page.evaluate(()=>calcFromHours(1));await page.clock.fastForward(200);
  await page.evaluate(()=>calcFromHours(2));await page.clock.fastForward(200);
  await page.evaluate(()=>pending[1].resolve({ok:true,json:async()=>({price:14000})}));
  await page.waitForFunction(()=>document.getElementById('startModalPrice').textContent.replace(/\D/g,'')==='14000');
  await page.evaluate(()=>pending[0].resolve({ok:true,json:async()=>({price:4900})}));
  await page.waitForTimeout(100);
  assert.equal((await page.locator('#startModalPrice').innerText()).replace(/\D/g,''),'14000');
  console.log('PASS pricing UI: stale 4900 response cannot overwrite the latest two-hour 14000 quote');
}finally{await browser.close();}
