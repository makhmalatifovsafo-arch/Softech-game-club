export function validateSchedule(body) {
  const name = String(body.name || '').trim();
  const start = body.start_time ?? body.startTime;
  const end = body.end_time ?? body.endTime;
  const price = Number(body.price_per_hour ?? body.pricePerHour);
  let days = body.days_of_week ?? body.daysOfWeek;
  try { if (typeof days === 'string') days = JSON.parse(days); } catch { days = null; }
  if (!name || name.length > 120) throw new Error('Tarif nomi 1–120 belgidan iborat bo‘lsin.');
  if (![start,end].every(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
    throw new Error('Boshlanish va tugash vaqtini HH:mm shaklida kiriting.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Soatlik narx 0 dan katta bo‘lishi kerak.');
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7))
    throw new Error('Kamida bitta hafta kunini tanlang (1–7).');
  const priority = Number(body.priority ?? 1);
  if (!Number.isInteger(priority)) throw new Error('Tarif ustuvorligi butun son bo‘lishi kerak.');
  return { name, start, end, price, days:JSON.stringify([...new Set(days)].sort()),
    vip:body.is_vip === true || body.is_vip === 1 || body.isVip === true ? 1 : 0, priority };
}
