import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCloudUrl } from '../NetCafeServer/src/services/cloudUrl.js';
test('local cloud URL is retained and environment takes precedence', () => {
  assert.equal(resolveCloudUrl({ cloudUrl: 'https://old.example' }, { SOFTECH_CLOUD_URL: 'http://127.0.0.1:7000/' }), 'http://127.0.0.1:7000');
  assert.equal(resolveCloudUrl({ cloudUrl: 'http://localhost:7000/' }, {}), 'http://localhost:7000');
  assert.equal(resolveCloudUrl({}, {}), 'https://softech-game-club.vercel.app');
});
test('invalid cloud configuration is rejected', () => {
  for (const value of ['not a URL', 'file:///tmp/cloud', 'https://user:pass@example.com', 'https://example.com/?token=x']) {
    assert.throws(() => resolveCloudUrl({}, { SOFTECH_CLOUD_URL: value }));
  }
});
