/**
 * Softech Cloud Hub — Activation & Remote Kill-Switch Service
 * Location: SoftechCloudAdmin/src/services/activationService.js
 * 
 * Handles:
 * - Hardware-Bound License Signing (HMAC-SHA256 Cryptographic Token)
 * - Super Admin Approval / Rejection Workflow for new clubs
 * - Real-Time Remote Kill-Switch Dispatcher via Persistent WebSocket Channel
 * - Telegram Bot Real-Time Security Alerts
 */

import crypto from 'node:crypto';
import { db } from '../db/connection.js';
import { TelegramBotService } from './telegramBot.js';

const CLOUD_MASTER_KEY = process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026';

// Cloud WebSocket Channel Active Connections: Key -> ws connection
// Keys: `hwid:${hwid}` and `club:${clubId}`
const activeSockets = new Map();

export class ActivationService {
  /**
   * 1. Sxemani initsializatsiya qilish
   */
  static initSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activation_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
          club_name TEXT NOT NULL,
          hardware_fingerprint TEXT NOT NULL,
          total_pcs INTEGER NOT NULL DEFAULT 16,
          server_lan_ip TEXT,
          server_version TEXT DEFAULT '1.0.1',
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
          rejection_reason TEXT,
          requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          processed_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_activation_requests_status ON activation_requests(status);
    `);

    // clubs jadvaliga hardware_fingerprint ustunini qo'shish
    try {
      const cols = db.prepare('PRAGMA table_info(clubs)').all().map(c => c.name);
      if (!cols.includes('hardware_fingerprint')) {
        db.exec('ALTER TABLE clubs ADD COLUMN hardware_fingerprint TEXT;');
        console.log('🔒 [Database] clubs jadvaliga hardware_fingerprint ustuni qo\'shildi.');
      }
    } catch (err) {}
  }

  /**
   * 2. WebSocket ulanishlarini boshqarish
   */
  static registerSocket(identifier, ws) {
    activeSockets.set(identifier, ws);
    console.log(`🔌 [Cloud-WS] Server ulandi: ${identifier} (Jami faol: ${activeSockets.size})`);
  }

  static unregisterSocket(identifier) {
    activeSockets.delete(identifier);
    console.log(`🔌 [Cloud-WS] Server uzildi: ${identifier} (Jami faol: ${activeSockets.size})`);
  }

  static getSocket(identifier) {
    return activeSockets.get(identifier);
  }

  /**
   * 3. NetCafeServer dan birinchi yuklanishda kelgan Activation Request ni qabul qilish
   */
  static async createActivationRequest({
    clubName,
    hardwareFingerprint,
    totalPcs = 16,
    serverLanIp = '192.168.1.100',
    serverVersion = '1.0.1',
    clubId = null
  }) {
    this.initSchema();

    if (!hardwareFingerprint) {
      throw new Error("hardwareFingerprint (HWID) ko'rsatilishi shart.");
    }

    const finalClubName = clubName || `Game Club (${hardwareFingerprint.slice(-4)})`;

    // Mavjud PENDING so'rov bormi tekshirish
    const existing = db.prepare(`
      SELECT * FROM activation_requests 
      WHERE hardware_fingerprint = ? AND status = 'PENDING'
    `).get(hardwareFingerprint);

    let requestId = existing ? existing.id : null;

    if (!existing) {
      const result = db.prepare(`
        INSERT INTO activation_requests (
          club_id, club_name, hardware_fingerprint, total_pcs, server_lan_ip, server_version, status, requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
      `).run(clubId, finalClubName, hardwareFingerprint, parseInt(totalPcs, 10) || 16, serverLanIp, serverVersion);

      requestId = Number(result.lastInsertRowid);
    }

    // Telegram Bot orqali Super Adminga tezkor xabar yuborish
    try {
      const alertMsg = [
        `🚨 <b>YANGI SERVER LITSENZIYA SO'ROVI!</b>`,
        `🏢 Klub: <b>${finalClubName}</b>`,
        `🖥️ Mashina HWID: <code>${hardwareFingerprint}</code>`,
        `💻 Kompyuterlar: <b>${totalPcs} ta PC</b>`,
        `🌐 LAN IP: <code>${serverLanIp}</code> • v${serverVersion}`,
        ``,
        `<i>Super Admin PWA orqali [✅ TASDIQLASH] yoki [❌ RAD ETISH] mumkin.</i>`
      ].join('\n');

