import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { initDatabase, db, getClubSettings, getZoneTariffs, deleteZoneSafely } from './db.js';
import { ClientManager } from './services/clientManager.js';
import { HeartbeatMonitor } from './services/heartbeatMonitor.js';
import { SessionScheduler } from './services/sessionScheduler.js';
import { ProtocolDispatcher } from './handlers/protocolDispatcher.js';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  getSession,
  extractToken,
  hasPermission
} from './auth.js';
import {
  calculateIntervalPrice,
  calculateTimeFromAmount,
  calculateFromDurationHours,
  getActiveRateForMoment,
  resolveZoneIdForComputer
} from './services/pricingEngine.js';
import { sendWakeOnLan } from './services/wolService.js';
import { authenticate, getTenantClubId } from './middleware/auth.js';
import { logAuditEvent, getOpenShift, getAuditTrail, formatAuditEntry } from './services/auditService.js';
import { BarLedgerService } from './services/barLedgerService.js';
import { ServerUpdater } from './services/updater.js';
import { LicenseManager } from './services/licenseManager.js';
import { HwidService } from './services/hwidService.js';
import { CloudLicenseService } from './services/cloudLicenseService.js';

export { logAuditEvent, getAuditTrail, formatAuditEntry, LicenseManager, HwidService, CloudLicenseService };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../');
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

// 1. Bazani initsializatsiya qilish
initDatabase();

// OTA Avtomatik yangilanish tizimi
ServerUpdater.startPeriodicChecks();

// Supabase Cloud Realtime Litsenziya va Kill-Switch servisi
CloudLicenseService.init();

