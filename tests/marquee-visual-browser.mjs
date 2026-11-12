import { chromium } from '../.tools/browser-test/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
const css=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const ui=html.slice(html.indexOf('    function updateMultiSelectUi()'),html.indexOf('    function renderBottomActionPanel('));
const marquee=html.slice(html.indexOf('    function initMarqueeSelection()'),html.indexOf("    // Mavzuni o'zgartirish"));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  await page.setContent(`<style>${css}</style><main id="mainContainer" style="position:relative;width:700px;height:400px"><div id="selectionMarquee"></div><div id="view-workstations" style="width:100%;height:100%"><div id="floorPlanDesksContainer">
  <div class="floor-desk" data-pc-id="busy" style="left:40px;top:40px;border:2px solid #f59e0b;background:#f59e0b15;box-shadow:0 0 12px #f59e0b30">PC-1</div>
  <div class="floor-desk" data-pc-id="free" style="left:170px;top:40px;border:2px solid #10b981;background:#10b98115;box-shadow:0 0 12px #10b98130">PC-2</div>
  <div class="floor-desk" data-pc-id="offline" style="left:350px;top:40px;border:2px solid #f43f5e;background:#f43f5e15">PC-3</div>
  </div><div id="pcGrid" style="position:absolute;top:250px"><div data-pc-id="busy" style="border:2px solid #f59e0b;background:#f59e0b15">Grid PC-1</div></div></div></main>`);
  await page.addScriptTag({content:`let selectedPcIds=new Set(), computersData=[], isMainLayoutEdit=false,isPanning=false,isSpacePressed=false; ${ui}\n${marquee}\ninitMarqueeSelection();`});
  const colors=()=>page.evaluate(()=>[...document.querySelectorAll('.floor-desk, #pcGrid > [data-pc-id]')].map(el=>({border:getComputedStyle(el).borderColor,bg:getComputedStyle(el).backgroundColor})));
  const before=await colors();
  await page.mouse.move(20,20);await page.mouse.down();await page.mouse.move(290,140,{steps:8});
  await page.waitForTimeout(250);
  let selected=await colors();
  for(const index of [0,1,3]){
    assert.equal(selected[index].border,'rgb(56, 189, 248)');
    assert.equal(selected[index].bg,'rgb(12, 74, 110)');
  }
  assert.deepEqual(selected[2],before[2]);
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>[...selectedPcIds]),['busy','free']);
  // A heartbeat replaces a selected element and changes its underlying status.
  await page.evaluate(()=>{
    const old=document.querySelector('.floor-desk');const fresh=old.cloneNode(true);
    fresh.classList.remove('pc-selected');fresh.style.borderColor='#10b981';fresh.style.backgroundColor='#10b98115';
    old.replaceWith(fresh);updateMultiSelectUi();
  });
  await page.waitForTimeout(250);
  assert.equal((await colors())[0].bg,'rgb(12, 74, 110)');
  await page.mouse.click(500,190);await page.waitForTimeout(250);
  selected=await colors();
  assert.deepEqual(selected[0],before[1],'Deselect restores the latest status color');
  for(const index of [1,2,3])assert.deepEqual(selected[index],before[index]);
  assert.deepEqual(await page.evaluate(()=>[...selectedPcIds]),[]);
  console.log('PASS real Edge: drag highlights floor/grid cards, survives mouseup/redraw and restores live status colors on deselection');
}finally{await browser.close();}
