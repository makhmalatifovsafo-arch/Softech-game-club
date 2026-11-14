import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {runRemoteMaintenance} from '../NetCafeServer/src/services/remoteMaintenance.js';
import {applyCloudCommands,commandResults} from '../NetCafeServer/src/services/cloudCommands.js';
import {deliverCommands} from '../src/services/commandDelivery.js';
import {requireRemoteMaintenance} from '../src/services/maintenanceVersion.js';
function updater(changes={}){
  return {state:{},currentVersion:'1.0.34',getActiveSessionsCount:()=>0,compareSemver:(a,b)=>a.localeCompare(b,undefined,{numeric:true}),
    checkForUpdates:async options=>{assert.equal(options.remote,true);return {latestManifest:{version:'1.0.35'},isStaged:true,stagedVersion:'1.0.35'};},
    applyUpdate:async()=>({success:true}),...changes};
}
test('remote force update verifies latest release, bypasses busy sessions and waits for the restarted version',async()=>{
  const db=new DatabaseSync(':memory:'),cloud=new DatabaseSync(':memory:');
  cloud.exec("CREATE TABLE remote_commands(id INTEGER PRIMARY KEY,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);INSERT INTO remote_commands VALUES(1,7,'FORCE_UPDATE','{}','PENDING',NULL)");
  const club={id:7,hardware_fingerprint:'fixture'},license={clubId:7,hardwareFingerprint:'fixture'};
  let installs=0;const u=updater({getActiveSessionsCount:()=>5,applyUpdate:async options=>{assert.deepEqual(options,{force:true,restartOnly:false});installs++;return {success:true};}});
  const effects={bootId:'old',hasActiveSessions:()=>true,broadcast(){},maintain:(action,options,callbacks)=>runRemoteMaintenance(action,options,{...callbacks,updater:u})};
  try{
    const envelopes=await deliverCommands({db:cloud},club);
    await applyCloudCommands(db,envelopes,license,effects);assert.equal(installs,1);
    assert.equal(commandResults(db,{currentVersion:'1.0.34',bootId:'old',uptime:60})[0].status,'PENDING');
    await applyCloudCommands(db,envelopes,license,effects);assert.equal(installs,1);
    assert.equal(commandResults(db,{currentVersion:'1.0.35',bootId:'new',uptime:2})[0].status,'PENDING','Health observation must finish first');
    const result=commandResults(db,{currentVersion:'1.0.35',bootId:'new',uptime:60});assert.equal(result[0].status,'EXECUTED');
    assert.equal((await deliverCommands({db:cloud},club,result)).length,0);
    assert.match(JSON.parse(cloud.prepare('SELECT payload FROM remote_commands').get().payload).result.message,/1.0.35/);
    await deliverCommands({db:cloud},club,[{id:1,status:'FAILED',message:'stale'}]);
    assert.equal(cloud.prepare('SELECT status FROM remote_commands').get().status,'EXECUTED');
  }finally{db.close();cloud.close();}
});
test('restart uses newest staged version; current-version restart does not reinstall; up-to-date force is a no-op',async()=>{
  for(const [action,latest,restartOnly,called] of [['RESTART_SERVER','1.0.35',false,true],['RESTART_SERVER','1.0.34',true,true],['FORCE_UPDATE','1.0.34',false,false]]){
    let count=0,expected;
    const u=updater({checkForUpdates:async()=>({latestManifest:{version:latest},isStaged:latest==='1.0.35',stagedVersion:latest}),applyUpdate:async options=>{assert.equal(options.restartOnly,restartOnly);count++;return {success:true};}});
    const result=await runRemoteMaintenance(action,{}, {updater:u,progress(){},markRestart:v=>{expected=v;}});
    assert.equal(count,called?1:0);if(called){assert.equal(expected,latest);assert.ok(result.awaitingRestart);}else assert.ok(result.complete);
  }
});
test('network, integrity and handover errors leave the running server intact and report failure',async()=>{
  for(const change of [{checkForUpdates:async()=>({error:'fetch failed'})},{checkForUpdates:async()=>({latestManifest:{version:'1.0.35'},isStaged:false})},{applyUpdate:async()=>({success:false,error:'helper failed'})}]){
    const u=updater(change);await assert.rejects(()=>runRemoteMaintenance('FORCE_UPDATE',{}, {updater:u,progress(){},markRestart(){}}));assert.equal(u.remoteMaintenance,false);
  }
});
test('non-forced restart rechecks sessions after download; zero delay is honored',async()=>{
  let installed=false,slept=false;
  const result=await runRemoteMaintenance('RESTART_SERVER',{delaySeconds:0}, {updater:updater({getActiveSessionsCount:()=>1,applyUpdate:async()=>{installed=true;}}),progress(){},markRestart(){},sleep:async()=>{slept=true;}});
  assert.ok(result.deferred);assert.equal(installed,false);assert.equal(slept,false);
});
test('rollback or interrupted command is never acknowledged as a successful update; old clients require a bootstrap update',()=>{
  const db=new DatabaseSync(':memory:');commandResults(db);
  db.prepare("INSERT INTO cloud_command_receipts(id,club_id,status,expected_version,boot_id) VALUES(1,7,'AWAITING_RESTART','1.0.35','old')").run();
  assert.equal(commandResults(db,{currentVersion:'1.0.34',bootId:'rollback',uptime:60})[0].status,'FAILED');db.close();
  for(const version of ['1.0.33','1.0.9','',undefined])assert.throws(()=>requireRemoteMaintenance({server_version:version}));
  for(const version of ['1.0.34','1.0.100','1.1.0','2.0.0'])requireRemoteMaintenance({server_version:version});
});
test('signed client update command reaches every connected kiosk without restarting the server',async()=>{
  const db=new DatabaseSync(':memory:'),cloud=new DatabaseSync(':memory:');
  cloud.exec("CREATE TABLE remote_commands(id INTEGER PRIMARY KEY,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);INSERT INTO remote_commands VALUES(8,7,'FORCE_CLIENT_UPDATE','{\"reason\":\"fixture\"}','PENDING',NULL)");
  const club={id:7,hardware_fingerprint:'fixture'},license={clubId:7,hardwareFingerprint:'fixture'};
  let options;
  try {
    const envelopes=await deliverCommands({db:cloud},club);
    await applyCloudCommands(db,envelopes,license,{broadcast(){},hasActiveSessions:()=>false,maintain(){throw Error('Server maintenance must not run');},updateClients:value=>{options=value;return 4;}});
    assert.deepEqual(options,{reason:'fixture',commandId:8});
    const result=commandResults(db)[0];assert.equal(result.status,'EXECUTED');assert.match(result.message,/4 ta onlayn client/);
    assert.equal((await deliverCommands({db:cloud},club,[result])).length,0);
  } finally { db.close();cloud.close(); }
});
