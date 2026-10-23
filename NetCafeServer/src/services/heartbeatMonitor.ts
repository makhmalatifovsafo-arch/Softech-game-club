import { ClientManager } from './clientManager.js';

export class HeartbeatMonitor {
  private static timer: NodeJS.Timeout | null = null;
  // 15 soniya davomida signal kelmasa, kompyuter OFFLINE hisoblanadi
  private static readonly TIMEOUT_MS = 15000;
  private static readonly CHECK_INTERVAL_MS = 5000; // Har 5 soniyada tekshirish

  public static start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.checkDeadConnections();
    }, this.CHECK_INTERVAL_MS);

    console.log(`💓 [HeartbeatMonitor] Ishga tushirildi (Check: ${this.CHECK_INTERVAL_MS / 1000}s, Timeout: ${this.TIMEOUT_MS / 1000}s).`);
  }

  public static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private static checkDeadConnections(): void {
    const now = Date.now();
    const clients = ClientManager.getAllClients();

    for (const client of clients) {
      const elapsed = now - client.lastHeartbeat;

      if (elapsed > this.TIMEOUT_MS) {
        console.warn(
          `⚠️ [HeartbeatMonitor] PC #${client.pcNumber} (${client.pcId}) dan ${Math.round(elapsed / 1000)}s signal yo'q! OFFLINE deb belgilandi.`
        );

        // Kompyuterni bazada OFFLINE qilish
        ClientManager.updateComputerOnlineStatus(client.pcId, 'OFFLINE');

        // O'lik soketni yopish
        try {
          client.socket.terminate();
        } catch {
          // ignore
        }
        ClientManager.unregisterClient(client.socket);
      }
    }
  }
}
