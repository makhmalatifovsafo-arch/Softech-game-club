export function createOperatorTools({state,remote,modal,esc,money,notice,can,refresh}) {
 const $=s=>document.querySelector(s),content=()=>$('#content');
 const payment=(name='paymentMethod',extra='')=>`<label>To‘lov<select name="${name}"><option value="CASH">Naqd</option><option value="CARD">Karta</option>${extra}</select></label>`;
 const run=fn=>async()=>{try{await fn();}catch(e){notice(e.message);}};
 const online=()=>{if(!state.meta?.serverOnline)throw Error('Bu amal uchun klub serveri va internet ishlashi kerak.');};
 const clients=async()=>{const rows=await remote('/api/admin/users');return rows.filter(u=>u.role==='client');};
 const pcOptions=(pcs=state.pcs)=>pcs.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
 const clientOptions=users=>'<option value="">Tanlang</option>'+users.map(u=>`<option value="${u.id}">${esc(u.username)} · ${esc(money(u.balance))}</option>`).join('');
 function renderShift(d){
  const s=d.shift;
  content().innerHTML=`<section class="card"><span class="eyebrow">ADMINISTRATOR SMENASI</span><h2>${s?'Smena #'+esc(s.id):'Smena ochilmagan'}</h2><p>${s?'Ochilgan: '+esc(s.openedAt):'Ish boshlashdan oldin smenani oching.'}</p><p class="hint">Moliyaviy hisobotlar menejerga tegishli. Siz smenani ochish va topshirishni bajarasiz.</p><button id="shiftAction" class="primary" ${state.meta?.serverOnline?'':'disabled'}>${s?'Smenani topshirish':'Smena ochish'}</button></section>`;
  $('#shiftAction').onclick=()=>modal(s?'Smenani topshirish':'Smena ochish',`<p>${s?'Kassadagi naqd pulni sanab kiriting.':'Smena boshidagi qaytim pulini kiriting.'}</p><label>${s?'Sanab chiqilgan naqd':'Boshlang‘ich naqd'}<input type="number" name="amount" min="0" step="0.01" required value="0"></label>`,v=>remote('/api/shifts/current','POST',{action:s?'CLOSE':'OPEN',...(s?{endCash:Number(v.amount)}:{startCash:Number(v.amount)})}));
 }
 async function startSession(pc){
  try{online();const users=await clients();
   modal(pc.name+' — yangi seans',`<label>Seans turi<select name="mode"><option value="hours">Vaqt bo‘yicha</option><option value="price">Summa bo‘yicha</option><option value="postpaid">Keyin to‘lash</option></select></label><label>Mijoz nomi<input name="customerName" maxlength="100" value="Mijoz"></label><label>Daqiqa<input name="minutes" type="number" min="1" max="1440" value="60" required></label><label>Summa (summa bo‘yicha seans uchun)<input name="amount" type="number" min="0" value="0"></label>${payment('paymentType','<option value="BALANCE">Mijoz balansi</option>')}<label>Balans egasi<select name="customerId">${clientOptions(users)}</select></label>`,v=>{
    if(v.mode==='price'&&Number(v.amount)<=0)throw Error('Seans summasini kiriting.');
    if(v.paymentType==='BALANCE'&&!v.customerId)throw Error('Balans egasini tanlang.');
    if(v.mode==='postpaid'&&v.paymentType==='BALANCE')throw Error('Balans uchun vaqt yoki summa bo‘yicha seans tanlang.');
    return remote('/api/sessions/start','POST',{computerId:pc.id,mode:v.mode,durationMinutes:Number(v.minutes),amount:Number(v.amount),customerName:v.customerName,customerId:v.customerId?Number(v.customerId):null,paymentType:v.mode==='postpaid'?'POSTPAID':v.paymentType});
   });
  }catch(e){notice(e.message);}
 }
 async function checkout(pc){
  try{online();const s=pc.activeSession;const bill=await remote('/api/sessions/'+s.sessionId+'/checkout-preview');
   modal(pc.name+' — yakunlash',`<p>${esc(bill.formulaText)}</p><p>Bar qarzi: <b>${esc(money(bill.barBill))}</b></p><p>Olinadigan to‘lov: <b>${esc(money(bill.amountToCollect))}</b></p><p class="hint">Yakuniy summa serverda qayta hisoblanadi. Oldindan to‘langan seansning ishlatilmagan qismi server qoidasi bo‘yicha qaytariladi.</p>${payment('paymentType')}`,v=>remote('/api/sessions/'+s.sessionId+(s.isPostpaid||s.paymentType==='BALANCE'?'/checkout':'/stop-early'),'POST',{paymentType:v.paymentType,paymentMethod:v.paymentType}));
  }catch(e){notice(e.message);}
 }
 function transfer(pc){modal('Seansni ko‘chirish',`<label>Yangi kompyuter<select name="target" required>${pcOptions(state.pcs.filter(p=>p.id!==pc.id&&!p.activeSession))}</select></label>`,v=>remote('/api/sessions/transfer','POST',{fromComputerId:pc.id,toComputerId:v.target}));}
 function message(pc){modal(pc.name+' — xabar','<label>Sarlavha<input name="title" maxlength="100" value="Administrator"></label><label>Xabar<input name="message" maxlength="1000" required></label>',v=>remote('/api/messages/send','POST',{computerId:pc.id,...v}));}
 function renderBar(items){
  content().innerHTML=`<section class="card"><div class="heading"><h2>Bar savdosi</h2><button id="barOrders" class="quiet">Buyurtmalar</button></div><p class="hint">Miqdorlarni tanlang. Narx, qoldiq va to‘lov klub serverida tekshiriladi.</p><div id="saleItems">${items.map(i=>`<label class="sale-item"><span>${esc(i.name)}<small>${esc(money(i.sellPrice))} · Qoldiq: ${i.stockQuantity}</small></span><input aria-label="${esc(i.name)} miqdori" data-quantity="${i.id}" type="number" min="0" max="${i.stockQuantity}" step="1" value="0" ${i.stockQuantity<1?'disabled':''}></label>`).join('')||'<p>Mahsulot yo‘q.</p>'}</div><div class="heading"><strong id="saleTotal">${money(0)}</strong><button id="saleCheckout" class="primary" ${state.meta?.serverOnline?'':'disabled'}>Sotishni tasdiqlash</button></div></section>`;
  const selected=()=>Array.from(document.querySelectorAll('[data-quantity]')).filter(el=>Number(el.value)>0).map(el=>({barItemId:Number(el.dataset.quantity),quantity:Number(el.value)}));
  $('#saleItems').oninput=()=>$('#saleTotal').textContent=money(selected().reduce((sum,line)=>sum+line.quantity*Number(items.find(i=>i.id===line.barItemId)?.sellPrice||0),0));
  $('#barOrders').onclick=run(orders);
  $('#saleCheckout').onclick=run(async()=>{
   online();const lines=selected();if(!lines.length)throw Error('Kamida bitta mahsulot tanlang.');if(lines.some(l=>!Number.isInteger(l.quantity)))throw Error('Miqdor butun son bo‘lishi kerak.');
   const users=await clients();const pcs=await remote('/api/computers');state.pcs=Array.isArray(pcs)?pcs:pcs.computers||[];
   modal('Bar savdosini tasdiqlash',`<p>${lines.map(l=>esc(items.find(i=>i.id===l.barItemId)?.name)+' × '+l.quantity).join('<br>')}</p>${payment('paymentMethod','<option value="ON_PC_SESSION">Kompyuter seansiga qarz</option><option value="CLIENT_BALANCE">Mijoz balansi</option>')}<label>Seans (qarzga yozilganda)<select name="computerId"><option value="">Tanlang</option>${pcOptions(state.pcs.filter(p=>p.activeSession))}</select></label><label>Balans egasi<select name="userId">${clientOptions(users)}</select></label>`,v=>{
    const pc=state.pcs.find(p=>p.id===v.computerId);
    if(v.paymentMethod==='ON_PC_SESSION'&&!pc?.activeSession)throw Error('Faol seansni tanlang.');
    if(v.paymentMethod==='CLIENT_BALANCE'&&!v.userId)throw Error('Balans egasini tanlang.');
    return remote('/api/bar/orders','POST',{items:lines,paymentMethod:v.paymentMethod,...(v.paymentMethod==='ON_PC_SESSION'?{computerId:pc.id,sessionId:pc.activeSession.sessionId}:{}),...(v.paymentMethod==='CLIENT_BALANCE'?{userId:Number(v.userId)}:{})});
   });
  });
 }
 async function orders(){
  online();const data=await remote('/api/bar/orders?limit=100');
  content().innerHTML=`<h2>Bar buyurtmalari</h2><p class="hint">Oxirgi 100 ta buyurtma. Bu operatsion ro‘yxat; umumiy tushum hisoboti menejerda.</p>${data.orders.map(o=>`<section class="card"><div class="heading"><strong>${esc(o.orderNumber)}</strong><span>${esc(money(o.totalAmount))}</span></div><p>${o.items.map(i=>esc(i.item_name)+' × '+i.quantity).join(', ')}</p><p class="hint">${esc(o.createdAt)} · ${esc(o.approvalStatus)} · ${esc(o.paymentStatus)}</p>${o.approvalStatus==='PENDING'?`<button data-order="${o.id}" data-decision="confirm">Tasdiqlash</button> <button data-order="${o.id}" data-decision="reject">Rad etish</button>`:o.paymentStatus==='PENDING_AT_CHECKOUT'?`<button data-order="${o.id}" data-decision="pay">Qarzni qabul qilish</button>`:''}</section>`).join('')||'<p>Buyurtma yo‘q.</p>'}`;
  for(const b of document.querySelectorAll('[data-order]'))b.onclick=()=>modal('Buyurtma #'+b.dataset.order,b.dataset.decision==='pay'?payment():'<p>Tanlangan amalni tasdiqlaysizmi?</p>',v=>b.dataset.decision==='pay'?remote('/api/bar/orders/'+b.dataset.order+'/pay','POST',{paymentMethod:v.paymentMethod}):remote('/api/bar/orders/'+b.dataset.decision,'POST',{orderId:Number(b.dataset.order)}));
 }
 async function bookings(){
  online();const data=await remote('/api/bookings');
  content().innerHTML=`<div class="heading"><h2>Bronlar</h2><button id="newBooking" class="primary">+ Bron</button></div>${data.bookings.map(b=>`<section class="card"><strong>${esc(b.computerName)} · ${esc(b.customerName)}</strong><p>${esc(b.startTime)} — ${esc(b.endTime)}</p><p>${esc(b.customerPhone)} · ${esc(b.status)}</p><button data-booking="${b.id}">Holatini o‘zgartirish</button></section>`).join('')||'<p>Bron yo‘q.</p>'}`;
  $('#newBooking').onclick=()=>modal('Yangi bron',`<label>Kompyuter<select name="computerId" required>${pcOptions()}</select></label><label>Mijoz<input name="customerName" maxlength="160" required></label><label>Telefon<input name="customerPhone" type="tel"></label><label>Boshlanish<input name="startTime" type="datetime-local" required></label><label>Tugash<input name="endTime" type="datetime-local" required></label><label>Izoh<input name="note" maxlength="2000"></label>`,v=>remote('/api/bookings','POST',{...v,startTime:new Date(v.startTime).toISOString(),endTime:new Date(v.endTime).toISOString()}));
  for(const b of document.querySelectorAll('[data-booking]'))b.onclick=()=>modal('Bron holati','<label>Holat<select name="status"><option value="CONFIRMED">Tasdiqlangan</option><option value="ACTIVE">Boshlangan</option><option value="COMPLETED">Yakunlangan</option><option value="CANCELLED">Bekor qilingan</option></select></label>',v=>remote('/api/bookings/'+b.dataset.booking+'/status','PUT',v));
 }
 async function customerList(){
  online();const users=await clients();
  content().innerHTML=`<h2>Mijozlar balansi</h2>${users.map(u=>`<section class="card"><strong>${esc(u.username)}</strong><p>${esc(u.phoneNumber||'')} · ${esc(money(u.balance))}</p>${can('customers:view')?`<button data-topup="${u.id}">Balans to‘ldirish</button>`:''}</section>`).join('')||'<p>Mijozlar hali qo‘shilmagan.</p>'}`;
  for(const b of document.querySelectorAll('[data-topup]'))b.onclick=()=>modal('Balans to‘ldirish','<label>Summa<input name="amount" type="number" min="1" required></label>'+payment(),v=>remote('/api/clients/topup','POST',{userId:Number(b.dataset.topup),amount:Number(v.amount),paymentMethod:v.paymentMethod}));
 }
 async function history(){
  online();const data=await remote('/api/audit-logs?limit=100');
  content().innerHTML='<h2>Amallar tarixi</h2><p class="hint">Joriy smenaning oxirgi 100 ta hodisasi.</p>'+data.logs.map(l=>`<section class="card"><strong>${esc(l.eventType)}</strong><p class="hint">${esc(l.createdAt)}</p><dl>${Object.entries(l.details||{}).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==='object'?JSON.stringify(v):v)}</dd>`).join('')}</dl></section>`).join('');
 }
 function addItem(){
  modal('Bar mahsuloti qo‘shish','<label>Nomi<input name="name" required maxlength="120"></label><label>Xarid narxi<input name="buyPrice" type="number" min="0" value="0" required></label><label>Sotish narxi<input name="sellPrice" type="number" min="1" required></label><label>Qoldiq<input name="stockQuantity" type="number" min="0" step="1" required></label><label>Tur<select name="category"><option value="DRINKS">Ichimlik</option><option value="SNACKS">Yegulik</option><option value="OTHER">Boshqa</option></select></label>',v=>remote('/api/bar/items','POST',{...v,buyPrice:Number(v.buyPrice),sellPrice:Number(v.sellPrice),stockQuantity:Number(v.stockQuantity)}));
 }
 async function inventory(){
  online();const data=await remote('/api/bar/items');const items=Array.isArray(data)?data:data.items||[];
  content().innerHTML=`<div class="heading"><h2>Bar ombori</h2><button id="addItem" class="primary">+ Mahsulot</button></div>${items.map(i=>`<section class="card"><strong>${esc(i.name)}</strong><p>Qoldiq: ${i.stockQuantity} · ${esc(money(i.sellPrice))}</p><button data-edit-item="${i.id}">Tahrirlash</button></section>`).join('')}`;
  $('#addItem').onclick=addItem;
  for(const b of document.querySelectorAll('[data-edit-item]'))b.onclick=()=>{const item=items.find(i=>String(i.id)===b.dataset.editItem);modal('Mahsulotni tahrirlash',`<label>Nomi<input name="name" value="${esc(item.name)}" required></label><label>Xarid narxi<input name="buyPrice" type="number" min="0" value="${item.buyPrice}" required></label><label>Sotish narxi<input name="sellPrice" type="number" min="1" value="${item.sellPrice}" required></label><label>Haqiqiy ombor qoldig‘i<input name="stockQuantity" type="number" min="0" step="1" value="${item.stockQuantity}" required></label>`,v=>remote('/api/bar/items/'+item.id,'PUT',{...v,buyPrice:Number(v.buyPrice),sellPrice:Number(v.sellPrice),stockQuantity:Number(v.stockQuantity),category:item.category,isActive:item.isActive}));};
 }
 function batch(){
  const pcs=state.pcs.filter(p=>!p.activeSession);
  modal('Guruh seansi',`<p>Bo‘sh kompyuterlarni belgilang.</p>${pcs.map(p=>`<label class="batch-pc"><input type="checkbox" data-batch-pc value="${esc(p.id)}">${esc(p.name)}</label>`).join('')}<label>Daqiqa<input name="minutes" type="number" min="1" max="1440" value="60" required></label>${payment('paymentType')}`,v=>{const computerIds=Array.from(document.querySelectorAll('[data-batch-pc]:checked')).map(el=>el.value);if(!computerIds.length)throw Error('Kompyuterlarni tanlang.');return remote('/api/sessions/batch-start','POST',{computerIds,mode:'HOURS',value:Number(v.minutes)/60,paymentType:v.paymentType});});
 }
 function renderMenu(){
  content().innerHTML=`<h2>Administrator amallari</h2><p class="hint">Serverdagi akkaunt ruxsatlari har bir amalda tekshiriladi.</p><div class="grid">${[['bookings','Bronlar'],['customers','Mijozlar va balans'],['orders','Bar buyurtmalari'],['inventory','Bar ombori'],['batch','Guruh seansi'],['history','Amallar tarixi']].filter(([id])=>id!=='batch'||can('session:manage')).map(([id,label])=>`<button data-operation="${id}" ${state.meta?.serverOnline?'':'disabled'}>${label}</button>`).join('')}</div>`;
  const handlers={bookings,customers:customerList,orders,inventory,history,batch};for(const b of document.querySelectorAll('[data-operation]'))b.onclick=run(handlers[b.dataset.operation]);
 }
 return {renderMenu,renderBar,renderShift,startSession,checkout,transfer,message};
}
