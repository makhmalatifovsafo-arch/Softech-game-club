import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// A separate SQLite transaction holds an OS-backed lock for the server lifetime.
// Crash/reboot releases it automatically; PID reuse cannot block the next boot.
export function claimServerInstance(file){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  let lock;
  try{
    lock=new DatabaseSync(file);
    lock.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS runtime_lock(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;');
    return ()=>{try{lock.close();}catch{}};
  }catch(error){
    try{lock?.close();}catch{}
    if(/locked|busy/i.test(error.message))throw Object.assign(Error('SERVER_ALREADY_RUNNING: Shu baza bilan boshqa server jarayoni ishlamoqda.'),{code:'SERVER_ALREADY_RUNNING'});
    throw Object.assign(Error('SERVER_INSTANCE_LOCK_FAILED: Server jarayoni himoyasini ochib bo‘lmadi.'),{code:'SERVER_INSTANCE_LOCK_FAILED',cause:error});
  }
}
