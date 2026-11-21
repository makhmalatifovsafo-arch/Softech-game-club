(function (root) {
  'use strict';
  const supported = new Set(['/api/clients/topup', '/api/bar/orders']);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const newId = () => Array.from(root.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

  function create({ storage, execute, confirmPending = () => false, uuid = newId }) {
    const busy = new Set();
    return {
      async post(scope, path, payload, summary = '') {
        if (!supported.has(path) && path!=='/api/bookings' && !/^\/api\/bookings\/\d+\/(check-in|cancel|refund)$/.test(path)) throw Error('Noto‘g‘ri to‘lov amali.');
        const key = 'softech-money-pending:' + JSON.stringify([scope, path]);
        if (busy.has(key)) throw Error('Oldingi amal tasdig‘i kutilmoqda.');
        busy.add(key);
        try {
          const body = JSON.parse(JSON.stringify(payload));
          const fingerprint = JSON.stringify(canonical(body));
          let pending;
          try {
            pending = JSON.parse(storage.getItem(key) || 'null');
            if (pending && (!pending.requestId || !pending.body || !pending.fingerprint)) throw Error();
          } catch { throw Error('Oldingi to‘lov yozuvini o‘qib bo‘lmadi. Yangi amal yuborilmadi.'); }
          if (pending?.unverified) throw Error('Oldingi amalni serverdagi amallar tarixidan tekshiring. Server yangilanmaguncha takroriy yuborish to‘xtatildi.');
          const recoveringDifferent = pending && pending.fingerprint !== fingerprint;
          if (recoveringDifferent && !await confirmPending(pending.summary))
            throw Error('Avval oldingi amal natijasini tekshiring. Yangi amal yuborilmadi.');
          if (!pending) {
            pending = { requestId: uuid(), body, fingerprint, summary, createdAt: new Date().toISOString() };
            try { storage.setItem(key, JSON.stringify(pending)); }
            catch { throw Error('To‘lov raqamini saqlab bo‘lmadi. Amal yuborilmadi; brauzer xotirasini tekshiring.'); }
          }
          let response;
          try { response = await execute(path, { ...pending.body, requestId: pending.requestId }); }
          catch { throw Error('Javob olinmadi. Qayta tasdiqlasangiz, shu amal tekshiriladi; pul qayta yozilmaydi.'); }
          const data = response.body;
          if (response.status < 200 || response.status >= 300) {
            if (data?.operationNotApplied === true && data.requestId === pending.requestId) storage.removeItem(key);
            throw Error(data?.error || 'Amal tasdiqlanmadi. Shu amalni qayta tekshiring.');
          }
          if (data?.requestId !== pending.requestId) {
            // Never replay against an older server that ignored the ID.
            pending.unverified = true;
            storage.setItem(key, JSON.stringify(pending));
            throw Error('Server to‘lov raqamini tasdiqlamadi. Amallar tarixini tekshiring; amalni takrorlamang.');
          }
          storage.removeItem(key);
          if (recoveringDifferent)
            throw Error('Oldingi amal tasdiqlandi: ' + (pending.summary || 'to‘lov saqlandi') + '. Yangi amal yuborilmadi; uni endi alohida tasdiqlashingiz mumkin.');
          return data;
        } finally { busy.delete(key); }
      }
    };
  }
  root.SoftechMoneyRequests = { create };
  let cashier;
  root.postMoneyOperation = async function (path, body, summary) {
    if (typeof currentUser === 'undefined' || !currentUser?.id) throw Error('Avval akkauntga kiring.');
    cashier ||= create({
      storage: root.localStorage,
      execute: async (route, payload) => {
        const response = await root.fetch(route, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(20000)
        });
        return { status: response.status, body: await response.json() };
      },
      confirmPending: summary => root.confirm('Oldingi amal javobi olinmagan:\n' + (summary || 'To‘lov') +
        '\n\nAvval shu amalni tekshirasizmi? U ilgari saqlangan bo‘lsa, qayta yozilmaydi. Yangi amal hozir yuborilmaydi.')
    });
    return cashier.post([currentUser.clubId || 1, String(currentUser.id)], path, body, summary);
  };
})(globalThis);
