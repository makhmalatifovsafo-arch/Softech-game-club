import crypto from 'node:crypto';
export function mobileCloudUser(db,envelope,license){
 const p=envelope?.payload;
 if(!p||p.kind!=='MOBILE_STAFF_SESSION'||!['manager','administrator'].includes(p.role)||Number(p.clubId)!==Number(license?.clubId)||p.hardwareFingerprint!==license?.hardwareFingerprint||!(Date.parse(p.expiresAt)>Date.now())||Date.parse(p.expiresAt)>Date.now()+300000||!/^[a-f0-9]{64}$/.test(envelope.signature||''))return null;
 const expected=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update('mobile-staff:'+JSON.stringify(p)).digest();
 if(!crypto.timingSafeEqual(expected,Buffer.from(envelope.signature,'hex')))return null;
 const table=p.role==='manager'?'cloud_manager_state':'cloud_administrator_state';
 const row=db.prepare(`SELECT u.*,s.revision FROM ${table} s JOIN users u ON u.id=s.user_id WHERE s.club_id=? AND u.club_id=1`).get(p.clubId);
 if(!row||Number(row.revision)!==Number(p.revision)||row.username!==p.username||!(p.role==='manager'?['club_owner','manager']:['administrator']).includes(row.role))return null;
 return row;
}
