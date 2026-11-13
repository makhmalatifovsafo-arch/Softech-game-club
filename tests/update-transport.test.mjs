import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { fetchUpdateManifest, downloadUpdateFile } from '../NetCafeServer/src/services/updateTransport.js';
// updater imports db.js. Never open the installed server database: a clean
// checkout may contain its recovery marker but intentionally has no SQLite file.
fs.mkdirSync('.test-output', {recursive:true});
const fixture=fs.mkdtempSync(path.resolve('.test-output/update-status-'));
fs.cpSync('NetCafeServer/src',path.join(fixture,'src'),{recursive:true});
const { ServerUpdater } = await import(pathToFileURL(path.join(fixture,'src/services/updater.js')).href);
const { db } = await import(pathToFileURL(path.join(fixture,'src/db.js')).href);
after(()=>db.close());

test('unavailable update storage does not prevent startup or wedge future update attempts', async () => {
  const blocked=path.join(fixture,'updates-blocked');
  fs.writeFileSync(blocked,'not a directory');
  fs.copyFileSync('NetCafeServer/package.json',path.join(fixture,'package.json'));
  const previous=ServerUpdater.stagingDir;
  try {
    ServerUpdater.stagingDir=path.join(blocked,'staging');
    assert.doesNotThrow(()=>ServerUpdater.init());
    await assert.rejects(ServerUpdater.downloadAndStage({version:'99.0.0',server:{downloadUrl:'https://example.com/update.zip',sha256:'a'.repeat(64)}}));
    assert.equal(ServerUpdater.state.isDownloading,false);
    assert.equal(fs.readFileSync(blocked,'utf8'),'not a directory');
  } finally { ServerUpdater.stagingDir=previous; }
});

test('updater follows GitHub-style redirects with safe DNS and streams large ZIPs; failures recover', async () => {
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/update-network-'));
  const payload=Buffer.alloc(6*1024*1024,0x73);
  let broken=false,lookups=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/latest'){res.writeHead(302,{Location:'/manifest'});res.end();}
    else if(req.url==='/manifest'){res.end(JSON.stringify({version:'9.0.0'}));}
    else if(req.url==='/zip'){res.writeHead(307,{Location:'/asset'});res.end();}
    else if(req.url==='/asset'){res.writeHead(200,{'Content-Length':payload.length});res.end(payload);}
    else if(req.url==='/loop'){res.writeHead(302,{Location:'/loop'});res.end();}
    else if(req.url==='/unsafe'){res.writeHead(302,{Location:'http://external.example/file'});res.end();}
    else if(req.url==='/truncated'){res.writeHead(200,{'Content-Length':1000});res.write('short');setImmediate(()=>res.destroy());}
    else if(req.url==='/stall'){res.writeHead(200);res.write('{');}
    else if(req.url==='/html'){res.end('<html>Login</html>');}
    else if(req.url==='/oversized'){res.writeHead(200,{'Content-Length':2*1024*1024*1024});res.write('x');}
    else{res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://localhost:${server.address().port}`;
  const options={lookupImpl:(host,settings,callback)=>{
    lookups++;assert.equal(settings.family,4);assert.equal(settings.hints,0);
    if(broken)return callback(Object.assign(new Error('DNS failed'),{code:'ENOENT',syscall:'getaddrinfo'}));
    callback(null,'127.0.0.1',4);
  }};
  try{
    assert.deepEqual(await fetchUpdateManifest(base+'/latest',options),{version:'9.0.0'});
    const file=path.join(dir,'download.zip');let progress;
    await downloadUpdateFile(base+'/zip',file,{...options,onProgress:(bytes,total)=>{progress={bytes,total};}});
    assert.equal(fs.statSync(file).size,payload.length);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),crypto.createHash('sha256').update(payload).digest('hex'));
    assert.deepEqual(progress,{bytes:payload.length,total:payload.length});
    assert.ok(lookups>=4,'Redirect target must also use safe DNS');
    await assert.rejects(fetchUpdateManifest(base+'/loop',options),/yo‘naltirish/);
    await assert.rejects(fetchUpdateManifest(base+'/unsafe',options),/HTTPS/);
    await assert.rejects(fetchUpdateManifest(base+'/missing',options),/HTTP 404/);
    await assert.rejects(fetchUpdateManifest(base+'/html',options),/JSON/);
    const partial=path.join(dir,'partial.zip');
    await assert.rejects(downloadUpdateFile(base+'/truncated',partial,options));
    assert.equal(fs.existsSync(partial),false);assert.equal(fs.existsSync(partial+'.part'),false);
    await assert.rejects(downloadUpdateFile(base+'/stall',partial,{...options,signal:AbortSignal.timeout(100)}));
    assert.equal(fs.existsSync(partial+'.part'),false);
    await assert.rejects(downloadUpdateFile(base+'/oversized',partial,options),/too large/);
    assert.equal(fs.existsSync(partial),false);assert.equal(fs.existsSync(partial+'.part'),false);
    broken=true;
    await assert.rejects(fetchUpdateManifest(base+'/latest',options),/ENOENT; getaddrinfo/);
    broken=false;
    assert.equal((await fetchUpdateManifest(base+'/latest',options)).version,'9.0.0');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('update status never invents latest version and clears a previous error after successful check',async()=>{
  const saved={state:ServerUpdater.state,fetchJson:ServerUpdater.fetchJson,currentVersion:ServerUpdater.currentVersion};
  try{
    ServerUpdater.state={isChecking:false,isDownloading:false,latestManifest:null,error:null};
    ServerUpdater.currentVersion='1.0.23';
    ServerUpdater.fetchJson=async()=>{throw Error('DNS unavailable');};
    await ServerUpdater.checkForUpdates();
    assert.equal(ServerUpdater.getStatus().latestVersion,null);
    assert.equal(ServerUpdater.state.error,'DNS unavailable');
    ServerUpdater.fetchJson=async()=>({version:'1.0.23',server:{downloadUrl:'https://example.com/update.zip',sha256:'a'.repeat(64)}});
    await ServerUpdater.checkForUpdates();
    assert.equal(ServerUpdater.getStatus().latestVersion,'1.0.23');
    assert.equal(ServerUpdater.state.error,null);
    assert.ok(ServerUpdater.state.lastSuccessfulCheck);
  }finally{Object.assign(ServerUpdater,saved);}
});
