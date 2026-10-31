import crypto from 'node:crypto';

const production = process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
function secret(value, name) {
  if (value && Buffer.byteLength(value) >= 32) return value;
  if (production || value) throw new Error(name + ' must contain at least 32 bytes.');
  // Local sessions expire after a restart unless an environment secret is configured.
  return crypto.randomBytes(48).toString('hex');
}
const accessSecret = secret(process.env.SUPERADMIN_JWT_SECRET || process.env.JWT_SECRET, 'SUPERADMIN_JWT_SECRET');
const refreshSecret = secret(process.env.REFRESH_SECRET, 'REFRESH_SECRET');

function sign(payload, ttl, type, key) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttl, tokenType: type })).toString('base64url');
  const signature = crypto.createHmac('sha256', key).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + signature;
}
function verify(token, type, key) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const [header, body, signature] = parts;
    const expected = crypto.createHmac('sha256', key).update(header + '.' + body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const metadata = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (metadata.alg !== 'HS256' || metadata.typ !== 'JWT' || payload.tokenType !== type ||
        !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
export const signAccessToken = (payload, ttl = 3600) => sign(payload, ttl, 'access', accessSecret);
export const signRefreshToken = (payload, ttl = 30 * 24 * 3600) => sign(payload, ttl, 'refresh', refreshSecret);
export const verifyAccessToken = token => verify(token, 'access', accessSecret);
export const verifyRefreshToken = token => verify(token, 'refresh', refreshSecret);
