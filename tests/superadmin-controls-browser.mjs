import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Load the actual page and complete ES module graph. Testing the modal alone
// misses dashboard.js replacing its global handlers after imports finish.
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const [source,width] of [['public',390],['SoftechCloudAdmin/public',1280]]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.addInitScript(()=>localStorage.setItem('softech_access_token','fixture'));
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const errors=[],sent=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='http://controls.test')return route.abort();
      if(url.pathname.startsWith('/api/')){
        if(route.request().method()==='POST'){
          sent.push({url:url.pathname,...route.request().postDataJSON()});
          return route.fulfill({json:{success:true,message:'Queued',commandId:123}});
        }
        if(url.pathname==='/api/telemetry/clubs')return route.fulfill({json:{success:true,clubs:[7,8].map(id=>({id,name:'Club '+id,status:'ACTIVE',is_online:true,computers_count:3,today_revenue:0}))}});
        return route.fulfill({json:{success:true,version:'1.1.0',requests:[],history:[]}});
      }
      const root=path.resolve(source),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      const type={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
      return route.fulfill({contentType:type,body:fs.readFileSync(file)});
    });
    await page.goto('http://controls.test/');
    await page.locator('#navTabClubs').click();
    const open=id=>page.locator(`button[onclick^="openRemoteCommandModal(${id},"]`).click();
    const modal=page.locator('#remoteCommandModal');
    await open(7);
    await modal.getByRole('button',{name:/Xabar$/}).click();
    assert.equal(await modal.locator('#inputBroadcastTarget').inputValue(),'SINGLE');
    await modal.locator('#inputBroadcastMessage').fill('Club 7 uchun sinov xabari');
    await modal.getByRole('button',{name:'Xabarni Yuborish'}).click();
    await modal.waitFor({state:'hidden'});
    assert.equal(sent[0].url,'/api/telemetry/commands/7');
    assert.equal(sent[0].action,'BROADCAST_ANNOUNCEMENT');
    assert.equal(sent[0].payload.message,'Club 7 uchun sinov xabari');
    assert.equal(sent[0].payload.requireDismiss,true);
    await open(8);
    await modal.getByRole('button',{name:/Litsenziya$/}).click();
    await modal.getByText('Faollashtirish',{exact:true}).waitFor();
    await modal.getByRole('button',{name:/Server$/}).click();
    await modal.getByRole('button',{name:'Eng yangi versiyaga majburiy yangilash'}).click();
    await modal.waitFor({state:'hidden'});
    assert.equal(sent[1].url,'/api/telemetry/commands/8');assert.equal(sent[1].action,'FORCE_UPDATE');
    await open(7);await modal.getByRole('button',{name:/Server$/}).click();
    await modal.getByRole('button',{name:'Darhol',exact:true}).click();
    await modal.getByRole('button',{name:'Serverni Qayta Ishga Tushirish',exact:false}).click();
    await modal.waitFor({state:'hidden'});
    assert.equal(sent[2].action,'RESTART_SERVER');assert.equal(sent[2].payload.delaySeconds,0);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${source}: actual club controls show Xabar, dispatch to selected club, reopen correctly and retain license/restart/force-update actions`);
    await context.close();
  }
} finally {await browser.close();}
