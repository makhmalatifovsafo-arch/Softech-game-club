import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';
const dotnet=path.resolve('.tools/dotnet/dotnet.exe'),helper=path.resolve('SoftechUpdater/bin/Debug/net8.0-windows/win-x64/SoftechUpdater.dll');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+15000;while(!check()){if(Date.now()>end)throw Error('Restart helper timed out');await wait(50);}}
for(const cancel of [true,false]){
  const root=fs.mkdtempSync(path.resolve('.test-output/restart-helper-')),target=path.join(root,'app');fs.mkdirSync(target);
  fs.copyFileSync(process.execPath,path.join(target,'node.exe'));
  fs.writeFileSync(path.join(target,'netcafe.db'),'preserved database');fs.writeFileSync(path.join(target,'config.json'),'preserved config');
  fs.writeFileSync(path.join(target,'fixture.cjs'),`const fs=require('fs');fs.appendFileSync('starts.txt',process.pid+'\\n');setInterval(()=>{if(fs.existsSync('stop-'+process.pid))process.exit(0)},20);`);
  const parent=spawn(path.join(target,'node.exe'),['fixture.cjs'],{cwd:target,windowsHide:true,stdio:'ignore'}),parentExit=once(parent,'exit');
  let restartedPid;
  try{
    await until(()=>fs.existsSync(path.join(target,'starts.txt')));
    const plan={RestartOnly:true,Target:target,Kind:'server',Version:'1.0.34',ParentPids:[parent.pid],RestartExecutable:path.join(target,'node.exe'),RestartArguments:['fixture.cjs'],ReadyFile:path.join(root,'ready'),CommitFile:path.join(root,'commit'),CancelFile:path.join(root,'cancel')};
    const planFile=path.join(root,'plan.json');fs.writeFileSync(planFile,JSON.stringify(plan));
    const child=spawn(dotnet,[helper,'--plan',planFile],{windowsHide:true,stdio:'ignore'}),exit=once(child,'exit');
    await until(()=>fs.existsSync(plan.ReadyFile)||child.exitCode!==null);assert.ok(fs.existsSync(plan.ReadyFile));
    if(cancel){fs.writeFileSync(plan.CancelFile,'cancel');assert.equal((await exit)[0],3);assert.equal(parent.exitCode,null);}
    else{fs.writeFileSync(plan.CommitFile,'commit');await wait(200);assert.equal(fs.readFileSync(path.join(target,'starts.txt'),'utf8').trim().split('\n').length,1,'Helper must wait for the exact original process');
      fs.writeFileSync(path.join(target,'stop-'+parent.pid),'stop');await parentExit;assert.equal((await exit)[0],0);
      await until(()=>fs.readFileSync(path.join(target,'starts.txt'),'utf8').trim().split('\n').length===2);
      restartedPid=Number(fs.readFileSync(path.join(target,'starts.txt'),'utf8').trim().split('\n')[1]);assert.notEqual(restartedPid,parent.pid);
    }
    assert.equal(fs.readFileSync(path.join(target,'netcafe.db'),'utf8'),'preserved database');assert.equal(fs.readFileSync(path.join(target,'config.json'),'utf8'),'preserved config');
    console.log('PASS native restart-only helper: '+(cancel?'cancel keeps original running':'wait, restart exact app, preserve database/config'));
  }finally{if(parent.exitCode===null){parent.kill();await parentExit;}if(restartedPid)try{process.kill(restartedPid);}catch{}}
}
