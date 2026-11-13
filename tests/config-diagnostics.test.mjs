import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectConfig} from '../scripts/support/Check-SoftechConfig.mjs';

test('config diagnosis locates malformed structure without exposing values in errors or previews',()=>{
  const secret='TEST_SECRET_0178';
  for(const value of [
    `{"token":"${secret}",}`,`{"token":"${secret}" "clubId":1234}`,`{"token":"${secret}`,
    `\u201c${secret}\u201d`,secret,`{"token":"${secret}\\\"still-secret",}`
  ]){
    const report=inspectConfig(Buffer.from(value));
    assert.equal(report.result,'INVALID_JSON');
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.ok(!JSON.stringify(report).includes('still-secret'));
    assert.ok(!JSON.stringify(report).includes('1234'));
  }
  assert.equal(inspectConfig(Buffer.from('{"cloudUrl":"'+secret+'"}')).fields.cloudUrl,'string');
  assert.equal(inspectConfig(Buffer.from('\ufeff{}')).result,'VALID_OBJECT');
  assert.equal(inspectConfig(Buffer.from('\ufeff\ufeff{}')).extraLeadingBom,1);
  assert.equal(inspectConfig(Buffer.from('\ufeff{}','utf16le')).result,'VALID_OBJECT');
  assert.equal(inspectConfig(Buffer.from('null')).result,'ROOT_NOT_OBJECT');
  assert.equal(inspectConfig(Buffer.from([0xff,0x00])).result,'INVALID_ENCODING');
});

test('standalone report leaves broken config and database unchanged',()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/config-report-'));
  fs.copyFileSync('scripts/support/Check-SoftechConfig.mjs',path.join(dir,'Check-SoftechConfig.mjs'));
  const original='{"token":"PRIVATE_FIXTURE_VALUE",}';
  fs.writeFileSync(path.join(dir,'config.json'),original);
  fs.writeFileSync(path.join(dir,'netcafe.db'),'untouched-fixture');
  const run=spawnSync(process.execPath,[path.join(dir,'Check-SoftechConfig.mjs'),dir],{windowsHide:true,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const report=fs.readFileSync(path.join(dir,'Softech-Config-Report.txt'),'utf8');
  assert.match(report,/INVALID_JSON/);
  assert.ok(!report.includes('PRIVATE_FIXTURE_VALUE'));assert.ok(!run.stdout.includes('PRIVATE_FIXTURE_VALUE'));
  assert.equal(fs.readFileSync(path.join(dir,'config.json'),'utf8'),original);
  assert.equal(fs.readFileSync(path.join(dir,'netcafe.db'),'utf8'),'untouched-fixture');
});
