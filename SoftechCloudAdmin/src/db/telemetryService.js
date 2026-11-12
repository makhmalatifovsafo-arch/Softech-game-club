import {mergeFinancialReports,localFinancialReports} from '../services/financialTelemetry.js';
import { formatClubInspector } from '../services/clubInspector.js';
import crypto from 'node:crypto';
import { db, initDatabase, hashPassword, verifyPassword } from './connection.js';

/**
 * Unikal SOFTECH-LICENSE-XXXX-XXXX litsenziya kaliti yaratish
 */
export function generateLicenseKey() {
  const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `SOFTECH-LICENSE-${p1}-${p2}`;
}

/**
 * TelemetryService — Markaziy SaaS Telemetriya va Klublarni Boshqarish Xizmati
 */
export class TelemetryService {
  /**
   * 1. Yangi mijoz Game Clubni ro'yxatdan o'tkazish (Onboarding)
   */
  static registerClub({
    name,
    slug,
    ownerName,
    owner_name,
    ownerPhone,
    owner_phone,
    city = 'Toshkent',
    district = '',
    licenseType = 'MONTHLY', // 'TRIAL' | 'MONTHLY' | 'ANNUAL'
    licenseDays = 30,
    licenseExpiresAt,
    license_expires_at,
    totalWorkstations = 16,
    total_workstations,
    serverLanIp = null,
    server_lan_ip,
    serverVersion = '1.0.1',
    server_version,
    apiSecretToken = null,
    api_secret_token = null,
    tariffType = 'PER_PC',
    tariffPricePerPc = 20000,
    tariffFixedPrice = 500000
  }) {
    const finalOwnerName = ownerName || owner_name || "Noma'lum";
    const finalOwnerPhone = ownerPhone || owner_phone || '';
    const finalTotalWorkstations = parseInt(totalWorkstations || total_workstations || 16, 10);
    const finalLanIp = serverLanIp || server_lan_ip || '192.168.1.100';
    const finalVersion = serverVersion || server_version || '1.0.1';
    const finalCity = district ? `${city} (${district})` : city;

    // Unikal SOFTECH-LICENSE-XXXX-XXXX kaliti
    const finalToken = apiSecretToken || api_secret_token || generateLicenseKey();

    // Litsenziya turi va muddati
    let days = parseInt(licenseDays, 10);
    let initialStatus = 'ACTIVE';
    if (licenseType === 'TRIAL') {
      days = days || 7;
      initialStatus = 'TRIAL';
    } else if (licenseType === 'ANNUAL') {
      days = days || 365;
    } else {
      days = days || 30;
    }

    let finalExpiresAt = licenseExpiresAt || license_expires_at;
    if (!finalExpiresAt) {
      const expDate = new Date(Date.now() + days * 24 * 3600 * 1000);
      finalExpiresAt = expDate.toISOString();
    }

    // Slug hosil qilish (agar berilmagan bo'lsa)
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const finalSlug = (slug || (baseSlug || 'club')) + '-' + Math.floor(100 + Math.random() * 900);

    const stmt = db.prepare(`
      INSERT INTO clubs (
        name, slug, owner_name, owner_phone, city, status, 
        license_expires_at, total_workstations, server_lan_ip, server_version,
        api_secret_token, tariff_type, tariff_price_per_pc, tariff_fixed_price,
        last_heartbeat_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const result = stmt.run(
      name,
      finalSlug,
      finalOwnerName,
      finalOwnerPhone,
      finalCity,
      initialStatus,
      finalExpiresAt,
      finalTotalWorkstations,
      finalLanIp,
      finalVersion,
      finalToken,
      tariffType || 'PER_PC',
      parseFloat(tariffPricePerPc) || 20000.0,
      parseFloat(tariffFixedPrice) || 500000.0
    );

    const createdId = Number(result.lastInsertRowid);

    // Inventory is populated only by the club server, never from its license limit.

    // Boshlang'ich kunlik metrika yozuvi
    const todayStr = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
    db.prepare(`
      INSERT OR IGNORE INTO club_metrics (
        club_id, record_date, total_daily_revenue, total_sessions_count, total_play_hours, bar_revenue, peak_concurrent_pcs
      ) VALUES (?, ?, 0, 0, 0, 0, 0)
    `).run(createdId, todayStr);

    return this.getClubById(createdId);
  }

  /**
   * 2. Klub serveridan kelgan Heartbeat (puls) telemetriyasini qabul qilish va yangilash
   */
  static updateClubHeartbeat(clubId, {
    serverLanIp,
    server_lan_ip,
    serverVersion,
    server_version,
    totalWorkstations,
    total_workstations,
    workstations,
    dailyMetrics = null
  } = {}) {
    const club = this.getClubById(clubId);
    if (!club) {
      throw new Error(`Klub topilmadi (ID: ${clubId})`);
    }

    const lanIp = serverLanIp || server_lan_ip || club.server_lan_ip;
    const version = serverVersion || server_version || club.server_version;
    const totalPcs = club.total_workstations;

    // Klub holatini tekshirish (Litsenziya muddati o'tgan bo'lsa SUSPENDED_PAYMENT)
    const isLicenseExpired = new Date(club.license_expires_at).getTime() < Date.now();
    const newStatus = isLicenseExpired ? 'SUSPENDED_PAYMENT' : 'ACTIVE';

    // 1. Klub heartbeat ma'lumotlarini yangilash
    db.prepare(`
      UPDATE clubs
      SET last_heartbeat_at = CURRENT_TIMESTAMP,
          status = ?,
          server_lan_ip = ?,
          server_version = ?,
          total_workstations = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, lanIp, version, totalPcs, clubId);

    // 2. Agar ishchi o'rinlari (workstations) ro'yxati yuborilgan bo'lsa, keshni yangilaymiz
    if (Array.isArray(workstations)) {
      this.syncWorkstationsCache(clubId, workstations);
    }

    // 3. Agar kunlik kassa ma'lumotlari kelgan bo'lsa, yozib boramiz
    if (dailyMetrics) {
      const todayStr = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
      this.recordDailyMetrics(clubId, {
        recordDate: todayStr,
        ...dailyMetrics
      });
    }

    return {
      success: true,
      clubId,
      status: newStatus,
      isLicenseExpired,
      lastHeartbeatAt: new Date().toISOString()
    };
  }

