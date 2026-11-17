import assert from 'node:assert/strict';
export async function setupFirstRun({url}){
  const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'manager',password:'Softech006'})});
  const token=(await login.json()).token;
  async function call(route,method='GET',body){const r=await fetch(url+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
  assert.equal((await call('/api/setup/status')).body.required,true);
  assert.equal((await call('/api/sessions/start','POST',{})).body.code,'SETUP_REQUIRED');
  const context=await call('/api/setup/context'),state=await call('/api/setup/draft');
  const draft=context.body.initialDraft;draft.rooms=[{id:'hall',name:'Setup hall',type:'STANDARD',x:0,y:0,width:400,height:300}];
  assert.equal(draft.computers.length,1);Object.assign(draft.computers[0],{roomId:'hall',x:80,y:80});
  draft.tariffs=[{id:'rate',roomId:'hall',name:'Setup hourly',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:7000,vipAllowed:true}];
  const saved=await call('/api/setup/draft','PUT',{revision:state.body.revision,draft,baseFingerprint:context.body.fingerprint});assert.equal(saved.status,200);
  const request={requestId:'first-run-integration-0001',revision:saved.body.revision};
  const [applied,duplicate]=await Promise.all([call('/api/setup/complete','POST',request),call('/api/setup/complete','POST',request)]);
  assert.equal(applied.status,200,JSON.stringify(applied.body));assert.deepEqual(duplicate,applied);
  assert.deepEqual((await call('/api/setup/complete','POST',request)).body,applied.body);
  assert.equal((await call('/api/setup/status')).body.required,false);
  const pcs=(await call('/api/computers')).body;
  const quote=await call('/api/tariffs/calculate','POST',{computerId:pcs[0].id,durationHours:1});
  assert.equal(quote.status,200,JSON.stringify(quote.body));assert.equal(quote.body.price,7000,'existing billing engine uses the applied room rate');
  console.log('PASS real first-run API: new club business gate, live client, atomic completion, receipt retry and readiness');
}
