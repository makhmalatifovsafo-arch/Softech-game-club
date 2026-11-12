import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('blocked/failed dashboard requests preserve the last valid catalog',async()=>{
  const html=readFileSync('NetCafeServer/public/index.html','utf8');
  const start=html.indexOf('    async function fetchData()');
  const source=html.slice(start,html.indexOf('    // OTA SERVER UPDATES LOGIC',start));
  const original=[{id:'pc_1',name:'Saved PC'}];
  let mode='blocked',statsRenders=0;
  const context=vm.createContext({authToken:'test',console:{error(){}},window:{},
    computersData:original,tariffsData:[{id:'rate'}],zonesData:[{id:5}],clubSettingsData:{},isMainLayoutEdit:false,
    dashboardViewMode:'table',renderStats(){statsRenders++;},renderPcTable(){},checkServerUpdates(){},updateVipUiState(){},
    fetch:async url=>({ok:mode==='active',status:mode==='blocked'?403:503,json:async()=>mode!=='active'?{error:'LICENSE_BLOCKED'}:
      url==='/api/computers'?[{id:'pc_1',name:'Saved PC'}]:url==='/api/tariffs'?[]:url==='/api/layout'?{zones:[{id:5}]}:{}})});
  vm.runInContext(source,context);
  await context.fetchData();assert.equal(context.computersData,original);assert.equal(statsRenders,0);
  mode='offline';await context.fetchData();assert.equal(context.computersData,original);
  mode='active';await context.fetchData();assert.equal(context.computersData[0].name,'Saved PC');assert.equal(statsRenders,1);
});

test('license recovery notifies the dashboard once per blocked-to-active transition',async()=>{
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{id,style:{},innerHTML:'',textContent:''});return elements.get(id);};
  let state='ACTIVE',poll;const events=[];
  const window={dispatchEvent:event=>events.push(event.type)};
  vm.runInNewContext(readFileSync('NetCafeServer/public/licenseGuard.js','utf8'),{window,console,AbortSignal,Event,
    setTimeout(){},setInterval:fn=>{poll=fn;},document:{getElementById:element,addEventListener:(_,fn)=>fn()},
    fetch:async()=>({ok:true,json:async()=>({state})})});
  await new Promise(r=>setImmediate(r));assert.equal(events.length,0);
  for(const blocked of ['LOCKED_BY_ADMIN','EXPIRED','PENDING_ACTIVATION']){
    state=blocked;await poll();assert.equal(element('softechLicenseLockOverlay').style.display,'flex');
    state='ACTIVE';await poll();await poll();assert.equal(element('softechLicenseLockOverlay').style.display,'none');
  }
  assert.deepEqual(events,['softech-license-restored','softech-license-restored','softech-license-restored']);
});
