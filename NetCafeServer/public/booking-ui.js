(function(){
  const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>Number(n||0).toLocaleString('uz-UZ')+' so‘m';
  const day=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const clock=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  const date=s=>new Date(s).toLocaleString('uz-UZ',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const labels={CONFIRMED:'Kutilmoqda',PENDING:'Kutilmoqda',ACTIVE:'Seansda',COMPLETED:'Tugallangan',CANCELLED:'Bekor qilingan',NO_SHOW:'Mijoz kelmagan'};
  let rows=[],serverNow=0,received=0,context=null,quote=null,quoteKey='',timer,revision=0,busy=false,selectedDay=day(new Date());
  let page={offset:0,limit:100,total:0},pcFilter='',refunds=false,listRevision=0;
  async function api(path,method='GET',body){const r=await fetch(path,{method,headers:{Authorization:'Bearer '+authToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Server javob bermadi.');return d;}
  const write=(path,body)=>postMoneyOperation(path,body,'Bron amali');
  const canManage=()=>['club_owner','superadmin'].includes(currentUser?.role)||(currentUser?.permissions||[]).some(p=>['*','session:manage','sessions:manage'].includes(p));
  const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){showToast(e.message,'error');}};
  function form(title,html,action){
    $('bookingDialog')?.remove();const dialog=document.createElement('dialog');dialog.id='bookingDialog';dialog.className='booking-dialog';
    dialog.innerHTML=`<form><h2>${esc(title)}</h2>${html}<p class="booking-error" role="alert"></p><footer><button type="button" data-close>Yopish</button><button class="primary" type="submit">Tasdiqlash</button></footer></form>`;
    document.body.append(dialog);dialog.showModal();let pending=false;
    dialog.querySelector('[data-close]').onclick=()=>{if(!pending)dialog.close();};dialog.oncancel=e=>{if(pending)e.preventDefault();};
    dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(pending)return;pending=true;const b=dialog.querySelector('[type=submit]');b.disabled=true;
      try{await action(Object.fromEntries(new FormData(e.target)));dialog.close();await load();fetchData();}
      catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}finally{pending=false;b.disabled=false;}};return dialog;
  }
  async function load(){
    const host=$('bookingWorkspace');if(!host)return;
    const rev=++listRevision;
    try{const data=await api('/api/bookings?'+new URLSearchParams({date:selectedDay,offset:page.offset,computer:pcFilter,refunds:refunds?'1':'0'}));if(rev!==listRevision)return;rows=data.bookings;page=data.page;serverNow=data.serverNow;received=Date.now();render();}
    catch(e){host.textContent=e.message;}
  }
  function render(){
    const list=rows;
    const now=serverNow+Date.now()-received;
    $('bookingWorkspace').innerHTML=`<div class="booking-toolbar"><div><h2>Band qilingan kompyuterlar</h2><p>Bron vaqtni band qiladi. O‘yin mijoz kelganda boshlanadi.</p></div><button id="bookingCreate" class="primary">+ Bron qo‘shish</button></div>
      <div class="booking-toolbar"><label>Sana <input id="bookingDate" type="date" value="${selectedDay}"></label><label>Kompyuter<select id="bookingPcFilter"><option value="">Barchasi</option>${computersData.filter(p=>p.pcNumber>0).map(p=>`<option value="${esc(p.id)}" ${p.id===pcFilter?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label><input id="bookingRefundFilter" type="checkbox" ${refunds?'checked':''}> Qaytim kutilmoqda (barcha sanalar)</label><button id="bookingRefresh">Yangilash</button><button id="bookingSettings">Kutish vaqtini sozlash</button><span>${page.total} ta bron</span><button id="bookingPrev" ${page.offset?'':'disabled'}>Oldingi</button><button id="bookingNext" ${page.hasMore?'':'disabled'}>Keyingi</button></div>
      ${!refunds?timeline(list):''}
      <div class="booking-cards">${list.map(b=>{const pending=['CONFIRMED','PENDING'].includes(b.status),ready=pending&&!b.needsReview&&now>=Date.parse(b.startTime)&&now<Date.parse(b.noShowAt);return `<article><header><b>${esc(b.computerName)} · ${esc(b.customerName)}</b><span>${esc(labels[b.status]||b.status)}</span></header><p>${esc(date(b.startTime))} — ${esc(date(b.endTime))}</p><p>${esc(b.customerPhone)}</p><p>${b.funds?.source?'Depozit: '+money(b.funds.source.amount)+' · '+(b.paymentKind==='BALANCE'?'Balans':'Naqd'):'To‘lovsiz bron'}</p>${b.needsReview?'<p class="booking-error">Eski bron ma’lumotlarini tekshirish kerak.</p>':''}${b.funds?.cashRefundPending?`<p class="booking-error">Naqd qaytim: ${money(b.funds.cashRefundPending)}</p><button data-refund="${b.id}">Pulni qaytardim</button>`:''}<footer>${pending?`<button data-start="${b.id}" ${ready?'':'disabled'}>Mijoz keldi · Seans ochish</button><button data-cancel="${b.id}">Bekor qilish</button>`:''}</footer></article>`;}).join('')||'<p>Bu sanada bron yo‘q.</p>'}</div>`;
    $('bookingDate').onchange=e=>{selectedDay=e.target.value||day(new Date());page.offset=0;load();};$('bookingPcFilter').onchange=e=>{pcFilter=e.target.value;page.offset=0;load();};$('bookingRefundFilter').onchange=e=>{refunds=e.target.checked;page.offset=0;load();};$('bookingPrev').onclick=()=>{page.offset=Math.max(0,page.offset-page.limit);load();};$('bookingNext').onclick=()=>{page.offset+=page.limit;load();};$('bookingRefresh').onclick=load;$('bookingCreate').onclick=safe(create);$('bookingSettings').onclick=safe(settings);
    $('bookingSettings').textContent='Bron sozlamalari';
    for(const b of document.querySelectorAll('[data-start]'))b.onclick=safe(()=>start(Number(b.dataset.start)));
    for(const b of document.querySelectorAll('[data-cancel]'))b.onclick=()=>{const row=rows.find(r=>r.id===Number(b.dataset.cancel));form('Bronni bekor qilish','<label>Sabab<input name="reason" required maxlength="500"></label>',v=>write('/api/bookings/'+row.id+'/cancel',{reason:v.reason,expectedRevision:row.revision}));};
    for(const b of document.querySelectorAll('[data-refund]'))b.onclick=()=>{const row=rows.find(r=>r.id===Number(b.dataset.refund));form('Naqd qaytimni tasdiqlash',`<p>Mijozga <b>${money(row.funds.cashRefundPending)}</b> qaytarganingizdan keyin tasdiqlang.</p>`,()=>write('/api/bookings/'+row.id+'/refund',{expectedRevision:row.revision,amount:row.funds.cashRefundPending,confirmed:true}));};
    if(!canManage())for(const b of document.querySelectorAll('#bookingCreate,[data-start],[data-cancel],[data-refund]')){b.disabled=true;b.title='Seans boshqarish ruxsati kerak.';}
  }
  function timeline(list){const from=+new Date(selectedDay+'T00:00:00'),end=new Date(from);end.setDate(end.getDate()+1);const span=+end-from;
    return `<details class="booking-timeline"><summary>Kunlik jadval · ushbu sahifadagi bronlar</summary><p>00:00 ───────── 06:00 ───────── 12:00 ───────── 18:00 ───────── 24:00</p>${list.filter(b=>['PENDING','CONFIRMED','ACTIVE'].includes(b.status)).map(b=>{const a=Math.max(0,(Date.parse(b.startTime)-from)/span*100),z=Math.min(100,(Date.parse(b.endTime)-from)/span*100);return `<div><b>${esc(b.computerName)}</b><div class="booking-track"><span style="left:${a}%;width:${Math.max(0,z-a)}%" title="${esc(date(b.startTime)+' — '+date(b.endTime))}">${esc(b.customerName)}</span></div></div>`;}).join('')||'<p>Kutilayotgan bron yo‘q.</p>'}</details>`;
  }
  async function create(){
    const users=(await api('/api/admin/users')).filter(u=>u.role==='client');const now=new Date(serverNow+Date.now()-received+5*60000),end=new Date(now.getTime()+3600000);
    const dialog=form('Yangi bron',`<label>Kompyuter<select name="computerId">${computersData.filter(p=>p.pcNumber>0).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>Mijoz ismi<input name="customerName" required maxlength="160"></label><label>Telefon<input name="customerPhone" type="tel" maxlength="60"></label>
      <div class="booking-pair"><label>Boshlanish sanasi<input name="startDate" type="date" value="${day(now)}" required></label><label>Vaqt (24 soat)<input name="startTime" value="${clock(now)}" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="18:00" required></label></div>
      <div class="booking-pair"><label>Tugash sanasi<input name="endDate" type="date" value="${day(end)}" required></label><label>Vaqt (24 soat)<input name="endTime" value="${clock(end)}" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="20:00" required></label></div>
      <label>To‘lov<select name="kind"><option value="NONE">To‘lovsiz</option><option value="CASH">Naqd depozit</option><option value="BALANCE">Mijoz balansidan</option></select></label>
      <label data-amount hidden>Depozit (so‘m)<input name="amount" type="number" inputmode="numeric" min="1" max="100000000"></label>
      <label data-member hidden>Balans egasi<select name="userId"><option value="">Tanlang</option>${users.map(u=>`<option value="${u.id}">${esc(u.username)} · ${money(u.balance)}</option>`).join('')}</select></label><p>Seans hali boshlanmaydi. Depozit mijoz kelganda seans to‘loviga o‘tkaziladi.</p>`,v=>write('/api/bookings',{computerId:v.computerId,customerName:v.customerName,customerPhone:v.customerPhone,startTime:new Date(v.startDate+'T'+v.startTime).toISOString(),endTime:new Date(v.endDate+'T'+v.endTime).toISOString(),payment:{kind:v.kind,amount:v.kind==='NONE'?0:Number(v.amount),...(v.kind==='BALANCE'?{userId:Number(v.userId)}:{})}}));
    dialog.querySelector('[name=kind]').onchange=e=>{const paid=e.target.value!=='NONE',member=e.target.value==='BALANCE';dialog.querySelector('[data-amount]').hidden=!paid;dialog.querySelector('[name=amount]').required=paid;dialog.querySelector('[data-member]').hidden=!member;dialog.querySelector('[name=userId]').required=member;};
  }
  async function settings(){const data=await api('/api/booking-settings'),requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");form('Bron sozlamalari',`<label>Yangi bron qabul qilish<select name="enabled"><option value="1">Yoqilgan</option><option value="0" ${data.settings.creationEnabled===false?'selected':''}>Vaqtincha to‘xtatilgan</option></select></label><p>Mavjud bronlar, seans ochish va qaytim ishlashda davom etadi.</p><label>Mijoz necha daqiqa kechikishi mumkin?<input name="grace" type="number" min="1" max="180" value="${data.settings.graceMinutes}" required></label><p>Kutish vaqti yangi bronlarga amal qiladi. Naqd depozit kassir tasdig‘i bilan qaytariladi.</p>`,v=>api('/api/booking-settings','PUT',{graceMinutes:Number(v.grace),creationEnabled:v.enabled==='1',expectedRevision:data.settings.revision,requestId}));}
  function clear(){context=null;quote=null;revision++;clearTimeout(timer);$('bookingCheckinInfo')?.remove();if($('clientSearchInput'))$('clientSearchInput').disabled=false;}
  async function start(id){const data=await api('/api/bookings?bookingId='+encodeURIComponent(id)),b=data.bookings.find(r=>r.id===id);if(!b)throw Error('Bron topilmadi.');const pc=computersData.find(p=>p.id===b.computerRef);if(!pc)throw Error('Kompyuter topilmadi.');
    openStartModal(pc.id,pc.name,null,true);context=b;const info=document.createElement('div');info.id='bookingCheckinInfo';info.className='booking-checkin';
    info.innerHTML=`<b>Bron: ${esc(b.customerName)}</b><label>Tugash sanasi<input type="date" id="bookingEndDate" value="${day(new Date(b.endTime))}"></label><p id="bookingQuote" aria-live="polite"></p>`;
    $('btnSubmitStart').parentElement.before(info);$('startCustomerName').value=b.customerName;$('inputTargetEndTime').value=clock(new Date(b.endTime));$('bookingEndDate').onchange=schedule;
    if(pc.bookingScreenSupported!==true)info.insertAdjacentHTML('beforeend','<p class="booking-error">Clientning bron ekrani tasdiqlanmagan. Clientni yangilang va aloqasini tekshiring; server bron to‘qnashuvini baribir tekshiradi.</p>');
    const cash=document.querySelector('input[name=paymentType][value=CASH]');if(cash)cash.checked=true;
    if(b.paymentKind==='BALANCE'){selectedCustomer={id:b.userId,name:b.customerName};$('clientSearchInput').disabled=true;info.insertAdjacentHTML('beforeend',`<p>Depozit mijoz hisobi #${Number(b.userId)} dan olingan. Shu mijozning seansi ochiladi.</p>`);}
    setStartMode('endtime');schedule();
  }
  function payload(){const mode=currentStartMode,payment=document.querySelector('input[name=paymentType]:checked')?.value||'CASH';return {expectedRevision:context.revision,mode,computerId:context.computerRef,customerName:context.customerName,
    durationMinutes:mode==='client'?Math.round(Number($('clientHoursInput').value)*60):currentDurationInputUnit==='minutes'?Number($('inputMinutes').value):Math.round(Number($('inputHours').value)*60),amount:Number($('inputPrice').value),
    ...(mode==='endtime'?{targetEndTime:new Date($('bookingEndDate').value+'T'+$('inputTargetEndTime').value).toISOString()}:{}),
    customerId:context.paymentKind==='BALANCE'?context.userId:selectedCustomer?.id||null,paymentType:mode==='postpaid'?'POSTPAID':mode==='client'?'BALANCE':payment};}
  function schedule(){if(!context)return;quote=null;revision++;clearTimeout(timer);$('btnSubmitStart').disabled=true;timer=setTimeout(calculate,180);}
  async function calculate(){if(!context)return;const rev=revision;try{const body=payload(),key=JSON.stringify(body),id=context.id;const data=await api('/api/bookings/'+id+'/check-in-preview','POST',body);if(!context||rev!==revision)return;quote=data;quoteKey=key;
      $('bookingQuote').textContent=`Seans: ${data.isPostpaid?'VIP — yakunda hisoblanadi':money(data.price)} · Depozitdan: ${money(data.depositApplied)} · Hozir olinadi: ${money(data.additionalPayment)}${data.cashRefundPending?' · Naqd qaytim kutilmoqda: '+money(data.cashRefundPending):''}${data.balanceRelease?' · Balansga qaytadi: '+money(data.balanceRelease):''}`;
      $('startModalPrice').textContent=money(data.additionalPayment);$('startModalTotalLabel').textContent='HOZIRGI TO‘LOV:';$('startModalPerPcPrice').textContent=data.isPostpaid?'VIP Postpaid':money(data.price);$('startModalDurationSummary').textContent=data.isPostpaid?'Kassir yopguncha':Math.round(data.durationMinutes)+' daqiqa';$('btnSubmitStart').textContent=data.additionalPayment>0?money(data.additionalPayment)+(body.paymentType==='BALANCE'?' balansdan yechish va ochish':' qabul qilish va ochish'):'Seansni ochish';$('btnSubmitStart').disabled=false;
    }catch(e){if(context&&rev===revision)$('bookingQuote').textContent=e.message;}}
  async function submit(){if(busy||!context)return;busy=true;$('btnSubmitStart').disabled=true;try{const body=payload();if(!quote||quoteKey!==JSON.stringify(body))throw Error('Hisob yangilanishini kuting.');await write('/api/bookings/'+context.id+'/check-in',{...body,quoteRevision:quote.quoteRevision});closeModal('startSessionModal');clearMultiSelect();await load();fetchData();showToast('Bron seansi ochildi.','success');}catch(e){showToast(e.message,'error');schedule();}finally{busy=false;}}
  document.addEventListener('change',e=>{if(context&&e.target.name==='paymentType')schedule();});
  window.BookingUI={load,clear,schedule,submit,get active(){return !!context;}};
  window.loadBookings=load;window.startSessionFromBooking=start;window.startSessionFromBookingDirect=safe(async pcId=>{const b=computersData.find(p=>p.id===pcId)?.upcomingBooking;if(b?.isCurrent)await start(b.id);else showToast('Bron holati o‘zgargan. Kompyuterlar ro‘yxatini yangilang.','error');});
})();