      await TelegramBotService.sendMessage(alertMsg);
    } catch (err) {
      console.warn('⚠️ Telegram ogohlantirish yuborishda xatolik:', err.message);
    }

    return {
      success: true,
      requestId,
      status: 'PENDING',
      message: "Litsenziya so'rovi Super Adminga yuborildi. Tasdiqlanishi kutilmoqda."
    };
  }

  /**
   * 4. Barcha kutilayotgan so'rovlarni olish (Super Admin PWA uchun)
   */
  static getPendingRequests() {
    this.initSchema();
    return db.prepare(`
      SELECT * FROM activation_requests 
      WHERE status = 'PENDING' 
      ORDER BY id DESC
    `).all();
  }

  /**
   * 5. Kriptografik Litsenziya Yaratish va Imzolash (HMAC-SHA256 Token)
   */
  static generateSignedLicense({ clubId, clubName, hardwareFingerprint, days = 30, maxPcs = 16 }) {
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + parseInt(days, 10) * 24 * 3600 * 1000).toISOString();

    const payload = {
      clubId,
      clubName,
      hardwareFingerprint,
      status: 'ACTIVE',
      issuedAt,
      expiresAt,
      maxPcs: parseInt(maxPcs, 10) || 16,
      verifiedAt: issuedAt
    };

    const signature = crypto.createHmac('sha256', CLOUD_MASTER_KEY)
      .update(JSON.stringify(payload))
      .digest('hex');

    return { payload, signature };
  }

  /**
   * 6. Super Admin tomonidan litsenziyani tasdiqlash ([✅ TASDIQLASH])
   */
  static async approveActivation(requestId, { days = 30, maxPcs = 16 } = {}) {
    this.initSchema();

    const req = db.prepare('SELECT * FROM activation_requests WHERE id = ?').get(requestId);
    if (!req) {
      throw new Error(`So'rov topilmadi (ID: ${requestId})`);
    }

    if (req.status !== 'PENDING') {
      throw new Error(`Ushbu so'rov allaqachon ko'rib chiqilgan (Holat: ${req.status})`);
    }

    // Klubni aniqlash yoki yangi yaratish
    let club = null;
    if (req.club_id) {
      club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club_id);
    }

    if (!club) {
      club = db.prepare('SELECT * FROM clubs WHERE hardware_fingerprint = ?').get(req.hardware_fingerprint);
    }

    const expiresAtIso = new Date(Date.now() + parseInt(days, 10) * 24 * 3600 * 1000).toISOString();

    if (club) {
      db.prepare(`
        UPDATE clubs 
        SET status = 'ACTIVE', 
            hardware_fingerprint = ?, 
            license_expires_at = ?,
            total_workstations = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.hardware_fingerprint, expiresAtIso, parseInt(maxPcs, 10) || req.total_pcs, club.id);
      club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(club.id);
    } else {
      const slug = req.club_name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(100 + Math.random() * 900);
      const res = db.prepare(`
        INSERT INTO clubs (
          name, slug, owner_name, owner_phone, city, status, 
          license_expires_at, total_workstations, server_lan_ip, server_version,
          hardware_fingerprint, last_heartbeat_at
        ) VALUES (?, ?, 'Menejer', '+998901234567', 'Toshkent', 'ACTIVE', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(req.club_name, slug, expiresAtIso, parseInt(maxPcs, 10) || req.total_pcs, req.server_lan_ip, req.server_version, req.hardware_fingerprint);

      club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(Number(res.lastInsertRowid));
    }

    // So'rovni APPROVED qilish
    db.prepare(`
      UPDATE activation_requests 
      SET status = 'APPROVED', club_id = ?, processed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(club.id, requestId);

    // Kriptografik imzolangan litsenziyani tayyorlash
    const signedLicense = this.generateSignedLicense({
      clubId: club.id,
      clubName: club.name,
      hardwareFingerprint: req.hardware_fingerprint,
      days,
      maxPcs: club.total_workstations
    });

    // Jonli WebSocket orqali NetCafeServer ga yuborish
    const ws = this.getSocket(`hwid:${req.hardware_fingerprint}`) || this.getSocket(`club:${club.id}`);
    let pushedViaWs = false;

    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify({
          type: 'ACTIVATION_APPROVED',
          signedLicense,
          club: { id: club.id, name: club.name }
        }));
        pushedViaWs = true;
        console.log(`⚡ [Cloud-WS] Faollashtirilgan litsenziya jonli WebSocket orqali ${req.hardware_fingerprint} ga yuborildi!`);
      } catch (err) {}
    }

    // Telegram Bot xabarnomasi
    try {
      await TelegramBotService.sendMessage(
        `✅ <b>LITSENZIYA FAOLLASHTIRILDI!</b>\n🏢 Klub: <b>${club.name}</b>\n🖥️ HWID: <code>${req.hardware_fingerprint}</code>\n📅 Muddati: ${days} kun (${expiresAtIso.slice(0, 10)})`
      );
    } catch (err) {}

    return {
      success: true,
      message: "Klub litsenziyasi muvaffaqiyatli tasdiqlandi!",
      pushedViaWs,
      signedLicense,
      club
    };
  }

  /**
   * 7. Super Admin tomonidan litsenziya so'rovini rad etish ([❌ RAD ETISH])
   */
  static async rejectActivation(requestId, reason = 'Super Admin tomonidan rad etildi') {
    this.initSchema();
    const req = db.prepare('SELECT * FROM activation_requests WHERE id = ?').get(requestId);
    if (!req) throw new Error("So'rov topilmadi");

    db.prepare(`
      UPDATE activation_requests 
      SET status = 'REJECTED', rejection_reason = ?, processed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(reason, requestId);

    // WebSocket orqali rad xabarini yuborish
    const ws = this.getSocket(`hwid:${req.hardware_fingerprint}`);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({
          type: 'ACTIVATION_REJECTED',
          reason
        }));
      } catch (err) {}
    }

    return { success: true, message: "So'rov rad etildi." };
  }

  /**
   * 8. REMOTE KILL-SWITCH (Instant Emergency Lockdown)
   * SaaS egasi PWA dan [🚫 KLIENTNI BLOKLASH] ni bosganda chaqiriladi
   */
  static async dispatchKillSwitch(clubId, {
    reason = 'PAYMENT_OVERDUE',
    message = "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16"
  } = {}) {
    this.initSchema();

    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(clubId);
    if (!club) throw new Error(`Klub topilmadi (ID: ${clubId})`);

    // 1. Bazadagi klub holatini SUSPENDED_PAYMENT ga o'tkazish
    db.prepare(`
      UPDATE clubs 
      SET status = 'SUSPENDED_PAYMENT', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(clubId);

    // 2. remote_commands navbatiga buyruq yozish (Oflayn bo'lsa navbatda turadi)
    db.prepare(`
      INSERT INTO remote_commands (club_id, command_type, payload, status)
      VALUES (?, 'LOCK_CLUB_LICENSE', ?, 'PENDING')
    `).run(clubId, JSON.stringify({ reason, message, timestamp: Date.now() }));

    // 3. Jonli WebSocket orqali Real-Time Kill-Switch zarbasi yuborish
    const hwidKey = club.hardware_fingerprint ? `hwid:${club.hardware_fingerprint}` : null;
    const clubKey = `club:${club.id}`;
    const ws = (hwidKey ? this.getSocket(hwidKey) : null) || this.getSocket(clubKey);

    let deliveredInstant = false;
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({
          type: 'EMERGENCY_LOCKDOWN',
          reason,
          message,
          supportPhone: '+998 95 222 06 44, +998 99 563 45 16',
          timestamp: Date.now()
        }));
        deliveredInstant = true;
        console.log(`🚨 [Kill-Switch] Jonli WebSocket orqali ${club.name} darhol bloklandi!`);
      } catch (err) {
        console.warn('Kill-Switch yuborishda xatolik:', err.message);
      }
    }

    // 4. Telegram orqali Favqulodda Bildirishnoma
    try {
      await TelegramBotService.sendMessage(
        `🚨 <b>FAVQULODDA BLOKLASH (KILL-SWITCH IJROSI)!</b>\n🏢 Klub: <b>${club.name}</b>\n⚠️ Sabab: <b>${reason}</b>\n📡 Jonli yetkazildi: ${deliveredInstant ? '✅ HA (Darhol bloklandi)' : '⏳ NAVBATDA (Offline)'}`
      );
    } catch (err) {}

    return {
      success: true,
      deliveredInstant,
      clubId,
      clubName: club.name,
      message: `Kill-Switch buyrug'i ${deliveredInstant ? 'darhol yetkazildi va klub bloklandi' : 'navbatga qo\'yildi'}.`
    };
  }

  /**
   * 9. QULFDAN CHIQARISH (Litsenziyani qayta tiklash va muddat uzaytirish)
   */
  static async liftLockdown(clubId, { days = 30 } = {}) {
    this.initSchema();
    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(clubId);
    if (!club) throw new Error(`Klub topilmadi (ID: ${clubId})`);

    const newExpIso = new Date(Date.now() + parseInt(days, 10) * 24 * 3600 * 1000).toISOString();

    db.prepare(`
      UPDATE clubs 
      SET status = 'ACTIVE', license_expires_at = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(newExpIso, clubId);

    db.prepare(`
      INSERT INTO remote_commands (club_id, command_type, payload, status)
      VALUES (?, 'ACTIVATE_CLUB_LICENSE', ?, 'PENDING')
    `).run(clubId, JSON.stringify({ days, expiresAt: newExpIso, timestamp: Date.now() }));

    const hwidKey = club.hardware_fingerprint ? `hwid:${club.hardware_fingerprint}` : null;
    const ws = (hwidKey ? this.getSocket(hwidKey) : null) || this.getSocket(`club:${club.id}`);
    let deliveredInstant = false;

    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({
          type: 'LOCKDOWN_LIFTED',
          status: 'ACTIVE',
          expiresAt: newExpIso,
          message: "Litsenziya muvaffaqiyatli faollashtirildi.",
          timestamp: Date.now()
        }));
        deliveredInstant = true;
      } catch (err) {}
    }

    try {
      await TelegramBotService.sendMessage(
        `✅ <b>QULFDAN CHIQARILDI (LITSENZIYA FAOLLASHTIRILDI)!</b>\n🏢 Klub: <b>${club.name}</b>\n📅 Yangi muddat: +${days} kun (${newExpIso.slice(0, 10)})`
      );
    } catch (err) {}

    return {
      success: true,
      deliveredInstant,
      clubId,
      status: 'ACTIVE',
      newExpiresAt: newExpIso,
      message: `Klub qulfdan chiqarildi va ${days} kunga faollashtirildi.`
    };
  }
}