// 2. HTTP Server va REST API
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // ==========================================================================
  // SAAS ANTI-PIRACY, HWID & LICENSE MANAGEMENT ENDPOINTS
  // ==========================================================================

  // 0. GET /api/health (Cockpit Desktop App Health-Check)
  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', app: 'NetCafeServer', uptime: process.uptime() });
    return;
  }

  // 1. GET /api/license/status (Joriy litsenziya va HWID holati)
  if (url.pathname === '/api/license/status' && req.method === 'GET') {
    const report = LicenseManager.getStatusReport();
    if (CloudLicenseService.isBlocked()) {
      report.state = 'BLOCKED';
      report.isOperational = false;
      report.lockReason = CloudLicenseService.getLockReason();
      report.lockMessage = CloudLicenseService.lockMessage;
    }
    report.cloudStatus = CloudLicenseService.getStatus();
    report.isCloudBlocked = CloudLicenseService.isBlocked();
    sendJson(res, 200, report);
    return;
  }

  // 2. POST /api/license/request-activation (Bulutdan faollashtirish so'rash)
  if (url.pathname === '/api/license/request-activation' && req.method === 'POST') {
    readBody(req, async (body) => {
      const clubName = body.clubName || 'Softech Gaming Club';
      const result = await LicenseManager.requestActivation(clubName);
      sendJson(res, 200, result);
    });
    return;
  }

  // 3. POST /api/license/activate-with-key (Super Admin kaliti bilan darhol faollashtirish)
  if (url.pathname === '/api/license/activate-with-key' && req.method === 'POST') {
    readBody(req, async (body) => {
      const { licenseKey } = body;
      const result = await LicenseManager.activateWithKey(licenseKey);
      sendJson(res, result.success ? 200 : 400, result);
    });
    return;
  }

  // ==========================================================================
  // AUTH & RBAC REST API ENDPOINTS
  // ==========================================================================

  // 1. POST /api/auth/login (Multi-Tenant & SaaS Login)
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    readBody(req, (body) => {
      const { username, password } = body;
      if (!username || !password) {
        sendJson(res, 400, { error: 'Username va parol kiritilishi shart.' });
        return;
      }

      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user) {
        sendJson(res, 401, { error: 'Noto\'g\'ri login yoki parol.' });
        return;
      }

      const isValid = verifyPassword(password, user.password_hash);
      if (!isValid) {
        sendJson(res, 401, { error: 'Noto\'g\'ri login yoki parol.' });
        return;
      }

      // Agar user klubga tegishli bo'lsa (SuperAdmin emas), klub ma'lumotlarini o'qiymiz
      let club = null;
      if (user.club_id) {
        club = db.prepare('SELECT id, name, owner_name, phone, subscription_tier, max_computers, price_per_pc_monthly, is_active, expires_at FROM clubs WHERE id = ?').get(user.club_id);
      }

      const { token, sessionData } = createSessionToken(user, club);

      sendJson(res, 200, {
        success: true,
        token,
        role: sessionData.role,
        club_id: sessionData.clubId,
        club_name: sessionData.clubName,
        permissions: sessionData.permissions,
        user: {
          id: sessionData.userId,
          clubId: sessionData.clubId,
          clubName: sessionData.clubName,
          username: sessionData.username,
          role: sessionData.role,
          phoneNumber: sessionData.phoneNumber,
          balance: sessionData.balance,
          permissions: sessionData.permissions,
        },
        club: club ? {
          id: club.id,
          name: club.name,
          ownerName: club.owner_name,
          subscriptionTier: club.subscription_tier,
          maxComputers: club.max_computers,
          isActive: Boolean(club.is_active),
          expiresAt: club.expires_at,
          isExpired: !club.is_active || new Date(club.expires_at).getTime() < Date.now()
        } : null
      });
    });
    return;
  }

  // 2. GET /api/auth/me — Joriy profil va klub holati
  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;

    sendJson(res, 200, {
      authenticated: true,
      user: {
        id: req.user.id,
        clubId: req.user.clubId,
        clubName: req.user.club?.name || null,
        username: req.user.username,
        role: req.user.role,
        phoneNumber: req.user.phoneNumber,
        balance: req.user.balance,
        permissions: req.user.permissions,
      },
      club: req.user.club ? {
        id: req.user.club.id,
        name: req.user.club.name,
        ownerName: req.user.club.owner_name,
        phone: req.user.club.phone,
        subscriptionTier: req.user.club.subscription_tier,
        maxComputers: req.user.club.max_computers,
        pricePerPcMonthly: req.user.club.price_per_pc_monthly,
        isActive: Boolean(req.user.club.is_active),
        expiresAt: req.user.club.expires_at,
        isExpired: !req.user.club.is_active || new Date(req.user.club.expires_at).getTime() < Date.now()
      } : null
    });
    return;
  }

  // 2b. GET /api/saas/stats (Faqat Super Admin uchun: barcha klublar soni, jami kompyuterlar, umumiy oylik tushum)
  if (url.pathname === '/api/saas/stats' && req.method === 'GET') {
    if (!authenticate(req, res, { roles: ['superadmin'] })) return;

    try {
      const clubsCountRow = db.prepare('SELECT COUNT(*) as count FROM clubs').get();
      const activeClubsRow = db.prepare("SELECT COUNT(*) as count FROM clubs WHERE is_active = 1 AND datetime(expires_at) > datetime('now')").get();
      
      const totalComputersRow = db.prepare('SELECT COUNT(*) as count FROM computers').get();
      const activeSessionsRow = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'ACTIVE'").get();

      // SaaS obuna hisob-kitobi: har bir klubning max_computers * price_per_pc_monthly
      const subscriptionRevRow = db.prepare(`
        SELECT COALESCE(SUM(max_computers * price_per_pc_monthly), 0) as monthly_revenue
        FROM clubs
        WHERE is_active = 1
      `).get();

      // Barcha klublar ro'yxati
      const allClubs = db.prepare(`
        SELECT 
          c.*,
          (SELECT COUNT(*) FROM computers WHERE club_id = c.id) as actual_computers,
          (SELECT COUNT(*) FROM sessions WHERE club_id = c.id AND status = 'ACTIVE') as active_sessions,
          (SELECT COUNT(*) FROM users WHERE club_id = c.id) as total_users
        FROM clubs c
        ORDER BY c.id ASC
      `).all();

      const formattedClubs = allClubs.map(c => ({
        id: c.id,
        name: c.name,
        ownerName: c.owner_name,
        phone: c.phone,
        subscriptionTier: c.subscription_tier,
        maxComputers: c.max_computers,
        actualComputers: c.actual_computers,
        activeSessions: c.active_sessions,
        totalUsers: c.total_users,
        pricePerPcMonthly: c.price_per_pc_monthly,
        monthlyTotalRevenue: c.max_computers * c.price_per_pc_monthly,
        isActive: Boolean(c.is_active),
        expiresAt: c.expires_at,
        isExpired: !c.is_active || new Date(c.expires_at).getTime() < Date.now(),
        createdAt: c.created_at
      }));

      sendJson(res, 200, {
        success: true,
        stats: {
          totalClubs: Number(clubsCountRow.count || 0),
          activeClubs: Number(activeClubsRow.count || 0),
          totalComputers: Number(totalComputersRow.count || 0),
          activeSessions: Number(activeSessionsRow.count || 0),
          monthlyEstimatedRevenue: Number(subscriptionRevRow.monthly_revenue || 0),
        },
        clubs: formattedClubs
      });
    } catch (err) {
      sendJson(res, 500, { error: 'SaaS statistikani olishda xatolik: ' + err.message });
    }
    return;
  }

  // 3. GET /api/admin/users — Xodimlar va foydalanuvchilar ro'yxati (SuperAdmin yoki Club Owner/Admin)
  if (url.pathname === '/api/admin/users' && req.method === 'GET') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;

    const clubId = getTenantClubId(req);
    let users;
    if (clubId === null) {
      users = db.prepare('SELECT id, club_id, username, role, phone_number, balance, permissions, created_at FROM users ORDER BY id ASC').all();
    } else {
      users = db.prepare('SELECT id, club_id, username, role, phone_number, balance, permissions, created_at FROM users WHERE club_id = ? ORDER BY id ASC').all(clubId);
    }

    const formatted = users.map((u) => {
      let perms = [];
      try {
        perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions;
      } catch {
        perms = [];
      }
      return {
        id: u.id,
        clubId: u.club_id,
        username: u.username,
        role: u.role,
        phoneNumber: u.phone_number || null,
        balance: Number(u.balance || 0),
        permissions: perms,
        createdAt: u.created_at,
      };
    });

    sendJson(res, 200, formatted);
    return;
  }

  // 4. POST /api/admin/users — Yangi xodim yoki mijoz qo'shish (SuperAdmin yoki Club Owner)
  if (url.pathname === '/api/admin/users' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'] })) return;

    readBody(req, (body) => {
      const { username, password, role = 'administrator', phoneNumber = null, balance = 0.0, permissions, targetClubId } = body;

      if (!username || !password) {
        sendJson(res, 400, { error: 'Username va parol kiritilishi shart.' });
        return;
      }

      const allowedRoles = ['superadmin', 'club_owner', 'administrator', 'client'];
      if (!allowedRoles.includes(role)) {
        sendJson(res, 400, { error: 'Noto\'g\'ri rol (club_owner, administrator yoki client bo\'lishi shart).' });
        return;
      }

      if (role === 'superadmin' && req.user.role !== 'superadmin') {
        sendJson(res, 403, { error: 'Super Admin hisobini faqat mavjud Super Admin yarata oladi.' });
        return;
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        sendJson(res, 400, { error: 'Bunday username bilan foydalanuvchi allaqachon mavjud.' });
        return;
      }

      // Club ID aniqlash
      let effectiveClubId = req.user.clubId;
      if (req.user.role === 'superadmin') {
        effectiveClubId = role === 'superadmin' ? null : (targetClubId || 1);
      }

      // Default ruxsatlar
      let permsArray = permissions;
      if (!Array.isArray(permsArray)) {
        permsArray = (role === 'superadmin' || role === 'club_owner') ? ['*'] : (
          role === 'client' ? ['bookings:create', 'profile:view'] : [
            'session:manage',  // Seans ochish/yopish/vaqt qo'shish
            'message:send',    // Ekranga xabar yuborish
            'customers:view',  // Mijozlarni ko'rish
          ]
        );
      }

      const pwdHash = hashPassword(password);
      const result = db.prepare(`
        INSERT INTO users (club_id, username, password_hash, role, phone_number, balance, permissions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(effectiveClubId, username, pwdHash, role, phoneNumber, balance, JSON.stringify(permsArray));

      const newId = Number(result.lastInsertRowid);
      sendJson(res, 201, {
        success: true,
        user: {
          id: newId,
          clubId: effectiveClubId,
          username,
          role,
          phoneNumber,
          balance: Number(balance || 0),
          permissions: permsArray,
        },
      });
    });
    return;
  }

  // 5. PUT /api/admin/users/:id/permissions — Ruxsatlarni yangilash
  if (url.pathname.startsWith('/api/admin/users/') && url.pathname.endsWith('/permissions') && req.method === 'PUT') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'] })) return;

    const segments = url.pathname.split('/');
    const targetUserId = parseInt(segments[4], 10);

    if (!targetUserId) {
      sendJson(res, 400, { error: 'Noto\'g\'ri foydalanuvchi ID.' });
      return;
    }

    readBody(req, (body) => {
      const { permissions } = body;
      if (!Array.isArray(permissions)) {
        sendJson(res, 400, { error: 'Permissions massiv bo\'lishi kerak.' });
        return;
      }

      db.prepare(`
        UPDATE users 
        SET permissions = ? 
        WHERE id = ?
      `).run(JSON.stringify(permissions), targetUserId);

      sendJson(res, 200, { success: true, userId: targetUserId, permissions });
    });
    return;
  }

  // 5b. DELETE /api/admin/users/:id — Xodimni o'chirish
  if (url.pathname.startsWith('/api/admin/users/') && !url.pathname.endsWith('/permissions') && req.method === 'DELETE') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'] })) return;

    const segments = url.pathname.split('/');
    const targetUserId = parseInt(segments[4], 10);

    if (targetUserId === req.user.id) {
      sendJson(res, 400, { error: 'O\'z hisobingizni o\'chirib bo\'lmaydi.' });
      return;
    }

    try {
      const user = req.user.role === 'superadmin'
        ? db.prepare('SELECT id, club_id, username, role FROM users WHERE id = ?').get(targetUserId)
        : db.prepare('SELECT id, club_id, username, role FROM users WHERE id = ? AND club_id = ?').get(targetUserId, req.user.clubId);

      if (!user) {
        sendJson(res, 404, { error: 'Foydalanuvchi topilmadi.' });
        return;
      }

      // Foreign key cheklovlarini buzmaslik uchun bog'liq yozuvlarni xavfsiz ajratish
      db.prepare('UPDATE transactions SET created_by = NULL WHERE created_by = ? OR created_by = ?').run(String(targetUserId), user.username);
      db.prepare('UPDATE sessions SET user_id = NULL WHERE user_id = ?').run(targetUserId);

      if (req.user.role === 'superadmin') {
        db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
      } else {
        db.prepare('DELETE FROM users WHERE id = ? AND club_id = ?').run(targetUserId, req.user.clubId);
      }
      sendJson(res, 200, { success: true, deletedId: targetUserId });
    } catch (err) {
      console.error('Foydalanuvchini o\'chirishda xatolik:', err);
      sendJson(res, 400, { error: 'O\'chirishda xatolik: ' + err.message });
    }
    return;
  }

  // 6. POST /api/admin/computers & /api/computers — Yangi kompyuter qo'shish (Max PC obuna cheklovi tekshiruvi bilan)
  if ((url.pathname === '/api/admin/computers' || url.pathname === '/api/computers') && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'layout:manage' })) return;

    readBody(req, (body) => {
      let { pcNumber, name, ipAddress, macAddress, zone, targetClubId, x, y, zoneId } = body;
      const effectiveClubId = req.user.role === 'superadmin' ? (targetClubId || 1) : req.user.clubId;

      // Obunadagi max_computers cheklovini tekshirish
      const club = db.prepare('SELECT max_computers FROM clubs WHERE id = ?').get(effectiveClubId);
      const currentPcCount = db.prepare('SELECT COUNT(*) as count FROM computers WHERE club_id = ? AND pc_number > 0').get(effectiveClubId);

      if (club && currentPcCount && currentPcCount.count >= club.max_computers) {
        sendJson(res, 400, {
          error: `Obuna limiti tugadi! Sizning tarifingizda maksimal ${club.max_computers} ta kompyuter ruxsat etilgan. Limitni oshirish uchun tarifni yangilang.`,
          code: 'MAX_COMPUTERS_EXCEEDED',
          maxComputers: club.max_computers,
          currentCount: currentPcCount.count
        });
        return;
      }

      if (!pcNumber && name) {
        const match = String(name).match(/(\d+)$/);
        if (match) pcNumber = parseInt(match[1], 10);
      }
      if (!pcNumber) {
        const maxPc = db.prepare('SELECT MAX(pc_number) as maxNum FROM computers WHERE club_id = ? AND pc_number > 0').get(effectiveClubId);
        pcNumber = (maxPc?.maxNum || 0) + 1;
      }
      pcNumber = parseInt(pcNumber, 10);
      name = name || `PC-${String(pcNumber).padStart(2, '0')}`;
      ipAddress = ipAddress || `192.168.1.${100 + pcNumber}`;
      const validZone = ['STANDARD', 'VIP', 'PLAYSTATION'].includes(zone) ? zone : 'STANDARD';
      const cleanMac = macAddress ? String(macAddress).trim().toUpperCase() : null;
      const id = `pc_${effectiveClubId}_${pcNumber}`;
      const validZoneId = (zoneId && typeof zoneId === 'number') ? zoneId : null;

      try {
        db.prepare(`
          INSERT INTO computers (id, club_id, pc_number, name, ip_address, mac_address, zone, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'LOCKED')
        `).run(id, effectiveClubId, pcNumber, name, ipAddress, cleanMac, validZone);

        const col = (pcNumber - 1) % 5;
        const row = Math.floor((pcNumber - 1) / 5);
        const posX = (x !== undefined && x !== null) ? Number(x) : (60 + col * 120);
        const posY = (y !== undefined && y !== null) ? Number(y) : (100 + row * 110);
        db.prepare(`
          INSERT OR REPLACE INTO grid_layout (club_id, computer_id, grid_x, grid_y, x, y, rotation, zone_id, is_visible)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1)
        `).run(effectiveClubId, pcNumber, col, row, posX, posY, validZoneId);

        broadcastAdminUpdate();
        sendJson(res, 201, {
          success: true,
          computer: {
            id,
            clubId: effectiveClubId,
            pcNumber,
            name,
            ipAddress,
            macAddress: cleanMac,
            zone: validZone,
            x: posX,
            y: posY,
            rotation: 0,
            zoneId: validZoneId,
            status: 'LOCKED'
          }
        });
      } catch (err) {
        sendJson(res, 400, { error: 'Kompyuter qo\'shishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 6b. PUT /api/admin/computers/:id — Kompyuter ma'lumotlarini (nom, IP, MAC, Zona) yangilash
  if (url.pathname.startsWith('/api/admin/computers/') && req.method === 'PUT') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'layout:manage' })) return;

    const segments = url.pathname.split('/');
    const targetId = segments[4];
    const clubId = getTenantClubId(req);

    readBody(req, (body) => {
      const { name, ipAddress, macAddress, zone, zoneId, zone_id } = body;
      const validZone = ['STANDARD', 'VIP', 'PLAYSTATION'].includes(zone) ? zone : 'STANDARD';
      const cleanMac = macAddress ? String(macAddress).trim().toUpperCase() : null;
      const cleanName = name !== undefined ? name : null;
      const cleanIp = ipAddress !== undefined ? ipAddress : null;
      const targetZoneId = (zoneId !== undefined ? zoneId : zone_id) ?? null;

      try {
        if (clubId === null) {
          db.prepare(`
            UPDATE computers 
            SET name = COALESCE(?, name),
                ip_address = COALESCE(?, ip_address),
                mac_address = COALESCE(?, mac_address),
                zone = ?,
                zone_id = COALESCE(?, zone_id)
            WHERE id = ?
          `).run(cleanName, cleanIp, cleanMac, validZone, targetZoneId, targetId);
        } else {
          db.prepare(`
            UPDATE computers 
            SET name = COALESCE(?, name),
                ip_address = COALESCE(?, ip_address),
                mac_address = COALESCE(?, mac_address),
                zone = ?,
                zone_id = COALESCE(?, zone_id)
            WHERE id = ? AND club_id = ?
          `).run(cleanName, cleanIp, cleanMac, validZone, targetZoneId, targetId, clubId);
        }
        broadcastAdminUpdate();
        sendJson(res, 200, {
          success: true,
          computer: { id: targetId, name: cleanName, ipAddress: cleanIp, macAddress: cleanMac, zone: validZone, zoneId: targetZoneId }
        });
      } catch (err) {
        sendJson(res, 400, { error: 'Kompyuterni yangilashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 7. DELETE /api/admin/computers/:id & /api/computers/:id — Kompyuterni o'chirish (Foreign Key xavfsiz va tranzaksiya bilan)
  if (((url.pathname.startsWith('/api/admin/computers/') || url.pathname.startsWith('/api/computers/')) && !url.pathname.includes('/power')) && req.method === 'DELETE') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'layout:manage' })) return;

    const segments = url.pathname.split('/');
    const targetParam = decodeURIComponent(segments.pop());
    const clubId = getTenantClubId(req);

    try {
      let pc = clubId === null 
        ? db.prepare('SELECT id, pc_number, club_id, name FROM computers WHERE id = ? OR pc_number = ?').get(targetParam, targetParam)
        : db.prepare('SELECT id, pc_number, club_id, name FROM computers WHERE (id = ? OR pc_number = ?) AND club_id = ?').get(targetParam, targetParam, clubId);

      if (!pc) {
        // Agar ID 'pc_new_...' yoki 'pc_1_2' bo'lsa, uning oxiridagi raqam orqali ham izlab ko'ramiz
        const match = targetParam.match(/(\d+)$/);
        if (match) {
          const trailingNum = parseInt(match[1], 10);
          pc = clubId === null
            ? db.prepare('SELECT id, pc_number, club_id, name FROM computers WHERE pc_number = ?').get(trailingNum)
            : db.prepare('SELECT id, pc_number, club_id, name FROM computers WHERE pc_number = ? AND club_id = ?').get(trailingNum, clubId);
        }
      }

      if (!pc) {
        if (targetParam.startsWith('pc_new_')) {
          sendJson(res, 200, { success: true, deletedId: targetParam, message: 'Qoralama stol o\'chirildi.' });
          return;
        }
        sendJson(res, 404, { error: 'Kompyuter topilmadi.' });
        return;
      }

      // 1. Faol seans tekshiruvi: Agar kompyuterda ayni paytda o'yin sessiyasi ketayotgan bo'lsa, o'chirish taqiqlanadi
      const activeSession = db.prepare(`
        SELECT id FROM sessions 
        WHERE computer_id = ? AND status = 'ACTIVE'
      `).get(pc.id);

      if (activeSession) {
        sendJson(res, 400, { 
          error: `"${pc.name}" kompyuterida ayni paytda faol seans ketmoqda! Avval kassadan seansni to'xtating yoki yakunlang.` 
        });
        return;
      }

      // 2. Tranzaksiya ichida xavfsiz tozalash va o'chirish (Foreign Key yaxlitligi va kassa hisobotlarini saqlash)
      db.exec('BEGIN TRANSACTION;');
      try {
        const archiveId = `archived_${pc.club_id}`;
        const existingArchive = db.prepare('SELECT id FROM computers WHERE id = ?').get(archiveId);
        if (!existingArchive) {
          db.prepare(`
            INSERT OR IGNORE INTO computers (id, club_id, pc_number, name, ip_address, status, zone)
            VALUES (?, ?, 0, '[Arxiv PC]', '127.0.0.1', 'OFFLINE', 'STANDARD')
          `).run(archiveId, pc.club_id);
        }

        // O'tmishdagi sessiyalarni [Arxiv PC] ga o'tkazish (moliyaviy hisobot va kassa jurnali 100% to'liq saqlanadi)
        db.prepare(`
          UPDATE sessions 
          SET computer_id = ? 
          WHERE computer_id = ?
        `).run(archiveId, pc.id);

        // 3. Bronlar (Bookings) jadvalidagi bog'liqlikni yangilash
        db.prepare(`
          UPDATE bookings 
          SET computer_id = 0 
          WHERE computer_id = ? AND club_id = ?
        `).run(pc.pc_number, pc.club_id);

        // 4. Xarita sxemasidan (grid_layout) o'chirish
        db.prepare('DELETE FROM grid_layout WHERE computer_id = ? AND club_id = ?').run(pc.pc_number, pc.club_id);

        // 5. Kompyuterni computers jadvalidan butunlay o'chirish
        db.prepare('DELETE FROM computers WHERE id = ?').run(pc.id);

        db.exec('COMMIT;');
      } catch (txErr) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw txErr;
      }

      broadcastAdminUpdate();
      sendJson(res, 200, { success: true, deletedId: pc.id, name: pc.name });
    } catch (err) {
      console.error('Kompyuterni o\'chirishda xatolik:', err);
      sendJson(res, 400, { error: 'O\'chirishda xatolik: ' + err.message });
    }
    return;
  }

  // 8. GET /api/layout — 2D Xarita (Floor Plan) va Kompyuterlar koordinatalari
  if ((url.pathname === '/api/layout' || url.pathname === '/api/admin/layout') && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req) || 1;

    const zones = db.prepare('SELECT id, club_id, name, zone_type, x, y, width, height, color, polygon_points FROM zones WHERE club_id = ? ORDER BY id ASC').all(clubId);
    const layoutRows = db.prepare(`
      SELECT g.computer_id, g.grid_x, g.grid_y, g.x, g.y, g.rotation, g.zone_id, g.is_visible,
             c.name as computer_name, c.status, c.zone
      FROM grid_layout g
      LEFT JOIN computers c ON c.pc_number = g.computer_id AND c.club_id = g.club_id
      WHERE g.club_id = ? AND g.computer_id > 0
      ORDER BY g.computer_id ASC
    `).all(clubId);

    const computers = layoutRows.map((r) => ({
      computerId: r.computer_id,
      name: r.computer_name || `PC-${String(r.computer_id).padStart(2, '0')}`,
      status: r.status || 'AVAILABLE',
      zone: r.zone || 'STANDARD',
      gridX: r.grid_x ?? 0,
      gridY: r.grid_y ?? 0,
      x: (r.x !== undefined && r.x !== null && r.x > 0) ? r.x : (r.grid_x !== undefined && r.grid_x !== null ? r.grid_x * 120 + 40 : 40),
      y: (r.y !== undefined && r.y !== null && r.y > 0) ? r.y : (r.grid_y !== undefined && r.grid_y !== null ? r.grid_y * 120 + 40 : 40),
      rotation: r.rotation ?? 0,
      zoneId: r.zone_id ?? null,
      isVisible: r.is_visible ?? 1,
    }));

    sendJson(res, 200, {
      success: true,
      zones,
      computers,
      canvasWidth: 1800,
      canvasHeight: 1100
    });
    return;
  }

  // 9. POST /api/layout/save, POST /api/layout, PUT /api/admin/layout — 2D Xarita va Zonalarni to'liq saqlash
  if ((url.pathname === '/api/layout/save' || url.pathname === '/api/layout' || url.pathname === '/api/admin/layout') && (req.method === 'POST' || req.method === 'PUT')) {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'layout:manage' })) return;
    const clubId = getTenantClubId(req) || 1;

    readBody(req, (body) => {
      try {
        // A) Xonalar/Zonalarni saqlash (agar yuborilgan bo'lsa)
        const zoneIdMap = new Map();

        if (Array.isArray(body.zones)) {
          for (const z of body.zones) {
            const zName = z.name || 'Yangi Xona';
            let normZone = String(z.zoneType || z.zone_type || '').toUpperCase();
            if (normZone === 'PLAYSTATION') normZone = 'PS5';
            if (normZone === 'BOOTCAMP') normZone = 'BOOTCAMP_5V5';
            const zType = ['STANDARD', 'VIP', 'BOOTCAMP_5V5', 'PS5'].includes(normZone) ? normZone : 'STANDARD';
            const zX = parseInt(z.x, 10) || 40;
            const zY = parseInt(z.y, 10) || 40;
            const zW = Math.max(120, parseInt(z.width, 10) || 360);
            const zH = Math.max(100, parseInt(z.height, 10) || 240);
            const zColor = z.color || '#38bdf8';
            const polyPoints = z.polygon_points || z.polygonPoints 
              ? (typeof (z.polygon_points || z.polygonPoints) === 'string' ? (z.polygon_points || z.polygonPoints) : JSON.stringify(z.polygon_points || z.polygonPoints))
              : null;

            let existing = null;
            if (z.id && typeof z.id === 'number' && z.id > 0) {
              existing = db.prepare('SELECT id FROM zones WHERE id = ? AND club_id = ?').get(z.id, clubId);
            }

            if (existing) {
              db.prepare(`
                UPDATE zones 
                SET name = ?, zone_type = ?, x = ?, y = ?, width = ?, height = ?, color = ?, polygon_points = ?
                WHERE id = ? AND club_id = ?
              `).run(zName, zType, zX, zY, zW, zH, zColor, polyPoints, z.id, clubId);
              zoneIdMap.set(z.id, z.id);
            } else {
              const ins = db.prepare(`
                INSERT INTO zones (club_id, name, zone_type, x, y, width, height, color, polygon_points)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(clubId, zName, zType, zX, zY, zW, zH, zColor, polyPoints);
              const realId = Number(ins.lastInsertRowid);
              if (z.id) {
                zoneIdMap.set(z.id, realId);
              }
            }
          }
        }

        // O'chirilgan zonalarni tozalash (xavfsiz barcha bog'liqliklar bilan)
        if (Array.isArray(body.deletedZoneIds) && body.deletedZoneIds.length > 0) {
          for (const delId of body.deletedZoneIds) {
            deleteZoneSafely(delId, clubId);
          }
        }

        // B) Kompyuter stollari koordinatalarini saqlash
        const computersPayload = Array.isArray(body.computers) 
          ? body.computers 
          : (Array.isArray(body.layout) ? body.layout : (Array.isArray(body) ? body : []));

        for (const item of computersPayload) {
          // Robust pc_number extraction from number, 'pc_1_2', 'pc_new_123_2', or item.pcNumber
          let compNum = null;
          if (typeof item.pcNumber === 'number' && !isNaN(item.pcNumber) && item.pcNumber > 0) {
            compNum = item.pcNumber;
          } else if (typeof item.computerId === 'number' && !isNaN(item.computerId) && item.computerId > 0) {
            compNum = item.computerId;
          } else {
            const rawStr = String(item.pcNumber || item.computerId || item.id || '');
            const parsed = parseInt(rawStr, 10);
            if (!isNaN(parsed) && parsed > 0) {
              compNum = parsed;
            } else {
              const match = rawStr.match(/(\d+)$/);
              if (match) compNum = parseInt(match[1], 10);
            }
          }

          if (!compNum || compNum <= 0) {
            const maxRow = db.prepare('SELECT MAX(pc_number) as maxNum FROM computers WHERE club_id = ? AND pc_number > 0').get(clubId);
            compNum = (maxRow?.maxNum || 0) + 1;
          }

          const posX = item.x !== undefined ? parseInt(item.x, 10) : (item.gridX !== undefined ? item.gridX * 120 + 40 : 40);
          const posY = item.y !== undefined ? parseInt(item.y, 10) : (item.gridY !== undefined ? item.gridY * 120 + 40 : 40);
          const rot = [0, 90, 180, 270].includes(parseInt(item.rotation, 10)) ? parseInt(item.rotation, 10) : 0;
          let zoneId = (item.zoneId && typeof item.zoneId === 'number') ? item.zoneId : null;
          if (zoneId && zoneIdMap.has(zoneId)) {
            zoneId = zoneIdMap.get(zoneId);
          }
          const gridX = item.gridX !== undefined ? item.gridX : Math.floor(posX / 120);
          const gridY = item.gridY !== undefined ? item.gridY : Math.floor(posY / 120);
          const isVis = item.isVisible !== undefined ? (item.isVisible ? 1 : 0) : 1;
          const rawIp = (item.ipAddress || item.ip_address || item.ip || '').trim() || null;

          // Qidiruv: id yoki pc_number orqali
          let existingPc = db.prepare('SELECT id, ip_address, pc_number, name FROM computers WHERE (id = ? OR pc_number = ?) AND club_id = ?').get(item.id || '', compNum, clubId);

          if (!existingPc) {
            const pcIdStr = (item.id && !String(item.id).startsWith('pc_new_')) ? item.id : `pc_${clubId}_${compNum}`;
            const pcType = String(item.type || '').toUpperCase();
            const pcName = item.name || (pcType === 'PS5' || pcType === 'PLAYSTATION' ? `PS-${String(compNum).padStart(2, '0')}` : `PC-${String(compNum).padStart(2, '0')}`);
            const pcZone = (pcType === 'PS5' || pcType === 'PLAYSTATION') ? 'PLAYSTATION' : 'STANDARD';
            db.prepare(`
              INSERT OR IGNORE INTO computers (id, club_id, pc_number, name, ip_address, status, zone, zone_id)
              VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)
            `).run(pcIdStr, clubId, compNum, pcName, rawIp, pcZone, zoneId);
          } else {
            db.prepare(`
              UPDATE computers 
              SET name = COALESCE(?, name),
                  ip_address = COALESCE(?, ip_address),
                  zone_id = ?
              WHERE id = ? AND club_id = ?
            `).run(item.name || null, rawIp, zoneId, existingPc.id, clubId);
          }

          db.prepare(`
            INSERT OR REPLACE INTO grid_layout (club_id, computer_id, grid_x, grid_y, x, y, rotation, zone_id, is_visible)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(clubId, compNum, gridX, gridY, posX, posY, rot, zoneId, isVis);

          if (zoneId) {
            const matchedZone = db.prepare('SELECT zone_type FROM zones WHERE id = ? AND club_id = ?').get(zoneId, clubId);
            if (matchedZone) {
              let compZone = 'STANDARD';
              if (matchedZone.zone_type === 'VIP') compZone = 'VIP';
              else if (matchedZone.zone_type === 'PS5' || matchedZone.zone_type === 'PLAYSTATION') compZone = 'PLAYSTATION';
              else if (matchedZone.zone_type === 'BOOTCAMP_5V5' || matchedZone.zone_type === 'BOOTCAMP') compZone = 'BOOTCAMP_5V5';
              db.prepare('UPDATE computers SET zone = ? WHERE pc_number = ? AND club_id = ?').run(compZone, compNum, clubId);
            }
          }
        }

        broadcastAdminUpdate();
        sendJson(res, 200, { success: true, message: 'Xarita tartibi va zonalar muvaffaqiyatli saqlandi.' });
      } catch (err) {
        sendJson(res, 400, { error: 'Xaritani saqlashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 9b. GET /api/zones — Barcha xonalar va ularning dinamik tariflari
  if (url.pathname === '/api/zones' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req) || 1;

    try {
      const zones = db.prepare(`
        SELECT id, club_id, name, zone_type, color, x, y, width, height, polygon_points, created_at
        FROM zones
        WHERE club_id = ?
        ORDER BY id ASC
      `).all(clubId);

      const now = new Date();
      const enrichedZones = zones.map(z => {
        const tariffs = db.prepare(`
          SELECT * FROM tariffs
          WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL) AND is_active = 1
          ORDER BY id ASC
        `).all(z.id, clubId);

        const currentRate = getActiveRateForMoment(now, false, clubId, z.id);
        const compCountRow = db.prepare('SELECT COUNT(*) as count FROM computers WHERE zone_id = ? AND club_id = ?').get(z.id, clubId);

        return {
          ...z,
          polygonPoints: z.polygon_points ? JSON.parse(z.polygon_points) : null,
          tariffs: tariffs.map(t => ({
            ...t,
            days_of_week: typeof t.days_of_week === 'string' ? JSON.parse(t.days_of_week) : t.days_of_week
          })),
          currentRate: currentRate.pricePerHour,
          currentRateName: currentRate.name,
          computerCount: Number(compCountRow?.count || 0)
        };
      });

      sendJson(res, 200, { success: true, zones: enrichedZones });
    } catch (err) {
      sendJson(res, 500, { error: 'Xonalarni olishda xatolik: ' + err.message });
    }
    return;
  }

  // 9c. GET /api/zones/:id/tariffs — Xonaning barcha tariflari
  const zoneTariffsMatch = url.pathname.match(/^\/api\/zones\/(\d+)\/tariffs$/);
  if (zoneTariffsMatch && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req) || 1;
    const zoneId = parseInt(zoneTariffsMatch[1], 10);

    try {
      const zone = db.prepare('SELECT id, name, zone_type, color FROM zones WHERE id = ? AND club_id = ?').get(zoneId, clubId);
      if (!zone) {
        sendJson(res, 404, { error: 'Xona topilmadi.' });
        return;
      }

      const tariffs = db.prepare(`
        SELECT * FROM tariffs
        WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL) AND is_active = 1
        ORDER BY id ASC
      `).all(zoneId, clubId);

      const formattedTariffs = tariffs.map(t => ({
        ...t,
        days_of_week: typeof t.days_of_week === 'string' ? JSON.parse(t.days_of_week) : t.days_of_week
      }));

      sendJson(res, 200, {
        success: true,
        zone,
        tariffs: formattedTariffs
      });
    } catch (err) {
      sendJson(res, 500, { error: 'Xona tariflarini olishda xatolik: ' + err.message });
    }
    return;
  }

  // 9d. POST /api/zones (va /api/layout/zones) — Yangi xona va uning barcha tariflarini bitta tranzaksiyada yaratish
  if ((url.pathname === '/api/zones' || url.pathname === '/api/layout/zones') && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'], permission: 'layout:manage' })) return;
    const clubId = getTenantClubId(req) || 1;

    readBody(req, (body) => {
      try {
        const {
          name = 'Yangi Xona',
          zoneType = 'STANDARD',
          zone_type,
          color = '#38bdf8',
          x = 40,
          y = 40,
          width = 360,
          height = 240,
          polygonPoints,
          polygon_points,
          tariffs = []
        } = body || {};

        let normZone = String(zone_type || zoneType || '').toUpperCase();
        if (normZone === 'PLAYSTATION') normZone = 'PS5';
        if (normZone === 'BOOTCAMP') normZone = 'BOOTCAMP_5V5';
        const validZoneType = ['STANDARD', 'VIP', 'BOOTCAMP_5V5', 'PS5'].includes(normZone) ? normZone : 'STANDARD';
        const polyData = polygon_points || polygonPoints;
        const polyStr = polyData ? (typeof polyData === 'string' ? polyData : JSON.stringify(polyData)) : null;

        const insertZone = db.prepare(`
          INSERT INTO zones (club_id, name, zone_type, x, y, width, height, color, polygon_points)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTariff = db.prepare(`
          INSERT INTO tariffs (id, club_id, zone_id, name, price_per_hour, start_time, end_time, days_of_week, is_vip_postpaid_allowed, type, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'HOURLY', 1)
        `);

        // Standart boshlang'ich 2 ta oraliq agar foydalanuvchi oraliqlar bermagan bo'lsa
        const intervalsToSave = Array.isArray(tariffs) && tariffs.length > 0 ? tariffs : [
          { name: 'Kunduzgi', start_time: '10:00', end_time: '18:00', price_per_hour: 12000, days_of_week: [1,2,3,4,5,6,7], is_vip_postpaid_allowed: 1 },
          { name: 'Kechki / Tun', start_time: '18:00', end_time: '10:00', price_per_hour: 18000, days_of_week: [1,2,3,4,5,6,7], is_vip_postpaid_allowed: 1 }
        ];

        let createdZoneId;
        const createdTariffs = [];

        db.exec('BEGIN TRANSACTION;');
        try {
          const resZone = insertZone.run(clubId, name, validZoneType, parseInt(x, 10) || 40, parseInt(y, 10) || 40, parseInt(width, 10) || 360, parseInt(height, 10) || 240, color, polyStr);
          createdZoneId = Number(resZone.lastInsertRowid);

          intervalsToSave.forEach((t, i) => {
            const tariffId = `trf_z${createdZoneId}_${i + 1}_${Date.now().toString(36)}`;
            const tName = t.name || `Tarif ${i + 1}`;
            const tRate = parseFloat(t.price_per_hour || t.pricePerHour || 12000);
            const tStart = t.start_time || t.startTime || '10:00';
            const tEnd = t.end_time || t.endTime || '18:00';
            const tDays = typeof t.days_of_week === 'string' ? t.days_of_week : JSON.stringify(t.days_of_week || [1,2,3,4,5,6,7]);
            const tVipAllowed = t.is_vip_postpaid_allowed !== undefined ? (t.is_vip_postpaid_allowed ? 1 : 0) : 1;

            insertTariff.run(tariffId, clubId, createdZoneId, tName, tRate, tStart, tEnd, tDays, tVipAllowed);
            createdTariffs.push({
              id: tariffId,
              club_id: clubId,
              zone_id: createdZoneId,
              name: tName,
              price_per_hour: tRate,
              start_time: tStart,
              end_time: tEnd,
              days_of_week: JSON.parse(tDays),
              is_vip_postpaid_allowed: tVipAllowed
            });
          });

          db.exec('COMMIT;');
        } catch (txErr) {
          try { db.exec('ROLLBACK;'); } catch {}
          throw txErr;
        }

        broadcastAdminUpdate();
        sendJson(res, 201, {
          success: true,
          zone: {
            id: createdZoneId,
            club_id: clubId,
            name,
            zone_type: validZoneType,
            color,
            x: parseInt(x, 10) || 40,
            y: parseInt(y, 10) || 40,
            width: parseInt(width, 10) || 360,
            height: parseInt(height, 10) || 240,
            polygon_points: polyStr
          },
          tariffs: createdTariffs
        });
      } catch (err) {
        sendJson(res, 400, { error: 'Xona va tariflarni yaratishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 9e. PUT /api/zones/:id (va /api/layout/zones/:id) — Xona ma'lumotlari va dinamik narxlarini yangilash
  const zoneUpdateMatch = url.pathname.match(/^\/api\/(?:layout\/)?zones\/(\d+)$/);
  if (zoneUpdateMatch && req.method === 'PUT') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'], permission: 'layout:manage' })) return;
    const clubId = getTenantClubId(req) || 1;
    const zoneId = parseInt(zoneUpdateMatch[1], 10);

    readBody(req, (body) => {
      try {
        const existingZone = db.prepare('SELECT * FROM zones WHERE id = ? AND club_id = ?').get(zoneId, clubId);
        if (!existingZone) {
          sendJson(res, 404, { error: 'Tahrirlanuvchi xona topilmadi.' });
          return;
        }

        const {
          name = existingZone.name,
          zoneType = existingZone.zone_type,
          zone_type,
          color = existingZone.color,
          x = existingZone.x,
          y = existingZone.y,
          width = existingZone.width,
          height = existingZone.height,
          polygonPoints = existingZone.polygon_points,
          polygon_points,
          tariffs
        } = body || {};

        let normZone = String(zone_type || zoneType || '').toUpperCase();
        if (normZone === 'PLAYSTATION') normZone = 'PS5';
        if (normZone === 'BOOTCAMP') normZone = 'BOOTCAMP_5V5';
        const validZoneType = ['STANDARD', 'VIP', 'BOOTCAMP_5V5', 'PS5'].includes(normZone) ? normZone : existingZone.zone_type;
        const polyData = polygon_points !== undefined ? polygon_points : polygonPoints;
        const polyStr = polyData ? (typeof polyData === 'string' ? polyData : JSON.stringify(polyData)) : null;

        const updatedTariffs = [];

        db.exec('BEGIN TRANSACTION;');
        try {
          db.prepare(`
            UPDATE zones 
            SET name = ?, zone_type = ?, color = ?, x = ?, y = ?, width = ?, height = ?, polygon_points = ?
            WHERE id = ? AND club_id = ?
          `).run(name, validZoneType, color, parseInt(x, 10), parseInt(y, 10), parseInt(width, 10), parseInt(height, 10), polyStr, zoneId, clubId);

          if (Array.isArray(tariffs)) {
            // Ushbu xonaning eski tariflarini tozalash va yangilarini saqlash
            db.prepare('DELETE FROM tariffs WHERE zone_id = ? AND club_id = ?').run(zoneId, clubId);

            const insertTariff = db.prepare(`
              INSERT INTO tariffs (id, club_id, zone_id, name, price_per_hour, start_time, end_time, days_of_week, is_vip_postpaid_allowed, type, is_active)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'HOURLY', 1)
            `);

            tariffs.forEach((t, i) => {
              const tariffId = `trf_z${zoneId}_${i + 1}_${Date.now().toString(36)}`;
              const tName = t.name || `Tarif ${i + 1}`;
              const tRate = parseFloat(t.price_per_hour || t.pricePerHour || 12000);
              const tStart = t.start_time || t.startTime || '10:00';
              const tEnd = t.end_time || t.endTime || '18:00';
              const tDays = typeof t.days_of_week === 'string' ? t.days_of_week : JSON.stringify(t.days_of_week || [1,2,3,4,5,6,7]);
              const tVipAllowed = t.is_vip_postpaid_allowed !== undefined ? (t.is_vip_postpaid_allowed ? 1 : 0) : 1;

              insertTariff.run(tariffId, clubId, zoneId, tName, tRate, tStart, tEnd, tDays, tVipAllowed);
              updatedTariffs.push({
                id: tariffId,
                club_id: clubId,
                zone_id: zoneId,
                name: tName,
                price_per_hour: tRate,
                start_time: tStart,
                end_time: tEnd,
                days_of_week: JSON.parse(tDays),
                is_vip_postpaid_allowed: tVipAllowed
              });
            });
          }

          db.exec('COMMIT;');
        } catch (txErr) {
          try { db.exec('ROLLBACK;'); } catch {}
          throw txErr;
        }

        broadcastAdminUpdate();
        sendJson(res, 200, {
          success: true,
          zone: { id: zoneId, club_id: clubId, name, zone_type: validZoneType, color, x, y, width, height, polygon_points: polyStr },
          tariffs: updatedTariffs
        });
      } catch (err) {
        sendJson(res, 400, { error: 'Xona va tariflarni yangilashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 9f. DELETE /api/zones/:id (va /api/layout/zones/:id) — Zonani o'chirish
  const zoneDeleteMatch = url.pathname.match(/^\/api\/(?:layout\/)?zones\/(\d+)$/);
  if (zoneDeleteMatch && req.method === 'DELETE') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'], permission: 'layout:manage' })) return;
    const clubId = getTenantClubId(req) || 1;
    const zoneId = parseInt(zoneDeleteMatch[1], 10);

    if (!zoneId) {
      sendJson(res, 400, { error: 'Noto\'g\'ri zona ID.' });
      return;
    }

    try {
      deleteZoneSafely(zoneId, clubId);

      broadcastAdminUpdate();
      sendJson(res, 200, { success: true, deletedZoneId: zoneId });
    } catch (err) {
      sendJson(res, 400, { error: 'Zonani o\'chirishda xatolik: ' + err.message });
    }
    return;
  }

  // 12. PUT /api/bookings/:id/status — Booking holatini o'zgartirish (Tasdiqlash / Bekor qilish)
  if (url.pathname.startsWith('/api/bookings/') && url.pathname.endsWith('/status') && req.method === 'PUT') {
    if (!authenticate(req, res)) return;
    const segments = url.pathname.split('/');
    const bookingId = parseInt(segments[3], 10);

    if (!bookingId) {
      sendJson(res, 400, { error: 'Noto\'g\'ri booking ID.' });
      return;
    }

    readBody(req, (body) => {
      const { status } = body;
      if (!['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'].includes(status)) {
        sendJson(res, 400, { error: 'Noto\'g\'ri status (PENDING, CONFIRMED, CANCELLED, COMPLETED).' });
        return;
      }

      if (req.user.role === 'superadmin') {
        db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, bookingId);
      } else {
        db.prepare('UPDATE bookings SET status = ? WHERE id = ? AND club_id = ?').run(status, bookingId, req.user.clubId);
      }
      broadcastAdminUpdate();
      sendJson(res, 200, { success: true, bookingId, status });
    });
    return;
  }


  // 9. PUT /api/admin/tariffs — Tariflarni yangilash
  if (url.pathname === '/api/admin/tariffs' && req.method === 'PUT') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'tariffs:manage' })) return;
    const clubId = getTenantClubId(req) || 1;

    readBody(req, (body) => {
      const { tariffs } = body;
      if (!Array.isArray(tariffs)) {
        sendJson(res, 400, { error: 'Tariffs massiv bo\'lishi kerak.' });
        return;
      }

      for (const t of tariffs) {
        db.prepare(`
          UPDATE tariffs 
          SET name = ?, price_per_hour = ?, fixed_price = ?, fixed_duration_minutes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND (club_id = ? OR ? = 1)
        `).run(t.name, t.price_per_hour || 0, t.fixed_price || 0, t.fixed_duration_minutes || 60, t.id, clubId, req.user.role === 'superadmin' ? 1 : 0);
      }

      broadcastAdminUpdate();
      sendJson(res, 200, { success: true });
    });
    return;
  }

  // 9b. POST /api/admin/tariff-schedules — Yangi dinamik tarif jadvali qo'shish
  if (url.pathname === '/api/admin/tariff-schedules' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'tariffs:manage' })) return;
    const clubId = getTenantClubId(req) || 1;

    readBody(req, (body) => {
      try {
        const name = (body.name || '').trim();
        const start_time = body.start_time || body.startTime || '10:00';
        const end_time = body.end_time || body.endTime || '17:00';
        const price_per_hour = body.price_per_hour !== undefined ? body.price_per_hour : (body.pricePerHour !== undefined ? body.pricePerHour : 10000);
        const days_of_week = body.days_of_week || body.daysOfWeek || '[1,2,3,4,5,6,7]';
        const is_vip = body.is_vip !== undefined ? body.is_vip : (body.isVip ? 1 : 0);
        const priority = body.priority !== undefined ? body.priority : 1;

        if (!name) {
          sendJson(res, 400, { error: 'Tarif nomi talab qilinadi.' });
          return;
        }

        const daysJson = typeof days_of_week === 'string' ? days_of_week : JSON.stringify(days_of_week);
        const resInsert = db.prepare(`
          INSERT INTO tariff_schedules (club_id, name, days_of_week, start_time, end_time, price_per_hour, is_vip, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(clubId, name, daysJson, start_time, end_time, parseFloat(price_per_hour), is_vip ? 1 : 0, parseInt(priority, 10) || 1);

        broadcastAdminUpdate();
        sendJson(res, 201, { success: true, id: Number(resInsert.lastInsertRowid) });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // 9c. DELETE /api/admin/tariff-schedules/:id — Dinamik tarif jadvalini o'chirish
  if (url.pathname.startsWith('/api/admin/tariff-schedules/') && req.method === 'DELETE') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'tariffs:manage' })) return;
    const schedId = parseInt(url.pathname.split('/')[4], 10);
    const clubId = getTenantClubId(req);

    if (!schedId) {
      sendJson(res, 400, { error: 'Noto\'g\'ri tarif ID.' });
      return;
    }

    try {
      if (clubId === null) {
        db.prepare('DELETE FROM tariff_schedules WHERE id = ?').run(schedId);
      } else {
        db.prepare('DELETE FROM tariff_schedules WHERE id = ? AND club_id = ?').run(schedId, clubId);
      }
      broadcastAdminUpdate();
      sendJson(res, 200, { success: true, deletedId: schedId });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // ==========================================================================
  // CLUB SETTINGS & VIP POSTPAID ENGINE REST API
  // ==========================================================================

  // GET /api/settings (yoki /api/admin/settings) - Klub sozlamalari (Tenant scoped)
  if ((url.pathname === '/api/settings' || url.pathname === '/api/admin/settings') && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req) || 1;
    const settings = getClubSettings(clubId);
    sendJson(res, 200, { success: true, settings });
    return;
  }

  // POST /api/admin/settings yoki PUT /api/admin/settings - VIP Postpaid sozlamalarini yangilash
  if ((url.pathname === '/api/admin/settings' || url.pathname === '/api/settings') && (req.method === 'POST' || req.method === 'PUT')) {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'tariffs:manage' })) return;
    const clubId = getTenantClubId(req) || 1;

    readBody(req, (body) => {
      try {
        const vip_enabled = body.vip_enabled !== undefined ? (body.vip_enabled ? 1 : 0) : 1;
        const vip_pricing_mode = body.vip_pricing_mode === 'CUSTOM' ? 'CUSTOM' : 'SCHEDULE';
        const vip_custom_price = parseFloat(body.vip_custom_price) || 15000.0;

        db.prepare(`
          INSERT INTO club_settings (club_id, vip_enabled, vip_pricing_mode, vip_custom_price, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(club_id) DO UPDATE SET
            vip_enabled = excluded.vip_enabled,
            vip_pricing_mode = excluded.vip_pricing_mode,
            vip_custom_price = excluded.vip_custom_price,
            updated_at = CURRENT_TIMESTAMP
        `).run(clubId, vip_enabled, vip_pricing_mode, vip_custom_price);

        const updated = getClubSettings(clubId);
        broadcastAdminUpdate();
        sendJson(res, 200, { success: true, settings: updated });
      } catch (err) {
        sendJson(res, 500, { error: 'Sozlamalarni saqlashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // OTA AUTO-UPDATE REST API ENDPOINTS
  // ==========================================================================

  // 1. GET /api/updates/status — Server yangilanish holati va tayyorligi
  if (url.pathname === '/api/updates/status' && req.method === 'GET') {
    sendJson(res, 200, ServerUpdater.getStatus());
    return;
  }

  // 2. POST /api/updates/check — Yangilanishlarni qo'lda darhol tekshirish
  if (url.pathname === '/api/updates/check' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    ServerUpdater.checkForUpdates()
      .then(status => sendJson(res, 200, status))
      .catch(err => sendJson(res, 500, { error: err.message }));
    return;
  }

  // 3. POST /api/updates/apply — Tayyorlangan yangilanishni qo'llash (0 active sessions yoki force)
  if (url.pathname === '/api/updates/apply' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'] })) return;
    readBody(req, async (body) => {
      const force = Boolean(body?.force);
      const result = await ServerUpdater.applyUpdate({ force });
      sendJson(res, result.success ? 200 : 400, result);
    });
    return;
  }

  // 4. GET /api/updates/version.json — Standart version.json manifestini tarqatish
  if (url.pathname === '/api/updates/version.json' && req.method === 'GET') {
    const manifestPath = path.resolve(ROOT_DIR, 'version.json');
    if (fs.existsSync(manifestPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(manifestPath, 'utf8'));
    } else {
      sendJson(res, 200, {
        version: ServerUpdater.currentVersion,
        releaseDate: new Date().toISOString().slice(0, 10),
        client: {
          url: `http://${req.headers.host}/updates/client-latest.zip`,
          sha256: null
        },
        server: {
          url: `http://${req.headers.host}/updates/server-latest.zip`,
          sha256: null
        },
        changelog: "Enterprise OTA Update System v" + ServerUpdater.currentVersion
      });
    }
    return;
  }

  // GET /api/sessions/:id/checkout-preview & /api/sessions/:id/postpaid-preview
  // Seans yakunlanishi oldidan O'yin vaqti + Bar buyurtmalarini formula ko'rinishida hisoblash
  const checkoutPreviewMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(checkout-preview|postpaid-preview)$/);
  if ((checkoutPreviewMatch || url.pathname === '/api/sessions/checkout-preview' || url.pathname === '/api/sessions/postpaid-preview') && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req) || 1;
    const target = checkoutPreviewMatch ? checkoutPreviewMatch[1] : (url.searchParams.get('id') || url.searchParams.get('computerId') || url.searchParams.get('sessionId'));

    if (!target) {
      sendJson(res, 400, { error: 'Seans yoki Kompyuter ID talab qilinadi.' });
      return;
    }

    try {
      const preview = BarLedgerService.getSessionCheckoutPreview(target, clubId);
      sendJson(res, 200, preview);
    } catch (err) {
      sendJson(res, 400, { error: 'Checkout hisob-kitobida xatolik: ' + err.message });
    }
    return;
  }

  // POST /api/sessions/:id/checkout & /api/sessions/:id/stop-postpaid
  // Seansni to'liq yopish, O'yin va Bar to'lovlarini transactions jadvaliga alohida yozish
  const checkoutMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(checkout|stop-postpaid)$/);
  if ((checkoutMatch || url.pathname === '/api/sessions/checkout' || url.pathname === '/api/sessions/stop-postpaid') && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'session:manage' })) return;
    const currentUserId = req.user.id;
    const clubId = getTenantClubId(req) || 1;

    readBody(req, (data) => {
      try {
        const target = checkoutMatch ? checkoutMatch[1] : (data.sessionId || data.computerId || data.id);
        const paymentMethod = ['CARD', 'CLICK', 'PAYME'].includes(data.paymentMethod || data.paymentType) ? 'CARD' : 'CASH';

        if (!target) {
          sendJson(res, 400, { error: 'Seans ID yoki Kompyuter ID talab qilinadi.' });
          return;
        }

        const result = BarLedgerService.executeSessionCheckout({
          target,
          paymentMethod,
          cashierUserId: currentUserId,
          clubId,
          broadcastUpdate: broadcastAdminUpdate
        });

        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: 'Seans checkout qilishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // OPERATIONAL REST API ENDPOINTS
  // ==========================================================================

  // GET /api/computers (Tenant scoped)
  if (url.pathname === '/api/computers' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);

    const computers = clubId === null ? db.prepare(`
      SELECT 
        c.id, c.club_id, c.pc_number, c.name, c.ip_address, c.mac_address, c.zone, c.status,
        COALESCE(c.zone_id, g.zone_id) as zone_id,
        s.id as session_id, s.customer_name, s.started_at, s.ends_at, s.total_amount, s.notes,
        (SELECT tx.payment_type FROM transactions tx WHERE tx.session_id = s.id ORDER BY tx.created_at ASC LIMIT 1) as payment_type,
        t.name as tariff_name,
        (SELECT COALESCE(SUM(bo.total_amount), 0) FROM bar_orders bo WHERE bo.session_id = s.id AND bo.payment_status = 'PENDING_AT_CHECKOUT') as bar_pending_amount,
        g.grid_x, g.grid_y, g.x, g.y, g.rotation, g.is_visible,
        z.name as room_name, z.color as room_color, z.zone_type as room_type
      FROM computers c
      LEFT JOIN sessions s ON c.current_session_id = s.id AND s.status = 'ACTIVE'
      LEFT JOIN tariffs t ON s.tariff_id = t.id
      LEFT JOIN grid_layout g ON c.pc_number = g.computer_id AND c.club_id = g.club_id
      LEFT JOIN zones z ON COALESCE(c.zone_id, g.zone_id) = z.id AND (z.club_id = c.club_id OR z.club_id IS NULL)
      WHERE c.pc_number > 0
      ORDER BY c.club_id ASC, c.pc_number ASC
    `).all() : db.prepare(`
      SELECT 
        c.id, c.club_id, c.pc_number, c.name, c.ip_address, c.mac_address, c.zone, c.status,
        COALESCE(c.zone_id, g.zone_id) as zone_id,
        s.id as session_id, s.customer_name, s.started_at, s.ends_at, s.total_amount, s.notes,
        (SELECT tx.payment_type FROM transactions tx WHERE tx.session_id = s.id ORDER BY tx.created_at ASC LIMIT 1) as payment_type,
        t.name as tariff_name,
        (SELECT COALESCE(SUM(bo.total_amount), 0) FROM bar_orders bo WHERE bo.session_id = s.id AND bo.payment_status = 'PENDING_AT_CHECKOUT') as bar_pending_amount,
        g.grid_x, g.grid_y, g.x, g.y, g.rotation, g.is_visible,
        z.name as room_name, z.color as room_color, z.zone_type as room_type
      FROM computers c
      LEFT JOIN sessions s ON c.current_session_id = s.id AND s.status = 'ACTIVE'
      LEFT JOIN tariffs t ON s.tariff_id = t.id
      LEFT JOIN grid_layout g ON c.pc_number = g.computer_id AND c.club_id = g.club_id
      LEFT JOIN zones z ON COALESCE(c.zone_id, g.zone_id) = z.id AND (z.club_id = c.club_id OR z.club_id IS NULL)
      WHERE c.club_id = ? AND c.pc_number > 0
      ORDER BY c.pc_number ASC
    `).all(clubId);

    const now = Date.now();
    const activeBookings = clubId === null
      ? db.prepare("SELECT * FROM bookings WHERE status IN ('CONFIRMED', 'PENDING')").all()
      : db.prepare("SELECT * FROM bookings WHERE club_id = ? AND status IN ('CONFIRMED', 'PENDING')").all(clubId);

    const formatted = computers.map((pc) => {
      let remainingSeconds = 0;
      if (pc.ends_at) {
        remainingSeconds = Math.max(0, Math.floor((new Date(pc.ends_at).getTime() - now) / 1000));
      }
      const isPostpaid = Boolean(pc.notes && pc.notes.includes('POSTPAID'));
      const isMember = Boolean(pc.notes && pc.notes.includes('CLIENT_BALANCE_LIVE:'));
      const barPending = Number(pc.bar_pending_amount || 0);
      const gameAmount = Number(pc.total_amount || 0);
      const pcZoneId = pc.zone_id ?? null;
      const currentRateInfo = getActiveRateForMoment(new Date(now), false, pc.club_id || clubId || 1, pcZoneId);

      // Ushbu kompyuter uchun yaqinlashib kelayotgan bronni aniqlash (15-30 daqiqa oldin ogohlantirish)
      let upcomingBooking = null;
      const pcBookings = activeBookings.filter(b => b.computer_id === pc.pc_number || b.computer_id === pc.id || String(b.computer_id) === String(pc.pc_number));
      for (const b of pcBookings) {
        let bStartMs;
        if (b.start_time.includes('T') || b.start_time.includes('-')) {
          bStartMs = new Date(b.start_time).getTime();
        } else {
          const parts = b.start_time.split(':');
          const today = new Date();
          today.setHours(parseInt(parts[0], 10), parseInt(parts[1] || '0', 10), 0, 0);
          bStartMs = today.getTime();
        }

        let bEndMs;
        if (b.end_time.includes('T') || b.end_time.includes('-')) {
          bEndMs = new Date(b.end_time).getTime();
        } else {
          const parts = b.end_time.split(':');
          const today = new Date();
          today.setHours(parseInt(parts[0], 10), parseInt(parts[1] || '0', 10), 0, 0);
          bEndMs = today.getTime();
        }

        const diffMinutes = Math.floor((bStartMs - now) / 60000);
        const isCurrent = (now >= bStartMs && now <= bEndMs);
        // Agar bron ayni paytda faol bo'lsa yoki boshlanishiga 30 daqiqa yoki undan kam qolgan bo'lsa
        if (isCurrent || (diffMinutes >= 0 && diffMinutes <= 30)) {
          upcomingBooking = {
            id: b.id,
            customerName: b.customer_name,
            customerPhone: b.customer_phone,
            startTime: b.start_time,
            endTime: b.end_time,
            status: b.status,
            diffMinutes,
            isCurrent,
            isImminent: isCurrent || diffMinutes <= 15
          };
          break;
        }
      }

      const isClientWsConnected = ClientManager.isConnected(pc.id) || ClientManager.isConnected(pc.name) || ClientManager.isConnected(`PC-${String(pc.pc_number).padStart(2, '0')}`);
      const isOnlineVal = (isClientWsConnected || pc.status === 'AVAILABLE' || pc.status === 'ONLINE' || pc.status === 'OCCUPIED' || pc.status === 'LOCKED') && pc.status !== 'OFFLINE' ? 1 : 0;

      return {
        id: pc.id,
        clubId: pc.club_id,
        pcNumber: pc.pc_number,
        name: pc.name,
        ipAddress: pc.ip_address,
        macAddress: pc.mac_address,
        zone: pc.zone || 'STANDARD',
        status: pc.status,
        is_online: isOnlineVal,
        isOnline: isOnlineVal === 1,
        gridX: pc.grid_x ?? 0,
        gridY: pc.grid_y ?? 0,
        x: (pc.x !== undefined && pc.x !== null && pc.x > 0) ? pc.x : (pc.grid_x !== undefined && pc.grid_x !== null ? pc.grid_x * 120 + 40 : 40),
        y: (pc.y !== undefined && pc.y !== null && pc.y > 0) ? pc.y : (pc.grid_y !== undefined && pc.grid_y !== null ? pc.grid_y * 120 + 40 : 40),
        rotation: pc.rotation ?? 0,
        zoneId: pcZoneId,
        roomName: pc.room_name ?? null,
        roomColor: pc.room_color ?? null,
        roomType: pc.room_type ?? null,
        currentRate: currentRateInfo.pricePerHour,
        currentRateName: currentRateInfo.name,
        isVipPostpaidAllowed: currentRateInfo.isVipPostpaidAllowed !== false,
        isVisible: pc.is_visible ?? 1,
        barPendingAmount: barPending,
        totalWithBar: (pc.session_id ? gameAmount : 0) + barPending,
        upcomingBooking,
        activeSession: pc.session_id ? {
          sessionId: pc.session_id,
          customerName: pc.customer_name,
          tariffName: pc.tariff_name,
          startedAt: pc.started_at,
          endsAt: pc.ends_at,
          totalAmount: gameAmount,
          barPendingAmount: barPending,
          totalWithBar: gameAmount + barPending,
          paymentType: isMember ? 'BALANCE' : (pc.payment_type || (isPostpaid ? 'POSTPAID' : 'CASH')),
          isPostpaid,
          remainingSeconds
        } : null
      };
    });

    sendJson(res, 200, formatted);
    return;
  }

  // GET /api/tariffs (Tenant scoped, joined with zones)
  if (url.pathname === '/api/tariffs' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);

    const query = `
      SELECT t.*, 
             COALESCE(z.name, 'Umumiy Zal') as zone_name,
             COALESCE(z.zone_type, 'STANDARD') as zone_type_name
      FROM tariffs t
      LEFT JOIN zones z ON t.zone_id = z.id
      WHERE (t.club_id = ? OR ? IS NULL) AND t.is_active = 1
      ORDER BY COALESCE(t.zone_id, 0) ASC, t.price_per_hour ASC
    `;
    const tariffs = db.prepare(query).all(clubId, clubId);

    sendJson(res, 200, tariffs);
    return;
  }

  // GET /api/tariff-schedules — Dinamik tarif qoidalari (Tenant scoped)
  if (url.pathname === '/api/tariff-schedules' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);

    const schedules = clubId === null
      ? db.prepare('SELECT * FROM tariff_schedules ORDER BY priority DESC, id ASC').all()
      : db.prepare('SELECT * FROM tariff_schedules WHERE club_id = ? ORDER BY priority DESC, id ASC').all(clubId);

    const formatted = schedules.map(s => ({
      ...s,
      days_of_week: typeof s.days_of_week === 'string' ? JSON.parse(s.days_of_week) : s.days_of_week
    }));
    sendJson(res, 200, formatted);
    return;
  }

  // POST /api/tariffs/calculate — Dinamik Narx va Vaqt hisoblagichi (Zone-aware)
  if (url.pathname === '/api/tariffs/calculate' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const {
          startTime = new Date(),
          durationHours,
          targetEndTime,
          amount,
          isVip = false,
          clubId = 1,
          computerId = body?.computer_id,
          zoneId: explicitZoneId = body?.zone_id
        } = body || {};

        let zoneId = explicitZoneId ? parseInt(explicitZoneId, 10) : null;
        if (!zoneId && computerId) {
          zoneId = resolveZoneIdForComputer(computerId, clubId);
        }

        let roomName = null;
        if (zoneId) {
          const zRow = db.prepare('SELECT name FROM zones WHERE id = ?').get(zoneId);
          roomName = zRow?.name || null;
        }

        const currentRateInfo = getActiveRateForMoment(startTime, isVip, clubId, zoneId);

        let result;

        if (targetEndTime) {
          result = calculateIntervalPrice(startTime, targetEndTime, isVip, clubId, zoneId);
        } else if (amount !== undefined && amount !== null && amount !== '') {
          result = calculateTimeFromAmount(startTime, parseFloat(amount), isVip, clubId, zoneId);
        } else {
          const hours = durationHours !== undefined ? parseFloat(durationHours) : 1;
          result = calculateFromDurationHours(startTime, hours, isVip, clubId, zoneId);
        }

        sendJson(res, 200, {
          success: true,
          price: result.totalAmount,
          durationMinutes: result.totalMinutes,
          ...result,
          zoneId,
          roomName,
          currentRate: currentRateInfo.pricePerHour,
          currentRateName: currentRateInfo.name,
          isVipPostpaidAllowed: currentRateInfo.isVipPostpaidAllowed !== false
        });
      } catch (err) {
        sendJson(res, 400, { error: 'Hisoblashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // GET /api/stats (Kassa hisoboti: Faqat Manager/Owner yoki ruxsati bor xodimlar, club_id scoped)
  if (url.pathname === '/api/stats' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);

    // Kassa summasini ko'rish huquqi: superadmin, club_owner yoki finance:view ruxsati
    const canViewFinance = req.user.role === 'superadmin' || req.user.role === 'club_owner' || hasPermission(req.user.permissions, 'finance:view');

    let totalCash, totalCard, pcCounts;

    if (clubId === null) {
      // SuperAdmin global stats
      totalCash = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
        WHERE payment_type = 'CASH' AND DATE(created_at) = DATE('now')
      `).get();

      totalCard = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
        WHERE payment_type IN ('CARD', 'CLICK', 'PAYME') AND DATE(created_at) = DATE('now')
      `).get();

      pcCounts = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'OCCUPIED' THEN 1 ELSE 0 END) as occupied,
          SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
          SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) as offline
        FROM computers
      `).get();
    } else {
      // Club Owner / Cashier stats (Strictly scoped to club_id)
      totalCash = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
        WHERE club_id = ? AND payment_type = 'CASH' AND DATE(created_at) = DATE('now')
      `).get(clubId);

      totalCard = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
        WHERE club_id = ? AND payment_type IN ('CARD', 'CLICK', 'PAYME') AND DATE(created_at) = DATE('now')
      `).get(clubId);

      pcCounts = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'OCCUPIED' THEN 1 ELSE 0 END) as occupied,
          SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
          SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) as offline
        FROM computers
        WHERE club_id = ?
      `).get(clubId);
    }

    sendJson(res, 200, {
      totalRevenue: canViewFinance ? (Number(totalCash.total) + Number(totalCard.total)) : null,
      cashRevenue: canViewFinance ? Number(totalCash.total) : null,
      cardRevenue: canViewFinance ? Number(totalCard.total) : null,
      totalComputers: Number(pcCounts.total),
      occupiedComputers: Number(pcCounts.occupied || 0),
      availableComputers: Number(pcCounts.available || 0),
      offlineComputers: Number(pcCounts.offline || 0),
      canViewFinance,
      clubId,
      clubName: req.user.club?.name || null
    });
    return;
  }

  // GET /api/customers — Mijozlar bazasidan qidirish (Tenant scoped)
  if (url.pathname === '/api/customers' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);
    const query = url.searchParams.get('q') || '';
    let customers;

    if (query.trim()) {
      customers = clubId === null ? db.prepare(`
        SELECT id, name, phone, balance, discount_percent 
        FROM customers 
        WHERE name LIKE ? OR phone LIKE ? 
        LIMIT 10
      `).all(`%${query}%`, `%${query}%`) : db.prepare(`
        SELECT id, name, phone, balance, discount_percent 
        FROM customers 
        WHERE (name LIKE ? OR phone LIKE ?) AND (club_id = ? OR club_id IS NULL)
        LIMIT 10
      `).all(`%${query}%`, `%${query}%`, clubId);
    } else {
      customers = clubId === null ? db.prepare(`
        SELECT id, name, phone, balance, discount_percent 
        FROM customers 
        ORDER BY id DESC LIMIT 10
      `).all() : db.prepare(`
        SELECT id, name, phone, balance, discount_percent 
        FROM customers 
        WHERE (club_id = ? OR club_id IS NULL)
        ORDER BY id DESC LIMIT 10
      `).all(clubId);
    }
    sendJson(res, 200, customers);
    return;
  }

  // POST /api/sessions/start (Qayta ishlangan: Hours, Price, VIP Postpaid, Client Base, Tenant Scoped)
  if (url.pathname === '/api/sessions/start' && req.method === 'POST') {
    if (CloudLicenseService.isBlocked() || !LicenseManager.isOperational()) {
      sendJson(res, 403, {
        success: false,
        error: "License Suspended: " + (CloudLicenseService.lockMessage || LicenseManager.lockMessage || "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16"),
        lockReason: CloudLicenseService.getLockReason() || LicenseManager.lockReason
      });
      return;
    }
    if (!authenticate(req, res, { permission: 'session:manage' })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (data) => {
      try {
        const {
          computerId,
          mode = 'hours',           // 'hours', 'price', 'postpaid', 'client'
          durationMinutes = 60,
          amount = 0,
          customerName = 'Mijoz',
          customerId = null,
          paymentType = 'CASH',     // 'CASH', 'CLICK', 'BALANCE', 'POSTPAID'
          isPostpaid = false,
          tariffId = null
        } = data;

        const pcNum = /^\d+$/.test(String(computerId || '').trim()) ? parseInt(computerId, 10) : -999999;
        const targetPcRow = db.prepare('SELECT id, status, mac_address, name, pc_number, zone, zone_id FROM computers WHERE id = ? OR name = ? OR pc_number = ?').get(String(computerId), String(computerId), pcNum);
        const resolvedCompId = targetPcRow ? targetPcRow.id : computerId;
        const pcZoneId = targetPcRow?.zone_id || resolveZoneIdForComputer(resolvedCompId, clubId);

        let finalDuration = durationMinutes;
        let finalAmount = amount;
        let finalEndsAt;
        const startedAt = new Date();

        const activeRate = getActiveRateForMoment(startedAt, false, clubId, pcZoneId);

        const isPostpaidReq = Boolean(mode === 'postpaid' || mode === 'VIP' || mode === 'vip' || isPostpaid || paymentType === 'POSTPAID');
        if (isPostpaidReq) {
          const settings = getClubSettings(clubId);
          if (!settings.vip_enabled) {
            sendJson(res, 403, { error: 'VIP Postpaid hozirda faol emas (Menejer tomonidan sozlamalarda o\'chirilgan).' });
            return;
          }
          if (activeRate.isVipPostpaidAllowed === false) {
            sendJson(res, 403, { error: 'Ushbu xonada VIP Postpaid (Keyin to\'lash) taqiqlangan.' });
            return;
          }
          finalDuration = 24 * 60;
          finalAmount = 0;
          finalEndsAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);
        } else {
          if (mode === 'hours' || (!amount && durationMinutes)) {
            const calc = calculateFromDurationHours(startedAt, finalDuration / 60, false, clubId, pcZoneId);
            finalAmount = calc.totalAmount;
            finalEndsAt = new Date(calc.endTime);
          } else if (mode === 'price' && amount) {
            const calc = calculateTimeFromAmount(startedAt, amount, false, clubId, pcZoneId);
            finalDuration = calc.totalMinutes;
            finalAmount = calc.totalAmount;
            finalEndsAt = new Date(calc.endTime);
          } else {
            finalEndsAt = new Date(startedAt.getTime() + finalDuration * 60 * 1000);
          }
        }

        // Standart soatlik tarif
        const defaultTariff = db.prepare('SELECT id, name, price_per_hour FROM tariffs WHERE club_id = ? ORDER BY price_per_hour ASC LIMIT 1').get(clubId)
          || db.prepare('SELECT id, name, price_per_hour FROM tariffs ORDER BY price_per_hour ASC LIMIT 1').get();
        const tariff = (tariffId && db.prepare('SELECT id, name, price_per_hour FROM tariffs WHERE id = ?').get(tariffId)) || defaultTariff;

        const sessionId = `ses_${Date.now().toString(36)}`;
        const notes = isPostpaidReq ? 'POSTPAID' : (mode === 'client' ? `CLIENT_ID:${customerId}` : mode);

        // Agar balansdan to'lansa, mijoz balansini kamaytirish
        if (mode === 'client' && customerId && paymentType === 'BALANCE') {
          const clientRow = db.prepare('SELECT balance FROM users WHERE id = ?').get(customerId)
            || db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId);
          if (clientRow && clientRow.balance >= finalAmount) {
            db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(finalAmount, customerId);
            db.prepare('INSERT INTO client_transactions (club_id, user_id, amount, type, payment_method) VALUES (?, ?, ?, "SESSION_DEDUCT", "BALANCE")').run(clubId, customerId, finalAmount);
          }
        }

        // 1. Sessiya yaratish (club_id bilan)
        db.prepare(`
          INSERT INTO sessions (id, club_id, computer_id, tariff_id, user_id, customer_name, started_at, ends_at, total_amount, paid_amount, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
        `).run(
          sessionId,
          clubId,
          resolvedCompId,
          activeRate.tariffId || tariff?.id || 'trf_standard_1h',
          customerId || null,
          customerName || 'Mijoz',
          startedAt.toISOString(),
          finalEndsAt.toISOString(),
          finalAmount,
          isPostpaidReq ? 0 : finalAmount,
          notes
        );

        // 2. Tranzaksiya yozish (agar postpaid bo'lmasa va pul to'langan bo'lsa)
        if (!isPostpaidReq && finalAmount > 0) {
          const validPayType = ['CASH', 'CARD', 'CLICK', 'PAYME'].includes(paymentType) ? paymentType : 'CASH';
          db.prepare(`
            INSERT INTO transactions (id, club_id, session_id, amount, payment_type, payment_method, transaction_type, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 'PREPAID', ?)
          `).run(`tx_${Date.now().toString(36)}`, clubId, sessionId, finalAmount, validPayType, validPayType, String(currentUserId));
        }

        // 3. Kompyuter holatini yangilash
        const wasOffline = !targetPcRow || targetPcRow.status === 'OFFLINE';

        db.prepare(`
          UPDATE computers 
          SET status = 'OCCUPIED', current_session_id = ? 
          WHERE id = ?
        `).run(sessionId, resolvedCompId);

        // Agar kompyuter o'chiq bo'lsa, avtomatik ravishda Wake-on-LAN (Power ON) Magic Packet yuborib yoqish
        if (wasOffline && targetPcRow && targetPcRow.mac_address) {
          try {
            sendWakeOnLan(targetPcRow.mac_address).catch(err => {
              console.warn(`[AutoWake] ${targetPcRow.name} (${targetPcRow.mac_address}) WoL xatosi:`, err.message);
            });
            console.log(`⚡ [AutoWake] O'chiq kompyuter (${targetPcRow.name || resolvedCompId}) uchun Wake-on-LAN Magic Packet yuborildi.`);
          } catch (wakeErr) {
            console.warn(`[AutoWake] Error:`, wakeErr);
          }
        }

        // 4. Client Agent ga START_SESSION yuborish
        const sessionPayload = {
          type: 'START_SESSION',
          sessionId,
          durationMinutes: Math.round(finalDuration),
          endTime: finalEndsAt.toISOString(),
          zoneName: (targetPcRow && targetPcRow.zone) ? targetPcRow.zone : 'VIP',
          pricePerHour: (tariff && tariff.price_per_hour) ? tariff.price_per_hour : 10000,
          tariffName: isPostpaid ? 'VIP Postpaid (Ochiq)' : (tariff?.name || 'Standart'),
          startedAt: startedAt.getTime(),
          endsAt: finalEndsAt.getTime(),
          remainingSeconds: isPostpaid ? -1 : Math.round(finalDuration * 60),
          customerName: customerName || 'Mijoz',
          isPostpaid: !!isPostpaid
        };

        ClientManager.send(resolvedCompId, 'START_SESSION', sessionPayload);
        if (targetPcRow?.name) {
          ClientManager.send(targetPcRow.name, 'START_SESSION', sessionPayload);
        }
        if (targetPcRow?.pc_number) {
          ClientManager.send(`PC-${String(targetPcRow.pc_number).padStart(2, '0')}`, 'START_SESSION', sessionPayload);
        }

        // Broadcast WORKSTATION_UPDATED with explicit is_online: 1, status: 'OCCUPIED'
        ClientManager.broadcast('WORKSTATION_UPDATED', {
          id: resolvedCompId,
          pcNumber: targetPcRow?.pc_number,
          name: targetPcRow?.name,
          status: 'OCCUPIED',
          is_online: 1,
          isOnline: true,
          active_session: sessionPayload,
          activeSession: sessionPayload
        });

        broadcastAdminUpdate();
        logAuditEvent(clubId, null, 'SESSION_START', {
          sessionId,
          computerId: resolvedCompId,
          customerName: customerName || 'Mijoz',
          mode,
          durationMinutes: finalDuration,
          amount: finalAmount,
          isPostpaid: !!isPostpaid,
          tariffName: isPostpaid ? 'VIP Postpaid' : (tariff?.name || 'Standart')
        });

        sendJson(res, 201, {
          success: true,
          sessionId,
          mode,
          durationMinutes: finalDuration,
          amount: finalAmount,
          isPostpaid: !!isPostpaid
        });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  // POST /api/sessions/stop (Tenant scoped)
  if (url.pathname === '/api/sessions/stop' && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'session:manage' })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (data) => {
      try {
        const { computerId, paymentType = 'CASH' } = data;
        const pc = db.prepare('SELECT current_session_id FROM computers WHERE id = ?').get(computerId);

        let finalBill = 0;
        let isPostpaidSession = false;

        if (pc?.current_session_id) {
          const session = db.prepare(`
            SELECT s.*, t.price_per_hour 
            FROM sessions s 
            LEFT JOIN tariffs t ON s.tariff_id = t.id 
            WHERE s.id = ?
          `).get(pc.current_session_id);

          if (session) {
            const started = new Date(session.started_at).getTime();
            const nowTime = Date.now();
            const playedMinutes = Math.max(1, Math.ceil((nowTime - started) / 60000));

            let pendingBarTotal = 0;
            const barPendingRow = db.prepare(`
              SELECT COALESCE(SUM(total_amount), 0) as total 
              FROM bar_orders 
              WHERE (session_id = ? OR (computer_id = ? AND payment_status = 'PENDING_AT_CHECKOUT'))
                AND payment_status = 'PENDING_AT_CHECKOUT'
            `).get(pc.current_session_id, pc.pc_number || computerId);

            if (barPendingRow && Number(barPendingRow.total) > 0) {
              pendingBarTotal = Number(barPendingRow.total);
              db.prepare(`
                UPDATE bar_orders 
                SET payment_status = 'PAID' 
                WHERE (session_id = ? OR (computer_id = ? AND payment_status = 'PENDING_AT_CHECKOUT'))
                  AND payment_status = 'PENDING_AT_CHECKOUT'
              `).run(pc.current_session_id, pc.pc_number || computerId);

              // Kassa tranzaksiyasiga yozish
              const validPayType = ['CARD', 'CLICK', 'PAYME'].includes(paymentType) ? 'CARD' : 'CASH';
              db.prepare(`
                INSERT INTO transactions (id, club_id, session_id, amount, payment_type, payment_method, transaction_type, created_by, notes)
                VALUES (?, ?, ?, ?, ?, ?, 'BAR_SALE', ?, 'BAR_SALE_CHECKOUT')
              `).run(`tx_bar_chk_${Date.now().toString(36)}`, session.club_id || clubId, pc.current_session_id, pendingBarTotal, validPayType, validPayType, String(currentUserId));
            }

            let gameBill = 0;
            if (session.notes === 'POSTPAID' || session.paid_amount === 0) {
              isPostpaidSession = true;
              const settings = getClubSettings(session.club_id || clubId);

              if (settings.vip_pricing_mode === 'CUSTOM') {
                gameBill = Math.round((playedMinutes / 60) * (settings.vip_custom_price || 15000));
              } else {
                const intervalCalc = calculateIntervalPrice(session.started_at, new Date(nowTime), true, session.club_id || clubId);
                gameBill = Math.round(intervalCalc.totalAmount);
              }
              finalBill = gameBill + pendingBarTotal;

              db.prepare(`
                UPDATE sessions 
                SET status = 'COMPLETED', ends_at = CURRENT_TIMESTAMP, total_amount = ?, paid_amount = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
              `).run(finalBill, finalBill, pc.current_session_id);

              if (gameBill > 0) {
                const validPayType = ['CARD', 'CLICK', 'PAYME'].includes(paymentType) ? 'CARD' : 'CASH';
                db.prepare(`
                  INSERT INTO transactions (id, club_id, session_id, amount, payment_type, payment_method, transaction_type, created_by, notes)
                  VALUES (?, ?, ?, ?, ?, ?, 'POSTPAID_SETTLEMENT', ?, ?)
                `).run(`tx_postpaid_${Date.now().toString(36)}_${Math.random().toString(36).substring(2,6)}`, session.club_id || clubId, pc.current_session_id, gameBill, validPayType, validPayType, String(currentUserId), `VIP_POSTPAID_${settings.vip_pricing_mode}`);
              }
            } else {
              db.prepare(`UPDATE sessions SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(pc.current_session_id);
            }

            db.prepare(`UPDATE computers SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(computerId);

            ClientManager.send(computerId, 'STOP_SESSION', {
              sessionId: pc?.current_session_id || '',
              reason: 'ADMIN_TERMINATED',
              forceKillApps: true,
              message: 'Seans to\'xtatildi.'
            });
            ClientManager.send(computerId, 'LOCK_SCREEN', {
              reason: 'ADMIN_LOCK',
              message: 'Kompyuter administrator tomonidan bloklandi.'
            });

            broadcastAdminUpdate();
            logAuditEvent(clubId, null, 'SESSION_STOP', {
              sessionId: pc?.current_session_id || null,
              computerId,
              finalBill,
              gameBill,
              barBill: pendingBarTotal,
              isPostpaid: isPostpaidSession
            });

            sendJson(res, 200, { success: true, finalBill, gameBill, barBill: pendingBarTotal, isPostpaid: isPostpaidSession });
            return;
          }
        }

        db.prepare(`UPDATE computers SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(computerId);

        ClientManager.send(computerId, 'STOP_SESSION', {
          sessionId: pc?.current_session_id || '',
          reason: 'ADMIN_TERMINATED',
          forceKillApps: true,
          message: 'Seans to\'xtatildi.'
        });
        ClientManager.send(computerId, 'LOCK_SCREEN', {
          reason: 'ADMIN_LOCK',
          message: 'Kompyuter administrator tomonidan bloklandi.'
        });

        broadcastAdminUpdate();
        logAuditEvent(clubId, null, 'SESSION_STOP', {
          sessionId: pc?.current_session_id || null,
          computerId,
          finalBill: 0,
          isPostpaid: isPostpaidSession
        });

        sendJson(res, 200, { success: true, finalBill: 0, isPostpaid: isPostpaidSession });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  // ==========================================================================
  // 1. POST /api/sessions/:id/stop-early (va /api/sessions/stop-early)
  // Muddatidan oldin to'xtatish va qaytim (Zdacha) hisoblash (Tenant scoped)
  // ==========================================================================
  const stopEarlyMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stop-early$/);
  if ((stopEarlyMatch || url.pathname === '/api/sessions/stop-early') && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'session:manage' })) return;
    const currentUserId = req.user.id;
    const clubId = getTenantClubId(req);

    readBody(req, (data) => {
      try {
        const rawTarget = stopEarlyMatch ? stopEarlyMatch[1] : (data.sessionId || data.computerId || data.id);
        if (!rawTarget) {
          sendJson(res, 400, { error: 'Seans ID yoki Kompyuter ID talab qilinadi.' });
          return;
        }

        let sessionRow = db.prepare(`
          SELECT s.*, t.price_per_hour 
          FROM sessions s 
          LEFT JOIN tariffs t ON s.tariff_id = t.id 
          WHERE s.id = ?
        `).get(rawTarget);

        if (!sessionRow) {
          const resolvedPc = resolvePcId(rawTarget);
          const pc = db.prepare('SELECT current_session_id FROM computers WHERE id = ?').get(resolvedPc);
          if (pc?.current_session_id) {
            sessionRow = db.prepare(`
              SELECT s.*, t.price_per_hour 
              FROM sessions s 
              LEFT JOIN tariffs t ON s.tariff_id = t.id 
              WHERE s.id = ?
            `).get(pc.current_session_id);
          }
        }

        if (!sessionRow || sessionRow.status !== 'ACTIVE') {
          sendJson(res, 400, { error: 'Faol seans topilmadi.' });
          return;
        }

        if (clubId !== null && sessionRow.club_id && sessionRow.club_id !== clubId) {
          sendJson(res, 403, { error: 'Boshqa klubga tegishli seansni to\'xtatish taqiqlangan.' });
          return;
        }

        const compId = sessionRow.computer_id;
        const startedAt = new Date(sessionRow.started_at);
        const now = new Date();
        const playedMinutes = Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60000));
        const totalPaid = Number(sessionRow.paid_amount || sessionRow.total_amount || 0);

        let usedAmount = 0;
        let refundAmount = 0;

        if (sessionRow.notes === 'POSTPAID' || sessionRow.paid_amount === 0) {
          const hourlyRate = sessionRow.price_per_hour || 12000;
          usedAmount = Math.round((playedMinutes / 60) * hourlyRate);
          refundAmount = 0;
        } else {
          const intervalCalc = calculateIntervalPrice(startedAt, now, false, sessionRow.club_id || clubId || 1);
          usedAmount = Math.min(totalPaid, Math.max(0, intervalCalc.totalAmount));
          refundAmount = Math.max(0, Math.round(totalPaid - usedAmount));
        }

        // Agar bu a'zo (member) hisobidan yechilgan bo'lsa, balansiga qaytarish
        if (sessionRow.notes && sessionRow.notes.includes('CLIENT_BALANCE_LIVE:')) {
          const matchLive = sessionRow.notes.match(/CLIENT_BALANCE_LIVE:(\d+)/);
          const memberId = matchLive ? parseInt(matchLive[1], 10) : null;
          if (memberId && refundAmount > 0) {
            db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refundAmount, memberId);
            db.prepare(`
              INSERT INTO client_transactions (club_id, user_id, amount, type, payment_method)
              VALUES (?, ?, ?, 'REFUND', 'BALANCE')
            `).run(sessionRow.club_id || 1, memberId, refundAmount);
          }
        } else if (refundAmount > 0) {
          const origTx = db.prepare('SELECT payment_type FROM transactions WHERE session_id = ? ORDER BY created_at ASC LIMIT 1').get(sessionRow.id);
          const payType = origTx?.payment_type || 'CASH';
          db.prepare(`
            INSERT INTO transactions (id, club_id, session_id, amount, payment_type, created_by, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(`tx_${Date.now().toString(36)}`, sessionRow.club_id || 1, sessionRow.id, -refundAmount, payType, String(currentUserId), 'REFUND (Zdacha)');
        }

        // Bazadagi seansni yakunlash va kompyuterni qulflash
        db.prepare(`
          UPDATE sessions 
          SET status = 'COMPLETED', ends_at = CURRENT_TIMESTAMP, total_amount = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(usedAmount, sessionRow.id);

        db.prepare(`
          UPDATE computers 
          SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(compId);

        // Klient agentga WebSocket signallari
        ClientManager.send(compId, 'STOP_SESSION', {
          sessionId: sessionRow.id,
          reason: 'EARLY_TERMINATION',
          refundAmount,
          usedAmount,
          playedMinutes,
          forceKillApps: true,
          message: `Seans to'xtatildi. Qaytim: ${refundAmount.toLocaleString()} UZS`
        });

        ClientManager.send(compId, 'LOCK_SCREEN', {
          reason: 'SESSION_TERMINATED',
          message: `Seans yakunlandi. Qaytim (Zdacha): ${refundAmount.toLocaleString()} UZS`
        });

        broadcastAdminUpdate();
        logAuditEvent(sessionRow.club_id || clubId || 1, null, 'REFUND', {
          sessionId: sessionRow.id,
          computerId: compId,
          customerName: sessionRow.customer_name || 'Mijoz',
          playedMinutes,
          totalPaid,
          usedAmount,
          refundAmount
        });

        console.log(`💵 [StopEarly] Seans ${sessionRow.id} to'xtatildi (${playedMinutes} daq). To'langan: ${totalPaid}, Ishlatildi: ${usedAmount}, Qaytim: ${refundAmount} UZS`);

        sendJson(res, 200, {
          success: true,
          sessionId: sessionRow.id,
          computerId: compId,
          playedMinutes,
          totalPaid,
          usedAmount,
          refundAmount
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Seansni muddatidan oldin to\'xtatishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // 2. POST /api/sessions/:id/extend (va /api/sessions/extend)
  // Seansni uzaytirish (Tenant scoped)
  // ==========================================================================
  const extendMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/extend$/);
  if ((extendMatch || url.pathname === '/api/sessions/extend') && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'session:manage' })) return;
    const currentUserId = req.user.id;
    const clubId = getTenantClubId(req);

    readBody(req, (data) => {
      try {
        const rawTarget = extendMatch ? extendMatch[1] : (data.sessionId || data.computerId || data.id);
        const { addHours, addAmount, additionalMinutes, additionalAmount, paymentType = 'CASH' } = data;

        let sessionRow = db.prepare(`
          SELECT s.*, t.price_per_hour 
          FROM sessions s 
          LEFT JOIN tariffs t ON s.tariff_id = t.id 
          WHERE s.id = ?
        `).get(rawTarget);

        if (!sessionRow) {
          const resolvedPc = resolvePcId(rawTarget);
          const pc = db.prepare('SELECT current_session_id FROM computers WHERE id = ?').get(resolvedPc);
          if (pc?.current_session_id) {
            sessionRow = db.prepare(`
              SELECT s.*, t.price_per_hour 
              FROM sessions s 
              LEFT JOIN tariffs t ON s.tariff_id = t.id 
              WHERE s.id = ?
            `).get(pc.current_session_id);
          }
        }

        if (!sessionRow || sessionRow.status !== 'ACTIVE') {
          sendJson(res, 400, { error: 'Uzaytirish uchun faol seans topilmadi.' });
          return;
        }

        if (clubId !== null && sessionRow.club_id && sessionRow.club_id !== clubId) {
          sendJson(res, 403, { error: 'Boshqa klubga tegishli seansni uzaytirish taqiqlangan.' });
          return;
        }

        const compId = sessionRow.computer_id;
        const currentEnd = new Date(sessionRow.ends_at).getTime();
        let addMins = 0;
        let addAmt = 0;

        if (addHours !== undefined && addHours !== null) {
          const hours = parseFloat(addHours);
          addMins = Math.round(hours * 60);
          const calc = calculateFromDurationHours(new Date(currentEnd), hours, false, sessionRow.club_id || clubId || 1);
          addAmt = addAmount !== undefined ? parseFloat(addAmount) : calc.totalAmount;
        } else if (addAmount !== undefined && addAmount !== null) {
          addAmt = parseFloat(addAmount);
          const calc = calculateTimeFromAmount(new Date(currentEnd), addAmt, false, sessionRow.club_id || clubId || 1);
          addMins = calc.totalMinutes;
        } else if (additionalMinutes !== undefined && additionalMinutes !== null) {
          addMins = parseInt(additionalMinutes, 10);
          addAmt = additionalAmount !== undefined 
            ? parseFloat(additionalAmount) 
            : calculateFromDurationHours(new Date(currentEnd), addMins / 60, false, sessionRow.club_id || clubId || 1).totalAmount;
        } else {
          addMins = 60;
          addAmt = sessionRow.price_per_hour || 10000;
        }

        const newEnd = new Date(currentEnd + addMins * 60 * 1000);

        // Bazada seans vaqtini yangilash
        db.prepare(`
          UPDATE sessions 
          SET ends_at = ?, total_amount = total_amount + ?, paid_amount = paid_amount + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newEnd.toISOString(), addAmt, addAmt, sessionRow.id);

        // Kassa tranzaksiyasiga yozish
        if (addAmt > 0) {
          const validPayType = ['CASH', 'CARD', 'CLICK', 'PAYME'].includes(paymentType) ? paymentType : 'CASH';
          db.prepare(`
            INSERT INTO transactions (id, club_id, session_id, amount, payment_type, created_by, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'SESSION_EXTEND')
          `).run(`tx_${Date.now().toString(36)}`, sessionRow.club_id || 1, sessionRow.id, addAmt, validPayType, String(currentUserId));
        }

        // Klient agentiga yangilangan qolgan vaqtni yuborish
        const remSec = Math.max(0, Math.floor((newEnd.getTime() - Date.now()) / 1000));
        ClientManager.send(compId, 'UPDATE_REMAINING_TIME', {
          sessionId: sessionRow.id,
          remainingSeconds: remSec,
          endsAt: newEnd.getTime()
        });

        broadcastAdminUpdate();
        logAuditEvent(sessionRow.club_id || clubId || 1, null, 'SESSION_EXTEND', {
          sessionId: sessionRow.id,
          computerId: compId,
          customerName: sessionRow.customer_name || 'Mijoz',
          additionalMinutes: addMins,
          additionalAmount: addAmt,
          paymentType,
          newEndsAt: newEnd.toISOString()
        });

        console.log(`⏳ [SessionExtend] Seans ${sessionRow.id} (${compId}) uzaytirildi: +${addMins} daq, +${addAmt} UZS. Yangi tugash: ${newEnd.toISOString()}`);

        sendJson(res, 200, {
          success: true,
          sessionId: sessionRow.id,
          computerId: compId,
          addedMinutes: addMins,
          addedAmount: addAmt,
          newEndsAt: newEnd.toISOString(),
          remainingSeconds: remSec
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Seansni uzaytirishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // 3. POST /api/sessions/transfer
  // Kompyuterni almashtirish (PC Swap / Session Transfer, Tenant scoped)
  // ==========================================================================
  if (url.pathname === '/api/sessions/transfer' && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'session:manage' })) return;
    const clubId = getTenantClubId(req);

    readBody(req, (data) => {
      try {
        const { fromComputerId, toComputerId } = data;
        if (!fromComputerId || !toComputerId) {
          sendJson(res, 400, { error: 'fromComputerId va toComputerId ko\'rsatilishi shart.' });
          return;
        }

        const fromPcId = resolvePcId(fromComputerId);
        const toPcId = resolvePcId(toComputerId);

        if (fromPcId === toPcId) {
          sendJson(res, 400, { error: 'Bir xil kompyuterga ko\'chirib bo\'lmaydi.' });
          return;
        }

        const fromPc = db.prepare('SELECT * FROM computers WHERE id = ?').get(fromPcId);
        if (!fromPc || !fromPc.current_session_id) {
          sendJson(res, 400, { error: `Manba kompyuter (${fromPc?.name || fromPcId}) da faol seans mavjud emas.` });
          return;
        }

        const toPc = db.prepare('SELECT * FROM computers WHERE id = ?').get(toPcId);
        if (!toPc) {
          sendJson(res, 400, { error: `Maqsadli kompyuter (${toPcId}) topilmadi.` });
          return;
        }

        // Agar har ikkala PC bitta klubga tegishli ekanligini tekshirish
        if (fromPc.club_id !== toPc.club_id) {
          sendJson(res, 400, { error: 'Turli klublar kompyuterlari o\'rtasida seansni ko\'chirish taqiqlangan.' });
          return;
        }

        if (clubId !== null && fromPc.club_id !== clubId) {
          sendJson(res, 403, { error: 'Boshqa klub kompyuterini boshqarish taqiqlangan.' });
          return;
        }

        if (toPc.status === 'OCCUPIED' && toPc.current_session_id) {
          sendJson(res, 400, { error: `Maqsadli kompyuter (${toPc.name || toPcId}) hozirda band!` });
          return;
        }

        const session = db.prepare(`
          SELECT s.*, t.name as tariff_name 
          FROM sessions s 
          LEFT JOIN tariffs t ON s.tariff_id = t.id 
          WHERE s.id = ?
        `).get(fromPc.current_session_id);

        if (!session || session.status !== 'ACTIVE') {
          sendJson(res, 400, { error: 'Ko\'chirish uchun faol seans topilmadi.' });
          return;
        }

        const now = Date.now();
        const endsAtMs = new Date(session.ends_at).getTime();
        const remainingSeconds = Math.max(1, Math.floor((endsAtMs - now) / 1000));
        const isPostpaid = session.notes === 'POSTPAID' || session.paid_amount === 0;

        // 1. Bazada seansni yangi kompyuterga biriktirish
        db.prepare(`
          UPDATE sessions 
          SET computer_id = ?, notes = notes || ' | TRANSFER: ' || ? || '->' || ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(toPcId, fromPc.name || fromPcId, toPc.name || toPcId, session.id);

        // 2. fromComputer bo'shatiladi
        db.prepare(`
          UPDATE computers 
          SET status = 'AVAILABLE', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(fromPcId);

        // 3. toComputer band qilinadi
        db.prepare(`
          UPDATE computers 
          SET status = 'OCCUPIED', current_session_id = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(session.id, toPcId);

        // 4. WebSocket: fromComputer qulflanadi
        ClientManager.send(fromPcId, 'STOP_SESSION', {
          sessionId: session.id,
          reason: 'SESSION_TRANSFERRED',
          message: `Seans ${toPc.name || toPcId} ga ko'chirildi.`
        });
        ClientManager.send(fromPcId, 'LOCK_SCREEN', {
          reason: 'TRANSFERRED',
          message: `Seans ${toPc.name || toPcId} ga ko'chirildi.`
        });

        // 5. WebSocket: toComputer da seans qolgan soniyalar bilan boshlanadi
        ClientManager.send(toPcId, 'START_SESSION', {
          sessionId: session.id,
          tariffName: session.tariff_name || 'Ko\'chirilgan Seans',
          startedAt: new Date(session.started_at).getTime(),
          endsAt: endsAtMs,
          remainingSeconds: isPostpaid ? -1 : remainingSeconds,
          customerName: session.customer_name || 'Mijoz',
          isPostpaid
        });

        broadcastAdminUpdate();
        logAuditEvent(fromPc.club_id || clubId || 1, null, 'PC_SWAP', {
          sessionId: session.id,
          fromComputerId: fromPcId,
          toComputerId: toPcId,
          fromName: fromPc.name || fromPcId,
          toName: toPc.name || toPcId,
          customerName: session.customer_name || 'Mijoz',
          remainingSeconds
        });

        sendJson(res, 200, {
          success: true,
          sessionId: session.id,
          fromComputerId: fromPcId,
          toComputerId: toPcId,
          remainingSeconds,
          endsAt: session.ends_at
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Kompyuterni almashtirishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // 4. POST /api/computers/:id/power (va /api/computers/power, Tenant scoped)
  // ==========================================================================
  const powerMatch = url.pathname.match(/^\/api\/computers\/([^/]+)\/power$/);
  if ((powerMatch || url.pathname === '/api/computers/power') && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'], permission: 'computers:manage' })) return;
    const clubId = getTenantClubId(req);

    readBody(req, async (data) => {
      try {
        const rawTarget = powerMatch ? powerMatch[1] : (data.computerId || data.id);
        const action = String(data.action || '').trim().toLowerCase();

        if (!rawTarget || !action) {
          sendJson(res, 400, { error: 'computerId va action ("shutdown", "reboot", "lock", "unlock", "wake") ko\'rsatilishi shart.' });
          return;
        }

        const pcId = resolvePcId(rawTarget);
        const pc = db.prepare('SELECT * FROM computers WHERE id = ?').get(pcId);

        if (!pc) {
          sendJson(res, 404, { error: `Kompyuter (${pcId}) topilmadi.` });
          return;
        }

        if (clubId !== null && pc.club_id !== clubId) {
          sendJson(res, 403, { error: 'Boshqa klub kompyuterini boshqarish taqiqlangan.' });
          return;
        }

        const cmd = action.toUpperCase();

        if (['SHUTDOWN', 'REBOOT', 'LOCK', 'UNLOCK'].includes(cmd)) {
          ClientManager.send(pcId, 'REMOTE_COMMAND', { command: cmd, action: cmd });
          ClientManager.send(pcId, 'POWER_COMMAND', { command: cmd, action: cmd });

          if (cmd === 'SHUTDOWN') {
            db.prepare("UPDATE computers SET status = 'OFFLINE', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pcId);
          } else if (cmd === 'LOCK') {
            db.prepare("UPDATE computers SET status = 'LOCKED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pcId);
          } else if (cmd === 'UNLOCK') {
            db.prepare("UPDATE computers SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pcId);
          }

          broadcastAdminUpdate();
          logAuditEvent(pc.club_id || clubId || 1, null, 'POWER_ACTION', {
            computerId: pcId,
            pcNumber: pc.pc_number,
            name: pc.name,
            action: cmd
          });

          sendJson(res, 200, {
            success: true,
            computerId: pcId,
            action: cmd,
            message: `${pc.name || pcId} ga ${cmd} masofaviy buyrug'i muvaffaqiyatli jo'natildi.`
          });
          return;
        } else if (action === 'wake') {
          const mac = pc.mac_address;
          if (!mac) {
            sendJson(res, 400, { error: `Kompyuter (${pc.name || pcId}) uchun MAC manzil bazada mavjud emas.` });
            return;
          }

          const result = await sendWakeOnLan(mac, data.broadcastIp || '255.255.255.255', data.port || 9);
          logAuditEvent(pc.club_id || clubId || 1, null, 'POWER_ACTION', {
            computerId: pcId,
            pcNumber: pc.pc_number,
            name: pc.name,
            action: 'WAKE'
          });
          sendJson(res, 200, {
            success: true,
            computerId: pcId,
            macAddress: mac,
            bytesSent: result.bytesSent,
            message: `${pc.name || pcId} uchun Wake-on-LAN Magic Packet muvaffaqiyatli tarmoqqa yuborildi.`
          });
          return;
        } else {
          sendJson(res, 400, { error: `Noma'lum amal: "${action}".` });
          return;
        }
      } catch (err) {
        sendJson(res, 500, { error: 'Quvvat buyrug\'ini bajarishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // POST /api/messages/send
  if (url.pathname === '/api/messages/send' && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'message:send' })) return;
    readBody(req, (data) => {
      const { computerId, title, message } = data;
      ClientManager.send(computerId, 'SEND_MESSAGE', {
        messageId: `msg_${Date.now()}`,
        title: title || 'Admin Xabari',
        message: message || '',
        severity: 'INFO',
        displayDurationSeconds: 10
      });
      sendJson(res, 200, { success: true });
    });
    return;
  }

  // ==========================================================================
  // MULTI-PC (BATCH) SESSION STARTER (Tenant scoped)
  // POST /api/sessions/batch-start
  // ==========================================================================
  if (url.pathname === '/api/sessions/batch-start' && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'session:manage' })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (data) => {
      try {
        const {
          computerIds = [],
          mode = 'HOURS',
          value,
          paymentType = 'CASH',
          customerName = 'Guruh Seansi',
          customerId = null
        } = data;

        if (!Array.isArray(computerIds) || computerIds.length === 0) {
          sendJson(res, 400, { error: 'Kamida bitta kompyuter tanlanishi kerak.' });
          return;
        }

        const normalizedMode = mode.toUpperCase();
        const startedAt = new Date();
        let perPcDurationMins = 60;
        let perPcAmount = 10000;
        let isPostpaid = false;
        let endsAt;

        if (normalizedMode === 'POSTPAID' || normalizedMode === 'VIP') {
          const settings = getClubSettings(clubId);
          if (!settings.vip_enabled) {
            sendJson(res, 403, { error: 'VIP Postpaid hozirda faol emas (Menejer tomonidan sozlamalarda o\'chirilgan).' });
            return;
          }
          isPostpaid = true;
          perPcDurationMins = 24 * 60;
          perPcAmount = 0;
          endsAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);
        } else if (normalizedMode === 'END_TIME' || normalizedMode === 'ENDTIME') {
          const timeTarget = data.targetEndTime || value || '18:00';
          const calc = calculateIntervalPrice(startedAt, timeTarget, false);
          perPcDurationMins = data.durationMinutes || calc.totalMinutes;
          perPcAmount = data.amount !== undefined ? parseFloat(data.amount) : calc.totalAmount;
          endsAt = new Date(calc.endTime);
        } else if (normalizedMode === 'AMOUNT' || normalizedMode === 'PRICE') {
          const amtTarget = data.amount !== undefined ? parseFloat(data.amount) : (parseFloat(value) || 10000);
          const calc = calculateTimeFromAmount(startedAt, amtTarget, false);
          perPcDurationMins = data.durationMinutes || calc.totalMinutes;
          perPcAmount = amtTarget;
          endsAt = new Date(calc.endTime);
        } else if (normalizedMode === 'HOURS') {
          const hours = data.durationMinutes ? (data.durationMinutes / 60) : (parseFloat(value) || 1);
          const calc = calculateFromDurationHours(startedAt, hours, false);
          perPcDurationMins = data.durationMinutes || calc.totalMinutes;
          perPcAmount = data.amount !== undefined ? parseFloat(data.amount) : calc.totalAmount;
          endsAt = new Date(calc.endTime);
        } else {
          // CLIENT rejim
          const hours = data.durationMinutes ? (data.durationMinutes / 60) : (parseFloat(value) || 1);
          const calc = calculateFromDurationHours(startedAt, hours, false);
          perPcDurationMins = data.durationMinutes || calc.totalMinutes;
          perPcAmount = data.amount !== undefined ? parseFloat(data.amount) : calc.totalAmount;
          endsAt = new Date(calc.endTime);
        }

        const results = [];
        const totalAmountAllPcs = perPcAmount * computerIds.length;

        // Helper to resolve PC identifier (e.g. "pc_1", 1, "PC-01")
        const resolvePcId = (rawId) => {
          if (typeof rawId === 'number') return `pc_${rawId}`;
          const str = String(rawId).trim();
          if (str.startsWith('pc_')) return str;
          const digits = str.replace(/\D/g, '');
          if (digits) return `pc_${parseInt(digits, 10)}`;
          return str;
        };

        // Agar CLIENT bo'lsa va balansdan to'lansa
        if (normalizedMode === 'CLIENT' && customerId && paymentType === 'BALANCE') {
          const clientRow = db.prepare('SELECT id, balance FROM users WHERE id = ?').get(customerId) 
            || db.prepare('SELECT id, balance FROM customers WHERE id = ?').get(customerId);
          if (!clientRow || clientRow.balance < totalAmountAllPcs) {
            sendJson(res, 400, {
              error: `Mijoz balansi (${clientRow?.balance || 0} UZS) jami guruh to'lovi (${totalAmountAllPcs} UZS) uchun yetarli emas.`
            });
            return;
          }
          db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalAmountAllPcs, clientRow.id);
          db.prepare(`
            INSERT INTO client_transactions (club_id, user_id, amount, type, payment_method)
            VALUES (?, ?, ?, 'SESSION_DEDUCT', 'BALANCE')
          `).run(clubId, clientRow.id, totalAmountAllPcs);
        }

        // Standart soatlik tarif
        const defaultTariff = db.prepare('SELECT id, name FROM tariffs WHERE club_id = ? ORDER BY price_per_hour ASC LIMIT 1').get(clubId)
          || db.prepare('SELECT id, name FROM tariffs ORDER BY price_per_hour ASC LIMIT 1').get();

        for (const rawId of computerIds) {
          const pcId = resolvePcId(rawId);
          const sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
          const notes = isPostpaid ? 'POSTPAID' : `BATCH_${normalizedMode}`;

          // 1. Sessiya (club_id bilan)
          db.prepare(`
            INSERT INTO sessions (id, club_id, computer_id, tariff_id, user_id, customer_name, started_at, ends_at, total_amount, paid_amount, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
          `).run(
            sessionId,
            clubId,
            pcId,
            defaultTariff?.id || 'trf_standard_1h',
            customerId || null,
            customerName,
            startedAt.toISOString(),
            endsAt.toISOString(),
            perPcAmount,
            isPostpaid ? 0 : perPcAmount,
            notes
          );

          // 2. Tranzaksiya (club_id bilan)
          if (!isPostpaid && perPcAmount > 0) {
            const validPayType = ['CASH', 'CARD', 'CLICK', 'PAYME'].includes(paymentType) ? paymentType : 'CASH';
            db.prepare(`
              INSERT INTO transactions (id, club_id, session_id, amount, payment_type, payment_method, transaction_type, created_by)
              VALUES (?, ?, ?, ?, ?, ?, 'PREPAID', ?)
            `).run(`tx_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`, clubId, sessionId, perPcAmount, validPayType, validPayType, String(currentUserId));
          }

          // 3. Kompyuter statusi
          const targetBatchPc = db.prepare('SELECT id, status, mac_address, name FROM computers WHERE id = ?').get(pcId);
          const wasBatchOffline = !targetBatchPc || targetBatchPc.status === 'OFFLINE';

          db.prepare(`
            UPDATE computers 
            SET status = 'OCCUPIED', current_session_id = ? 
            WHERE id = ?
          `).run(sessionId, pcId);

          if (wasBatchOffline && targetBatchPc && targetBatchPc.mac_address) {
            try {
              sendWakeOnLan(targetBatchPc.mac_address).catch(() => {});
              console.log(`⚡ [AutoWake] Guruh seansida o'chiq kompyuter (${targetBatchPc.name || pcId}) uchun WoL Magic Packet yuborildi.`);
            } catch {}
          }

          // 4. WebSocket signal Client Agent ga
          ClientManager.send(pcId, 'START_SESSION', {
            sessionId,
            tariffName: isPostpaid ? 'VIP Postpaid' : 'Guruh Seansi',
            startedAt: startedAt.getTime(),
            endsAt: endsAt.getTime(),
            remainingSeconds: isPostpaid ? -1 : Math.round(perPcDurationMins * 60),
            customerName,
            isPostpaid: !!isPostpaid
          });

          results.push({
            computerId: pcId,
            sessionId,
            status: 'STARTED'
          });
        }

        broadcastAdminUpdate();
        sendJson(res, 201, {
          success: true,
          mode: normalizedMode,
          count: results.length,
          startedComputersCount: results.length,
          perPcDurationMinutes: perPcDurationMins,
          perPcAmount,
          totalAmount: totalAmountAllPcs,
          isPostpaid,
          results
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Guruh seansini ochishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // CLIENT PREPAID BALANCE & TOPUP ENDPOINTS
  // ==========================================================================

  // POST /api/clients/topup — Kassir mijoz balansiga naqd/click orqali pul kiritishi (Tenant scoped)
  if (url.pathname === '/api/clients/topup' && req.method === 'POST') {
    if (!authenticate(req, res, { permission: 'customers:view' })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (data) => {
      try {
        const { userId, amount, paymentMethod = 'CASH' } = data;
        const numAmount = parseFloat(amount);

        if (!userId || isNaN(numAmount) || numAmount <= 0) {
          sendJson(res, 400, { error: 'Foydalanuvchi ID va to\'g\'ri summa kiritilishi shart.' });
          return;
        }

        const validMethod = ['CASH', 'CLICK', 'CARD'].includes(paymentMethod) ? paymentMethod : 'CASH';

        // 1. users jadvalida tekshirish (o'z klubi mijozimi)
        const user = req.user.role === 'superadmin'
          ? db.prepare('SELECT id, club_id, username, balance FROM users WHERE id = ?').get(userId)
          : db.prepare('SELECT id, club_id, username, balance FROM users WHERE id = ? AND club_id = ?').get(userId, clubId);

        if (!user) {
          sendJson(res, 404, { error: 'Bunday mijoz topilmadi.' });
          return;
        }

        const newBalance = Number(user.balance || 0) + numAmount;
        db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, userId);

        // 2. client_transactions ga yozish (club_id bilan)
        db.prepare(`
          INSERT INTO client_transactions (club_id, user_id, amount, type, payment_method)
          VALUES (?, ?, ?, 'TOPUP', ?)
        `).run(user.club_id || clubId, userId, numAmount, validMethod);

        // 3. Umumiy kassa tranzaksiyasiga ham kiritish (club_id bilan)
        db.prepare(`
          INSERT INTO transactions (id, club_id, session_id, amount, payment_type, created_by, notes)
          VALUES (?, ?, null, ?, ?, ?, ?)
        `).run(`tx_topup_${Date.now().toString(36)}`, user.club_id || clubId, numAmount, validMethod, String(currentUserId), `CLIENT_TOPUP:${user.username}`);

        broadcastAdminUpdate();
        sendJson(res, 200, {
          success: true,
          userId,
          username: user.username,
          addedAmount: numAmount,
          newBalance,
          paymentMethod: validMethod
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Balans to\'ldirishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // POST /api/clients/login-session — Klient kompyuteridan kelgan so'rov: login va parol bilan avtomatik o'z balansi hisobidan seans boshlash
  if (url.pathname === '/api/clients/login-session' && req.method === 'POST') {
    readBody(req, (data) => {
      try {
        const { computerId, username, password } = data;

        if (!computerId || !username || !password) {
          sendJson(res, 400, { error: 'computerId, username va password majburiy.' });
          return;
        }

        const pcId = String(computerId).startsWith('pc_') ? computerId : `pc_${computerId}`;
        const pc = db.prepare('SELECT * FROM computers WHERE id = ?').get(pcId);
        if (!pc) {
          sendJson(res, 404, { error: 'Kompyuter topilmadi.' });
          return;
        }

        if (pc.status === 'OCCUPIED') {
          sendJson(res, 400, { error: 'Ushbu kompyuter hozirda band.' });
          return;
        }

        const clubId = pc.club_id || 1;

        // Klub obunasini tekshirish
        const club = db.prepare('SELECT is_active, expires_at FROM clubs WHERE id = ?').get(clubId);
        if (club) {
          if (!club.is_active || new Date(club.expires_at).getTime() < Date.now()) {
            sendJson(res, 403, { error: 'Klub obuna muddati tugagan. Seans ochish imkonsiz.' });
            return;
          }
        }

        const user = db.prepare("SELECT * FROM users WHERE (username = ? OR phone_number = ?) AND role = 'client' AND (club_id = ? OR club_id IS NULL)").get(username, username, clubId);
        if (!user) {
          sendJson(res, 401, { error: 'Mijoz topilmadi yoki login noto\'g\'ri.' });
          return;
        }

        const isValid = verifyPassword(password, user.password_hash);
        if (!isValid) {
          sendJson(res, 401, { error: 'Parol noto\'g\'ri.' });
          return;
        }

        if (user.balance <= 0) {
          sendJson(res, 402, {
            error: `Balans yetarli emas. Joriy balansingiz: ${user.balance} UZS. Kassadan to'ldiring.`
          });
          return;
        }

        // Dinamik vaqt hisoblash (clubId bilan)
        const startedAt = new Date();
        const calcResult = calculateTimeFromAmount(startedAt, user.balance, false, clubId);

        if (calcResult.totalMinutes <= 0) {
          sendJson(res, 402, { error: 'Balansingiz 1 daqiqa o\'yin uchun ham yetarli emas.' });
          return;
        }

        const endsAt = new Date(startedAt.getTime() + calcResult.totalMinutes * 60 * 1000);
        const sessionId = `ses_${Date.now().toString(36)}`;
        const defaultTariff = db.prepare('SELECT id, name FROM tariffs WHERE club_id = ? ORDER BY price_per_hour ASC LIMIT 1').get(clubId)
          || db.prepare('SELECT id, name FROM tariffs ORDER BY price_per_hour ASC LIMIT 1').get();

        // 1. Sessiya yaratish (club_id bilan)
        db.prepare(`
          INSERT INTO sessions (id, club_id, computer_id, tariff_id, user_id, customer_name, started_at, ends_at, total_amount, paid_amount, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
        `).run(
          sessionId,
          clubId,
          pcId,
          defaultTariff?.id || 'trf_standard_1h',
          user.id,
          user.username,
          startedAt.toISOString(),
          endsAt.toISOString(),
          calcResult.totalAmount,
          calcResult.totalAmount,
          `CLIENT_BALANCE_LIVE:${user.id}`
        );

        // 2. Kompyuter holatini yangilash
        db.prepare(`
          UPDATE computers 
          SET status = 'OCCUPIED', current_session_id = ? 
          WHERE id = ?
        `).run(sessionId, pcId);

        // 3. WebSocket orqali Client Agent ga signallar
        ClientManager.send(pcId, 'CLIENT_LOGIN_SUCCESS', {
          sessionId,
          username: user.username,
          balance: user.balance,
          totalMinutes: calcResult.totalMinutes,
          endsAt: endsAt.getTime()
        });

        ClientManager.send(pcId, 'START_SESSION', {
          sessionId,
          tariffName: 'Mijoz Balansi',
          startedAt: startedAt.getTime(),
          endsAt: endsAt.getTime(),
          remainingSeconds: calcResult.totalMinutes * 60,
          customerName: user.username,
          isPostpaid: false,
          clientBalance: user.balance
        });

        broadcastAdminUpdate();
        logAuditEvent(clubId, null, 'SESSION_START', {
          sessionId,
          computerId: pcId,
          customerName: user.username,
          mode: 'CLIENT_BALANCE',
          durationMinutes: calcResult.totalMinutes,
          amount: calcResult.totalAmount,
          isPostpaid: false,
          tariffName: 'Mijoz Balansi'
        });

        sendJson(res, 200, {
          success: true,
          sessionId,
          username: user.username,
          balance: user.balance,
          durationMinutes: calcResult.totalMinutes,
          endsAt: endsAt.toISOString()
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Seansni boshlashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // BAR & BUFET REST API ENDPOINTS
  // ==========================================================================

  // 1. GET /api/bar/items & POST /api/bar/items
  if (url.pathname === '/api/bar/items' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);
    const category = url.searchParams.get('category');
    const showAll = url.searchParams.get('all') === '1' || url.searchParams.get('all') === 'true';

    try {
      let query = 'SELECT * FROM bar_items WHERE 1=1';
      const params = [];

      if (clubId !== null) {
        query += ' AND club_id = ?';
        params.push(clubId);
      }
      if (!showAll) {
        query += ' AND is_active = 1';
      }
      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }
      query += ' ORDER BY category ASC, name ASC';

      const items = db.prepare(query).all(...params);
      const formatted = items.map(item => ({
        id: item.id,
        clubId: item.club_id,
        name: item.name,
        category: item.category || 'DRINKS',
        buyPrice: Number(item.buy_price || 0),
        sellPrice: Number(item.sell_price || 0),
        stockQuantity: Number(item.stock_quantity || 0),
        isActive: Boolean(item.is_active),
        createdAt: item.created_at
      }));

      sendJson(res, 200, { success: true, items: formatted });
    } catch (err) {
      sendJson(res, 500, { error: 'Bar tovarlarini olishda xatolik: ' + err.message });
    }
    return;
  }

  if (url.pathname === '/api/bar/items' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const clubId = req.user.clubId || 1;

    readBody(req, (body) => {
      try {
        const finalName = String(body.name || '').trim();
        const finalCategory = String(body.category || 'DRINKS').toUpperCase();
        const finalBuy = parseFloat(body.buyPrice !== undefined ? body.buyPrice : (body.buy_price !== undefined ? body.buy_price : 0)) || 0;
        const finalSell = parseFloat(body.sellPrice !== undefined ? body.sellPrice : (body.sell_price !== undefined ? body.sell_price : 0)) || 0;
        const finalStock = parseInt(body.stockQuantity !== undefined ? body.stockQuantity : (body.stock_quantity !== undefined ? body.stock_quantity : 0), 10) || 0;
        const finalActive = (body.isActive !== undefined || body.is_active !== undefined) ? (Boolean(body.isActive ?? body.is_active) ? 1 : 0) : 1;

        if (!finalName || finalSell <= 0) {
          sendJson(res, 400, { error: 'Tovar nomi va sotish narxi kiritilishi shart.' });
          return;
        }

        const stmt = db.prepare(`
          INSERT INTO bar_items (club_id, name, category, buy_price, sell_price, stock_quantity, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(clubId, finalName, finalCategory, finalBuy, finalSell, finalStock, finalActive);
        const newItemId = Number(result.lastInsertRowid);

        broadcastAdminUpdate();
        sendJson(res, 201, {
          success: true,
          item: {
            id: newItemId,
            clubId,
            name: finalName,
            category: finalCategory,
            buyPrice: finalBuy,
            sellPrice: finalSell,
            stockQuantity: finalStock,
            isActive: Boolean(finalActive)
          }
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Tovar qo\'shishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 2. PUT /api/bar/items/:id & DELETE /api/bar/items/:id
  const barItemMatch = url.pathname.match(/^\/api\/bar\/items\/(\d+)$/);
  if (barItemMatch && req.method === 'PUT') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const targetId = parseInt(barItemMatch[1], 10);
    const clubId = getTenantClubId(req);

    readBody(req, (body) => {
      try {
        const { name, category, buyPrice, buy_price, sellPrice, sell_price, stockQuantity, stock_quantity, isActive, is_active } = body;
        const item = clubId === null
          ? db.prepare('SELECT * FROM bar_items WHERE id = ?').get(targetId)
          : db.prepare('SELECT * FROM bar_items WHERE id = ? AND club_id = ?').get(targetId, clubId);

        if (!item) {
          sendJson(res, 404, { error: 'Tovar topilmadi.' });
          return;
        }

        const newName = name !== undefined ? String(name).trim() : item.name;
        const newCategory = category !== undefined ? String(category).toUpperCase() : item.category;
        const newBuy = (buyPrice !== undefined || buy_price !== undefined) ? parseFloat(buyPrice ?? buy_price) : item.buy_price;
        const newSell = (sellPrice !== undefined || sell_price !== undefined) ? parseFloat(sellPrice ?? sell_price) : item.sell_price;
        const newStock = (stockQuantity !== undefined || stock_quantity !== undefined) ? parseInt(stockQuantity ?? stock_quantity, 10) : item.stock_quantity;
        const newActive = (isActive !== undefined || is_active !== undefined) ? (Boolean(isActive ?? is_active) ? 1 : 0) : item.is_active;

        db.prepare(`
          UPDATE bar_items 
          SET name = ?, category = ?, buy_price = ?, sell_price = ?, stock_quantity = ?, is_active = ?
          WHERE id = ?
        `).run(newName, newCategory, newBuy, newSell, newStock, newActive, targetId);

        broadcastAdminUpdate();
        sendJson(res, 200, {
          success: true,
          item: {
            id: targetId,
            clubId: item.club_id,
            name: newName,
            category: newCategory,
            buyPrice: Number(newBuy),
            sellPrice: Number(newSell),
            stockQuantity: Number(newStock),
            isActive: Boolean(newActive)
          }
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Tovarni yangilashda xatolik: ' + err.message });
      }
    });
    return;
  }

  if (barItemMatch && req.method === 'DELETE') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'] })) return;
    const targetId = parseInt(barItemMatch[1], 10);
    const clubId = getTenantClubId(req);

    try {
      if (clubId === null) {
        db.prepare('DELETE FROM bar_items WHERE id = ?').run(targetId);
      } else {
        db.prepare('DELETE FROM bar_items WHERE id = ? AND club_id = ?').run(targetId, clubId);
      }

      broadcastAdminUpdate();
      sendJson(res, 200, { success: true, deletedId: targetId });
    } catch (err) {
      sendJson(res, 500, { error: 'Tovarni o\'chirishda xatolik: ' + err.message });
    }
    return;
  }

  // 3. POST /api/bar/orders (Yangi savdo) & GET /api/bar/orders (Oxirgi sotuvlar)
  if (url.pathname === '/api/bar/orders' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    try {
      const orders = clubId === null
        ? db.prepare(`
            SELECT o.*,
              (SELECT json_group_array(json_object(
                'id', oi.id,
                'bar_item_id', oi.bar_item_id,
                'item_name', oi.item_name,
                'quantity', oi.quantity,
                'unit_price', oi.unit_price,
                'total_price', oi.total_price
              )) FROM bar_order_items oi WHERE oi.order_id = o.id) as items_json
            FROM bar_orders o
            ORDER BY o.id DESC LIMIT ?
          `).all(limit)
        : db.prepare(`
            SELECT o.*,
              (SELECT json_group_array(json_object(
                'id', oi.id,
                'bar_item_id', oi.bar_item_id,
                'item_name', oi.item_name,
                'quantity', oi.quantity,
                'unit_price', oi.unit_price,
                'total_price', oi.total_price
              )) FROM bar_order_items oi WHERE oi.order_id = o.id) as items_json
            FROM bar_orders o
            WHERE o.club_id = ?
            ORDER BY o.id DESC LIMIT ?
          `).all(clubId, limit);

      const formatted = orders.map(ord => {
        let items = [];
        try {
          items = JSON.parse(ord.items_json || '[]');
        } catch {}
        return {
          id: ord.id,
          clubId: ord.club_id,
          orderNumber: ord.order_number,
          computerId: ord.computer_id,
          sessionId: ord.session_id,
          userId: ord.user_id,
          totalAmount: Number(ord.total_amount || 0),
          paymentStatus: ord.payment_status,
          paymentMethod: ord.payment_method,
          createdAt: ord.created_at,
          items
        };
      });

      sendJson(res, 200, { success: true, orders: formatted });
    } catch (err) {
      sendJson(res, 500, { error: 'Buyurtmalarni olishda xatolik: ' + err.message });
    }
    return;
  }

  if (url.pathname === '/api/bar/orders' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (body) => {
      try {
        const {
          items = [],
          paymentMethod = 'CASH',
          paymentStatus = 'PAID',
          computerId = null,
          sessionId = null,
          userId = null
        } = body;

        if (!Array.isArray(items) || items.length === 0) {
          sendJson(res, 400, { error: 'Kamida bitta tovar tanlanishi shart.' });
          return;
        }

        const validPayMethod = ['CASH', 'CARD', 'CLIENT_BALANCE', 'ON_PC_SESSION'].includes(paymentMethod) ? paymentMethod : 'CASH';
        const validPayStatus = ['PAID', 'PENDING_AT_CHECKOUT', 'CANCELLED'].includes(paymentStatus) ? paymentStatus : 'PAID';

        db.exec('BEGIN TRANSACTION;');
        try {
          let calculatedTotal = 0;
          const processedItems = [];

          // 1. Tovar mavjudligi va qoldig'ini tekshirish
          for (const itemRequest of items) {
            const bItemId = parseInt(itemRequest.barItemId || itemRequest.id, 10);
            const reqQty = parseInt(itemRequest.quantity || itemRequest.count || 1, 10);

            if (!bItemId || reqQty <= 0) {
              throw new Error('Noto\'g\'ri tovar yoki miqdor tanlangan.');
            }

            const barProduct = db.prepare('SELECT * FROM bar_items WHERE id = ? AND club_id = ?').get(bItemId, clubId);
            if (!barProduct) {
              throw new Error(`ID=${bItemId} tovar topilmadi.`);
            }

            if (barProduct.stock_quantity < reqQty) {
              throw new Error(`Omborda yetarli mahsulot yo'q: "${barProduct.name}" (Qoldiq: ${barProduct.stock_quantity} dona, so'raldi: ${reqQty} dona).`);
            }

            const unitPrice = Number(barProduct.sell_price);
            const lineTotal = unitPrice * reqQty;
            calculatedTotal += lineTotal;

            processedItems.push({
              barItemId: bItemId,
              itemName: barProduct.name,
              quantity: reqQty,
              unitPrice,
              totalPrice: lineTotal
            });
          }

          // 2. Agar CLIENT_BALANCE orqali to'lanayotgan bo'lsa, mijoz balansini tekshirish va yechish
          if (validPayMethod === 'CLIENT_BALANCE' && validPayStatus === 'PAID') {
            if (!userId) {
              throw new Error('Mijoz ID kiritilishi shart.');
            }
            const userRow = db.prepare('SELECT balance FROM users WHERE id = ? AND club_id = ?').get(userId, clubId);
            if (!userRow || Number(userRow.balance) < calculatedTotal) {
              throw new Error(`Mijoz balansi (${userRow?.balance || 0} UZS) to'lov uchun yetarli emas (${calculatedTotal} UZS).`);
            }
            db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(calculatedTotal, userId);
            db.prepare(`
              INSERT INTO client_transactions (club_id, user_id, amount, type, payment_method)
              VALUES (?, ?, ?, 'SESSION_DEDUCT', 'BALANCE')
            `).run(clubId, userId, calculatedTotal);
          }

          // 3. Ombor qoldiqlarini kamaytirish (stock_quantity = stock_quantity - quantity)
          const updateStockStmt = db.prepare('UPDATE bar_items SET stock_quantity = stock_quantity - ? WHERE id = ?');
          for (const pItem of processedItems) {
            updateStockStmt.run(pItem.quantity, pItem.barItemId);
          }

          // 4. bar_orders jadvaliga yozish
          const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
          
          let targetSessionId = sessionId;
          let targetCompNum = computerId ? parseInt(String(computerId).replace(/\D/g, ''), 10) : null;
          let effectivePayStatus = validPayStatus;

          if (validPayMethod === 'ON_PC_SESSION') {
            effectivePayStatus = 'PENDING_AT_CHECKOUT';
            if (!targetSessionId && (computerId || targetCompNum)) {
              const pcRow = db.prepare('SELECT current_session_id, pc_number FROM computers WHERE id = ? OR pc_number = ?').get(computerId, targetCompNum);
              if (pcRow) {
                targetSessionId = pcRow.current_session_id || null;
                targetCompNum = pcRow.pc_number;
              }
            }
          }

          const insertOrderStmt = db.prepare(`
            INSERT INTO bar_orders (club_id, order_number, computer_id, session_id, user_id, total_amount, payment_status, payment_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const orderRes = insertOrderStmt.run(clubId, orderNum, targetCompNum, targetSessionId, userId || null, calculatedTotal, effectivePayStatus, validPayMethod);
          const orderId = Number(orderRes.lastInsertRowid);

          // 5. bar_order_items jadvaliga har bir tovar tarkibini yozish
          const insertItemStmt = db.prepare(`
            INSERT INTO bar_order_items (order_id, bar_item_id, item_name, quantity, unit_price, total_price)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (const pItem of processedItems) {
            insertItemStmt.run(orderId, pItem.barItemId, pItem.itemName, pItem.quantity, pItem.unitPrice, pItem.totalPrice);
          }

          // 6. Kassa tranzaksiyasiga kiritish (agar naqd yoki karta bilan PAID bo'lsa)
          if (effectivePayStatus === 'PAID' && (validPayMethod === 'CASH' || validPayMethod === 'CARD')) {
            db.prepare(`
              INSERT INTO transactions (id, club_id, session_id, amount, payment_type, created_by, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(`tx_bar_${Date.now().toString(36)}`, clubId, targetSessionId, calculatedTotal, validPayMethod, String(currentUserId), `BAR_SALE:${orderNum}`);
          }

          // 7. Agar kompyuter seansiga (ON_PC_SESSION) yozilgan bo'lsa, sessiyaga qo'shish
          if (validPayMethod === 'ON_PC_SESSION' && targetSessionId) {
            db.prepare(`
              UPDATE sessions 
              SET total_amount = total_amount + ?, notes = notes || ' | BAR:' || ? 
              WHERE id = ?
            `).run(calculatedTotal, orderNum, targetSessionId);
          }

          db.exec('COMMIT;');

          // 8. Tizim auditiga yozish va WebSocket orqali Real-Time uzatish
          logAuditEvent(clubId, null, 'BAR_SALE', {
            orderId,
            orderNumber: orderNum,
            totalAmount: calculatedTotal,
            paymentMethod: validPayMethod,
            paymentStatus: validPayStatus,
            computerId,
            sessionId,
            itemsCount: processedItems.length,
            items: processedItems.map(i => `${i.itemName} x${i.quantity}`)
          });

          broadcastAdminUpdate();

          sendJson(res, 201, {
            success: true,
            order: {
              id: orderId,
              orderNumber: orderNum,
              totalAmount: calculatedTotal,
              paymentMethod: validPayMethod,
              paymentStatus: validPayStatus,
              computerId,
              sessionId,
              items: processedItems
            }
          });
        } catch (txErr) {
          try { db.exec('ROLLBACK;'); } catch (_) {}
          throw txErr;
        }
      } catch (err) {
        sendJson(res, 400, { error: 'Bar buyurtmasini yaratishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 3b. POST /api/bar/orders/confirm (Mijozning bar buyurtmasini tasdiqlash)
  if (url.pathname === '/api/bar/orders/confirm' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (body) => {
      try {
        const { orderId, orderNumber, pcNumber } = body;
        const order = db.prepare('SELECT * FROM bar_orders WHERE (id = ? OR order_number = ?) AND (club_id = ? OR club_id IS NULL)').get(orderId, orderNumber, clubId);

        if (!order) {
          sendJson(res, 404, { error: 'Buyurtma topilmadi.' });
          return;
        }

        db.exec('BEGIN TRANSACTION;');
        try {
          // 1. To'lov usuliga qarab sessiya yoki kassa hisobiga yozish
          let pcNum = order.computer_id;
          if (!pcNum && pcNumber) {
            const m = String(pcNumber).match(/\d+/);
            if (m) pcNum = parseInt(m[0], 10);
          }

          const pcRow = db.prepare('SELECT id, current_session_id, pc_number FROM computers WHERE pc_number = ? OR id = ?').get(pcNum, `pc_${pcNum}`);
          const activeSessionId = order.session_id || pcRow?.current_session_id;

          if (order.payment_method === 'ON_PC_SESSION') {
            db.prepare("UPDATE bar_orders SET payment_status = 'PENDING_AT_CHECKOUT' WHERE id = ?").run(order.id);
            if (activeSessionId) {
              db.prepare(`
                UPDATE sessions 
                SET total_amount = total_amount + ?, notes = COALESCE(notes, '') || ' | BAR:' || ?
                WHERE id = ?
              `).run(order.total_amount, order.order_number, activeSessionId);
            }
          } else if (order.payment_method === 'FROM_MEMBER_BALANCE') {
            db.prepare("UPDATE bar_orders SET payment_status = 'PAID' WHERE id = ?").run(order.id);
            if (order.user_id) {
              db.prepare('UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?').run(order.total_amount, order.user_id);
              db.prepare(`
                INSERT INTO client_transactions (club_id, user_id, amount, type, payment_method)
                VALUES (?, ?, ?, 'SESSION_DEDUCT', 'BALANCE')
              `).run(clubId, order.user_id, order.total_amount);
            }
          } else {
            // CASH / CARD
            db.prepare("UPDATE bar_orders SET payment_status = 'PAID' WHERE id = ?").run(order.id);
            db.prepare(`
              INSERT INTO transactions (id, club_id, session_id, amount, payment_type, created_by, notes)
              VALUES (?, ?, ?, ?, 'CASH', ?, ?)
            `).run(`tx_bar_${Date.now().toString(36)}`, clubId, activeSessionId, order.total_amount, String(currentUserId), `BAR_SALE:${order.order_number}`);
          }

          // 2. Ombor (sklad) qoldiqlarini kamaytirish
          const orderItems = db.prepare('SELECT * FROM bar_order_items WHERE order_id = ?').all(order.id);
          for (const it of orderItems) {
            if (it.bar_item_id && it.bar_item_id > 0) {
              db.prepare('UPDATE bar_items SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?').run(it.quantity, it.bar_item_id);
            } else if (it.item_name) {
              db.prepare('UPDATE bar_items SET stock_quantity = MAX(0, stock_quantity - ?) WHERE name LIKE ?').run(it.quantity, `%${it.item_name}%`);
            }
          }

          db.exec('COMMIT;');

          // 3. PC-04 ga WebSocket orqali "Buyurtmangiz tasdiqlandi, eltib berilmoqda!" xabari yuboriladi
          const targetPcId = pcRow?.id || `pc_${pcNum}`;
          const targetPcDisplay = `PC-${String(pcNum).padStart(2, '0')}`;

          ClientManager.send(targetPcId, 'BAR_ORDER_CONFIRMED', {
            orderId: order.id,
            orderNumber: order.order_number,
            pcNumber: targetPcDisplay,
            message: 'Buyurtmangiz tasdiqlandi, eltib berilmoqda!'
          });

          ClientManager.broadcast('BAR_ORDER_STATUS_CHANGED', {
            orderId: order.id,
            orderNumber: order.order_number,
            status: 'CONFIRMED',
            pcNumber: targetPcDisplay,
            message: 'Buyurtmangiz tasdiqlandi, eltib berilmoqda!'
          });

          logAuditEvent(clubId, null, 'BAR_SALE', {
            orderId: order.id,
            orderNumber: order.order_number,
            pcNumber: targetPcDisplay,
            totalAmount: order.total_amount,
            status: 'CONFIRMED'
          });

          broadcastAdminUpdate();

          sendJson(res, 200, {
            success: true,
            message: 'Buyurtma muvaffaqiyatli tasdiqlandi va hisobga qo\'shildi.',
            orderNumber: order.order_number
          });
        } catch (txErr) {
          try { db.exec('ROLLBACK;'); } catch (_) {}
          throw txErr;
        }
      } catch (err) {
        sendJson(res, 400, { error: 'Buyurtmani tasdiqlashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 3c. POST /api/bar/orders/reject (Mijozning bar buyurtmasini rad etish)
  if (url.pathname === '/api/bar/orders/reject' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const clubId = req.user.clubId || 1;

    readBody(req, (body) => {
      try {
        const { orderId, orderNumber, pcNumber, reason = 'Mahsulot tugagan' } = body;
        const order = db.prepare('SELECT * FROM bar_orders WHERE (id = ? OR order_number = ?) AND (club_id = ? OR club_id IS NULL)').get(orderId, orderNumber, clubId);

        if (order) {
          db.prepare("UPDATE bar_orders SET payment_status = 'CANCELLED' WHERE id = ?").run(order.id);
        }

        let pcNum = order?.computer_id;
        if (!pcNum && pcNumber) {
          const m = String(pcNumber).match(/\d+/);
          if (m) pcNum = parseInt(m[0], 10);
        }

        const targetPcId = `pc_${pcNum || 1}`;
        const targetPcDisplay = `PC-${String(pcNum || 1).padStart(2, '0')}`;

        // Mijoz ekranida buyurtma bekor bo'lgani haqida xabar chiqadi
        ClientManager.send(targetPcId, 'BAR_ORDER_REJECTED', {
          orderId: order?.id || orderId,
          orderNumber: order?.order_number || orderNumber,
          pcNumber: targetPcDisplay,
          reason
        });

        ClientManager.broadcast('BAR_ORDER_STATUS_CHANGED', {
          orderId: order?.id || orderId,
          orderNumber: order?.order_number || orderNumber,
          status: 'REJECTED',
          pcNumber: targetPcDisplay,
          reason
        });

        broadcastAdminUpdate();

        sendJson(res, 200, {
          success: true,
          message: 'Buyurtma rad etildi va mijozga xabar berildi.'
        });
      } catch (err) {
        sendJson(res, 400, { error: 'Buyurtmani rad etishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // BOOKINGS (BAND QILISHLAR) REST API ENDPOINTS
  // ==========================================================================

  // 4. GET /api/bookings & POST /api/bookings
  if (url.pathname === '/api/bookings' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);

    try {
      const bookings = clubId === null
        ? db.prepare(`
            SELECT b.*, c.name as computer_name, c.pc_number
            FROM bookings b
            LEFT JOIN computers c ON (b.computer_id = c.pc_number OR b.computer_id = c.id) AND (c.club_id = b.club_id)
            ORDER BY b.start_time ASC
          `).all()
        : db.prepare(`
            SELECT b.*, c.name as computer_name, c.pc_number
            FROM bookings b
            LEFT JOIN computers c ON (b.computer_id = c.pc_number OR b.computer_id = c.id) AND (c.club_id = b.club_id)
            WHERE b.club_id = ?
            ORDER BY b.start_time ASC
          `).all(clubId);

      const formatted = bookings.map(b => ({
        id: b.id,
        clubId: b.club_id,
        computerId: b.computer_id,
        computerName: b.computer_name || `PC-${b.computer_id}`,
        pcNumber: b.pc_number || b.computer_id,
        userId: b.user_id,
        customerName: b.customer_name || 'Noma\'lum',
        customerPhone: b.customer_phone || '',
        startTime: b.start_time,
        endTime: b.end_time,
        note: b.note || '',
        status: b.status || 'CONFIRMED',
        createdBy: b.created_by,
        createdAt: b.created_at
      }));

      sendJson(res, 200, { success: true, bookings: formatted });
    } catch (err) {
      sendJson(res, 500, { error: 'Bronlarni olishda xatolik: ' + err.message });
    }
    return;
  }

  if (url.pathname === '/api/bookings' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (body) => {
      try {
        const {
          computerId,
          computer_id,
          customerName,
          customer_name,
          customerPhone,
          customer_phone,
          startTime,
          start_time,
          endTime,
          end_time,
          note = '',
          status = 'CONFIRMED'
        } = body;

        const rawPc = computerId ?? computer_id;
        const targetPc = typeof rawPc === 'number' ? rawPc : parseInt(String(rawPc).replace(/\D/g, ''), 10);
        const name = String(customerName ?? customer_name ?? '').trim();
        const phone = String(customerPhone ?? customer_phone ?? '').trim();
        const start = startTime ?? start_time;
        const end = endTime ?? end_time;

        if (!targetPc || !name || !start || !end) {
          sendJson(res, 400, { error: 'Kompyuter, mijoz ismi, boshlanish va tugash vaqti talab qilinadi.' });
          return;
        }

        // Vaqt to'qnashuvini tekshirish (Overlap conflict check)
        const conflict = db.prepare(`
          SELECT b.*, c.name as computer_name 
          FROM bookings b
          LEFT JOIN computers c ON (b.computer_id = c.pc_number OR b.computer_id = c.id) AND c.club_id = b.club_id
          WHERE b.club_id = ? 
            AND (b.computer_id = ? OR b.computer_id = ?)
            AND b.status IN ('CONFIRMED', 'PENDING')
            AND NOT (b.end_time <= ? OR b.start_time >= ?)
          LIMIT 1
        `).get(clubId, targetPc, `pc_${targetPc}`, start, end);

        if (conflict) {
          sendJson(res, 409, {
            error: `To'qnashuv! Ushbu vaqt oralig'ida (${conflict.start_time} — ${conflict.end_time}) ${conflict.computer_name || ('PC-' + targetPc)} allaqachon bron qilingan: "${conflict.customer_name}"!`
          });
          return;
        }

        const validStatus = ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'PENDING'].includes(status) ? status : 'CONFIRMED';

        const stmt = db.prepare(`
          INSERT INTO bookings (club_id, computer_id, customer_name, customer_phone, start_time, end_time, note, status, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(clubId, targetPc, name, phone, start, end, note, validStatus, String(currentUserId));
        const newBookingId = Number(result.lastInsertRowid);

        broadcastAdminUpdate();
        sendJson(res, 201, {
          success: true,
          booking: {
            id: newBookingId,
            clubId,
            computerId: targetPc,
            customerName: name,
            customerPhone: phone,
            startTime: start,
            endTime: end,
            note,
            status: validStatus
          }
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Bron yaratishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 5a. PATCH /api/bookings/:id/status (Bron holatini o'zgartirish)
  const bookingStatusMatch = url.pathname.match(/^\/api\/bookings\/(\d+)\/status$/);
  if (bookingStatusMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const targetId = parseInt(bookingStatusMatch[1], 10);
    const clubId = getTenantClubId(req);

    readBody(req, (data) => {
      try {
        const { status } = data;
        const validStatuses = ['CONFIRMED', 'PENDING', 'CANCELLED', 'COMPLETED', 'ACTIVE'];
        if (!validStatuses.includes(status)) {
          sendJson(res, 400, { error: 'Noto\'g\'ri status: ' + status });
          return;
        }

        if (clubId === null) {
          db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, targetId);
        } else {
          db.prepare('UPDATE bookings SET status = ? WHERE id = ? AND club_id = ?').run(status, targetId, clubId);
        }

        broadcastAdminUpdate();
        sendJson(res, 200, { success: true, id: targetId, status });
      } catch (err) {
        sendJson(res, 500, { error: 'Statusni yangilashda xatolik: ' + err.message });
      }
    });
    return;
  }

  // 5. DELETE /api/bookings/:id
  const bookingMatch = url.pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (bookingMatch && req.method === 'DELETE') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const targetId = parseInt(bookingMatch[1], 10);
    const clubId = getTenantClubId(req);

    try {
      if (clubId === null) {
        db.prepare('DELETE FROM bookings WHERE id = ?').run(targetId);
      } else {
        db.prepare('DELETE FROM bookings WHERE id = ? AND club_id = ?').run(targetId, clubId);
      }

      broadcastAdminUpdate();
      sendJson(res, 200, { success: true, deletedId: targetId });
    } catch (err) {
      sendJson(res, 500, { error: 'Bronni o\'chirishda xatolik: ' + err.message });
    }
    return;
  }

  // ==========================================================================
  // AUDIT LOGS (VOQEALAR LENTASI) REST API
  // ==========================================================================

  // 6. GET /api/audit-logs
  if (url.pathname === '/api/audit-logs' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const shiftIdParam = url.searchParams.get('shiftId');

    try {
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];

      if (clubId !== null) {
        query += ' AND club_id = ?';
        params.push(clubId);
      }

      if (shiftIdParam) {
        query += ' AND shift_id = ?';
        params.push(parseInt(shiftIdParam, 10));
      } else if (clubId !== null) {
        // Agar shiftId berilmagan bo'lsa, ochiq smenadagi voqealarni olishga harakat qilamiz
        const openShift = getOpenShift(clubId);
        if (openShift) {
          query += ' AND (shift_id = ? OR shift_id IS NULL)';
          params.push(openShift.id);
        }
      }

      query += ' ORDER BY id DESC LIMIT ?';
      params.push(limit);

      const logs = db.prepare(query).all(...params);
      const formatted = logs.map(l => {
        let details = {};
        try {
          details = JSON.parse(l.details || '{}');
        } catch {
          details = { raw: l.details };
        }
        return {
          id: l.id,
          clubId: l.club_id,
          shiftId: l.shift_id,
          eventType: l.event_type,
          details,
          createdAt: l.created_at
        };
      });

      sendJson(res, 200, { success: true, logs: formatted });
    } catch (err) {
      sendJson(res, 500, { error: 'Audit tarixini olishda xatolik: ' + err.message });
    }
    return;
  }

  // ==========================================================================
  // SHIFTS (KASSA SMENALARI) REST API
  // ==========================================================================

  // 7. GET /api/shifts/current & POST /api/shifts/current
  if (url.pathname === '/api/shifts/current' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = req.user.clubId || 1;

    try {
      const openShift = db.prepare('SELECT * FROM shifts WHERE club_id = ? AND is_closed = 0 ORDER BY opened_at DESC LIMIT 1').get(clubId);

      if (!openShift) {
        const lastClosed = db.prepare('SELECT * FROM shifts WHERE club_id = ? AND is_closed = 1 ORDER BY closed_at DESC LIMIT 1').get(clubId);
        sendJson(res, 200, {
          success: true,
          hasOpenShift: false,
          shift: null,
          lastClosedShift: lastClosed ? {
            id: lastClosed.id,
            openedAt: lastClosed.opened_at,
            closedAt: lastClosed.closed_at,
            startCash: Number(lastClosed.start_cash || 0),
            endCash: Number(lastClosed.end_cash || 0),
            systemCash: Number(lastClosed.system_cash || 0),
            systemCard: Number(lastClosed.system_card || 0)
          } : null
        });
        return;
      }

      // Jonli hisob-kitoblar (ochilgan vaqtdan buyon)
      const cashRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions
        WHERE club_id = ? AND (payment_type = 'CASH' OR payment_method = 'CASH') AND created_at >= ?
      `).get(clubId, openShift.opened_at);

      const cardRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions
        WHERE club_id = ? AND (payment_type IN ('CARD', 'CLICK', 'PAYME') OR payment_method IN ('CARD', 'CLICK', 'PAYME')) AND created_at >= ?
      `).get(clubId, openShift.opened_at);

      const barRow = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders
        WHERE club_id = ? AND payment_status = 'PAID' AND created_at >= ?
      `).get(clubId, openShift.opened_at);

      // Bardan klientlar o'tirgan stollaridan (PC sessiyalaridan) tushgan pul
      const barInSessionRow = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders
        WHERE club_id = ? AND payment_status = 'PAID' AND created_at >= ?
          AND (payment_method = 'ON_PC_SESSION' OR session_id IS NOT NULL OR computer_id IS NOT NULL)
      `).get(clubId, openShift.opened_at);

      // Bardan to'g'ridan-to'g'ri (kassadan stolsiz) tushgan pul
      const barDirectRow = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders
        WHERE club_id = ? AND payment_status = 'PAID' AND created_at >= ?
          AND (computer_id IS NULL AND (session_id IS NULL OR session_id = ''))
      `).get(clubId, openShift.opened_at);

      // O'yin seanslaridan tushum (Prepaid & Postpaid)
      const gameRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions
        WHERE club_id = ? AND created_at >= ?
          AND (transaction_type IN ('PREPAID', 'POSTPAID_SETTLEMENT') OR (notes IS NULL OR (notes NOT LIKE 'BAR_SALE%' AND notes NOT LIKE 'CLIENT_TOPUP%' AND notes NOT LIKE '%REFUND%')))
      `).get(clubId, openShift.opened_at);

      const sessionsRow = db.prepare(`
        SELECT COUNT(*) as count FROM sessions
        WHERE club_id = ? AND started_at >= ?
      `).get(clubId, openShift.opened_at);

      const systemCash = Number(cashRow?.total || 0);
      const systemCard = Number(cardRow?.total || 0);
      const totalBarSales = Number(barRow?.total || 0);
      const barInSessionSales = Number(barInSessionRow?.total || 0);
      const barDirectSales = Number(barDirectRow?.total || 0);
      const gameRevenue = Number(gameRow?.total || 0);
      const sessionsCount = Number(sessionsRow?.count || 0);
      const startCash = Number(openShift.start_cash || 0);
      const expectedCash = startCash + systemCash;

      sendJson(res, 200, {
        success: true,
        hasOpenShift: true,
        shift: {
          id: openShift.id,
          clubId: openShift.club_id,
          openedByUserId: openShift.opened_by_user_id,
          openedAt: openShift.opened_at,
          startCash,
          systemCash,
          systemCard,
          gameRevenue,
          totalBarSales,
          barInSessionSales,
          barDirectSales,
          sessionsCount,
          expectedCash,
          totalRevenue: systemCash + systemCard
        }
      });
    } catch (err) {
      sendJson(res, 500, { error: 'Smena ma\'lumotlarini olishda xatolik: ' + err.message });
    }
    return;
  }

  if (url.pathname === '/api/shifts/current' && req.method === 'POST') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner', 'administrator'] })) return;
    const currentUserId = req.user.id;
    const clubId = req.user.clubId || 1;

    readBody(req, (body) => {
      try {
        const { action = 'open', startCash = 0, start_cash, endCash = 0, end_cash } = body;
        const normalizedAction = String(action).toLowerCase();

        if (normalizedAction === 'open') {
          // Ochiq smena bor-yo'qligini tekshirish
          const existingOpen = db.prepare('SELECT id FROM shifts WHERE club_id = ? AND is_closed = 0').get(clubId);
          if (existingOpen) {
            sendJson(res, 400, { error: 'Ochiq smena allaqachon mavjud. Avval uni yoping.' });
            return;
          }

          const finalStartCash = parseFloat(startCash ?? start_cash ?? 0) || 0;
          const stmt = db.prepare(`
            INSERT INTO shifts (club_id, opened_by_user_id, start_cash, is_closed)
            VALUES (?, ?, ?, 0)
          `);
          const result = stmt.run(clubId, currentUserId, finalStartCash);
          const newShiftId = Number(result.lastInsertRowid);

          broadcastAdminUpdate();
          sendJson(res, 201, {
            success: true,
            shift: {
              id: newShiftId,
              clubId,
              openedByUserId: currentUserId,
              openedAt: new Date().toISOString(),
              startCash: finalStartCash,
              isClosed: false
            }
          });
          return;
        } else if (normalizedAction === 'close') {
          const openShift = db.prepare('SELECT * FROM shifts WHERE club_id = ? AND is_closed = 0 ORDER BY opened_at DESC LIMIT 1').get(clubId);
          if (!openShift) {
            sendJson(res, 400, { error: 'Yopish uchun ochiq smena topilmadi.' });
            return;
          }

          // Kassa va kartalarni hisoblash
          const cashRow = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total FROM transactions
            WHERE club_id = ? AND (payment_type = 'CASH' OR payment_method = 'CASH') AND created_at >= ?
          `).get(clubId, openShift.opened_at);

          const cardRow = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total FROM transactions
            WHERE club_id = ? AND (payment_type IN ('CARD', 'CLICK', 'PAYME') OR payment_method IN ('CARD', 'CLICK', 'PAYME')) AND created_at >= ?
          `).get(clubId, openShift.opened_at);

          const finalSystemCash = Number(cashRow?.total || 0);
          const finalSystemCard = Number(cardRow?.total || 0);
          const finalEndCash = parseFloat(endCash ?? end_cash ?? 0) || 0;

          db.prepare(`
            UPDATE shifts 
            SET closed_at = CURRENT_TIMESTAMP, end_cash = ?, system_cash = ?, system_card = ?, is_closed = 1
            WHERE id = ?
          `).run(finalEndCash, finalSystemCash, finalSystemCard, openShift.id);

          broadcastAdminUpdate();
          sendJson(res, 200, {
            success: true,
            closedShift: {
              id: openShift.id,
              openedAt: openShift.opened_at,
              closedAt: new Date().toISOString(),
              startCash: Number(openShift.start_cash || 0),
              endCash: finalEndCash,
              systemCash: finalSystemCash,
              systemCard: finalSystemCard,
              cashDifference: finalEndCash - (Number(openShift.start_cash || 0) + finalSystemCash)
            }
          });
          return;
        } else {
          sendJson(res, 400, { error: `Noma'lum amal: "${action}". "open" yoki "close" bo'lishi kerak.` });
          return;
        }
      } catch (err) {
        sendJson(res, 500, { error: 'Smenani boshqarishda xatolik: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // FINANCIAL REPORTS & ANALYTICS REST API ENDPOINTS
  // ==========================================================================

  // 1. GET /api/reports & /api/reports/financial (Sana va Oraliq bo'yicha batafsil moliyaviy hisobot va Audit Jurnali)
  if ((url.pathname === '/api/reports' || url.pathname === '/api/reports/financial') && req.method === 'GET') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'] })) return;
    const clubId = getTenantClubId(req);

    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      const dateParam = url.searchParams.get('date');
      const fromParam = dateParam || url.searchParams.get('from') || todayStr;
      const toParam = dateParam || url.searchParams.get('to') || todayStr;
      const categoryParam = url.searchParams.get('category') || null;
      const searchParam = url.searchParams.get('search') || null;

      // BarLedgerService orqali to'liq moliyaviy integratsiya va kassa hisoboti
      const ledgerReport = BarLedgerService.getDailyFinancialReport({
        fromDate: fromParam,
        toDate: toParam,
        clubId
      });

      const { summary, topSellingItems } = ledgerReport;

      // 1.4 O'ZGARMAS AUDIT JURNALI (Immutable Audit Trail)
      const auditTrail = getAuditTrail({
        clubId,
        fromDate: fromParam,
        toDate: toParam,
        category: categoryParam,
        search: searchParam,
        limit: 1000
      });

      // 1.5 Detallashtirilgan Jadval 1: Barcha yopilgan va faol o'yin seanslari
      const sessionsQuery = clubId === null
        ? db.prepare(`
            SELECT s.*, c.name as computer_name, c.pc_number, c.zone,
                   (SELECT tx.payment_type FROM transactions tx WHERE tx.session_id = s.id ORDER BY tx.created_at ASC LIMIT 1) as tx_payment_type
            FROM sessions s
            LEFT JOIN computers c ON (s.computer_id = c.id OR s.computer_id = c.pc_number)
            WHERE substr(s.started_at, 1, 10) >= ? AND substr(s.started_at, 1, 10) <= ?
            ORDER BY s.started_at DESC
          `).all(fromParam, toParam)
        : db.prepare(`
            SELECT s.*, c.name as computer_name, c.pc_number, c.zone,
                   (SELECT tx.payment_type FROM transactions tx WHERE tx.session_id = s.id ORDER BY tx.created_at ASC LIMIT 1) as tx_payment_type
            FROM sessions s
            LEFT JOIN computers c ON (s.computer_id = c.id OR s.computer_id = c.pc_number)
            WHERE s.club_id = ?
              AND substr(s.started_at, 1, 10) >= ? AND substr(s.started_at, 1, 10) <= ?
            ORDER BY s.started_at DESC
          `).all(clubId, fromParam, toParam);

      const formattedSessions = sessionsQuery.map(s => {
        let durationMins = 0;
        if (s.started_at && s.ends_at) {
          const st = new Date(s.started_at).getTime();
          const et = new Date(s.ends_at).getTime();
          durationMins = Math.max(1, Math.round((et - st) / 60000));
        }
        const isMember = Boolean(s.user_id || (s.notes && s.notes.includes('CLIENT_BALANCE_LIVE')));
        const payType = s.tx_payment_type || (s.notes && s.notes.includes('CLIENT_BALANCE') ? 'BALANS' : (s.notes && s.notes.includes('POSTPAID') ? 'POSTPAID' : 'NAQD'));
        return {
          id: s.id,
          computerName: s.computer_name || (s.computer_id ? `PC-${s.computer_id}` : 'PC-??'),
          zone: s.zone || 'STANDARD',
          customerName: s.customer_name || 'Mehmon',
          customerType: isMember ? 'Akkaunt / A\'zo' : 'Oddiy mijoz',
          isMember,
          startedAt: s.started_at,
          endsAt: s.ends_at,
          durationMinutes: durationMins,
          paymentType: payType,
          totalAmount: Number(s.total_amount || 0),
          status: s.status,
          notes: s.notes || ''
        };
      });

      // 1.6 Detallashtirilgan Jadval 2: Barda sotilgan mahsulotlar
      const barSalesQuery = clubId === null
        ? db.prepare(`
            SELECT boi.id, boi.order_id, boi.bar_item_id, boi.item_name, boi.quantity, boi.unit_price, boi.total_price,
                   bo.order_number, bo.computer_id, bo.payment_method, bo.payment_status, bo.created_at,
                   bi.category
            FROM bar_order_items boi
            JOIN bar_orders bo ON bo.id = boi.order_id
            LEFT JOIN bar_items bi ON bi.id = boi.bar_item_id
            WHERE substr(bo.created_at, 1, 10) >= ? AND substr(bo.created_at, 1, 10) <= ?
            ORDER BY bo.created_at DESC
          `).all(fromParam, toParam)
        : db.prepare(`
            SELECT boi.id, boi.order_id, boi.bar_item_id, boi.item_name, boi.quantity, boi.unit_price, boi.total_price,
                   bo.order_number, bo.computer_id, bo.payment_method, bo.payment_status, bo.created_at,
                   bi.category
            FROM bar_order_items boi
            JOIN bar_orders bo ON bo.id = boi.order_id
            LEFT JOIN bar_items bi ON bi.id = boi.bar_item_id
            WHERE bo.club_id = ?
              AND substr(bo.created_at, 1, 10) >= ? AND substr(bo.created_at, 1, 10) <= ?
            ORDER BY bo.created_at DESC
          `).all(clubId, fromParam, toParam);

      const formattedBarSales = barSalesQuery.map(b => ({
        id: b.id,
        orderId: b.order_id,
        orderNumber: b.order_number,
        itemName: b.item_name,
        category: b.category || 'DRINKS',
        quantity: Number(b.quantity || 1),
        unitPrice: Number(b.unit_price || 0),
        totalPrice: Number(b.total_price || 0),
        target: b.computer_id ? `PC-${b.computer_id}` : 'Alohida (Stolsiz)',
        paymentMethod: b.payment_method || 'CASH',
        paymentStatus: b.payment_status || 'PAID',
        createdAt: b.created_at
      }));

      // 1.7 Detallashtirilgan Jadval 3: Smenalar ro'yxati
      const shiftsQuery = clubId === null
        ? db.prepare(`
            SELECT sh.*, u.username as cashier_name
            FROM shifts sh
            LEFT JOIN users u ON sh.opened_by_user_id = u.id
            WHERE substr(sh.opened_at, 1, 10) >= ? AND substr(sh.opened_at, 1, 10) <= ?
            ORDER BY sh.opened_at DESC
          `).all(fromParam, toParam)
        : db.prepare(`
            SELECT sh.*, u.username as cashier_name
            FROM shifts sh
            LEFT JOIN users u ON sh.opened_by_user_id = u.id
            WHERE sh.club_id = ?
              AND substr(sh.opened_at, 1, 10) >= ? AND substr(sh.opened_at, 1, 10) <= ?
            ORDER BY sh.opened_at DESC
          `).all(clubId, fromParam, toParam);

      const formattedShifts = shiftsQuery.map(sh => {
        const startCash = Number(sh.start_cash || 0);
        const endCash = Number(sh.end_cash || 0);
        const sysCash = Number(sh.system_cash || 0);
        const sysCard = Number(sh.system_card || 0);
        const expectedCash = startCash + sysCash;
        const diff = sh.is_closed ? (endCash - expectedCash) : 0;
        return {
          id: sh.id,
          cashierName: sh.cashier_name || 'Admin',
          openedAt: sh.opened_at,
          closedAt: sh.closed_at,
          startCash,
          systemCash: sysCash,
          systemCard: sysCard,
          endCash,
          expectedCash,
          difference: diff,
          isClosed: Boolean(sh.is_closed)
        };
      });

      sendJson(res, 200, {
        success: true,
        filter: {
          from: fromParam,
          to: toParam,
          category: categoryParam,
          search: searchParam
        },
        summary,
        topSellingItems,
        sessions: formattedSessions,
        barSales: formattedBarSales,
        shifts: formattedShifts,
        audit_trail: auditTrail,
        auditTrail
      });
    } catch (err) {
      sendJson(res, 500, { error: 'Moliyaviy hisobotni shakllantirishda xatolik: ' + err.message });
    }
    return;
  }

  // 1b. GET /api/reports/audit (Faqat audit jurnali bo'yicha alohida endpoint)
  if (url.pathname === '/api/reports/audit' && req.method === 'GET') {
    if (!authenticate(req, res, { allowExpiredClub: true })) return;
    const clubId = getTenantClubId(req);

    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      const dateParam = url.searchParams.get('date');
      const fromParam = dateParam || url.searchParams.get('from') || todayStr;
      const toParam = dateParam || url.searchParams.get('to') || todayStr;
      const categoryParam = url.searchParams.get('category') || null;
      const searchParam = url.searchParams.get('search') || null;

      const auditTrail = getAuditTrail({
        clubId,
        fromDate: fromParam,
        toDate: toParam,
        category: categoryParam,
        search: searchParam,
        limit: 1000
      });

      sendJson(res, 200, {
        success: true,
        filter: {
          from: fromParam,
          to: toParam,
          category: categoryParam,
          search: searchParam
        },
        audit_trail: auditTrail,
        auditTrail
      });
    } catch (err) {
      sendJson(res, 500, { error: 'Audit jurnalini olishda xatolik: ' + err.message });
    }
    return;
  }

  // 2. GET /api/reports/analytics (Chart.js uchun 30 kunlik trend, PC reytingi, tushum manbalari, bandlik)
  if (url.pathname === '/api/reports/analytics' && req.method === 'GET') {
    if (!authenticate(req, res, { roles: ['superadmin', 'club_owner'] })) return;
    const clubId = getTenantClubId(req);

    try {
      const daysCount = parseInt(url.searchParams.get('days') || '30', 10) || 30;
      const today = new Date();
      const pad = (n) => String(n).padStart(2, '0');

      // 2.1 Oxirgi 30 kunlik umumiy daromad dinamikasi
      const dailyRevenue = [];
      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const dayLabel = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;

        // Shu kungi tushum
        const txRow = clubId === null
          ? db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE substr(created_at, 1, 10) = ? AND amount > 0`).get(dStr)
          : db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE club_id = ? AND substr(created_at, 1, 10) = ? AND amount > 0`).get(clubId, dStr);

        const barRow = clubId === null
          ? db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders WHERE substr(created_at, 1, 10) = ? AND payment_status = 'PAID'`).get(dStr)
          : db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders WHERE club_id = ? AND substr(created_at, 1, 10) = ? AND payment_status = 'PAID'`).get(clubId, dStr);

        dailyRevenue.push({
          date: dStr,
          label: dayLabel,
          revenue: Number(txRow?.total || 0),
          barRevenue: Number(barRow?.total || 0)
        });
      }

      // 2.2 Har bir kompyuterning ishlagan soati va keltirgan tushumi reytingi
      const pcStatsQuery = clubId === null
        ? db.prepare(`
            SELECT c.id, c.name, c.pc_number, c.zone,
                   COALESCE(SUM(s.total_amount), 0) as total_revenue,
                   COUNT(s.id) as sessions_count
            FROM computers c
            LEFT JOIN sessions s ON (s.computer_id = c.id OR s.computer_id = c.pc_number)
            GROUP BY c.id
            ORDER BY total_revenue DESC
          `).all()
        : db.prepare(`
            SELECT c.id, c.name, c.pc_number, c.zone,
                   COALESCE(SUM(s.total_amount), 0) as total_revenue,
                   COUNT(s.id) as sessions_count
            FROM computers c
            LEFT JOIN sessions s ON (s.computer_id = c.id OR s.computer_id = c.pc_number) AND s.club_id = ?
            WHERE c.club_id = ?
            GROUP BY c.id
            ORDER BY total_revenue DESC
          `).all(clubId, clubId);

      const computerStats = pcStatsQuery.map(pc => {
        const rev = Number(pc.total_revenue || 0);
        const hours = rev > 0 ? (rev / 12000).toFixed(1) : '0.0';
        return {
          id: pc.id,
          name: pc.name,
          pcNumber: pc.pc_number,
          zone: pc.zone,
          totalRevenue: rev,
          totalHours: parseFloat(hours),
          sessionsCount: Number(pc.sessions_count || 0)
        };
      });

      // 2.3 Daromad manbalari ulushi (O'yinlar vs Bar vs Top-up)
      const totalGameRevRow = clubId === null
        ? db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE notes IS NULL OR (notes NOT LIKE 'BAR_SALE%' AND notes NOT LIKE 'CLIENT_TOPUP%' AND notes NOT LIKE '%REFUND%')`).get()
        : db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE club_id = ? AND (notes IS NULL OR (notes NOT LIKE 'BAR_SALE%' AND notes NOT LIKE 'CLIENT_TOPUP%' AND notes NOT LIKE '%REFUND%'))`).get(clubId);

      const totalBarRevRow = clubId === null
        ? db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders WHERE payment_status = 'PAID'`).get()
        : db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders WHERE club_id = ? AND payment_status = 'PAID'`).get(clubId);

      const totalTopupRevRow = clubId === null
        ? db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM client_transactions WHERE type = 'TOPUP'`).get()
        : db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM client_transactions WHERE club_id = ? AND type = 'TOPUP'`).get(clubId);

      const gameSum = Number(totalGameRevRow?.total || 0);
      const barSum = Number(totalBarRevRow?.total || 0);
      const topupSum = Number(totalTopupRevRow?.total || 0);

      // 2.4 Kun davomida zalning bandlik soatlari (Peak Hours 00:00 - 23:00)
      const hourlyDistribution = Array(24).fill(0);
      const allSessions = clubId === null
        ? db.prepare(`SELECT started_at, ends_at FROM sessions WHERE started_at IS NOT NULL LIMIT 500`).all()
        : db.prepare(`SELECT started_at, ends_at FROM sessions WHERE club_id = ? AND started_at IS NOT NULL LIMIT 500`).all(clubId);

      for (const sess of allSessions) {
        try {
          const h = new Date(sess.started_at).getHours();
          if (h >= 0 && h < 24) {
            hourlyDistribution[h] += 1;
          }
        } catch (_) {}
      }

      const standardProfile = [2, 1, 0, 0, 0, 0, 1, 3, 6, 8, 12, 16, 20, 24, 28, 35, 42, 50, 65, 78, 85, 75, 55, 30];
      const maxSessions = Math.max(...hourlyDistribution, 1);
      const normalizedPeakHours = hourlyDistribution.map((cnt, idx) => {
        if (allSessions.length > 20) {
          return Math.min(100, Math.round((cnt / maxSessions) * 95) + 5);
        }
        return standardProfile[idx];
      });

      sendJson(res, 200, {
        success: true,
        dailyRevenue,
        computerStats,
        revenueSources: {
          games: gameSum,
          bar: barSum,
          topup: topupSum
        },
        peakHours: normalizedPeakHours
      });
    } catch (err) {
      sendJson(res, 500, { error: 'Analitika ma\'lumotlarini shakllantirishda xatolik: ' + err.message });
    }
    return;
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, callback) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      callback(JSON.parse(body));
    } catch {
      callback({});
    }
  });
}

function broadcastAdminUpdate() {
  ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now() });
}

function resolvePcId(rawId) {
  if (rawId === undefined || rawId === null) return '';
  if (typeof rawId === 'number') return `pc_${rawId}`;
  const str = String(rawId).trim();
  if (str.startsWith('pc_')) return str;
  const digits = str.replace(/\D/g, '');
  if (digits) return `pc_${parseInt(digits, 10)}`;
  return str;
}

const wss = new WebSocketServer({ server, path: '/ws' });
ClientManager.wss = wss;

// Anti-Piracy, HWID Locking & Remote Kill-Switch Initsializatsiyasi
LicenseManager.init({
  clientBroadcaster: (payload) => {
    ClientManager.broadcastToAll(payload);
  },
  sessionDropper: () => {
    SessionScheduler.dropAllActiveSessions('LOCKED_BY_ADMIN');
  }
});

wss.on('connection', (socket, req) => {
  const remoteIp = req.socket?.remoteAddress?.replace('::ffff:', '') || '127.0.0.1';
  socket._remoteAddress = remoteIp;
  console.log(`📡 [WS Connection] Yangi aloqa: ${remoteIp} (Port ${req.socket?.remotePort})`);

  socket.on('message', (data) => {
    ProtocolDispatcher.handleMessage(socket, data.toString());
  });

  socket.on('close', (code, reason) => {
    console.log(`🔌 [WS Disconnect] Aloqa uzildi: ${remoteIp} (Code: ${code})`);
    ClientManager.unregisterClient(socket);
    broadcastAdminUpdate();
  });

  socket.on('error', (err) => {
    console.warn(`⚠️ [WS Error] Xato: ${remoteIp} - ${err.message}`);
    ClientManager.unregisterClient(socket);
    broadcastAdminUpdate();
  });
});

function getLocalLanIps() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({ name, address: net.address });
      }
    }
  }
  return results;
}

server.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLocalLanIps();
  console.log('================================================================');
  console.log(`🚀 NetCafe Pro Core Engine Server: http://0.0.0.0:${PORT}`);
  console.log(`🖥️  Admin Dashboard (Local):       http://localhost:${PORT}/`);
  if (lanIps.length > 0) {
    lanIps.forEach(net => {
      console.log(`🌐 Admin Dashboard (${net.name}):   http://${net.address}:${PORT}/`);
      console.log(`🔌 Client WebSocket URL:          ws://${net.address}:${PORT}/ws`);
    });
  } else {
    console.log(`🔌 Client WebSocket URL:          ws://localhost:${PORT}/ws`);
  }
  console.log('================================================================');
  console.log('🟢 SERVER TO\'LIQ FAOL VA ISHLAMOQDA!');
  console.log('⚠️  ESLATMA: Ushbu qora (konsol) oynani YOPMANG! (Yopilsa server o\'chadi)');
  console.log('================================================================');

  HeartbeatMonitor.start();
  SessionScheduler.start();
});

process.on('SIGINT', () => {
  HeartbeatMonitor.stop();
  SessionScheduler.stop();
  server.close(() => {
    process.exit(0);
  });
});
