import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {clubSetupContext} from '../NetCafeServer/src/services/clubSetupContext.js';
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE clubs(id INTEGER,name TEXT); INSERT INTO clubs VALUES(1,'First'),(2,'Other');
    CREATE TABLE zones(id INTEGER,club_id INTEGER,name TEXT,zone_type TEXT,x REAL,y REAL,width REAL,height REAL,polygon_points TEXT);
    INSERT INTO zones VALUES(10,1,'VIP','VIP',0,0,400,300,'[{"x":0,"y":0},{"x":400,"y":0},{"x":0,"y":300}]'),(20,2,'Private','STANDARD',0,0,400,300,NULL);
    CREATE TABLE computers(id TEXT,club_id INTEGER,pc_number INTEGER,name TEXT,zone_id INTEGER,ip_address TEXT,mac_address TEXT);
    INSERT INTO computers VALUES('first',1,1,'PC-01',NULL,'192.168.1.101','02:00:00:00:00:01'),('zero',1,0,'Placeholder',10,NULL,NULL),('other',2,1,'Other PC',20,'192.168.1.102',NULL);
    CREATE TABLE grid_layout(club_id INTEGER,computer_id INTEGER,x REAL,y REAL,zone_id INTEGER);
    INSERT INTO grid_layout VALUES(1,1,50,70,10);
    CREATE TABLE tariffs(id TEXT,club_id INTEGER,zone_id INTEGER,name TEXT,type TEXT,is_active INTEGER,start_time TEXT,end_time TEXT,days_of_week TEXT,price_per_hour REAL,is_vip_postpaid_allowed INTEGER,fixed_price REAL,fixed_duration_minutes INTEGER);
    INSERT INTO tariffs VALUES('room-rate',1,10,'Hour','HOURLY',1,'00:00','00:00','[1,2,3,4,5,6,7]',7000,0,NULL,NULL),('package',1,NULL,'Package','FIXED_PACKAGE',1,NULL,NULL,NULL,0,0,18000,180),('private',2,20,'Private rate','HOURLY',1,'00:00','00:00','[1]',100000,1,NULL,NULL);
    CREATE TABLE tariff_schedules(id INTEGER,club_id INTEGER,priority INTEGER,name TEXT,price_per_hour REAL,start_time TEXT,end_time TEXT,days_of_week TEXT,is_vip INTEGER);
    INSERT INTO tariff_schedules VALUES(1,1,10,'General',10000,'00:00','00:00','[1,2,3,4,5,6,7]',0);
    CREATE TABLE sessions(id TEXT,club_id INTEGER,status TEXT); INSERT INTO sessions VALUES('s1',1,'ACTIVE'),('s2',2,'ACTIVE');`);
  return db;
}
test('setup context preserves real geometry, prices and fallback notes without leaking another club or changing data',()=>{
  const db=fixture();try{
    const before=db.prepare('SELECT total_changes() n').get().n;
    const now=1800000000000,clients=['first','other','zero'].map(pcId=>({pcId,pcNumber:1,ipAddress:'::ffff:192.168.1.101',socket:{readyState:1},lastHeartbeat:now}));
    const result=clubSetupContext(db,1,{clients,maxComputers:20,now});
    assert.equal(result.clubName,'First');assert.equal(result.activeSessions,1);assert.equal(result.initialDraft.expectedComputers,1);
    assert.equal(result.initialDraft.computers[0].roomId,'room_10');assert.equal(result.initialDraft.computers[0].x,50);
    assert.equal(result.initialDraft.rooms[0].polygonPoints.length,3);
    assert.equal(result.initialDraft.tariffs.length,1);assert.equal(result.initialDraft.tariffs[0].price_per_hour,7000);assert.equal(result.initialDraft.tariffs[0].vipAllowed,false);
    assert.equal(result.otherTariffs.find(t=>t.name==='Package').price,18000,'never display the zero hourly field as the package price');
    assert.equal(result.otherTariffs.find(t=>t.name==='General').price,10000);assert.equal(result.notices.length,2);
    assert.equal(result.liveClients.length,1);assert.equal(result.liveClients[0].ip,'192.168.1.101');assert.equal(result.liveClients[0].connected,true);
    assert.equal(clubSetupContext(db,1,{clients,now:now+16000}).liveClients[0].connected,false);
    assert.ok(!JSON.stringify(result).includes('Private'));assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
  }finally{db.close();}
});
test('setup import IDs remain stable when a different tariff is inserted; invalid saved shapes are not silently replaced',()=>{
  const db=fixture();try{
    const id=clubSetupContext(db,1).initialDraft.tariffs[0].id;
    db.exec("INSERT INTO tariffs SELECT 'a-first',club_id,zone_id,'Extra',type,is_active,start_time,end_time,days_of_week,price_per_hour,is_vip_postpaid_allowed,fixed_price,fixed_duration_minutes FROM tariffs WHERE id='room-rate'");
    assert.equal(clubSetupContext(db,1).initialDraft.tariffs.find(t=>t.name==='Hour').id,id);
    db.exec("UPDATE zones SET polygon_points='broken' WHERE id=10");assert.throws(()=>clubSetupContext(db,1),{statusCode:422});
    assert.equal(db.prepare('SELECT polygon_points FROM zones WHERE id=10').get().polygon_points,'broken');
  }finally{db.close();}
});
