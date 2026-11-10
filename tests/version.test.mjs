import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
test('all source packages and Windows build metadata share the release version', () => {
  for (const file of ['NetCafeServer/package.json', 'SoftechCloudAdmin/package.json', 'package-lock.json'])
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, version, file);
  assert.equal(JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages[''].version, version);
  const props = fs.readFileSync('Directory.Build.props', 'utf8');
  assert.ok(props.includes(`<Version>${version}</Version>`));
  assert.ok(props.includes(`<AssemblyVersion>${version}.0</AssemblyVersion>`));
  for (const file of ['NetCafeClient/NetCafeClient.csproj', 'NetCafeServer/Launcher/SoftechCockpit.csproj'])
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<(?:Version|AssemblyVersion|FileVersion)>/, 'Project must inherit shared version');
});

test('cloud version endpoint reports deployed package version without requiring login', async () => {
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  for (const prefix of ['', 'SoftechCloudAdmin/']) {
    const { default: handler } = await import('../' + prefix + 'api/index.js');
    let body;
    const headers = {};
    const response = { setHeader: (key, value) => headers[key] = value, end: text => body = JSON.parse(text) };
    await handler({ url: '/api/index?route=version', method: 'GET', headers: { host: 'localhost' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(body.version, version);
    assert.equal(headers['Cache-Control'], 'no-store');
  }
});

test('version labels use live backend metadata and never invent a version on failure', async () => {
  const script = fs.readFileSync('public/version-label.js', 'utf8');
  assert.equal(script, fs.readFileSync('NetCafeServer/public/version-label.js', 'utf8'));
  const label = { dataset: { appVersion: '/api/health' }, textContent: 'Versiya —' };
  const events = {};
  let result = '9.8.7';
  vm.runInNewContext(script, {
    document: { readyState: 'loading', querySelectorAll: () => [label], addEventListener: (name, fn) => events[name] = fn },
    window: { addEventListener() {} }, AbortSignal,
    fetch: async (url, options) => {
      assert.equal(url, '/api/health'); assert.equal(options.cache, 'no-store');
      return { ok: true, json: async () => ({ version: result }) };
    }
  });
  await events.DOMContentLoaded();
  assert.equal(label.textContent, 'v9.8.7');
  label.textContent = 'Versiya —'; result = '<script>bad</script>';
  await events.DOMContentLoaded();
  assert.equal(label.textContent, 'Versiya —');
});
