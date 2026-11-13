import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { waitForUpdatedServer } from './helpers/wait-for-updated-server.mjs';

async function fixture(handler, run) {
  const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
test('OTA receipt cannot bypass probation; transient 503 and stale status wait for actual readiness',async()=>{
  let healthCalls=0,statusCalls=0;
  await fixture((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/health'){
      healthCalls++;res.end(JSON.stringify({app:'NetCafeServer',status:'ok',version:'1.2.0',updatePending:healthCalls<=3}));
    }else{
      assert.ok(healthCalls>3,'Business endpoint queried during probation');statusCalls++;
      if(statusCalls===1){res.statusCode=503;res.end('{"error":"UPDATE_VERIFYING"}');}
      else res.end(JSON.stringify({currentVersion:statusCalls===2?'1.1.17':'1.2.0',activeSessions:1,error:null}));
    }
  },async url=>{
    const status=await waitForUpdatedServer(url,'1.2.0',()=>({version:'1.2.0'}),{pollMs:5,timeoutMs:3000});
    assert.equal(status.currentVersion,'1.2.0');assert.equal(status.activeSessions,1);
    assert.equal(statusCalls,3);
  });
});
test('matching receipt and healthy version still fail if server never leaves probation',async()=>{
  await fixture((req,res)=>res.end(JSON.stringify({app:'NetCafeServer',status:'ok',version:'1.2.0',updatePending:true})),async url=>{
    await assert.rejects(waitForUpdatedServer(url,'1.2.0',()=>({version:'1.2.0'}),{pollMs:5,timeoutMs:100}),/did not become ready.*pending=true/);
  });
});
test('ready health cannot accept a stale success receipt',async()=>{
  await fixture((req,res)=>{
    assert.equal(req.url,'/api/health');
    res.end(JSON.stringify({app:'NetCafeServer',status:'ok',version:'1.2.0',updatePending:false}));
  },async url=>{
    await assert.rejects(waitForUpdatedServer(url,'1.2.0',()=>({version:'1.1.17'}),{pollMs:5,timeoutMs:100}),/matching update success receipt/);
  });
});
