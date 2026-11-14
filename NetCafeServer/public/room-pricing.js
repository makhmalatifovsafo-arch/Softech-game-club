// Settings and the floor map edit the same room tariff records.
window.SoftechRoomPricing = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let options, rooms = [], selected = null, revision = 0;
  const dayNames = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
  const days = values => { try { return (typeof values === 'string' ? JSON.parse(values) : values) || [1,2,3,4,5,6,7]; } catch { return []; } };
  const period = tariff => `${tariff.start_time || '00:00'}–${tariff.end_time || '00:00'} · ${days(tariff.days_of_week).map(d => dayNames[d - 1]).filter(Boolean).join(', ')}`;

  async function api(path, method = 'GET', body) {
    const response = await fetch(path, { method, headers: { Authorization: 'Bearer ' + options.token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Tariflarni yuklab bo‘lmaydi.');
    return result;
  }

  function render() {
    const root = document.getElementById('roomPricingSettings');
    const general = document.getElementById('generalTariffSettings');
    if (!root || !general) return;
    general.hidden = false;
    const room = rooms.find(r => String(r.id) === selected);
    root.innerHTML = `<div class="flex items-start justify-between gap-4"><div><h4 class="text-sm font-bold text-white">Xonaga alohida tarif</h4><p class="text-xs text-zinc-400 mt-1">Faqat tanlangan xona uchun umumiy jadvaldan farqli vaqt va narx belgilang.</p></div><span class="text-[10px] text-sky-300 border border-sky-500/30 rounded-full px-2 py-1 whitespace-nowrap">Ixtiyoriy</span></div><label class="block text-xs font-semibold text-zinc-300 mt-4">Xonani tanlang<select id="pricingRoom" class="block w-full mt-2 p-3 rounded-xl bg-zinc-900 border border-zinc-700">${rooms.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label><div id="roomPricingRows" class="space-y-2 mt-3"></div>`;
    const select = root.querySelector('#pricingRoom');
    const list = root.querySelector('#roomPricingRows');
    if (!rooms.length) {
      select.disabled = true;
      list.innerHTML = '<p class="text-xs text-zinc-400">Hali xona yaratilmagan. Yuqoridagi umumiy dinamik tariflar ishlaydi.</p>';
      return;
    }
    select.value = selected;
    select.onchange = () => { selected = select.value; render(); };
    if (!room) return;
    list.innerHTML = `<p class="text-sm text-sky-300">${esc(room.name)} · Hozir: ${room.currentRate == null ? 'tarif belgilanmagan' : Number(room.currentRate).toLocaleString() + ' so‘m/soat'} · ${esc(room.currentRateName || '')}</p>`;
    const tariffs = (room.tariffs || []).filter(t => t.type === 'HOURLY' && t.is_active !== 0);
    for (const tariff of tariffs) {
      const row = document.createElement('div');
      row.className = 'p-3 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3';
      row.innerHTML = `<div><strong class="text-white">${esc(tariff.name)}</strong><p class="text-xs text-zinc-400">${esc(period(tariff))}</p><p class="text-emerald-400 font-bold">${Number(tariff.price_per_hour).toLocaleString()} so‘m/soat</p></div><button type="button" class="px-3 py-2 bg-sky-700 hover:bg-sky-600 text-white rounded-lg whitespace-nowrap" data-edit-room-rate>To‘liq tahrirlash</button>`;
      row.querySelector('button').onclick = () => edit(room, tariff);
      list.append(row);
    }
    if (!tariffs.length) list.innerHTML += '<p class="text-xs text-zinc-400 p-2">Bu xona yuqoridagi umumiy dinamik tariflardan foydalanadi.</p>';
  }

  function edit(room, tariff) {
    const dialog = document.createElement('dialog');
    dialog.className = 'bg-zinc-900 text-white rounded-2xl p-6 border border-zinc-600';
    dialog.style.width = 'min(560px,92vw)';
    const activeDays = new Set(days(tariff.days_of_week));
    const dayInputs = dayNames.map((label, index) => `<label class="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-zinc-800 border border-zinc-700 cursor-pointer"><input type="checkbox" name="days" value="${index + 1}" ${activeDays.has(index + 1) ? 'checked' : ''}><span>${label}</span></label>`).join('');
    dialog.innerHTML = `<form><h3 class="font-bold text-lg">${esc(room.name)} tarifini tahrirlash</h3><div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4"><label class="text-xs text-zinc-300 sm:col-span-2">Tarif nomi<input name="name" type="text" maxlength="100" required value="${esc(tariff.name)}" class="w-full bg-zinc-800 p-3 rounded-lg mt-1 text-white"></label><label class="text-xs text-zinc-300">Boshlanish vaqti<input name="start" type="time" required value="${esc(tariff.start_time || '00:00')}" class="w-full bg-zinc-800 p-3 rounded-lg mt-1 text-white"></label><label class="text-xs text-zinc-300">Tugash vaqti<input name="end" type="time" required value="${esc(tariff.end_time || '00:00')}" class="w-full bg-zinc-800 p-3 rounded-lg mt-1 text-white"></label><label class="text-xs text-zinc-300 sm:col-span-2">Bir soat narxi (so‘m)<input name="price" type="number" min="1" step="1" required value="${Number(tariff.price_per_hour)}" class="w-full bg-zinc-800 p-3 rounded-lg mt-1 text-white"></label></div><fieldset class="mt-4"><legend class="text-xs text-zinc-300 mb-2">Haftaning qaysi kunlari</legend><div class="grid grid-cols-4 sm:grid-cols-7 gap-2">${dayInputs}</div></fieldset><p class="text-xs text-zinc-400 mt-3">Boshlanish va tugash bir xil bo‘lsa, tarif tanlangan kunlarda 24 soat ishlaydi.</p><p data-status role="status" class="text-amber-300 my-3 min-h-5"></p><div class="flex justify-end gap-3"><button type="button" data-close class="px-4 py-2 rounded bg-zinc-700">Bekor qilish</button><button type="submit" class="px-4 py-2 rounded bg-sky-700">O‘zgarishlarni saqlash</button></div></form>`;
    document.body.append(dialog);
    dialog.onclose = () => dialog.remove();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    const form = dialog.querySelector('form');
    const status = dialog.querySelector('[data-status]');
    form.onsubmit = async event => {
      event.preventDefault();
      const price = Number(form.elements.price.value);
      const selectedDays = [...form.querySelectorAll('[name=days]:checked')].map(input => Number(input.value));
      const button = form.querySelector('[type=submit]');
      if (!Number.isFinite(price) || price <= 0) { status.textContent = 'Narx 0 dan katta bo‘lsin.'; return; }
      if (!selectedDays.length) { status.textContent = 'Kamida bitta hafta kunini tanlang.'; return; }
      button.disabled = true;
      status.textContent = 'Saqlanmoqda...';
      try {
        await api('/api/admin/tariffs', 'PUT', { tariffs: [{ id: tariff.id, name: form.elements.name.value.trim(), price_per_hour: price, start_time: form.elements.start.value, end_time: form.elements.end.value, days_of_week: selectedDays }] });
        status.textContent = 'Saqlandi. Yangi seanslarda shu xona tarifi ishlatiladi.';
        await load(options);
        await options.refresh?.();
        dialog.close();
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    dialog.showModal();
    form.elements.name.focus();
  }

  async function load(nextOptions) {
    const preferSelection = options !== nextOptions;
    options = nextOptions;
    const rev = ++revision;
    const root = document.getElementById('roomPricingSettings');
    const general = document.getElementById('generalTariffSettings');
    if (!root) return;
    if (general) general.hidden = false;
    root.textContent = 'Xona tariflari yuklanmoqda...';
    try {
      const result = await api('/api/zones');
      if (rev !== revision) return;
      rooms = result.zones || [];
      if (preferSelection && rooms.some(r => String(r.id) === String(options.preferredZoneId))) selected = String(options.preferredZoneId);
      if (!rooms.some(r => String(r.id) === selected)) selected = rooms.some(r => String(r.id) === String(options.preferredZoneId)) ? String(options.preferredZoneId) : rooms.length ? String(rooms[0].id) : null;
      render();
    } catch (error) {
      if (rev === revision) {
        root.textContent = error.message;
        if (general) general.hidden = false;
      }
    }
  }
  return { load };
})();
