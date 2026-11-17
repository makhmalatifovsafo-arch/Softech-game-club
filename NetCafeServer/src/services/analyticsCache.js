import { Worker } from 'node:worker_threads';

export class AnalyticsCache {
  constructor(databasePath,{ttlMs=5000,timeoutMs=30000,maxEntries=8,workerUrl=new URL('./analyticsWorker.js',import.meta.url)}={}) {
    Object.assign(this,{databasePath,ttlMs,timeoutMs,maxEntries,workerUrl});
    this.entries=new Map();this.queue=[];this.active=null;this.closed=false;
  }
  async get({clubId=null,days=30,fresh=false}={}) {
    if(this.closed)throw Error('Statistika xizmati to‘xtatilgan.');
    days=Math.max(1,Math.min(365,Math.trunc(Number(days))||30));
    const day=new Date().toDateString(), key=JSON.stringify([clubId,days,day]);
    let entry=this.entries.get(key);
    if(!entry){
      if(this.entries.size>=this.maxEntries){
        const candidate=[...this.entries].filter(([,value])=>!value.pending).sort((a,b)=>a[1].usedAt-b[1].usedAt)[0];
        if(!candidate)throw Error('Statistika navbati band. Birozdan so‘ng qayta urining.');
        this.entries.delete(candidate[0]);
      }
      entry={options:{clubId,days},usedAt:Date.now(),readyAt:0,retryAt:0,revision:0};this.entries.set(key,entry);
    }
    entry.usedAt=Date.now();
    const stale=!entry.result || Date.now()-entry.readyAt>=this.ttlMs;
    if(stale && !entry.pending && Date.now()>=entry.retryAt)this.schedule(entry);
    if(!entry.result || (fresh && stale)){
      if(!entry.pending)throw Error('Statistikani hisoblab bo‘lmadi. Qayta urining.');
      await entry.pending;
    }
    return {...entry.result.report,analytics:{generatedAt:entry.result.generatedAt,
      refreshing:!!entry.pending,stale:Date.now()-entry.readyAt>=this.ttlMs,error:entry.error||null}};
  }
  schedule(entry){
    entry.calculatingRevision=entry.revision;
    entry.pending=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});
    // A stale response need not wait for the background refresh; still handle rejection.
    entry.pending.catch(()=>{});this.queue.push(entry);this.pump();
  }
  pump(){
    if(this.closed || this.active || !this.queue.length)return;
    const entry=this.queue.shift();
    let worker;
    try{worker=new Worker(this.workerUrl,{workerData:{databasePath:this.databasePath,options:entry.options},resourceLimits:{maxOldGenerationSizeMb:192}});}
    catch(error){this.finish(entry,null,error);return;}
    this.active={entry,worker};
    let message, failure;
    const timer=setTimeout(()=>{failure=Error('Statistika hisoblash vaqti tugadi.');worker.terminate();},this.timeoutMs);
    worker.on('message',value=>{message=value;});
    worker.on('error',error=>{failure=error;});
    worker.on('exit',code=>{
      clearTimeout(timer);this.active=null;
      this.finish(entry,message,failure || (code!==0 || !message?.report ? Error(message?.error || 'Statistika yordamchisi to‘xtadi.') : null));
    });
  }
  finish(entry,result,error){
    const {resolve,reject}=entry;entry.pending=null;
    if(error){entry.error='Yangilash amalga oshmadi. Oxirgi tayyor hisobot ko‘rsatilmoqda.';entry.retryAt=Date.now()+this.ttlMs;reject(error);}
    else{entry.result=result;entry.readyAt=entry.revision===entry.calculatingRevision?Date.now():0;entry.error=null;entry.retryAt=0;resolve();}
    this.pump();
  }
  close(){
    this.closed=true;
    for(const entry of this.queue.splice(0)){entry.reject(Error('Statistika xizmati to‘xtatilgan.'));entry.pending=null;}
    return this.active?.worker.terminate();
  }
  invalidate(){for(const entry of this.entries.values()){entry.readyAt=0;entry.revision++;}}
}
