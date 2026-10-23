import { WebSocket } from 'ws';
import { db } from '../db.js';
import { ClientManager } from '../services/clientManager.js';
import type {
  ProtocolMessage,
  ClientHandshakePayload,
  HeartbeatPingPayload,
  SessionAlertPayload,
  HandshakeAckPayload,
  LockScreenPayload,
} from '../types/protocol.js';

interface ComputerRow {
  id: string;
  pc_number: number;
  status: string;
  current_session_id: string | null;
}

interface ActiveSessionData {
  id: string;
  started_at: string;
  ends_at: string;
  tariff_name: string;
}

export class ProtocolDispatcher {
  /**
   * Klientdan kelgan xabarni tahlil qilish va kerakli handlerga yo'naltirish
   */
  public static handleMessage(socket: WebSocket, rawMessage: string): void {
    let message: ProtocolMessage;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      console.error('❌ [ProtocolDispatcher] JSON tahlil xatosi:', rawMessage);
      return;
    }

    if (!message.event) {
      console.warn('⚠️ [ProtocolDispatcher] "event" maydoni topilmadi:', message);
      return;
    }

    switch (message.event) {
      case 'CLIENT_HANDSHAKE':
        this.handleClientHandshake(socket, message.payload as ClientHandshakePayload);
        break;

      case 'HEARTBEAT_PING':
        this.handleHeartbeatPing(socket, message.payload as HeartbeatPingPayload);
        break;

      case 'SESSION_ALERT':
        this.handleSessionAlert(socket, message.payload as SessionAlertPayload);
        break;

      default:
        console.warn(`⚠️ [ProtocolDispatcher] Noma'lum hodisa: ${message.event}`);
    }
  }

  /**
   * 1. CLIENT_HANDSHAKE: Klient o'zini ro'yxatdan o'tkazishi
   */
  private static handleClientHandshake(socket: WebSocket, payload: ClientHandshakePayload): void {
    const { pcNumber, macAddress, ipAddress = '127.0.0.1', agentVersion, osInfo } = payload;

    // Bazadan kompyuterni qidirish (pc_number yoki mac_address bo'yicha)
    let computer = db.prepare(`
      SELECT id, pc_number, status, current_session_id 
      FROM computers 
      WHERE pc_number = ? OR mac_address = ?
    `).get(pcNumber, macAddress) as ComputerRow | undefined;

    let pcId: string;

    if (!computer) {
      // Yangi kompyuterni avtomatik bazaga qo'shish (Self-Registration)
      pcId = `pc_${pcNumber}_${Date.now().toString(36)}`;
      db.prepare(`
        INSERT INTO computers (id, pc_number, name, ip_address, mac_address, status, agent_version, os_info, last_heartbeat)
        VALUES (?, ?, ?, ?, ?, 'LOCKED', ?, ?, CURRENT_TIMESTAMP)
      `).run(pcId, pcNumber, `PC-${String(pcNumber).padStart(2, '0')}`, ipAddress, macAddress, agentVersion, osInfo);

      console.log(`✨ [Database] Yangi kompyuter ro'yxatdan o'tkazildi: PC #${pcNumber} (${macAddress})`);
    } else {
      pcId = computer.id;
      // Mavjud ma'lumotlarni yangilash
      db.prepare(`
        UPDATE computers 
        SET ip_address = ?, mac_address = ?, agent_version = ?, os_info = ?, last_heartbeat = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(ipAddress, macAddress, agentVersion, osInfo, pcId);
    }

    // ClientManager ga ulanishni qo'shish
    ClientManager.registerClient(socket, pcId, pcNumber, macAddress, ipAddress);

    // Mavjud faol sessiya bormi? (Kompyuter restart bo'lib qayta ulanganda tiklash uchun)
    const activeSession = db.prepare(`
      SELECT s.id, s.started_at, s.ends_at, t.name as tariff_name
      FROM sessions s
      JOIN tariffs t ON s.tariff_id = t.id
      WHERE s.computer_id = ? AND s.status = 'ACTIVE'
    `).get(pcId) as ActiveSessionData | undefined;

    const ackPayload: HandshakeAckPayload = {
      status: 'SUCCESS',
      pcId,
      pcNumber,
      currentStatus: activeSession ? 'OCCUPIED' : 'LOCKED',
      serverTime: Date.now(),
      activeSession: activeSession
        ? {
            sessionId: activeSession.id,
            tariffName: activeSession.tariff_name,
            startedAt: new Date(activeSession.started_at).getTime(),
            endsAt: new Date(activeSession.ends_at).getTime(),
            remainingSeconds: Math.max(0, Math.floor((new Date(activeSession.ends_at).getTime() - Date.now()) / 1000)),
          }
        : null,
      message: 'Ulanish tasdiqlandi.',
    };

    // Klientga HANDSHAKE_ACK yuborish
    ClientManager.send(pcId, 'HANDSHAKE_ACK', ackPayload);

    // Agar faol sessiya bo'lmasa, ekranni qulflashni tasdiqlaymiz
    if (!activeSession) {
      const lockPayload: LockScreenPayload = {
        reason: 'SESSION_ENDED',
        message: 'Kompyuter qulflangan. Seans boshlash uchun kassaga murojaat qiling.',
      };
      ClientManager.send(pcId, 'LOCK_SCREEN', lockPayload);
    }
  }

  /**
   * 2. HEARTBEAT_PING: Tiriklik signali va telemetriya
   */
  private static handleHeartbeatPing(socket: WebSocket, payload: HeartbeatPingPayload): void {
    const { pcId, cpuUsage, ramUsage, activeProcess, uptimeSeconds } = payload;
    ClientManager.recordHeartbeat(pcId);

    // 100% dan ortiq g'ayritabiiy yuklama yoki taqiqlangan jarayon logi
    if (cpuUsage > 95) {
      console.warn(`🔥 [Alert] PC #${payload.pcNumber} CPU yuklamasi juda yuqori: ${cpuUsage}%`);
    }
  }

  /**
   * 3. SESSION_ALERT: Xavfsizlik signali yoki qoidabuzarlik
   */
  private static handleSessionAlert(socket: WebSocket, payload: SessionAlertPayload): void {
    const { pcId, alertType, details, severity } = payload;
    console.error(`🚨 [SECURITY ALERT] PC (${pcId}) | ${alertType} | ${severity}: ${details}`);

    // Favqulodda holat: Agar mijoz agentni o'ldirmoqchi bo'lsa yoki vaqtni orqaga sursa:
    if (alertType === 'SYSTEM_TIME_TAMPERING' || alertType === 'FORCE_KILL_ATTEMPT') {
      const lockPayload: LockScreenPayload = {
        reason: 'SECURITY_VIOLATION',
        message: 'Xavfsizlik qoidasi buzildi! Administratorga xabar berildi.',
      };
      ClientManager.send(pcId, 'LOCK_SCREEN', lockPayload);
    }
  }
}
