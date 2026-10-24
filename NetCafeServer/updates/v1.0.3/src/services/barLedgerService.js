import { db, getClubSettings } from '../db.js';
import { calculateIntervalPrice } from './pricingEngine.js';
import { ClientManager } from './clientManager.js';
import { logAuditEvent } from './auditService.js';

/**
 * Bar Order Ledger & Session Financial Reconciliation Engine
 * Softech Game Club Management System
 */
export class BarLedgerService {

  /**
   * Seans yakunlanishidan oldin to'liq hisob-kitobni (O'yin vaqti + Bar buyurtmalari)
   * oldindan hisoblab chiqarish va ko'rsatish
   */
  static getSessionCheckoutPreview(target, clubId = 1) {
    if (!target) {
      throw new Error('Seans ID yoki Kompyuter ID talab qilinadi.');
    }

    const targetNum = /^\d+$/.test(String(target).trim()) ? parseInt(target, 10) : -999999;
    const pc = db.prepare(`
      SELECT id, name, pc_number, current_session_id, club_id 
      FROM computers 
      WHERE id = ? OR name = ? OR pc_number = ?
    `).get(String(target), String(target), targetNum);

    const sessionId = pc?.current_session_id || target;

    const session = db.prepare(`
      SELECT s.*, c.name as computer_name, c.pc_number, c.id as resolved_pc_id, t.price_per_hour, t.name as tariff_name
      FROM sessions s
      LEFT JOIN computers c ON (s.computer_id = c.id OR s.computer_id = c.pc_number)
      LEFT JOIN tariffs t ON s.tariff_id = t.id
      WHERE s.id = ?
    `).get(sessionId);

    if (!session) {
      throw new Error('Faol seans topilmadi.');
    }

    const targetClubId = session.club_id || pc?.club_id || clubId || 1;
    const startedAt = new Date(session.started_at).getTime();
    const now = Date.now();
    const playedMinutes = Math.max(1, Math.ceil((now - startedAt) / 60000));
    const playedHours = Number((playedMinutes / 60).toFixed(1));
    const isPostpaid = Boolean(session.notes === 'POSTPAID' || session.paid_amount === 0);

    // 1. O'yin vaqti narxi hisob-kitobi
    let gameBill = 0;
    const settings = getClubSettings(targetClubId);

    if (isPostpaid) {
      if (settings?.vip_pricing_mode === 'CUSTOM') {
        const rate = settings.vip_custom_price || 15000;
        gameBill = Math.round((playedMinutes / 60) * rate);
      } else {
        const intervalCalc = calculateIntervalPrice(session.started_at, new Date(now), true, targetClubId);
        gameBill = Math.round(intervalCalc.totalAmount || 0);
      }
    } else {
      // Prepaid seans: agar oldindan to'langan bo'lsa
      gameBill = Number(session.paid_amount || session.total_amount || 0);
    }

    // 2. Ushbu seansga/stolda biriktirilgan tasdiqlangan va to'lanmagan bar buyurtmalari
    const computerRef = session.resolved_pc_id || pc?.id || session.computer_id;
    const computerNum = session.pc_number || pc?.pc_number || targetNum;

    const pendingOrders = db.prepare(`
      SELECT * FROM bar_orders 
      WHERE (session_id = ? OR (computer_id = ? AND payment_status = 'PENDING_AT_CHECKOUT') OR (computer_id = ? AND payment_status = 'PENDING_AT_CHECKOUT'))
        AND payment_status = 'PENDING_AT_CHECKOUT'
        AND (club_id = ? OR club_id IS NULL)
    `).all(session.id, computerRef, computerNum, targetClubId);

    let barBill = 0;
    const barItems = [];
    const itemSummaryMap = new Map();

    for (const order of pendingOrders) {
      barBill += Number(order.total_amount || 0);
      const items = db.prepare('SELECT * FROM bar_order_items WHERE order_id = ?').all(order.id);
      for (const it of items) {
        barItems.push({
          orderId: order.id,
          orderNumber: order.order_number,
          barItemId: it.bar_item_id,
          itemName: it.item_name,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          totalPrice: it.total_price
        });

        const currentQty = itemSummaryMap.get(it.item_name) || 0;
        itemSummaryMap.set(it.item_name, currentQty + it.quantity);
      }
    }

    // Bar buyurtmalari qisqacha matni (masalan: "2x Cola, 1x Chips")
    const barSummaryParts = [];
    for (const [name, qty] of itemSummaryMap.entries()) {
      barSummaryParts.push(`${qty}x ${name}`);
    }
    const barSummaryText = barSummaryParts.length > 0 ? barSummaryParts.join(', ') : 'Buyurtmalar yo\'q';

    // 3. Umumiy hisob-kitob (Reconciliation)
    // Postpaid bo'lsa: GameBill + BarBill. 
    // Prepaid bo'lsa: Game allaqachon to'langan, mijoz faqat BarBill to'laydi (yoki jami kassa formulasi bilan ko'rsatiladi).
    const totalSessionCost = gameBill + barBill;
    const amountToCollect = isPostpaid ? totalSessionCost : barBill;

    // Formula matni
    const durationLabel = playedHours >= 1 ? `${playedHours} soat` : `${playedMinutes} daqiqa`;
    const formulaText = barBill > 0
      ? `O'yin vaqti: ${durationLabel} (${gameBill.toLocaleString()} UZS) + Bardan: ${barSummaryText} (${barBill.toLocaleString()} UZS) = JAMI: ${totalSessionCost.toLocaleString()} UZS`
      : `O'yin vaqti: ${durationLabel} (${gameBill.toLocaleString()} UZS) = JAMI: ${totalSessionCost.toLocaleString()} UZS`;

    return {
      success: true,
      sessionId: session.id,
      computerId: session.computer_id,
      computerName: session.computer_name || `PC-${session.pc_number || session.computer_id}`,
      customerName: session.customer_name || 'Mehmon',
      startedAt: session.started_at,
      playedMinutes,
      playedHours,
      isPostpaid,
      tariffName: session.tariff_name || (isPostpaid ? 'VIP Postpaid' : 'Standart'),
      gameBill,
      barBill,
      finalBill: totalSessionCost,
      amountToCollect,
      barItems,
      barSummaryText,
      formulaText,
      pendingOrderCount: pendingOrders.length
    };
  }

