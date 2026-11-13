import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
const code=html.slice(html.indexOf('    function editCustomerCredentials('),html.indexOf('    function quickSelectTopupUser('));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:400,height:750}});
 await page.setContent('<html><body></body></html>');
 await page.evaluate(()=>{
  window.clientsData=[{id:7,username:'customer_7'}];window.authToken='fixture';window.calls=[];
  window.loadClientsManagement=async()=>{};
  window.fetch=async(url,options)=>{window.calls.push({url,...options});return {ok:window.accept!==false,json:async()=>window.accept===false?{error:'Login band.'}:{success:true}};};
 });
 await page.addScriptTag({content:code});
 await page.evaluate(()=>editCustomerCredentials(7));
 await page.locator('[name=username]').fill('new_customer');
 await page.locator('[name=password]').fill('1234');
 await page.locator('[name=confirm]').fill('5678');
 await page.locator('[type=submit]').click();
 assert.equal(await page.evaluate(()=>calls.length),0);
 assert.match(await page.locator('[data-status]').innerText(),/bir xil emas/);
 await page.locator('[name=confirm]').fill('1234');
 await page.evaluate(()=>window.accept=false);
 await page.locator('[type=submit]').click();
 assert.match(await page.locator('[data-status]').innerText(),/Login band/);
 await page.evaluate(()=>window.accept=true);
 await page.locator('[type=submit]').click();
 assert.match(await page.locator('[data-status]').innerText(),/Saqlandi/);
 assert.equal(await page.locator('[name=password]').inputValue(),'');
 const request=await page.evaluate(()=>calls.at(-1));
 assert.equal(request.url,'/api/clients/7/credentials');
 assert.deepEqual(JSON.parse(request.body),{username:'new_customer',password:'1234'});
 await page.locator('[type=submit]').click();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(calls.at(-1).body)),{username:'new_customer'});
 await page.locator('[data-cancel]').click();await page.locator('dialog').waitFor({state:'detached'});
 console.log('PASS customer credentials form: confirmation, server errors, correct request, password clearing and login-only change');
} finally {await browser.close();}
