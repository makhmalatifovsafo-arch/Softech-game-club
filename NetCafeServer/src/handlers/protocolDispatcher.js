import { acknowledgeScreenMessage } from '../services/screenMessages.js';
import { updateCustomerCredentials } from '../services/customerCredentials.js';
import { clientSessionState } from '../services/clientSessionState.js';
import { canClientCloseSession, isPostpaidSession } from '../services/sessionMode.js';
import { startMemberSession, isMemberSession } from '../services/memberBilling.js';
import { SessionScheduler } from '../services/sessionScheduler.js';
import { createClientBarOrder } from '../services/clientBarOrders.js';
import { db } from '../db.js';
import { ClientManager } from '../services/clientManager.js';
import { verifyPassword } from '../auth.js';
import { calculateTimeFromAmount, resolveZoneIdForComputer, getActiveRateForMoment } from '../services/pricingEngine.js';
import { LicenseManager } from '../services/licenseManager.js';
import { normalizeMacAddress } from '../services/macAddress.js';

export class ProtocolDispatcher {
  static getClientRateConfig(pcId, clubId = 1, pcName = '') {
    const zoneId = resolveZoneIdForComputer(pcId, clubId);
    let zoneName = 'STANDARD';
    if (zoneId) {
      const zone = db.prepare('SELECT name FROM zones WHERE id = ? AND club_id = ?').get(zoneId, clubId);
      if (zone?.name) zoneName = zone.name;
    }

    const currentRate = getActiveRateForMoment(new Date(), false, clubId, zoneId);
    const pricePerHour = Number(currentRate?.pricePerHour || 0);
    return {
      pricePerHour,
      rateFormatted: currentRate?.configured
        ? `${pricePerHour.toLocaleString('uz-UZ').replace(/,/g, ' ')} UZS / soat`
        : 'Tarif belgilanmagan',
      zoneName,
      pcNumber: pcName
    };
  }

  static syncClientRate(pcId, clubId = 1, pcName = '', { force = false } = {}) {
    const client = ClientManager.getClientByPcId(pcId);
    if (!client) return null;
    const config = this.getClientRateConfig(pcId, clubId, pcName || client.name);
    const signature = `${config.pricePerHour}|${config.zoneName}|${config.rateFormatted}`;
    if (!force && client.rateSignature === signature) return config;
    if (ClientManager.send(pcId, 'CONFIG_UPDATE', config)) client.rateSignature = signature;
    return config;
  }

  static handleMessage(socket, rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      console.error('❌ [ProtocolDispatcher] JSON tahlil xatosi:', rawMessage);
      return;
    }

    if(!message||typeof message!=='object'||Array.isArray(message))return;
    const type = String(message.type || message.event || '').trim().toUpperCase();
    if (!type) return;