  /**
   * Seansni to'liq yopish va to'lovlarni transactions jadvaliga ajratib yozish
   */
  static executeSessionCheckout({ target, paymentMethod = 'CASH', cashierUserId, clubId = 1, broadcastUpdate = null }) {
    const preview = this.getSessionCheckoutPreview(target, clubId);
    const validPayMethod = ['CARD', 'CLICK', 'PAYME'].includes(paymentMethod) ? 'CARD' : 'CASH';

    db.exec('BEGIN TRANSACTION;');
    try {
      const targetClubId = clubId || 1;

      // 1. O'yin vaqti tranzaksiyasi (agar Postpaid bo'lsa va to'lov olinayotgan bo'lsa)
      if (preview.isPostpaid && preview.gameBill > 0) {
        db.prepare(`
          INSERT INTO transactions (id, club_id, session_id, amount, payment_type, payment_method, transaction_type, created_by, notes)
          VALUES (?, ?, ?, ?, ?, ?, 'POSTPAID_SETTLEMENT', ?, ?)
        `).run(
          `tx_game_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
          targetClubId,
          preview.sessionId,
          preview.gameBill,
          validPayMethod,
          validPayMethod,
          String(cashierUserId || 'system'),
          `GAME_TIME_SETTLEMENT: ${preview.playedHours}h`
        );
      }

      // 2. Bar savdosi tranzaksiyasi (agar barda to'lanmagan buyurtmalar bo'lsa)
      if (preview.barBill > 0) {
        db.prepare(`
          INSERT INTO transactions (id, club_id, session_id, amount, payment_type, payment_method, transaction_type, created_by, notes)
          VALUES (?, ?, ?, ?, ?, ?, 'BAR_SALE', ?, ?)
        `).run(
          `tx_bar_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
          targetClubId,
          preview.sessionId,
          preview.barBill,
          validPayMethod,
          validPayMethod,
          String(cashierUserId || 'system'),
          `BAR_SALE_CHECKOUT: ${preview.barSummaryText}`
        );

        // Barcha tegishli bar buyurtmalarini PAID holatiga o'tkazish
        db.prepare(`
          UPDATE bar_orders 
          SET payment_status = 'PAID', payment_method = ?
          WHERE (session_id = ? OR (computer_id = ? AND payment_status = 'PENDING_AT_CHECKOUT'))
            AND payment_status = 'PENDING_AT_CHECKOUT'
        `).run(validPayMethod, preview.sessionId, preview.computerId);
      }

      // 3. Sessiyani yakunlash (COMPLETED)
      db.prepare(`
        UPDATE sessions 
        SET status = 'COMPLETED', ends_at = CURRENT_TIMESTAMP, total_amount = ?, paid_amount = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(preview.finalBill, preview.finalBill, preview.sessionId);

      // 4. Kompyuterni qulflash
      db.prepare(`
        UPDATE computers 
        SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? OR pc_number = ?
      `).run(preview.computerId, preview.computerId);

      db.exec('COMMIT;');

      // 5. Kiosk agentiga seans tugaganligi va ekranni qulflash haqida signal yuborish
      ClientManager.send(preview.computerId, 'STOP_SESSION', {
        sessionId: preview.sessionId,
        reason: 'CHECKOUT_COMPLETED',
        forceKillApps: true,
        message: 'Seans muvaffaqiyatli yakunlandi. Tashrifingiz uchun rahmat!'
      });

      ClientManager.send(preview.computerId, 'LOCK_SCREEN', {
        reason: 'SESSION_COMPLETED',
        message: 'Seans yakunlandi. Yangi seans boshlash uchun kassaga murojaat qiling.'
      });

      // 6. Audit jurnaliga hodisani yozish
      logAuditEvent(targetClubId, null, 'SESSION_STOP', {
        sessionId: preview.sessionId,
        computerId: preview.computerId,
        gameBill: preview.gameBill,
        barBill: preview.barBill,
        finalBill: preview.finalBill,
        barSummary: preview.barSummaryText,
        formula: preview.formulaText,
        paymentMethod: validPayMethod
      });

      if (typeof broadcastUpdate === 'function') {
        broadcastUpdate();
      }

      return {
        success: true,
        sessionId: preview.sessionId,
        computerId: preview.computerId,
        gameBill: preview.gameBill,
        barBill: preview.barBill,
        finalBill: preview.finalBill,
        amountCollected: preview.amountToCollect,
        formulaText: preview.formulaText,
        barSummaryText: preview.barSummaryText,
        paymentMethod: validPayMethod
      };
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    }
  }

  /**
   * Kassa va Daily Reports uchun moliyaviy hisobot va bar savdosi tafsilotlari
   */
  static getDailyFinancialReport({ fromDate, toDate, clubId = null }) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const fromParam = fromDate || todayStr;
    const toParam = toDate || todayStr;

    // 1. O'yinlar tushumi (Transactions orqali: PREPAID & POSTPAID_SETTLEMENT)
    const gameCashRow = clubId === null
      ? db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total FROM transactions
          WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND (payment_type = 'CASH' OR payment_method = 'CASH')
            AND (transaction_type IN ('PREPAID', 'POSTPAID_SETTLEMENT') OR (notes IS NULL OR (notes NOT LIKE 'BAR_SALE%' AND notes NOT LIKE 'CLIENT_TOPUP%' AND notes NOT LIKE '%REFUND%')))
        `).get(fromParam, toParam)
      : db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total FROM transactions
          WHERE club_id = ?
            AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND (payment_type = 'CASH' OR payment_method = 'CASH')
            AND (transaction_type IN ('PREPAID', 'POSTPAID_SETTLEMENT') OR (notes IS NULL OR (notes NOT LIKE 'BAR_SALE%' AND notes NOT LIKE 'CLIENT_TOPUP%' AND notes NOT LIKE '%REFUND%')))
        `).get(clubId, fromParam, toParam);

    const gameCardRow = clubId === null
      ? db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total FROM transactions
          WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND (payment_type IN ('CARD', 'CLICK', 'PAYME') OR payment_method IN ('CARD', 'CLICK', 'PAYME'))
            AND (transaction_type IN ('PREPAID', 'POSTPAID_SETTLEMENT') OR (notes IS NULL OR (notes NOT LIKE 'BAR_SALE%' AND notes NOT LIKE 'CLIENT_TOPUP%' AND notes NOT LIKE '%REFUND%')))`
        ).get(fromParam, toParam)
      : db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total FROM transactions
          WHERE club_id = ?
            AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND (payment_type IN ('CARD', 'CLICK', 'PAYME') OR payment_method IN ('CARD', 'CLICK', 'PAYME'))
            AND (transaction_type IN ('PREPAID', 'POSTPAID_SETTLEMENT') OR (notes IS NULL OR (notes NOT LIKE 'BAR_SALE%' AND notes NOT LIKE 'CLIENT_TOPUP%' AND notes NOT LIKE '%REFUND%')))`
        ).get(clubId, fromParam, toParam);

    const gameCash = Number(gameCashRow?.total || 0);
    const gameCard = Number(gameCardRow?.total || 0);
    const gameRevenue = gameCash + gameCard;

    // 2. Bar savdosi:
    // a) Bardan (klientlar o'tirgan stollaridan / PC sessiyalaridan) tushgan pul
    const barInSessionRow = clubId === null
      ? db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders
          WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND payment_status = 'PAID'
            AND (payment_method = 'ON_PC_SESSION' OR session_id IS NOT NULL OR computer_id IS NOT NULL)
        `).get(fromParam, toParam)
      : db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders
          WHERE club_id = ?
            AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND payment_status = 'PAID'
            AND (payment_method = 'ON_PC_SESSION' OR session_id IS NOT NULL OR computer_id IS NOT NULL)
        `).get(clubId, fromParam, toParam);

    // b) Bardan (to'g'ridan-to'g'ri naqdga / kassadan stolsiz) tushgan pul
    const barDirectRow = clubId === null
      ? db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders
          WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND payment_status = 'PAID'
            AND (computer_id IS NULL AND (session_id IS NULL OR session_id = ''))
        `).get(fromParam, toParam)
      : db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) as total FROM bar_orders
          WHERE club_id = ?
            AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND payment_status = 'PAID'
            AND (computer_id IS NULL AND (session_id IS NULL OR session_id = ''))
        `).get(clubId, fromParam, toParam);

    const barInSessionRevenue = Number(barInSessionRow?.total || 0);
    const barDirectRevenue = Number(barDirectRow?.total || 0);
    const barRevenue = barInSessionRevenue + barDirectRevenue;

    // 3. Bar Sof Foydasi
    const barProfitRows = clubId === null
      ? db.prepare(`
          SELECT boi.total_price, boi.quantity, COALESCE(bi.buy_price, 0) as buy_price
          FROM bar_order_items boi
          JOIN bar_orders bo ON bo.id = boi.order_id
          LEFT JOIN bar_items bi ON bi.id = boi.bar_item_id
          WHERE substr(bo.created_at, 1, 10) >= ? AND substr(bo.created_at, 1, 10) <= ?
            AND bo.payment_status = 'PAID'
        `).all(fromParam, toParam)
      : db.prepare(`
          SELECT boi.total_price, boi.quantity, COALESCE(bi.buy_price, 0) as buy_price
          FROM bar_order_items boi
          JOIN bar_orders bo ON bo.id = boi.order_id
          LEFT JOIN bar_items bi ON bi.id = boi.bar_item_id
          WHERE bo.club_id = ?
            AND substr(bo.created_at, 1, 10) >= ? AND substr(bo.created_at, 1, 10) <= ?
            AND bo.payment_status = 'PAID'
        `).all(clubId, fromParam, toParam);

    let barProfit = 0;
    for (const row of barProfitRows) {
      barProfit += (Number(row.total_price || 0) - (Number(row.buy_price || 0) * Number(row.quantity || 1)));
    }

    // 4. Qaysi tovarlar eng ko'p sotilgani statistikasi (Top-Selling Bar Items)
    const topSellingRows = clubId === null
      ? db.prepare(`
          SELECT 
            boi.item_name,
            COALESCE(bi.category, 'DRINKS') as category,
            SUM(boi.quantity) as total_quantity,
            SUM(boi.total_price) as total_sales,
            COALESCE(bi.buy_price, 0) as buy_price,
            (SUM(boi.total_price) - (COALESCE(bi.buy_price, 0) * SUM(boi.quantity))) as net_profit
          FROM bar_order_items boi
          JOIN bar_orders bo ON bo.id = boi.order_id
          LEFT JOIN bar_items bi ON bi.id = boi.bar_item_id
          WHERE substr(bo.created_at, 1, 10) >= ? AND substr(bo.created_at, 1, 10) <= ?
            AND bo.payment_status = 'PAID'
          GROUP BY boi.item_name
          ORDER BY total_quantity DESC, total_sales DESC
          LIMIT 10
        `).all(fromParam, toParam)
      : db.prepare(`
          SELECT 
            boi.item_name,
            COALESCE(bi.category, 'DRINKS') as category,
            SUM(boi.quantity) as total_quantity,
            SUM(boi.total_price) as total_sales,
            COALESCE(bi.buy_price, 0) as buy_price,
            (SUM(boi.total_price) - (COALESCE(bi.buy_price, 0) * SUM(boi.quantity))) as net_profit
          FROM bar_order_items boi
          JOIN bar_orders bo ON bo.id = boi.order_id
          LEFT JOIN bar_items bi ON bi.id = boi.bar_item_id
          WHERE bo.club_id = ?
            AND substr(bo.created_at, 1, 10) >= ? AND substr(bo.created_at, 1, 10) <= ?
            AND bo.payment_status = 'PAID'
          GROUP BY boi.item_name
          ORDER BY total_quantity DESC, total_sales DESC
          LIMIT 10
        `).all(clubId, fromParam, toParam);

    const topSellingItems = topSellingRows.map((row, idx) => ({
      rank: idx + 1,
      itemName: row.item_name,
      category: row.category,
      totalQuantity: Number(row.total_quantity || 0),
      totalSales: Number(row.total_sales || 0),
      netProfit: Number(row.net_profit || 0)
    }));

    // 5. Mijoz balansi to'ldirish (Topup)
    const topupRow = clubId === null
      ? db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total FROM client_transactions
          WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND type = 'TOPUP'
        `).get(fromParam, toParam)
      : db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total FROM client_transactions
          WHERE club_id = ?
            AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
            AND type = 'TOPUP'
        `).get(clubId, fromParam, toParam);

    const topupRevenue = Number(topupRow?.total || 0);
    const totalNetRevenue = gameRevenue + barRevenue + topupRevenue;

    return {
      from: fromParam,
      to: toParam,
      summary: {
        totalRevenue: totalNetRevenue,
        gameRevenue,
        gameCash,
        gameCard,
        barRevenue,
        barInSessionRevenue,
        barDirectRevenue,
        barProfit,
        topupRevenue
      },
      topSellingItems
    };
  }
}
