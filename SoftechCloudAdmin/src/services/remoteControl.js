/**
 * Softech Super Admin — Remote Action Dispatcher Service
 * Location: SoftechCloudAdmin/src/services/remoteControl.js
 * 
 * Manages administrative command dispatching from SaaS Cloud to local game club servers:
 * 1. Reset Admin Password
 * 2. Lock / Activate Club License
 * 3. Force Restart Club Server
 * 4. Broadcast Cashier Announcement
 */

import { db } from '../db/connection.js';
import { TelemetryService } from '../db/telemetryService.js';
import crypto from 'node:crypto';

export class RemoteControlService {
  /**
   * 1. ADMIN PAROLINI YANGILASH (Reset Club Admin Password)
   * Super Admin yangi parol kiritadi yoki avtomatik xavfsiz vaqtinchalik parol hosil qilinadi.
   * Buyruq navbatga qo'yiladi va filial serveri keyingi heartbeat'da o'z bazasida yangilaydi.
   */
  static resetAdminPassword(clubId, { newPassword, reason = "Klub egasi iltimosiga binoan parolni yangilash" } = {}) {
    const club = db.prepare('SELECT id, name, owner_name, owner_phone FROM clubs WHERE id = ?').get(clubId);
    if (!club) {
      throw new Error(`Filial topilmadi (ID: ${clubId})`);
    }

    // Agar parol kiritilmagan bo'lsa, xavfsiz 8 xonali vaqtinchalik parol yaratish
    let passwordToSet = newPassword ? String(newPassword).trim() : '';
    if (!passwordToSet) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
      const randomBytes = crypto.randomBytes(8);
      passwordToSet = Array.from(randomBytes).map(b => chars[b % chars.length]).join('');
    }

    if (passwordToSet.length < 6) {
      throw new Error("Yangi parol kamida 6 ta belgidan iborat bo'lishi shart.");
    }

    const payload = {
      action: 'RESET_ADMIN_PASSWORD',
      targetUsername: 'admin',
      newPassword: passwordToSet,
      reason,
      requestedAt: new Date().toISOString(),
      timestamp: Date.now()
    };

    const cmd = TelemetryService.queueRemoteCommand(clubId, 'RESET_ADMIN_PASSWORD', payload);

