(() => {
  const dismissed = new Set();
  const cards = new Map();
  const headers = () => ({ Authorization: 'Bearer ' + (typeof authToken === 'undefined' ? '' : authToken) });
  window.showSessionEndNotice = notice => {
    if (typeof authToken === 'undefined' || !authToken) return;
    if (!notice?.sessionId || !(notice.barDebt > 0) || dismissed.has(notice.sessionId) || cards.has(notice.sessionId)) return;
    let overlay = document.getElementById('sessionEndNotices');
    if (!overlay) {
      overlay = document.createElement('div'); overlay.id = 'sessionEndNotices';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:12000;background:#020617dc;backdrop-filter:blur(10px);overflow:auto;display:flex;flex-direction:column;align-items:center;gap:20px;padding:40px 20px';
      document.body.append(overlay);
    }
    const card = document.createElement('section');
    card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-label', 'Seans tugadi, bar to‘lovi');
    card.style.cssText = 'position:relative;width:min(680px,100%);padding:32px;border:2px solid #fbbf24;border-radius:28px;background:linear-gradient(145deg,#1e293b,#0f172a);color:white;text-align:center;box-shadow:0 20px 80px #0008';
    card.innerHTML = `<button type="button" data-close aria-label="Eslatmani yopish" style="position:absolute;right:15px;top:12px;background:none;border:0;color:#cbd5e1;font-size:30px;cursor:pointer">×</button>
      <div aria-hidden="true" style="font-size:60px;background:#fbbf2420;border:2px solid #fbbf2470;border-radius:26px;width:110px;margin:0 auto 20px;transform:rotate(-8deg)">🥤</div>
      <h2 data-title style="font-size:28px;font-weight:800;line-height:1.3"></h2>
      <p data-items style="font-size:21px;color:#cbd5e1;margin-top:20px;white-space:pre-wrap;overflow-wrap:anywhere"></p>
      <p data-amount style="font-size:38px;color:#fbbf24;font-weight:900;margin-top:18px"></p>
      <p style="font-size:19px;margin:8px 0 20px">Bar pulini olishni unutmang!</p>
      <p style="font-size:13px;color:#94a3b8">× eslatmani yopadi. To‘lovni Bar &amp; Savdo bo‘limida qabul qiling.</p>
      <p data-error style="color:#fda4af;margin-top:10px"></p>`;
    const minutes = Number(notice.durationMinutes || 0);
    const duration = minutes % 60 === 0 ? `${minutes / 60} soatlik` : `${minutes} daqiqalik`;
    card.querySelector('[data-title]').textContent = `${notice.computerName || 'PC-' + notice.pcNumber} kompyuterining ${duration} vaqti tugadi`;
    card.querySelector('[data-items]').textContent = notice.barSummary || (notice.barItems || []).map(i => `${i.quantity} ta ${i.itemName}`).join(', ');
    card.querySelector('[data-amount]').textContent = Number(notice.barDebt).toLocaleString('uz-UZ') + ' so‘m';
    card.querySelector('[data-close]').onclick = async event => {
      event.currentTarget.disabled = true;
      try {
        const response = await fetch('/api/session-end-notices/' + encodeURIComponent(notice.sessionId) + '/dismiss', { method: 'POST', headers: headers() });
        if (!response.ok) throw Error('Eslatmani yopish saqlanmadi. Qayta urinib ko‘ring.');
        dismissed.add(notice.sessionId); cards.delete(notice.sessionId); card.remove();
        if (!cards.size) overlay.remove();
      } catch (error) { card.querySelector('[data-error]').textContent = error.message; card.querySelector('[data-close]').disabled = false; }
    };
    cards.set(notice.sessionId, card); overlay.append(card);
  };
  let checking = false;
  async function sync() {
    if (checking || typeof authToken === 'undefined' || !authToken) return;
    checking = true;
    try {
      const response = await fetch('/api/session-end-notices', { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (response.ok) for (const notice of (await response.json()).notices || []) window.showSessionEndNotice(notice);
    } catch {} finally { checking = false; }
  }
  sync(); setInterval(sync, 10000);
})();
