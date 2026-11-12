import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { describeCloudError, requestCloudJson } from '../NetCafeServer/src/services/cloudConnection.js';

const address = 'https://cloud.example/api/telemetry/activation-status?hwid=private';
const networkError = code => new TypeError('fetch failed', { cause: Object.assign(new Error('socket'), { code }) });

test('Windows ENOENT reports the failing operation and does not confuse DNS with missing files', () => {
  const dnsError = networkError('ENOENT');
  dnsError.cause.syscall = 'getaddrinfo';
  const result = describeCloudError(dnsError, address);
  assert.match(result.message, /Windows DNS/);
  assert.match(result.message, /ENOENT; getaddrinfo/);
  assert.equal(result.syscall, 'getaddrinfo');
  const fileError = networkError('ENOENT');
  fileError.cause.syscall = 'open';
  assert.doesNotMatch(describeCloudError(fileError, address).message, /Windows DNS/);
  assert.match(describeCloudError(fileError, address).message, /ENOENT; open/);
});

test('DNS, TLS, refused connection and timeout keep actionable causes without exposing request data', () => {
  for (const [code, message] of [['ENOTFOUND', /DNS/], ['CERT_HAS_EXPIRED', /sertifikat/], ['ECONNREFUSED', /rad etdi/], ['UND_ERR_CONNECT_TIMEOUT', /vaqtda/]]) {
    const result = describeCloudError(networkError(code), address);
    assert.equal(result.code, code);
    assert.match(result.message, message);
    assert.match(result.message, /cloud.example/);
    assert.doesNotMatch(result.message, /hwid|private/);
  }
  const aggregate = new TypeError('fetch failed', {cause:new AggregateError([networkError('ECONNRESET').cause])});
  assert.equal(describeCloudError(aggregate, address).code, 'ECONNRESET');
});

test('a transient read failure recovers once, while POSTs and TLS failures are never replayed', async () => {
  let calls = 0;
  const fetchImpl = async () => { if (++calls === 1) throw networkError('ECONNRESET'); return new Response('{"status":"PENDING"}'); };
  assert.equal((await requestCloudJson(address, {}, {fetchImpl})).data.status, 'PENDING');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(requestCloudJson(address, {method:'POST',body:'{}'}, {fetchImpl}), /ECONNRESET/);
  assert.equal(calls, 1, 'Do not send duplicate Telegram notifications');
  calls = 0;
  await assert.rejects(requestCloudJson(address, {}, {fetchImpl:async()=>{calls++;throw networkError('CERT_HAS_EXPIRED');}}), /CERT_HAS_EXPIRED/);
  assert.equal(calls, 1);
});

test('cloud HTTP and non-JSON failures remain distinct from transport failures', async () => {
  const result = await requestCloudJson(address, {}, {fetchImpl:async()=>new Response('{"error":"Migration required"}', {status:503})});
  assert.equal(result.response.status, 503);
  assert.equal(result.data.error, 'Migration required');
  await assert.rejects(requestCloudJson(address, {}, {fetchImpl:async()=>new Response('<html>unavailable</html>', {status:502})}), /HTTP 502/);
});

test('the deadline also cancels a stalled response body after headers arrived', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.write('{"status":');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(requestCloudJson(`http://127.0.0.1:${server.address().port}/`, {}, {timeoutMs:100}), /TIMEOUT/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
