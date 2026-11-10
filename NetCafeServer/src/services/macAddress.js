export function normalizeMacAddress(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|(?:[0-9a-f]{2}-){5}[0-9a-f]{2})$/i.test(text))
    throw new Error('MAC manzilni AA:BB:CC:DD:EE:FF formatida kiriting.');
  const hex = text.replace(/[:-]/g, '').toUpperCase();
  if (hex === '000000000000' || (parseInt(hex.slice(0, 2), 16) & 1))
    throw new Error('Kompyuter Ethernet adapterining haqiqiy MAC manzilini kiriting.');
  return hex.match(/.{2}/g).join(':');
}
