import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const prefix of ['', 'SoftechCloudAdmin/']) {
  for (const configured of [false, true]) {
    test(prefix + 'Vercel cold start; JWT configured=' + configured, () => {
      const env = { ...process.env, VERCEL: '1', NODE_ENV: 'production', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '' };
      for (const key of ['SUPERADMIN_JWT_SECRET', 'JWT_SECRET', 'REFRESH_SECRET']) delete env[key];
      if (configured) env.SUPERADMIN_JWT_SECRET = 'test-only-secret-with-at-least-32-bytes';
      const script = [
        "import assert from 'node:assert/strict';",
        "const { default: handler } = await import('./" + prefix + "api/index.js');",
        "const { SupabaseCloudService } = await import('./" + prefix + "src/services/supabaseClient.js');",
        "SupabaseCloudService.verifySuperAdminCredentials = async () => ({ id: 1, username: 'test' });",
        "let result;",
        "const res = { setHeader() {}, end(body) { result = { status: this.statusCode, body: JSON.parse(body) }; } };",
        "await handler({ method: 'POST', url: '/api/auth/login', headers: { host: 'localhost' }, body: { username: 'test', password: 'test' } }, res);",
        "assert.equal(result.status, " + (configured ? 200 : 503) + ");",
        configured ? "assert.ok(result.body.accessToken);" : "assert.equal(result.body.code, 'AUTH_CONFIGURATION_ERROR'); assert.match(result.body.error, /SUPERADMIN_JWT_SECRET/); assert.equal(result.body.accessToken, undefined);",
        "console.log('PASS');"
      ].join('\n');
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8', timeout: 15000 });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /PASS/);
      assert.doesNotMatch(run.stderr, /SQLite is an experimental feature/);
    });
  }
}
