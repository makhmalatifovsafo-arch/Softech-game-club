import { calculateFromDurationHours, calculateIntervalPrice, calculateTimeFromAmount } from './pricingEngine.js';

// Single, group and mobile starts share the same mode validation and quotation.
export function prepaidQuote(data, start, clubId, zoneId) {
  try {
    const mode=String(data.mode ?? 'hours').toUpperCase();
    let quote;
    if (['PRICE','AMOUNT'].includes(mode)) {
      quote=calculateTimeFromAmount(start,Number(data.amount ?? data.value),false,clubId,zoneId,true);
    } else if (['ENDTIME','END_TIME'].includes(mode)) {
      const end=data.targetEndTime ?? data.value;
      if (!end) throw new Error('Tugash vaqtini kiriting.');
      quote=calculateIntervalPrice(start,end,false,clubId,zoneId,72);
    } else if (['HOURS','CLIENT'].includes(mode)) {
      const hours=data.durationMinutes !== undefined ? Number(data.durationMinutes)/60 : Number(data.value ?? 1);
      quote=calculateFromDurationHours(start,hours,false,clubId,zoneId);
    } else throw new Error('Seans turi noto‘g‘ri.');
    if (!(quote.totalMinutes>0) || !(quote.totalAmount>0)) throw new Error('Seans vaqti va to‘lovi 0 dan katta bo‘lishi kerak.');
    return quote;
  } catch (error) {
    error.code ||= 'INVALID_SESSION_QUOTE';
    throw error;
  }
}
