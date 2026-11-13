import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {recoverClub10} from '../scripts/support/Recover-Club10.mjs';
import {inspectInstallation} from '../scripts/support/Inspect-SoftechServer.mjs';

function fixture(){
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/club10-'));
  fs.mkdirSync(path.join(dir,'data/backups'),{recursive:true});
  fs.writeFileSync(path.join(dir,'config.json'),Buffer.alloc(99));
  fs.writeFileSync(path.join(dir,'data/softech_license.sig'),Buffer.alloc(240));
  fs.writeFileSync(path.join(dir,'data/license_lock.json'),'preserve-existing-lock');
  const db=new DatabaseSync(path.join(dir,'netcafe.db'));
  db.exec('CREATE TABLE users(id INTEGER, balance INTEGER);INSERT INTO users VALUES(1,5320);CREATE TABLE computers(id INTEGER);CREATE TABLE sessions(id INTEGER)');
  db.close();return dir;
}

test('owner-confirmed club 10 restores only config after database inspection, retaining damaged license and ban',()=>{
  const dir=fixture(),file=path.join(dir,'netcafe.db'),before=fs.readFileSync(file);
  const report=recoverClub10(dir);
  assert.equal(report.database.result,'OK');assert.equal(report.license.result,'INVALID_CONTENT');
  assert.equal(report.license.allNull,true);assert.equal(report.recovery,'CONFIG_RESTORED_FOR_CLUB_10');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'config.json'))).clubId,10);
  assert.ok(fs.readFileSync(file).equals(before));
  assert.ok(fs.readFileSync(path.join(dir,'data/softech_license.sig')).equals(Buffer.alloc(240)));
  assert.equal(fs.readFileSync(path.join(dir,'data/license_lock.json'),'utf8'),'preserve-existing-lock');
});

test('invalid database stops repair and checks a saved backup without overwriting anything',()=>{
  const dir=fixture(),file=path.join(dir,'netcafe.db');
  const name='hourly-'+Date.now()+'-'+crypto.randomUUID()+'.db';
  fs.copyFileSync(file,path.join(dir,'data/backups',name));
  fs.writeFileSync(file,Buffer.alloc(1024));
  const report=recoverClub10(dir);
  assert.equal(report.database.result,'INVALID_HEADER');
  assert.equal(report.backups[0].result,'OK');
  assert.equal(report.recovery,'STOPPED_DATABASE_REVIEW_REQUIRED');
  assert.ok(fs.readFileSync(path.join(dir,'config.json')).equals(Buffer.alloc(99)));
  assert.ok(fs.readFileSync(file).equals(Buffer.alloc(1024)));
});

test('missing database is never created and a verified different club cannot be reset to club 10',()=>{
  const dir=fixture(),file=path.join(dir,'netcafe.db');
  fs.renameSync(file,file+'.kept');
  assert.equal(recoverClub10(dir).recovery,'STOPPED_DATABASE_REVIEW_REQUIRED');
  assert.equal(fs.existsSync(file),false);
  fs.renameSync(file+'.kept',file);
  const payload={clubId:11,secret:'PRIVATE_VALUE_NOT_FOR_REPORT'};
  const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest('hex');
  fs.writeFileSync(path.join(dir,'data/softech_license.sig'),JSON.stringify({payload,signature}));
  const report=recoverClub10(dir);
  assert.equal(report.license.clubId,11);assert.equal(report.recovery,'STOPPED');
  assert.ok(!JSON.stringify(report).includes(payload.secret));assert.ok(!JSON.stringify(report).includes(signature));
  assert.ok(fs.readFileSync(path.join(dir,'config.json')).equals(Buffer.alloc(99)));
});

test('database inspection includes committed WAL records without checkpointing or losing balances',()=>{
  const dir=fixture(),file=path.join(dir,'netcafe.db');
  const db=new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;INSERT INTO users VALUES(2,12000)');
    const main=fs.readFileSync(file),wal=fs.readFileSync(file+'-wal');
    const report=inspectInstallation(dir);
    assert.equal(report.database.result,'OK');assert.equal(report.database.tables.users,2);
    assert.ok(fs.readFileSync(file).equals(main));assert.ok(fs.readFileSync(file+'-wal').equals(wal));
    assert.equal(db.prepare('SELECT sum(balance) AS total FROM users').get().total,17320);
  }finally{db.close();}
});
