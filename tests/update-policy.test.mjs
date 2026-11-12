import test from 'node:test';
import assert from 'node:assert/strict';
import { canApplyUpdate, validateRelease } from '../NetCafeServer/src/services/updatePolicy.js';
const idle = { staged: true, applying: false, activeSessions: 0, pendingWrites: 0, idleSeconds: 10 };
test('server auto update requires idle input and no sessions/writes', () => {
  assert.equal(canApplyUpdate(idle), true);
  for (const patch of [{ staged: false }, { applying: true }, { activeSessions: 1 },
    { activeSessions: -1 }, { pendingWrites: 1 }, { idleSeconds: 9.999 }, { idleSeconds: 0 }, { idleSeconds: -1 },
    { idleSeconds: NaN }]) assert.equal(canApplyUpdate({ ...idle, ...patch }), false);
});
test('explicit manual update skips session/input gates but never write/readiness gates', () => {
  const busy = { ...idle, manual: true, activeSessions: 12, idleSeconds: -1 };
  assert.equal(canApplyUpdate(busy), true);
  for (const patch of [{ manual: false }, { manual: 'true' }, { pendingWrites: 1 },
    { activeSessions: -1 }, { activeSessions: NaN }, { staged: false }, { applying: true }])
    assert.equal(canApplyUpdate({ ...busy, ...patch }), false);
});
test('release rejects unsafe paths, insecure downloads and missing integrity', () => {
  const manifest = { version: '1.0.6', server: { downloadUrl: 'https://example.com/v1.0.6/server.zip', sha256: 'a'.repeat(64) } };
  assert.equal(validateRelease(manifest, 'server').version, '1.0.6');
  for (const version of ['../../outside', '1.0.6;cmd', 'v1.0.6', '1.0', '1.2.3-beta'])
    assert.throws(() => validateRelease({ ...manifest, version }, 'server'));
  assert.throws(() => validateRelease({ ...manifest, server: { ...manifest.server, sha256: '' } }, 'server'));
  assert.throws(() => validateRelease({ ...manifest, server: { ...manifest.server, downloadUrl: 'http://example.com/update.zip' } }, 'server'));
});
