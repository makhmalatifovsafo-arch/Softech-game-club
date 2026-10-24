import crypto from 'node:crypto';
import { db } from './db.js';

// In-memory token do'koni: token -> { userId, clubId, clubName, username, role, permissions, expiresAt }
const sessions = new Map();

// 24 soatlik yashash muddati
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * PBKDF2 orqali xavfsiz parol heshlash (Node.js native crypto)
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Kiritilgan parolni heshlangan parol bilan solishtirish
 */
export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

/**
 * Sessiya tokeni yaratish (SaaS Multi-Tenant Aware)
 */
export function createSessionToken(user, club = null) {
  const token = 'sft_' + crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;

  let permissions = [];
  try {
    permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions;
  } catch {
    permissions = [];
  }

  // Agar user club_id ga ega bo'lsa va club berilmagan bo'lsa, bazadan o'qiymiz
  let clubName = club?.name || null;
  let clubIsActive = club ? club.is_active : 1;
  let clubExpiresAt = club ? club.expires_at : null;

  if (user.club_id && !club) {
    try {
      const c = db.prepare('SELECT id, name, is_active, expires_at FROM clubs WHERE id = ?').get(user.club_id);
      if (c) {
        clubName = c.name;
        clubIsActive = c.is_active;
        clubExpiresAt = c.expires_at;
      }
    } catch {}
  }

  const sessionData = {
    userId: user.id,
    clubId: user.club_id ?? null,
    clubName,
    clubIsActive,
    clubExpiresAt,
    username: user.username,
    role: user.role, // 'superadmin' | 'club_owner' | 'administrator' | 'client'
    phoneNumber: user.phone_number || null,
    balance: Number(user.balance || 0),
    permissions: Array.isArray(permissions) ? permissions : ['*'],
    expiresAt,
  };

  sessions.set(token, sessionData);
  return { token, sessionData };
}

/**
 * Token bo'yicha sessiyani tekshirish
 */
export function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Sessiyani o'chirish (Logout)
 */
export function destroySession(token) {
  if (token) {
    sessions.delete(token);
  }
}

/**
 * HTTP so'rovdan tokenni ajratib olish (Authorization: Bearer <token>)
 */
export function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

/**
 * RBAC ruxsat tekshiruvi
 */
export function hasPermission(userPermissions, requiredPermission) {
  if (!Array.isArray(userPermissions)) return false;
  if (userPermissions.includes('*')) return true;
  return userPermissions.includes(requiredPermission);
}
