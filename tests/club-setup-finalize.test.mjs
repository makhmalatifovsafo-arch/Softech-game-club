import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {initializeClubSetup,ClubSetupDrafts,emptySetupDraft} from '../NetCafeServer/src/services/clubSetup.js';
import {setupFingerprint} from '../NetCafeServer/src/services/clubSetupContext.js';
import {finalizeClubSetup,clubSetupStatus} from '../NetCafeServer/src/services/clubSetupFinalize.js';
function fixture(){
  fs.mkdirSync('.test-output',{recursive:true});const file=path.join(fs.mkdtempSync(path.resolve('.test-output/setup-final-')),'club.db');
  const db=new DatabaseSync(file);db.exec(fs.readFileSync('NetCafeServer/schema.sql','utf8'));
  for(const [table,column] of [['zones','polygon_points TEXT'],['computers','zone_id INTEGER'],['grid_layout','x REAL DEFAULT 0'],['grid_layout','y REAL DEFAULT 0'],['grid_layout','zone_id INTEGER']])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column.split(' ')[0]))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  db.exec(`INSERT INTO clubs(id,name,owner_name,phone,expires_at) VALUES(1,'Club','Owner','phone','2099-01-01'),(2,'Other','Other','phone','2099-01-01');
    INSERT INTO computers(id,club_id,pc_number,name,ip_address,mac_address) VALUES('stable-pc',1,1,'PC-01','192.168.1.101','02:00:00:00:00:01');
    INSERT INTO tariffs(id,club_id,name,type,price_per_hour) VALUES('historical-rate',1,'History','HOURLY',12000);
    INSERT INTO users(id,club_id,username,password_hash,role,permissions,balance) VALUES(1,1,'customer','fixture','client','[]',5320);`);
  initializeClubSetup(db,{existingInstallation:false});
  const draft={...emptySetupDraft(),step:'review',expectedComputers:1,rooms:[{id:'new-room',name:'Zal',type:'STANDARD',x:0,y:0,width:400,height:300}],
    computers:[{id:'draft-pc',number:1,name:'PC-01',roomId:'new-room',ip:'192.168.1.101',mac:'02:00:00:00:00:01',x:80,y:100}],
    tariffs:[{id:'new-rate',name:'Kunlik',roomId:'new-room',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:7000,vipAllowed:true}]};
  const store=new ClubSetupDrafts(db);store.save(1,10,0,draft,setupFingerprint(db,1));
  const options={maxComputers:10,clients:[{pcId:'stable-pc',pcNumber:1,ipAddress:'192.168.1.101',macAddress:'02:00:00:00:00:01',lastHeartbeat:Date.now(),socket:{readyState:1}}]};
  return {db,file,draft,store,options};
}
test('final setup atomically applies registered PCs and room pricing; receipt survives restart and never reapplies',()=>{
  const f=fixture();let {db}=f;const request={requestId:'repeat-safe-request-0001',revision:1};
  try{
    assert.equal(clubSetupStatus(db,1).required,true);
    db.exec("INSERT INTO sessions(id,club_id,computer_id,tariff_id,ends_at,status,total_amount) VALUES('history',1,'stable-pc','historical-rate','2026-01-01','COMPLETED',10000)");
    const receipt=finalizeClubSetup(db,1,10,request,f.options);
    assert.equal(clubSetupStatus(db,1).required,false);assert.equal(db.prepare('SELECT id FROM computers WHERE club_id=1').get().id,'stable-pc');
    assert.equal(db.prepare("SELECT price_per_hour FROM tariffs WHERE zone_id IS NOT NULL AND is_active=1").get().price_per_hour,7000);
    assert.equal(db.prepare("SELECT total_amount FROM sessions WHERE id='history'").get().total_amount,10000);
    assert.equal(db.prepare('SELECT balance FROM users WHERE id=1').get().balance,5320);
    assert.equal(clubSetupStatus(db,2).required,true);
    db.close();db=new DatabaseSync(f.file);initializeClubSetup(db,{existingInstallation:true});
    assert.deepEqual(finalizeClubSetup(db,1,10,request,{...f.options,clients:[]}),receipt,'lost response retries return receipt even after clients disconnect');
    assert.equal(db.prepare('SELECT count(*) n FROM zones').get().n,1);
    assert.throws(()=>finalizeClubSetup(db,1,10,{...request,revision:2},f.options),{statusCode:409});
    assert.equal(clubSetupStatus(db,1).required,false);
  }finally{db.close();}
});
test('completion rejects offline clients, stale revisions, changed settings, active sessions and tariff gaps without partial writes',()=>{
  const f=fixture();try{
    const req={requestId:'validation-request-0001',revision:1},before=f.db.prepare('SELECT count(*) n FROM zones').get().n;
    assert.throws(()=>finalizeClubSetup(f.db,1,10,req,{...f.options,clients:[]}),{statusCode:422});
    assert.throws(()=>finalizeClubSetup(f.db,1,10,{...req,revision:0},f.options),{statusCode:409});
    f.db.exec("INSERT INTO sessions(id,club_id,computer_id,tariff_id,ends_at,status) VALUES('active',1,'stable-pc','historical-rate','2099-01-01','ACTIVE')");
    assert.throws(()=>finalizeClubSetup(f.db,1,10,req,f.options),/Faol seanslar/);f.db.exec("DELETE FROM sessions WHERE id='active'");
    f.db.exec("UPDATE tariffs SET price_per_hour=13000 WHERE id='historical-rate'");
    assert.throws(()=>finalizeClubSetup(f.db,1,10,req,f.options),/sozlamalari o‘zgargan/);
    f.draft.tariffs[0].days_of_week=[1];f.store.save(1,10,1,f.draft,setupFingerprint(f.db,1));
    assert.throws(()=>finalizeClubSetup(f.db,1,10,{...req,revision:2},f.options),/24\/7/);
    assert.equal(f.db.prepare('SELECT count(*) n FROM zones').get().n,before);assert.equal(clubSetupStatus(f.db,1).required,true);
  }finally{f.db.close();}
});
test('mid-transaction failure rolls back rooms, rates, identities and completion; same request can retry',()=>{
  const f=fixture();try{
    f.db.exec("CREATE TRIGGER fail_setup BEFORE UPDATE ON computers BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    const req={requestId:'rollback-request-0001',revision:1};
    assert.throws(()=>finalizeClubSetup(f.db,1,10,req,f.options),/injected failure/);
    assert.equal(f.db.prepare('SELECT count(*) n FROM zones').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tariffs').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM club_setup_receipts').get().n,0);assert.equal(f.store.read(1).revision,1);
    f.db.exec('DROP TRIGGER fail_setup');assert.ok(finalizeClubSetup(f.db,1,10,req,f.options).completedAt);
  }finally{f.db.close();}
});

