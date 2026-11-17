import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { emptySetupDraft } from '../NetCafeServer/src/services/clubSetup.js';

export async function checkClubSetup({localUrl,ownerHeaders,cashierHeaders,databasePath}) {
  async function request(headers,method='GET',body,path='/api/setup/draft'){
    const response=await fetch(localUrl+path,{method,headers:{'Content-Type':'application/json',...headers},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
    return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
  }
  assert.equal((await request({})).status,401);
  assert.equal((await request(cashierHeaders)).status,403);
  assert.equal((await request(cashierHeaders,'PUT',{revision:0,draft:emptySetupDraft()})).status,403);
  assert.equal((await request({},'POST',{},'/api/setup/complete')).status,401);
  assert.equal((await request(cashierHeaders,'POST',{},'/api/setup/complete')).status,403);
  assert.equal((await request(ownerHeaders,'POST',{},'/api/setup/complete')).status,400);
  const ready=await request(cashierHeaders,'GET',undefined,'/api/setup/status');
  assert.equal(ready.status,200);assert.equal(ready.body.required,false,'completion survives server restarts');
  const before=await request(ownerHeaders);assert.equal(before.status,200,JSON.stringify(before.body));
  assert.equal(before.cache,'no-store');assert.equal(before.body.installationKind,'NEW','fresh marker must survive prior restarts');
  assert.equal(before.body.readiness.canCommit,false,'draft readiness alone cannot authorize completion');
  const db=new DatabaseSync(databasePath,{readOnly:true});
  const readBusiness=()=>Object.fromEntries(['computers','zones','grid_layout','tariffs','tariff_schedules','users','sessions','bar_orders','transactions'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  try{
    const business=readBusiness();
    const source=await request(ownerHeaders,'GET',undefined,'/api/setup/context');
    assert.equal(source.status,200,JSON.stringify(source.body));assert.equal(source.cache,'no-store');
    assert.equal(source.body.initialDraft.computers.length,business.computers.filter(c=>c.club_id===1&&c.pc_number>0).length);
    assert.ok(source.body.initialDraft.computers.every(c=>c.number>0));
    assert.equal(source.body.initialDraft.rooms.length,business.zones.filter(c=>c.club_id===1).length);
    for(const rate of source.body.initialDraft.tariffs)assert.ok(business.tariffs.some(t=>t.club_id===1&&t.name===rate.name&&t.price_per_hour===rate.price_per_hour));
    assert.equal((await request(cashierHeaders,'GET',undefined,'/api/setup/context')).status,403);
    assert.equal((await request(ownerHeaders,'PUT',{},'/api/setup/context')).status,405);
    const attemptedTenant=await request(ownerHeaders,'GET',undefined,'/api/setup/context?clubId=999');
    assert.deepEqual(attemptedTenant.body.initialDraft,source.body.initialDraft);
    const draft={...emptySetupDraft(),expectedComputers:3};
    const saved=await request(ownerHeaders,'PUT',{revision:before.body.revision,draft,clubId:999,canCommit:true});
    assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.revision,before.body.revision+1);
    assert.deepEqual(saved.body.draft,draft);assert.equal(saved.body.readiness.onlineCount,0);
    assert.equal((await request(ownerHeaders,'PUT',{revision:before.body.revision,draft})).status,409);
    assert.equal((await request(ownerHeaders,'PUT',{revision:saved.body.revision,draft:null})).status,400);
    assert.equal((await request(ownerHeaders,'POST',{})).status,405);
    const after=await request(ownerHeaders, 'GET', undefined, '/api/setup/draft?clubId=999');
    assert.equal(after.status,200);assert.deepEqual(after.body.draft,draft,'query/body tenant cannot select another club');
    assert.equal(after.body.revision,saved.body.revision);
    assert.deepEqual(readBusiness(),business,'draft save cannot write rooms, prices, balances, sales or sessions');
    assert.equal(db.prepare('SELECT count(*) AS n FROM club_setup_drafts WHERE club_id=999').get().n,0);
  }finally{db.close();}
  console.log('PASS setup draft API: manager only, tenant from login, revision conflicts and unchanged business records');
}
