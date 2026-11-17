import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ClubSetupDrafts, initializeClubSetup, emptySetupDraft, normalizeSetupDraft, evaluateSetupDraft, setupLiveClients } from '../NetCafeServer/src/services/clubSetup.js';

const now=1800000000000;
function validDraft() {
  return {...emptySetupDraft(),step:'review',expectedComputers:1,
    rooms:[{id:'hall',name:'Oddiy zal',type:'STANDARD',x:0,y:0,width:500,height:500}],
    computers:[{id:'draft-pc',number:1,name:'PC-01',roomId:'hall',ip:'192.168.1.101',mac:'02:00:00:00:00:01',x:100,y:100}],
    tariffs:[{id:'hourly',roomId:'hall',name:'Soatlik',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:7000}]};
}
const live=()=>[{number:1,ip:'::ffff:192.168.1.101',mac:'02-00-00-00-00-01',connected:true,lastHeartbeat:now}];
const evaluate=(draft=validDraft(),extra={})=>evaluateSetupDraft(draft,{maxComputers:10,liveClients:live(),now,...extra});
const codes=result=>result.issues.map(x=>x.code);
function fixture(file=':memory:') {
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE clubs(id INTEGER PRIMARY KEY); INSERT INTO clubs VALUES(1),(2);
    CREATE TABLE computers(id TEXT PRIMARY KEY,club_id INTEGER,pc_number INTEGER);
    INSERT INTO computers VALUES('pc_1',1,1),('pc_2',2,1),('placeholder',1,0);
    CREATE TABLE business_money(id INTEGER PRIMARY KEY,amount INTEGER); INSERT INTO business_money VALUES(1,5320);`);
  return db;
}

test('setup marker distinguishes upgrades from fresh installs and drafts survive a database reopen',()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const file=path.join(fs.mkdtempSync(path.resolve('.test-output/setup-')),'drafts.db');
  let db=fixture(file);
  initializeClubSetup(db,{existingInstallation:false});
  let drafts=new ClubSetupDrafts(db);
  assert.equal(drafts.read(1).installationKind,'NEW');
  const saved=drafts.save(1,42,0,validDraft());
  db.close();db=new DatabaseSync(file);
  try{
    initializeClubSetup(db,{existingInstallation:true});drafts=new ClubSetupDrafts(db);
    assert.deepEqual(drafts.read(1),saved,'restart cannot turn a new installation into an existing one');
    assert.equal(db.prepare('SELECT updated_by FROM club_setup_drafts WHERE club_id=1').get().updated_by,'42');
    assert.equal(drafts.read(2).revision,0,'another tenant is untouched');
    const before=db.prepare('SELECT * FROM business_money').all();
    assert.equal(before[0].amount,5320);
    assert.equal(db.prepare('SELECT count(*) AS n FROM computers').get().n,3);
  } finally{db.close();}
  const existing=fixture();try{
    initializeClubSetup(existing);initializeClubSetup(existing,{existingInstallation:false});
    assert.equal(new ClubSetupDrafts(existing).read(1).installationKind,'EXISTING','never force setup onto an old club, even one with no sales');
  }finally{existing.close();}
});

test('setup drafts reject stale writes, malformed input and corrupt storage without modifying business data',()=>{
  const db=fixture();try{
    initializeClubSetup(db);const drafts=new ClubSetupDrafts(db);
    const before=db.prepare('SELECT * FROM business_money').all();
    const first=drafts.save(1,42,0,validDraft());
    assert.throws(()=>drafts.save(1,43,0,{...validDraft(),expectedComputers:2}),{statusCode:409});
    assert.deepEqual(drafts.read(1),first);
    assert.throws(()=>drafts.save(1,43,1,{...validDraft(),rooms:null}),{statusCode:400});
    assert.equal(drafts.read(1).revision,1);
    assert.throws(()=>drafts.read(99),{statusCode:404});
    db.prepare('UPDATE club_setup_drafts SET draft_json=? WHERE club_id=1').run('\0\0');
    assert.throws(()=>drafts.read(1),{statusCode:503});
    // Node 22's SQLite text reader stops at NUL. Compare the actual stored
    // bytes so the preservation check works on both release and dev runtimes.
    assert.equal(db.prepare('SELECT hex(draft_json) AS bytes FROM club_setup_drafts WHERE club_id=1').get().bytes,'0000','do not silently reset a damaged draft');
    assert.deepEqual(db.prepare('SELECT * FROM business_money').all(),before);
  }finally{db.close();}
});

test('upgrade from a draft-only release never gates clubs that have already configured rooms or traded',()=>{
  for(const table of ['sessions','transactions','zones']){
    const db=fixture();try{
      db.exec(`CREATE TABLE club_setup_drafts(club_id INTEGER PRIMARY KEY,installation_kind TEXT,revision INTEGER DEFAULT 0,draft_json TEXT,updated_by TEXT,updated_at TEXT);
        CREATE TABLE ${table}(club_id INTEGER); INSERT INTO ${table} VALUES(1);`);
      db.prepare("INSERT INTO club_setup_drafts(club_id,installation_kind,draft_json) VALUES(1,'NEW',?)").run(JSON.stringify(emptySetupDraft()));
      initializeClubSetup(db,{existingInstallation:false});const store=new ClubSetupDrafts(db);
      assert.equal(store.read(1).installationKind,'EXISTING',table);
      assert.equal(store.read(2).installationKind,'NEW','a genuinely new other club remains unconfigured');
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,1,'history untouched');
    }finally{db.close();}
  }
});

test('setup accepts partial drafts but cannot start operation, and discards untrusted flags',()=>{
  assert.deepEqual(normalizeSetupDraft(emptySetupDraft()),emptySetupDraft());
  const raw=validDraft();raw.clubId=2;raw.canCommit=true;raw.computers[0].connected=true;
  assert.deepEqual(normalizeSetupDraft(raw),validDraft());
  const result=evaluate(raw);assert.equal(result.draftValid,true);assert.equal(result.canCommit,false);assert.equal(result.onlineCount,1);assert.deepEqual(result.warnings,[]);
  assert.equal(evaluate(emptySetupDraft()).draftValid,false);
  for(const raw of [null,[],{...validDraft(),schemaVersion:2},{...validDraft(),rooms:Array(65).fill(validDraft().rooms[0])}])
    assert.throws(()=>normalizeSetupDraft(raw),{statusCode:400});
  const oversized=validDraft();oversized.rooms[0].name='x'.repeat(81);assert.throws(()=>normalizeSetupDraft(oversized),{statusCode:400});
});

test('setup checks room assignments, unique PC identities, actual IPs and signed license capacity',()=>{
  const raw=validDraft();raw.expectedComputers=2;raw.computers.push({...raw.computers[0],id:'second'});
  assert.ok(codes(evaluate(raw)).includes('PC_NUMBER'));assert.ok(codes(evaluate(raw)).includes('PC_IP'));assert.ok(codes(evaluate(raw)).includes('PC_MAC'));
  assert.ok(codes(evaluate(raw,{maxComputers:1})).includes('LICENSE_LIMIT'));
  assert.ok(codes(evaluate(validDraft(),{maxComputers:undefined})).includes('LIMIT_UNKNOWN'));
  for(const ip of ['127.0.0.1','0.0.0.0','224.1.1.1','255.255.255.255','192.168.1.999','']){
    const d=validDraft();d.computers[0].ip=ip;assert.ok(codes(evaluate(d)).includes('PC_IP'),ip);
  }
  const d=validDraft();d.computers[0].roomId='missing';assert.ok(codes(evaluate(d)).includes('PC_ROOM'));
  d.computers[0].roomId='hall';d.computers[0].x=500;assert.ok(codes(evaluate(d)).includes('PC_POSITION'));
  d.rooms[0].width=0;assert.ok(codes(evaluate(d)).includes('ROOM_SIZE'));
});

test('setup requires every actual client: disconnected, stale, future, duplicate and mismatched handshakes fail',()=>{
  for(const patch of [{connected:false},{lastHeartbeat:now-15001},{lastHeartbeat:now+1},{lastHeartbeat:'now'},
    {number:2},{ip:'192.168.1.102'},{mac:'02:00:00:00:00:02'}]){
    const result=evaluate(validDraft(),{liveClients:[{...live()[0],...patch}]});
    assert.equal(result.onlineCount,0,JSON.stringify(patch));assert.ok(codes(result).includes('PC_OFFLINE'));
  }
  assert.equal(evaluate(validDraft(),{liveClients:[...live(),...live()]}).onlineCount,0);
  const raw=validDraft();raw.computers[0].connected=true;raw.computers[0].status='ONLINE';
  assert.equal(evaluate(raw,{liveClients:[]}).onlineCount,0);
  raw.expectedComputers=2;raw.computers.push({...raw.computers[0],id:'pc2',number:2,ip:'192.168.1.102',mac:''});
  const result=evaluate(raw);assert.equal(result.onlineCount,1);assert.equal(result.draftValid,false);
});

test('live setup matching is tenant-scoped, exact and excludes PC-0 and closed sockets',()=>{
  const db=fixture();try{
    const client=pcId=>({pcId,pcNumber:1,ipAddress:'192.168.1.101',macAddress:'02:00:00:00:00:01',lastHeartbeat:now,socket:{readyState:1}});
    const clients=['pc_1','pc_2','pc_01','placeholder'].map(client);
    const scoped=setupLiveClients(db,1,clients);assert.equal(scoped.length,1);assert.equal(evaluate(validDraft(),{liveClients:scoped}).onlineCount,1);
    clients[0].socket.readyState=3;assert.equal(evaluate(validDraft(),{liveClients:setupLiveClients(db,1,clients)}).onlineCount,0);
    clients[0].socket.readyState=1;clients[0].isAlive=false;
    assert.equal(evaluate(validDraft(),{liveClients:setupLiveClients(db,1,clients)}).onlineCount,0);
  }finally{db.close();}
});

test('setup tariff validation matches overnight, Sunday wrapping and full-day pricing semantics',()=>{
  const d=validDraft(),base=d.tariffs[0];
  d.tariffs=[{...base,start_time:'22:00',end_time:'06:00',days_of_week:[7]},
    {...base,id:'monday',start_time:'05:00',end_time:'10:00',days_of_week:[1]}];
  assert.ok(codes(evaluate(d)).includes('TARIFF_OVERLAP'),'Sunday night overlaps Monday morning');
  d.tariffs[1].start_time='06:00';assert.ok(!codes(evaluate(d)).includes('TARIFF_OVERLAP'),'adjacent endpoints must not overlap');
  assert.equal(evaluate(d).warnings[0].code,'TARIFF_GAPS');
  d.tariffs=[{...base,start_time:'18:00',end_time:'18:00',days_of_week:[1]},
    {...base,id:'tuesday',start_time:'00:00',end_time:'06:00',days_of_week:[2]}];
  assert.ok(!codes(evaluate(d)).includes('TARIFF_OVERLAP'),'equal times cover Monday only, not Tuesday morning');
  d.tariffs[1].days_of_week=[1];assert.ok(codes(evaluate(d)).includes('TARIFF_OVERLAP'));
  d.tariffs=[{...base,price_per_hour:0}];assert.ok(codes(evaluate(d)).includes('TARIFF_INVALID'));
  d.tariffs=[];assert.ok(codes(evaluate(d)).includes('NO_TARIFF'));
});
