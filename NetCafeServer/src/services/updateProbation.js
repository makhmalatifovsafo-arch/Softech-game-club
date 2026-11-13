import fs from 'node:fs';
import path from 'node:path';

// During updater health verification only /api/health may be used. No cashier,
// client, scheduler or cloud command may commit money before rollback is disabled.
export class UpdateProbation {
  constructor(root,token=process.env.SOFTECH_UPDATE_TOKEN){
    if(token&&!/^[a-f0-9]{32}$/.test(token))throw Error('Invalid update probation identity.');
    if(!token){
      const ota=path.join(root,'.ota');
      if(fs.existsSync(ota))for(const dir of fs.readdirSync(ota,{withFileTypes:true})){
        if(!dir.isDirectory()||!/^[a-f0-9]{32}$/.test(dir.name))continue;
        const journal=path.join(ota,dir.name,'journal.json');
        if(!fs.existsSync(journal))continue;
        let entry;try{entry=JSON.parse(fs.readFileSync(journal,'utf8'));}catch{throw Error('UPDATE_RECOVERY_REQUIRED: Yangilanish jurnali o‘qilmadi. Launcherni ochib tiklashni bajaring.');}
        if(entry?.Phase==='APPLYING')throw Error('UPDATE_RECOVERY_REQUIRED: Yangilanish yakunlanmagan. Launcherni ochib tiklashni bajaring.');
      }
    }
    this.token=token||null;this.pending=Boolean(token);
    this.approval=token?path.join(root,'.ota',token,'approved.json'):null;
  }
  start(activate){
    if(!this.pending){activate();return;}
    const check=()=>{
      try{if(JSON.parse(fs.readFileSync(this.approval,'utf8')).token!==this.token)return;}catch{return;}
      clearInterval(this.timer);this.pending=false;activate();
    };
    this.timer=setInterval(check,250);check();
  }
}
