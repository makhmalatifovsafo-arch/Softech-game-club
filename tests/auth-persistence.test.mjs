import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test('cashier session survives restart and logout revokes the persisted token', () => {
  fs.mkdirSync('.test-output', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('.test-output/auth-persist-'));
  fs.mkdirSync(path.join(dir, 'src'));
  for (const file of ['auth.js', 'db.js']) fs.copyFileSync('NetCafeServer/src/' + file, path.join(dir, 'src', file));
  fs.mkdirSync(path.join(dir,'src/services'));
  fs.copyFileSync('NetCafeServer/src/services/localOwnerSetup.js',path.join(dir,'src/services/localOwnerSetup.js'));
  fs.copyFileSync('NetCafeServer/src/services/databaseBackup.js',path.join(dir,'src/services/databaseBackup.js'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const auth = JSON.stringify(pathToFileURL(path.join(dir, 'src/auth.js')).href);
  function run(code) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  assert.equal(run('const {hasPermission,normalizePermissions}=await import('+auth+');console.log(hasPermission(["sessions:manage"],"session:manage")&&!hasPermission([],"session:manage")&&normalizePermissions(["messages:send"])[0]==="message:send");'),'true');
  const token = run('const { createSessionToken } = await import(' + auth + '); console.log(createSessionToken({id:7,username:"cashier",role:"administrator",permissions:["*"]}).token);');
  assert.equal(run('const { getSession } = await import(' + auth + '); console.log(getSession(' + JSON.stringify(token) + ').username);'), 'cashier');
  run('const { destroySession } = await import(' + auth + '); destroySession(' + JSON.stringify(token) + ');');
  assert.equal(run('const { getSession } = await import(' + auth + '); console.log(getSession(' + JSON.stringify(token) + '));'), 'null');
});
