/**
 * Softech Cloud Hub — Ingestion & Telemetry API
 * Location: SoftechCloudAdmin/src/routes/telemetry.js
 * 
 * High-performance Heartbeat Ingestion API receiving real-time telemetry from
 * local NetCafeServer instances across all enrolled game clubs.
 */

import { db } from '../db/connection.js';
import { TelemetryService } from '../db/telemetryService.js';
import { TelegramBotService } from '../services/telegramBot.js';

// Offline worker reference
let offlineWorkerTimer = null;

// ============================================================================
// 1. UTILITY FUNCTIONS
// ============================================================================

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      // 5MB dan ortiq yuklamani rad etish
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload hajmi juda katta (Max 5MB)'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Noto\'g\'ri JSON formati'));
      }
    });
    req.on('error', reject);
  });
}

function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['x-club-token'] || '';
  if (!authHeader) return null;

  if (authHeader.startsWith('Bearer ') || authHeader.startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return authHeader.trim();
}

/**
 * 2. TOKEN ORQALI KLUBNI TEKSHIRISH (Authentication)
 * Har bir klub uchun alohida CLUB_SECRET_TOKEN / litsenziya kaliti tekshiriladi
 */
export function validateClubSecretToken(clubId, token) {
  if (!clubId) {
    return { valid: false, error: "clubId ko'rsatilishi shart." };
  }

  if (!token) {
    return { valid: false, error: "Authorization sarlavhasida Bearer token kiritilishi shart." };
  }

  const club = db.prepare(`
    SELECT id, name, slug, status, license_expires_at, total_workstations, server_lan_ip, server_version, api_secret_token
    FROM clubs 
    WHERE id = ?
  `).get(clubId);

  if (!club) {
    return { valid: false, error: `Filial topilmadi (ID: ${clubId}).` };
  }

  // To'g'ridan-to'g'ri api_secret_token yoki tizimli token bilan tekshirish
  const expectedToken = club.api_secret_token || `softech_sec_${club.slug || club.id}_token`;
  const isFallbackMatch = token === `softech_token_club_${club.id}` || token === expectedToken;

  if (token !== club.api_secret_token && !isFallbackMatch) {
    return { valid: false, error: "Ruxsat etilmagan litsenziya tokeni (Invalid Club Secret Token)." };
  }

  return { valid: true, club };
}

// ============================================================================
// 3. HEARTBEAT INGESTION HANDLER
// ============================================================================

/**
 * POST /api/telemetry/heartbeat
 * NetCafeServer dan jonli telemetriya qabul qilish, keshni yangilash va kutilayotgan buyruqlarni qaytarish
 */
