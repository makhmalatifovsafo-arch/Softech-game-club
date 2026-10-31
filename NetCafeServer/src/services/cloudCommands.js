import crypto from 'node:crypto';
export function commandResults(db){
 db.exec('CREATE TABLE IF NOT EXISTS cloud_command_receipts(id INTEGER PRIMARY KEY,club_id INTEGER NOT NULL,status TEXT NOT NULL)');
 return db.prepare('SELECT id,status FROM cloud_command_receipts ORDER BY id DESC LIMIT 100').all();
}
export async function applyCloudCommands(db,envelopes,license,{broadcast,restart,hasActiveSessions}){
 commandResults(db);
 for(const envelope of Array.isArray(envelopes)?envelopes.slice(0,50):[]){
  const p=envelope?.payload;
  if(!p||p.clubId!==Number(license?.clubId)||p.hardwareFingerprint!==license?.hardwareFingerprint||!Number.isSafeInteger(p.id)||p.id<1||!['RESTART_SERVER','BROADCAST_ANNOUNCEMENT'].includes(p.action)||!/^[a-f0-9]{64}$/.test(envelope.signature||''))continue;
  const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update('remote-command:'+JSON.stringify(p)).digest();
  if(!crypto.timingSafeEqual(signature,Buffer.from(envelope.signature,'hex')))continue;
  if(db.prepare('SELECT id FROM cloud_command_receipts WHERE id=? AND club_id=?').get(p.id,p.clubId))continue;
  const options=p.options||{};
  if(p.action==='RESTART_SERVER'&&options.force!==true&&hasActiveSessions())continue;
  // Claim before an external action: a restart must never loop after reconnecting.
  db.prepare("INSERT INTO cloud_command_receipts(id,club_id,status) VALUES (?,?,'FAILED')").run(p.id,p.clubId);
  try{
   if(p.action==='BROADCAST_ANNOUNCEMENT')broadcast({title:String(options.title||'Markaziy xabar').slice(0,160),message:String(options.message||'').slice(0,4000)});
   else await restart({delaySeconds:Math.max(5,Math.min(300,Number.parseInt(options.delaySeconds,10)||5)),force:options.force===true});
   db.prepare("UPDATE cloud_command_receipts SET status='EXECUTED' WHERE id=?").run(p.id);
  }catch(error){console.warn('[Cloud command]',p.id,error.message);}
 }
}
