import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('customer credential edits preserve money, reject cross-tenant/staff targets and revoke old tokens',()=>{
 fs.mkdirSync('.test-output',{recursive:true});
 const dir=fs.mkdtempSync(path.resolve('.test-output/customer-credentials-'));
 fs.cpSync('NetCafeServer/src',path.join(dir,'src'),{recursive:true});
 fs.copyFileSync('NetCafeServer/schema.sql',path.join(dir,'schema.sql'));
 fs.writeFileSync(path.join(dir,'case.mjs'),`
 import assert from 'node:assert/strict';
 import {db,initDatabase} from './src/db.js';
 import {updateCustomerCredentials as update} from './src/services/customerCredentials.js';
 import {createSessionToken,getSession,verifyPassword} from './src/auth.js';
 initDatabase();
 try {
  const user=db.prepare("SELECT * FROM users WHERE username='gamer1'").get();
  const token=createSessionToken(user).token;
  const args={clubId:1,userId:user.id,username:'new_customer',password:'1234'};
  assert.throws(()=>update({...args,clubId:2}),e=>e.status===404);
  const staff=db.prepare("SELECT id FROM users WHERE role='administrator'").get();
  assert.throws(()=>update({...args,userId:staff.id}),e=>e.status===404);
  assert.throws(()=>update({...args,username:'manager'}),e=>e.status===409);
  update(args);
  assert.equal(getSession(token),null);
  const saved=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  assert.equal(saved.balance,user.balance);assert.equal(saved.role,user.role);
  assert.equal(verifyPassword('1234',saved.password_hash),true);
  assert.equal(verifyPassword('gamer123',saved.password_hash),false);
  update({...args,username:'renamed_customer',password:undefined});
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash,saved.password_hash);
  assert.throws(()=>update({...args,computerId:'unknown',sessionId:'missing',selfService:true,currentPassword:'1234'}),e=>e.status===403);
 } finally {db.close();}
 `);
 const result=spawnSync(process.execPath,['case.mjs'],{cwd:dir,env:{...process.env,NODE_ENV:'test'},encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
