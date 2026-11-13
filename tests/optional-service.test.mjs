import test from 'node:test';
import assert from 'node:assert/strict';
import { OptionalService } from '../NetCafeServer/src/services/optionalService.js';

test('failed mobile initialization preserves local operation, reports unsynced writes and recovers', async () => {
  let attempts=0, stopped=0, soon=0;
  const warnings=[];
  const service=new OptionalService('fixture',()=>{
    if(++attempts===1)throw Error('invalid saved mobile identity');
    return {start(){},stop(){stopped++;},requestSoon(){soon++;},async flush(){return true;}};
  },{retryMs:10,warn:message=>warnings.push(message)});
  try {
    service.start();service.start();
    assert.equal(attempts,1);
    assert.equal(await service.flush(),false);
    service.requestSoon();
    assert.match(warnings[0],/invalid saved mobile identity/);
    for(let i=0;i<100&&!service.service;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(await service.flush(),true);
    service.requestSoon();assert.equal(soon,1);assert.equal(attempts,2);
  }finally{service.stop();}
  assert.equal(stopped,1);
});

test('shutdown cancels pending initialization retries and cleans up partial starts', async () => {
  let attempts=0, stopped=0;
  const service=new OptionalService('fixture',()=>({start(){attempts++;throw Error('start failed');},stop(){stopped++;}}),{retryMs:10,warn(){}});
  service.start();service.stop();
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(attempts,1);assert.equal(stopped,1);
  assert.equal(await service.flush(),false);
});
