import { clientSessionState } from './clientSessionState.js';
import { settleMemberUsage, getMemberSessionSummary } from './memberBilling.js';
import { db } from '../db.js';
import { ClientManager } from './clientManager.js';
import { getSessionBarDebt } from './sessionBarDebt.js';
import { isPostpaidSession } from './sessionMode.js';

export class SessionScheduler {
  static timer = null;
  static INTERVAL_MS = 5000;
  static lastSyncMinute = -1;

  static start() {
    if (this.timer) return;

    // Reconcile persisted deadlines before waiting for the first interval.
    // Valid paid/postpaid sessions survive; only already expired prepaid rows
    // are settled.
    this.reconcileAfterStartup();

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

  static reconcileAfterStartup(now = new Date()) {
    const result = { preserved: 0, expired: 0, invalid: 0 };
    const sessions = db.prepare("SELECT * FROM sessions WHERE status='ACTIVE'").all();
    for (const session of sessions) {
      try {
      if (isPostpaidSession(session)) { result.preserved++; continue; }
      const deadline = Date.parse(session.ends_at);
      if (!Number.isFinite(deadline)) {
        result.invalid++;
        console.error(`[SessionScheduler] Session ${session.id}: ends_at noto'g'ri; avtomatik yopilmadi.`);
        continue;
      }
      if (deadline <= now.getTime()) {
        this.finishSession(session, { reason: 'TIME_EXPIRED', now });
        result.expired++;
      } else result.preserved++;
      } catch (error) {
        result.invalid++;
        console.error(`[SessionScheduler] Restart reconciliation ${session.id}:`, error);
      }
    }
    return result;
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
        try {
        // Refresh financial information once per minute, independent of time-limit mode.
        if (shouldSyncTime) ClientManager.send(session.computer_id,'SESSION_INFO',clientSessionState(session.id,now.getTime()));
        // Postpaid is open-ended: only cashier checkout may settle and close it.
        if (isPostpaidSession(session)) continue;
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
            authoritativeAt: now.getTime(),
          };
          ClientManager.send(session.computer_id, 'UPDATE_REMAINING_TIME', payload);
        }
        } catch (error) {
          // One invalid tariff/session or disconnected client must not stop
          // expiration and balance accounting for every other computer.
          console.error(`[SessionScheduler] Session ${session.id}:`, error);
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
    const result=settleMemberUsage(session.id,now);
    if (!result) return;
    ClientManager.send(session.computer_id,'CLIENT_BALANCE_UPDATE',{sessionId:session.id,clientId,...result});
    if(result.exhausted) this.expireSession(session);
  }

  static expireSession(session) {
    return this.finishSession(session);
  }

  static finishSession(session, { reason = 'TIME_EXPIRED', now = new Date() } = {}) {
    let notice, pendingBarTotal, memberSummary;
    db.exec('BEGIN IMMEDIATE');
    try {
    session = db.prepare(`SELECT s.*, c.pc_number, c.name AS computer_name FROM sessions s
      JOIN computers c ON c.id=s.computer_id AND c.club_id=s.club_id WHERE s.id=? AND s.status='ACTIVE'`).get(session.id);
    if (!session || isPostpaidSession(session)) { db.exec('ROLLBACK'); return; }
    if (reason === 'LOGOUT' && Date.parse(session.ends_at) <= now.getTime()) reason = 'TIME_EXPIRED';
    settleMemberUsage(session.id,now,true,true);
    console.log(`[SessionScheduler] Session ${session.id} closed: ${reason}`);

    // Ushbu seansga tegishli to'lanmagan bar buyurtmalari mavjudligini tekshirish
    const debt = getSessionBarDebt(db, session, session.pc_number);
    pendingBarTotal = debt.total;
    for (const order of debt.orders) if (!order.session_id)
      db.prepare('UPDATE bar_orders SET session_id=? WHERE id=? AND club_id=? AND session_id IS NULL').run(session.id, order.id, session.club_id);
    const endedAt = reason === 'LOGOUT' ? now.toISOString() : session.ends_at;
    const durationMinutes = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.started_at)) / 60000));
    notice = { sessionId: session.id, computerId: session.computer_id, computerName: session.computer_name,
      pcNumber: session.pc_number, customerName: session.customer_name || 'Mehmon', durationMinutes, reason,
      barDebt: debt.total, barItems: debt.items, barSummary: debt.summary,
      message: `Siz ${debt.summary || 'bar mahsulotlari'} olgansiz. ${debt.total.toLocaleString('uz-UZ')} so‘m pulni kassaga berishni unutmang.` };
    if (debt.total > 0) db.prepare('INSERT OR IGNORE INTO session_end_notices(session_id,club_id,payload_json) VALUES(?,?,?)')
      .run(session.id, session.club_id, JSON.stringify(notice));

    db.prepare(`
      UPDATE sessions 
      SET status = 'COMPLETED', ends_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(endedAt, session.id);

    db.prepare(`
      UPDATE computers 
      SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(session.computer_id);
    memberSummary = getMemberSessionSummary(session.id, pendingBarTotal);
    db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }

    const lockMessage = pendingBarTotal > 0
      ? `Seans tugadi! Bardan to'lanmagan buyurtmalaringiz mavjud: ${pendingBarTotal.toLocaleString()} UZS. Iltimos, kassaga to'lovni amalga oshiring.`
      : 'Sessiya vaqti tugadi. Qayta boshlash uchun kassaga murojaat qiling.';

    ClientManager.send(session.computer_id, 'STOP_SESSION', {
      sessionId: session.id,
      reason,
      forceKillApps: true,
      pendingBarDebt: pendingBarTotal,
      barNotice: pendingBarTotal > 0 ? notice : null,
      memberSummary,
      message: lockMessage,
    });

    ClientManager.send(session.computer_id, 'LOCK_SCREEN', {
      reason: pendingBarTotal > 0 ? 'SESSION_ENDED_WITH_BAR_DEBT' : 'SESSION_ENDED',
      pendingBarDebt: pendingBarTotal,
      message: lockMessage,
    });

    if (pendingBarTotal > 0) {
      ClientManager.broadcast('SESSION_EXPIRED_WITH_BAR_DEBT', notice);
    }
    ClientManager.broadcast('ADMIN_DATA_UPDATED', { sessionId: session.id });
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
        db.exec('BEGIN IMMEDIATE');
        try {
        settleMemberUsage(session.id,new Date(),true,true);
        db.prepare("UPDATE sessions SET status = 'COMPLETED', ends_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
        db.prepare("UPDATE computers SET status = 'LOCKED', current_session_id = NULL WHERE id = ?").run(session.computer_id);
        db.exec('COMMIT');
        } catch(error) {db.exec('ROLLBACK');throw error;}
        
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
