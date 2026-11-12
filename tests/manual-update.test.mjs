import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { canApplyUpdate, validateRelease } from '../NetCafeServer/src/services/updatePolicy.js';

// Execute the production coordinator with deterministic OS/helper boundaries.
// No real installed application or database is opened by these tests.
const source = fs.readFileSync('NetCafeServer/src/services/updater.js', 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export class ServerUpdater', 'class ServerUpdater') + '\nglobalThis.Updater = ServerUpdater;';
function fixture(options = {}) {
  const files = new Map();
  const timers = [];
  let now = 0, spawns = 0, probes = 0, plan, updater;
  const sandbox = {
    path, crypto: { randomUUID: () => 'test-handover' },
    fileURLToPath: () => path.resolve('fixture/src/services/updater.js'),
    promisify: () => () => {}, execFile() {},
    db: { prepare: () => ({ get: () => {
      if (options.unknownSessions) throw Error('Database unavailable');
      return { count: options.activeSessions ?? 3 };
    } }) },
    canApplyUpdate, validateRelease,
    process: { env: {}, pid: 123, execPath: 'fixture-node', platform: 'win32' },
    Date: { now: () => now },
    setTimeout(fn, ms) {
      if (ms === 100 && updater?.applying) { timers.push(fn); return; }
      now += ms;
      if (updater?.applying && options.drain !== false) updater.pendingWrites = 0;
      return Promise.resolve().then(fn);
    },
    fs: {
      existsSync: file => files.has(file),
      mkdirSync: file => files.set(file, 'directory'),
      copyFileSync() {},
      writeFileSync(file, value) {
        files.set(file, value);
        if (file.endsWith('plan.json')) plan = JSON.parse(value);
      }
    },
    spawn() {
      spawns++;
      if (!options.helperFails) files.set(plan.ReadyFile, 'ready');
      return { exitCode: options.helperFails ? 4 : null, on() {}, unref() {} };
    }
  };
  // import.meta is the only syntax that a VM script cannot evaluate.
  vm.runInNewContext(source.replace('import.meta.url', "'fixture-url'"), sandbox);
  updater = sandbox.Updater;
  updater.state = { isStaged: true, isDownloading: false, source: 'package', stagedVersion: '1.0.29' };
  updater.pendingWrites = options.pendingWrites ?? 0;
  updater.probeIdle = async () => { probes++; return options.idleSeconds ?? 0; };
  updater.onShutdown = () => {};
  return { updater, files, timers, get plan() { return plan; }, get spawns() { return spawns; }, get probes() { return probes; } };
}

test('manual install commits with active sessions and drains writes before shutdown', async () => {
  const f = fixture({ pendingWrites: 2 });
  const result = await f.updater.applyUpdate({ force: true });
  assert.equal(result.success, true);
  assert.equal(f.updater.pendingWrites, 0);
  assert.equal(f.updater.applying, true);
  assert.equal(f.updater.getActiveSessionsCount(), 3);
  assert.equal(f.files.get(f.plan.CommitFile), '1.0.29');
  assert.equal(f.probes, 0, 'An explicit click must not depend on native input idleness');
  assert.equal(f.spawns, 1);
  assert.equal(f.timers.length, 1);
});
test('automatic update still waits for sessions and cashier input; idle update works', async () => {
  for (const options of [{}, { activeSessions: 0, idleSeconds: 0 }, { activeSessions: 0, idleSeconds: 30, pendingWrites: 1 }]) {
    const f = fixture(options);
    assert.equal((await f.updater.applyUpdate()).success, false);
    assert.equal(f.spawns, 0);
    assert.equal(f.updater.preparing, false);
  }
  const f = fixture({ activeSessions: 0, idleSeconds: 30 });
  assert.equal((await f.updater.applyUpdate()).success, true);
  assert.equal(f.spawns, 1);
});
test('in-flight writes timing out cancel preparation and resume the existing server', async () => {
  const f = fixture({ pendingWrites: 1, drain: false });
  assert.equal((await f.updater.applyUpdate({ force: true })).success, false);
  assert.equal(f.files.has(f.plan.CommitFile), false);
  assert.equal(f.files.has(f.plan.CancelFile), true);
  assert.equal(f.updater.applying, false);
  assert.equal(f.updater.preparing, false);
  assert.equal(f.timers.length, 0);
});
test('duplicate clicks, failed helper and unknown session state cannot commit', async () => {
  const f = fixture();
  const first = f.updater.applyUpdate({ force: true });
  assert.equal((await f.updater.applyUpdate({ force: true })).success, false);
  assert.equal((await first).success, true);
  assert.equal(f.spawns, 1);
  for (const options of [{ helperFails: true }, { unknownSessions: true }]) {
    const failed = fixture(options);
    assert.equal((await failed.updater.applyUpdate({ force: true })).success, false);
    assert.equal(failed.updater.applying, false);
    assert.equal(failed.timers.length, 0);
    assert.equal(failed.plan && failed.files.has(failed.plan.CommitFile), options.helperFails ? false : undefined);
  }
});
