import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('activation UI uses local persistence result, preserves typed input during polling',async()=>{
  const elements=new Map();
  const element=id=>{ if(!elements.has(id)) elements.set(id,{id,style:{},value:'',textContent:'',innerHTML:''});return elements.get(id); };
  let ready, timer, calls=[], success=false;
  const status={state:'PENDING_ACTIVATION',hwid:'HWID-UI-12345',isOperational:false};
  const window={};
  const context=vm.createContext({window,console,
    document:{getElementById:element,createElement:()=>({style:{}}),body:{appendChild(){}},addEventListener:(_,fn)=>{ready=fn;}},
    setInterval:fn=>{timer=fn;return 1;},clearInterval(){},setTimeout(){},
    fetch:async(url,options)=>{calls.push({url,options});return {ok:url.endsWith('/status')||success,json:async()=>url.endsWith('/status')?status:{success,error:'Signature mismatch',message:'Saved'}};}
  });
  vm.runInContext(readFileSync('NetCafeServer/public/licenseGuard.js','utf8'),context);
  ready();await new Promise(r=>setImmediate(r));
  const overlay=element('softechLicenseLockOverlay');
  overlay.innerHTML='existing input DOM';element('manualLicenseKeyInput').value='real-key';
  await timer();
  assert.equal(overlay.innerHTML,'existing input DOM');
  await window.activateWithKey();
  assert.equal(element('activationKeyError').textContent,'Signature mismatch');
  assert.ok(calls.some(c=>c.url==='/api/license/activate-with-key'));
  assert.ok(calls.every(c=>c.url.startsWith('/api/license/')));
  assert.equal(element('btnActivateByKey').disabled,false);
  element('clubNameInput').value='Test Club';
  await window.requestServerActivation();
  assert.match(element('cloudRequestResult').textContent,/Signature mismatch/);
  assert.equal(element('btnSendActivationReq').disabled,false);
});
test('cloud club wizard displays returned token instead of a placeholder',()=>{
  const source=readFileSync('public/views/addClubModal.js','utf8').replace(/export /g,'');
  const context=vm.createContext({window:{},document:{},navigator:{},console});
  vm.runInContext(source+"\nwizardState.createdClub={name:'Test',api_secret_token:'real-cloud-key'};globalThis.result=renderStep3();",context);
  assert.match(context.result,/real-cloud-key/);
  assert.doesNotMatch(context.result,/SOFTECH-LICENSE-XXXX|api.qrserver.com|--cloud-token/);
});
