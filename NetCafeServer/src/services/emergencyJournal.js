import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const stable=value=>JSON.stringify(value);
export class EmergencyJournal {
  constructor(root,secret){this.file=path.join(root,'data','emergency-sessions.ndjson');this.secret=secret;this.sequence=0;this.hash='GENESIS';this.events=[];this.valid=true;this.load();}
  signature(body){return crypto.createHmac('sha256',this.secret).update(body).digest('hex');}
  load(){
    if(!fs.existsSync(this.file))return;
    try{
      const lines=fs.readFileSync(this.file,'utf8').split(/\r?\n/).filter(Boolean);
      for(const line of lines){
        const entry=JSON.parse(line),{hash,...unsigned}=entry;
        if(entry.sequence!==this.sequence+1||entry.previousHash!==this.hash||hash!==this.signature(stable(unsigned)))throw Error('EMERGENCY_JOURNAL_INVALID');
        this.sequence=entry.sequence;this.hash=hash;this.events.push(Object.freeze(entry));
      }
    }catch{this.valid=false;}
  }
  append(event){
    if(!this.valid)throw Error('Favqulodda jurnal tekshiruvidan o‘tmadi. Yangi seans bloklandi.');
    const unsigned={sequence:this.sequence+1,previousHash:this.hash,recordedAt:new Date().toISOString(),...event};
    const entry={...unsigned,hash:this.signature(stable(unsigned))};
    fs.mkdirSync(path.dirname(this.file),{recursive:true});const fd=fs.openSync(this.file,'a');
    try{fs.writeSync(fd,stable(entry)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    this.sequence=entry.sequence;this.hash=entry.hash;this.events.push(Object.freeze(entry));return entry;
  }
  sessions(){
    const map=new Map();
    for(const event of this.events){
      if(event.type==='SESSION_STARTED')map.set(event.sessionId,{...event,status:'ACTIVE'});
      else if(event.type==='SESSION_ENDED'&&map.has(event.sessionId))map.get(event.sessionId).status='ENDED';
    }
    return [...map.values()];
  }
  active(){return this.sessions().filter(item=>item.status==='ACTIVE');}
}
