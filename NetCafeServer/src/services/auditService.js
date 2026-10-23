import { db } from '../db.js';
import { ClientManager } from './clientManager.js';

/**
 * Joriy ochiq smenani olish
 */
export function getOpenShift(clubId = 1) {
  try {
    return db.prepare('SELECT * FROM shifts WHERE club_id = ? AND is_closed = 0 ORDER BY opened_at DESC LIMIT 1').get(clubId || 1);
  } catch (err) {
    console.error('⚠️ [AuditService] getOpenShift xatosi:', err.message);
    return null;
  }
}

/**
 * Avtomatik kategoriyani aniqlash
 */
function resolveCategory(actionType, explicitCat) {
  if (explicitCat && ['SESSION', 'FINANCE', 'BAR', 'SYSTEM', 'SECURITY'].includes(explicitCat)) {
    return explicitCat;
  }
  const type = String(actionType || '').toUpperCase();
  if (type.includes('BAR')) return 'BAR';
  if (type.includes('REFUND') || type.includes('TOPUP') || type.includes('FINANCE') || type.includes('SHIFT') || type.includes('DEPOSIT')) return 'FINANCE';
  if (type.includes('SESSION') || type.includes('START') || type.includes('STOP') || type.includes('EXTEND') || type.includes('SWAP')) return 'SESSION';
  if (type.includes('SECURITY') || type.includes('USB') || type.includes('GUARD') || type.includes('ALERT') || type.includes('LOCK')) return 'SECURITY';
  return 'SYSTEM';
}

/**
 * Formatlanuvchi pul qiymati
 */
function formatMoney(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return '0 UZS';
  return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' UZS';
}

/**
 * Audit yozuvini inson o'qiy oladigan O'zbekcha sarlavha va rang bilan boyitish
 */
