import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new Function(script);
const start=html.indexOf("    window.addEventListener('softech-license-restored'");
assert.ok(start>0);
const dashboard=html.slice(start,html.indexOf('    // OTA SERVER UPDATES LOGIC',start));
const app=fs.readFileSync('NetCafeServer/public/app.js','utf8');
const bar=app.slice(app.indexOf('async function loadBarProducts()'),app.indexOf('function getProductIcon('));
const guard=fs.readFileSync('NetCafeServer/public/licenseGuard.js','utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let state='LOCKED_BY_ADMIN';let catalogCalls=0;
  await page.route('http://license.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/license/status')return route.fulfill({json:{state,clubName:'Saved Club',hwid:'TEST',lockMessage:'Test block'}});
    if(url.pathname.startsWith('/api/')){
      catalogCalls++;
      if(state!=='ACTIVE')return route.fulfill({status:403,json:{error:'LICENSE_BLOCKED'}});
      const responses={
        '/api/computers':[{id:'pc1',name:'Saved PC'}],'/api/stats':{totalComputers:1},'/api/tariffs':[],
        '/api/layout':{zones:[{id:1,name:'Saved room'}]},'/api/settings':{settings:{}},
        '/api/bar/items':{items:[{id:1,name:'Saved Cola',stockQuantity:19}]},'/api/bar/orders':{orders:[]}
      };
      return route.fulfill({json:responses[url.pathname]||{}});
    }
    return route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><div id="pcs"></div><div id="bar"></div><div id="barTotalStockCount"></div>
      <script>
      let authToken='fixture',computersData=[],tariffsData=[],zonesData=[],clubSettingsData={},isMainLayoutEdit=false,dashboardViewMode='table',barProducts=[],barOrders=[];
      const checkAuth=()=>fetchData();
      function renderPcTable(rows){document.getElementById('pcs').textContent=rows.map(r=>r.name).join(',');}
      function renderBarProducts(){document.getElementById('bar').textContent=barProducts.map(r=>r.name+': '+r.stockQuantity).join(',');}
      function renderStats(){}function updateVipUiState(){}function checkServerUpdates(){}function renderBarRecentOrders(){}
      ${dashboard}\n${bar}\n${guard}
      </script>`});
  });
  await page.goto('http://license.test/');
  await page.locator('#softechLicenseLockOverlay').waitFor({state:'visible'});
  // An app opened during a ban starts with empty memory, but unlock must load its saved data.
  assert.equal(await page.locator('#pcs').innerText(),'');
  state='ACTIVE';await page.evaluate(()=>window.checkLicenseNow());
  await page.getByText('Saved PC',{exact:true}).waitFor();await page.getByText('Saved Cola: 19',{exact:true}).waitFor();
  const callsAfterRecovery=catalogCalls;
  await page.evaluate(()=>window.checkLicenseNow());assert.equal(catalogCalls,callsAfterRecovery,'No reload loop while active');
  state='LOCKED_BY_ADMIN';await page.evaluate(()=>window.checkLicenseNow());
  await page.evaluate(()=>Promise.all([fetchData(),loadBarProducts(),loadBarOrders()]));
  assert.equal(await page.evaluate(()=>Array.isArray(computersData)&&computersData[0].name),'Saved PC');
  assert.equal(await page.locator('#bar').textContent(),'Saved Cola: 19');
  state='ACTIVE';await page.evaluate(()=>window.checkLicenseNow());await page.locator('#softechLicenseLockOverlay').waitFor({state:'hidden'});
  await page.getByText('Saved PC',{exact:true}).waitFor();assert.deepEqual(errors,[]);
  console.log('PASS real browser restores saved PC/bar after unlock without restart; blocked responses preserve the catalog; no reload loop');
} finally {await browser.close();}
