import {chromium} from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
function fn(name){
  const re=new RegExp('^    (?:async )?function '+name+'\\(','m');
  const a=html.search(re);assert.ok(a>=0,name);
  return html.slice(a,html.indexOf('\n    }',a)+6);
}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
  await page.evaluate(()=>{
    const panel=document.getElementById('vipPricingOptionsContainer').parentElement;
    const nodes=['startTab-postpaid','vipTabLockedBadge','multiSelectActionsContainer','extendModal'].map(id=>document.getElementById(id));
    document.body.replaceChildren(panel,...nodes);
  });
  await page.addScriptTag({path:'NetCafeServer/public/vendor/tailwind-3.4.17.js'});
  await page.addScriptTag({path:'NetCafeServer/public/computer-state.js'});
  await page.addScriptTag({content:`
    let vipSettingsDirty=false,vipSettingsSaving=false,currentCtxPcId=null;
    let clubSettingsData={vip_enabled:true,vip_pricing_mode:'CUSTOM',vip_custom_price:19000};
    let computersData=[{id:'vip',name:'VIP PC',status:'OCCUPIED',isOnline:true,activeSession:{isPostpaid:true}}],tariffsData=[];
    let targetSelectedPcIds=['vip'],authToken='fixture';
    window.calls=[];window.failSave=false;window.saved={...clubSettingsData};
    window.showToast=()=>{};window.alert=()=>{};window.escapeHtml=s=>String(s);
    window.closeModal=id=>document.getElementById(id).classList.add('hidden');window.closeContextMenu=()=>{};
    window.fetch=async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});
      if(failSave)throw Error('Simulated disconnection');
      saved={...saved,...JSON.parse(options.body)};
      return {ok:true,json:async()=>({settings:{...saved}})};
    };
    ${['updateVipUiState','renderVipSettings','toggleVipControls','onVipPricingModeChange','saveVipSettings','canExtendPcSession','renderBottomActionPanel','openExtendModal','handleCtxQuickExtend','handleExtendSubmit'].map(fn).join('\n')}
    renderVipSettings();
  `});
  const toggle=page.locator('#vipEnabledToggle'),save=page.locator('#btnSaveVipSettings');
  await page.locator('#vipCustomPriceInput').fill('0');
  await toggle.locator('..').click(); // Actual visible switch; Save must still receive clicks.
  assert.equal(await toggle.isChecked(),false);
  assert.equal(await page.locator('#vipCustomPriceInput').isDisabled(),true);
  assert.equal(await save.isEnabled(),true);
  await page.evaluate(()=>updateVipUiState()); // A heartbeat must not undo unsaved edits.
  assert.equal(await toggle.isChecked(),false);
  await page.evaluate(()=>failSave=true);await save.click();
  await page.waitForFunction(()=>!vipSettingsSaving);
  assert.equal(await toggle.isChecked(),false);assert.equal(await save.isEnabled(),true);
  await page.evaluate(()=>failSave=false);await save.click();
  await page.waitForFunction(()=>saved.vip_enabled===false&&!vipSettingsSaving);
  assert.deepEqual(await page.evaluate(()=>calls.at(-1)),{url:'/api/admin/settings',body:{vip_enabled:false}});
  assert.equal(await page.evaluate(()=>saved.vip_custom_price),19000,'Disable preserves the stored rate, even if its abandoned draft was invalid');
  assert.equal(await page.locator('#startTab-postpaid').isDisabled(),true);
  await page.evaluate(()=>{vipSettingsDirty=false;renderVipSettings();});
  assert.equal(await toggle.isChecked(),false,'Reopening reflects the saved disabled state');
  await toggle.locator('..').click();await save.click();
  await page.waitForFunction(()=>saved.vip_enabled&&!vipSettingsSaving);
  assert.equal(await page.locator('#startTab-postpaid').isDisabled(),false);
  assert.equal(await page.locator('#vipCustomPriceInput').inputValue(),'19000');
  const count=await page.evaluate(()=>calls.length);
  await page.evaluate(async()=>{
    renderBottomActionPanel(computersData[0]);
    openExtendModal('vip');currentCtxPcId='vip';await handleCtxQuickExtend(30);
    document.getElementById('extendPcId').value='vip';
    await handleExtendSubmit({preventDefault(){}});
  });
  assert.equal(await page.locator('#multiSelectActionsContainer [onclick*="openExtendModal"]').count(),0);
  assert.equal(await page.locator('#extendModal').isVisible(),false);
  assert.equal(await page.evaluate(()=>calls.length),count,'Stale VIP extension actions send no request');
  await page.evaluate(()=>{computersData[0].activeSession.isPostpaid=false;renderBottomActionPanel(computersData[0]);});
  assert.equal(await page.locator('#multiSelectActionsContainer [onclick*="openExtendModal"]').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS VIP controls: clickable disable/save, failed-save retry, refresh preserves draft, enable restoration, map toolbar and stale extension guards');
}finally{await browser.close();}
