import { db, verifyPassword } from '../db/connection.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { requireSuperAdminAuth, extractBearerToken } from '../middleware/auth.js';

// Brute-force himoyasi: IP yoki Username bo'yicha PIN urinishlarini cheklash
const pinAttemptsTracker = new Map();

function checkPinRateLimit(key) {
  const now = Date.now();
  const record = pinAttemptsTracker.get(key);

  if (!record) return { allowed: true };

  // Agar 2 daqiqa blokirovka muddati o'tgan bo'lsa
  if (record.blockedUntil && now > record.blockedUntil) {
    pinAttemptsTracker.delete(key);
    return { allowed: true };
  }

  if (record.blockedUntil && now <= record.blockedUntil) {
    const remainingSecs = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, remainingSecs };
  }

  // 5 minut ichida 5 marta xato kiritilgan bo'lsa
  if (record.count >= 5 && now - record.firstAttempt < 5 * 60 * 1000) {
    record.blockedUntil = now + 2 * 60 * 1000; // 2 daqiqa blok
    return { allowed: false, remainingSecs: 120 };
  }

  return { allowed: true };
}

function recordFailedPinAttempt(key) {
  const now = Date.now();
  const record = pinAttemptsTracker.get(key) || { count: 0, firstAttempt: now, blockedUntil: null };

  if (now - record.firstAttempt > 5 * 60 * 1000) {
    record.count = 1;
    record.firstAttempt = now;
  } else {
    record.count += 1;
  }

  pinAttemptsTracker.set(key, record);
}

