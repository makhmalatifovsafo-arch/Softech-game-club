import { WebSocket } from 'ws';
import { db } from '../db.js';
import type { ProtocolMessage, ComputerStatus } from '../types/protocol.js';

export interface ConnectedClient {
  socket: WebSocket;
  pcId: string;
  pcNumber: number;
  macAddress: string;
  ipAddress: string;
  lastHeartbeat: number; // Date.now()
  isAlive: boolean;
}

export class ClientManager {
  // Barcha faol soketlarni pcId kaliti bilan saqlaymiz
  private static clients: Map<string, ConnectedClient> = new Map();
  // Tezkor qidirish uchun soket nusxasiga bog'langan teskari xarita
  private static socketToPcId: Map<WebSocket, string> = new Map();

  /**
   * Klient ro'yxatdan o'tganda xotiraga qo'shish
   */
  public static registerClient(
    socket: WebSocket,
    pcId: string,
    pcNumber: number,
    macAddress: string,
    ipAddress: string
  ): ConnectedClient {
    // Agar bu kompyuterdan eski soket ochiq bo'lsa, uni tozalash
    if (this.clients.has(pcId)) {
      const old = this.clients.get(pcId)!;
      try {
        old.socket.terminate();
      } catch {
        // ignore
      }
      this.socketToPcId.delete(old.socket);
    }

    const client: ConnectedClient = {
      socket,
      pcId,
      pcNumber,
      macAddress,
      ipAddress,
      lastHeartbeat: Date.now(),
      isAlive: true,
    };

    this.clients.set(pcId, client);
    this.socketToPcId.set(socket, pcId);

    // Baza holatini yangilash
    this.updateComputerOnlineStatus(pcId, 'LOCKED');

    console.log(`🔌 [ClientManager] PC #${pcNumber} (ID: ${pcId}, IP: ${ipAddress}) ulandi.`);
    return client;
  }

  /**
   * Soket uzilganda tozalash
   */
  public static unregisterClient(socket: WebSocket): void {
    const pcId = this.socketToPcId.get(socket);
    if (!pcId) return;

    const client = this.clients.get(pcId);
    this.socketToPcId.delete(socket);
    this.clients.delete(pcId);

    if (client) {
      console.warn(`❌ [ClientManager] PC #${client.pcNumber} (ID: ${pcId}) aloqasi uzildi.`);
      this.updateComputerOnlineStatus(pcId, 'OFFLINE');
    }
  }

  /**
   * Soket bo'yicha klientni topish
   */
  public static getClientBySocket(socket: WebSocket): ConnectedClient | undefined {
    const pcId = this.socketToPcId.get(socket);
    return pcId ? this.clients.get(pcId) : undefined;
  }

  /**
   * PC ID bo'yicha klientni topish
   */
  public static getClientByPcId(pcId: string): ConnectedClient | undefined {
    return this.clients.get(pcId);
  }

  /**
   * Barcha ulangan klientlar
   */
  public static getAllClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Heartbeat vaqtini yangilash
   */
  public static recordHeartbeat(pcId: string): void {
    const client = this.clients.get(pcId);
    if (client) {
      client.lastHeartbeat = Date.now();
      client.isAlive = true;

      // DB da oxirgi heartbeat vaqtini yangilash
      db.prepare(`
        UPDATE computers 
        SET last_heartbeat = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(pcId);
    }
  }

  /**
   * Klientga xabar yuborish
   */
  public static send<T>(pcId: string, event: string, payload: T): boolean {
    const client = this.clients.get(pcId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    const message: ProtocolMessage<T> = {
      event,
      payload,
      timestamp: Date.now(),
    };

    client.socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * Barcha klientlarga broadcast yuborish
   */
  public static broadcast<T>(event: string, payload: T): void {
    const message: ProtocolMessage<T> = {
      event,
      payload,
      timestamp: Date.now(),
    };

    const raw = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(raw);
      }
    }
  }

  /**
   * Bazada kompyuter holatini yangilash
   */
  public static updateComputerOnlineStatus(pcId: string, status: ComputerStatus): void {
    db.prepare(`
      UPDATE computers 
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, pcId);
  }
}