test('all room types keep compatible legacy PC categories and existing setup cannot drop historical identities',()=>{
  for(const [type,category] of [['STANDARD','STANDARD'],['VIP','VIP'],['PS5','PLAYSTATION'],['BOOTCAMP_5V5','STANDARD']]){
    const f=fixture();try{
      f.draft.rooms[0].type=type;f.draft.computers[0].mac='';f.store.save(1,10,1,f.draft,setupFingerprint(f.db,1));
      assert.throws(()=>finalizeClubSetup(f.db,1,10,null,f.options),{statusCode:400});
      finalizeClubSetup(f.db,1,10,{requestId:'room-type-request-0001',revision:2},f.options);
      assert.equal(f.db.prepare('SELECT zone FROM computers').get().zone,category);
      assert.equal(f.db.prepare('SELECT mac_address FROM computers').get().mac_address,'02:00:00:00:00:01','retain automatically discovered MAC when the optional input is blank');
      assert.equal(f.db.prepare('SELECT zone_type FROM zones').get().zone_type,type);
      const saved=f.store.read(1),oldRate=f.db.prepare('SELECT id FROM tariffs WHERE zone_id IS NOT NULL AND is_active=1').get().id;
      saved.draft.tariffs[0].price_per_hour=8000;
      f.store.save(1,10,saved.revision,saved.draft,setupFingerprint(f.db,1));
      finalizeClubSetup(f.db,1,10,{requestId:'room-type-request-0002',revision:saved.revision+1},f.options);
      assert.equal(f.db.prepare('SELECT is_active FROM tariffs WHERE id=?').get(oldRate).is_active,0,'historical rate ID retained');
      assert.equal(f.db.prepare('SELECT count(*) n FROM zones').get().n,1,'existing room reused');
      assert.equal(f.db.prepare('SELECT id FROM computers').get().id,'stable-pc');
      const next=f.store.read(1);next.draft.rooms[0].id='different-room';next.draft.computers[0].roomId='different-room';next.draft.tariffs[0].roomId='different-room';
      f.store.save(1,10,next.revision,next.draft,setupFingerprint(f.db,1));
      assert.throws(()=>finalizeClubSetup(f.db,1,10,{requestId:'room-type-request-0003',revision:next.revision+1},f.options),/Mavjud xonani/);
    }finally{f.db.close();}
  }
});