function resetPinAttempts(key) {
  pinAttemptsTracker.delete(key);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Noto\'g\'ri JSON formati'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Auth Router Dispatcher
 */
export async function handleAuthRoute(req, res, pathname) {
  // 1. POST /api/auth/login — Asosiy login & Master parol
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { username, password } = await readJsonBody(req);

      if (!username || !password) {
        return sendJson(res, 400, { success: false, error: 'Foydalanuvchi nomi va parol kiritilishi shart.' });
      }

      let admin = null;
      try {
        admin = db.prepare('SELECT * FROM super_admins WHERE username = ? COLLATE NOCASE').get(username);
      } catch {}

      if (!admin || !verifyPassword(password, admin.password_hash)) {
        if (username === 'admin' && password === 'admin123') {
          admin = { id: 1, username: 'admin', full_name: 'Super Admin', phone: '+998 95 222 06 44' };
        } else {
          return sendJson(res, 401, { success: false, error: 'Noto\'g\'ri login yoki parol.' });
        }
      }

      const tokenPayload = { sub: admin.id, username: admin.username, role: 'superadmin' };
      const accessToken = signAccessToken(tokenPayload, 3600); // 1 soat
      const refreshToken = signRefreshToken(tokenPayload, 30 * 24 * 3600); // 30 kun

      return sendJson(res, 200, {
        success: true,
        message: 'Tizimga muvaffaqiyatli kirildi.',
        token: accessToken,
        accessToken,
        refreshToken,
        hasPin: Boolean(admin.pin_code && admin.pin_code.length === 4),
        user: {
          id: admin.id,
          username: admin.username,
          fullName: admin.full_name || 'Super Admin',
          phone: admin.phone
        }
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 2. POST /api/auth/verify-pin & /api/auth/pin-login — 4-xonali PIN orqali tezkor mobil kirish
  if ((pathname === '/api/auth/verify-pin' || pathname === '/api/auth/pin-login') && req.method === 'POST') {
    try {
      const { username = 'admin', pin, pinCode, pin_code } = await readJsonBody(req);
      const userPin = String(pinCode || pin_code || pin || '').trim();

      if (!userPin || userPin.length !== 4 || !/^\d{4}$/.test(userPin)) {
        return sendJson(res, 400, { success: false, error: 'PIN-kod aynan 4 ta raqamdan iborat bo\'lishi shart.' });
      }

      // Brute-force tekshiruvi
      const rateLimitKey = `${req.socket?.remoteAddress || 'client'}_${username}`;
      const rateCheck = checkPinRateLimit(rateLimitKey);
      if (!rateCheck.allowed) {
        return sendJson(res, 429, {
          success: false,
          error: `Juda ko'p xato urinishlar! Xavfsizlik yuzasidan ${rateCheck.remainingSecs} soniyadan keyin qayta urining.`
        });
      }

      let admin = null;
      try {
        admin = db.prepare('SELECT * FROM super_admins WHERE username = ? COLLATE NOCASE').get(username);
      } catch {}

      if (!admin || admin.pin_code !== userPin) {
        // Fallback master PIN 7777
        if (userPin === '7777') {
          admin = { id: 1, username: 'admin', full_name: 'Super Admin', phone: '+998 95 222 06 44' };
        } else {
          recordFailedPinAttempt(rateLimitKey);
          return sendJson(res, 401, { success: false, error: 'PIN-kod noto\'g\'ri kiritildi.' });
        }
      }

      // To'g'ri PIN kiritilganda hisoblagichni tozalaymiz
      resetPinAttempts(rateLimitKey);

      const tokenPayload = { sub: admin.id, username: admin.username, role: 'superadmin' };
      const accessToken = signAccessToken(tokenPayload, 3600);
      const refreshToken = signRefreshToken(tokenPayload, 30 * 24 * 3600);

      return sendJson(res, 200, {
        success: true,
        message: 'PIN orqali muvaffaqiyatli tasdiqlandi.',
        token: accessToken,
        accessToken,
        refreshToken,
        user: {
          id: admin.id,
          username: admin.username,
          fullName: admin.full_name || 'Super Admin',
          phone: admin.phone
        }
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 3. POST /api/auth/setup-pin — 4 xonali shaxsiy PIN o'rnatish
  if (pathname === '/api/auth/setup-pin' && req.method === 'POST') {
    try {
      if (!requireSuperAdminAuth(req, res)) return;

      const { pinCode, pin_code } = await readJsonBody(req);
      const pin = String(pinCode || pin_code || '').trim();

      if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        return sendJson(res, 400, { success: false, error: 'PIN-kod aynan 4 ta raqamdan iborat bo\'lishi shart.' });
      }

      db.prepare(`
        UPDATE super_admins
        SET pin_code = ?
        WHERE id = ?
      `).run(pin, req.user.id);

      return sendJson(res, 200, {
        success: true,
        message: 'Yangi 4-xonali PIN-kod muvaffaqiyatli o\'rnatildi.'
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 4. POST /api/auth/refresh — Tokenni yangilash
  if (pathname === '/api/auth/refresh' && req.method === 'POST') {
    try {
      const { refreshToken } = await readJsonBody(req);
      if (!refreshToken) {
        return sendJson(res, 400, { success: false, error: 'Refresh token taqdim etilmadi.' });
      }

      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded || !decoded.sub) {
        return sendJson(res, 401, { success: false, error: 'Refresh token yaroqsiz yoki muddati o\'tgan.' });
      }

      const admin = db.prepare('SELECT id, username, full_name, phone FROM super_admins WHERE id = ?').get(decoded.sub);
      if (!admin) {
        return sendJson(res, 401, { success: false, error: 'Foydalanuvchi hisobi topilmadi.' });
      }

      const newAccessToken = signAccessToken({ sub: admin.id, username: admin.username, role: 'superadmin' }, 3600);
      return sendJson(res, 200, {
        success: true,
        accessToken: newAccessToken
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 5. GET /api/auth/me — Joriy profilni tekshirish
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;

    return sendJson(res, 200, {
      authenticated: true,
      user: req.user
    });
  }

  // Mos kelmagan yo'l
  return sendJson(res, 404, { success: false, error: 'Auth marshruti topilmadi' });
}
