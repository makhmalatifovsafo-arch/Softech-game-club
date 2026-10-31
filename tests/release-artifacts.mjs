import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const version = process.argv[2] || '1.0.6';
const release = path.resolve('Releases/v' + version);
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'version.json'), 'utf8'));
const dotnet = process.env.DOTNET_EXE || path.resolve('.tools/dotnet/dotnet.exe');
const validator = path.resolve('tests/UpdatePolicy/bin/Debug/net8.0/UpdatePolicy.dll');
fs.mkdirSync('.test-output', { recursive: true });
const work = fs.mkdtempSync(path.resolve('.test-output/release-'));
function execute(exe, args) {
  const result = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
for (const [kind, asset] of [['client', 'SoftechClient.zip'], ['server', 'SoftechServer.zip']]) {
  const zip = path.join(release, asset);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(zip)) hash.update(chunk);
  assert.equal(hash.digest('hex'), manifest[kind].sha256);
  // Use the platform extractor without running either real GUI.
  execute('tar.exe', ['-xf', zip, '-C', work]);
  // Move all extracted files into a dedicated component directory.
  const dir = path.join(work, kind);
  fs.mkdirSync(dir);
  for (const entry of fs.readdirSync(work)) {
    if (['client','server'].includes(entry)) continue;
    fs.renameSync(path.join(work, entry), path.join(dir, entry));
  }
  execute(dotnet, [validator, '--validate', dir, version, kind]);
  const probe = JSON.parse(execute(path.join(dir, 'SoftechUpdater.exe'), ['--probe-idle']));
  assert.equal(typeof probe.idleSeconds, 'number');
  console.log('PASS release archive integrity and native helper: ' + kind);
}
const serverDir = path.join(work, 'server');
const cloudStub = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true, status: 'PENDING', version: '0.0.0' }));
});
cloudStub.listen(0, '127.0.0.1'); await once(cloudStub, 'listening');
const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const server = spawn(path.join(serverDir, 'runtime/node.exe'), ['src/server.js'], {
  cwd: serverDir, windowsHide: true,
  env: { ...process.env, PORT: String(port), SOFTECH_CLOUD_URL: 'http://127.0.0.1:' + cloudStub.address().port,
    UPDATE_MANIFEST_URL: 'http://127.0.0.1:' + cloudStub.address().port, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/health');
      const health = await response.json();
      assert.equal(health.version, version);
      ready = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, logs);
  const status = await (await fetch('http://127.0.0.1:' + port + '/api/updates/status')).json();
  assert.equal(status.silent, true);
  console.log('PASS packaged server starts using bundled Node.js and dependencies');
} finally {
  if (server.exitCode === null) { const done = once(server, 'exit'); server.kill(); await done; }
  cloudStub.closeAllConnections(); await new Promise(resolve => cloudStub.close(resolve));
}
