/**
 * Softech Game Club Management System — Supabase-Driven Cloud Licensing & Kill-Switch
 * Location: NetCafeServer/src/services/cloudLicenseService.js
 * 
 * Provides serverless, real-time central licensing and remote Kill-Switch engine
 * using Supabase Realtime (PostgreSQL replication over WebSocket).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { ClientManager } from './clientManager.js';
import { SessionScheduler } from './sessionScheduler.js';
import { LicenseManager } from './licenseManager.js';
import { db } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.resolve(__dirname, '../../config.json');

export class CloudLicenseService {
  static supabase = null;
  static clubId = 1;
  static supabaseUrl = '';
  static supabaseAnonKey = '';
  
  static isBlockedState = false;
  static status = 'ACTIVE';
  static lockReason = '';
  static lockMessage = "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16";
  static supportPhone = '+998 95 222 06 44, +998 99 563 45 16';

  static heartbeatTimer = null;
  static clubRealtimeChannel = null;
  static commandsRealtimeChannel = null;
  static isInitialized = false;

  /**
   * 1. Konfiguratsiyani o'qish (config.json yoki process.env)
   */
  static loadConfig() {
    let config = {};
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      } catch (err) {
        console.warn('⚠️ [CloudLicense] config.json o\'qishda xatolik:', err.message);
      }
    }

    this.supabaseUrl = process.env.SUPABASE_URL || config.supabaseUrl || 'https://xyzcompany.supabase.co';
    this.supabaseAnonKey = process.env.SUPABASE_ANON_KEY || config.supabaseAnonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mock_key_softech_2026';
    this.clubId = parseInt(process.env.CLUB_ID || config.clubId || 1, 10);

    return {
      supabaseUrl: this.supabaseUrl,
      supabaseAnonKey: this.supabaseAnonKey,
      clubId: this.clubId
    };
  }

  /**
   * 2. Supabase Realtime dvigatelini ishga tushirish
   */
  static async init() {
    if (this.isInitialized) return;
    this.loadConfig();

    console.log('================================================================');
    console.log('⚡ [Supabase-License] Bulut Litsenziya va Kill-Switch servisi yuklanmoqda...');
    console.log(`🏢 Klub ID: #${this.clubId}`);
    console.log(`🌐 Supabase URL: ${this.supabaseUrl}`);
    console.log('================================================================');

    // Agar URL mock bo'lsa yoki haqiqiy bo'lmasa, serverni to'xtatmasdan ogohlantirish beramiz
    const isMock = !this.supabaseUrl || this.supabaseUrl.includes('xyzcompany');

    try {
      this.supabase = createClient(this.supabaseUrl, this.supabaseAnonKey, {
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        }
      });

      if (!isMock) {
        // 1. Initial State Fetch
        await this.fetchInitialClubState();

        // 2. Realtime Obunalar (PostgreSQL UPDATE & INSERT)
        this.subscribeToRealtimeEvents();
      } else {
        console.log('ℹ️ [Supabase-License] Mock Supabase URL aniqlandi. Realtime sinov rejimida ishlaydi.');
      }
    } catch (err) {
      console.warn('⚠️ [Supabase-License] Supabase ulanishida ogohlantirish:', err.message);
    }

    // 3. Davriy Heartbeat (Har 30 soniyada)
    this.startHeartbeatSync(30000);
    this.isInitialized = true;
  }

  /**
   * 3. Boshlang'ich holatni Supabase dan tekshirish
   */
  static async fetchInitialClubState() {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase
        .from('clubs')
        .select('*')
        .eq('id', this.clubId)
        .single();

      if (error) {
        console.warn(`⚠️ [Supabase-License] Klub holatini o'qishda xatolik (#${this.clubId}):`, error.message);
        return;
      }

      if (data) {
        console.log(`✅ [Supabase-License] Klub holati: [${data.status}] (Nomi: ${data.name || 'Game Club'})`);
        if (data.status === 'BLOCKED' || data.status === 'SUSPENDED') {
          this.executeLockdown('REMOTE_BLOCKED', data.block_reason || "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16");
        } else if (data.status === 'ACTIVE') {
          this.liftLockdown();
        }
      }
    } catch (err) {
      console.warn('⚠️ [Supabase-License] Dastlabki tekshiruvda xatolik:', err.message);
    }
  }

  /**
   * 4. Realtime Obuna (Postgres UPDATE & INSERT tinglovchisi)
   */
  static subscribeToRealtimeEvents() {
    if (!this.supabase) return;

    // A) clubs jadvalidagi UPDATE hodisalari (id = eq.clubId)
    this.clubRealtimeChannel = this.supabase
      .channel(`club-license-channel-${this.clubId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'clubs',
          filter: `id=eq.${this.clubId}`
        },
        (payload) => {
          console.log(`⚡ [Supabase-Realtime] clubs jadvalidan o'zgarish keldi:`, payload.new?.status);
          this.handleClubRowUpdate(payload.new);
        }
      )
      .subscribe((status) => {
        console.log(`📡 [Supabase-Realtime] Club channel holati: ${status}`);
      });

    // B) remote_commands jadvalidagi INSERT hodisalari (Instant Action Triggers)
    this.commandsRealtimeChannel = this.supabase
      .channel(`club-commands-channel-${this.clubId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'remote_commands',
          filter: `club_id=eq.${this.clubId}`
        },
        (payload) => {
          console.log(`🚨 [Supabase-Realtime] Yangi masofaviy buyruq:`, payload.new?.command);
          this.handleRemoteCommand(payload.new);
        }
      )
      .subscribe((status) => {
        console.log(`⚡ [Supabase-Realtime] Commands channel holati: ${status}`);
      });
  }

  /**
   * 5. clubs qatori yangilanganda reaksiya
   */
  static handleClubRowUpdate(clubRow) {
    if (!clubRow) return;

    const newStatus = (clubRow.status || '').toUpperCase();
    const reason = clubRow.block_reason || clubRow.lock_reason || "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16";

    if (newStatus === 'BLOCKED' || newStatus === 'SUSPENDED') {
      this.executeLockdown('BLOCKED_BY_SUPERADMIN', reason);
    } else if (newStatus === 'ACTIVE') {
      this.liftLockdown();
    }
  }

  /**
   * 6. remote_commands jadvalidan buyruq kelganda
   */
  static async handleRemoteCommand(commandRow) {
    if (!commandRow) return;

    const cmd = (commandRow.command || commandRow.action || '').toUpperCase();
    const reason = commandRow.reason || commandRow.payload?.reason || "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16";

    if (cmd === 'LOCK_DOWN' || cmd === 'LOCK' || cmd === 'EMERGENCY_LOCKDOWN') {
      this.executeLockdown('REMOTE_LOCKDOWN_COMMAND', reason);
      await this.markCommandExecuted(commandRow.id);
    } else if (cmd === 'UNLOCK' || cmd === 'ACTIVATE') {
      this.liftLockdown();
      await this.markCommandExecuted(commandRow.id);
    }
  }

  static async markCommandExecuted(commandId) {
    if (!this.supabase || !commandId) return;
    try {
      await this.supabase
        .from('remote_commands')
        .update({
          status: 'EXECUTED',
          executed_at: new Date().toISOString()
        })
        .eq('id', commandId);
    } catch (err) {}
  }

  /**
   * 7. SHOSHILINCH BLOKLASH IJROSI (KILL-SWITCH)
   * a) Broadcast FORCE_CLIENT_LOCKDOWN immediately to all connected NetCafeClient kiosks.
   * b) Block all active cashier session actions (return HTTP 403: "License Suspended").
   * c) Render unbypassable modal on Cashier Cockpit: "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16".
   */
  static executeLockdown(reasonCode, customMessage) {
    this.isBlockedState = true;
    this.status = 'BLOCKED';
    this.lockReason = reasonCode || 'LICENSE_SUSPENDED';
    this.lockMessage = customMessage || "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16";

    console.error('================================================================');
    console.error(`🚨 [CloudLicense] SHOSHILINCH KILL-SWITCH ISHGA TUSHDI!`);
    console.error(`⚠️ Sabab: ${this.lockReason}`);
    console.error(`📢 Xabar: ${this.lockMessage}`);
    console.error('================================================================');

    // 1. Barcha aktiv seanslarni to'xtatish
    try {
      SessionScheduler.dropAllActiveSessions();
    } catch (err) {
      console.warn('⚠️ Seanslarni yopishda xatolik:', err.message);
    }

    // 2. Barcha mijoz kompyuterlariga FORCE_CLIENT_LOCKDOWN yuborish
    try {
      const payload = {
        type: 'FORCE_CLIENT_LOCKDOWN',
        event: 'FORCE_CLIENT_LOCKDOWN',
        reason: this.lockReason,
        message: this.lockMessage,
        supportPhone: this.supportPhone,
        timestamp: Date.now()
      };

      ClientManager.broadcast('FORCE_CLIENT_LOCKDOWN', payload);
      ClientManager.broadcast('EMERGENCY_LOCKDOWN', payload);
      console.log('📡 [CloudLicense] Barcha mijoz kompyuterlariga FORCE_CLIENT_LOCKDOWN tarqatildi.');
    } catch (err) {
      console.warn('⚠️ Mijozlarga lockdown xabarini yuborishda xatolik:', err.message);
    }

    // 3. LicenseManager bilan sinxronizatsiya
    try {
      LicenseManager.enforceLockdown('LOCKED_BY_ADMIN', this.lockMessage);
    } catch (err) {}
  }

  /**
   * 8. Blokdan chiqarish (Qulfdan chiqarish)
   */
  static liftLockdown() {
    if (!this.isBlockedState && this.status === 'ACTIVE') return;

    this.isBlockedState = false;
    this.status = 'ACTIVE';
    this.lockReason = '';
    this.lockMessage = '';

    console.log('================================================================');
    console.log('✅ [CloudLicense] Klub litsenziyasi QAYTA FAOLLASHTIRILDI!');
    console.log('================================================================');

    try {
      LicenseManager.state = 'ACTIVE';
      LicenseManager.lockReason = '';
      LicenseManager.lockMessage = '';
    } catch (err) {}

    // Mijozlarga qulfdan chiqish haqida xabar berish
    try {
      ClientManager.broadcast('LOCKDOWN_LIFTED', {
        status: 'ACTIVE',
        message: "Litsenziya faollashtirildi.",
        timestamp: Date.now()
      });
    } catch (err) {}
  }

  /**
   * 9. Heartbeat Sync (Har 30 soniyada Supabase ga telemetriya jo'natish)
   */
  static startHeartbeatSync(intervalMs = 30000) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Dastlabki birinchi chaqiriq
    this.sendHeartbeat().catch(() => {});

    this.heartbeatTimer = setInterval(async () => {
      await this.sendHeartbeat();
    }, intervalMs);
  }

  static async sendHeartbeat() {
    if (!this.supabase) return;

    try {
      // 1. Bugungi tushum (Seanslar + Bar)
      let todayRevenue = 0;
      try {
        const todayRow = db.prepare(`
          SELECT 
            COALESCE(SUM(total_price), 0) as sessions_rev 
          FROM sessions 
          WHERE DATE(started_at) = DATE('now', 'localtime')
        `).get();
        todayRevenue = todayRow ? Number(todayRow.sessions_rev) : 0;
      } catch (err) {}

      // 2. Kompyuterlar soni va bandligi
      let totalPcs = 16;
      let occupiedCount = 0;
      let onlineCount = 0;

      try {
        const pcs = db.prepare('SELECT id, status, is_online FROM computers').all();
        totalPcs = pcs.length || 16;
        occupiedCount = pcs.filter(p => p.status === 'OCCUPIED').length;
        onlineCount = pcs.filter(p => p.is_online === 1 || p.status === 'OCCUPIED' || p.status === 'AVAILABLE').length;
      } catch (err) {
        occupiedCount = 0;
      }

      // 3. Supabase ga UPDATE jo'natish
      const nowIso = new Date().toISOString();
      const { error } = await this.supabase
        .from('clubs')
        .update({
          last_heartbeat: nowIso,
          last_heartbeat_at: nowIso,
          today_revenue: todayRevenue,
          occupied_pcs: occupiedCount,
          online_pcs: onlineCount,
          total_pcs: totalPcs
        })
        .eq('id', this.clubId);

      if (error) {
        // Log quietly
      } else {
        // console.log(`💓 [Supabase-Heartbeat] Sync muvaffaqiyatli: ${nowIso} (Daromad: ${todayRevenue} UZS, PC: ${occupiedCount}/${totalPcs})`);
      }
    } catch (err) {
      // Offline or network error handled gracefully
    }
  }

  /**
   * 10. Operational holat tekshiruvi (API lar uchun guard)
   */
  static isOperational() {
    return !this.isBlockedState && this.status === 'ACTIVE';
  }

  static isBlocked() {
    return this.isBlockedState || this.status === 'BLOCKED' || this.status === 'SUSPENDED';
  }

  static getStatus() {
    return this.status;
  }

  static getLockReason() {
    return this.lockReason;
  }

  static getSupportPhone() {
    return this.supportPhone;
  }

  static stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.clubRealtimeChannel) {
      this.clubRealtimeChannel.unsubscribe();
      this.clubRealtimeChannel = null;
    }
    if (this.commandsRealtimeChannel) {
      this.commandsRealtimeChannel.unsubscribe();
      this.commandsRealtimeChannel = null;
    }
    this.isInitialized = false;
  }
}
