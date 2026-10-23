import { verifyAccessToken } from '../utils/jwt.js';
import { db } from '../db/connection.js';

export function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export function requireSuperAdminAuth(req, res) {
  const token = extractBearerToken(req);

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Avtorizatsiyadan o\'tilmagan (Token topilmadi)' }));
    return false;
  }

  const payload = verifyAccessToken(token);
  if (!payload || !payload.sub) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Token yaroqsiz yoki muddati o\'tgan' }));
    return false;
  }

  // Real-time DB tekshiruvi
  const admin = db.prepare('SELECT id, username, full_name, phone FROM super_admins WHERE id = ?').get(payload.sub);
  if (!admin) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Super Admin hisobi mavjud emas' }));
    return false;
  }

  req.user = {
    id: admin.id,
    username: admin.username,
    fullName: admin.full_name,
    phone: admin.phone
  };

  return true;
}
