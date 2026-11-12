import crypto from 'node:crypto';
import {initAnnouncements} from './cloudAnnouncements.js';
export const commandBootId = crypto.randomUUID();
function init(db) {
  db.exec('CREATE TABLE IF NOT EXISTS cloud_command_receipts(id INTEGER PRIMARY KEY,club_id INTEGER NOT NULL,status TEXT NOT NULL)');
  const columns = new Set(db.prepare('PRAGMA table_info(cloud_command_receipts)').all().map(c=>c.name));
  for (const [name,type] of Object.entries({expected_version:'TEXT',boot_id:'TEXT',message:'TEXT',started_at:'INTEGER'}))
    if (!columns.has(name)) db.exec(`ALTER TABLE cloud_command_receipts ADD COLUMN ${name} ${type}`);
}
export function commandResults(db, {currentVersion, bootId=commandBootId, uptime=process.uptime()}={}) {
  init(db);
  for (const row of db.prepare("SELECT * FROM cloud_command_receipts WHERE status IN ('RUNNING','AWAITING_RESTART')").all()) {
    if (currentVersion && row.boot_id !== bootId && uptime >= 45) {
      const okay = row.status === 'AWAITING_RESTART' && row.expected_version === currentVersion;
      db.prepare('UPDATE cloud_command_receipts SET status=?,message=? WHERE id=?').run(okay?'EXECUTED':'FAILED',
        okay?`Server v${currentVersion} qayta ulanib, ishlashi tasdiqlandi.`:`Buyruq yakunlanmadi. Ishlayotgan versiya: ${currentVersion}.`,row.id);
    } else if (row.boot_id === bootId && row.status === 'AWAITING_RESTART' && Date.now()-row.started_at > 180000) {
      db.prepare("UPDATE cloud_command_receipts SET status='FAILED',message='Dastur qayta ochilgani tasdiqlanmadi.' WHERE id=?").run(row.id);
    }
  }
  return db.prepare('SELECT * FROM cloud_command_receipts ORDER BY id DESC LIMIT 100').all().map(r=>({
    id:r.id,status:['EXECUTED','FAILED'].includes(r.status)?r.status:'PENDING',message:r.message || '',version:r.expected_version || null
  }));
}
export async function applyCloudCommands(db,envelopes,license,{broadcast,maintain,hasActiveSessions,bootId=commandBootId}) {
  init(db);
  for (const envelope of Array.isArray(envelopes)?envelopes.slice(0,50):[]) {
    const p=envelope?.payload;
    if(!p||p.clubId!==Number(license?.clubId)||p.hardwareFingerprint!==license?.hardwareFingerprint||!Number.isSafeInteger(p.id)||p.id<1||!['RESTART_SERVER','FORCE_UPDATE','BROADCAST_ANNOUNCEMENT'].includes(p.action)||!/^[a-f0-9]{64}$/.test(envelope.signature||''))continue;
    const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update('remote-command:'+JSON.stringify(p)).digest();
    if(!crypto.timingSafeEqual(signature,Buffer.from(envelope.signature,'hex')))continue;
    const previous=db.prepare('SELECT status FROM cloud_command_receipts WHERE id=? AND club_id=?').get(p.id,p.clubId);
    if(previous && previous.status!=='WAITING')continue;
    const options=p.options||{};
    if(p.action==='BROADCAST_ANNOUNCEMENT') {
      initAnnouncements(db);
      const title=String(options.title||'').trim().slice(0,160),message=String(options.message||'').trim().slice(0,4000);
      // Persist both delivery receipt and unread message atomically, even if no
      // cashier window is open. A network retry must never reopen a dismissed item.
      db.exec('BEGIN IMMEDIATE');
      try {
        if(message)db.prepare('INSERT OR IGNORE INTO cloud_announcements(club_id,id,title,message) VALUES(?,?,?,?)').run(p.clubId,p.id,title,message);
        db.prepare('INSERT INTO cloud_command_receipts(id,club_id,status,message) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,message=excluded.message')
          .run(p.id,p.clubId,message?'EXECUTED':'FAILED',message?'Xabar serverga saqlandi. × bosilguncha ko‘rsatiladi.':'Xabar matni bo‘sh.');
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
      // Only an invalidation signal goes to workstation sockets; the text is
      // fetched through the authenticated staff API on the server screen.
      if(message)try{broadcast({id:p.id});}catch{}
      continue;
    }
    db.prepare("INSERT OR IGNORE INTO cloud_command_receipts(id,club_id,status) VALUES (?,?,'WAITING')").run(p.id,p.clubId);
    const progress=message=>db.prepare('UPDATE cloud_command_receipts SET message=? WHERE id=?').run(String(message).slice(0,500),p.id);
    if(p.action==='RESTART_SERVER'&&options.force!==true&&hasActiveSessions()) { progress('Faol seanslar tugashi kutilmoqda.'); continue; }
    db.prepare("UPDATE cloud_command_receipts SET status='RUNNING',boot_id=?,started_at=? WHERE id=?").run(bootId,Date.now(),p.id);
    try {
      let result;
      result=await maintain(p.action,options,{progress,markRestart:version=>{
        db.prepare("UPDATE cloud_command_receipts SET status='AWAITING_RESTART',expected_version=?,started_at=?,message=? WHERE id=?")
          .run(version,Date.now(),`v${version} qayta ochilishi va ulanishi kutilmoqda.`,p.id);
      }});
      if(result?.complete)db.prepare("UPDATE cloud_command_receipts SET status='EXECUTED',message=? WHERE id=?").run(result.message || 'Bajarildi.',p.id);
      else if(result?.deferred)db.prepare("UPDATE cloud_command_receipts SET status='WAITING',message=? WHERE id=?").run(result.message,p.id);
      if(result?.awaitingRestart)break;
    } catch(error) {
      db.prepare("UPDATE cloud_command_receipts SET status='FAILED',message=? WHERE id=?").run(String(error.message).slice(0,500),p.id);
    }
  }
}
