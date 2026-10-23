import { db } from '../db.js';
import { ClientManager } from '../services/clientManager.js';
import { verifyPassword } from '../auth.js';
import { calculateTimeFromAmount, resolveZoneIdForComputer, getActiveRateForMoment } from '../services/pricingEngine.js';
import { LicenseManager } from '../services/licenseManager.js';

export class ProtocolDispatcher {
  static handleMessage(socket, rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      console.error('❌ [ProtocolDispatcher] JSON tahlil xatosi:', rawMessage);
      return;
    }

    const type = String(message.type || message.event || '').trim().toUpperCase();
    if (!type) return;

    switch (type) {
      case 'CLIENT_HELLO':
      case 'CLIENT_HANDSHAKE':
        this.handleClientHello(socket, message);
        break;

      case 'HEARTBEAT_PING':
      case 'PING':
        this.handleHeartbeatPing(socket, message.payload || message);
        break;

      case 'SESSION_ALERT':
        this.handleSessionAlert(socket, message.payload || message);
        break;

      case 'CLIENT_MEMBER_LOGIN':
      case 'CLIENT_LOGIN_REQUEST':
        this.handleClientLoginRequest(socket, message.payload || message);
        break;

      case 'CLIENT_MEMBER_LOGOUT':
      case 'CLIENT_STOP_SESSION':
        this.handleClientLogout(socket, message.payload || message);
        break;

      case 'CLIENT_BAR_ORDER':
      case 'BAR_ORDER':
        this.handleClientBarOrder(socket, message.payload || message);
        break;

      case 'DASHBOARD_SUBSCRIBE':
        console.log('⚡ [AdminWS] Dashboard real-time oqimga ulandi.');
        break;

      default:
        console.warn(`⚠️ [ProtocolDispatcher] Noma'lum hodisa: ${type}`);
    }
  }

  static handleClientHello(socket, message) {
    const payload = message.payload || message;
    const pcNumberRaw = message.pcNumber || payload.pcNumber || '';
    const ipAddress = message.ip || payload.ipAddress || payload.ip || socket._remoteAddress || socket._socket?.remoteAddress?.replace('::ffff:', '') || '127.0.0.1';
    const macAddress = payload.macAddress || '';
    const agentVersion = payload.agentVersion || '2.0.0';
    const osInfo = payload.osInfo || '';
    const clubId = payload.clubId || 1;

    // Parse PC Number and Name (e.g. "PC-01" -> 1, "PC-01")
    let numericPcNum = null;
    let pcName = String(pcNumberRaw || '').trim();
    const digitsMatch = pcName.match(/\d+/);
    if (digitsMatch) {
      numericPcNum = parseInt(digitsMatch[0], 10);
    }
    if (!pcName && numericPcNum) {
      pcName = `PC-${String(numericPcNum).padStart(2, '0')}`;
    }
    if (!pcName) {
      pcName = 'PC-01';
      numericPcNum = 1;
    }

    // Match computer in database: Prioritize name & pc_number, then mac, then ip
    let computer = null;
    if (pcName || numericPcNum) {
      computer = db.prepare(`
        SELECT * FROM computers 
        WHERE (club_id = ? OR club_id IS NULL) AND (name = ? OR pc_number = ?)
      `).get(clubId || 1, pcName, numericPcNum);
    }

    if (!computer && macAddress) {
      computer = db.prepare(`
        SELECT * FROM computers 
        WHERE (club_id = ? OR club_id IS NULL) AND mac_address = ?
      `).get(clubId || 1, macAddress);
    }

    if (!computer && ipAddress && ipAddress !== '127.0.0.1') {
      computer = db.prepare(`
        SELECT * FROM computers 
        WHERE (club_id = ? OR club_id IS NULL) AND ip_address = ?
      `).get(clubId || 1, ipAddress);
    }

    let pcId;

    if (!computer) {
      pcId = `pc_${clubId || 1}_${numericPcNum || Date.now().toString(36)}`;
      db.prepare(`
        INSERT INTO computers (id, club_id, pc_number, name, ip_address, mac_address, status, agent_version, os_info, last_heartbeat)
        VALUES (?, ?, ?, ?, ?, ?, 'ONLINE', ?, ?, CURRENT_TIMESTAMP)
      `).run(pcId, clubId || 1, numericPcNum || 1, pcName, ipAddress, macAddress, agentVersion, osInfo);

      console.log(`✨ [Database] Yangi kompyuter ro'yxatdan o'tkazildi: Club #${clubId || 1} -> ${pcName} (${ipAddress})`);
    } else {
      pcId = computer.id;
      pcName = computer.name || pcName;
      numericPcNum = computer.pc_number || numericPcNum;

      // Check if computer currently has an active session
      const activeSession = db.prepare("SELECT id FROM sessions WHERE computer_id = ? AND status = 'ACTIVE'").get(pcId);
      const newStatus = activeSession ? 'OCCUPIED' : 'ONLINE';

      db.prepare(`
        UPDATE computers 
        SET status = ?, ip_address = ?, mac_address = COALESCE(NULLIF(?, ''), mac_address),
            agent_version = ?, os_info = ?, last_heartbeat = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newStatus, ipAddress, macAddress, agentVersion, osInfo, pcId);
    }

    ClientManager.registerClient(socket, pcId, numericPcNum || 1, macAddress, ipAddress, pcName);

    // Litsenziya holatini tekshirish — Agar server faollashtirilmagan yoki bloklangan bo'lsa darhol qulflash
    if (!LicenseManager.isOperational()) {
      try {
        socket.send(JSON.stringify({
          type: 'EMERGENCY_LOCKDOWN',
          event: 'EMERGENCY_LOCKDOWN',
          reason: LicenseManager.lockReason || 'LICENSE_INACTIVE',
          message: LicenseManager.lockMessage || "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16",
          supportPhone: '+998 95 222 06 44, +998 99 563 45 16',
          timestamp: Date.now()
        }));
      } catch {}
      return;
    }

    // Calculate dynamic pricing based on zone and current server time
    const zoneId = resolveZoneIdForComputer(pcId, clubId || 1);
    let zoneName = 'STANDARD';
    if (zoneId) {
      const zRow = db.prepare('SELECT name FROM zones WHERE id = ?').get(zoneId);
      if (zRow) zoneName = zRow.name;
    }

    const currentRate = getActiveRateForMoment(new Date(), false, clubId || 1, zoneId);
    const pricePerHour = Number(currentRate?.pricePerHour || 10000);
    const rateFormatted = `${pricePerHour.toLocaleString('uz-UZ').replace(/,/g, ' ')} UZS / soat`;

    // Push CONFIG_UPDATE down to the client immediately
    const configUpdateMsg = {
      type: 'CONFIG_UPDATE',
      event: 'CONFIG_UPDATE',
      pricePerHour,
      rateFormatted,
      zoneName,
      pcNumber: pcName,
      payload: {
        pricePerHour,
        rateFormatted,
        zoneName,
        pcNumber: pcName
      }
    };
    try {
      socket.send(JSON.stringify(configUpdateMsg));
    } catch {}

    // Check if active session exists to resume on client
    const activeSession = db.prepare(`
      SELECT s.id, s.started_at, s.ends_at, s.notes, s.customer_name, t.name as tariff_name
      FROM sessions s
      JOIN tariffs t ON s.tariff_id = t.id
      WHERE s.computer_id = ? AND s.status = 'ACTIVE'
    `).get(pcId);

    if (activeSession) {
      const now = Date.now();
      const endsAt = new Date(activeSession.ends_at).getTime();
      const remainingSeconds = Math.max(0, Math.floor((endsAt - now) / 1000));
      ClientManager.send(pcId, 'START_SESSION', {
        sessionId: activeSession.id,
        durationMinutes: Math.round(remainingSeconds / 60),
        tariffName: activeSession.tariff_name || 'Standart',
        startedAt: new Date(activeSession.started_at).getTime(),
        endsAt,
        endTime: activeSession.ends_at,
        remainingSeconds: activeSession.notes?.includes('POSTPAID') ? -1 : remainingSeconds,
        customerName: activeSession.customer_name || 'Mijoz',
        zoneName,
        pricePerHour,
        isPostpaid: Boolean(activeSession.notes?.includes('POSTPAID'))
      });
    }

    // Broadcast updated workstation state to Cashier Dashboard via WebSocket
    ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now() });
    console.log(`🔌 [ClientHello] ${pcName} (ID: ${pcId}, IP: ${ipAddress}) ONLINE holatiga o'tkazildi va dashboardga uzatildi.`);
  }

  static handleHeartbeatPing(socket, payload) {
    const pcId = payload.pcId || payload.pcNumber || ClientManager.socketToPcId.get(socket);
    if (pcId) {
      ClientManager.recordHeartbeat(pcId);
    }
  }

  static handleSessionAlert(socket, payload) {
    const { pcId, alertType, details, severity } = payload;
    console.error(`🚨 [SECURITY ALERT] PC (${pcId}) | ${alertType} | ${severity}: ${details}`);

    if (alertType === 'SYSTEM_TIME_TAMPERING' || alertType === 'FORCE_KILL_ATTEMPT') {
      ClientManager.send(pcId, 'LOCK_SCREEN', {
        reason: 'SECURITY_VIOLATION',
        message: 'Xavfsizlik qoidasi buzildi! Administratorga xabar berildi.',
      });
    }
  }

  static handleClientLoginRequest(socket, payload) {
    let { pcId, pcNumber, username, password } = payload || {};

    if (!pcId) {
      pcId = ClientManager.socketToPcId.get(socket);
    }
    if (!pcId && pcNumber) {
      const pcRow = db.prepare('SELECT id FROM computers WHERE pc_number = ? OR name = ?').get(pcNumber, pcNumber);
      pcId = pcRow?.id;
    }

    const sendError = (errMsg) => {
      if (pcId) {
        ClientManager.send(pcId, 'MEMBER_LOGIN_FAILED', { error: errMsg });
        ClientManager.send(pcId, 'CLIENT_LOGIN_FAILED', { error: errMsg });
      } else {
        try {
          socket.send(JSON.stringify({
            type: 'MEMBER_LOGIN_FAILED',
            event: 'MEMBER_LOGIN_FAILED',
            payload: { error: errMsg },
            error: errMsg,
            timestamp: Date.now()
          }));
        } catch {}
      }
    };

    if (!LicenseManager.isOperational()) {
      sendError("Litsenziya to'xtatilgan: " + (LicenseManager.lockMessage || 'Litsenziya faol emas'));
      return;
    }

    if (!username || !password) {
      sendError('Login va parol kiritilishi shart.');
      return;
    }

    try {
      const pcRow = pcId ? db.prepare('SELECT club_id FROM computers WHERE id = ?').get(pcId) : null;
      const clubId = pcRow?.club_id || 1;

      const club = db.prepare('SELECT is_active, expires_at FROM clubs WHERE id = ?').get(clubId);
      if (club) {
        if (!club.is_active || new Date(club.expires_at).getTime() < Date.now()) {
          sendError('Klub obuna muddati tugagan. O\'yin boshlash imkonsiz.');
          return;
        }
      }

      const user = db.prepare(`
        SELECT * FROM users 
        WHERE (username = ? OR phone_number = ?) 
          AND role = 'client' 
          AND (club_id = ? OR club_id IS NULL)
      `).get(username, username, clubId);

      if (!user) {
        sendError('Mijoz topilmadi yoki login noto\'g\'ri.');
        return;
      }

      const isValid = verifyPassword(password, user.password_hash);
      if (!isValid) {
        sendError('Parol noto\'g\'ri kiritildi.');
        return;
      }

      if (user.balance <= 0) {
        sendError(`Balansda mablag' yetarli emas (0 UZS). Kassadan to'ldiring.`);
        return;
      }

      const calcResult = calculateTimeFromAmount(new Date(), user.balance, false, clubId);

      if (calcResult.totalMinutes <= 0) {
        sendError('Balansingiz 1 daqiqa o\'yin uchun ham yetarli emas.');
        return;
      }

      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + calcResult.totalMinutes * 60 * 1000);
      const sessionId = `ses_${Date.now().toString(36)}`;

      const defaultTariff = db.prepare('SELECT id, name FROM tariffs WHERE club_id = ? ORDER BY price_per_hour ASC LIMIT 1').get(clubId)
        || db.prepare('SELECT id, name FROM tariffs ORDER BY price_per_hour ASC LIMIT 1').get();

      db.prepare(`
        INSERT INTO sessions (id, club_id, computer_id, tariff_id, user_id, customer_name, started_at, ends_at, total_amount, paid_amount, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
      `).run(
        sessionId,
        clubId,
        pcId || 'pc_1',
        defaultTariff?.id || 'trf_standard_1h',
        user.id,
        user.username,
        startedAt.toISOString(),
        endsAt.toISOString(),
        user.balance,
        user.balance,
        'MEMBER_PREPAID_LIVE'
      );

      db.prepare(`
        UPDATE computers 
        SET status = 'OCCUPIED', current_session_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionId, pcId || 'pc_1');

      const loginSuccessData = {
        sessionId,
        username: user.username,
        balance: user.balance,
        remainingSeconds: calcResult.totalMinutes * 60,
        totalMinutes: calcResult.totalMinutes,
        endsAt: endsAt.toISOString(),
        tariffName: defaultTariff?.name || 'Mijoz Hisobi'
      };

      ClientManager.send(pcId, 'MEMBER_LOGIN_SUCCESS', loginSuccessData);
      ClientManager.send(pcId, 'START_SESSION', loginSuccessData);

      ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now() });
      console.log(`👤 [MemberAuth] ${user.username} PC #${pcId} ga kirdi (Balans: ${user.balance} UZS, Vaqt: ${calcResult.totalMinutes} daqiqa).`);
    } catch (err) {
      console.error('❌ [MemberAuth] Tizim xatosi:', err);
      sendError('Ichki server xatoligi yuz berdi.');
    }
  }

  static handleClientLogout(socket, payload) {
    const pcId = payload.pcId || payload.pcNumber || ClientManager.socketToPcId.get(socket);
    if (!pcId) return;

    const activeSession = db.prepare("SELECT * FROM sessions WHERE computer_id = ? AND status = 'ACTIVE'").get(pcId);
    if (activeSession) {
      const now = new Date();
      db.prepare(`
        UPDATE sessions 
        SET status = 'COMPLETED', ends_at = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(now.toISOString(), activeSession.id);

      db.prepare(`
        UPDATE computers 
        SET status = 'ONLINE', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(pcId);

      ClientManager.send(pcId, 'STOP_SESSION', { reason: 'LOGOUT', message: 'Seans yakunlandi.' });
      ClientManager.send(pcId, 'LOCK_SCREEN', { reason: 'LOGOUT', message: 'Mijoz tizimdan chiqdi.' });

      ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now() });
      console.log(`🛑 [ClientLogout] PC #${pcId} da seans (${activeSession.id}) yakunlandi.`);
    }
  }

  static handleClientBarOrder(socket, payload) {
    const { sessionId, items, totalAmount, pcNumber, workstationName } = payload || {};
    console.log(`🛒 [BarOrder] Buyurtma qabul qilindi: ${pcNumber || workstationName} — ${totalAmount} UZS`);
    ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now() });
  }
}
