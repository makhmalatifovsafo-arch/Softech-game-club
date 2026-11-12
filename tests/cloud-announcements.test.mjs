import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import path from 'node:path';
import {applyCloudCommands,commandResults} from '../NetCafeServer/src/services/cloudCommands.js';
import {pendingAnnouncements,dismissAnnouncement} from '../NetCafeServer/src/services/cloudAnnouncements.js';
import {deliverCommands} from '../src/services/commandDelivery.js';
import {announcementPayload} from '../src/services/announcementPayload.js';

test('signed announcements survive a closed UI/restart, preserve order, tenant scope and dismissal on retries',async()=>{
 fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/announcements-'));
 const cloud=new DatabaseSync(':memory:');let local=new DatabaseSync(path.join(dir,'local.db'));
 cloud.exec("CREATE TABLE remote_commands(id INTEGER PRIMARY KEY,club_id,command_type,payload,status,executed_at)");
 for(const id of [1,2])cloud.prepare("INSERT INTO remote_commands VALUES(?,7,'BROADCAST_ANNOUNCEMENT',?,'PENDING',NULL)").run(id,JSON.stringify({title:'Hello',message:'Message '+id,durationSeconds:5}));
 const club={id:7,hardware_fingerprint:'fixture'},license={clubId:7,hardwareFingerprint:'fixture'};
 const effects={broadcast:()=>{throw Error('No window open');},hasActiveSessions:()=>true};
 try {
  const packets=await deliverCommands({db:cloud},club);
  await applyCloudCommands(local,packets,{...license,clubId:8},effects);assert.equal(pendingAnnouncements(local,7).length,0);
  await applyCloudCommands(local,[{...packets[0],payload:{...packets[0].payload,options:{message:'Forged'}}}],license,effects);assert.equal(pendingAnnouncements(local,7).length,0);
  await applyCloudCommands(local,packets,license,effects);assert.deepEqual(pendingAnnouncements(local,7).map(n=>n.id),[1,2]);
  assert.equal(commandResults(local).every(r=>r.status==='EXECUTED'),true);
  assert.equal(dismissAnnouncement(local,8,1),false);assert.equal(pendingAnnouncements(local,8).length,0);
  local.close();local=new DatabaseSync(path.join(dir,'local.db'));
  assert.equal(pendingAnnouncements(local,7)[0].message,'Message 1');
  assert.equal(dismissAnnouncement(local,7,1),true);assert.equal(dismissAnnouncement(local,7,1),true);
  await applyCloudCommands(local,packets,license,effects);assert.deepEqual(pendingAnnouncements(local,7).map(n=>n.id),[2]);
  assert.equal((await deliverCommands({db:cloud},club,commandResults(local))).length,0);
 }finally{local.close();cloud.close();}
});
test('sender validates message size and always requires explicit dismissal',()=>{
 for(const message of ['', '   ', 'x'.repeat(4001)])assert.throws(()=>announcementPayload({message}));
 assert.throws(()=>announcementPayload({message:'ok',title:'x'.repeat(161)}));
 assert.deepEqual(announcementPayload({message:' Salom\nKlub ',durationSeconds:5}),{title:'',message:'Salom\nKlub',priority:'HIGH',requireDismiss:true});
});
