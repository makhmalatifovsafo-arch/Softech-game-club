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
      WHERE c.club_id = ? AND (c.id = ? OR c.name = ? OR c.pc_number = ?)
      ORDER BY CASE WHEN c.id = ? THEN 0 ELSE 1 END LIMIT 1
    `).get(clubId || 1, String(computerId), String(computerId), num, String(computerId));

    return pc?.zone_id || pc?.grid_zone_id || null;
  } catch (err) {
    console.warn('[resolveZoneIdForComputer] error:', err.message);
    return null;
  }
}

/**
 * Berilgan sana/vaqt, VIP holat va Zone ID ga mos keladigan tarifni olish (Zone-scoped)
 */
// Equal endpoints mean a full day. An overnight rule belongs to its starting day.
function matchesRate(rate, date) {
  let days;
  try { days = typeof rate.days_of_week === 'string' ? JSON.parse(rate.days_of_week) : rate.days_of_week; }
  catch { return false; }
  days ??= [1,2,3,4,5,6,7];
  if (!Array.isArray(days) || !Number.isFinite(Number(rate.price_per_hour)) || Number(rate.price_per_hour) <= 0) return false;
  const start = timeStrToMinutes(rate.start_time || '00:00');
  const end = timeStrToMinutes(rate.end_time || '00:00');
  const minute = getMinuteOfDay(date), day = getIsoDayOfWeek(date);
  if (start === end) return days.includes(day);
  if (start < end) return days.includes(day) && minute >= start && minute < end;
  return (minute >= start && days.includes(day)) || (minute < end && days.includes(day === 1 ? 7 : day - 1));
}

export function getActiveRateForMoment(momentDate, isVip = false, clubId = 1, zoneId = null) {
  const date = parseOrCurrentDate(momentDate);
  const missing = { configured:false, tariffId:null, scheduleId:null, name:'Tarif belgilanmagan',
    pricePerHour:null, isVip:false, isVipPostpaidAllowed:false, zoneId:zoneId ? Number(zoneId) : null };
  if (zoneId) {
    const rates = db.prepare("SELECT * FROM tariffs WHERE zone_id=? AND club_id=? AND is_active=1 AND type='HOURLY' ORDER BY id ASC").all(zoneId,clubId || 1);
    const rate = rates.find(rate => matchesRate(rate,date));
    if (rate) return { configured:true, tariffId:rate.id, scheduleId:rate.id, name:rate.name,
      pricePerHour:Number(rate.price_per_hour), isVip:Boolean(rate.is_vip_postpaid_allowed),
      isVipPostpaidAllowed:Boolean(rate.is_vip_postpaid_allowed), zoneId:Number(zoneId) };
    // Explicit room rules define the room's coverage; gaps never inherit another price.
    if (rates.length) return missing;
  }
  const rates = db.prepare('SELECT * FROM tariff_schedules WHERE club_id=? ORDER BY priority DESC,id DESC').all(clubId || 1);
  const rate = rates.find(rate => (!rate.is_vip || isVip) && matchesRate(rate,date));
  if (!rate) return missing;
  return { configured:true, tariffId:null, scheduleId:rate.id, name:rate.name, pricePerHour:Number(rate.price_per_hour),
    isVip:Boolean(rate.is_vip), isVipPostpaidAllowed:true, zoneId:null };
}

export function requireRateForMoment(momentDate, isVip = false, clubId = 1, zoneId = null) {
  const rate = getActiveRateForMoment(momentDate,isVip,clubId,zoneId);
  if (!rate.configured) {
    const date = parseOrCurrentDate(momentDate);
    const stamp = date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')+' '+String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0');
    const error = new Error(stamp + ' uchun tarif belgilanmagan. ' + (zoneId ? 'Xona tariflariga yoki Sozlamalar → Dinamik tariflarga' : 'Sozlamalar → Dinamik tariflarga') + ' tarif kiriting.');
    error.code = 'TARIFF_NOT_CONFIGURED';
    throw error;
  }
  return rate;
}

// Split at clock-minute boundaries, including sessions that start at :30 seconds.
function* rateSlices(startEpoch, endEpoch, isVip, clubId, zoneId) {
  for (let cursor = startEpoch; cursor < endEpoch;) {
    const end = Math.min(endEpoch, (Math.floor(cursor / 60000) + 1) * 60000);
    yield { rate:requireRateForMoment(new Date(cursor),isVip,clubId,zoneId), minutes:(end-cursor)/60000 };
    cursor = end;
  }
}

export function calculateMinuteCost(momentDate, isVip = false, clubId = 1, zoneId = null, durationMinutes = 1) {
  const start = new Date(momentDate).getTime();
  let amount = 0;
  for (const {rate,minutes} of rateSlices(start,start+durationMinutes*60000,isVip,clubId,zoneId)) amount += rate.pricePerHour * minutes / 60;
  return amount;
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

  for (const {rate:rateInfo, minutes} of rateSlices(startEpoch, endEpoch, isVip, clubId, zoneId)) {
    const minuteRate = rateInfo.pricePerHour * minutes / 60;
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
    item.minutes += minutes;
    item.amount += minuteRate;

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
  while (maxBudget - accumulated > 1e-7 && minutes < 4320) {
    const rateInfo = requireRateForMoment(currentMoment, isVip, clubId, zoneId);
    const minuteRate = calculateMinuteCost(currentMoment, isVip, clubId, zoneId);

    if (accumulated + minuteRate > maxBudget + 1e-7) {
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
  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 72) throw new Error('Seans vaqti 0 dan katta va 72 soatdan oshmasligi kerak.');
  const minutes = Math.max(1, Math.round(hours * 60));
  const endEpoch = start.getTime() + minutes * 60 * 1000;
  return calculateIntervalPrice(start, new Date(endEpoch), isVip, clubId, zoneId);
}
