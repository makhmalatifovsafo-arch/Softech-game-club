import { db } from '../db.js';
import { ClientManager } from './clientManager.js';
import type {
  UpdateRemainingTimePayload,
  StopSessionPayload,
  LockScreenPayload,
} from '../types/protocol.js';

interface ActiveSessionRow {
  id: string;
  computer_id: string;
  pc_number: number;
  ends_at: string;
  tariff_id: string;
}

export class SessionScheduler {
  private static timer: NodeJS.Timeout | null = null;
  // Har 5 soniyada bazadagi faol sessiyalarni tekshirish (yuqori aniqlik uchun)
  private static readonly INTERVAL_MS = 5000;
  private static lastSyncMinute = -1;

  public static start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.checkActiveSessions();
    }, this.INTERVAL_MS);

    console.log(`⏱️ [SessionScheduler] Ishga tushirildi (Tekshirish oralig'i: ${this.INTERVAL_MS / 1000}s).`);
  }

  public static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Barcha faol sessiyalarni vaqtini tekshirish
   */
  private static checkActiveSessions(): void {
    try {
      const now = new Date();
      const currentMinute = now.getMinutes();
      const shouldSyncTime = currentMinute !== this.lastSyncMinute;

      // Faol sessiyalarni olish
      const activeSessions = db.prepare(`
        SELECT s.id, s.computer_id, c.pc_number, s.ends_at, s.tariff_id
        FROM sessions s
        JOIN computers c ON s.computer_id = c.id
        WHERE s.status = 'ACTIVE'
      `).all() as ActiveSessionRow[];

      for (const session of activeSessions) {
        const endsAtEpoch = new Date(session.ends_at).getTime();
        const diffSeconds = Math.floor((endsAtEpoch - now.getTime()) / 1000);

        if (diffSeconds <= 0) {
          // ==================================================================
          // 1. VAQT TUGADI -> Seansni to'xtatish va kompyuterni qulflash
          // ==================================================================
          this.expireSession(session);
        } else if (shouldSyncTime) {
          // ==================================================================
          // 2. VAQTNI HAR DAQIQADA SINXRONLASH (UPDATE_REMAINING_TIME)
          // ==================================================================
          const payload: UpdateRemainingTimePayload = {
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
   * Sessiya muddati tugaganda bajariladigan operatsiyalar
   */
  private static expireSession(session: ActiveSessionRow): void {
    console.log(`🛑 [SessionScheduler] Sessiya #${session.id} (PC #${session.pc_number}) vaqti tugadi! Bloklanmoqda...`);

    // 1. Bazada sessiyani yakunlash
    db.prepare(`
      UPDATE sessions 
      SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(session.id);

    // 2. Kompyuterni LOCKED holatiga o'tkazish
    db.prepare(`
      UPDATE computers 
      SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(session.computer_id);

    // 3. Klientga STOP_SESSION yuborish
    const stopPayload: StopSessionPayload = {
      sessionId: session.id,
      reason: 'TIME_EXPIRED',
      forceKillApps: true,
      message: 'Sessiya vaqti tugadi. Qayta boshlash uchun kassaga murojaat qiling.',
    };
    ClientManager.send(session.computer_id, 'STOP_SESSION', stopPayload);

    // 4. Klientga LOCK_SCREEN yuborish
    const lockPayload: LockScreenPayload = {
      reason: 'SESSION_ENDED',
      message: 'Seans tugadi! Iltimos, administratorga murojaat qiling.',
    };
    ClientManager.send(session.computer_id, 'LOCK_SCREEN', lockPayload);
  }
}
