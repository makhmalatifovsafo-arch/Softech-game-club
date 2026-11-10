import { ManagerAccountService } from './managerAccountService.js';
import { verifyTelemetryLicense } from './telemetryAuth.js';

// Account delivery must not depend on revenue/cache migrations or command execution.
export async function deliverStaffAccounts(storage, body) {
  const proof = verifyTelemetryLicense(body.signedLicense);
  if (!proof || Number(body.clubId) !== Number(proof.clubId))
    throw Object.assign(new Error('Klub autentifikatsiyasi noto‘g‘ri.'), { statusCode: 401 });
  let club;
  if (storage.db) club = storage.db.prepare('SELECT * FROM clubs WHERE id=? AND hardware_fingerprint=?').get(proof.clubId, proof.hardwareFingerprint);
  else {
    if (!storage.client) throw Object.assign(new Error('Bulut bazasi sozlanmagan.'), { statusCode: 503 });
    const result = await storage.client.from('clubs').select('*').eq('id', proof.clubId).eq('hardware_fingerprint', proof.hardwareFingerprint).maybeSingle();
    if (result.error) throw Object.assign(new Error('Klub ma’lumotlarini o‘qib bo‘lmadi.'), { statusCode: 503 });
    club = result.data;
  }
  if (!club) throw Object.assign(new Error('Klub topilmadi.'), { statusCode: 401 });
  if (!['ACTIVE', 'TRIAL'].includes(club.status) || !(Date.parse(club.license_expires_at) > Date.now()))
    throw Object.assign(new Error('Klub litsenziyasi faol emas.'), { statusCode: 403 });
  const result = { success: true, errors: {} };
  for (const role of ['manager', 'administrator']) {
    try { result[role + 'Account'] = await new ManagerAccountService({ ...storage, role }).delivery(club, body[role + 'Revision']); }
    catch (error) { result.errors[role] = error.message; }
  }
  return result;
}

export async function handleStaffSyncRoute(req, res, storage) {
  if (req.method !== 'POST' || new URL(req.url, 'http://localhost').pathname !== '/api/telemetry/staff-accounts') return false;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    let body = req.body;
    if (body === undefined) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 16384) throw Object.assign(new Error('So‘rov juda katta.'), { statusCode: 413 });
      }
      body = raw;
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { throw Object.assign(new Error('JSON noto‘g‘ri.'), { statusCode: 400 }); }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('JSON obyekti kerak.'), { statusCode: 400 });
    const result = await deliverStaffAccounts(storage, body);
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error.statusCode || 503;
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
  return true;
}
