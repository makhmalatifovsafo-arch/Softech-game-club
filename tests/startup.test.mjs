import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(url, child, logs) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + logs());
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return response; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Startup timeout: ' + logs());
}
test('isolated cloud and club server start and accept a client handshake', { timeout: 45000 }, async () => {
  mkdirSync('.test-output', { recursive: true });
  const fixture = mkdtempSync(path.resolve('.test-output/startup-'));
  const cloud = path.join(fixture, 'cloud');
  const club = path.join(fixture, 'club');
  for (const [source, target] of [['SoftechCloudAdmin', cloud], ['NetCafeServer', club]]) {
    mkdirSync(target);
    for (const file of ['src', 'public', 'package.json']) cpSync(path.join(source, file), path.join(target, file), { recursive: true });
  }
  cpSync('NetCafeServer/schema.sql', path.join(club, 'schema.sql'));
  writeFileSync(path.join(cloud, 'config.json'), JSON.stringify({ telegram: { botToken: 'MOCK_TEST', adminChatId: '' } }));
  writeFileSync(path.join(club, 'config.json'), JSON.stringify({ supabaseUrl: 'https://xyzcompany.supabase.co', supabaseAnonKey: 'mock_key', clubId: 1 }));
  const cloudPort = await freePort();
  const clubPort = await freePort();
  const env = { ...process.env, NODE_ENV: 'test', VERCEL: '', AWS_LAMBDA_FUNCTION_NAME: '',
    SOFTECH_CLOUD_DATA_DIR: path.join(cloud, 'data'),
    SUPERADMIN_INITIAL_PASSWORD: 'isolated-startup-password', SUPERADMIN_INITIAL_PIN: '2468',
    SUPERADMIN_JWT_SECRET: 'isolated-test-secret-at-least-32-bytes', REFRESH_SECRET: 'isolated-test-refresh-secret-at-least-32-bytes',
    TELEGRAM_BOT_TOKEN: 'MOCK_TEST', TELEGRAM_ADMIN_CHAT_ID: '', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    SOFTECH_CLOUD_URL: 'http://127.0.0.1:' + cloudPort,
    UPDATE_MANIFEST_URL: 'http://127.0.0.1:' + cloudPort + '/test-no-update' };
  const children = [];
  let socket;
  function start(dir, port) {
    const child = spawn(process.execPath, ['src/server.js'], { cwd: dir, env: { ...env, PORT: String(port) }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    children.push(child);
    return { child, logs: () => logs };
  }
  try {
    const c = start(cloud, cloudPort);
    const loginPage = await waitFor(env.SOFTECH_CLOUD_URL + '/login', c.child, c.logs);
    assert.match(await loginPage.text(), /html/i);
    const login = await fetch(env.SOFTECH_CLOUD_URL + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: env.SUPERADMIN_INITIAL_PASSWORD }) });
    assert.equal(login.status, 200);
    const accessToken = (await login.json()).accessToken;
    assert.ok(accessToken);
    let s = start(club, clubPort);
    const health = await waitFor('http://127.0.0.1:' + clubPort + '/api/health', s.child, s.logs);
    assert.equal((await health.json()).status, 'ok');
    const localUrl = 'http://127.0.0.1:' + clubPort;
    const jsonHeaders = { 'Content-Type': 'application/json' };
    const adminHeaders = { ...jsonHeaders, Authorization: 'Bearer ' + accessToken };
    const request = await fetch(localUrl + '/api/license/request-activation', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ clubName: "O'yin Club" }) });
    const requested = await request.json();
    assert.equal(requested.success, true, JSON.stringify(requested) + c.logs());
    assert.equal(requested.notification.success, false);
    const approval = await fetch(env.SOFTECH_CLOUD_URL + '/api/telemetry/activation-requests/' + requested.requestId + '/approve', {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ days: 90, maxPcs: 24 })
    });
    const approved = await approval.json();
    assert.equal(approval.status, 200, JSON.stringify(approved));
    let report;
    for (let attempt = 0; attempt < 80; attempt++) {
      report = await (await fetch(localUrl + '/api/license/status')).json();
      if (report.isOperational) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(report.isOperational, true, JSON.stringify(report) + s.logs());
    const registered = await fetch(env.SOFTECH_CLOUD_URL + '/api/telemetry/clubs', {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ name: 'Key Club', ownerName: 'Test Owner', ownerPhone: '+998901234567', licenseDays: 365, totalWorkstations: 30 })
    });
    const registeredBody = await registered.json();
    assert.equal(registered.status, 201, JSON.stringify(registeredBody));
    // A key already assigned to another club cannot steal this server's HWID.
    const denied = await fetch(localUrl + '/api/license/activate-with-key', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ licenseKey: registeredBody.club.api_secret_token })
    });
    assert.equal(denied.status, 400);
    assert.equal((await (await fetch(localUrl + '/api/license/status')).json()).isOperational, true);
    const byKey = await fetch(localUrl + '/api/license/activate-with-key', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ licenseKey: approved.club.api_secret_token })
    });
    assert.equal(byKey.status, 200, await byKey.text());
    const stopped = once(s.child, 'exit');
    s.child.kill(); await stopped;
    s = start(club, clubPort);
    await waitFor(localUrl + '/api/health', s.child, s.logs);
    assert.equal((await (await fetch(localUrl + '/api/license/status')).json()).isOperational, true, s.logs());


    socket = new WebSocket('ws://127.0.0.1:' + clubPort + '/ws');
    await once(socket, 'open');
    const message = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'CLIENT_HELLO', payload: { pcNumber: 'PC-01', macAddress: '02:00:00:00:00:01', ipAddress: '127.0.0.1' } }));
    const [raw] = await Promise.race([message, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('No handshake response: ' + s.logs())), 5000); timer.unref(); })]);
    assert.ok(JSON.parse(raw.toString()).type);
  } finally {
    socket?.terminate();
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    }
  }
});
