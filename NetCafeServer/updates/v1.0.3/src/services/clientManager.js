import { WebSocket } from 'ws';
import { db } from '../db.js';

export class ClientManager {
  static clients = new Map();
  static socketToPcId = new Map();

  static registerClient(socket, pcId, pcNumber, macAddress, ipAddress, name = null) {
    if (this.clients.has(pcId)) {
      const old = this.clients.get(pcId);
      try { old.socket.terminate(); } catch {}
      this.socketToPcId.delete(old.socket);
    }

    const client = {
      socket,
      pcId,
      pcNumber,
      name: name || `PC-${String(pcNumber).padStart(2, '0')}`,
      macAddress,
      ipAddress,
      lastHeartbeat: Date.now(),
      isAlive: true,
    };

    this.clients.set(pcId, client);
    this.socketToPcId.set(socket, pcId);

    // Agar kompyuterda avvaldan faol seans mavjud bo'lsa
    const activeSes = db.prepare("SELECT s.*, t.name as tariff_name FROM sessions s LEFT JOIN tariffs t ON s.tariff_id = t.id WHERE s.computer_id = ? AND s.status = 'ACTIVE'").get(pcId);

    if (activeSes) {
      this.updateComputerOnlineStatus(pcId, 'OCCUPIED');
      const now = Date.now();
      const endsAt = new Date(activeSes.ends_at).getTime();
      const remainingSeconds = Math.max(0, Math.floor((endsAt - now) / 1000));
      this.send(pcId, 'START_SESSION', {
        sessionId: activeSes.id,
        durationMinutes: Math.round(remainingSeconds / 60),
        tariffName: activeSes.tariff_name || 'Standart',
        startedAt: new Date(activeSes.started_at).getTime(),
        endsAt,
        endTime: activeSes.ends_at,
        remainingSeconds: activeSes.notes?.includes('POSTPAID') ? -1 : remainingSeconds,
        customerName: activeSes.customer_name || 'Mijoz',
        isPostpaid: Boolean(activeSes.notes?.includes('POSTPAID'))
      });
      console.log(`🔌 [ClientManager] ${client.name} (ID: ${pcId}) yoqildi va faol seansi (${activeSes.id}) avtomatik uzatildi.`);
      this.broadcast('WORKSTATION_UPDATED', { id: pcId, status: 'OCCUPIED', is_online: 1, isOnline: true });
      this.broadcast('ADMIN_DATA_UPDATED', { pcId, status: 'OCCUPIED' });
    } else {
      this.updateComputerOnlineStatus(pcId, 'ONLINE');
      console.log(`🔌 [ClientManager] ${client.name} (ID: ${pcId}, IP: ${ipAddress}) ONLINE bo'ldi.`);
      this.broadcast('WORKSTATION_UPDATED', { id: pcId, status: 'AVAILABLE', is_online: 1, isOnline: true });
      this.broadcast('ADMIN_DATA_UPDATED', { pcId, status: 'ONLINE' });
    }
    return client;
  }

  static unregisterClient(socket) {
    const pcId = this.socketToPcId.get(socket);
    if (!pcId) return;

    const client = this.clients.get(pcId);
    this.socketToPcId.delete(socket);
    this.clients.delete(pcId);

    if (client) {
      console.warn(`❌ [ClientManager] ${client.name} (ID: ${pcId}) aloqasi uzildi.`);
      this.updateComputerOnlineStatus(pcId, 'OFFLINE');
      this.broadcast('WORKSTATION_UPDATED', { id: pcId, status: 'OFFLINE', is_online: 0, isOnline: false });
      this.broadcast('ADMIN_DATA_UPDATED', { pcId, status: 'OFFLINE' });
    }
  }

  static getClientBySocket(socket) {
    const pcId = this.socketToPcId.get(socket);
    return pcId ? this.clients.get(pcId) : undefined;
  }

  static getClientByPcId(pcId) {
    return this.findClient(pcId);
  }

  static findClient(target) {
    if (!target) return undefined;
    if (this.clients.has(target)) return this.clients.get(target);

    const targetStr = String(target).trim();
    const digits = targetStr.replace(/\D/g, '');

    for (const client of this.clients.values()) {
      if (client.pcId === targetStr || 
          client.name === targetStr || 
          String(client.pcNumber) === targetStr ||
          (digits && String(client.pcNumber) === String(parseInt(digits, 10))) ||
          `PC-${String(client.pcNumber).padStart(2, '0')}`.toUpperCase() === targetStr.toUpperCase()) {
        return client;
      }
    }
    return undefined;
  }

  static getAllClients() {
    return Array.from(this.clients.values());
  }

  static recordHeartbeat(pcId) {
    const client = this.findClient(pcId);
    if (client) {
      client.lastHeartbeat = Date.now();
      client.isAlive = true;

      db.prepare(`
        UPDATE computers 
        SET last_heartbeat = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(client.pcId);
    }
  }

  static send(target, event, payload) {
    const client = this.findClient(target);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      console.warn(`⚠️ [ClientManager] Client '${target}' topilmadi yoki aloqa ochiq emas (Ulanganlar soni: ${this.clients.size})`);
      return false;
    }

    const payloadObj = (payload && typeof payload === 'object') ? payload : { value: payload };

    // Format with type, event, and root fields + payload for maximum protocol compatibility
    const message = {
      type: event,
      event,
      ...payloadObj,
      payload: payloadObj,
      timestamp: Date.now(),
    };

    try {
      client.socket.send(JSON.stringify(message));
      console.log(`📨 [ClientManager] '${event}' buyrug'i ${client.name} (${client.ipAddress}) ga yuborildi.`);
      return true;
    } catch (err) {
      console.warn(`[ClientManager] Xabar yuborishda xatolik (${client.name}):`, err.message);
      return false;
    }
  }

  static broadcast(event, payload) {
    const payloadObj = (payload && typeof payload === 'object') ? payload : { value: payload };
    const message = {
      type: event,
      event,
      ...payloadObj,
      payload: payloadObj,
      timestamp: Date.now(),
    };

    const raw = JSON.stringify(message);

    if (this.wss && this.wss.clients) {
      for (const socket of this.wss.clients) {
        if (socket.readyState === WebSocket.OPEN) {
          try { socket.send(raw); } catch {}
        }
      }
    } else {
      for (const client of this.clients.values()) {
        if (client.socket.readyState === WebSocket.OPEN) {
          try { client.socket.send(raw); } catch {}
        }
      }
    }
  }

  static updateComputerOnlineStatus(pcId, status) {
    if (status === 'LOCKED' || status === 'AVAILABLE' || status === 'ONLINE') {
      const activeSes = db.prepare("SELECT id FROM sessions WHERE computer_id = ? AND status = 'ACTIVE'").get(pcId);
      if (activeSes) {
        status = 'OCCUPIED';
      }
    }
    try {
      db.prepare(`
        UPDATE computers 
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, pcId);
    } catch (err) {
      console.warn(`[ClientManager.updateComputerOnlineStatus] xato:`, err.message);
    }
  }
}
