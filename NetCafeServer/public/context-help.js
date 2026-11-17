// Help is independent of sessions, payments and the club database.
(() => {
  const origin = 'https://softech-club-cyber.windygnome8193.chatgpt.site';
  const topics = {
    'session.start': ['seans-ochish', 'Seans ochish', 'Vaqtda — soat yoki daqiqa. Summada — mijoz bergan pulga mos vaqt. Tugash vaqti — seans tugaydigan soat. Ochishdan oldin PC va hisoblangan narxni tekshiring.'],
    'session.vip': ['vip-postpaid', 'VIP Postpaid', 'Avval vaqt cheklovisiz seans ochiladi, pul yakunda olinadi. Misol: soati 10 000 so‘mda 30 daqiqa o‘yin — 5 000 so‘m. To‘lanmagan bar mahsulotlari ham yakuniy hisobga qo‘shiladi.'],
    'session.checkout': ['seansni-yopish', 'To‘lov va qaytim', 'Oldindan to‘lov 10 000 so‘m, ishlatilgan o‘yin 5 000 va to‘lanmagan bar 5 000 bo‘lsa, hozir olinadigan pul 0 so‘m. Olinadi yoki qaytim yozuvini tekshiring.'],
    'bar.sale': ['bar-savdosi', 'PC hisobiga bar qo‘shish', 'Mahsulot va miqdorni tanlang. PC hisobiga qo‘shish uchun mijoz o‘tirgan faol seansni tekshiring. Darhol naqd sotuv boshqa amal; u bilan adashtirmang.'],
    'tariff.schedule': ['dinamik-tariflar', 'Dinamik tariflar', 'Avval xonani, keyin kunlar, vaqt oralig‘i va soatlik narxni tanlang. Xonaning o‘z tarifi bo‘lsa, umumiy tarif uning o‘rnini bosmaydi. Saqlagach yangi seans oynasida narxni tekshiring.']
  };
  let panel;
  let returnFocus;
  function showLocal(topic, trigger) {
    if (!panel) {
      panel = document.createElement('dialog');
      panel.className = 'softech-help-dialog';
      panel.setAttribute('aria-labelledby', 'softech-help-title');
      panel.innerHTML = '<h2 id="softech-help-title"></h2><p data-help-summary></p><p class="softech-help-muted">Internet aloqasi yo‘q. To‘liq qo‘llanma internet tiklanganda ochiladi.</p><a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Saytdagi qo‘llanmani ochish ↗</a><p class="softech-help-muted">Yordam: @softech_support · +998 99 563 45 16</p><button type="button">Tushunarli</button>';
      panel.querySelector('button').addEventListener('click', () => panel.close());
      panel.addEventListener('close', () => returnFocus?.focus());
      document.body.append(panel);
    }
    returnFocus = trigger;
    panel.querySelector('h2').textContent = topic[1];
    panel.querySelector('[data-help-summary]').textContent = topic[2];
    panel.querySelector('a').href = origin + '/help/' + topic[0] + '/';
    if (!panel.open) panel.showModal();
  }
  function prepare(link) {
    const topic = topics[link.dataset.helpTopic];
    if (!topic) return;
    link.href = origin + '/help/' + topic[0] + '/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.classList.add('softech-help-link');
    link.textContent = '?';
    link.title = topic[1] + ' — qisqa qo‘llanma';
    link.setAttribute('aria-label', link.title);
  }
  document.querySelectorAll('a[data-help-topic]').forEach(prepare);
  // Delegation also supports the PC bar dialog, created after page load.
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-help-topic]');
    if (!link || !topics[link.dataset.helpTopic]) return;
    prepare(link);
    event.stopPropagation();
    if (navigator.onLine === false) {
      event.preventDefault();
      showLocal(topics[link.dataset.helpTopic], link);
    }
  });
})();
