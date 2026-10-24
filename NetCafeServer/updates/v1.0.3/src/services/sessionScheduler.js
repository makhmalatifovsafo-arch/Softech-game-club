import { db } from '../db.js';
import { ClientManager } from './clientManager.js';

export class SessionScheduler {
  static timer = null;
  static INTERVAL_MS = 5000;
  static lastSyncMinute = -1;

  static start() {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.checkActiveSessions();
    }, this.INTERVAL_MS);

    console.log(`⏱️ [SessionScheduler] Ishga tushirildi (Tekshirish oralig'i: ${this.INTERVAL_MS / 1000}s).`);
  }

  static stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  static checkActiveSessions() {
    try {
      const now = new Date();
      const currentMinute = now.getMinutes();
      const shouldSyncTime = currentMinute !== this.lastSyncMinute;

      const activeSessions = db.prepare(`
        SELECT s.id, s.computer_id, c.pc_number, s.ends_at, s.tariff_id, s.customer_name, s.notes
        FROM sessions s
        JOIN computers c ON s.computer_id = c.id
        WHERE s.status = 'ACTIVE'
      `).all();

      for (const session of activeSessions) {
        // Agar mijoz balansidan jonli yechiladigan rejim bo'lsa (CLIENT_BALANCE_LIVE:userId)
        if (session.notes && session.notes.startsWith('CLIENT_BALANCE_LIVE:')) {
          const clientId = parseInt(session.notes.split(':')[1], 10);
          this.handleLiveBalanceSession(session, clientId, now);
          continue;
        }

        const endsAtEpoch = new Date(session.ends_at).getTime();
        const diffSeconds = Math.floor((endsAtEpoch - now.getTime()) / 1000);

        if (diffSeconds <= 0) {
          this.expireSession(session);
        } else if (shouldSyncTime) {
          const payload = {
            sessionId: session.id,
            remainingSeconds: diffSeconds,
            endsAt: endsAtEpoch,
          };
          ClientManager.send(session.computer_id, 'UPDATE_REMAINING_TIME', payload);
        }
      }

      if (shouldSyncTime) {
        this.lastSyncMinute = currentMinute;
      }
    } catch (error) {
      console.error('❌ [SessionScheduler] Xatolik yuz berdi:', error);
    }
  }

  /**
   * Klient balansi hisobidan o'ynayotgan sessiyani har daqiqa yangilash
   */
  static handleLiveBalanceSession(session, clientId, now) {
    try {
      const user = db.prepare('SELECT id, balance, username FROM users WHERE id = ?').get(clientId);
      if (!user || user.balance <= 0) {
        console.log(`🛑 [SessionScheduler] Klient #${clientId} balansi tugadi! PC #${session.pc_number} qulflanmoqda.`);
        this.expireSession(session);
        return;
      }

      const endsAtEpoch = new Date(session.ends_at).getTime();
      const diffSeconds = Math.max(0, Math.floor((endsAtEpoch - now.getTime()) / 1000));

      // Har bir intervalda Client Agent ga real-time signal yuborish
      ClientManager.send(session.computer_id, 'CLIENT_BALANCE_UPDATE', {
        sessionId: session.id,
        clientId: user.id,
        username: user.username,
        currentBalance: user.balance,
        remainingSeconds: diffSeconds,
        endsAt: endsAtEpoch,
        message: `Mijoz balansi: ${user.balance.toLocaleString()} UZS`
      });

      if (diffSeconds <= 0) {
        this.expireSession(session);
      }
    } catch (err) {
      console.error('❌ [SessionScheduler] handleLiveBalanceSession xatosi:', err);
    }
  }

  static expireSession(session) {
    console.log(`🛑 [SessionScheduler] Sessiya #${session.id} (PC #${session.pc_number}) vaqti tugadi! Bloklanmoqda...`);

    // Ushbu seansga tegishli to'lanmagan bar buyurtmalari mavjudligini tekshirish
    const barRow = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count 
      FROM bar_orders 
      WHERE (session_id = ? OR computer_id = ?) 
        AND payment_status = 'PENDING_AT_CHECKOUT'
    `).get(session.id, session.pc_number);

    const pendingBarTotal = Number(barRow?.total || 0);

    db.prepare(`
      UPDATE sessions 
      SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(session.id);

    db.prepare(`
      UPDATE computers 
      SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(session.computer_id);

    const lockMessage = pendingBarTotal > 0
      ? `Seans tugadi! Bardan to'lanmagan buyurtmalaringiz mavjud: ${pendingBarTotal.toLocaleString()} UZS. Iltimos, kassaga to'lovni amalga oshiring.`
      : 'Sessiya vaqti tugadi. Qayta boshlash uchun kassaga murojaat qiling.';

    ClientManager.send(session.computer_id, 'STOP_SESSION', {
      sessionId: session.id,
      reason: 'TIME_EXPIRED',
      forceKillApps: true,
      pendingBarDebt: pendingBarTotal,
      message: lockMessage,
    });

    ClientManager.send(session.computer_id, 'LOCK_SCREEN', {
      reason: pendingBarTotal > 0 ? 'SESSION_ENDED_WITH_BAR_DEBT' : 'SESSION_ENDED',
      pendingBarDebt: pendingBarTotal,
      message: lockMessage,
    });

    if (pendingBarTotal > 0) {
      ClientManager.broadcast('SESSION_EXPIRED_WITH_BAR_DEBT', {
        sessionId: session.id,
        computerId: session.computer_id,
        pcNumber: session.pc_number,
        customerName: session.customer_name || 'Mehmon',
        barDebt: pendingBarTotal,
        message: `⚠️ PC-${session.pc_number} seansi tugadi! To'lanmagan bar buyurtmasi: ${pendingBarTotal.toLocaleString()} UZS`
      });
    }
  }

  /**
   * Favqulodda barcha seanslarni to'xtatish va mijozlarni qulflash (Remote Kill-Switch uchun)
   */
  static dropAllActiveSessions(reason = 'LOCKED_BY_ADMIN') {
    try {
      const activeSessions = db.prepare(`
        SELECT s.id, s.computer_id, c.pc_number, s.customer_name 
        FROM sessions s 
        JOIN computers c ON s.computer_id = c.id 
        WHERE s.status = 'ACTIVE'
      `).all();

      for (const session of activeSessions) {
        db.prepare("UPDATE sessions SET status = 'COMPLETED', ended_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
        db.prepare("UPDATE computers SET status = 'LOCKED', current_session_id = NULL WHERE id = ?").run(session.computer_id);
        
        ClientManager.send(session.computer_id, 'STOP_SESSION', {
          sessionId: session.id,
          reason,
          forceKillApps: true,
          message: "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16"
        });

        ClientManager.send(session.computer_id, 'EMERGENCY_LOCKDOWN', {
          reason,
          message: "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning: +998 95 222 06 44, +998 99 563 45 16",
          supportPhone: '+998 95 222 06 44, +998 99 563 45 16'
        });
      }
      console.log(`🔒 [SessionScheduler] Barcha ${activeSessions.length} ta faol seans to'xtatildi (${reason}).`);
    } catch (err) {
      console.warn('dropAllActiveSessions xatoligi:', err.message);
    }
  }
}