    return {
      success: true,
      commandId: cmd.id,
      clubId,
      clubName: club.name,
      targetUsername: 'admin',
      newPassword: passwordToSet,
      status: 'PENDING',
      message: `Admin parolini yangilash buyrug'i navbatga qo'yildi. ${club.name} serveri qabul qilishi bilan yangilanadi.`
    };
  }

  /**
   * 2. KLUB LITSENZIYASINI BLOKLASH / FAOLLASHTIRISH (Lock / Activate Club License)
   * Agar klub oylik to'lovni qilmasa: [Litsenziyani To'xtatish]
   * Bloklanganda kassir va mijoz ekranida qizil oyna chiqadi.
   */
  static setLicenseStatus(clubId, action, options = {}) {
    const club = db.prepare('SELECT id, name, status, license_expires_at FROM clubs WHERE id = ?').get(clubId);
    if (!club) {
      throw new Error(`Filial topilmadi (ID: ${clubId})`);
    }

    const normalizedAction = String(action).toUpperCase();

    if (normalizedAction === 'LOCK' || normalizedAction === 'SUSPEND') {
      // Bulut bazasida statusni SUSPENDED_PAYMENT ga o'tkazish
      db.prepare(`
        UPDATE clubs 
        SET status = 'SUSPENDED_PAYMENT', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(clubId);

      const defaultReason = "Softech obuna muddati tugadi. Xizmatni davom ettirish uchun ta'minotchi bilan bog'laning";
      const payload = {
        action: 'LOCK_CLUB_LICENSE',
        lockScreen: true,
        lockTitle: "Softech Litsenziyasi To'xtatildi",
        lockReason: options.reason || defaultReason,
        contactPhone: options.contactPhone || '+998 95 222 06 44, +998 99 563 45 16',
        supportTelegram: '@softech_superadmin006_bot',
        lockedAt: new Date().toISOString(),
        timestamp: Date.now()
      };

      const cmd = TelemetryService.queueRemoteCommand(clubId, 'LOCK_CLUB_LICENSE', payload);

      return {
        success: true,
        commandId: cmd.id,
        clubId,
        clubName: club.name,
        newStatus: 'SUSPENDED_PAYMENT',
        action: 'LOCK',
        message: `${club.name} litsenziyasi to'xtatildi va bloklash buyrug'i navbatga qo'yildi.`
      };
    }

    if (normalizedAction === 'ACTIVATE' || normalizedAction === 'UNLOCK') {
      // 30 kunga yoki ko'rsatilgan sanaga uzaytirish
      const daysToAdd = parseInt(options.extensionDays || 30, 10);
      const currentExpiry = new Date(club.license_expires_at).getTime();
      const baseTime = currentExpiry > Date.now() ? currentExpiry : Date.now();
      const newExpiryIso = new Date(baseTime + daysToAdd * 24 * 3600 * 1000).toISOString();

      db.prepare(`
        UPDATE clubs 
        SET status = 'ACTIVE', license_expires_at = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(newExpiryIso, clubId);

      const payload = {
        action: 'UNLOCK_CLUB_LICENSE',
        lockScreen: false,
        newStatus: 'ACTIVE',
        licenseExpiresAt: newExpiryIso,
        extensionDays: daysToAdd,
        activatedAt: new Date().toISOString(),
        message: "Klub litsenziyasi muvaffaqiyatli uzaytirildi va tizim faollashtirildi.",
        timestamp: Date.now()
      };

      const cmd = TelemetryService.queueRemoteCommand(clubId, 'UNLOCK_CLUB_LICENSE', payload);

      return {
        success: true,
        commandId: cmd.id,
        clubId,
        clubName: club.name,
        newStatus: 'ACTIVE',
        licenseExpiresAt: newExpiryIso,
        action: 'UNLOCK',
        message: `${club.name} litsenziyasi ${daysToAdd} kunga uzaytirildi va faollashtirildi.`
      };
    }

    throw new Error(`Noma'lum litsenziya amali: ${action}. Faqat 'LOCK' yoki 'ACTIVATE' qabul qilinadi.`);
  }

  /**
   * 3. KASSA SERVERINI MASOFADAN QAYTA ISHGA TUSHIRISH (Restart Club Server)
   * Server qotib qolganda yoki yangilanganda majburiy qayta yuklash buyrug'ini yuborish.
   */
  static restartServer(clubId, options = {}) {
    const club = db.prepare('SELECT id, name FROM clubs WHERE id = ?').get(clubId);
    if (!club) {
      throw new Error(`Filial topilmadi (ID: ${clubId})`);
    }

    const payload = {
      action: 'RESTART_SERVER',
      force: options.force !== false,
      delaySeconds: parseInt(options.delaySeconds || 5, 10),
      reason: options.reason || "Super Admin tomonidan markaziy buyruq orqali qayta yuklash",
      issuedAt: new Date().toISOString(),
      timestamp: Date.now()
    };

    const cmd = TelemetryService.queueRemoteCommand(clubId, 'RESTART_SERVER', payload);

    return {
      success: true,
      commandId: cmd.id,
      clubId,
      clubName: club.name,
      action: 'RESTART_SERVER',
      delaySeconds: payload.delaySeconds,
      message: `${club.name} serverini qayta ishga tushirish buyrug'i yuborildi.`
    };
  }

  /**
   * 4. XABARNOMA YUBORISH (Broadcast Announcement)
   * Kassir ekraniga to'g'ridan-to'g'ri xabar chiqarish.
   * Agar clubId === 'ALL' bo'lsa, barcha faol klublarga ommaviy tarqatadi.
   */
  static broadcastAnnouncement(clubId, { title, message, priority = 'HIGH', durationSeconds = 30 } = {}) {
    if (!message || String(message).trim().length === 0) {
      throw new Error("Xabarnoma matni kiritilishi shart.");
    }

    const cleanTitle = title ? String(title).trim() : "Diqqat! Markaziy Xabarnoma";
    const cleanMessage = String(message).trim();
    const duration = Math.max(5, Math.min(300, parseInt(durationSeconds || 30, 10)));

    const payload = {
      action: 'BROADCAST_ANNOUNCEMENT',
      title: cleanTitle,
      message: cleanMessage,
      priority: ['INFO', 'WARNING', 'CRITICAL', 'HIGH'].includes(priority) ? priority : 'HIGH',
      durationSeconds: duration,
      broadcastAt: new Date().toISOString(),
      timestamp: Date.now()
    };

    // Ommaviy xabarnoma (Barcha klublarga)
    if (clubId === 'ALL' || clubId === 0 || clubId === 'all') {
      const clubs = db.prepare("SELECT id, name FROM clubs WHERE status != 'OFFLINE'").all();
      const results = [];

      for (const c of clubs) {
        const cmd = TelemetryService.queueRemoteCommand(c.id, 'BROADCAST_ANNOUNCEMENT', payload);
        results.push({ clubId: c.id, clubName: c.name, commandId: cmd.id });
      }

      return {
        success: true,
        broadcastTarget: 'ALL_CLUBS',
        dispatchedCount: results.length,
        title: cleanTitle,
        message: cleanMessage,
        details: results,
        messageSummary: `Xabarnoma jami ${results.length} ta faol filial kassa ekranlariga yuborildi.`
      };
    }

    // Bitta alohida filialga
    const club = db.prepare('SELECT id, name FROM clubs WHERE id = ?').get(clubId);
    if (!club) {
      throw new Error(`Filial topilmadi (ID: ${clubId})`);
    }

    const cmd = TelemetryService.queueRemoteCommand(clubId, 'BROADCAST_ANNOUNCEMENT', payload);

    return {
      success: true,
      broadcastTarget: 'SINGLE_CLUB',
      clubId,
      clubName: club.name,
      commandId: cmd.id,
      title: cleanTitle,
      message: cleanMessage,
      durationSeconds: duration,
      messageSummary: `Xabarnoma ${club.name} kassa ekraniga yuborildi.`
    };
  }

  /**
   * 5. Buyruqlar tarixi va holatini ko'rish
   */
  static getCommandHistory(clubId = null, limit = 20) {
    let sql = `
      SELECT r.*, c.name as club_name, c.city as club_city
      FROM remote_commands r
      JOIN clubs c ON c.id = r.club_id
    `;
    const params = [];

    if (clubId && clubId !== 'ALL') {
      sql += ' WHERE r.club_id = ?';
      params.push(clubId);
    }

    sql += ' ORDER BY r.id DESC LIMIT ?';
    params.push(Math.max(1, parseInt(limit || 20, 10)));

    const rows = db.prepare(sql).all(...params);

    return rows.map(r => ({
      ...r,
      payload: (() => {
        try { return JSON.parse(r.payload); }
        catch { return {}; }
      })()
    }));
  }
}
