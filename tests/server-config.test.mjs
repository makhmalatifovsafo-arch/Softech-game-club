import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeConfig, readServerConfig } from '../NetCafeServer/src/services/serverConfig.js';

const config={clubId:73,cloudUrl:'https://club.example',clubToken:'fixture-secret-keep',nested:{label:'O‘yin klubi',active:true}};
const text=JSON.stringify(config,null,2);
const utf16=Buffer.from('\ufeff'+text,'utf16le');
const encodings=[Buffer.from(text),Buffer.from('\ufeff'+text),utf16,Buffer.from(utf16).swap16()];
test('server settings preserve every value across UTF-8 BOM and Windows UTF-16 encodings',()=>{
  for(const bytes of encodings)assert.deepEqual(decodeConfig(bytes),config);
  for(const invalid of ['null','[]','42','{"token":"fixture-secret-keep",}',Buffer.from([0xff,0x00])]){
    assert.throws(()=>decodeConfig(Buffer.from(invalid)),error=>{
      assert.match(error.message,/config.json/);assert.ok(!error.message.includes('fixture-secret-keep'));return true;
    });
  }
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/config-reader-'));
  assert.deepEqual(readServerConfig(path.join(dir,'missing.json')),{});
  const file=path.join(dir,'config.json');fs.writeFileSync(file,encodings[1]);
  assert.deepEqual(readServerConfig(file),config);
  assert.deepEqual(fs.readFileSync(file),encodings[1],'Reading must not rewrite configuration');
});

test('one-click Windows repair backs up original bytes, preserves all settings and refuses malformed JSON', {skip:process.platform!=='win32',timeout:60000},()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/config-repair-'));
  fs.mkdirSync(path.join(dir,'runtime'));fs.copyFileSync(process.execPath,path.join(dir,'runtime/node.exe'));
  fs.writeFileSync(path.join(dir,'netcafe.db'),'database-must-remain-untouched');
  const file=path.join(dir,'config.json');
  const run=()=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/support/Repair-SoftechConfig.ps1'),'-ServerDirectory',dir],{encoding:'utf8',windowsHide:true,timeout:15000});
  let count=0;
  for(const original of encodings){
    fs.writeFileSync(file,original);
    const result=run();assert.equal(result.status,0,result.stdout+result.stderr);
    assert.ok(!result.stdout.includes('fixture-secret-keep'));
    assert.equal(fs.readFileSync(file,'utf8'),text);
    const backups=fs.readdirSync(dir).filter(n=>n.endsWith('.bak'));
    if(!original.equals(encodings[0])){
      count++;assert.ok(backups.some(n=>fs.readFileSync(path.join(dir,n)).equals(original)));
    }
    assert.equal(backups.length,count);
  }
  for(const original of ['{"broken":','null','[]']){
    fs.writeFileSync(file,original);const result=run();assert.notEqual(result.status,0);
    assert.equal(fs.readFileSync(file,'utf8'),original);
    assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.bak')).length,count);
  }
  assert.equal(fs.readFileSync(path.join(dir,'netcafe.db'),'utf8'),'database-must-remain-untouched');
  assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0);
});
