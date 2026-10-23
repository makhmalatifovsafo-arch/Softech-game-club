/**
 * Softech Super Admin — Central Supabase Client & PostgreSQL Data Engine
 * Location: SoftechCloudAdmin/src/services/supabaseClient.js
 * 
 * Provides production-ready serverless integration with Supabase for Vercel deployment:
 * - Real-Time PostgreSQL queries
 * - Instant Kill-Switch & Remote Command queueing
 * - Telemetry & Heartbeat Ingestion
 * - SaaS Recurring Billing & Payments
 * - Fallback to local SQLite when running offline
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export class SupabaseCloudService {
  static client = null;

  static isConfigured() {
    return Boolean(
      SUPABASE_URL && 
      !SUPABASE_URL.includes('xyzcompany') && 
      SUPABASE_KEY && 
      !SUPABASE_KEY.includes('mock_key')
    );
  }

  static getClient() {
    if (!this.client && this.isConfigured()) {
      this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
    }
    return this.client;
  }

  // ==========================================================================
  // 1. SUPER ADMIN AUTENTIFIKATSIYASI
  // ==========================================================================

  static async verifySuperAdminCredentials(username, password) {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('super_admins')
        .select('*')
        .eq('username', username.trim().toLowerCase())
        .maybeSingle();

      if (error || !data) return null;

      // Parol tekshiruvi (PBKDF2)
      const isPasswordValid = this.verifyPbkdf2(password, data.password_hash);
      if (!isPasswordValid) return null;

      return {
        id: data.id,
        username: data.username,
        fullName: data.full_name,
        phone: data.phone,
        role: 'superadmin'
      };
    } catch (err) {
      console.warn('⚠️ [Supabase Auth] Login xatosi:', err.message);
      return null;
    }
  }

  static async verifyPinCode(pinCode) {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('super_admins')
        .select('*')
        .eq('pin_code', String(pinCode).trim())
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      return {
        id: data.id,
        username: data.username,
        fullName: data.full_name,
        phone: data.phone,
        role: 'superadmin'
      };
    } catch (err) {
      console.warn('⚠️ [Supabase Auth] PIN tekshirishda xatolik:', err.message);
      return null;
    }
  }

  // ==========================================================================
  // 2. KLUBLAR VA TELEMETRIYA (CLUBS & METRICS)
  // ==========================================================================

  static async getAllClubs() {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('clubs')
        .select('*')
        .order('id', { ascending: true });

      if (error) throw error;

      return (data || []).map(club => {
        const isOnline = this.isHeartbeatOnline(club.last_heartbeat_at || club.last_heartbeat);
        return {
          ...club,
          is_online_now: isOnline,
          status_display: isOnline ? (club.status === 'ACTIVE' ? 'ONLINE' : club.status) : 'OFFLINE'
        };
      });
    } catch (err) {
      console.warn('⚠️ [Supabase] Klublar ro\'yxatini olishda xatolik:', err.message);
      return null;
    }
  }

  static async getClubById(clubId) {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('clubs')
        .select('*')
        .eq('id', clubId)
        .maybeSingle();

      if (error || !data) return null;
      return {
        ...data,
        is_online_now: this.isHeartbeatOnline(data.last_heartbeat_at || data.last_heartbeat)
      };
    } catch (err) {
      return null;
    }
  }

  static async registerClub(clubData) {
    const client = this.getClient();
    if (!client) return null;

    const slug = clubData.slug || clubData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const secretToken = `softech_sec_${slug}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    const insertRow = {
      name: clubData.name.trim(),
      slug,
      owner_name: clubData.ownerName?.trim() || 'Filial Menejeri',
      owner_phone: clubData.ownerPhone?.trim() || '+998 90 123 45 67',
      city: clubData.city?.trim() || 'Toshkent',
      status: 'ACTIVE',
      total_workstations: parseInt(clubData.totalWorkstations, 10) || 16,
      api_secret_token: secretToken,
      license_expires_at: expiresAt,
      tariff_type: clubData.tariffType || 'PER_PC',
      tariff_price_per_pc: parseFloat(clubData.tariffPricePerPc) || 20000.0,
      tariff_fixed_price: parseFloat(clubData.tariffFixedPrice) || 500000.0
    };

    try {
      const { data, error } = await client
        .from('clubs')
        .insert(insertRow)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('⚠️ [Supabase] Yangi klub qo\'shishda xatolik:', err.message);
      throw err;
    }
  }

  static async deleteClub(clubId) {
    const client = this.getClient();
    if (client) {
      try {
        await client.from('club_workstations_cache').delete().eq('club_id', clubId);
        await client.from('club_metrics').delete().eq('club_id', clubId);
        await client.from('remote_commands').delete().eq('club_id', clubId);
        await client.from('subscription_payments').delete().eq('club_id', clubId);
        await client.from('clubs').delete().eq('id', clubId);
      } catch (err) {
        console.warn('⚠️ [Supabase] deleteClub xatosi:', err.message);
      }
    }

    try {
      const { db } = await import('../db/connection.js');
      if (db && typeof db.prepare === 'function') {
        db.prepare('DELETE FROM club_workstations_cache WHERE club_id = ?').run(clubId);
        db.prepare('DELETE FROM club_metrics WHERE club_id = ?').run(clubId);
        db.prepare('DELETE FROM remote_commands WHERE club_id = ?').run(clubId);
        db.prepare('DELETE FROM subscription_payments WHERE club_id = ?').run(clubId);
        db.prepare('DELETE FROM clubs WHERE id = ?').run(clubId);
      }
    } catch (e) {}

    return true;
  }

  static async clearAllDemoClubs() {
    const client = this.getClient();
    if (client) {
      try {
        await client.from('club_workstations_cache').delete().neq('id', 0);
        await client.from('club_metrics').delete().neq('id', 0);
        await client.from('remote_commands').delete().neq('id', 0);
        await client.from('subscription_payments').delete().neq('id', 0);
        await client.from('clubs').delete().neq('id', 0);
      } catch (err) {
        console.warn('⚠️ [Supabase] clearAllDemoClubs xatosi:', err.message);
      }
    }

    try {
      const { db } = await import('../db/connection.js');
      if (db && typeof db.prepare === 'function') {
        db.prepare('DELETE FROM club_workstations_cache').run();
        db.prepare('DELETE FROM club_metrics').run();
        db.prepare('DELETE FROM remote_commands').run();
        db.prepare('DELETE FROM subscription_payments').run();
        db.prepare('DELETE FROM clubs').run();
      }
    } catch (e) {}

    return true;
  }

  // ==========================================================================
  // 3. TELEMETRIYA INGESTION & JONLI HEARTBEAT
  // ==========================================================================

  static async ingestHeartbeat(tokenOrClubId, payload) {
    const client = this.getClient();
    if (!client) return null;

    const nowIso = new Date().toISOString();

    try {
      // 1. Klubni aniqlash
      let query = client.from('clubs').select('*');
      if (typeof tokenOrClubId === 'number' || !isNaN(Number(tokenOrClubId))) {
        query = query.eq('id', Number(tokenOrClubId));
      } else {
        query = query.eq('api_secret_token', String(tokenOrClubId).trim());
      }

      const { data: club, error: findError } = await query.maybeSingle();
      if (findError || !club) return { success: false, error: 'Klub topilmadi yoki token xato' };

      // 2. Ko'rsatkichlarni yangilash
      const updateData = {
        last_heartbeat: nowIso,
        last_heartbeat_at: nowIso,
        server_version: payload.appVersion || club.server_version,
        online_pcs: parseInt(payload.onlinePcsCount, 10) || 0,
        occupied_pcs: parseInt(payload.occupiedPcsCount, 10) || 0,
        today_revenue: parseFloat(payload.todayRevenue) || club.today_revenue,
        updated_at: nowIso
      };

      if (payload.serverLanIp) updateData.server_lan_ip = payload.serverLanIp;
      if (payload.hardwareFingerprint) updateData.hardware_fingerprint = payload.hardwareFingerprint;

      await client.from('clubs').update(updateData).eq('id', club.id);

      // 3. Kutilayotgan buyruqlarni olish (PENDING)
      const { data: pendingCommands } = await client
        .from('remote_commands')
        .select('*')
        .eq('club_id', club.id)
        .eq('status', 'PENDING');

      // 4. Kompyuterlar matritsasini yangilash
      if (Array.isArray(payload.workstations)) {
        for (const ws of payload.workstations) {
          await client.from('club_workstations_cache').upsert({
            club_id: club.id,
            pc_number: ws.pc,
            status: ws.status || 'AVAILABLE',
            minutes_left: ws.minutesLeft || 0,
            updated_at: nowIso
          }, { onConflict: 'club_id,pc_number' });
        }
      }

      return {
        status: 'OK',
        clubId: club.id,
        clubStatus: club.status,
        pendingCommands: pendingCommands || []
      };
    } catch (err) {
      console.warn('⚠️ [Supabase Telemetry] Heartbeat ingestion xatosi:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ==========================================================================
  // 4. MASOFADAN BOSHQARISH & KILL-SWITCH (REMOTE COMMANDS)
  // ==========================================================================

  static async blockClub(clubId, reason = "Oylik obuna to'lovi to'lanmagan") {
    const client = this.getClient();
    const nowIso = new Date().toISOString();

    if (!client) {
      return { success: true, clubId, status: 'BLOCKED', isMock: true };
    }

    try {
      // 1. Statusni BLOCKED qilish
      await client
        .from('clubs')
        .update({
          status: 'BLOCKED',
          block_reason: reason,
          updated_at: nowIso
        })
        .eq('id', clubId);

      // 2. remote_commands ga LOCK_DOWN kiritish
      const { data: cmdData } = await client
        .from('remote_commands')
        .insert({
          club_id: clubId,
          command: 'LOCK_DOWN',
          command_type: 'LOCK_CLUB_LICENSE',
          payload: {
            reason,
            timestamp: Date.now(),
            message: "Dastur litsenziyasi to'xtatilgan. Bog'lanish: +998 95 222 06 44, +998 99 563 45 16"
          },
          status: 'PENDING'
        })
        .select()
        .single();

      console.log(`🚨 [Supabase Kill-Switch] Klub #${clubId} BLOCKED qilindi!`);
      return { success: true, clubId, status: 'BLOCKED', commandId: cmdData?.id };
    } catch (err) {
      console.error('⚠️ [Supabase] blockClub xatosi:', err.message);
      throw err;
    }
  }

  static async unblockClub(clubId, days = 30) {
    const client = this.getClient();
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

    if (!client) {
      return { success: true, clubId, status: 'ACTIVE', expiresAt, isMock: true };
    }

    try {
      await client
        .from('clubs')
        .update({
          status: 'ACTIVE',
          license_expires_at: expiresAt,
          block_reason: null,
          updated_at: nowIso
        })
        .eq('id', clubId);

      const { data: cmdData } = await client
        .from('remote_commands')
        .insert({
          club_id: clubId,
          command: 'UNLOCK',
          command_type: 'UNLOCK_CLUB_LICENSE',
          payload: {
            days,
            expiresAt,
            message: "Litsenziya muvaffaqiyatli faollashtirildi."
          },
          status: 'PENDING'
        })
        .select()
        .single();

      console.log(`✅ [Supabase Kill-Switch] Klub #${clubId} QAYTA FAOLLASHTIRILDI!`);
      return { success: true, clubId, status: 'ACTIVE', expiresAt, commandId: cmdData?.id };
    } catch (err) {
      console.error('⚠️ [Supabase] unblockClub xatosi:', err.message);
      throw err;
    }
  }

  static async queueRemoteCommand(clubId, commandType, payload = {}) {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('remote_commands')
        .insert({
          club_id: clubId,
          command: commandType,
          command_type: commandType,
          payload,
          status: 'PENDING'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('⚠️ [Supabase] queueRemoteCommand xatosi:', err.message);
      throw err;
    }
  }

  static async markCommandExecuted(commandId) {
    const client = this.getClient();
    if (!client || !commandId) return;

    try {
      await client
        .from('remote_commands')
        .update({
          status: 'EXECUTED',
          executed_at: new Date().toISOString()
        })
        .eq('id', commandId);
    } catch (err) {}
  }

  // ==========================================================================
  // 5. SAAS BILLING & TO'LOVLAR (SUBSCRIPTIONS)
  // ==========================================================================

  static async recordSubscriptionPayment(paymentData) {
    const client = this.getClient();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('subscription_payments')
        .insert({
          club_id: paymentData.clubId,
          amount: parseFloat(paymentData.amount) || 0,
          payment_method: paymentData.paymentMethod || 'CLICK',
          months_added: parseInt(paymentData.monthsAdded, 10) || 1,
          previous_expiry_date: paymentData.previousExpiryDate,
          new_expiry_date: paymentData.newExpiryDate,
          notes: paymentData.notes || '',
          recorded_by: paymentData.recordedBy || 'superadmin'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('⚠️ [Supabase] recordSubscriptionPayment xatosi:', err.message);
      throw err;
    }
  }

  // ==========================================================================
  // YORDAMCHI METODLAR
  // ==========================================================================

  static isHeartbeatOnline(lastHeartbeatIso) {
    if (!lastHeartbeatIso) return false;
    const diffSeconds = (Date.now() - new Date(lastHeartbeatIso).getTime()) / 1000;
    return diffSeconds <= 90;
  }

  static verifyPbkdf2(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    try {
      const [salt, originalHash] = storedHash.split(':');
      const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(verifyHash, 'hex'));
    } catch {
      return false;
    }
  }
}
