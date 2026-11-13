// All settings are saved by the club server using the manager's signed session.
export function managerSettingRequest(path, method) {
  const pathname = new URL(path, 'http://localhost').pathname;
  if (method === 'PUT') return ['/api/admin/tariffs','/api/admin/settings'].includes(pathname) || /^\/api\/admin\/users\/\d+\/permissions$/.test(pathname) || /^\/api\/admin\/tariff-schedules\/\d+$/.test(pathname);
  if (method === 'POST') return ['/api/admin/users','/api/admin/tariff-schedules'].includes(pathname);
  return method === 'DELETE' && /^\/api\/admin\/(users|tariff-schedules)\/\d+$/.test(pathname);
}

export function createManagerTools({state, remote, modal, esc, money, refresh}) {
  const permissions = [
    ['session:manage','Seans ochish, uzaytirish va yakunlash'],
    ['message:send','Kompyuter ekraniga xabar yuborish'],
    ['customers:view','Mijozlar va balans bilan ishlash'],
    ['computers:manage','Kompyuterni yoqish va o‘chirish'],
    ['tariffs:manage','Server dasturida tariflarni boshqarish'],
    ['layout:manage','Server dasturida xona va xaritani tahrirlash'],
    ['finance:view','Server dasturida moliyaviy hisobotlarni ko‘rish'],
  ];
  const dayNames = ['Du','Se','Ch','Pa','Ju','Sh','Ya'];
  const allDays = [1,2,3,4,5,6,7];
  const daysOf = value => { try { return (typeof value === 'string' ? JSON.parse(value) : value) || allDays; } catch { return allDays; } };
  const dayFields = value => `<fieldset class="manager-days"><legend>Hafta kunlari</legend>${dayNames.map((name,i)=>`<label><input type="checkbox" name="day${i+1}" ${daysOf(value).includes(i+1)?'checked':''}>${name}</label>`).join('')}</fieldset>`;
  const readDays = v => allDays.filter(day => v['day'+day]);
  const permissionFields = values => `<fieldset class="manager-permissions"><legend>Xodim ruxsatlari</legend>${permissions.map(([key,label],i)=>`<label><input type="checkbox" name="permission${i}" ${values.includes('*')||values.includes(key)?'checked':''}>${label}</label>`).join('')}</fieldset><p class="hint">Mobil administrator moliyaviy hisobot, tarif va xodim sozlamalarini ko‘rmaydi. Server dasturining ruxsatlari alohida amal qiladi.</p>`;
  const readPermissions = v => permissions.filter((_,i)=>v['permission'+i]).map(([key])=>key);
  const numeric = (v, positive=false) => { const n=Number(v); if(!Number.isFinite(n)||n<0||(positive&&n===0))throw Error('Narx yoki davomiylik noto‘g‘ri.'); return n; };
  const intervalFields = t => `<label>Boshlanish<input name="start_time" type="text" inputmode="text" placeholder="HH:mm" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" title="24 soatlik vaqt: 13:00" required value="${esc(t.start_time||'00:00')}"></label><label>Tugash<input name="end_time" type="text" inputmode="text" placeholder="HH:mm" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" title="24 soatlik vaqt: 13:00" required value="${esc(t.end_time||'00:00')}"></label>${dayFields(t.days_of_week)}<p class="hint">Tugash vaqti kichik bo‘lsa, oraliq keyingi kungacha davom etadi. 00:00–00:00 — to‘liq sutka. Tarif yo‘q vaqtda seans ochilmaydi.</p>`;

  function editTariff(t) {
    modal(t.zone_name+' — tarif', `<label>Nomi<input name="name" required maxlength="100" value="${esc(t.name)}"></label><label>Bir soat narxi<input name="price_per_hour" type="number" min="0" step="1" required value="${esc(t.price_per_hour)}"></label>${t.type==='FIXED'?`<label>Paket narxi<input name="fixed_price" type="number" min="0" required value="${esc(t.fixed_price||0)}"></label><label>Paket davomiyligi (daqiqa)<input name="fixed_duration_minutes" type="number" min="1" required value="${esc(t.fixed_duration_minutes||60)}"></label>`:''}${t.zone_id?intervalFields(t):''}`, v => {
      const update={id:t.id,name:v.name.trim(),price_per_hour:numeric(v.price_per_hour)};
      if(t.type==='FIXED')Object.assign(update,{fixed_price:numeric(v.fixed_price),fixed_duration_minutes:numeric(v.fixed_duration_minutes,true)});
      if(t.zone_id){const days=readDays(v);if(!days.length)throw Error('Kamida bitta hafta kunini tanlang.');Object.assign(update,{start_time:v.start_time,end_time:v.end_time,days_of_week:days});}
      return remote('/api/admin/tariffs','PUT',{tariffs:[update]});
    });
  }

  function editSchedule(rule = {}) {
    modal(rule.id ? 'Tarif qoidasini tahrirlash' : 'Yangi umumiy tarif qoidasi', `<label>Nomi<input name="name" required maxlength="100" value="${esc(rule.name||'')}"></label><label>Bir soat narxi<input name="price_per_hour" type="number" min="1" required value="${esc(rule.price_per_hour??10000)}"></label>${intervalFields(rule)}<label>Tur<select name="is_vip"><option value="0">Oddiy</option><option value="1" ${rule.is_vip?'selected':''}>VIP</option></select></label><label>Ustuvorlik<input name="priority" type="number" min="1" max="1000" value="${esc(rule.priority??1)}" required></label><p class="hint">Ustuvorligi kattaroq qoida avval tanlanadi. Xonaning o‘z tarifi bo‘lsa, xona tarifi ishlatiladi.</p>`, v => {
      const days=readDays(v);if(!days.length)throw Error('Kamida bitta hafta kunini tanlang.');
      return remote('/api/admin/tariff-schedules'+(rule.id?'/'+rule.id:''),rule.id?'PUT':'POST',{name:v.name.trim(),price_per_hour:numeric(v.price_per_hour,true),start_time:v.start_time,end_time:v.end_time,days_of_week:days,is_vip:Number(v.is_vip),priority:numeric(v.priority,true)});
    });
  }

  async function tariffs(container) {
    const [allTariffs,schedules,{settings}]=await Promise.all([remote('/api/tariffs'),remote('/api/tariff-schedules'),remote('/api/settings')]);
    const tariffs=allTariffs.filter(t=>t.zone_id && t.is_active!==0);
    container.innerHTML=`<h3>Xona tariflari</h3><p class="hint">Narxlar klub serverida saqlanadi. Narx va oraliqlar serverdagi tarif hisoblagichida ishlatiladi.</p><div class="grid">${tariffs.map(t=>`<article class="card"><span class="eyebrow">${esc(t.zone_name||'Umumiy')}</span><h3>${esc(t.name)}</h3><p>${esc(money(t.price_per_hour))} / soat</p>${t.zone_id?`<p class="hint">${esc(t.start_time)} – ${esc(t.end_time)} · ${esc(daysOf(t.days_of_week).map(d=>dayNames[d-1]).join(', '))}</p>`:''}<button data-edit-tariff="${esc(t.id)}">Tahrirlash</button></article>`).join('')||'<p class="empty">Tariflar yo‘q. Xonalarni serverdagi xaritada yarating.</p>'}</div><section class="card"><div class="heading"><h3>Umumiy vaqt qoidalari</h3><button id="newSchedule">+ Qoida</button></div><p class="hint">Xona tarifi belgilanmagan holatlar uchun.</p>${schedules.map(s=>`<article class="manager-row"><div><strong>${esc(s.name)}</strong><p>${esc(s.start_time)} – ${esc(s.end_time)} · ${esc(money(s.price_per_hour))}/soat</p><span class="hint">${s.is_vip?'VIP':'Oddiy'} · ${esc(daysOf(s.days_of_week).map(d=>dayNames[d-1]).join(', '))} · Ustuvorlik: ${esc(s.priority)}</span></div><button data-edit-schedule="${s.id}">Tahrirlash</button><button class="danger" data-delete-schedule="${s.id}">O‘chirish</button></article>`).join('')||'<p>Qoida qo‘shilmagan.</p>'}</section><section class="card"><h3>VIP keyin to‘lash</h3><p>${settings.vip_enabled?'Yoqilgan':'O‘chirilgan'} · ${settings.vip_pricing_mode==='CUSTOM'?esc(money(settings.vip_custom_price))+'/soat':'Tarif jadvali bo‘yicha'}</p><button id="vipSettings">Sozlash</button></section>`;
    container.querySelectorAll('[data-edit-tariff]').forEach(b=>b.onclick=()=>editTariff(tariffs.find(t=>String(t.id)===b.dataset.editTariff)));
    container.querySelector('#newSchedule').onclick=()=>editSchedule();
    container.querySelectorAll('[data-edit-schedule]').forEach(b=>b.onclick=()=>editSchedule(schedules.find(s=>String(s.id)===b.dataset.editSchedule)));
    container.querySelectorAll('[data-delete-schedule]').forEach(b=>b.onclick=()=>modal('Tarif qoidasini o‘chirish',`<p>«${esc(schedules.find(s=>String(s.id)===b.dataset.deleteSchedule).name)}» qoidasini o‘chirishni tasdiqlang.</p>`,()=>remote('/api/admin/tariff-schedules/'+b.dataset.deleteSchedule,'DELETE')));
    container.querySelector('#vipSettings').onclick=()=>modal('VIP keyin to‘lash',`<label>Holat<select name="vip_enabled"><option value="1" ${settings.vip_enabled?'selected':''}>Yoqilgan</option><option value="0" ${!settings.vip_enabled?'selected':''}>O‘chirilgan</option></select></label><label>Narx turi<select name="vip_pricing_mode"><option value="SCHEDULE">Jadval bo‘yicha</option><option value="CUSTOM" ${settings.vip_pricing_mode==='CUSTOM'?'selected':''}>Belgilangan narx</option></select></label><label>Belgilangan soat narxi<input name="vip_custom_price" type="number" min="1" value="${esc(settings.vip_custom_price||15000)}" required></label>`,v=>remote('/api/admin/settings','PUT',{vip_enabled:v.vip_enabled==='1',vip_pricing_mode:v.vip_pricing_mode,vip_custom_price:numeric(v.vip_custom_price,true)}));
  }

  async function staff(container) {
    const users=(await remote('/api/admin/users')).filter(u=>['administrator','club_owner','manager'].includes(u.role));
    container.innerHTML=`<section class="card"><div class="heading"><h3>Xodimlar</h3><button id="newStaff">+ Administrator</button></div><p class="hint">Klub serveridagi xodimlar ro‘yxati. Bu yerdagi yangi login server dasturi uchun yaratiladi. Masofaviy kirish akkaunti super admin panelida belgilanadi.</p></section><div class="grid">${users.map(u=>`<article class="card"><h3>${esc(u.username)}</h3><p>${u.role==='administrator'?'Administrator':'Menejer'}</p>${u.role==='administrator'?`<div class="actions"><button data-staff-permissions="${u.id}">Ruxsatlar</button><button class="danger" data-delete-staff="${u.id}">O‘chirish</button></div>`:'<p class="hint">Menejer akkauntini super admin boshqaradi.</p>'}</article>`).join('')}</div>`;
    container.querySelector('#newStaff').onclick=()=>modal('Administrator qo‘shish',`<label>Login<input name="username" required maxlength="100" autocomplete="off"></label><label>Parol<input name="password" type="password" minlength="4" maxlength="128" required autocomplete="new-password"></label>${permissionFields(['session:manage','message:send','customers:view'])}`,v=>remote('/api/admin/users','POST',{username:v.username.trim(),password:v.password,role:'administrator',permissions:readPermissions(v)}));
    container.querySelectorAll('[data-staff-permissions]').forEach(b=>b.onclick=()=>{const u=users.find(u=>String(u.id)===b.dataset.staffPermissions);modal(u.username+' — ruxsatlar',permissionFields(u.permissions||[]),v=>remote('/api/admin/users/'+u.id+'/permissions','PUT',{permissions:[...readPermissions(v),...(u.permissions||[]).filter(p=>p!=='*'&&!permissions.some(([key])=>key===p))]}));});
    container.querySelectorAll('[data-delete-staff]').forEach(b=>b.onclick=()=>modal('Xodimni o‘chirish',`<p>«${esc(users.find(u=>String(u.id)===b.dataset.deleteStaff).username)}» hisobini o‘chirishni tasdiqlang.</p><p class="hint">Super admin orqali berilgan akkauntni super admin panelida o‘zgartiring: sinxronlash uni qayta yaratishi mumkin.</p>`,()=>remote('/api/admin/users/'+b.dataset.deleteStaff,'DELETE')));
  }

  async function render() {
    const root=document.querySelector('#content');
    root.innerHTML=`<section class="card"><h2 class="section-title">Klub boshqaruvi</h2><p class="hint">Tarif va xodimlarni boshqarish uchun klub serveri va internet ishlashi kerak. Hisobotlar server o‘chiq bo‘lsa ham ochiladi.</p><div class="actions"><button data-manager-section="tariffs">Tariflar</button><button data-manager-section="staff">Xodimlar</button></div></section><div id="managerContent"></div>`;
    root.querySelectorAll('[data-manager-section]').forEach(b=>{b.classList.toggle('primary',b.dataset.managerSection===state.managerSection);b.onclick=()=>{state.managerSection=b.dataset.managerSection;refresh();};});
    const container=root.querySelector('#managerContent');
    if(!state.managerSection)return;
    container.innerHTML='<p class="empty">Klub serveridan olinmoqda…</p>';
    try { await (state.managerSection==='staff'?staff(container):tariffs(container)); }
    catch(error){container.innerHTML='<section class="card"><h3>Sozlamalar olinmadi</h3><p>'+esc(error.message)+'</p></section>';if(error.status===401)throw error;}
  }
  return {render};
}
