import crypto from 'node:crypto';
export function verifyTelemetryLicense(signed) {
  const payload=signed?.payload;
  if(!payload || !/^[a-f0-9]{64}$/i.test(signed.signature || '')) return null;
  const expected=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest();
  if(!crypto.timingSafeEqual(expected,Buffer.from(signed.signature,'hex'))) return null;
  if(payload.status!=='ACTIVE' || !Number.isInteger(Number(payload.clubId)) || Number(payload.clubId)<=0 ||
    !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt)<=Date.now()) return null;
  return payload;
}
