import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import crypto from 'node:crypto';

mkdirSync('.test-output', { recursive: true });
process.env.SOFTECH_CLOUD_DATA_DIR = mkdtempSync(path.resolve('.test-output/auth-'));
process.env.SUPERADMIN_INITIAL_PASSWORD = 'test-only-initial-password';
process.env.SUPERADMIN_INITIAL_PIN = '2468';
process.env.SUPERADMIN_JWT_SECRET = 'test-access-secret-with-at-least-32-bytes';
process.env.REFRESH_SECRET = 'test-refresh-secret-with-at-least-32-bytes';
// No connected accounts or production data are used by these tests.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

async function call(handler, route, body, token) {
  const req = new PassThrough();
  Object.assign(req, { method: body === undefined ? 'GET' : 'POST', url: route,
    headers: { host: 'localhost', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    socket: { remoteAddress: '127.0.0.1' } });
  let result;
  const res = { statusCode: 200, setHeader() {}, writeHead(code) { this.statusCode = code; },
    end(data) { result = { status: this.statusCode, body: JSON.parse(data) }; } };
  const task = handler(req, res, route);
  req.end(JSON.stringify(body ?? {}));
  await task;
  assert.ok(result, 'handler must respond');
  return result;
}

for (const prefix of ['', 'SoftechCloudAdmin/']) {
  const label = prefix || 'root/';
  const dbModule = await import('../' + prefix + 'src/db/connection.js');
  dbModule.initDatabase();
  const { handleAuthRoute } = await import('../' + prefix + 'src/routes/auth.js');
  const { default: api } = await import('../' + prefix + 'api/index.js');
  const { SupabaseCloudService } = await import('../' + prefix + 'src/services/supabaseClient.js');
  const jwt = await import('../' + prefix + 'src/utils/jwt.js');

  test(label + 'local login rejects old bypass and unknown accounts', async () => {
    for (const body of [{ username: 'admin', password: 'admin123' }, { username: 'missing', password: 'admin123' }]) {
      assert.equal((await call(handleAuthRoute, '/api/auth/login', body)).status, 401);
    }
    assert.equal((await call(handleAuthRoute, '/api/auth/pin-login', { username: 'missing', pinCode: '7777' })).status, 401);
    assert.equal((await call(handleAuthRoute, '/api/auth/pin-login', { pinCode: '7777' })).status, 401);
  });
  test(label + 'real local password and PIN still work', async () => {
    for (const [route, body] of [
      ['/api/auth/login', { username: 'admin', password: process.env.SUPERADMIN_INITIAL_PASSWORD }],
      ['/api/auth/pin-login', { pinCode: '2468' }]
    ]) {
      const result = await call(handleAuthRoute, route, body);
      assert.equal(result.status, 200);
      assert.equal(jwt.verifyAccessToken(result.body.accessToken).username, 'admin');
      assert.ok(jwt.verifyRefreshToken(result.body.refreshToken));
    }
  });
  test(label + 'cloud rejects bypass when account lookup fails', async () => {
    SupabaseCloudService.verifySuperAdminCredentials = async () => null;
    SupabaseCloudService.verifyPinCode = async () => null;
    assert.equal((await call(api, '/api/auth/login', { username: 'admin', password: 'admin123' })).status, 401);
    assert.equal((await call(api, '/api/auth/pin-login', { pinCode: '7777' })).status, 401);
    assert.equal((await call(api, '/api/auth/pin-login', { pinCode: 'abcd' })).status, 400);
  });
  test(label + 'cloud valid account gets usable token', async () => {
    SupabaseCloudService.verifySuperAdminCredentials = async () => ({ id: 9, username: 'owner' });
    const result = await call(api, '/api/auth/login', { username: 'owner', password: 'valid' });
    assert.equal(result.status, 200);
    assert.equal((await call(api, '/api/auth/me', undefined, result.body.token)).body.user.sub, 9);
  });
  test(label + 'cloud PIN endpoint used by the login page returns both tokens', async () => {
    SupabaseCloudService.verifyPinCode = async pin => pin === '2468' ? ({ id: 10, username: 'owner' }) : null;
    const result = await call(api, '/api/auth/verify-pin', { username: 'owner', pinCode: '2468' });
    assert.equal(result.status, 200);
    assert.equal(jwt.verifyAccessToken(result.body.accessToken).sub, 10);
    assert.equal(jwt.verifyRefreshToken(result.body.refreshToken).sub, 10);
  });
  test(label + 'tokens reject tampering, expiry and refresh/access confusion', () => {
    const token = jwt.signAccessToken({ sub: 1, role: 'superadmin' });
    assert.equal(jwt.verifyAccessToken(token).sub, 1);
    assert.equal(jwt.verifyAccessToken(token + 'x'), null);
    assert.equal(jwt.verifyAccessToken(jwt.signAccessToken({ sub: 1 }, 0)), null);
    assert.equal(jwt.verifyAccessToken(jwt.signRefreshToken({ sub: 1 })), null);
    assert.equal(jwt.verifyRefreshToken(token), null);
    assert.equal(jwt.verifyAccessToken({}), null);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 1, tokenType: 'access' })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.SUPERADMIN_JWT_SECRET).update(header + '.' + body).digest('base64url');
    assert.equal(jwt.verifyAccessToken(header + '.' + body + '.' + signature), null);
  });
}
