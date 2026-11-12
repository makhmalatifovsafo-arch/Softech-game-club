import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';import fs from 'node:fs';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.clock.install();let status='PENDING',message='Yuklanmoqda';
 const script=fs.readFileSync('public/views/commandTracking.js','utf8');
 await page.route('http://fixture.local/**',route=>new URL(route.request().url()).pathname.includes('/history/')?route.fulfill({json:{history:[{id:9,status,payload:{result:{message}}}]}}):route.fulfill({contentType:'text/html',body:`<body><script>localStorage.setItem('softech_access_token','test')</script><script>${script}</script></body>`}));
 await page.goto('http://fixture.local/');await page.evaluate(()=>trackRemoteCommand(7,9));await page.getByText('Kutilmoqda: Yuklanmoqda').waitFor();
 await page.reload();await page.getByText('Kutilmoqda: Yuklanmoqda').waitFor();
 status='FAILED';message='SHA256 xatosi <img src=x>';await page.clock.fastForward(6000);await page.getByText('Xatolik: '+message).waitFor();assert.equal(await page.locator('img').count(),0);
 await page.getByLabel('Buyruq holatini yopish').click();assert.equal(await page.locator('[role=status]').count(),0);
 status='EXECUTED';message='Server v1.0.35 qayta ulandi';await page.evaluate(()=>trackRemoteCommand(7,9));await page.getByText('Bajarildi: '+message).waitFor();
 console.log('PASS remote command pending, reload persistence, actual failure/success and safe text');
}finally{await browser.close();}
