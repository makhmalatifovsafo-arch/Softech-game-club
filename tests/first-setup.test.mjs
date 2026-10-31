import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

test('fresh installs wait for super admin and never create a local manager password', {timeout:30000}, async()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('.test-output/setup-'));
  const stub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,status:'PENDING'}));});
  stub.listen(0,'127.0.0.1');await once(stub,'listening');
  const cloud='http://127.0.0.1:'+stub.address().port;
  const children=[];
  async function boot(dir) {
    const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));
    const child=spawn(process.execPath,['src/server.js'],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',PORT:String(port),SOFTECH_CLOUD_URL:cloud,UPDATE_MANIFEST_URL:cloud,SUPABASE_URL:'',SUPABASE_ANON_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',CLUB_ID:''}});
    children.push(child);let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
    const url='http://127.0.0.1:'+port;
    async function call(route,body){const r=await fetch(url+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(1000)});return {status:r.status,body:await r.json()};}
    let ready=false;for(let i=0;i<100;i++){try{ready=(await call('/api/health')).status===200;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.ok(ready,logs);return {child,call,url,logs:()=>logs};
  }
  async function stop(child){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}}

  try {
    for(const name of ['first','second']){
      const dir=path.join(root,name);fs.mkdirSync(dir);
      for(const file of ['src','public','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',file),path.join(dir,file),{recursive:true});
      fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({supabaseUrl:'https://xyzcompany.supabase.co'}));
      let app=await boot(dir);const file=path.join(dir,'data/manager-credentials.txt');
      assert.equal(fs.existsSync(file),false);
      const inspection=new DatabaseSync(path.join(dir,'netcafe.db'));
      try{
        for(const [table,columns] of [['client_transactions',['category','session_id']],['sessions',['billing_last_at','billing_remainder','prepaid_rate_plan','prepaid_settled_at']],['bar_orders',['approval_status','paid_at','request_id']]]){
          const names=inspection.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);for(const col of columns)assert.ok(names.includes(col),table+'.'+col);
        }
        for(const table of ['bar_items','shifts','transactions'])assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
        assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);

      }finally{inspection.close();}
      assert.equal((await app.call('/api/auth/setup')).body.required,true);
      assert.equal((await app.call('/api/auth/setup',{username:'replacement',password:'never-create-local-owner'})).status,403);
      assert.equal((await app.call('/api/auth/login',{username:'manager',password:'Softech006'})).status,401);
      await stop(app.child);app=await boot(dir);
      assert.equal(fs.existsSync(file),false);
      assert.equal((await app.call('/api/auth/setup')).body.required,true);
      await stop(app.child);
    }

  }finally{
    for(const child of children)await stop(child);
    stub.closeAllConnections();await new Promise(r=>stub.close(r));
  }
});