export function formatAuditEntry(row) {
  let parsedDetails = {};
  if (typeof row.details === 'string') {
    try {
      parsedDetails = JSON.parse(row.details || '{}');
    } catch {
      parsedDetails = { raw: row.details };
    }
  } else if (typeof row.details === 'object' && row.details !== null) {
    parsedDetails = row.details;
  }

  const action = String(row.action_type || row.event_type || '').toUpperCase();
  const category = row.category || resolveCategory(action);
  let title = action;
  let badgeColor = 'blue';
  let impactAmount = null;
  let formattedImpact = '-';
  let summary = '';

  // 1. SESSION Actions
  if (action === 'START_SESSION' || action === 'SESSION_START') {
    title = "Seans boshlandi";
    badgeColor = 'green';
    const amount = parsedDetails.amount || parsedDetails.paidAmount || 0;
    if (amount > 0) {
      impactAmount = Number(amount);
      formattedImpact = `+${formatMoney(impactAmount)}`;
    }
    const cust = parsedDetails.customerName || 'Mehmon';
    const dur = parsedDetails.durationMinutes ? `${Math.round(parsedDetails.durationMinutes / 60 * 10) / 10} soat (${parsedDetails.durationMinutes} daq)` : '';
    const tariff = parsedDetails.tariffName ? `[${parsedDetails.tariffName}]` : '';
    summary = `Mijoz: ${cust} ${tariff} ${dur ? '• ' + dur : ''} ${amount > 0 ? '• ' + formatMoney(amount) : ''}`.trim();
  } else if (action === 'STOP_SESSION' || action === 'SESSION_STOP') {
    title = "Seans yakunlandi";
    badgeColor = 'red';
    const bill = parsedDetails.finalBill || parsedDetails.totalAmount || 0;
    if (bill > 0) {
      formattedImpact = formatMoney(bill);
    }
    summary = parsedDetails.formula || parsedDetails.barSummary 
      ? `${parsedDetails.formula || parsedDetails.barSummary}`
      : `Seans to'xtatildi. Jami hisob: ${formatMoney(bill)}`;
  } else if (action === 'STOP_EARLY_REFUND' || action === 'REFUND') {
    title = "Muddatidan oldin yopildi (Qaytim)";
    badgeColor = 'red';
    const refund = parsedDetails.refundAmount || 0;
    if (refund > 0) {
      impactAmount = -Number(refund);
      formattedImpact = `-${formatMoney(refund)}`;
    }
    summary = `Qaytarilgan mablag': ${formatMoney(refund)} • O'ynalgan: ${parsedDetails.playedMinutes || 0} daqiqa (Jami to'langan: ${formatMoney(parsedDetails.totalPaid || 0)})`;
  } else if (action === 'SESSION_EXTEND') {
    title = "Vaqt uzaytirildi";
    badgeColor = 'green';
    const extra = parsedDetails.addedAmount || parsedDetails.extraAmount || 0;
    if (extra > 0) {
      impactAmount = Number(extra);
      formattedImpact = `+${formatMoney(impactAmount)}`;
    }
    summary = `Qo'shilgan vaqt: ${parsedDetails.addedMinutes || 0} daqiqa • To'lov: ${formatMoney(extra)}`;
  } else if (action === 'PC_SWAP') {
    title = "Kompyuter almashtirildi";
    badgeColor = 'blue';
    summary = `${parsedDetails.fromComputerName || parsedDetails.fromComputerId || 'PC'} dan ${parsedDetails.toComputerName || parsedDetails.toComputerId || 'PC'} ga ko'chirildi.`;
  }

  // 2. BAR Actions
  else if (action === 'BAR_SALE' || action === 'BAR_ORDER' || action === 'NEW_BAR_ORDER') {
    title = "Bar savdosi";
    badgeColor = 'yellow';
    const tot = parsedDetails.totalAmount || parsedDetails.totalPrice || 0;
    if (tot > 0) {
      impactAmount = Number(tot);
      formattedImpact = `+${formatMoney(impactAmount)}`;
    }
    const itemsStr = Array.isArray(parsedDetails.items) 
      ? parsedDetails.items.map(it => typeof it === 'string' ? it : `${it.quantity || 1}x ${it.name || it.item_name}`).join(', ')
      : (parsedDetails.orderNumber ? `Chek: ${parsedDetails.orderNumber}` : '');
    summary = `Chek: ${parsedDetails.orderNumber || ''} • ${itemsStr} • Jami: ${formatMoney(tot)} (${parsedDetails.paymentMethod || 'NAQD'})`;
  }

  // 3. FINANCE Actions
  else if (action === 'TOPUP' || action === 'BALANCE_TOPUP') {
    title = "Mijoz balansi to'ldirildi";
    badgeColor = 'purple';
    const amt = parsedDetails.amount || 0;
    if (amt > 0) {
      impactAmount = Number(amt);
      formattedImpact = `+${formatMoney(amt)}`;
    }
    summary = `Mijoz: ${parsedDetails.username || 'Foydalanuvchi'} • To'ldirildi: ${formatMoney(amt)} (${parsedDetails.paymentMethod || 'CASH'})`;
  } else if (action === 'OPEN_SHIFT') {
    title = "Smena ochildi";
    badgeColor = 'green';
    summary = `Kassir: ${parsedDetails.cashierName || row.actor_username || 'Admin'} • Boshlang'ich kassa: ${formatMoney(parsedDetails.startCash || 0)}`;
  } else if (action === 'CLOSE_SHIFT') {
    title = "Smena yopildi";
    badgeColor = 'red';
    summary = `Topshirilgan naqd: ${formatMoney(parsedDetails.endCash || 0)} • Tizim naqd: ${formatMoney(parsedDetails.systemCash || 0)} • Kassa farqi: ${formatMoney(parsedDetails.difference || 0)}`;
  }

  // 4. SYSTEM & SECURITY
  else if (action === 'REMOTE_SHUTDOWN' || action === 'POWER_ACTION') {
    title = parsedDetails.action === 'REBOOT' ? "Masofaviy qayta yuklash" : "Masofaviy o'chirish";
    badgeColor = 'blue';
    summary = `Admin buyrug'i: ${parsedDetails.action || action} yuborildi.`;
  } else if (action === 'SECURITY_ALERT' || action === 'USB_BLOCKED') {
    title = "Xavfsizlik hodisasi";
    badgeColor = 'purple';
    summary = parsedDetails.message || "Tashqi USB xotira vositasi aniqlandi va darhol bloklandi.";
  } else {
    summary = typeof parsedDetails === 'object' ? JSON.stringify(parsedDetails) : String(parsedDetails);
  }

  // Date/Time extraction
  const rawDateStr = row.created_at || '';
  let timeStr = '';
  let dateStr = '';
  if (rawDateStr) {
    const parts = rawDateStr.split(' ');
    if (parts.length >= 2) {
      dateStr = parts[0];
      timeStr = parts[1].substring(0, 8);
    } else {
      timeStr = rawDateStr;
      dateStr = rawDateStr;
    }
  }

  return {
    id: row.id,
    clubId: row.club_id,
    shiftId: row.shift_id,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username || 'SYSTEM',
    workstationId: row.workstation_id,
    workstationName: row.workstation_name || (row.workstation_id ? `PC-${String(row.workstation_id).padStart(2, '0')}` : '-'),
    category,
    actionType: action,
    title,
    badgeColor,
    impactAmount,
    formattedImpact,
    summary,
    details: parsedDetails,
    createdAt: row.created_at,
    formattedTime: timeStr,
    formattedDate: dateStr
  };
}

/**
 * Tizim voqealarini audit_logs jadvaliga xavfsiz yozish (Append-Only) va WebSocket orqali tarqatish
 */
