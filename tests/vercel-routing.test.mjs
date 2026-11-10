import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPERADMIN_JWT_SECRET = 'routing-test-access-secret-at-least-32-bytes';
process.env.REFRESH_SECRET = 'routing-test-refresh-secret-at-least-32-bytes';

for (const prefix of ['', 'SoftechCloudAdmin/']) {
  test(prefix + 'deploys one API function with a catch-all rewrite', async () => {
    const apiDirectory = new URL('../' + prefix + 'api/', import.meta.url);
    const entries = await readdir(apiDirectory, { recursive: true, withFileTypes: true });
    assert.deepEqual(entries.filter(entry => entry.isFile()).map(entry => entry.name), ['index.js']);
    const config = JSON.parse(await readFile(new URL('../' + prefix + 'vercel.json', import.meta.url), 'utf8'));
    assert.ok(config.rewrites.some(rule => rule.source === '/api/:path*' && rule.destination === '/api/index?route=:path*'));
  });
  const { default: handler } = await import('../' + prefix + 'api/index.js');
  const { SupabaseCloudService } = await import('../' + prefix + 'src/services/supabaseClient.js');
  async function request(url, body) {
    let result;
    const res = { setHeader() {}, end(raw) { result = { status: this.statusCode, body: JSON.parse(raw) }; } };
    await handler({ url, method: body ? 'POST' : 'GET', body,
      headers: { host: 'localhost', 'x-matched-path': '/api/index' } }, res);
    return result;
  }
  test(prefix + 'rewritten PIN routes authenticate and preserve the client URL over platform metadata', async () => {
    SupabaseCloudService.verifyPinCode = async pin => pin === '2468' ? { id: 1, username: 'test' } : null;
    for (const route of ['/api/auth/pin-login', '/api/auth/verify-pin', '/api/index?route=auth/pin-login', '/api/index?route=auth/verify-pin']) {
      assert.equal((await request(route, { pinCode: 'invalid' })).status, 400, route);
      assert.equal((await request(route, { pinCode: '0000' })).status, 401, route);
      const result = await request(route, { pinCode: '2468' });
      assert.equal(result.status, 200, route);
      assert.ok(result.body.accessToken);
      assert.ok(result.body.refreshToken);
    }
    assert.equal((await request('/api/index?route=auth/me')).status, 401);
  });
  test(prefix + 'rewritten mobile route keeps its query and reaches mobile validation', async () => {
    const result = await request('/api/index?route=mobile/connection&club=invalid');
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Klub raqamini/);
  });
}