export async function handleHeartbeatIngestion(req, res) {
  try {
    const bearerToken = extractBearerToken(req);
    const payload = await parseJsonBody(req);

    const clubId = parseInt(payload.clubId || payload.club_id, 10);
    if (!clubId) {
      return sendJson(res, 400, {
        status: 'ERROR',
        error: "So'rovda clubId ko'rsatilishi shart."
      });
    }

    // 1. Token orqali klubni tekshirish
    const authCheck = validateClubSecretToken(clubId, bearerToken);
    if (!authCheck.valid) {
      return sendJson(res, 401, {
        status: 'UNAUTHORIZED',
        error: authCheck.error
      });
    }

    const club = authCheck.club;
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.slice(0, 10);

    // Litsenziya muddati o'tganligini tekshirish
    const isLicenseExpired = club.license_expires_at ? new Date(club.license_expires_at).getTime() < Date.now() : false;
    let nextStatus = club.status;

    if (isLicenseExpired) {
      nextStatus = 'SUSPENDED_PAYMENT';
    } else if (club.status === 'OFFLINE') {
      nextStatus = 'ACTIVE'; // Oflayndan qaytdi
      TelegramBotService.sendServerRestoredAlert(club.name);
    }

    const appVersion = String(payload.appVersion || payload.serverVersion || club.server_version || '1.0.1');

    // 🚀 Yangi versiya yangilanganini tekshirish
    if (payload.appVersion && club.server_version && payload.appVersion !== club.server_version) {
      TelegramBotService.sendVersionUpdatedAlert(club.name, payload.appVersion);
    }

    // 📅 Litsenziya muddati tugashini tekshirish (<= 2 kun)
    if (club.license_expires_at) {
      const daysLeft = Math.ceil((new Date(club.license_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 0 && daysLeft <= 2) {
        TelegramBotService.sendSubscriptionExpiringAlert(club.name, daysLeft);
      }
    }
    const onlinePcs = parseInt(payload.onlinePcsCount || payload.total_workstations || club.total_workstations, 10);
    const clientIp = req.socket.remoteAddress || club.server_lan_ip;

    // 2. `clubs` jadvalida last_heartbeat_at va ko'rsatkichlarni yangilash
    db.prepare(`
      UPDATE clubs
      SET last_heartbeat_at = CURRENT_TIMESTAMP,
          status = ?,
          server_version = ?,
          total_workstations = ?,
          server_lan_ip = COALESCE(?, server_lan_ip),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextStatus, appVersion, onlinePcs, clientIp, clubId);

    // 3. Agar kassa ko'rsatkichlari (todayRevenue, activeCashier) yuborilgan bo'lsa, saqlash
    if (payload.todayRevenue !== undefined || payload.occupiedPcsCount !== undefined) {
      const dailyRev = parseFloat(payload.todayRevenue) || 0;
      const occupiedPcs = parseInt(payload.occupiedPcsCount, 10) || 0;
      const barRev = parseFloat(payload.barRevenue) || 0;

      db.prepare(`
        INSERT INTO club_metrics (
          club_id, record_date, total_daily_revenue, peak_concurrent_pcs, bar_revenue
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(club_id, record_date) DO UPDATE SET
          total_daily_revenue = excluded.total_daily_revenue,
          peak_concurrent_pcs = MAX(club_metrics.peak_concurrent_pcs, excluded.peak_concurrent_pcs),
          bar_revenue = CASE WHEN excluded.bar_revenue > 0 THEN excluded.bar_revenue ELSE club_metrics.bar_revenue END
      `).run(clubId, todayStr, dailyRev, occupiedPcs, barRev);
    }

    // 4. Ishchi o'rinlari (Workstations) matritsasi keshini yangilash
    if (Array.isArray(payload.workstations) && payload.workstations.length > 0) {
      const upsertPcStmt = db.prepare(`
        INSERT INTO club_workstations_cache (
          club_id, pc_number, zone_name, status, current_session_started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(club_id, pc_number) DO UPDATE SET
          zone_name = excluded.zone_name,
          status = excluded.status,
          current_session_started_at = excluded.current_session_started_at,
          updated_at = CURRENT_TIMESTAMP
      `);

      db.exec('BEGIN TRANSACTION;');
      try {
        for (const item of payload.workstations) {
          const pcNum = String(item.pc || item.pc_number || item.name || 'PC').toUpperCase();
          const zoneName = String(item.zone || item.zone_name || 'STANDARD').toUpperCase();
          const status = String(item.status || 'AVAILABLE').toUpperCase();

          let sessionStart = null;
          if (status === 'OCCUPIED' && item.minutesLeft) {
            // Qolgan vaqtga qarab seans vaqtini belgilash
            sessionStart = new Date(Date.now() - (item.playedMinutes || 30) * 60000).toISOString();
          }

          upsertPcStmt.run(clubId, pcNum, zoneName, status, sessionStart);
        }
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        console.warn('⚠️ [Telemetry] Workstations keshini yangilashda ogohlantirish:', err.message);
      }
    }

    // 5. Agar filial serveri oldingi buyruqlar bajarilganini tasdiqlagan bo'lsa (acknowledgedCommandIds)
    if (Array.isArray(payload.acknowledgedCommandIds) && payload.acknowledgedCommandIds.length > 0) {
      for (const cmdId of payload.acknowledgedCommandIds) {
        db.prepare(`
          UPDATE remote_commands 
          SET status = 'EXECUTED', executed_at = CURRENT_TIMESTAMP 
          WHERE id = ? AND club_id = ?
        `).run(cmdId, clubId);
      }
    }

    // 6. Kutilayotgan buyruqlar (remote_commands) bormi-yo'qligini tekshirish
    const pendingCommandsRaw = db.prepare(`
      SELECT id, command_type, payload, created_at
      FROM remote_commands
      WHERE club_id = ? AND status = 'PENDING'
      ORDER BY id ASC
    `).all(clubId);

    const pendingCommands = pendingCommandsRaw.map(cmd => ({
      id: cmd.id,
      commandType: cmd.command_type,
      payload: (() => {
        try { return JSON.parse(cmd.payload); } catch { return {}; }
      })(),
      createdAt: cmd.created_at
    }));

    // 7. Qaytariluvchi javob
    return sendJson(res, 200, {
      status: 'OK',
      clubId,
      serverTime: nowIso,
      clubStatus: nextStatus,
      isLicenseExpired,
      pendingCommandsCount: pendingCommands.length,
      pendingCommands
    });

  } catch (err) {
    console.error('❌ [Telemetry Ingestion Error]:', err);
    return sendJson(res, 500, {
      status: 'ERROR',
      error: err.message
    });
  }
}

// ============================================================================
// 4. OFFLINE DETECTION WORKER (Fondagi Avtomatik Vazifa)
// ============================================================================

/**
 * Har 1 daqiqada aylanadi:
 * Agar biror klubdan 2 daqiqadan ko'proq vaqt heartbeat kelmasa,
 * uning statusini avtomatik 'OFFLINE' ga o'zgartiradi.
 */
export function runOfflineDetectionCheck() {
  try {
    // 2 daqiqadan ko'p vaqt heartbeat yubormagan faol klublarni topish
    const thresholdMinutes = 2;
    const offlineClubs = db.prepare(`
      SELECT id, name, last_heartbeat_at, status
      FROM clubs
      WHERE status = 'ACTIVE'
        AND (
          last_heartbeat_at IS NULL 
          OR last_heartbeat_at < datetime('now', '-' || ? || ' minutes')
        )
    `).all(thresholdMinutes);

    if (offlineClubs.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE clubs 
        SET status = 'OFFLINE', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);

      for (const club of offlineClubs) {
        updateStmt.run(club.id);
        console.log(`📡 [Offline Detection Worker] ⚠️ "${club.name}" (ID: ${club.id}) 2 daqiqadan oshiq vaqt heartbeat yubormadi -> Status OFFLINE ga o'zgartirildi.`);
        // 🚨 Server Offline Alert
        TelegramBotService.sendServerOfflineAlert(club.name, 3);
      }
    }

    return {
      success: true,
      checkedAt: new Date().toISOString(),
      offlineCount: offlineClubs.length,
      clubsMarkedOffline: offlineClubs.map(c => ({ id: c.id, name: c.name }))
    };
  } catch (err) {
    console.error('❌ [Offline Detection Worker Xatosi]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Worker ni ishga tushirish (Har 60 soniyada)
 */
export function startOfflineDetectionWorker(intervalMs = 60000) {
  if (offlineWorkerTimer) {
    clearInterval(offlineWorkerTimer);
  }

  // Dastlabki tekshiruv
  runOfflineDetectionCheck();

  offlineWorkerTimer = setInterval(() => {
    runOfflineDetectionCheck();
  }, intervalMs);

  console.log(`⏱️ [Offline Detection Worker] Fondagi vazifa ishga tushirildi (Tekshirish oralig'i: ${intervalMs / 1000}s).`);
  return offlineWorkerTimer;
}

/**
 * Worker ni to'xtatish (Testlar va serverni to'xtatish uchun)
 */
export function stopOfflineDetectionWorker() {
  if (offlineWorkerTimer) {
    clearInterval(offlineWorkerTimer);
    offlineWorkerTimer = null;
    console.log('⏹️ [Offline Detection Worker] Fondagi vazifa to\'xtatildi.');
  }
}

// ============================================================================
// 5. ROUTE DISPATCHER
// ============================================================================

export async function handleTelemetryRoute(req, res, pathname) {
  // POST /api/telemetry/heartbeat (asosiy ingestion endpointi)
  if ((pathname === '/api/telemetry/heartbeat' || pathname === '/api/telemetry/heartbeat/') && req.method === 'POST') {
    return handleHeartbeatIngestion(req, res);
  }

  // URL da clubId ko'rsatilgan legacy format: POST /api/telemetry/heartbeat/:clubId
  if (pathname.startsWith('/api/telemetry/heartbeat/') && req.method === 'POST') {
    return handleHeartbeatIngestion(req, res);
  }

  return false;
}
