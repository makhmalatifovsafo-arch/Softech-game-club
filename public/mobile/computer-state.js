// Connectivity comes from the server's live socket, never from a session/status label.
globalThis.computerState = function (pc) {
  const online = pc.isOnline === true || pc.is_online === 1;
  const seen = Boolean(pc.lastHeartbeat || pc.last_heartbeat);
  if (!online) return seen
    ? { online, key: 'DISCONNECTED', label: 'Aloqa uzilgan', color: '#fb7185', detail: 'Klient bilan aloqa yo‘q. Kompyuter o‘chiq yoki tarmoq uzilgan bo‘lishi mumkin.' }
    : { online, key: 'NEVER_CONNECTED', label: 'Hali ulanmagan', color: '#a1a1aa', detail: 'Kompyuter qo‘shilgan, lekin klient dasturi hali serverga ulanmagan.' };
  if (pc.activeSession || pc.active_session || pc.status === 'OCCUPIED')
    return { online, key: 'OCCUPIED', label: 'Band', color: '#fbbf24', detail: 'Klient ulangan, faol seans bor.' };
  if (pc.status === 'LOCKED')
    return { online, key: 'LOCKED', label: 'Qulflangan', color: '#c084fc', detail: 'Klient ulangan, ekran qulflangan. Bu aloqa nosozligi emas.' };
  if (pc.status === 'MAINTENANCE')
    return { online, key: 'MAINTENANCE', label: 'Texnik xizmat', color: '#38bdf8', detail: 'Klient ulangan, texnik xizmat rejimida.' };
  return { online, key: 'AVAILABLE', label: 'Bo‘sh / tayyor', color: '#34d399', detail: 'Klient ulangan, faol seans yo‘q.' };
};