export function logAuditEvent(param1, param2, param3, param4, param5, param6) {
  try {
    let clubId = 1;
    let shiftId = null;
    let actorUserId = null;
    let actorUsername = 'SYSTEM';
    let workstationId = null;
    let workstationName = null;
    let category = 'SYSTEM';
    let actionType = 'ACTION';
    let detailsObj = {};

    // 1. Agar birinchi parametr obyekt bo'lsa: logAuditEvent({ ... })
    if (typeof param1 === 'object' && param1 !== null) {
      clubId = param1.clubId || 1;
      shiftId = param1.shiftId || null;
      actorUserId = param1.actorUserId || param1.actorId || null;
      actorUsername = param1.actorUsername || param1.adminUsername || param1.createdBy || 'SYSTEM';
      workstationId = param1.workstationId || param1.computerId || param1.pcNumber || null;
      workstationName = param1.workstationName || param1.computerName || param1.pcName || null;
      category = param1.category || resolveCategory(param1.actionType || param1.eventType);
      actionType = param1.actionType || param1.eventType || 'ACTION';
      detailsObj = param1.details || {};
    } 
    // 2. Legacy positional: logAuditEvent(clubId, shiftId, eventType, details, category, actorUsername)
    else {
      clubId = param1 || 1;
      shiftId = param2 || null;
      actionType = param3 || 'ACTION';
      detailsObj = param4 || {};
      category = param5 || resolveCategory(actionType);
      actorUsername = param6 || 'SYSTEM';

      if (typeof detailsObj === 'object' && detailsObj !== null) {
        if (!actorUserId && (detailsObj.actorId || detailsObj.userId)) actorUserId = detailsObj.actorId || detailsObj.userId;
        if (actorUsername === 'SYSTEM' && (detailsObj.actorUsername || detailsObj.adminUsername || detailsObj.createdBy)) {
          actorUsername = detailsObj.actorUsername || detailsObj.adminUsername || detailsObj.createdBy;
        }
        if (!workstationId && (detailsObj.pcNumber || detailsObj.computerId)) {
          const rawPc = detailsObj.pcNumber || detailsObj.computerId;
          const parsed = parseInt(String(rawPc).replace(/\D/g, ''), 10);
          if (!isNaN(parsed)) workstationId = parsed;
        }
        if (!workstationName && (detailsObj.pcName || detailsObj.computerName || detailsObj.computerId)) {
          workstationName = detailsObj.pcName || detailsObj.computerName || detailsObj.computerId;
        }
      }
    }

    // Auto-resolve shift if null
    if (!shiftId) {
      const openShift = getOpenShift(clubId);
      shiftId = openShift ? openShift.id : null;
    }

    // Auto format workstationName if numeric workstationId
    if (workstationId && !workstationName) {
      workstationName = `PC-${String(workstationId).padStart(2, '0')}`;
    }

    category = resolveCategory(actionType, category);

    const detailsStr = typeof detailsObj === 'string' ? detailsObj : JSON.stringify(detailsObj || {});

    const stmt = db.prepare(`
      INSERT INTO audit_logs (club_id, shift_id, actor_user_id, actor_username, workstation_id, workstation_name, category, action_type, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);
    const result = stmt.run(clubId, shiftId, actorUserId, actorUsername, workstationId, workstationName, category, actionType, detailsStr);
    const newId = Number(result.lastInsertRowid);

    const eventPayload = formatAuditEntry({
      id: newId,
      club_id: clubId,
      shift_id: shiftId,
      actor_user_id: actorUserId,
      actor_username: actorUsername,
      workstation_id: workstationId,
      workstation_name: workstationName,
      category,
      action_type: actionType,
      details: detailsObj,
      created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
    });

    // Real-Time broadcast via WebSocket
    ClientManager.broadcast('AUDIT_LOG_ENTRY', { log: eventPayload });
    ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now(), audit: true });

    return eventPayload;
  } catch (err) {
    console.error(`⚠️ [AuditService] logAuditEvent (${param3 || 'ACTION'}) xatolik:`, err.message);
    return null;
  }
}

/**
 * Audit jurnali bo'yicha sana oralig'ida so'rov bajarish
 */
export function getAuditTrail({ clubId = 1, fromDate, toDate, category = null, search = null, limit = 500 }) {
  try {
    let sql = `
      SELECT id, club_id, shift_id, actor_user_id, actor_username, workstation_id, workstation_name,
             category, action_type, details, created_at
      FROM audit_logs
      WHERE 1=1
    `;
    const params = [];

    if (clubId !== null && clubId !== undefined) {
      sql += ` AND club_id = ?`;
      params.push(clubId);
    }

    if (fromDate) {
      sql += ` AND substr(created_at, 1, 10) >= ?`;
      params.push(fromDate);
    }

    if (toDate) {
      sql += ` AND substr(created_at, 1, 10) <= ?`;
      params.push(toDate);
    }

    if (category && category !== 'ALL') {
      sql += ` AND category = ?`;
      params.push(category);
    }

    if (search && search.trim().length > 0) {
      sql += ` AND (workstation_name LIKE ? OR actor_username LIKE ? OR action_type LIKE ? OR details LIKE ?)`;
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q);
    }

    sql += ` ORDER BY created_at DESC, id DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatAuditEntry);
  } catch (err) {
    console.error('⚠️ [AuditService] getAuditTrail xatosi:', err.message);
    return [];
  }
}
