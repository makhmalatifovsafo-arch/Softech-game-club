import { db } from '../db.js';
import { hashPassword, verifyPassword, revokeUserSessions } from '../auth.js';
import { canClientCloseSession } from './sessionMode.js';

const attempts = new Map();
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

export function updateCustomerCredentials({clubId, userId, username, password, currentPassword, computerId, sessionId, selfService=false}) {
  let session;
  if (selfService) {
    session = db.prepare("SELECT * FROM sessions WHERE computer_id=? AND id=? AND status='ACTIVE'").get(computerId, sessionId);
    if (!session || !canClientCloseSession(session) || Date.parse(session.ends_at)<=Date.now()) fail(403, 'Hisobingizga kirgan faol seans kerak.');
    userId = session.user_id;
    clubId = session.club_id;
  }
  const user = db.prepare("SELECT * FROM users WHERE id=? AND club_id=? AND role='client'").get(userId, clubId);
  if (!user) fail(404, 'Mijoz hisobi topilmadi.');
  if (selfService) {
    const now=Date.now();
    for (const [id,bucket] of attempts) if(bucket.until<=now) attempts.delete(id);
    const bucket=attempts.get(user.id)||{count:0,until:now+600000};
    attempts.set(user.id,bucket);
    if (++bucket.count>5) fail(429, 'Urinishlar limiti tugadi. 10 daqiqadan keyin qayta urining.');
    if (!verifyPassword(currentPassword,user.password_hash)) fail(403, 'Amaldagi parol noto‘g‘ri.');
  }
  if (typeof username!=='string' || !/^[\p{L}\p{N}_.-]{3,32}$/u.test(username.trim())) fail(400, 'Login 3–32 ta harf, raqam, nuqta, chiziq yoki pastki chiziqdan iborat bo‘lsin.');
  username=username.trim();
  if (password!==undefined && (typeof password!=='string'||password.length<4||password.length>128||!password.trim())) fail(400, 'Parol 4–128 ta belgidan iborat bo‘lsin.');
  if (db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,user.id)) fail(409, 'Bu login band. Boshqa login tanlang.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run(username,password===undefined?user.password_hash:hashPassword(password),user.id);
    // Keep the account identity, financial records and active session intact.
    db.prepare("UPDATE sessions SET customer_name=? WHERE user_id=? AND club_id=? AND status='ACTIVE'").run(username,user.id,clubId);
    revokeUserSessions(user.id);
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
  attempts.delete(user.id);
  return {success:true,userId:user.id,username};
}
