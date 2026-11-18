// Shared by the wizard and server readiness validation. Callers must supply
// only current, tenant-scoped socket connections (never stored ONLINE flags).
export const setupIp = value => String(value || '').trim().replace(/^::ffff:/i, '');
const mac = value => String(value || '').trim().replace(/[:-]/g, '').toUpperCase();
export function setupConnection(pc, clients) {
  const live = clients.filter(c => c.connected === true);
  const sameIp = live.filter(c => setupIp(c.ip) === setupIp(pc.ip));
  const identity = sameIp.filter(c => Number(c.number) === Number(pc.number));
  if (identity.length > 1) return { ok:false, reason:'duplicate' };
  if (identity.length === 1) {
    if (pc.mac && mac(identity[0].mac) !== mac(pc.mac)) return { ok:false, reason:'mac', client:identity[0] };
    return { ok:true, client:identity[0] };
  }
  if (sameIp.length) return { ok:false, reason:'number', client:sameIp[0] };
  const sameNumber = live.find(c => Number(c.number) === Number(pc.number));
  return sameNumber ? { ok:false, reason:'ip', client:sameNumber } : { ok:false, reason:'offline' };
}
export function setupConnectionMessage(pc, status) {
  const name = pc.name || `PC-${pc.number}`;
  if (status.ok) return `${name}: ulangan.`;
  switch (status.reason) {
    case 'number': return `${name}: ${setupIp(pc.ip)} manzildagi client PC-${status.client.number} raqami bilan ulangan. “Ulangan clientdan tanlash” orqali moslang.`;
    case 'ip': return `${name}: client ${setupIp(status.client.ip)} manzildan ulangan. “Ulangan clientdan tanlash” orqali IP manzilini moslang.`;
    case 'mac': return `${name}: saqlangan MAC clientnikiga mos emas. “Ulangan clientdan tanlash” orqali manzilni yangilang.`;
    case 'duplicate': return `${name}: bir xil raqam va IP bilan bir nechta ulanish bor. Client raqamlarini tekshiring.`;
    default: return `${name}: hozir server bilan jonli aloqa yo‘q. Client dasturidagi server manzilini va LAN ulanishini tekshiring.`;
  }
}
