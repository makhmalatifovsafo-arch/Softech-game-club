import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {DatabaseSync} from 'node:sqlite';
import {ManagerAccountService} from '../src/services/managerAccountService.js';
test('super admin manager provisioning is bound, persistent, replay-safe and revokes old logins',async()=>{
 fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/manager-'));
 for(const file of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',file),path.join(dir,file),{recursive:true});
 process.env.NODE_ENV='production';
 const {db,initDatabase}=await import(pathToFileURL(path.join(dir,'src/db.js')));initDatabase();
 const {applyManagerAccount,getManagerRevision}=await import(pathToFileURL(path.join(dir,'src/services/localOwnerSetup.js')));
 const {verifyPassword,createSessionToken,getSession}=await import(pathToFileURL(path.join(dir,'src/auth.js')));
 const cloud=new DatabaseSync(':memory:');cloud.exec("CREATE TABLE clubs(id INTEGER PRIMARY KEY,hardware_fingerprint TEXT);INSERT INTO clubs VALUES(7,'test-hardware');CREATE TABLE remote_commands(id INTEGER PRIMARY KEY AUTOINCREMENT,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);");
 const service=new ManagerAccountService({db:cloud}),club={id:7,hardware_fingerprint:'test-hardware'},license={clubId:7,hardwareFingerprint:'test-hardware'};
 try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
  await assert.rejects(()=>service.save(7,{username:'owner',password:'123'}));
  await assert.rejects(()=>service.save(8,{username:'owner',password:'1234'}));
  const saved=await service.save(7,{username:'first_owner',password:'1234'});
  const stored=cloud.prepare('SELECT payload FROM remote_commands').get().payload;
  assert.ok(!stored.includes('"1234"'));assert.ok(!stored.includes('passwordHash'));
  const packet=await service.delivery(club,0);
  assert.throws(()=>applyManagerAccount(db,packet,{...license,clubId:8}));
  assert.throws(()=>applyManagerAccount(db,packet,{...license,hardwareFingerprint:'other'}));
  assert.throws(()=>applyManagerAccount(db,{...packet,payload:{...packet.payload,username:'attacker'}},license));
  assert.equal(applyManagerAccount(db,packet,license),true);
  let owner=db.prepare("SELECT * FROM users WHERE role='club_owner'").get();const ownerId=owner.id;
  assert.ok(verifyPassword('1234',owner.password_hash));
  const auth=createSessionToken(owner);assert.ok(getSession(auth.token));
  assert.equal(applyManagerAccount(db,packet,license),false);assert.ok(getSession(auth.token),'Repeated delivery must not log owner out');
  assert.equal(getManagerRevision(db,7),saved.revision);
  await service.delivery(club,saved.revision);assert.equal((await service.summary(7)).applied,true);
  const next=await service.save(7,{username:'renamed_owner',password:'long-second-password'});
  const update=await service.delivery(club,0);assert.equal(applyManagerAccount(db,update,license),true);
  owner=db.prepare('SELECT * FROM users WHERE id=?').get(ownerId);assert.equal(owner.username,'renamed_owner');
  assert.ok(verifyPassword('long-second-password',owner.password_hash));assert.ok(!verifyPassword('1234',owner.password_hash));
  assert.equal(getSession(auth.token),null);assert.equal(applyManagerAccount(db,packet,license),false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
  assert.equal(fs.existsSync(path.join(dir,'data/manager-credentials.txt')),false);
  cloud.prepare('UPDATE remote_commands SET payload=? WHERE id=?').run(stored,next.revision);
  await assert.rejects(()=>service.delivery(club,0),/imzosi/,'An old signed record cannot be copied to a newer ID');
 }finally{db.close();cloud.close();}
});

test('administrator can be provisioned first, without a manager, and rotates independently',async()=>{
 const dir=fs.mkdtempSync(path.resolve('.test-output/staff-'));
 for(const file of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',file),path.join(dir,file),{recursive:true});
 process.env.NODE_ENV='production';
 const {db,initDatabase}=await import(pathToFileURL(path.join(dir,'src/db.js')));initDatabase();
 const {applyManagerAccount,applyAdministratorAccount,getAdministratorRevision}=await import(pathToFileURL(path.join(dir,'src/services/localOwnerSetup.js')));
 const {createSessionToken,getSession,verifyPassword}=await import(pathToFileURL(path.join(dir,'src/auth.js')));
 const cloud=new DatabaseSync(':memory:');cloud.exec("CREATE TABLE clubs(id INTEGER PRIMARY KEY,hardware_fingerprint TEXT);INSERT INTO clubs VALUES(7,'test-hardware');CREATE TABLE remote_commands(id INTEGER PRIMARY KEY AUTOINCREMENT,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);");
 const manager=new ManagerAccountService({db:cloud}),administrator=new ManagerAccountService({db:cloud,role:'administrator'});
 const club={id:7,hardware_fingerprint:'test-hardware'},license={clubId:7,hardwareFingerprint:'test-hardware'};
 try{
  await administrator.save(7,{username:'cashier_one',password:'5678'});
  const packet=await administrator.delivery(club,0);
  assert.throws(()=>applyManagerAccount(db,packet,license));
  assert.equal(applyAdministratorAccount(db,packet,license),true);
  let cashier=db.prepare('SELECT * FROM users').get();const cashierId=cashier.id;
  assert.equal(cashier.role,'administrator');assert.ok(!JSON.parse(cashier.permissions).includes('*'));
  assert.ok(verifyPassword('5678',cashier.password_hash));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='club_owner'").get().n,0);
  const cashierToken=createSessionToken(cashier).token;
  await assert.rejects(()=>manager.save(7,{username:'cashier_one',password:'manager-private-password'}),/loginlari/);
  await assert.rejects(()=>manager.save(7,{username:'club_owner',password:'5678'}),/parollari/);
  await manager.save(7,{username:'club_owner',password:'manager-private-password'});
  const ownerPacket=await manager.delivery(club,0);assert.throws(()=>applyAdministratorAccount(db,ownerPacket,license));
  assert.equal(applyManagerAccount(db,ownerPacket,license),true);
  assert.ok(getSession(cashierToken),'Manager setup must not log the cashier out');
  const owner=db.prepare("SELECT * FROM users WHERE role='club_owner'").get();const ownerToken=createSessionToken(owner).token;
  db.prepare('UPDATE users SET balance=12345 WHERE id=?').run(cashierId);
  await administrator.save(7,{username:'renamed_cashier',password:'cashier-new-password'});
  const next=await administrator.delivery(club,0);assert.equal(applyAdministratorAccount(db,next,license),true);
  assert.equal(getSession(cashierToken),null);assert.ok(getSession(ownerToken));
  cashier=db.prepare('SELECT * FROM users WHERE id=?').get(cashierId);assert.equal(cashier.username,'renamed_cashier');assert.equal(cashier.balance,12345);
  assert.equal(applyAdministratorAccount(db,packet,license),false);assert.equal(getAdministratorRevision(db,7),next.payload.revision);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
  assert.equal(fs.existsSync(path.join(dir,'data/manager-credentials.txt')),false);
 }finally{db.close();cloud.close();}
});
