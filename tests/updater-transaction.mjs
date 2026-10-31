// Run after building the native helper and FixtureClient. No real kiosk/process is stopped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const dotnet = process.env.DOTNET_EXE || path.resolve('.tools/dotnet/dotnet.exe');
const helper = path.resolve('SoftechUpdater/bin/Debug/net8.0-windows/win-x64/SoftechUpdater.dll');
const fixture = path.resolve('tests/FixtureClient/bin/Debug/net8.0');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out'); await sleep(50); }
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
fs.mkdirSync('.test-output', { recursive: true });
for (const scenario of ['cancel', 'concurrent', 'corrupt', 'success', 'rollback']) {
  const root = fs.mkdtempSync(path.resolve('.test-output/update-' + scenario + '-'));
  const target = path.join(root, 'target'), source = path.join(root, 'source');
  fs.cpSync(fixture, target, { recursive: true });
  fs.cpSync(fixture, source, { recursive: true });
  fs.writeFileSync(path.join(target, 'behavior.txt'), 'old');
  fs.writeFileSync(path.join(target, 'config.json'), '{"pcNumber":"PC-77"}');
  fs.writeFileSync(path.join(target, 'netcafe.db'), 'preserved-user-data');
  fs.writeFileSync(path.join(source, 'behavior.txt'), scenario === 'rollback' ? 'fail' : 'good');
  fs.writeFileSync(path.join(source, 'new-file.txt'), 'new release only');
  fs.writeFileSync(path.join(source, 'SoftechUpdater.exe'), 'fixture-only-companion');
  const files = Object.fromEntries(fs.readdirSync(source).filter(f => fs.statSync(path.join(source, f)).isFile()).map(f => [f, hash(path.join(source, f))]));
  fs.writeFileSync(path.join(source, 'update-package.json'), JSON.stringify({ version: '9.0.0', kind: 'client', files }));
  if (scenario === 'corrupt') fs.appendFileSync(path.join(source, 'behavior.txt'), 'tampered');
  const parent = spawn(dotnet, [path.join(target, 'NetCafeClient.dll')], { windowsHide: true, stdio: 'ignore' });
  const parentExit = once(parent, 'exit');
  await waitUntil(() => fs.existsSync(path.join(target, 'running.pid')));
  const plan = { Source: source, Target: target, Version: '9.0.0', Kind: 'client',
    ParentPids: [parent.pid], RestartExecutable: dotnet, RestartArguments: [path.join(target, 'NetCafeClient.dll')],
    ReadyFile: path.join(root, 'ready'), CommitFile: path.join(root, 'commit'),
    CancelFile: path.join(root, 'cancel'), HealthFile: path.join(root, 'healthy'), TimeoutSeconds: 30 };
  const planFile = path.join(root, 'plan.json'); fs.writeFileSync(planFile, JSON.stringify(plan));
  const updater = spawn(dotnet, [helper, '--plan', planFile], { windowsHide: true, stdio: 'ignore' });
  const updaterExit = once(updater, 'exit');
  try {
    if (scenario === 'corrupt') {
      const [code] = await updaterExit;
      assert.equal(code, 4);
      assert.equal(parent.exitCode, null);
    } else {
      await waitUntil(() => fs.existsSync(plan.ReadyFile) || updater.exitCode !== null);
      assert.ok(fs.existsSync(plan.ReadyFile), 'helper must prepare before stopping the application');
      assert.equal(fs.readFileSync(path.join(target, 'behavior.txt'), 'utf8'), 'old');
      if (scenario === 'concurrent') {
        const competingPlan = { ...plan, ReadyFile: path.join(root, 'second-ready') };
        const competingPath = path.join(root, 'second-plan.json');
        fs.writeFileSync(competingPath, JSON.stringify(competingPlan));
        const competing = spawn(dotnet, [helper, '--plan', competingPath], { windowsHide: true, stdio: 'ignore' });
        assert.equal((await once(competing, 'exit'))[0], 3);
        assert.equal(fs.existsSync(competingPlan.ReadyFile), false);
      }
      if (scenario === 'cancel' || scenario === 'concurrent') {
        fs.writeFileSync(plan.CancelFile, 'busy again');
        assert.equal((await updaterExit)[0], 3);
        assert.equal(parent.exitCode, null);
      } else {
        fs.writeFileSync(plan.CommitFile, 'commit');
        parent.kill(); await parentExit;
        const [code] = await updaterExit;
        assert.equal(code, scenario === 'success' ? 0 : 5);
        await waitUntil(() => {
          const pid = Number(fs.readFileSync(path.join(target, 'running.pid'), 'utf8'));
          if (pid === parent.pid) return false;
          try { process.kill(pid, 0); return true; } catch { return false; }
        });
        assert.equal(fs.readFileSync(path.join(target, 'behavior.txt'), 'utf8'), scenario === 'success' ? 'good' : 'old');
        assert.equal(fs.existsSync(path.join(target, 'new-file.txt')), scenario === 'success');
      }
    }
    assert.equal(fs.readFileSync(path.join(target, 'config.json'), 'utf8'), '{"pcNumber":"PC-77"}');
    assert.equal(fs.readFileSync(path.join(target, 'netcafe.db'), 'utf8'), 'preserved-user-data');
    console.log('PASS updater transaction: ' + scenario);
  } finally {
    if (parent.exitCode === null) { parent.kill(); await parentExit; }
    if (updater.exitCode === null) { updater.kill(); await updaterExit; }
    const pid = Number(fs.readFileSync(path.join(target, 'running.pid'), 'utf8'));
    if (pid !== parent.pid) { try { process.kill(pid); } catch {} }
  }
}
