/**
 * Dynamic Pricing Calculation Engine
 * 
 * Vaqt oralig'idagi soatlarni har bir faol tariff_schedules qoidalariga
 * kesib (interval slicing) narx va daqiqalarni aniq hisoblaydi.
 * Multi-tenant aware: club_id bo'yicha tegishli klub tariflarini oladi.
 */

import { db } from '../db.js';

/**
 * ISO yoki Date yoki "HH:mm" ni hisobga olgan holda sanani tahlil qilish
 */
function parseDateOrTodayTime(input) {
  if (!input) return new Date();
  if (input instanceof Date) return new Date(input);

  // Agar "16:00" yoki "16:30" kabi vaqt formati bo'lsa
  if (typeof input === 'string' && /^\d{1,2}:\d{2}$/.test(input.trim())) {
    const [h, m] = input.trim().split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  const parsed = new Date(input);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

const parseOrCurrentDate = parseDateOrTodayTime;

/**
 * Berilgan sana vaqtining daqiqadagi ifodasi (0 - 1439)
 */
function getMinuteOfDay(date) {
  const d = (date instanceof Date && !isNaN(date.getTime())) ? date : parseOrCurrentDate(date);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 1-7 formatidagi haftaning kuni: 1=Dushanba ... 7=Yakshanba
 */
function getIsoDayOfWeek(date) {
  const d = (date instanceof Date && !isNaN(date.getTime())) ? date : parseOrCurrentDate(date);
  const day = d.getDay(); // 0=Yakshanba, 1=Dush ... 6=Shanba
  return day === 0 ? 7 : day;
}

/**
 * "10:00" -> 600 daqiqa
 */
function timeStrToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Kompyuter qaysi xonaga tegishli ekanligini (zone_id) aniqlash
 */
export function resolveZoneIdForComputer(computerId, clubId = 1) {
  if (!computerId) return null;
  const num = /^\d+$/.test(String(computerId).trim()) ? parseInt(computerId, 10) : -999999;
  try {
    const pc = db.prepare(`
      SELECT c.id, c.pc_number, c.zone_id, c.zone, g.zone_id as grid_zone_id
      FROM computers c
      LEFT JOIN grid_layout g ON (c.pc_number = g.computer_id AND c.club_id = g.club_id)
      WHERE c.id = ? OR c.name = ? OR c.pc_number = ?
    `).get(String(computerId), String(computerId), num);

    return pc?.zone_id || pc?.grid_zone_id || null;
  } catch (err) {
    console.warn('[resolveZoneIdForComputer] error:', err.message);
    return null;
  }
}

/**
 * Berilgan sana/vaqt, VIP holat va Zone ID ga mos keladigan tarifni olish (Zone-scoped)
 */
export function getActiveRateForMoment(momentDate, isVip = false, clubId = 1, zoneId = null) {
  const dObj = parseOrCurrentDate(momentDate);
  const dayOfWeek = getIsoDayOfWeek(dObj);
  const minuteOfDay = getMinuteOfDay(dObj);

  // 1. Agar zoneId mavjud bo'lsa, xonaga tegishli dinamik tariflarni tekshirish
  if (zoneId) {
    const zoneTariffs = db.prepare(`
      SELECT * FROM tariffs
      WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL) AND is_active = 1
      ORDER BY id ASC
    `).all(zoneId, clubId || 1);

    for (const t of zoneTariffs) {
      let days = [1, 2, 3, 4, 5, 6, 7];
      try {
        if (t.days_of_week) {
          days = typeof t.days_of_week === 'string' ? JSON.parse(t.days_of_week) : t.days_of_week;
        }
      } catch {}

      if (!Array.isArray(days) || !days.includes(dayOfWeek)) continue;

      const startMins = timeStrToMinutes(t.start_time || '00:00');
      const endMins = timeStrToMinutes(t.end_time || '23:59');

      let matches = false;
      if (startMins <= endMins) {
        matches = (minuteOfDay >= startMins && minuteOfDay < endMins);
      } else {
        matches = (minuteOfDay >= startMins || minuteOfDay < endMins);
      }

      if (matches) {
        return {
          tariffId: t.id,
          scheduleId: t.id,
          name: t.name,
          pricePerHour: Number(t.price_per_hour),
          isVip: Boolean(t.is_vip_postpaid_allowed),
          isVipPostpaidAllowed: Boolean(t.is_vip_postpaid_allowed),
          zoneId: Number(zoneId)
        };
      }
    }

    // Agar vaqt oralig'i to'liq mos kelmasa, xonaning 1-faol tarifini zaxira sifatida ishlatamiz
    if (zoneTariffs.length > 0) {
      const fallback = zoneTariffs[0];
      return {
        tariffId: fallback.id,
        scheduleId: fallback.id,
        name: fallback.name,
        pricePerHour: Number(fallback.price_per_hour),
        isVip: Boolean(fallback.is_vip_postpaid_allowed),
        isVipPostpaidAllowed: Boolean(fallback.is_vip_postpaid_allowed),
        zoneId: Number(zoneId)
      };
    }
  }

  // 2. Agar zoneId berilmagan bo'lsa yoki xona tariflari bo'lmasa, umumiy club jadvallarini tekshirish
  const schedules = db.prepare(`
    SELECT * FROM tariff_schedules
    WHERE club_id = ?
    ORDER BY priority DESC, id DESC
  `).all(clubId || 1);

  for (const s of schedules) {
    if (s.is_vip && !isVip) continue;

    let days = [];
    try {
      days = typeof s.days_of_week === 'string' ? JSON.parse(s.days_of_week) : s.days_of_week;
    } catch {
      days = [1, 2, 3, 4, 5, 6, 7];
    }
    if (!Array.isArray(days) || !days.includes(dayOfWeek)) {
      continue;
    }

    const startMins = timeStrToMinutes(s.start_time);
    const endMins = timeStrToMinutes(s.end_time);

    let matches = false;
    if (startMins <= endMins) {
      matches = (minuteOfDay >= startMins && minuteOfDay < endMins);
    } else {
      matches = (minuteOfDay >= startMins || minuteOfDay < endMins);
    }

    if (matches) {
      return {
        tariffId: null,
        scheduleId: s.id,
        name: s.name,
        pricePerHour: Number(s.price_per_hour),
        isVip: Boolean(s.is_vip),
        isVipPostpaidAllowed: true,
        zoneId: null
      };
    }
  }

  // 3. Umumiy zaxira: tariffs jadvalidagi standart soatlik narx
  const defaultTariff = db.prepare('SELECT id, name, price_per_hour FROM tariffs WHERE (zone_id IS NULL OR zone_id = 0) AND (club_id = ? OR club_id IS NULL) AND is_active = 1 ORDER BY price_per_hour ASC LIMIT 1').get(clubId || 1)
    || db.prepare('SELECT id, name, price_per_hour FROM tariffs WHERE is_active = 1 ORDER BY price_per_hour ASC LIMIT 1').get();

  return {
    tariffId: defaultTariff?.id || 'trf_standard_1h',
    scheduleId: null,
    name: defaultTariff?.name || 'Standart soatlik',
    pricePerHour: defaultTariff?.price_per_hour ? Number(defaultTariff.price_per_hour) : 10000,
    isVip: false,
    isVipPostpaidAllowed: true,
    zoneId: null
  };
}

/**
 * 1. Vaqt oralig'i bo'yicha dinamik narxni hisoblash (Start Time -> End Time)
 */
export function calculateIntervalPrice(startDateInput, endDateInput, isVip = false, clubId = 1, zoneId = null) {
  const start = parseDateOrTodayTime(startDateInput);
  const end = parseDateOrTodayTime(endDateInput);

  let startEpoch = start.getTime();
  let endEpoch = end.getTime();

  // Agar end start dan oldin bo'lsa (masalan 23:00 -> 03:00)
  if (endEpoch <= startEpoch) {
    endEpoch += 24 * 60 * 60 * 1000;
  }

  const totalMinutes = Math.max(1, Math.round((endEpoch - startEpoch) / (60 * 1000)));

  let totalAmount = 0;
  const breakdownMap = new Map();

  let currentMoment = new Date(startEpoch);
  for (let m = 0; m < totalMinutes; m++) {
    const rateInfo = getActiveRateForMoment(currentMoment, isVip, clubId, zoneId);
    const minuteRate = rateInfo.pricePerHour / 60;
    totalAmount += minuteRate;

    const key = `${rateInfo.tariffId || rateInfo.scheduleId || 'def'}_${rateInfo.pricePerHour}`;
    if (!breakdownMap.has(key)) {
      breakdownMap.set(key, {
        name: rateInfo.name,
        pricePerHour: rateInfo.pricePerHour,
        minutes: 0,
        amount: 0
      });
    }
    const item = breakdownMap.get(key);
    item.minutes += 1;
    item.amount += minuteRate;

    currentMoment.setTime(currentMoment.getTime() + 60 * 1000);
  }

  const breakdown = Array.from(breakdownMap.values()).map(b => ({
    name: b.name,
    pricePerHour: b.pricePerHour,
    durationMinutes: b.minutes,
    durationHours: Number((b.minutes / 60).toFixed(2)),
    subtotal: Math.round(b.amount)
  }));

  const finalAmount = Math.round(totalAmount);

  return {
    startTime: new Date(startEpoch).toISOString(),
    endTime: new Date(endEpoch).toISOString(),
    totalMinutes,
    totalHours: Number((totalMinutes / 60).toFixed(2)),
    totalAmount: finalAmount,
    zoneId: zoneId ? Number(zoneId) : null,
    breakdown
  };
}

/**
 * 2. Berilgan summa (Amount) bo'yicha qancha vaqt o'ynay olishini hisoblash
 */
export function calculateTimeFromAmount(startDateInput, targetAmount, isVip = false, clubId = 1, zoneId = null) {
  const start = parseDateOrTodayTime(startDateInput);
  let startEpoch = start.getTime();
  const maxBudget = Math.max(0, Number(targetAmount) || 0);

  if (maxBudget <= 0) {
    return {
      startTime: new Date(startEpoch).toISOString(),
      endTime: new Date(startEpoch).toISOString(),
      totalMinutes: 0,
      totalHours: 0,
      totalAmount: 0,
      zoneId: zoneId ? Number(zoneId) : null,
      breakdown: []
    };
  }

  let accumulated = 0;
  let currentMoment = new Date(startEpoch);
  let minutes = 0;
  const breakdownMap = new Map();

  // Maksimal 72 soat (4320 daqiqa) xavfsizlik cheklovi
  while (accumulated < maxBudget && minutes < 4320) {
    const rateInfo = getActiveRateForMoment(currentMoment, isVip, clubId, zoneId);
    const minuteRate = rateInfo.pricePerHour / 60;

    if (accumulated + minuteRate > maxBudget && minutes > 0) {
      break;
    }

    accumulated += minuteRate;
    minutes += 1;

    const key = `${rateInfo.tariffId || rateInfo.scheduleId || 'def'}_${rateInfo.pricePerHour}`;
    if (!breakdownMap.has(key)) {
      breakdownMap.set(key, {
        name: rateInfo.name,
        pricePerHour: rateInfo.pricePerHour,
        minutes: 0,
        amount: 0
      });
    }
    const item = breakdownMap.get(key);
    item.minutes += 1;
    item.amount += minuteRate;

    currentMoment.setTime(currentMoment.getTime() + 60 * 1000);
  }

  const breakdown = Array.from(breakdownMap.values()).map(b => ({
    name: b.name,
    pricePerHour: b.pricePerHour,
    durationMinutes: b.minutes,
    durationHours: Number((b.minutes / 60).toFixed(2)),
    subtotal: Math.round(b.amount)
  }));

  return {
    startTime: new Date(startEpoch).toISOString(),
    endTime: new Date(startEpoch + minutes * 60 * 1000).toISOString(),
    totalMinutes: minutes,
    totalHours: Number((minutes / 60).toFixed(2)),
    totalAmount: Math.round(accumulated),
    zoneId: zoneId ? Number(zoneId) : null,
    breakdown
  };
}

/**
 * 3. Berilgan durationHours (masalan 2.5 soat) bo'yicha hisoblash
 */
export function calculateFromDurationHours(startDateInput, durationHours, isVip = false, clubId = 1, zoneId = null) {
  const start = parseDateOrTodayTime(startDateInput);
  const minutes = Math.max(1, Math.round(Number(durationHours || 1) * 60));
  const endEpoch = start.getTime() + minutes * 60 * 1000;
  return calculateIntervalPrice(start, new Date(endEpoch), isVip, clubId, zoneId);
}
