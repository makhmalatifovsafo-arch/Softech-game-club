import fs from 'node:fs';
import path from 'node:path';

// Presence is a scheduling hint, never authorization. Missing/stale input blocks
// unattended updates. PIDs are waited on, never killed from these records.
export function serviceCockpits(root, now=Date.now()) {
  const directory=path.join(root,'data'), result=[];
  let names;try{names=fs.readdirSync(directory);}catch{return result;}
  for(const name of names.filter(n=>/^cockpit-\d+\.json$/.test(n)))try{
    const item=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
    if(!Number.isInteger(item.pid)||item.pid<=0||name!==`cockpit-${item.pid}.json`)continue;
    try{process.kill(item.pid,0);}catch(error){if(error.code==='ESRCH')continue;}
    const age=now-item.at;
    result.push({pid:item.pid,idleSeconds:age>=0&&age<6000&&Number.isFinite(item.idleSeconds)?item.idleSeconds:-1});
  }catch{}
  return result;
}
