import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const safeCode=e=>['ENOENT','EACCES','EPERM','ERR_SQLITE_ERROR'].includes(e.code)?e.code:'OTHER';
export function inspectDatabase(file) {
  let db;
  try {
    const stat=fs.statSync(file);
    if(!stat.isFile())return {result:'NOT_A_FILE'};
    if(!stat.size)return {result:'EMPTY',bytes:0};
    const fd=fs.openSync(file,'r'),header=Buffer.alloc(16);
    try{fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}
    if(header.toString()!=='SQLite format 3\u0000')return {result:'INVALID_HEADER',bytes:stat.size};
    db=new DatabaseSync(file,{readOnly:true});
    db.exec('PRAGMA busy_timeout=3000; PRAGMA query_only=ON;');
    const ok=db.prepare('PRAGMA quick_check').all().every(row=>Object.values(row)[0]==='ok');
    const result={result:ok?'OK':'INTEGRITY_FAILED',bytes:stat.size};
    if(ok){
      const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
      result.tables={};
      for(const table of ['clubs','users','computers','sessions','transactions','bar_orders'])
        result.tables[table]=names.has(table)?Number(db.prepare('SELECT count(*) AS n FROM '+table).get().n):null;
    }
    return result;
  }catch(error){return {result:'UNREADABLE',code:safeCode(error)};}
  finally{db?.close();}
}

export function inspectInstallation(directory) {
  const report={runtime:process.version};
  const size=file=>{try{return fs.statSync(file).size;}catch{return null;}};
  const config=path.join(directory,'config.json');
  try{const bytes=fs.readFileSync(config);report.config={bytes:bytes.length,allNull:bytes.length>0&&bytes.every(b=>b===0)};}
  catch(error){report.config={result:'UNREADABLE',code:safeCode(error)};}
  try {
    const bytes=fs.readFileSync(path.join(directory,'data/softech_license.sig'));
    report.license={bytes:bytes.length,allNull:bytes.length>0&&bytes.every(b=>b===0)};
    try {
      const license=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!license?.payload||typeof license.signature!=='string')throw Error();
      const expected=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026')
        .update(JSON.stringify(license.payload)).digest('hex');
      report.license.signatureMatches=expected===license.signature;
      report.license.result=report.license.signatureMatches?'VERIFIED':'SIGNATURE_MISMATCH';
      if(report.license.signatureMatches&&Number.isSafeInteger(Number(license.payload.clubId)))report.license.clubId=Number(license.payload.clubId);
    }catch{report.license.result='INVALID_CONTENT';}
  }catch(error){report.license={result:'UNREADABLE',code:safeCode(error)};}
  const file=path.join(directory,'netcafe.db');
  report.database=inspectDatabase(file);
  report.walBytes=size(file+'-wal');report.shmBytes=size(file+'-shm');
  report.backups=[];
  try {
    const folder=path.join(directory,'data/backups');
    const names=fs.readdirSync(folder).filter(n=>/^(startup|hourly|daily|setup)-\d{13}-[a-f0-9-]{36}\.db$/.test(n))
      .sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
    report.backupCount=names.length;
    for(const name of names.slice(0,5))report.backups.push({name,...inspectDatabase(path.join(folder,name))});
  }catch(error){report.backupListError=safeCode(error);}
  return report;
}
