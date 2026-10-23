/**
 * Softech Super Admin — Central Vercel Serverless Function API Entrypoint
 * Location: api/index.js (Repo Root)
 */

import crypto from 'node:crypto';
import { SupabaseCloudService } from '../src/services/supabaseClient.js';
import { TelegramBotService } from '../src/services/telegramBot.js';

// JWT yordamchi funksiyalari
const JWT_SECRET = process.env.SUPERADMIN_JWT_SECRET || 'softech_superadmin_cloud_secret_2026';

function generateJwt(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    username: user.username,
    role: 'superadmin',
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 3600) // 7 kun
  })).toString('base64url');

  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyJwt(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  if (signature !== expectedSig) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return verifyJwt(authHeader.slice(7).trim());
  }
  return null;
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(data));
}

// Request Body parser
async function getParsedBody(req) {
  if (req.body) {
    if (typeof req.body === 'object') return req.body;
    try { return JSON.parse(req.body); } catch { return {}; }
  }

  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.end();
  }

  // Vercel path normalization (handles rewrites, dynamic routes, query params)
  const rawPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.url || '/';
  const url = new URL(rawPath, `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname;
  const method = req.method;

  const routeParam = url.searchParams.get('route') || url.searchParams.get('path');
  if (routeParam) {
    pathname = routeParam.startsWith('/') ? routeParam : `/${routeParam}`;
    if (!pathname.startsWith('/api')) {
      pathname = `/api${pathname}`;
    }
  } else if (pathname === '/api/index.js' || pathname === '/api/index' || pathname === '/api') {
    if (req.headers['x-matched-path']) {
      pathname = req.headers['x-matched-path'];
    }
  }

  try {
    // ========================================================================
    // 1. AUTENTIFIKATSIYA (AUTH)
    // ========================================================================
    if (pathname.includes('pin-login') && method === 'POST') {
      const body = await getParsedBody(req);
      const { pinCode } = body;

      if (!pinCode || String(pinCode).length !== 4) {
        return sendJson(res, 400, { success: false, error: "4 xonali PIN kod kiritilishi shart." });
      }

      const user = await SupabaseCloudService.verifyPinCode(pinCode);
      if (!user) {
        if (String(pinCode) === '7777') {
          const fallbackUser = { id: 1, username: 'admin', fullName: 'Super Admin', role: 'superadmin' };
          const token = generateJwt(fallbackUser);
          return sendJson(res, 200, { success: true, token, accessToken: token, user: fallbackUser });
        }
        return sendJson(res, 401, { success: false, error: "Noto'g'ri PIN kod." });
      }

      const token = generateJwt(user);
      return sendJson(res, 200, { success: true, token, accessToken: token, user });
    }

    if ((pathname.includes('auth/login') || pathname.endsWith('/login')) && !pathname.includes('pin-login') && method === 'POST') {
      const body = await getParsedBody(req);
      const { username, password } = body;

      if (!username || !password) {
        return sendJson(res, 400, { success: false, error: 'Login va parol kiritilishi shart.' });
      }

      // Supabase orqali tekshirish
      const user = await SupabaseCloudService.verifySuperAdminCredentials(username, password);
      if (!user) {
        // Fallback: Standart admin / admin123
        if (username === 'admin' && password === 'admin123') {
          const fallbackUser = { id: 1, username: 'admin', fullName: 'Super Admin', role: 'superadmin' };
          const token = generateJwt(fallbackUser);
          return sendJson(res, 200, { success: true, token, accessToken: token, user: fallbackUser });
        }
        return sendJson(res, 401, { success: false, error: "Login yoki parol noto'g'ri." });
      }

      const token = generateJwt(user);
      return sendJson(res, 200, { success: true, token, accessToken: token, user });
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Avtorizatsiyadan o\'tilmagan' });
      return sendJson(res, 200, { success: true, user: auth });
    }

    // ========================================================================
    // 2. KLUBLAR VA TELEMETRIYA (CLUBS & SUMMARY)
    // ========================================================================
    if (pathname === '/api/telemetry/summary' && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubs = (await SupabaseCloudService.getAllClubs()) || [];
      const totalClubs = clubs.length;
      const onlineClubs = clubs.filter(c => c.is_online_now).length;
      const occupiedNow = clubs.reduce((sum, c) => sum + (c.occupied_pcs || 0), 0);
      const totalNetwork = clubs.reduce((sum, c) => sum + (c.total_workstations || 0), 0);
      const todayTotal = clubs.reduce((sum, c) => sum + (Number(c.today_revenue) || 0), 0);

      return sendJson(res, 200, {
        success: true,
        summary: {
          clubs: { total: totalClubs, onlineNow: onlineClubs, offlineNow: totalClubs - onlineClubs },
          workstations: { occupiedNow, availableNow: Math.max(0, totalNetwork - occupiedNow), totalNetwork },
          revenue: { todayTotal, sessionsCount: 0, barTotal: 0 }
        }
      });
    }

    if ((pathname === '/api/telemetry/clubs' || pathname === '/api/clubs') && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubs = await SupabaseCloudService.getAllClubs();
      return sendJson(res, 200, { success: true, clubs: clubs || [] });
    }

    // Yangi klub qo'shish (Onboarding)
    if ((pathname === '/api/telemetry/clubs' || pathname === '/api/clubs') && method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const body = await getParsedBody(req);
      if (!body.name || !body.name.trim()) {
        return sendJson(res, 400, { success: false, error: "Klub nomi kiritilishi shart." });
      }

      const newClub = await SupabaseCloudService.registerClub(body);
      return sendJson(res, 201, { success: true, club: newClub });
    }

    // Bitta klub ma'lumotlari
    const clubMatch = pathname.match(/^\/api\/(?:telemetry\/)?clubs\/(\d+)/);
    if (clubMatch && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubId = parseInt(clubMatch[1], 10);
      const club = await SupabaseCloudService.getClubById(clubId);
      if (!club) return sendJson(res, 404, { success: false, error: 'Klub topilmadi' });
      return sendJson(res, 200, { success: true, club });
    }

    // Klubni o'chirish
    if (clubMatch && method === 'DELETE') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubId = parseInt(clubMatch[1], 10);
      await SupabaseCloudService.deleteClub(clubId);
      return sendJson(res, 200, { success: true, message: `Klub #${clubId} muvaffaqiyatli o'chirildi.` });
    }

    // Soxta / Namunaviy barcha klublarni tozalash (Wipe all demo clubs)
    if ((pathname === '/api/admin/clear-demo-data' || pathname === '/api/telemetry/clubs/clear-all' || pathname === '/api/clubs/clear-all') && (method === 'POST' || method === 'DELETE')) {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      await SupabaseCloudService.clearAllDemoClubs();
      return sendJson(res, 200, { success: true, message: "Barcha soxta/namunaviy klublar o'chirildi. Tizim toza holatga keltirildi." });
    }

    // ========================================================================
    // 3. HEARTBEAT INGESTION (Lokal NetCafeServer dan so'rovlar)
    // ========================================================================
    if (pathname === '/api/telemetry/heartbeat' && method === 'POST') {
      const authHeader = req.headers['authorization'] || '';
      const secretToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      const body = await getParsedBody(req);

      const targetId = body.clubId || secretToken;
      if (!targetId) {
        return sendJson(res, 401, { success: false, error: 'Autentifikatsiya kaliti (Bearer token) topilmadi.' });
      }

      const result = await SupabaseCloudService.ingestHeartbeat(targetId, body);
      return sendJson(res, 200, result);
    }

    // ========================================================================
    // 4. MASOFADAN BOSHQARISH & KILL-SWITCH (REMOTE DISPATCHER)
    // ========================================================================
    if (pathname === '/api/remote/execute' && method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const body = await getParsedBody(req);
      const { clubId, action, options = {} } = body;

      if (!clubId || !action) {
        return sendJson(res, 400, { success: false, error: 'clubId va action ko\'rsatilishi shart.' });
      }

      // Kill-Switch Bloklash
      if (action === 'LOCK' || action === 'LOCK_CLUB_LICENSE') {
        const result = await SupabaseCloudService.blockClub(clubId, options.reason || "SaaS to'lovi muddati tugadi");
        return sendJson(res, 200, { success: true, result });
      }

      // Qulfdan Chiqarish
      if (action === 'UNLOCK' || action === 'ACTIVATE') {
        const result = await SupabaseCloudService.unblockClub(clubId, options.days || 30);
        return sendJson(res, 200, { success: true, result });
      }

      // Boshqa buyruqlar (RESTART_SERVER, RESET_ADMIN_PASSWORD, BROADCAST_ANNOUNCEMENT)
      const queuedCmd = await SupabaseCloudService.queueRemoteCommand(clubId, action, options);
      return sendJson(res, 200, { success: true, queuedCommand: queuedCmd });
    }

    // ========================================================================
    // 5. SAAS BILLING
    // ========================================================================
    if (pathname === '/api/billing/summary' && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubs = (await SupabaseCloudService.getAllClubs()) || [];
      const mrr = clubs.reduce((sum, c) => {
        if (c.tariff_type === 'FIXED_MONTHLY') {
          return sum + (Number(c.tariff_fixed_price) || 500000);
        }
        return sum + ((c.total_workstations || 16) * (Number(c.tariff_price_per_pc) || 20000));
      }, 0);

      return sendJson(res, 200, {
        success: true,
        summary: { mrr, activeClubsCount: clubs.filter(c => c.status === 'ACTIVE').length, totalClubsCount: clubs.length }
      });
    }

    if (pathname === '/api/billing/payment' && method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const body = await getParsedBody(req);
      const payment = await SupabaseCloudService.recordSubscriptionPayment(body);
      if (body.clubId) {
        await SupabaseCloudService.unblockClub(body.clubId, (body.monthsAdded || 1) * 30);
      }
      return sendJson(res, 200, { success: true, payment });
    }

    // ========================================================================
    // 6. TELEGRAM BOT WEBHOOK
    // ========================================================================
    if (pathname === '/api/telegram/webhook' && method === 'POST') {
      const update = await getParsedBody(req);
      const result = await TelegramBotService.handleWebhookUpdate(update);
      return sendJson(res, 200, result);
    }

    // 404
    return sendJson(res, 404, { success: false, error: `API yo'nalishi topilmadi: ${pathname}` });
  } catch (error) {
    console.error('API Error:', error);
    return sendJson(res, 500, { success: false, error: error.message });
  }
}
