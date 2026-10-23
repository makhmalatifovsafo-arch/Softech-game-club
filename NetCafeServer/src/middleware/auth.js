import { extractToken, getSession, hasPermission } from '../auth.js';
import { db } from '../db.js';

/**
 * Multi-Tenancy & SaaS Auth Middleware
 * 
 * 1. Tokenni o'qiydi va req.user obyektiga sessiya ma'lumotlarini biriktiradi.
 * 2. Agar foydalanuvchi club_owner yoki administrator bo'lsa:
 *    - req.user.club_id orqali klubning obuna holati tekshiriladi (expires_at, is_active).
 *    - Agar obuna muddati o'tgan bo'lsa (expires_at < NOW yoki is_active = 0), operativ kassa va seans amallari to'xtatilib 403 litsenziya xatosi qaytariladi.
 * 3. Super Admin (role === 'superadmin') global huquqqa ega bo'lib, club_id filtrisiz barcha klublar ma'lumotlarini ko'ra oladi.
 */
export function authenticate(req, res, options = {}) {
  const token = extractToken(req);
  const session = getSession(token);

  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Avtorizatsiyadan o\'tilmagan yoki sessiya muddati tugagan.' }));
    return false;
  }

  // Foydalanuvchi ma'lumotlarini yangilab olish (Real-time DB tekshiruvi)
  const freshUser = db.prepare(`
    SELECT u.id, u.club_id, u.username, u.role, u.phone_number, u.balance, u.permissions
    FROM users u
    WHERE u.id = ?
  `).get(session.userId);

  if (!freshUser) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Foydalanuvchi hisobi mavjud emas.' }));
    return false;
  }

  let permissions = [];
  try {
    permissions = typeof freshUser.permissions === 'string' ? JSON.parse(freshUser.permissions) : freshUser.permissions;
  } catch {
    permissions = [];
  }

  // Klub ma'lumotlarini o'qish (agar club_id bo'lsa)
  let club = null;
  if (freshUser.club_id) {
    club = db.prepare(`
      SELECT id, name, owner_name, phone, subscription_tier, max_computers, price_per_pc_monthly, is_active, expires_at
      FROM clubs
      WHERE id = ?
    `).get(freshUser.club_id);
  }

  req.user = {
    id: freshUser.id,
    clubId: freshUser.club_id,
    username: freshUser.username,
    role: freshUser.role, // 'superadmin' | 'club_owner' | 'administrator' | 'client'
    phoneNumber: freshUser.phone_number,
    balance: Number(freshUser.balance || 0),
    permissions: Array.isArray(permissions) ? permissions : ['*'],
    club: club || null
  };

  // Agar talab qilingan rollar bo'lsa tekshirish
  if (options.roles && !options.roles.includes(req.user.role)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Ruxsat yetarli emas. Talab qilinadigan rol: ${options.roles.join(', ')}` }));
    return false;
  }

  // Agar talab qilingan permission bo'lsa tekshirish
  if (options.permission && !hasPermission(req.user.permissions, options.permission) && req.user.role !== 'superadmin' && req.user.role !== 'club_owner') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Amalni bajarish uchun ruxsat yetarli emas (${options.permission}).` }));
    return false;
  }

  // 4. Litsenziya va Obuna tekshiruvi (Faqat klub foydalanuvchilari uchun: club_owner, administrator, client)
  // Super Admin har doim o'tadi
  if (req.user.role !== 'superadmin' && req.user.club) {
    const isClubActive = Boolean(req.user.club.is_active);
    const expiresAt = new Date(req.user.club.expires_at).getTime();
    const now = Date.now();

    if (!isClubActive || expiresAt < now) {
      // Agar kassa yoki operatsion amal bo'lsa, bloklaymiz
      const isExempt = options.allowExpiredClub || false;
      if (!isExempt) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Klub obuna muddati tugagan yoki xizmat faol emas. Iltimos, xizmat ko\'rsatuvchi administratorga murojaat qiling.',
          code: 'SUBSCRIPTION_EXPIRED',
          expiresAt: req.user.club.expires_at,
          isActive: isClubActive
        }));
        return false;
      }
    }
  }

  return true;
}

/**
 * DB query helper: club_id bo'yicha izolyatsiya
 * Super Admin bo'lsa barcha ma'lumotlar yoki tanlangan club_id bo'yicha filter
 */
export function getTenantClubId(req) {
  if (!req.user) return 1;
  if (req.user.role === 'superadmin') {
    // Super Admin xohlasa query params yoki headerdan club_id uzatishi mumkin, aks holda null (barchasi)
    return null;
  }
  return req.user.clubId || 1;
}
