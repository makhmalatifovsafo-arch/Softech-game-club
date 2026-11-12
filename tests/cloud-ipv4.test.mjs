import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { isWindowsDnsFailure, requestWithIpv4 } from '../NetCafeServer/src/services/cloudIpv4.js';
import { requestCloudJson } from '../NetCafeServer/src/services/cloudConnection.js';

const dnsFailure = () => new TypeError('fetch failed', {
  cause: Object.assign(new Error('getaddrinfo ENOENT'), {code:'ENOENT',syscall:'getaddrinfo'})
});

test('Windows DNS fallback is restricted to failures before a request can be sent', () => {
  assert.equal(isWindowsDnsFailure(dnsFailure(), 'win32'), true);
  assert.equal(isWindowsDnsFailure(dnsFailure(), 'linux'), false);
  for (const error of [Object.assign(new Error(),{code:'ENOENT',syscall:'open'}), Object.assign(new Error(),{code:'ECONNRESET',syscall:'read'}), Object.assign(new Error(),{code:'ENOENT'})]) {
    assert.equal(isWindowsDnsFailure(error,'win32'),false);
  }
  assert.equal(isWindowsDnsFailure(new AggregateError([dnsFailure().cause,Object.assign(new Error(),{code:'ECONNRESET'})]),'win32'),false);
});

test('an ENOENT getaddrinfo failure sends the activation POST exactly once via IPv4, preserving Host and body', async () => {
  let received=0, lookedUp=0;
  const body=JSON.stringify({clubName:'DNS Recovery',hardwareFingerprint:'TEST-HWID'});
  const server=http.createServer(async(req,res)=>{
    received++;
    assert.equal(req.headers.host,`cloud.test:${server.address().port}`);
    assert.equal(req.url,'/api/telemetry/activation-request');
    assert.equal(req.method,'POST');
    assert.equal(req.headers['content-type'],'application/json');
    let raw='';for await(const chunk of req)raw+=chunk;
    assert.equal(raw,body);
    res.end('{"success":true,"status":"PENDING"}');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://cloud.test:${server.address().port}/api/telemetry/activation-request`;
  try {
    let attempts=0;
    const result=await requestCloudJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body},{
      platform:'win32',
      fetchImpl:async(_url,options)=>{attempts++;assert.equal(options.redirect,'error');throw dnsFailure();},
      ipv4FetchImpl:(address,options)=>requestWithIpv4(address,options,{lookupImpl:(hostname,settings,callback)=>{
        lookedUp++;assert.equal(hostname,'cloud.test');assert.equal(settings.family,4);assert.equal(settings.hints,0);
        callback(null,'127.0.0.1',4);
      }})
    });
    assert.equal(result.data.status,'PENDING');assert.equal(received,1);assert.equal(attempts,1);assert.equal(lookedUp,1);
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
});

test('fallback does not replay a sent POST when its response is lost, or disable TLS validation', async () => {
  let fallbacks=0;
  for(const code of ['ECONNRESET','CERT_HAS_EXPIRED']){
    await assert.rejects(requestCloudJson('https://cloud.test/api',{method:'POST',body:'{}'},{
      platform:'win32',fetchImpl:async()=>{throw dnsFailure();},
      ipv4FetchImpl:async()=>{fallbacks++;throw Object.assign(new Error('failure'),{code});}
    }),new RegExp(code));
  }
  assert.equal(fallbacks,2);
  let forbiddenFallback=false;
  await assert.rejects(requestCloudJson('https://cloud.test/api',{method:'POST',body:'{}'},{
    platform:'win32',fetchImpl:async()=>{throw Object.assign(new Error(),{code:'CERT_HAS_EXPIRED'});},
    ipv4FetchImpl:async()=>{forbiddenFallback=true;}
  }),/CERT_HAS_EXPIRED/);
  assert.equal(forbiddenFallback,false);
});

test('IPv4 request deadline cancels a response stalled after headers', async()=>{
  const server=http.createServer((req,res)=>{res.writeHead(200);res.write('{');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    await assert.rejects(requestCloudJson(`http://127.0.0.1:${server.address().port}/`,{}, {
      timeoutMs:100,platform:'win32',fetchImpl:async()=>{throw dnsFailure();}
    }),/TIMEOUT/);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
