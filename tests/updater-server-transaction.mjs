// Actual Windows updater + isolated real Node servers. No installed club is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const dotnet=process.env.DOTNET_EXE||path.resolve('.tools/dotnet-sdk/dotnet.exe');
const helper=path.resolve('SoftechUpdater/bin/Debug/net8.0-windows/win-x64/SoftechUpdater.dll');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await pause(50);}throw Error('Fixture timed out');}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.mkdirSync('.test-output',{recursive:true});
for(const scenario of ['success','rollback','interrupted','restart']){
  const root=fs.mkdtempSync(path.resolve('.test-output/server-ota-'+scenario+'-')),target=path.join(root,'target'),source=path.join(root,'source');
  fs.mkdirSync(target);fs.mkdirSync(source);
  for(const name of ['src','public','schema.sql','package.json'])for(const folder of [target,source])fs.cpSync(path.join('NetCafeServer',name),path.join(folder,name),{recursive:true});
  const oldVersion=JSON.parse(fs.readFileSync(path.join(target,'package.json'))).version;
  fs.writeFileSync(path.join(source,'package.json'),JSON.stringify({type:'module',version:'9.0.0'}));
  fs.writeFileSync(path.join(source,'SoftechUpdater.exe'),'fixture companion only');
  fs.mkdirSync(path.join(target,'runtime'));fs.copyFileSync(process.execPath,path.join(target,'runtime','node.exe'));
  if(scenario==='interrupted'){fs.mkdirSync(path.join(source,'runtime'));fs.copyFileSync(process.execPath,path.join(source,'runtime','node.exe'));}
  fs.writeFileSync(path.join(target,'config.json'),'{}');
  const preload=path.join(target,'fixture-pid.mjs');
  fs.writeFileSync(preload,"import fs from 'node:fs';if(process.argv[1]?.endsWith('server.js'))fs.writeFileSync('fixture-server.pid',String(process.pid));");
  const database=path.join(target,'netcafe.db'),seed=new DatabaseSync(database);seed.exec('CREATE TABLE saved_balance(amount);INSERT INTO saved_balance VALUES(5320)');seed.close();
  if(scenario==='rollback')fs.writeFileSync(path.join(source,'src/server.js'),"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('netcafe.db');db.exec('UPDATE saved_balance SET amount=999');db.close();process.exit(42);");
  const files={};for(const relative of fs.readdirSync(source,{recursive:true})){
    const file=path.join(source,relative);if(fs.statSync(file).isFile())files[relative.replaceAll('\\','/')]=hash(file);
  }
  fs.writeFileSync(path.join(source,'update-package.json'),JSON.stringify({version:'9.0.0',kind:'server',files}));
  const cloud=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"success":true,"status":"PENDING"}');});cloud.listen(0,'127.0.0.1');await once(cloud,'listening');
  const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const env={...process.env,NODE_OPTIONS:'--import='+pathToFileURL(preload).href,NODE_ENV:'test',PORT:String(port),SOFTECH_UPDATE_TOKEN:'',SOFTECH_CLOUD_URL:'http://127.0.0.1:'+cloud.address().port,UPDATE_MANIFEST_URL:'http://127.0.0.1:'+cloud.address().port};
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:target,env,windowsHide:true,stdio:'ignore'}),parentExit=once(parent,'exit');
  const plan={Source:source,Target:target,Version:'9.0.0',Kind:'server',ParentPids:[parent.pid],RestartExecutable:path.join(target,'runtime','node.exe'),RestartArguments:['src/server.js'],
    ReadyFile:path.join(root,'ready'),CommitFile:path.join(root,'commit'),CancelFile:path.join(root,'cancel'),HealthFile:path.join(root,'health'),HealthUrl:'http://127.0.0.1:'+port+'/api/health',TimeoutSeconds:30};
  if(scenario==='restart'){plan.RestartOnly=true;plan.Version=oldVersion;}
  const planFile=path.join(root,'plan.json');fs.writeFileSync(planFile,JSON.stringify(plan));
  const updater=spawn(dotnet,[helper,'--plan',planFile],{cwd:root,env,windowsHide:true,stdio:'ignore'}),updaterExit=once(updater,'exit');
  let replacement;
  const health=async()=>{try{return await(await fetch(plan.HealthUrl,{signal:AbortSignal.timeout(500)})).json();}catch{return null;}};
  try{
    await until(()=>fs.existsSync(plan.ReadyFile)||updater.exitCode!==null);assert.ok(fs.existsSync(plan.ReadyFile));
    fs.writeFileSync(plan.CommitFile,'commit');parent.kill();await parentExit;
    if(scenario==='interrupted'){
      const pending=await until(async()=>{const h=await health();return h?.updatePending?h:null;});
      assert.equal((await fetch('http://127.0.0.1:'+port+'/api/sessions/start',{method:'POST',body:'{}'})).status,503);
      const transaction=path.join(target,'.ota',pending.updateToken);
      await until(()=>JSON.parse(fs.readFileSync(path.join(transaction,'journal.json'))).RestartedPid>0);
      updater.kill();await updaterExit; // Abrupt helper termination, no finally/rollback.
      // Simulate a launcher holding an EXE which rollback must replace. Recovery
      // prepares independently, then waits for that launcher to exit first.
      const launcher=spawn(plan.RestartExecutable,['-e','setInterval(()=>{},1000)'],{cwd:target,env,windowsHide:true,stdio:'ignore'}),launcherExit=once(launcher,'exit');
      const recoveryPlan={...plan,RecoveryOnly:true,ParentPids:[launcher.pid],ReadyFile:path.join(root,'recover-ready'),CommitFile:path.join(root,'recover-commit')};
      const recoveryFile=path.join(root,'recovery-plan.json');fs.writeFileSync(recoveryFile,JSON.stringify(recoveryPlan));
      const recover=spawn(dotnet,[helper,'--plan',recoveryFile],{env,windowsHide:true,stdio:'ignore'}),recoverExit=once(recover,'exit');
      try{
        await until(()=>fs.existsSync(recoveryPlan.ReadyFile)||recover.exitCode!==null);
        assert.ok(fs.existsSync(recoveryPlan.ReadyFile),'Recovery helper did not prepare');
        assert.equal(launcher.exitCode,null,'Launcher must stay open during recovery preparation');
        fs.writeFileSync(recoveryPlan.CommitFile,'commit');launcher.kill();await launcherExit;
        assert.equal((await recoverExit)[0],0,fs.readFileSync(path.join(target,'logs/updater.log'),'utf8'));
      }finally{
        if(launcher.exitCode===null){launcher.kill();await launcherExit;}
        if(recover.exitCode===null){recover.kill();await recoverExit;}
      }
      assert.equal(JSON.parse(fs.readFileSync(path.join(transaction,'journal.json'))).Phase,'ROLLED_BACK');
    }else {
      const code=(await updaterExit)[0],log=path.join(target,'logs/updater.log');
      assert.equal(code,scenario==='rollback'?5:0,fs.existsSync(log)?fs.readFileSync(log,'utf8'):'Restart failed');
    }
    const current=await until(async()=>{const h=await health();return h&&!h.updatePending?h:null;});
    assert.equal(current.version,scenario==='success'?'9.0.0':oldVersion);
    const check=new DatabaseSync(database);try{
      assert.equal(check.prepare('SELECT amount FROM saved_balance').get().amount,5320);
      if(scenario==='success')check.exec('UPDATE saved_balance SET amount=6320');
    }finally{check.close();}
    if(scenario==='success'){
      const recover=spawn(dotnet,[helper,'--recover',target],{env,windowsHide:true,stdio:'ignore'});assert.equal((await once(recover,'exit'))[0],0);
      const check=new DatabaseSync(database);try{assert.equal(check.prepare('SELECT amount FROM saved_balance').get().amount,6320,'Accepted update rolled back new receipts');}finally{check.close();}
      // Even with no listening-port evidence, SQLite's live ownership blocks recovery.
      const interrupted=path.join(target,'.ota',crypto.randomUUID().replaceAll('-',''));fs.mkdirSync(interrupted);
      fs.writeFileSync(path.join(interrupted,'journal.json'),JSON.stringify({Phase:'APPLYING',Kind:'server',Version:'9.0.0'}));
      try{
        const unsafe=spawn(dotnet,[helper,'--recover',target],{env,windowsHide:true,stdio:'ignore'});
        assert.equal((await once(unsafe,'exit'))[0],1,'Recovery must not modify files while SQLite owner is alive');
        assert.equal(JSON.parse(fs.readFileSync(path.join(interrupted,'journal.json'))).Phase,'APPLYING');
      }finally{fs.unlinkSync(path.join(interrupted,'journal.json'));fs.rmdirSync(interrupted);}
    }
    assert.equal(fs.readFileSync(path.join(target,'config.json'),'utf8'),'{}');
    console.log('PASS real server OTA: '+scenario+'; balances retained and business writes gated until acceptance');
  }finally{
    if(parent.exitCode===null){parent.kill();await parentExit;}
    if(updater.exitCode===null){updater.kill();await updaterExit;}
    if(replacement&&replacement.exitCode===null){const exited=once(replacement,'exit');replacement.kill();await exited;}
    // This PID file is written only by the server launched inside this fixture.
    try{const pid=Number(fs.readFileSync(path.join(target,'fixture-server.pid'),'utf8'));if(Number.isInteger(pid)&&pid>0)process.kill(pid);}catch{}
    cloud.closeAllConnections();await new Promise(r=>cloud.close(r));
  }
}
