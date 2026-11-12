// Real packaged, unlicensed server: failing Windows default DNS, redirected
// manifest/ZIP download, integrity verification and staging. Never installs on
// the developer's real server; the isolated fixture is held below the idle gate.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const version=process.argv[2];
const release=path.resolve('Releases/v'+version);
const manifest=JSON.parse(fs.readFileSync(path.join(release,'version.json')));
const zip=path.join(release,'SoftechServer.zip');
const root=fs.mkdtempSync(path.resolve('.test-output/ota-network-'));
const dir=path.join(root,'server');fs.mkdirSync(dir);
const unpack=spawnSync('tar.exe',['-xf',zip,'-C',dir],{windowsHide:true,encoding:'utf8'});
assert.equal(unpack.status,0,unpack.stderr);
const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));
pkg.version='0.0.1';fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg));
fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({updateIdleSeconds:3600}));
const stub=http.createServer((req,res)=>{
  if(req.url==='/latest'){res.writeHead(302,{Location:'/manifest'});res.end();}
  else if(req.url==='/manifest'){res.end(JSON.stringify({...manifest,server:{...manifest.server,downloadUrl:`http://localhost:${stub.address().port}/asset`}}));}
  else if(req.url==='/asset'){res.writeHead(302,{Location:'/file'});res.end();}
  else if(req.url==='/file'){res.writeHead(200,{'Content-Length':fs.statSync(zip).size});fs.createReadStream(zip).pipe(res);}
  else{res.end('{"success":true,"status":"PENDING"}');}
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');
const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const preload=path.join(root,'dns-fixture.mjs');
fs.writeFileSync(preload,`
import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';
const original=dns.lookup;
dns.lookup=function(host,options,callback){
 if(host!=='localhost')return original.apply(this,arguments);
 if(options.family===4&&options.hints===0){console.log('SAFE_UPDATE_DNS');return process.nextTick(()=>callback(null,'127.0.0.1',4));}
 process.nextTick(()=>callback(Object.assign(new Error('getaddrinfo ENOENT'),{code:'ENOENT',syscall:'getaddrinfo'})));
};syncBuiltinESMExports();
const {ServerUpdater}=await import(${JSON.stringify(pathToFileURL(path.join(dir,'src/services/updater.js')).href)});
ServerUpdater.probeIdle=async()=>0;
`);
const cloud=`http://127.0.0.1:${stub.address().port}`;
const child=spawn(path.join(dir,'runtime/node.exe'),['--import',pathToFileURL(preload).href,'src/server.js'],{
  cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,PORT:String(port),SOFTECH_CLOUD_URL:cloud,UPDATE_MANIFEST_URL:`http://localhost:${stub.address().port}/latest`,SUPABASE_URL:'',SUPABASE_ANON_KEY:'',NODE_ENV:'production'}
});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
  let status;const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    assert.equal(child.exitCode,null,logs);
    try{status=await(await fetch(`http://127.0.0.1:${port}/api/updates/status`)).json();}catch{}
    if(status?.error)throw Error(status.error+'\n'+logs);
    if(status?.isStaged)break;
    await new Promise(r=>setTimeout(r,250));
  }
  assert.equal(status?.isStaged,true,logs);
  assert.equal(status.currentVersion,'0.0.1');assert.equal(status.latestVersion,version);
  assert.equal(status.stagedVersion,version);assert.equal(status.downloadedBytes,fs.statSync(zip).size);
  assert.equal(status.isApplying,false);assert.equal(status.error,null);
  const license=await(await fetch(`http://127.0.0.1:${port}/api/license/status`)).json();
  assert.equal(license.state,'PENDING_ACTIVATION');assert.match(logs,/SAFE_UPDATE_DNS/);
  console.log('PASS: unlicensed packaged server downloads redirected release with Windows-safe DNS, verifies SHA256 and stages '+version+' automatically');
}finally{
  if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  stub.closeAllConnections();await new Promise(r=>stub.close(r));
}
