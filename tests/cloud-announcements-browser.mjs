import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';import fs from 'node:fs';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const sender=await browser.newPage();let sent;
 const senderScript=fs.readFileSync('public/views/remoteControlModal.js','utf8').replaceAll('export ','');
 await sender.route('http://sender.test/**',async route=>{
  if(route.request().url().includes('/api/')){sent={url:route.request().url(),...route.request().postDataJSON()};await route.fulfill({json:{success:true,commandId:1}});}
  else await route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><style>.hidden{display:none}</style><div id="remoteCommandModal"></div><div id="toastNotification"></div><script>${senderScript}</script>`});
 });
 await sender.goto('http://sender.test/');
 await sender.evaluate(()=>{openRemoteCommandModal(7,'Club <img src=x>');switchRemoteTab('BROADCAST');});
 assert.equal(await sender.locator('img').count(),0);
 assert.equal(await sender.locator('#selectBroadcastDuration').count(),0);
 assert.equal(await sender.locator('#inputBroadcastTarget').inputValue(),'SINGLE');
 await sender.locator('#inputBroadcastMessage').fill('Salom, klub!\nSoftech xabari.');
 await sender.getByRole('button',{name:'Xabarni Yuborish'}).click();
 await sender.locator('#remoteCommandModal').waitFor({state:'hidden'});
 assert.equal(sent.url,'http://sender.test/api/telemetry/commands/7');assert.equal(sent.action,'BROADCAST_ANNOUNCEMENT');assert.equal(sent.payload.requireDismiss,true);

 const page=await browser.newPage({viewport:{width:1280,height:800}});await page.clock.install();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let notices=[{id:1,title:'Texnik xabar',message:'Hurmatli administrator!\nBugun 22:00 da yangilanish tayyor bo‘ladi.\n<img src=x onerror=alert(1)>'},{id:2,title:'Ikkinchi xabar',message:'Navbatdagi xabar'}],failDismiss=false;
 const receiverScript=fs.readFileSync('NetCafeServer/public/cloud-announcements.js','utf8');
 await page.route('http://receiver.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/dismiss')){
   if(failDismiss)return route.fulfill({status:503,json:{error:'offline'}});
   notices=notices.filter(n=>n.id!==Number(url.pathname.split('/')[3]));return route.fulfill({json:{success:true}});
  }
  if(url.pathname==='/api/cloud-announcements')return route.fulfill({json:{notices}});
  return route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><script>localStorage.setItem('softech_token','fixture')</script><script>${receiverScript}</script>`});
 });
 await page.goto('http://receiver.test/');await page.getByRole('alertdialog').waitFor();
 assert.equal(await page.locator('#softechMessageHeading').innerText(),"Sizga Softech'dan yangi xabar!");
 assert.equal(await page.locator('#softechAnnouncements img').count(),0);
 await page.clock.fastForward(180000);await page.keyboard.press('Escape');await page.mouse.click(5,5);
 assert.equal(await page.getByRole('alertdialog').isVisible(),true);assert.match(await page.locator('#softechMessageBody').innerText(),/Hurmatli administrator/);
 await page.reload();await page.getByRole('alertdialog').waitFor();
 await page.screenshot({path:'.test-output/softech-announcement.png',fullPage:true});
 failDismiss=true;await page.getByLabel('Softech xabarini yopish').click();
 await page.getByText('Xabar yopilgani saqlanmadi. Qayta urinib ko‘ring.').waitFor();
 assert.equal(await page.getByRole('alertdialog').isVisible(),true);
 failDismiss=false;await page.getByLabel('Softech xabarini yopish').click();await page.getByText('Navbatdagi xabar',{exact:true}).waitFor();
 await page.reload();await page.getByText('Navbatdagi xabar',{exact:true}).waitFor();
 await page.getByLabel('Softech xabarini yopish').click();await page.getByRole('alertdialog').waitFor({state:'detached'});
 await page.reload();await page.clock.fastForward(10000);assert.equal(await page.getByRole('alertdialog').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS selected-club sender, fixed large header, safe text, no timer/Escape/backdrop dismissal, reload persistence, queue and retry after failed dismissal');
} finally {await browser.close();}