    switch (type) {
      case 'MESSAGE_DISPLAYED':
        acknowledgeScreenMessage(socket, message.payload || message);
        break;
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

      case 'CLIENT_ACCOUNT_UPDATE': {
        const payload=message.payload||message;
        const requestId=typeof payload.requestId==='string'?payload.requestId.slice(0,64):'';
        try {
          if (!LicenseManager.isOperational()) throw new Error('Litsenziya faol emas.');
          const computerId=ClientManager.socketToPcId.get(socket);
          if (!computerId) throw new Error('Kompyuter ulanmagan.');
          const result=updateCustomerCredentials({computerId,sessionId:payload.sessionId,username:payload.username,password:payload.password,currentPassword:payload.currentPassword,selfService:true});
          socket.send(JSON.stringify({type:'CLIENT_ACCOUNT_RESULT',payload:{...result,requestId}}));
          ClientManager.broadcast('ADMIN_DATA_UPDATED',{timestamp:Date.now(),customerId:result.userId});
        } catch(error) {socket.send(JSON.stringify({type:'CLIENT_ACCOUNT_RESULT',payload:{requestId,success:false,error:error.status?error.message:'Hisobni yangilab bo‘lmaydi.'}}));}
        break;
      }

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
    let macAddress = '';
    try { macAddress = normalizeMacAddress(payload.macAddress) || ''; } catch { /* Keep the last valid MAC when a client reports an invalid adapter. */ }
    const agentVersion = payload.agentVersion || '2.0.0';
    const osInfo = payload.osInfo || '';
    const clubId = 1; // Each installed server owns its local club; clients cannot select another tenant.

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

    const maxPcs=Number(LicenseManager.licenseData?.maxPcs);
    if(maxPcs>0 && ClientManager.clients.size>=maxPcs && (!computer || !ClientManager.clients.has(computer.id))){
      socket.send(JSON.stringify({type:'EMERGENCY_LOCKDOWN',payload:{reason:'PC_LIMIT',message:'Litsenziyadagi kompyuterlar limiti tugadi.'}}));return;
    }
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

    // Send the current dynamic rate on connect. Heartbeats below keep it live
    // when a time boundary is crossed or a cashier edits the tariff.
    const rateConfig = this.syncClientRate(pcId, clubId || 1, pcName, { force: true })
      || this.getClientRateConfig(pcId, clubId || 1, pcName);
    const { pricePerHour, zoneName } = rateConfig;

    // Check if active session exists to resume on client
    let activeSession = db.prepare(`
      SELECT s.*, t.name as tariff_name
      FROM sessions s
      LEFT JOIN tariffs t ON s.tariff_id = t.id
      WHERE s.computer_id = ? AND s.status = 'ACTIVE'
    `).get(pcId);

    if (activeSession) {
      const now = Date.now();
      const endsAt = new Date(activeSession.ends_at).getTime();
      const postpaid = isPostpaidSession(activeSession);
      if (!postpaid && Number.isFinite(endsAt) && endsAt <= now) {
        // The deadline may have passed while the server was offline. Settle it
        // before HELLO can briefly unlock the kiosk with an expired row.
        SessionScheduler.finishSession(activeSession, { reason: 'TIME_EXPIRED', now: new Date(now) });
        activeSession = null;
      } else if (!postpaid && !Number.isFinite(endsAt)) {
        // Preserve the row for recovery, but fail closed on the workstation.
        ClientManager.send(pcId, 'LOCK_SCREEN', {
          reason: 'SESSION_DATA_INVALID',
          message: 'Seans vaqti buzilgan. Kassir yoki texnik yordamga murojaat qiling.'
        });
        activeSession = null;
      }
      if (activeSession) {
      const remainingSeconds = postpaid ? -1 : Math.max(0, Math.ceil((endsAt - now) / 1000));
      ClientManager.send(pcId, 'START_SESSION', {
        sessionId: activeSession.id,
        durationMinutes: postpaid ? -1 : Math.ceil(remainingSeconds / 60),
        tariffName: activeSession.tariff_name || 'Standart',
        startedAt: new Date(activeSession.started_at).getTime(),
        endsAt,
        endTime: activeSession.ends_at,
        remainingSeconds,
        authoritativeAt: now,
        customerName: activeSession.customer_name || 'Mijoz',
        clientBalance: isMemberSession(activeSession) ? db.prepare('SELECT balance FROM users WHERE id=?').get(activeSession.user_id)?.balance : null,
        zoneName,
        pricePerHour,
        ...clientSessionState(activeSession.id)
      });
      }
    }

    // Broadcast updated workstation state to Cashier Dashboard via WebSocket
    ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now() });
    console.log(`🔌 [ClientHello] ${pcName} (ID: ${pcId}, IP: ${ipAddress}) ONLINE holatiga o'tkazildi va dashboardga uzatildi.`);
  }

  static handleHeartbeatPing(socket, payload) {
    const pcId = ClientManager.socketToPcId.get(socket);
    if (pcId) {
      ClientManager.recordHeartbeat(pcId);
      const computer = db.prepare('SELECT club_id, name FROM computers WHERE id = ?').get(pcId);
      this.syncClientRate(pcId, Number(computer?.club_id || 1), computer?.name || '');
    }
  }

  static handleSessionAlert(socket, payload) {
    const pcId=ClientManager.socketToPcId.get(socket);if(!pcId)return;
    const { alertType, details, severity } = payload;
    console.error(`🚨 [SECURITY ALERT] PC (${pcId}) | ${alertType} | ${severity}: ${details}`);

    if (alertType === 'SYSTEM_TIME_TAMPERING' || alertType === 'FORCE_KILL_ATTEMPT') {
      ClientManager.send(pcId, 'LOCK_SCREEN', {
        reason: 'SECURITY_VIOLATION',
        message: 'Xavfsizlik qoidasi buzildi! Administratorga xabar berildi.',
      });
    }
  }

  static handleClientLoginRequest(socket, payload) {
    const pcId=ClientManager.socketToPcId.get(socket);
    try {
      if (!LicenseManager.isOperational()) throw new Error('Litsenziya faol emas.');
      if (!pcId || !payload?.username || !payload?.password) throw new Error('Kompyuter, login va parol talab qilinadi.');
      const result=startMemberSession(pcId,payload.username,payload.password,payload.durationMinutes);
      ClientManager.send(pcId,'MEMBER_LOGIN_SUCCESS',result);
      ClientManager.send(pcId,'START_SESSION',result);
      ClientManager.broadcast('ADMIN_DATA_UPDATED',{timestamp:Date.now()});
    } catch(error) {
      socket.send(JSON.stringify({type:'MEMBER_LOGIN_FAILED',payload:{error:error.message},error:error.message}));
    }
  }

  static handleClientLogout(socket, payload) {
    const pcId = ClientManager.socketToPcId.get(socket);
    if (!pcId) return;

    const activeSession = db.prepare("SELECT * FROM sessions WHERE computer_id = ? AND status = 'ACTIVE'").get(pcId);
    if (activeSession) {
      if (payload?.sessionId && payload.sessionId !== activeSession.id) return;
      if (!canClientCloseSession(activeSession)) {
        ClientManager.send(pcId,'CLIENT_LOGOUT_REJECTED',{sessionId:activeSession.id,message:'Bu seansni faqat kassir yopishi mumkin.'});
        return;
      }
      SessionScheduler.finishSession(activeSession, { reason: 'LOGOUT' });
    }
  }

  static handleClientBarOrder(socket, payload) {
    const pcId = ClientManager.socketToPcId.get(socket);
    try {
      const order = createClientBarOrder(pcId, payload || {});
      socket.send(JSON.stringify({type:'BAR_ORDER_RECEIVED',payload:order}));
      if(!order.replayed)ClientManager.broadcast('NEW_BAR_ORDER',order);
      ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp:Date.now() });
    } catch (error) {
      socket.send(JSON.stringify({type:'BAR_ORDER_REJECTED',payload:{reason:error.message,requestId:payload?.requestId}}));
    }
  }
}
