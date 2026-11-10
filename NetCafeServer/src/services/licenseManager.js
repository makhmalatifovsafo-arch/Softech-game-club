/**
 * Softech Game Club Management System — SaaS Anti-Piracy, HWID Locking & Remote Kill-Switch
 * Location: NetCafeServer/src/services/licenseManager.js
 * 
 * Features:
 * - Hardware Binding (Strict HWID Enforcement)
 * - Remote Instant Kill-Switch (Persistent Cloud WebSocket & Lockdown Dispatch)
 * - 72-Hour Offline Grace Period with Anti-Tamper Monotonic Clock Guard
 * - Session Invalidation & Database Write Barrier
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { HwidService } from './hwidService.js';
import { resolveCloudUrl } from './cloudUrl.js';
import { readCloudResponse } from './cloudResponse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const LICENSE_FILE = path.resolve(DATA_DIR, 'softech_license.sig');
const LOCK_FILE = path.resolve(DATA_DIR, 'license_lock.json');
const CLOCK_GUARD_FILE = path.resolve(DATA_DIR, 'clock_guard.sec');

// Shared Cloud Crypto Salt
const CLOUD_MASTER_KEY = process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026';
const MAX_OFFLINE_LEASE_MS = 72 * 60 * 60 * 1000; // 72 soat
const ACTIVATION_RETRY_MS = 60000;
function installedVersion() {
  try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
}

export class LicenseManager {
  static state = 'PENDING_ACTIVATION'; // 'ACTIVE' | 'PENDING_ACTIVATION' | 'LOCKED_BY_ADMIN' | 'EXPIRED' | 'HWID_MISMATCH' | 'CLOCK_TAMPERED'
  static licenseData = null;
  static lockReason = '';
  static lockMessage = '';
  static cloudWs = null;
  static cloudUrl = process.env.SOFTECH_CLOUD_URL || 'https://softech-game-club.vercel.app';
  static cloudWsUrl = process.env.SOFTECH_CLOUD_WS || 'wss://softech-game-club.vercel.app/cloud-ws';
  static clientBroadcaster = null; // WebSocket broadcast handler to NetCafeClients
  static sessionDropper = null; // SessionScheduler hook
  static lastVerifiedCloudTimestamp = 0;
  static checkIntervalTimer = null;
  static activationRequestInFlight = false;
  static lastActivationAttempt = null;
  static pendingClubName = 'Yangi Game Club';

  /**
   * 1. Litsenziya tizimini initsializatsiya qilish (Server ishga tushganda chaqiriladi)
   */
  static init({ clientBroadcaster = null, sessionDropper = null, onLicenseActivated = null } = {}) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.clientBroadcaster = clientBroadcaster;
    this.sessionDropper = sessionDropper;
    this.onLicenseActivated = onLicenseActivated;

    let config = {};
    const configFile = path.resolve(__dirname, '../../config.json');
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }
    this.cloudUrl = resolveCloudUrl(config);
    this.cloudWsUrl = process.env.SOFTECH_CLOUD_WS || (new URL(this.cloudUrl).hostname.endsWith('.vercel.app') ? null : this.cloudUrl.replace(/^http/, 'ws') + '/cloud-ws');

    console.log(`🌐 [Anti-Piracy] Markaziy Cloud URL: ${this.cloudUrl}`);
    console.log('🔒 [Anti-Piracy] Softech HWID & Kill-Switch xavfsizlik dvigateli yuklanmoqda...');
    const currentHwid = HwidService.getHardwareFingerprint();
    console.log(`🖥️ [Anti-Piracy] Mashina HWID: ${currentHwid}`);

    // Mahalliy litsenziya faylini yuklash va tekshirish
    this.loadAndVerifyLocalLicense();

    // Soat orqaga surilishini (Clock Tampering) tekshirish
    this.verifyClockIntegrity();

    // Agar server yangi bo'lsa (PENDING_ACTIVATION), darhol Super Adminga Telegram so'rov yuborish
    if (this.state === 'PENDING_ACTIVATION') {
      this.requestActivation('Yangi Game Club');
      if (!this.approvalPollTimer) {
        this.approvalPollTimer = setInterval(() => {
          this.checkApprovalStatus();
        }, 5000);
      }
    }

    // Bulut bilan doimiy WebSocket va Kill-Switch aloqasini o'rnatish
    this.connectCloudWebSocket();
    this.cloudSyncTimer ??= setInterval(() => this.checkApprovalStatus(), 5000);

    // Har 60 soniyada litsenziya va vaqt holatini tekshiruvchi davriy monitoring
    if (!this.checkIntervalTimer) {
      this.checkIntervalTimer = setInterval(() => {
        this.periodicLicenseCheck();
      }, 60000);
    }
  }

  static async requestActivation(clubName = 'Softech Game Club') {
    if (this.activationRequestInFlight) return { success: false, error: 'Aktivatsiya so‘rovi yuborilmoqda. Biroz kuting.' };
    this.pendingClubName = clubName;
    this.lastActivationAttempt = Date.now();
    this.activationRequestInFlight = true;
    const hwid = HwidService.getHardwareFingerprint();
    const url = `${this.cloudUrl}/api/telemetry/activation-request`;
    try {
      console.log(`📡 [Activation] Bulutga faollashtirish so'rovi yuborilmoqda: ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clubName,
          hardwareFingerprint: hwid,
          totalPcs: 16,
          serverVersion: installedVersion()
        })
      });
      const data = await readCloudResponse(res);
      if (!res.ok || !data.success) throw new Error(data.error || 'Bulut litsenziya so\'rovini qabul qilmadi.');
      console.log('✅ [Activation] So\'rov muvaffaqiyatli yuborildi:', data.message || data);

      if (!this.approvalPollTimer) {
        this.approvalPollTimer = setInterval(() => {
          this.checkApprovalStatus();
        }, 4000);
      }

      return data;
    } catch (err) {
      console.warn('⚠️ [Activation] Bulutga so\'rov yuborishda xatolik:', err.message);
      return { success: false, error: err.message };
    } finally { this.activationRequestInFlight = false; }
  }

  static async activateWithKey(licenseKey) {
    if (!licenseKey || !licenseKey.trim()) {
      return { success: false, error: "Litsenziya kaliti kiritilishi shart." };
    }
    const hwid = HwidService.getHardwareFingerprint();
    const url = `${this.cloudUrl}/api/telemetry/activate-by-key`;

    try {
      console.log(`📡 [Activation] Bulutdan kalit bilan faollashtirish: ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: licenseKey.trim(),
          hardwareFingerprint: hwid,
          totalPcs: 16,
          serverVersion: installedVersion()
        })
      });

      const data = await readCloudResponse(res);
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Faollashtirib bo'lmadi" };
      }

      this.saveSignedLicense(data.signedLicense);
      const verified = this.state === 'ACTIVE';
      if (verified && this.approvalPollTimer) {
        clearInterval(this.approvalPollTimer);
        this.approvalPollTimer = null;
      }

      return {
        success: verified,
        message: verified ? "Litsenziya muvaffaqiyatli faollashtirildi!" : "Litsenziyani tasdiqlashda xatolik yuz berdi.",
        club: data.club
      };
    } catch (err) {
      console.warn('⚠️ [Activation] Kalit orqali faollashtirishda xatolik:', err.message);
      return { success: false, error: "Bulut serveriga ulanishda xatolik: " + err.message };
    }
  }

  static checkApprovalStatus() {
    if (this.approvalCheckPromise) return this.approvalCheckPromise;
    this.approvalCheckPromise = this.fetchApprovalStatus().finally(() => { this.approvalCheckPromise = null; });
    return this.approvalCheckPromise;
  }

  static async fetchApprovalStatus() {
    this.approvalCheckInFlight = true;
    try {
      const hwid = HwidService.getHardwareFingerprint();
      const res = await fetch(this.cloudUrl + '/api/telemetry/activation-status?hwid=' + encodeURIComponent(hwid), { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      const data = await readCloudResponse(res);
      if (!res.ok) throw new Error(data.error || 'Bulut javobida xatolik.');
      if (!['APPROVED', 'PENDING', 'NONE', 'REJECTED'].includes(data.status)) throw new Error('Bulut aktivatsiya holatini qaytarmadi.');
      this.lastApprovalStatus = data.status;
      if (data.status === 'APPROVED') {
        this.saveSignedLicense(data.signedLicense);
        if (this.approvalPollTimer) { clearInterval(this.approvalPollTimer); this.approvalPollTimer = null; }
      } else if (data.status === 'NONE' && this.licenseData) {
        this.enforceLockdown('CLUB_REMOVED', 'Klub markaziy tizimdan o‘chirilgan.');
      } else if (data.status === 'NONE' && this.state === 'PENDING_ACTIVATION' &&
                 !this.activationRequestInFlight &&
                 (this.lastActivationAttempt === null || Date.now() - this.lastActivationAttempt >= ACTIVATION_RETRY_MS)) {
        // Only retry unregistered installations. PENDING requests and known bans stay untouched.
        await this.requestActivation(this.pendingClubName);
      } else if (data.status === 'REJECTED') {
        if (this.state !== 'LOCKED_BY_ADMIN') this.enforceLockdown('REMOTE_BLOCKED', data.reason);
        else this.lockMessage = data.reason || 'So\'rov rad etildi.';
      }
      this.lastApprovalError = null;
    } catch (error) {
      this.lastApprovalError = error.message;
      console.warn('[License] Bulut tekshiruvi:', error.message);
    } finally { this.approvalCheckInFlight = false; }
  }

  /**
   * 2. Mahalliy imzolangan litsenziyani yuklash va HWID ga mosligini tekshirish
   */
  static loadAndVerifyLocalLicense() {
    if (!fs.existsSync(LICENSE_FILE)) {
      console.warn('⚠️ [Anti-Piracy] Litsenziya fayli topilmadi. Holat: PENDING_ACTIVATION');
      this.state = 'PENDING_ACTIVATION';
      this.lockMessage = "Ushbu server faollashtirilmagan. Super Admindan litsenziya so'rovi tasdiqlanishi kutilmoqda.";
      return false;
    }

    try {
      const raw = fs.readFileSync(LICENSE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const { payload, signature } = parsed;

      // 1. Imzoni tekshirish (HMAC-SHA256)
      const expectedSignature = crypto.createHmac('sha256', CLOUD_MASTER_KEY)
        .update(JSON.stringify(payload))
        .digest('hex');

      if (signature !== expectedSignature) {
        console.error('❌ [Anti-Piracy] Qalbaki yoki o\'zgartirilgan litsenziya imzosi aniqlandi!');
        this.enforceLockdown('INVALID_SIGNATURE', 'Litsenziya imzosi haqiqiy emas! Dastur nusxalangan bo\'lishi mumkin.');
        return false;
      }

      // 2. Hardware Binding tekshiruvi (HWID solishtirish)
      const currentHwid = HwidService.getHardwareFingerprint();
      const isWildcardHwid = !payload.hardwareFingerprint || 
                             payload.hardwareFingerprint === 'UNKNOWN' || 
                             payload.hardwareFingerprint.includes('UNKNOWN');

      if (isWildcardHwid) {
        console.log(`ℹ️ [Anti-Piracy] Birlamchi litsenziya ushbu qurilmaga (${currentHwid}) bog'lanmoqda...`);
        payload.hardwareFingerprint = currentHwid;
        const newSig = crypto.createHmac('sha256', CLOUD_MASTER_KEY).update(JSON.stringify(payload)).digest('hex');
        fs.writeFileSync(LICENSE_FILE, JSON.stringify({ payload, signature: newSig }, null, 2), 'utf8');
      } else if (payload.hardwareFingerprint !== currentHwid) {
        console.error(`❌ [Anti-Piracy] HWID mos kelmadi! Litsenziya: ${payload.hardwareFingerprint}, Joriy: ${currentHwid}`);
        this.enforceLockdown('HWID_MISMATCH', `Ushbu dastur boshqa mashinaga nusxalangan! Ushbu qurilma (${currentHwid}) uchun litsenziya berilmagan.`);
        this.state = 'HWID_MISMATCH';
        return false;
      }

      // 3. Muddatni tekshirish
      const expiresAt = new Date(payload.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
        console.warn('⚠️ [Anti-Piracy] Litsenziya muddati tugagan!');
        this.enforceLockdown('LICENSE_EXPIRED', 'Softech obuna muddati tugadi. Xizmatni davom ettirish uchun ta\'minotchi bilan bog\'laning: +998 95 222 06 44, +998 99 563 45 16');
        this.state = 'EXPIRED';
        return false;
      }

      // 4. Admin tomonidan bloklanganmi?
      if (payload.status === 'LOCKED_BY_ADMIN' || payload.status === 'SUSPENDED') {
        this.enforceLockdown('LOCKED_BY_ADMIN', payload.lockMessage || 'Litsenziya Super Admin tomonidan to\'xtatilgan.');
        return false;
      }

      if (fs.existsSync(LOCK_FILE)) {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        this.licenseData = payload;
        this.state = 'LOCKED_BY_ADMIN';
        this.lockReason = lock.reason;
        this.lockMessage = lock.message;
        return false;
      }
      // Muvaffaqiyatli
      this.licenseData = payload;
      this.state = 'ACTIVE';
      this.lockReason = '';
      this.lockMessage = '';
      this.lastVerifiedCloudTimestamp = Date.parse(payload.verifiedAt);
      if (!Number.isFinite(this.lastVerifiedCloudTimestamp)) {
        this.enforceLockdown('VERIFICATION_REQUIRED', 'Litsenziyani internet orqali qayta tasdiqlang.'); return false;
      }
      if (!this.verifyClockIntegrity()) return false;

      console.log(`✅ [Anti-Piracy] Litsenziya tasdiqlandi: "${payload.clubName || 'Klub'}" (Amal qilish muddati: ${new Date(payload.expiresAt).toLocaleDateString()})`);
      return true;
    } catch (err) {
      console.error('❌ [Anti-Piracy] Litsenziyani o\'qishda xatolik:', err);
      this.state = 'PENDING_ACTIVATION';
      return false;
    }
  }

  /**
   * 3. Soat tamg'asini tekshirish (Anti-Tamper Monotonic Clock Guard)
   * Club egasi 72 soatlik oflayn muddatni aldash uchun Windows soatini orqaga sursa darhol aniqlaydi!
   */
  static verifyClockIntegrity() {
    const now = Date.now();

    if (fs.existsSync(CLOCK_GUARD_FILE)) {
      try {
        const raw = fs.readFileSync(CLOCK_GUARD_FILE, 'utf8');
        const [lastTsStr, hmacStr] = raw.split(':');
        const lastTs = parseInt(lastTsStr, 10);

        // HMAC tekshirish
        const expectedHmac = crypto.createHmac('sha256', CLOUD_MASTER_KEY).update(lastTsStr).digest('hex').slice(0, 16);
        if (hmacStr === expectedHmac) {
          // Agar hozirgi vaqt oxirgi saqlangan vaqtdan 5 daqiqadan ko'proq orqada bo'lsa -> Rollback aniqlandi!
          if (now < lastTs - 300000) {
            console.error(`🚨 [Anti-Piracy] TIZIM SOATI ORQAGA SURILGAN! Joriy: ${new Date(now).toISOString()}, Oxirgi: ${new Date(lastTs).toISOString()}`);
            this.enforceLockdown('CLOCK_ROLLBACK', 'Tizim vaqti manipulyatsiyasi aniqlandi (Clock Rollback). Litsenziya xavfsizlik yuzasidan to\'xtatildi.');
            this.state = 'CLOCK_TAMPERED';
            return false;
          }
        }
      } catch (err) {}
    }

    // 72 soatlik oflayn muddatni tekshirish
    if (this.lastVerifiedCloudTimestamp > 0) {
      const offlineElapsed = now - this.lastVerifiedCloudTimestamp;
      if (offlineElapsed > MAX_OFFLINE_LEASE_MS) {
        console.error(`🚨 [Anti-Piracy] 72 soatlik oflayn muddat tugadi! Oxirgi cloud tasdiq: ${new Date(this.lastVerifiedCloudTimestamp).toISOString()}`);
        this.enforceLockdown('OFFLINE_LEASE_EXPIRED', '72 soatdan ortiq vaqt bulut bilan aloqa bo\'lmadi. Litsenziyani yangilash uchun internetni yoqing.');
        this.state = 'EXPIRED';
        return false;
      }
    }

    this.recordClockState();
    return true;
  }

  static recordClockState() {
    try {
      const now = Date.now().toString();
      const hmac = crypto.createHmac('sha256', CLOUD_MASTER_KEY).update(now).digest('hex').slice(0, 16);
      fs.writeFileSync(CLOCK_GUARD_FILE, `${now}:${hmac}`, 'utf8');
    } catch (err) {}
  }

  /**
   * 4. Bulut bilan doimiy WebSocket ulanish (Real-Time Kill-Switch Kanali)
   */
  static connectCloudWebSocket() {
    if (!this.cloudWsUrl) return;
    try {
      const currentHwid = HwidService.getHardwareFingerprint();
      const clubId = this.licenseData?.clubId || 1;
      const wsUrl = `${this.cloudWsUrl}?hwid=${encodeURIComponent(currentHwid)}&clubId=${clubId}`;

      console.log(`📡 [Anti-Piracy] Bulut bilan WebSocket ochilmoqda: ${wsUrl}`);
      this.cloudWs = new WebSocket(wsUrl);

      this.cloudWs.on('open', () => {
        console.log('⚡ [Anti-Piracy] Softech Cloud WebSocket kanali faol (Kill-Switch Tayyor).');
        // Identifikatsiya yuborish
        this.cloudWs.send(JSON.stringify({
          type: 'SERVER_HELLO',
          clubId,
          hwid: currentHwid,
          version: '1.0.1',
          uptime: os.uptime()
        }));
      });

      this.cloudWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleCloudMessage(msg);
        } catch (err) {
          console.warn('⚠️ [Anti-Piracy] Noto\'g\'ri cloud xabari:', err.message);
        }
      });

      this.cloudWs.on('close', () => {
        // 10 soniyadan so'ng qayta ulanish
        setTimeout(() => this.connectCloudWebSocket(), 10000);
      });

      this.cloudWs.on('error', () => {
        // Jim qayta ulanish
      });
    } catch (err) {
      setTimeout(() => this.connectCloudWebSocket(), 15000);
    }
  }

  /**
   * 5. Bulutdan kelgan buyruqlarni qayta ishlash
   */
  static handleCloudMessage(msg) {
    if (!msg || !msg.type) return;

    console.log(`📩 [Anti-Piracy] Bulutdan buyruq keldi: [${msg.type}]`);

    // A) DARHOL BLOKLASH (REMOTE EMERGENCY KILL-SWITCH)
    if (msg.type === 'EMERGENCY_LOCKDOWN' || msg.type === 'LOCK_CLUB_LICENSE') {
      const reason = msg.reason || 'PAYMENT_OVERDUE';
      const text = msg.message || "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16";
      this.enforceLockdown(reason, text);
      return;
    }

    // B) LITSENZIYANI FOLLASHTIRISH / YANGILASH (Super Admin Tasdiqlaganda)
    if (msg.type === 'LICENSE_ISSUED' || msg.type === 'ACTIVATION_APPROVED') {
      if (msg.signedLicense) {
        this.saveSignedLicense(msg.signedLicense);
        this.loadAndVerifyLocalLicense();
        console.log('🎉 [Anti-Piracy] Server muvaffaqiyatli faollashtirildi!');
      }
      return;
    }

    // C) TIZIMLI HEARTBEAT TASDIQI
    if (msg.type === 'HEARTBEAT_ACK') {
      // A transport acknowledgement is not a signed license renewal.
      this.checkApprovalStatus();
    }
  }

  /**
   * 6. REMOTE KILL-SWITCH IJROSI (Majburiy to'xtatish va barcha mijozlarni qulflash)
   */
  static enforceLockdown(reason, message) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ reason, message }), 'utf8');
    this.state = 'LOCKED_BY_ADMIN';
    this.lockReason = reason || 'PAYMENT_OVERDUE';
    this.lockMessage = message || "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16";

    console.error('================================================================');
    console.error(`🚫 [Anti-Piracy] EMERGENCY KILL-SWITCH FAOL! Sabab: ${this.lockReason}`);
    console.error(`📢 Xabar: ${this.lockMessage}`);
    console.error('================================================================');

    // 1. Faol seanslarni to'xtatish
    if (this.sessionDropper && typeof this.sessionDropper === 'function') {
      try {
        this.sessionDropper();
      } catch (err) {
        console.warn('⚠️ Seanslarni to\'xtatishda ogohlantirish:', err.message);
      }
    }

    // 2. Barcha NetCafeClient larni to'liq qulflash (Broadcasting to workstations)
    this.broadcastLockdownToWorkstations();
  }

  /**
   * Barcha ulangan NetCafeClient ishchi stansiyalariga bloklash buyrug'ini yuborish
   */
  static broadcastLockdownToWorkstations() {
    if (!this.clientBroadcaster || typeof this.clientBroadcaster !== 'function') return;

    const lockdownPayload = {
      type: 'EMERGENCY_LOCKDOWN',
      event: 'EMERGENCY_LOCKDOWN',
      reason: this.lockReason,
      message: this.lockMessage || "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16",
      supportPhone: '+998 95 222 06 44, +998 99 563 45 16',
      timestamp: Date.now()
    };

    try {
      this.clientBroadcaster(lockdownPayload);
      console.log('📡 [Anti-Piracy] Barcha mijoz kompyuterlariga EMERGENCY_LOCKDOWN yuborildi.');
    } catch (err) {
      console.warn('Mijozlarga xabar yuborishda xatolik:', err.message);
    }
  }

  /**
   * 7. Imzolangan litsenziyani saqlash
   */
  static saveSignedLicense(signedLicenseObj) {
    const payload = signedLicenseObj?.payload;
    if (!payload || typeof signedLicenseObj.signature !== 'string') throw new Error('Bulut imzolangan litsenziyani qaytarmadi.');
    const signature = crypto.createHmac('sha256', CLOUD_MASTER_KEY).update(JSON.stringify(payload)).digest('hex');
    if (signature !== signedLicenseObj.signature) throw new Error('Litsenziya imzosi mos emas. SOFTECH_CLOUD_KEY sozlamalarini tekshiring.');
    if (payload.hardwareFingerprint !== HwidService.getHardwareFingerprint()) throw new Error('Litsenziya boshqa kompyuter uchun.');
    if (payload.status !== 'ACTIVE' || !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= Date.now()) throw new Error('Litsenziya faol emas yoki muddati tugagan.');
    if (!Number.isInteger(Number(payload.clubId)) || Number(payload.clubId) <= 0) throw new Error('Klub ID noto\'g\'ri.');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const configFile = path.resolve(__dirname, '../../config.json');
    const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
    const changedClub = config.clubId !== payload.clubId;
    const wasActive = this.state === 'ACTIVE';
    config.clubId = payload.clubId;
    config.cloudUrl = this.cloudUrl;
    fs.writeFileSync(configFile + '.tmp', JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(configFile + '.tmp', configFile);
    fs.writeFileSync(LICENSE_FILE + '.tmp', JSON.stringify(signedLicenseObj, null, 2), 'utf8');
    fs.renameSync(LICENSE_FILE + '.tmp', LICENSE_FILE);
    fs.rmSync(LOCK_FILE, { force: true });
    this.loadAndVerifyLocalLicense();
    if (changedClub || !wasActive) this.onLicenseActivated?.(payload);
  }

  /**
   * 8. Davriy litsenziya tekshiruvi (Har 1 daqiqada)
   */
  static periodicLicenseCheck() {
    this.checkApprovalStatus();
    if (this.state === 'LOCKED_BY_ADMIN' || this.state === 'HWID_MISMATCH') {
      // Qulflangan holatda mijozlarga qulfni eslatib turish
      this.broadcastLockdownToWorkstations();
      return;
    }

    this.verifyClockIntegrity();

    if (this.licenseData && this.licenseData.expiresAt) {
      if (Date.now() > new Date(this.licenseData.expiresAt).getTime()) {
        this.enforceLockdown('LICENSE_EXPIRED', 'Litsenziya muddati tugadi.');
      }
    }
  }

  /**
   * 9. Litsenziya holatini tekshirish guard (API & DB operatsiyalari uchun)
   */
  static isOperational() {
    return this.state === 'ACTIVE';
  }

  static getSignedLicense() {
    try { return JSON.parse(fs.readFileSync(LICENSE_FILE,'utf8')); } catch { return null; }
  }

  static getStatusReport() {
    return {
      activationStatus: this.lastApprovalStatus || null,
      activationError: this.lastApprovalError || null,
      state: this.state,
      isOperational: this.isOperational(),
      hwid: HwidService.getHardwareFingerprint(),
      clubName: this.licenseData?.clubName || 'Noma\'lum',
      clubId: this.licenseData?.clubId || null,
      expiresAt: this.licenseData?.expiresAt || null,
      lockReason: this.lockReason,
      lockMessage: this.lockMessage,
      supportPhone: '+998 95 222 06 44, +998 99 563 45 16',
      lastVerifiedCloud: this.lastVerifiedCloudTimestamp ? new Date(this.lastVerifiedCloudTimestamp).toISOString() : null
    };
  }
}
