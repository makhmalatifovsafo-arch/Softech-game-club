import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { snapshot, verifyDatabase, guardDatabase, markDatabase, pruneBackups, backupDirectory } from '../NetCafeServer/src/services/databaseBackup.js';

test('WAL-aware backups preserve committed balances, survive bad input and recover without overwriting',()=>{
 fs.mkdirSync('.test-output',{recursive:true});
 const root=fs.mkdtempSync(path.resolve('.test-output/db-safety-')),file=path.join(root,'netcafe.db');
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0; CREATE TABLE balance(id INTEGER PRIMARY KEY, amount INTEGER); INSERT INTO balance VALUES(1,73000)');
 try {
  const first=snapshot(file,'startup');
  const check=new DatabaseSync(first,{readOnly:true});
  assert.equal(check.prepare('SELECT amount FROM balance').get().amount,73000);check.close();
  // Execute the exact installer backup program against a live WAL database.
  const source=fs.readFileSync('Installers/ServerSetup/DatabaseSafety.cs','utf8');
  const script=source.match(/const string script = """([\s\S]*?)""";/)[1];
  const setup=path.join(root,'installer-backup.db');
  const run=spawnSync(process.execPath,['-e',script,file,setup],{windowsHide:true,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);verifyDatabase(setup);
  const installed=new DatabaseSync(setup,{readOnly:true});assert.equal(installed.prepare('SELECT amount FROM balance').get().amount,73000);installed.close();
  for(let i=0;i<6;i++)snapshot(file,'hourly');
  pruneBackups(file);
  assert.equal(fs.readdirSync(backupDirectory(file)).filter(n=>n.startsWith('hourly-')).length,4);
  assert.ok(fs.existsSync(first));
  const recovered=path.join(root,'recovered.db');
  const cli='NetCafeServer/src/services/databaseBackup.js';
  assert.equal(spawnSync(process.execPath,[cli,'--recover-copy',first,recovered],{windowsHide:true}).status,0);
  assert.notEqual(spawnSync(process.execPath,[cli,'--recover-copy',first,file],{windowsHide:true}).status,0);
  assert.equal(db.prepare('SELECT amount FROM balance').get().amount,73000);
  markDatabase(file);
 } finally { db.close(); }
 const saved=fs.readFileSync(file);fs.writeFileSync(file,'corrupt database');
 assert.throws(()=>snapshot(file,'startup'));
 assert.equal(fs.readdirSync(backupDirectory(file)).filter(n=>n.startsWith('startup-')).length,1);
 fs.writeFileSync(file,saved);fs.renameSync(file,path.join(root,'removed-original.db'));
 assert.throws(()=>guardDatabase(file),/Bo‘sh baza/);
 assert.equal(fs.existsSync(file),false);
});

test('forced process termination preserves committed WAL transactions',async()=>{
 const root=fs.mkdtempSync(path.resolve('.test-output/db-crash-')),file=path.join(root,'netcafe.db');
 const script=`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0; CREATE TABLE receipts(amount); INSERT INTO receipts VALUES(42000)');console.log('committed');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['-e',script,file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 try { await once(child.stdout,'data');const exited=once(child,'exit');child.kill('SIGKILL');await exited; }
 finally { if(child.exitCode===null&&!child.killed)child.kill('SIGKILL'); }
 const check=new DatabaseSync(file);
 try {assert.equal(check.prepare('SELECT amount FROM receipts').get().amount,42000);}
 finally {check.close();}
});

test('failed legacy schema migration rolls back original rows and keeps a readable pre-migration snapshot',()=>{
 const root=fs.mkdtempSync(path.resolve('.test-output/db-migrate-'));
 fs.cpSync('NetCafeServer/src',path.join(root,'src'),{recursive:true});
 fs.copyFileSync('NetCafeServer/schema.sql',path.join(root,'schema.sql'));
 const file=path.join(root,'netcafe.db'),old=new DatabaseSync(file);
 old.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,username,password_hash,role,phone_number,balance,permissions,created_at); INSERT INTO users VALUES(7,'kept','hash','unsupported_legacy_role','',95000,'[]','2026-01-01')");old.close();
 const run=spawnSync(process.execPath,['--input-type=module','-e',`const {initDatabase}=await import(${JSON.stringify(pathToFileURL(path.join(root,'src/db.js')).href)});initDatabase();`],{windowsHide:true,encoding:'utf8',env:{...process.env,NODE_ENV:'test'}});
 assert.notEqual(run.status,0,'Unsafe migration must stop startup');
 const check=new DatabaseSync(file);
 try {
  assert.equal(check.prepare('SELECT balance FROM users WHERE id=7').get().balance,95000);
  assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('users_mt','clubs')").get().n,0,'Migration changes must roll back atomically');
 }finally{check.close();}
 const backups=fs.readdirSync(backupDirectory(file)).filter(n=>n.endsWith('.db'));
 assert.equal(backups.length,1);verifyDatabase(path.join(backupDirectory(file),backups[0]));
});
