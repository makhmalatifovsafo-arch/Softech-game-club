import { ClientManager } from './clientManager.js';

export class HeartbeatMonitor {
  static timer = null;
  static TIMEOUT_MS = 15000;
  static CHECK_INTERVAL_MS = 5000;

  static start() {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.checkDeadConnections();
    }, this.CHECK_INTERVAL_MS);

    console.log(`💓 [HeartbeatMonitor] Ishga tushirildi (Check: ${this.CHECK_INTERVAL_MS / 1000}s, Timeout: ${this.TIMEOUT_MS / 1000}s).`);
  }

  static stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  static checkDeadConnections() {
    const now = Date.now();
    const clients = ClientManager.getAllClients();

    for (const client of clients) {
      const elapsed = now - client.lastHeartbeat;

      if (elapsed > this.TIMEOUT_MS) {
        console.warn(
          `⚠️ [HeartbeatMonitor] PC #${client.pcNumber} (${client.pcId}) dan ${Math.round(elapsed / 1000)}s signal yo'q! OFFLINE deb belgilandi.`
        );

        ClientManager.updateComputerOnlineStatus(client.pcId, 'OFFLINE');

        try {
          client.socket.terminate();
        } catch {}
        ClientManager.unregisterClient(client.socket);
      }
    }
  }
}