  /**
   * 3. Butun SaaS tarmog'i bo'yicha global umumiy metrikalarni hisoblash (Cockpit KPI)
   */
  static getGlobalMetricsSummary() {
    const todayStr = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});

    // Klublar soni va holati
    const clubStats = db.prepare(`
      SELECT 
        COUNT(*) as total_clubs,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_clubs,
        SUM(CASE WHEN status = 'SUSPENDED_PAYMENT' THEN 1 ELSE 0 END) as suspended_clubs,
        SUM(CASE WHEN status = 'TRIAL' THEN 1 ELSE 0 END) as trial_clubs,
        SUM(total_workstations) as total_network_pcs
      FROM clubs
    `).get();

    // Bugungi jami kassa va seanslar
    const dayMetrics=mergeFinancialReports(db.prepare('SELECT * FROM club_metrics WHERE record_date=?').all(todayStr),localFinancialReports(db,todayStr,todayStr));
    const revenueStats=dayMetrics.reduce((r,m)=>({total_today_revenue:r.total_today_revenue+Number(m.total_daily_revenue||0),total_bar_revenue:r.total_bar_revenue+Number(m.bar_revenue||0),total_sessions_count:r.total_sessions_count+Number(m.total_sessions_count||0),total_play_hours:r.total_play_hours+Number(m.total_play_hours||0)}),{total_today_revenue:0,total_bar_revenue:0,total_sessions_count:0,total_play_hours:0});

    // Real-time kompyuterlar holati keshdan
    const pcStats = db.prepare(`
      SELECT 
        COUNT(*) as cached_pcs_count,
        SUM(CASE WHEN status = 'OCCUPIED' THEN 1 ELSE 0 END) as occupied_pcs,
        SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available_pcs,
        SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) as offline_pcs
      FROM club_workstations_cache
    `).get();

    // So'nggi 24 soat ichida aloqaga chiqqan klublar
    const onlineClubsCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM clubs 
      WHERE last_heartbeat_at >= datetime('now', '-5 minutes')
    `).get();

    return {
      date: todayStr,
      clubs: {
        total: Number(clubStats?.total_clubs || 0),
        active: Number(clubStats?.active_clubs || 0),
        suspended: Number(clubStats?.suspended_clubs || 0),
        trial: Number(clubStats?.trial_clubs || 0),
        onlineNow: Number(onlineClubsCount?.count || 0)
      },
      revenue: {
        todayTotal: Number(revenueStats?.total_today_revenue || 0),
        barTotal: Number(revenueStats?.total_bar_revenue || 0),
        sessionsCount: Number(revenueStats?.total_sessions_count || 0),
        playHours: Number(revenueStats?.total_play_hours || 0)
      },
      workstations: {
        totalNetwork: Number(pcStats?.cached_pcs_count || 0),
        occupiedNow: Number(pcStats?.occupied_pcs || 0),
        availableNow: Number(pcStats?.available_pcs || 0),
        offlineNow: Number(pcStats?.offline_pcs || 0)
      }
    };
  }

  /**
   * 4. Klub serveriga masofaviy boshqaruv buyrug'ini navbatga qo'yish
   */
  static queueRemoteCommand(clubId, commandType, payload = {}) {
    const validCommands = ['RESET_ADMIN_PASSWORD', 'LOCK_CLUB_LICENSE', 'UNLOCK_CLUB_LICENSE', 'FORCE_UPDATE', 'RESTART_SERVER', 'BROADCAST_ANNOUNCEMENT'];
    if (!validCommands.includes(commandType)) {
      throw new Error(`Noto'g'ri buyruq turi: ${commandType}`);
    }

    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const stmt = db.prepare(`
      INSERT INTO remote_commands (club_id, command_type, payload, status)
      VALUES (?, ?, ?, 'PENDING')
    `);

    const result = stmt.run(clubId, commandType, payloadStr);
    const commandId = Number(result.lastInsertRowid);

    return {
      id: commandId,
      clubId,
      commandType,
      payload,
      status: 'PENDING',
      createdAt: new Date().toISOString()
    };
  }

  /**
   * 5. Klub serveri tomonidan o'ziga tegishli kutilayotgan buyruqlarni olish
   */
  static getPendingCommandsForClub(clubId) {
    const rows = db.prepare(`
      SELECT id, club_id, command_type, payload, status, created_at
      FROM remote_commands
      WHERE club_id = ? AND status = 'PENDING'
      ORDER BY id ASC
    `).all(clubId);

    return rows.map(r => ({
      ...r,
      payload: (() => {
        try { return JSON.parse(r.payload); }
        catch { return {}; }
      })()
    }));
  }

  /**
   * 6. Buyruq bajarilganligini qayd etish
   */
  static markCommandExecuted(commandId, status = 'EXECUTED') {
    db.prepare(`
      UPDATE remote_commands
      SET status = ?, executed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, commandId);

    return { id: commandId, status, executedAt: new Date().toISOString() };
  }

  /**
   * 7. Ishchi o'rinlari (PC) holatini kesh bilan sinxronizatsiya qilish
   */
  static syncWorkstationsCache(clubId, workstations = []) {
    const upsertStmt = db.prepare(`
      INSERT INTO club_workstations_cache (club_id, pc_number, zone_name, status, current_session_started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(club_id, pc_number) DO UPDATE SET
        zone_name = excluded.zone_name,
        status = excluded.status,
        current_session_started_at = excluded.current_session_started_at,
        updated_at = CURRENT_TIMESTAMP
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM club_workstations_cache WHERE club_id=?').run(clubId);
      for (const pc of workstations) {
        upsertStmt.run(
          clubId,
          String(pc.pc_number || pc.pcNumber || pc.name || 'PC'),
          String(pc.zone_name || pc.zoneName || 'STANDARD'),
          String(pc.status || 'AVAILABLE').toUpperCase(),
          pc.current_session_started_at || pc.sessionStartedAt || null
        );
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * 8. Kunlik tushum va telemetriyani yozish
   */
  static recordDailyMetrics(clubId, {
    recordDate,
    totalDailyRevenue = 0,
    totalSessionsCount = 0,
    totalPlayHours = 0,
    barRevenue = 0,
    peakConcurrentPcs = 0
  }) {
    const today = recordDate || new Date().toISOString().slice(0, 10);

    const stmt = db.prepare(`
      INSERT INTO club_metrics (
        club_id, record_date, total_daily_revenue, total_sessions_count, 
        total_play_hours, bar_revenue, peak_concurrent_pcs
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(club_id, record_date) DO UPDATE SET
        total_daily_revenue = excluded.total_daily_revenue,
        total_sessions_count = excluded.total_sessions_count,
        total_play_hours = excluded.total_play_hours,
        bar_revenue = excluded.bar_revenue,
        peak_concurrent_pcs = MAX(club_metrics.peak_concurrent_pcs, excluded.peak_concurrent_pcs)
    `);

    stmt.run(
      clubId,
      today,
      parseFloat(totalDailyRevenue) || 0,
      parseInt(totalSessionsCount, 10) || 0,
      parseFloat(totalPlayHours) || 0,
      parseFloat(barRevenue) || 0,
      parseInt(peakConcurrentPcs, 10) || 0
    );
  }

  /**
   * 9. Barcha klublar ro'yxatini bugungi metrikalari bilan olish
   */
  static getAllClubsWithLiveMetrics() {
    const todayStr = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});

    const rows = db.prepare(`
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM club_workstations_cache WHERE club_id=c.id) as actual_workstations,
        COALESCE(m.total_daily_revenue, 0) as today_revenue,
        COALESCE(m.total_sessions_count, 0) as today_sessions,
        COALESCE(m.bar_revenue, 0) as today_bar_revenue,
        (SELECT COUNT(*) FROM club_workstations_cache WHERE club_id = c.id AND status = 'OCCUPIED') as occupied_pcs_now,
        (SELECT COUNT(*) FROM club_workstations_cache WHERE club_id = c.id AND status = 'AVAILABLE') as available_pcs_now,
        CASE 
          WHEN c.last_heartbeat_at >= datetime('now', '-5 minutes') THEN 1 
          ELSE 0 
        END as is_online_now
      FROM clubs c
      LEFT JOIN club_metrics m ON m.club_id = c.id AND m.record_date = ?
      ORDER BY is_online_now DESC, today_revenue DESC
    `).all(todayStr);

    const reports=mergeFinancialReports([],localFinancialReports(db,todayStr,todayStr));
    return rows.map(r => {
      let offlineMinutes = 0;
      if (r.last_heartbeat_at) {
        // SQLite UTC datetime format handling
        const hbTime = new Date(r.last_heartbeat_at.includes('Z') ? r.last_heartbeat_at : r.last_heartbeat_at + 'Z').getTime();
        const diffMs = Math.max(0, Date.now() - hbTime);
        offlineMinutes = Math.floor(diffMs / 60000);
      } else {
        offlineMinutes = 999;
      }

      const report=reports.find(m=>Number(m.club_id)===Number(r.id));


      return {
        ...r,
        today_revenue:report?.total_daily_revenue??r.today_revenue,
        today_bar_revenue:report?.bar_revenue??r.today_bar_revenue,
        duty_cashier: r.duty_cashier || null,
        ping_ms: null,
        offline_minutes: offlineMinutes
      };
    });
  }

  /**
   * 10. Klub ID bo'yicha olish
   */
  static getClubById(id) {
    return db.prepare('SELECT * FROM clubs WHERE id = ?').get(id);
  }

  /**
   * 11. Super Admin avtorizatsiyasi (Login & Parol)
   */
  static authenticateSuperAdmin(username, password) {
    const admin = db.prepare('SELECT * FROM super_admins WHERE username = ?').get(username);
    if (!admin) return null;

    const isValid = verifyPassword(password, admin.password_hash);
    if (!isValid) return null;

    return {
      id: admin.id,
      username: admin.username,
      fullName: admin.full_name,
      phone: admin.phone
    };
  }

  /**
   * 12. Mobil PIN-kod orqali tezkor kirish (4 xonali biometrik PIN)
   */
  static verifyPinCode(username, pinCode) {
    const admin = db.prepare('SELECT * FROM super_admins WHERE username = ? AND pin_code = ?').get(username, pinCode);
    if (!admin) return null;

    return {
      id: admin.id,
      username: admin.username,
      fullName: admin.full_name,
      phone: admin.phone
    };
  }

  /**
   * 13. Klub bo'yicha batafsil jonli inspektor (Overview, Workstations Matrix, Kassa Bo'linishi)
   */
  static getClubDetailedInspector(clubId) {
    const club=db.prepare('SELECT * FROM clubs WHERE id=?').get(clubId);if(!club)return null;
    const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
    const metrics=db.prepare('SELECT * FROM club_metrics WHERE club_id=? AND record_date=?').get(clubId,date)||{};
    const pcs=db.prepare('SELECT * FROM club_workstations_cache WHERE club_id=? ORDER BY id').all(clubId);
    return formatClubInspector(club,mergeFinancialReports([{...metrics,club_id:clubId,record_date:date}],localFinancialReports(db,date,date,clubId))[0],pcs);
  }
}
