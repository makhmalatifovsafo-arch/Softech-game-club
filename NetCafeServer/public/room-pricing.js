// Settings and the floor map edit the same room tariff records.
window.SoftechRoomPricing = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let options, rooms=[], selected=null, revision=0;
  const days = values => {try {return (typeof values==='string'?JSON.parse(values):values)||[1,2,3,4,5,6,7];}catch{return [];}};
  const period = tariff => `${tariff.start_time || '00:00'}–${tariff.end_time || '00:00'} · ${days(tariff.days_of_week).map(d=>['Du','Se','Ch','Pa','Ju','Sh','Ya'][d-1]).join(', ')}`;
  async function api(path,method='GET',body) {
    const response=await fetch(path,{method,headers:{Authorization:'Bearer '+options.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Tariflarni yuklab bo‘lmadi.');return result;
  }
  function render() {
    const root=document.getElementById('roomPricingSettings'),general=document.getElementById('generalTariffSettings');
    if(!root||!general)return;
    general.hidden=selected!=='general';
    const room=rooms.find(r=>String(r.id)===selected);
    root.innerHTML=`<label class="block text-sm font-bold text-white">Narxi o‘zgartiriladigan xona<select id="pricingRoom" class="block w-full mt-2 p-3 rounded-xl bg-zinc-900 border border-zinc-700">${rooms.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}<option value="general">Umumiy tarif — alohida tarifi yo‘q xonalar uchun</option></select></label><p class="text-xs text-zinc-400 mt-2">Chizilgan xonaning narxi shu yerda ham, xaritada ham bitta. Umumiy tarif alohida xona tarifini almashtirmaydi.</p><div id="roomPricingRows" class="space-y-2 mt-3"></div>`;
    const select=root.querySelector('#pricingRoom');select.value=selected;select.onchange=()=>{selected=select.value;render();};
    if(!room)return;
    const list=root.querySelector('#roomPricingRows');
    list.innerHTML=`<p class="text-sm text-sky-300">${esc(room.name)} · Hozir: ${room.currentRate==null?'tarif belgilanmagan':Number(room.currentRate).toLocaleString()+' so‘m/soat'} · ${esc(room.currentRateName)}</p>`;
    const tariffs=(room.tariffs||[]).filter(t=>t.type==='HOURLY'&&t.is_active!==0);
    for(const tariff of tariffs) {
      const row=document.createElement('div');row.className='p-3 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-between gap-3';
      row.innerHTML=`<div><strong class="text-white">${esc(tariff.name)}</strong><p class="text-xs text-zinc-400">${esc(period(tariff))}</p><p class="text-emerald-400 font-bold">${Number(tariff.price_per_hour).toLocaleString()} so‘m/soat</p></div><button type="button" class="px-3 py-2 bg-sky-700 text-white rounded-lg" data-edit-room-rate>Tarif narxini o‘zgartirish</button>`;
      row.querySelector('button').onclick=()=>edit(room,tariff);list.append(row);
    }
    if(!tariffs.length){const button=document.createElement('button');button.type='button';button.className='text-sky-300 p-2';button.textContent='Bu xona umumiy tarifdan foydalanadi. Umumiy tarifni ochish';button.onclick=()=>{selected='general';render();};list.append(button);}
  }
  function edit(room,tariff) {
    const dialog=document.createElement('dialog');dialog.className='bg-zinc-900 text-white rounded-2xl p-6 border border-zinc-600';dialog.style.width='min(440px,92vw)';
    dialog.innerHTML=`<form><h3 class="font-bold text-lg">${esc(room.name)} — ${esc(tariff.name)}</h3><p class="text-sm text-zinc-400 my-3">${esc(period(tariff))}</p><label>Bir soat narxi (so‘m)<input name="price" type="number" min="1" step="1" required value="${Number(tariff.price_per_hour)}" class="w-full bg-zinc-800 p-3 rounded-lg mt-2 text-white"></label><p class="text-xs text-zinc-400 mt-3">Faqat shu xonaning shu vaqt oralig‘idagi narxi o‘zgaradi. Boshqa xonalar va umumiy tarif o‘zgarmaydi.</p><p data-status role="status" class="text-amber-300 my-3"></p><div class="flex gap-3"><button type="button" data-close class="p-2 rounded bg-zinc-700">Yopish</button><button type="submit" class="p-2 rounded bg-sky-700">Saqlash</button></div></form>`;
    document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    const form=dialog.querySelector('form'),status=dialog.querySelector('[data-status]');
    form.onsubmit=async event=>{
      event.preventDefault();const price=Number(form.elements.price.value),button=form.querySelector('[type=submit]');
      if(!Number.isFinite(price)||price<=0){status.textContent='Narx 0 dan katta bo‘lsin.';return;}
      button.disabled=true;status.textContent='Saqlanmoqda...';
      try {
        await api('/api/admin/tariffs','PUT',{tariffs:[{id:tariff.id,price_per_hour:price}]});
        status.textContent='Saqlandi. Yangi seanslarda shu xona tarifi ishlatiladi.';
        await load(options);await options.refresh?.();
      }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    };
    dialog.showModal();form.elements.price.focus();
  }
  async function load(nextOptions) {
    const preferSelection=options!==nextOptions;
    options=nextOptions;const rev=++revision,root=document.getElementById('roomPricingSettings');if(!root)return;
    // No generic editor is shown until the room list is known.
    document.getElementById('generalTariffSettings').hidden=true;
    root.textContent='Xona tariflari yuklanmoqda...';
    try {
      const result=await api('/api/zones');if(rev!==revision)return;rooms=result.zones||[];
      if(preferSelection&&rooms.some(r=>String(r.id)===String(options.preferredZoneId)))selected=String(options.preferredZoneId);
      if(selected!=='general'&&!rooms.some(r=>String(r.id)===selected))selected=rooms.some(r=>String(r.id)===String(options.preferredZoneId))?String(options.preferredZoneId):rooms.length?String(rooms[0].id):'general';
      render();
    }catch(error){if(rev===revision)root.textContent=error.message;}
  }
  return {load};
})();
