// The same room records used by the setup wizard and the session quote engine.
window.SoftechRoomPricing=(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const days=['Du','Se','Ch','Pa','Ju','Sh','Ya'];
  const parseDays=value=>{try{return typeof value==='string'?JSON.parse(value):value??[1,2,3,4,5,6,7];}catch{return [];}};
  let options,rooms=[],selected=null,states=new Map(),sequence=0,saving=false;
  const root=()=>document.getElementById('roomPricingSettings');
  const status=(message,error=false)=>{const el=root()?.querySelector('[data-status]');if(el){el.textContent=message;el.classList.toggle('rp-error',error);}};
  async function api(path,method='GET',body){
    const response=await fetch(path,{method,headers:{Authorization:'Bearer '+options.token,'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Tariflarni olishda xatolik.');return result;
  }
  const editable=tariffs=>tariffs.filter(t=>t.type===undefined||t.type==='HOURLY').map(t=>({...t,days_of_week:parseDays(t.days_of_week)}))
    .sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time))||String(a.end_time).localeCompare(String(b.end_time))||String(a.name).localeCompare(String(b.name)));
  function accept(result){states.set(String(result.zone.id),{...result,rows:editable(result.tariffs),dirty:false});}
  function renderShell(){
    root().innerHTML=`<div class="rp-heading"><div><h4>Xonaga alohida tarif</h4><p>Xonani tanlang. Vaqt, hafta kunlari va 1 soat narxini belgilang.</p></div><button type="button" data-reload>Qayta yuklash</button></div><label class="rp-field">Xonani tanlang<select id="pricingRoom">${rooms.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label><div id="roomPricingRows"></div>`;
    const select=root().querySelector('#pricingRoom');select.value=selected;select.disabled=saving;
    select.onchange=()=>{selected=select.value;void showRoom();};
    root().querySelector('[data-reload]').onclick=async()=>{
      if(saving)return;
      if([...states.values()].some(s=>s.dirty)&&!confirm('Saqlanmagan tarif o‘zgarishlari bekor qilinadi. Serverdagi nusxani ochasizmi?'))return;
      states.clear();await load(options,true);
    };
  }
  async function showRoom(){
    const id=selected,seq=++sequence,list=root().querySelector('#roomPricingRows');
    if(!id){list.innerHTML='<p class="rp-note">Hali xona yo‘q. “Klubni sozlash” yoki 2D xaritada xona yarating, keyin shu yerda tarifini belgilang.</p>';return;}
    if(states.has(id)){renderRows();return;}
    list.textContent='Xona tariflari yuklanmoqda…';
    try{const result=await api('/api/zones/'+id+'/tariffs');if(seq!==sequence)return;accept(result);renderRows();}
    catch(error){if(seq===sequence)list.innerHTML=`<p class="rp-error" role="alert">${esc(error.message)} “Qayta yuklash”ni bosing.</p>`;}
  }
  function coverage(rows){
    const covered=new Uint8Array(10080);let overlap=false;
    for(const r of rows){
      if(![r.start_time,r.end_time].every(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v)))return 'Vaqtlarni 24 soat shaklida kiriting: 08:00, 18:00.';
      const minute=v=>Number(v.slice(0,2))*60+Number(v.slice(3));const a=minute(r.start_time),b=minute(r.end_time),n=b>a?b-a:1440-a+b;
      for(const d of r.days_of_week)for(let m=0;m<n;m++){const i=((d-1)*1440+(a===b?0:a)+m)%10080;if(covered[i])overlap=true;covered[i]=1;}
    }
    return overlap?'Vaqt oraliqlari ustma-ust tushmoqda.':covered.includes(0)?'Bo‘sh vaqtlar bor: tarif yo‘q paytda bu xonada yangi seans ochilmaydi.':'✓ Har kuni 24 soat tarif belgilangan.';
  }
  function renderRows(){
    const state=states.get(selected),list=root().querySelector('#roomPricingRows');if(!state)return;
    const room=rooms.find(r=>String(r.id)===selected);
    list.innerHTML=`${state.inherited?`<p class="rp-note">Bu xona hali avvalgi umumiy jadvaldan foydalanadi${room?.currentRate!=null?' — hozir '+Number(room.currentRate).toLocaleString('ru-RU')+' so‘m/soat':''}. Quyida xona tariflarini kiriting va saqlang. Shundan keyin faqat shu oraliqlar ishlaydi.</p>`:''}<form id="roomTariffForm"><div class="rp-toolbar"><strong>${esc(state.zone.name)}</strong><button type="button" data-add>+ Vaqt oralig‘i</button></div><div class="rp-cards">${state.rows.map((t,i)=>`<article class="rp-card" data-rate="${i}"><div class="rp-card-title"><b>ORALIQ ${i+1}</b><button type="button" data-remove="${i}">Olib tashlash</button></div><label class="rp-field">Tarif nomi<input name="name" maxlength="120" required value="${esc(t.name)}"></label><div class="rp-times"><label class="rp-field">Boshlanish · 24 soat<input name="start_time" required inputmode="numeric" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="00:00" value="${esc(t.start_time)}"></label><label class="rp-field">Tugash · 24 soat<input name="end_time" required inputmode="numeric" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="00:00" value="${esc(t.end_time)}"></label></div><fieldset class="rp-days"><legend>Hafta kunlari</legend>${days.map((d,j)=>`<label><input type="checkbox" name="day" value="${j+1}" ${t.days_of_week.includes(j+1)?'checked':''}><span>${d}</span></label>`).join('')}</fieldset><label class="rp-field">1 soat narxi · so‘m<input name="price_per_hour" type="number" required min="1" step="1" inputmode="numeric" placeholder="Masalan, 7000" value="${esc(t.price_per_hour??'')}"></label><label class="rp-check"><input name="is_vip_postpaid_allowed" type="checkbox" ${t.is_vip_postpaid_allowed===false||t.is_vip_postpaid_allowed===0?'':'checked'}>VIP Postpaid — oldindan to‘lovsiz seansga ruxsat</label></article>`).join('')}</div>${state.rows.length?'':'<p class="rp-note">Vaqt oralig‘i yo‘q. “+ Vaqt oralig‘i” bilan qo‘shing.</p>'}<p class="rp-note">Boshlanish va tugash bir xil bo‘lsa — tanlangan kun to‘liq olinadi. Masalan, 08:00–18:00 va 18:00–08:00.</p><p data-coverage class="rp-note"></p><div class="rp-save"><p data-status role="status"></p><button type="submit" data-save>Tariflarni saqlash</button></div></form>`;
    const form=list.querySelector('form');form.inert=saving;
    form.querySelector('[data-coverage]').textContent=coverage(state.rows);
    status(state.dirty?'Saqlanmagan o‘zgarishlar bor.':'Xona tariflari yuklandi.');
    form.querySelector('[data-save]').disabled=!state.dirty;
    form.querySelector('[data-add]').onclick=()=>{state.rows.push({name:'Kunlik tarif',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:null,is_vip_postpaid_allowed:true});state.dirty=true;renderRows();};
    form.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{state.rows.splice(Number(button.dataset.remove),1);state.dirty=true;renderRows();});
    form.oninput=e=>{
      const card=e.target.closest('[data-rate]');if(!card)return;const t=state.rows[Number(card.dataset.rate)],key=e.target.name;
      if(key==='day')t.days_of_week=[...card.querySelectorAll('[name=day]:checked')].map(el=>Number(el.value));
      else if(key==='price_per_hour')t[key]=e.target.value===''?null:Number(e.target.value);
      else if(key==='is_vip_postpaid_allowed')t[key]=e.target.checked;
      else {if(['start_time','end_time'].includes(key)&&/^\d{4}$/.test(e.target.value))e.target.value=e.target.value.slice(0,2)+':'+e.target.value.slice(2);t[key]=e.target.value;}
      state.dirty=true;status('Saqlanmagan o‘zgarishlar bor.');form.querySelector('[data-save]').disabled=false;form.querySelector('[data-coverage]').textContent=coverage(state.rows);
    };
    form.onsubmit=async e=>{
      e.preventDefault();if(saving||!state.dirty)return;
      if(state.rows.some(t=>!t.days_of_week.length)){status('Har bir oraliq uchun kamida bitta hafta kunini tanlang.',true);return;}
      const warning=coverage(state.rows);if(warning.includes('ustma-ust')){status(warning,true);return;}
      if(!state.rows.length&&!confirm('Bu xonaning barcha vaqt oraliqlari olib tashlanadi. Yangi tarif kiritilmaguncha seans ochilmaydi. Saqlaysizmi?'))return;
      saving=true;form.inert=true;root().querySelector('#pricingRoom').disabled=true;status('Saqlanmoqda…');
      try{
        const result=await api('/api/zones/'+selected+'/tariffs','PUT',{revision:state.revision,tariffs:state.rows});
        accept(result);renderRows();status('Saqlandi. Seanslar shu xona tariflari bo‘yicha hisoblanadi.');
        try{await options.refresh?.();}catch{status('Tariflar saqlandi. Asosiy ekran yangilanmadi; uni qayta oching.');}
      }catch(error){status(error.message,true);}
      finally{saving=false;root().querySelector('form').inert=false;root().querySelector('#pricingRoom').disabled=false;}
    };
  }
  async function load(next,force=false){
    if(saving)return;
    if(options?.token!==next.token)states.clear();
    options=next;
    if(!root())return;
    if(!force&&[...states.values()].some(s=>s.dirty)){
      if(rooms.some(r=>String(r.id)===String(next.preferredZoneId)))selected=String(next.preferredZoneId);
      for(const [id,state] of states)if(!state.dirty)states.delete(id);
      renderShell();await showRoom();return;
    }
    states.clear();
    const seq=++sequence;root().textContent='Xona tariflari yuklanmoqda…';
    try{
      const result=await api('/api/zones');if(seq!==sequence)return;rooms=result.zones||[];
      if(rooms.some(r=>String(r.id)===String(next.preferredZoneId)))selected=String(next.preferredZoneId);
      if(!rooms.some(r=>String(r.id)===selected))selected=rooms.length?String(rooms[0].id):null;
      renderShell();await showRoom();
    }catch(error){if(seq===sequence){root().textContent=error.message;const retry=document.createElement('button');retry.textContent='Qayta urinish';retry.onclick=()=>void load(options,true);root().append(retry);}}
  }
  return {load};
})();
