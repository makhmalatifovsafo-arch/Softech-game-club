import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
for(const file of ['public/sw.js','SoftechCloudAdmin/public/sw.js'])test(file+' serves fresh UI, offline shell and never caches API authority',async()=>{
 const listeners={};const saved=new Map();let offline=false;let puts=0;let networkText='new layout';
 const cache={addAll:async()=>{},match:async r=>saved.get(typeof r==='string'?r:r.url)?.clone(),put:async(r,v)=>{puts++;saved.set(r.url,v);}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{URL,Response,console,self:{location:{origin:'https://test.local'},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting(){},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async()=>{if(offline)throw Error('offline');return new Response(networkText);}});
 async function request(path,method='GET',mode='cors'){let result;const waits=[];listeners.fetch({request:{url:'https://test.local'+path,method,mode},respondWith:p=>result=p,waitUntil:p=>waits.push(p)});const r=await result;await Promise.all(waits);return r;}
 saved.set('https://test.local/layout.css',new Response('old layout'));
 assert.equal(await (await request('/layout.css')).text(),'new layout');assert.equal(puts,1);
 offline=true;assert.equal(await (await request('/layout.css')).text(),'new layout');
 saved.set('https://test.local/api/clubs',new Response('stale authorized data'));
 for(const method of ['GET','POST']){const r=await request('/api/clubs',method);assert.equal(r.status,503);assert.equal((await r.json()).offline,true);}
 assert.equal(puts,1);offline=false;networkText='fresh API';assert.equal(await(await request('/api/clubs')).text(),'fresh API');assert.equal(puts,1);
 assert.equal(await request('/custom-write','POST'),undefined);
 offline=true;saved.set('/index.html',new Response('offline shell'));assert.equal(await(await request('/page','GET','navigate')).text(),'offline shell');assert.equal((await request('/missing.js')).status,503);
});
