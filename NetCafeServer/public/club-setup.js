import {steps,dayNames,newId,inside,placeInRoom,moveRoom,addComputer,bindClient,connected,stepProblems,draftChanges} from './club-setup-model.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number(value||0).toLocaleString('ru-RU')+' so‘m';
const labels={rooms:['01 / ZAL REJASI','Klubingiz qanday joylashgan?','Xonalarni chizing, nomlang va kompyuterlar sonini kiriting.'],
  computers:['02 / CLIENTLAR','Har bir PC o‘z joyida.','Kompyuterni tanlang, xonasini belgilang va haqiqiy clientga biriktiring.'],
  tariffs:['03 / NARXLAR','Har xonaning o‘z tarifi.','Hafta kunlari, vaqt oralig‘i va soatlik narxni bir joyda sozlang.'],
  review:['04 / TEKSHIRISH','Oxirgi marta ko‘zdan kechiring.','Yetishmayotgan joylarni to‘ldiring. Qoralama serverda saqlanadi.']};
let draft,baseline,context,revision,readiness,step='rooms',selectedRoom,selectedPc,tariffRoom;
let generation=0,savedGeneration=0,saveTask=null,saveTimer,pollTimer,error='',conflict=false,accessLost=false,contextFresh=false,lastLiveAt=0,drag=null,drawMode=false,refreshing=false;
let allowExit=false,mapView='all';
let baseFingerprint=null,completing=false,pendingCompletion=null;
const pendingKey='softech-setup-completion:'+(localStorage.getItem('softech_token')||'none').slice(-24);
const token=localStorage.getItem('softech_token');
const dirty=()=>generation!==savedGeneration;
function flash(message){error=message;renderStatus();}
async function api(path,method='GET',body){
  if(!token||localStorage.getItem('softech_token')!==token){accessLost=true;throw Error('Akkaunt o‘zgardi. Kirish oynasiga qayting.');}
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},cache:'no-store',
    signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});
  let value;try{value=await response.json();}catch{throw Error('Server javobini o‘qib bo‘lmadi. Qayta urinib ko‘ring.');}
  if(!response.ok){if([401,403].includes(response.status))accessLost=true;throw Object.assign(Error(value.error||'So‘rov bajarilmadi.'),{status:response.status});}
  return value;
}
function changed({render=false}={}){
  generation++;if(!conflict&&!accessLost)error='';clearTimeout(saveTimer);saveTimer=setTimeout(()=>void save(),650);
  if(render)renderStage();else{renderMaps();renderStatus();}
}
async function save(){
  clearTimeout(saveTimer);
  if(drag)return false;
  if(saveTask){await saveTask;if(dirty()&&!error&&!conflict&&!accessLost)return save();return !error;}
  if(!dirty())return !error;
  if(conflict||accessLost)return false;
  const sent=structuredClone(draft),sentGeneration=generation;error='';
  saveTask=(async()=>{
    try{
      const result=await api('/api/setup/draft','PUT',{revision,draft:sent,...(baseFingerprint?{baseFingerprint}:{})});
      revision=result.revision;savedGeneration=sentGeneration;
      if(generation===sentGeneration){readiness=result.readiness;renderIssues();}
      return true;
    }catch(e){conflict=e.status===409;error=conflict?'Qoralama boshqa oynada o‘zgargan. Siz kiritgan ma’lumot shu oynada saqlanib turibdi. Nusxasini yuklab oling yoki serverdagi nusxani oching.':e.message;return false;}
    finally{saveTask=null;renderStatus();}
  })();renderStatus();
  const result=await saveTask;
  if(result&&dirty())return save();
  return result;
}
function renderStatus(){
  if(!draft)return;
  $('saveError').hidden=!error;$('saveError').querySelector('span').textContent=error;
  $('loadRemote').hidden=!conflict;$('retrySave').hidden=conflict||accessLost;
  $('saveStatus').textContent=accessLost?'Qayta kirish kerak':conflict?'Nusxalar farq qiladi':saveTask?'Saqlanmoqda…':error?'Saqlanmadi':dirty()?'Saqlanmagan o‘zgarishlar':'✓ Qoralama saqlandi';
  $('saveDraft').disabled=!!saveTask||conflict||accessLost;
  $('previousStep').disabled=steps.indexOf(step)===0;
  const problems=stepProblems(readiness,step);
  $('nextStep').hidden=step==='review';
  $('completeSetup').hidden=step!=='review'&&!pendingCompletion;
  $('completeSetup').textContent=pendingCompletion?'Natijani tekshirish':'Saqlash va ishni boshlash';
  $('completeSetup').disabled=completing||(!pendingCompletion&&(dirty()||!!saveTask||conflict||accessLost||!readiness?.draftValid||readiness?.warnings?.length>0||!contextFresh||context.activeSessions>0||baseFingerprint!==context.fingerprint));
  $('workspace').inert=completing||!!pendingCompletion;
  if(completing||pendingCompletion){$('saveDraft').disabled=true;$('previousStep').disabled=true;$('nextStep').disabled=true;$('saveStatus').textContent=completing?'Sozlamalar qo‘llanmoqda…':'Saqlash natijasini tekshiring';}
  const invalid=document.querySelector(`[data-panel="${step}"] input:invalid`);
  $('nextStep').disabled=completing||!!pendingCompletion||dirty()||!!saveTask||!!error||!readiness||problems.length>0||!!invalid;
  $('nextReason').textContent=step==='review'?'24/7 tarif, clientlar ulanishi va faol seans yo‘qligi tekshiriladi.':invalid?'Belgilangan maydonni to‘g‘ri to‘ldiring.':dirty()||saveTask?'O‘zgarishlar saqlangach davom eting.':problems.length?problems[0].message:step==='computers'?'Barcha clientlar yakuniy ishga tushirishdan oldin ulangan bo‘lishi kerak.':'Keyingi bosqichga o‘tishingiz mumkin.';
  const index=steps.indexOf(step);
  document.querySelectorAll('[data-step]').forEach(button=>{
    const n=steps.indexOf(button.dataset.step);button.disabled=n>index+1||(n===index+1&&$('nextStep').disabled);
    if(n===index)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
  });
}
function renderIssues(){
  const list=(readiness?.issues||[]).filter(i=>step==='review'||i.step===step||(step==='rooms'&&['PC_COUNT','LICENSE_LIMIT','LIMIT_UNKNOWN'].includes(i.code)));
  const warnings=(readiness?.warnings||[]).filter(()=>['tariffs','review'].includes(step));
  if(!contextFresh&&['computers','review'].includes(step))warnings.push({step:'computers',code:'PC_OFFLINE',message:'Clientlar aloqasini hozir tekshirib bo‘lmadi. Internet emas, klub serveri bilan ulanishni ham tekshiring va “Aloqani tekshirish”ni bosing.'});
  const target=step==='review'?$('reviewChecks'):$('stepIssues');
  target.replaceChildren();
  if(step==='review')$('stepIssues').replaceChildren();
  for(const item of [...list,...warnings]){
    const button=document.createElement('button');button.className='issue'+(item.code==='PC_OFFLINE'?'':' error');
    button.textContent=item.message;button.addEventListener('click',()=>goToIssue(item));target.append(button);
  }
  if(!list.length&&!warnings.length){target.textContent=step==='review'?'✓ Qoralama tekshiruvlari o‘tdi.':' ';}
}
async function goToIssue(item){
  if(item.elementId){if(draft.rooms.some(r=>r.id===item.elementId))selectedRoom=tariffRoom=item.elementId;
    if(draft.computers.some(c=>c.id===item.elementId))selectedPc=item.elementId;
    const tariff=draft.tariffs.find(t=>t.id===item.elementId);if(tariff)tariffRoom=tariff.roomId;}
  const target=item.step||'tariffs';
  if(target===step)renderStage();else await navigate(target,true);
  const region=target==='rooms'?$('roomEditor'):target==='computers'?$('pcEditor'):$('tariffList').querySelector(`[data-rate="${CSS.escape(item.elementId||'')}"]`);
  region?.scrollIntoView({block:'center',behavior:'instant'});region?.querySelector('input,select')?.focus();
}
async function navigate(next,force=false){
  if(completing||pendingCompletion)return;
  if(!steps.includes(next)||next===step)return;
  if(!await save())return;
  if(!force&&steps.indexOf(next)>steps.indexOf(step)&&(stepProblems(readiness,step).length||document.querySelector(`[data-panel="${step}"] input:invalid`)))return;
  step=next;draft.step=step;changed();renderStage();$('stepTitle').focus();window.scrollTo({top:0,behavior:'instant'});
}
function renderStage(){
  [ $('stepKicker').textContent,$('stepTitle').textContent,$('stepHint').textContent ]=labels[step];
  document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==step);
  $('expectedComputers').value=draft.expectedComputers||'';
  if(step==='rooms'){renderRoomList();renderRoomEditor();}
  if(step==='computers'){renderPcList();renderPcEditor();}
  if(step==='tariffs')renderTariffs();
  if(step==='review')renderReview();
  renderMaps();renderIssues();renderStatus();
}
const input=(name,label,value,type='text',extra='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function renderRoomList(){
  $('roomCount').textContent=draft.rooms.length;
  $('roomList').innerHTML=draft.rooms.map(r=>`<button data-room="${esc(r.id)}" class="${selectedRoom===r.id?'selected':''}">${esc(r.name||'Nomsiz xona')}</button>`).join('')||'<p class="muted">“Xona chizish” yoki “+ Xona” bilan boshlang.</p>';
}
function renderRoomEditor(){
  const r=draft.rooms.find(r=>r.id===selectedRoom),root=$('roomEditor');
  if(!r){root.innerHTML='<p class="empty">Xaritadan xonani tanlang.</p>';return;}
  root.innerHTML=`${input('name','Xona nomi',r.name,'text','maxlength="80"')}
    <label class="field">Xona turi<select name="type">${[['STANDARD','Oddiy zal'],['VIP','VIP xona'],['PS5','PlayStation'],['BOOTCAMP_5V5','Bootcamp 5 × 5']].map(([key,name])=>`<option value="${key}" ${r.type===key?'selected':''}>${name}</option>`).join('')}</select></label>
    <div class="two-fields">${input('x','X joylashuvi',r.x,'number','step="10"')}${input('y','Y joylashuvi',r.y,'number','step="10"')}</div>
    <div class="two-fields">${input('width','Eni',r.width,'number',`min="120" max="10000" step="10" ${r.polygonPoints?'disabled':''}`)}${input('height','Bo‘yi',r.height,'number',`min="120" max="10000" step="10" ${r.polygonPoints?'disabled':''}`)}</div>
    ${r.polygonPoints?'<p class="muted">Mavjud ko‘pburchak shakli saqlanadi. Xonani butunlay siljitish mumkin.</p>':''}<button class="danger" data-delete-room="${esc(r.id)}">Xonani olib tashlash</button>`;
}
function renderPcList(){
  $('pcCount').textContent=`${draft.computers.length} / ${draft.expectedComputers} ta kompyuter`;
  const clients=contextFresh?context.liveClients:[];
  $('liveStatus').textContent=contextFresh?`${draft.computers.filter(pc=>connected(pc,clients)).length} ta mos client ulangan · ${new Date(lastLiveAt).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit',hour12:false})}`:'Aloqa tekshirilmagan. Yangilash tugmasini bosing.';
  $('pcList').innerHTML=draft.computers.map(pc=>`<button data-pc="${esc(pc.id)}" class="${selectedPc===pc.id?'selected':''}">${esc(pc.name||'PC-'+pc.number)}<small>${esc(pc.ip||'IP kiritilmagan')}</small><small class="${connected(pc,clients)?'online':'offline'}">${connected(pc,clients)?'● Ulangan':'○ Ulanish kutilmoqda'}</small></button>`).join('')||'<p class="empty">Rejadagi kompyuterlarni qo‘shing.</p>';
}
function roomOptions(value){return '<option value="">Xonani tanlang</option>'+draft.rooms.map(r=>`<option value="${esc(r.id)}" ${r.id===value?'selected':''}>${esc(r.name)}</option>`).join('');}
function renderPcEditor(){
  const pc=draft.computers.find(c=>c.id===selectedPc),root=$('pcEditor');
  if(!pc){root.innerHTML='<p class="empty">Ro‘yxat yoki xaritadan PC’ni tanlang.</p>';return;}
  root.innerHTML=`<h2>${esc(pc.name||'Kompyuter')}</h2><label class="field">Ulangan clientdan tanlash<select id="bindClient"><option value="">Qo‘lda kiriting yoki clientni tanlang</option>${(contextFresh?context.liveClients:[]).filter(c=>c.connected).map(c=>`<option value="${c.number}" ${draft.computers.some(p=>p.id!==pc.id&&(p.number===c.number||p.ip===c.ip))?'disabled':''}>PC-${c.number} · ${esc(c.ip)}</option>`).join('')}</select><small>Client raqami va IP manzili birga biriktiriladi. Bu yangi PC yaratmaydi.</small></label>
    <div class="two-fields">${input('number','PC raqami',pc.number,'number','min="1" max="9999" inputmode="numeric"')}${input('name','Nomi',pc.name,'text','maxlength="80"')}</div>
    <label class="field">Xonasi<select name="roomId">${roomOptions(pc.roomId)}</select></label>
    ${input('ip','IPv4 manzil',pc.ip,'text','inputmode="decimal" maxlength="64" placeholder="192.168.1.101" autocomplete="off"')}
    ${input('mac','MAC manzil (ixtiyoriy)',pc.mac,'text','maxlength="32" placeholder="AA:BB:CC:DD:EE:FF" autocomplete="off"')}
    <p class="muted">MAC kompyuterni masofadan yoqish uchun kerak. Uni ulangan clientdan olish mumkin.</p>
    <div class="two-fields">${input('x','X joylashuvi',pc.x,'number','step="10"')}${input('y','Y joylashuvi',pc.y,'number','step="10"')}</div><button class="danger" data-delete-pc="${esc(pc.id)}">PC’ni qoralamadan olib tashlash</button>`;
}
function renderTariffs(){
  if(!draft.rooms.some(r=>r.id===tariffRoom))tariffRoom=draft.rooms[0]?.id||'';
  $('tariffRoom').innerHTML=roomOptions(tariffRoom);$('addTariff').disabled=!tariffRoom;
  const rates=draft.tariffs.filter(t=>t.roomId===tariffRoom);
  $('tariffList').innerHTML=rates.map((t,i)=>`<article class="tariff-card" data-rate="${esc(t.id)}"><div class="tariff-top"><strong>ORALIQ ${String(i+1).padStart(2,'0')}</strong><button class="danger" data-delete-rate="${esc(t.id)}" aria-label="${esc(t.name)} tarifini olib tashlash">Olib tashlash</button></div>
    ${input('name','Tarif nomi',t.name,'text','maxlength="120"')}
    <div class="two-fields">${input('start_time','Boshlanish · 24 soat',t.start_time,'text','required inputmode="numeric" maxlength="5" placeholder="00:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]"')}${input('end_time','Tugash · 24 soat',t.end_time,'text','required inputmode="numeric" maxlength="5" placeholder="00:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]"')}</div>
    <fieldset class="days"><legend>Hafta kunlari</legend>${dayNames.map((name,i)=>`<label><input type="checkbox" name="day" value="${i+1}" ${t.days_of_week.includes(i+1)?'checked':''}><span>${name}</span></label>`).join('')}</fieldset>
    ${input('price_per_hour','1 soat narxi · so‘m',t.price_per_hour??'','number','min="1" inputmode="numeric" step="1" placeholder="Masalan, 7000"')}
    <label class="check"><input type="checkbox" name="vipAllowed" ${t.vipAllowed!==false?'checked':''}>VIP Postpaid — oldindan to‘lovsiz seansga ruxsat</label>
    <p class="tariff-note">VIP Postpaid’da mijoz ishlatgan vaqt uchun yakunda to‘laydi. Tariflar ustma-ust tushmasin.</p></article>`).join('')||'<div class="empty">Bu xonaga hali tarif kiritilmagan.<br>“+ Vaqt oralig‘i” bilan boshlang.</div>';
  $('otherTariffs').hidden=!context.otherTariffs.length;
  $('otherTariffs').querySelector('div').innerHTML=context.otherTariffs.map(t=>`<p>${esc(t.name)} · ${t.price==null?'Narx belgilanmagan':money(t.price)} ${!t.type||t.type==='HOURLY'?'/ soat':t.durationMinutes?'· '+Number(t.durationMinutes)+' daqiqa':''} ${t.start?`· ${esc(t.start)}–${esc(t.end)}`:''} ${t.vip?'· VIP':''}</p>`).join('');
}
function describe(item,label){
  if(!item)return '—';
  if(label==='Tarif')return `${item.name}: ${item.start_time}–${item.end_time}, ${item.days_of_week.map(d=>dayNames[d-1]).join(', ')}, ${money(item.price_per_hour)}, VIP ${item.vipAllowed===false?'yo‘q':'bor'}`;
  if(label==='PC')return `${item.name} (#${item.number}) · ${item.ip||'IP yo‘q'} · ${item.mac||'MAC yo‘q'} · ${[...draft.rooms,...baseline.rooms].find(r=>r.id===item.roomId)?.name||'xonasiz'} · (${item.x}, ${item.y})`;
  return `${item.name} · ${item.type} · ${item.width} × ${item.height} · (${item.x}, ${item.y})`;
}
function renderReview(){
  $('baselineNotice').textContent=baseFingerprint!==context.fingerprint?'Amaldagi sozlamalar yangilangan yoki dastlabki nusxa tasdiqlanmagan. Holatni tekshirib tasdiqlang.':context.activeSessions?'Faol seanslar tugashini kuting.':'Amaldagi sozlamalar bilan nusxa mos.';
  $('reviewSummary').innerHTML=[[draft.rooms.length,'Xona'],[draft.computers.length,'Kompyuter'],[draft.tariffs.length,'Tarif oralig‘i'],[contextFresh?draft.computers.filter(c=>connected(c,context.liveClients)).length:'—','Ulangan client']].map(([n,label])=>`<div class="metric"><b>${n}</b><span>${label}</span></div>`).join('');
  const changes=draftChanges(draft,baseline);
  $('draftChanges').innerHTML=changes.map(c=>`<div class="change-row"><b>${esc(c.kind)} · ${esc(c.label)} · ${esc(c.name)}</b><small>Oldin: ${esc(describe(c.before,c.label))}</small><small>Qoralama: ${esc(describe(c.after,c.label))}</small></div>`).join('')||'<p class="muted">Amaldagi ma’lumotlarga o‘zgarish kiritilmagan.</p>';
  $('contextNotices').innerHTML=[...context.notices,...(context.activeSessions?[`${context.activeSessions} ta faol seans bor. Qoralama ularning hisobi yoki tarifini o‘zgartirmaydi.`]:[])].map(t=>`<p class="muted">${esc(t)}</p>`).join('');
}
function bounds(){
  if(mapView==='selected'){
    const roomId=step==='computers'?draft.computers.find(c=>c.id===selectedPc)?.roomId:selectedRoom;
    const r=draft.rooms.find(r=>r.id===roomId);
    if(r)return {x:r.x-40,y:r.y-40,width:r.width+80,height:r.height+80};
  }
  const points=[{x:0,y:0},{x:draft.rooms.length?800:1000,y:draft.rooms.length?450:650},...draft.rooms.flatMap(r=>[{x:r.x-30,y:r.y-30},{x:r.x+r.width+30,y:r.y+r.height+30}]),...draft.computers.flatMap(c=>[{x:c.x-40,y:c.y-40},{x:c.x+40,y:c.y+40}])];
  const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
  return {x:minX,y:minY,width:Math.max(...points.map(p=>p.x))-minX,height:Math.max(...points.map(p=>p.y))-minY};
}
function mapMarkup(box){
  return `<svg viewBox="${box.x} ${box.y} ${box.width} ${box.height}" aria-label="Klub xonalari xaritasi" class="${drawMode&&step==='rooms'?'draw-active':''}"><defs><pattern id="dots-${step}" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#354536"/></pattern></defs><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="url(#dots-${step})"/>
    ${draft.rooms.map(r=>`<g data-map-room="${esc(r.id)}" class="map-item ${selectedRoom===r.id?'selected':''}" tabindex="0" role="button" aria-label="${esc(r.name)} xonasi">${r.polygonPoints?`<polygon class="room-shape" points="${r.polygonPoints.map(p=>`${p.x},${p.y}`).join(' ')}"/>`:`<rect class="room-shape" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8"/>`}<text class="room-label" x="${r.x+15}" y="${r.y+28}">${esc(r.name.slice(0,27)||'Xona')}</text></g>`).join('')}
    ${draft.computers.map(c=>`<g data-map-pc="${esc(c.id)}" class="map-item ${selectedPc===c.id?'selected':''}" tabindex="0" role="button" aria-label="${esc(c.name)} kompyuteri"><rect class="pc-shape" x="${c.x-22}" y="${c.y-18}" width="44" height="30" rx="5"/><path d="M${c.x-10} ${c.y+17}h20" stroke="#afc293" stroke-width="3"/><text class="pc-label" x="${c.x}" y="${c.y+35}" text-anchor="middle">${esc(String(c.number))}</text></g>`).join('')}
    ${!draft.rooms.length?'<text x="500" y="300" fill="#768770" text-anchor="middle" font-size="22">Birinchi xonangizni shu yerga chizing</text>':''}<rect id="drawPreview" class="draw-preview" width="0" height="0"/></svg>`;
}
function renderMaps(){
  if(!draft||drag||!['rooms','computers'].includes(step))return;
  const host=step==='rooms'?$('roomMapHost'):$('pcMapHost');host.innerHTML=mapMarkup(bounds());
}
function point(event,svg){const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());return {x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10};}
function mapDown(event){
  if(event.button!==0||!draft)return;const svg=event.target.closest('svg');if(!svg)return;
  const origin=point(event,svg),roomTarget=event.target.closest('[data-map-room]'),pcTarget=event.target.closest('[data-map-pc]');
  if(step==='rooms'&&drawMode){drag={kind:'draw',svg,origin,box:bounds()};}
  else if(pcTarget&&step==='computers'){
    selectedPc=pcTarget.dataset.mapPc;const pc=draft.computers.find(c=>c.id===selectedPc);drag={kind:'pc',svg,origin,original:structuredClone(pc),box:bounds()};renderPcList();renderPcEditor();
  }else if(roomTarget){
    selectedRoom=roomTarget.dataset.mapRoom;
    if(step==='rooms'){drag={kind:'room',svg,origin,original:structuredClone(draft),box:bounds()};renderRoomList();renderRoomEditor();}
  }
  if(drag){clearTimeout(saveTimer);event.preventDefault();svg.setPointerCapture(event.pointerId);drag.pointerId=event.pointerId;}
}
function mapMove(event){
  if(!drag||event.pointerId!==drag.pointerId)return;const p=point(event,drag.svg);drag.end=p;
  if(drag.kind==='draw'){
    const rect=drag.svg.querySelector('#drawPreview');for(const [k,v] of Object.entries({x:Math.min(p.x,drag.origin.x),y:Math.min(p.y,drag.origin.y),width:Math.abs(p.x-drag.origin.x),height:Math.abs(p.y-drag.origin.y)}))rect.setAttribute(k,v);
  }else{
    const dx=p.x-drag.origin.x,dy=p.y-drag.origin.y;
    if(drag.kind==='room'){const r=drag.original.rooms.find(r=>r.id===selectedRoom);moveRoom(draft,r.id,r.x+dx,r.y+dy);}
    else{const pc=draft.computers.find(c=>c.id===selectedPc);pc.x=drag.original.x+dx;pc.y=drag.original.y+dy;pc.roomId=draft.rooms.find(r=>inside(pc,r))?.id||'';}
    // Keep the capturing SVG itself stable while its drawing changes.
    const temp=document.createElement('div');temp.innerHTML=mapMarkup(drag.box);drag.svg.innerHTML=temp.firstChild.innerHTML;
  }
}
function mapEnd(event,cancel=false){
  if(!drag)return;const saved=drag;drag=null;
  if(cancel){if(saved.kind==='room')draft=saved.original;if(saved.kind==='pc')Object.assign(draft.computers.find(c=>c.id===selectedPc),saved.original);}
  else if(saved.kind==='draw'&&saved.end){
    const w=Math.abs(saved.end.x-saved.origin.x),h=Math.abs(saved.end.y-saved.origin.y);
    if(w>=120&&h>=120){createRoom({x:Math.min(saved.end.x,saved.origin.x),y:Math.min(saved.end.y,saved.origin.y),width:w,height:h});drawMode=false;}
    else flash('Xonani biroz kattaroq chizing: kamida 120 × 120.');
  }else if(saved.end)changed();
  try{saved.svg.releasePointerCapture(saved.pointerId);}catch{}
  renderStage();setTool();
  if(dirty())saveTimer=setTimeout(()=>void save(),650);
}
function createRoom(geometry={}){
  if(draft.rooms.length>=64){flash('64 tadan ko‘p xona qo‘shib bo‘lmaydi.');return;}
  const room={id:newId('room'),name:'Xona '+(draft.rooms.length+1),type:'STANDARD',x:40+(draft.rooms.length%3)*400,y:40+Math.floor(draft.rooms.length/3)*300,width:360,height:240,...geometry};
  draft.rooms.push(room);selectedRoom=tariffRoom=room.id;changed({render:true});
}
function setTool(){
  $('drawTool').classList.toggle('selected',drawMode);$('drawTool').setAttribute('aria-pressed',String(drawMode));
  $('selectTool').classList.toggle('selected',!drawMode);$('selectTool').setAttribute('aria-pressed',String(!drawMode));renderMaps();
}
function confirmAction(message){
  const dialog=$('confirmDialog');$('confirmMessage').textContent=message;dialog.returnValue='cancel';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='yes'),{once:true}));
}
async function refresh(){
  if(!draft||document.hidden||refreshing||completing||pendingCompletion)return;
  refreshing=true;const startRevision=revision,startGeneration=generation;
  try{
    const [latest,state]=await Promise.all([api('/api/setup/context'),api('/api/setup/draft')]);
    context=latest;contextFresh=true;lastLiveAt=Date.now();
    if(!dirty()&&!saveTask&&revision===startRevision&&generation===startGeneration){
      if(state.revision!==revision){conflict=true;flash('Qoralama boshqa oynada o‘zgargan. Serverdagi nusxani oching.');}
      else{readiness=state.readiness;renderIssues();renderStatus();}
    }
  }catch{contextFresh=false;}finally{refreshing=false;}
  if(step==='computers'){renderPcList();if(!document.activeElement?.closest('#pcEditor'))renderPcEditor();}
  if(step==='review')renderReview();
  renderIssues();renderStatus();
  if(accessLost){flash('Akkaunt yoki litsenziya holati o‘zgardi. Bosh oynada qayta kiring.');clearInterval(pollTimer);}
}

$('reloadPage').onclick=()=>location.reload();
$('cancelConfirm').onclick=()=>$('confirmDialog').close('cancel');$('acceptConfirm').onclick=()=>$('confirmDialog').close('yes');
$('addRoom').onclick=()=>createRoom();$('drawTool').onclick=()=>{drawMode=true;mapView='all';setTool();};$('selectTool').onclick=()=>{drawMode=false;setTool();};
document.querySelectorAll('[data-map-view]').forEach(b=>b.onclick=()=>{mapView=b.dataset.mapView;renderMaps();});
$('expectedComputers').addEventListener('input',e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=0&&n<=500){draft.expectedComputers=n;changed();}renderStatus();});
$('roomList').onclick=e=>{const b=e.target.closest('[data-room]');if(b){selectedRoom=b.dataset.room;renderRoomList();renderRoomEditor();renderMaps();}};
$('roomEditor').addEventListener('input',e=>{
  const r=draft.rooms.find(r=>r.id===selectedRoom),key=e.target.name;if(!r||!key)return;
  if(['x','y','width','height'].includes(key)){
    const n=Number(e.target.value);e.target.setCustomValidity('');if(!e.target.value||!Number.isFinite(n)||Math.abs(n)>100000){e.target.setCustomValidity('Haqiqiy o‘lcham yoki joylashuvni kiriting.');renderStatus();return;}
    if(key==='x'||key==='y')moveRoom(draft,r.id,key==='x'?n:r.x,key==='y'?n:r.y);else r[key]=n;
  }else r[key]=e.target.value;
  renderRoomList();changed();
});
$('roomEditor').onclick=async e=>{
  const b=e.target.closest('[data-delete-room]');if(!b)return;
  if(!await confirmAction('Xona va uning qoralamadagi tariflari olib tashlanadi. PC’lar qoladi, ularga boshqa xona tanlash kerak bo‘ladi.'))return;
  const id=b.dataset.deleteRoom;draft.rooms=draft.rooms.filter(r=>r.id!==id);draft.tariffs=draft.tariffs.filter(t=>t.roomId!==id);
  draft.computers.filter(c=>c.roomId===id).forEach(c=>c.roomId='');selectedRoom=draft.rooms[0]?.id;changed({render:true});
};
$('addComputer').onclick=()=>{try{selectedPc=addComputer(draft,selectedRoom).id;changed({render:true});}catch(e){flash(e.message);}};
$('fillComputers').onclick=()=>{
  if(!draft.expectedComputers){flash('Avval Xonalar bosqichida kompyuterlar sonini kiriting.');return;}
  if(draft.expectedComputers<draft.computers.length){flash('Ro‘yxatda rejadan ko‘proq PC bor. Ortiqchasini bittalab tanlab olib tashlang.');return;}
  while(draft.computers.length<draft.expectedComputers)selectedPc=addComputer(draft,selectedRoom).id;changed({render:true});
};
$('pcList').onclick=e=>{const b=e.target.closest('[data-pc]');if(b){selectedPc=b.dataset.pc;renderPcList();renderPcEditor();renderMaps();}};
$('pcEditor').addEventListener('input',e=>{
  const pc=draft.computers.find(c=>c.id===selectedPc),key=e.target.name;if(!pc||!key)return;
  if(key==='roomId')placeInRoom(draft,pc,e.target.value);
  else if(['x','y','number'].includes(key)){if(!e.target.value||!Number.isFinite(Number(e.target.value)))return;pc[key]=Number(e.target.value);}
  else pc[key]=e.target.value;
  renderPcList();changed();
});
$('pcEditor').addEventListener('change',e=>{
  if(e.target.id!=='bindClient'||!e.target.value)return;
  try{if(!contextFresh||Date.now()-lastLiveAt>15000)throw Error('Avval aloqani qayta tekshiring.');const matches=context.liveClients.filter(c=>c.number===Number(e.target.value)&&c.connected);
    if(matches.length!==1)throw Error('Client raqami takrorlangan. Client sozlamalaridagi PC raqamlarini tekshiring.');bindClient(draft,selectedPc,matches[0]);changed({render:true});}
  catch(error){flash(error.message);e.target.value='';}
});
$('pcEditor').onclick=async e=>{const b=e.target.closest('[data-delete-pc]');if(!b||!await confirmAction('PC faqat qoralamadan olib tashlanadi. Amaldagi kompyuter va seans o‘zgarmaydi. Davom etasizmi?'))return;draft.computers=draft.computers.filter(c=>c.id!==b.dataset.deletePc);selectedPc=draft.computers[0]?.id;changed({render:true});};
$('tariffRoom').onchange=e=>{tariffRoom=e.target.value;renderTariffs();};
$('addTariff').onclick=()=>{if(!tariffRoom)return;if(draft.tariffs.length>=256){flash('Tariflar soni chegarasiga yetildi.');return;}draft.tariffs.push({id:newId('rate'),roomId:tariffRoom,name:'Kunlik tarif',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:null,vipAllowed:true});changed({render:true});};
$('tariffList').addEventListener('input',e=>{
  const card=e.target.closest('[data-rate]'),key=e.target.name;if(!card||!key)return;const t=draft.tariffs.find(t=>t.id===card.dataset.rate);
  if(key==='day')t.days_of_week=[...card.querySelectorAll('[name=day]:checked')].map(i=>Number(i.value));
  else if(key==='vipAllowed')t.vipAllowed=e.target.checked;
  else if(key==='price_per_hour')t.price_per_hour=e.target.value===''?null:Number(e.target.value);
  else if(key==='start_time'||key==='end_time'){if(/^\d{4}$/.test(e.target.value))e.target.value=e.target.value.slice(0,2)+':'+e.target.value.slice(2);t[key]=e.target.value;}
  else t[key]=e.target.value;changed();
});
$('tariffList').onclick=async e=>{const b=e.target.closest('[data-delete-rate]');if(!b||!await confirmAction('Bu vaqt oralig‘ini qoralamadan olib tashlaysizmi?'))return;draft.tariffs=draft.tariffs.filter(t=>t.id!==b.dataset.deleteRate);changed({render:true});};
for(const host of [$('roomMapHost'),$('pcMapHost')]){
  host.addEventListener('pointerdown',mapDown);host.addEventListener('pointermove',mapMove);host.addEventListener('pointerup',e=>mapEnd(e));host.addEventListener('pointercancel',e=>mapEnd(e,true));
  host.addEventListener('keydown',e=>{
    const r=e.target.closest('[data-map-room]'),p=e.target.closest('[data-map-pc]');
    if(!r&&!p)return;
    if(['Enter',' '].includes(e.key)){e.preventDefault();if(p){selectedPc=p.dataset.mapPc;renderPcList();renderPcEditor();}else{selectedRoom=r.dataset.mapRoom;renderRoomList();renderRoomEditor();}return;}
    const moves={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};if(!moves[e.key])return;e.preventDefault();const [dx,dy]=moves[e.key];
    if(p&&step==='computers'){const pc=draft.computers.find(c=>c.id===p.dataset.mapPc);pc.x+=dx;pc.y+=dy;pc.roomId=draft.rooms.find(r=>inside(pc,r))?.id||'';selectedPc=pc.id;}
    else if(r&&step==='rooms'){const room=draft.rooms.find(c=>c.id===r.dataset.mapRoom);moveRoom(draft,room.id,room.x+dx,room.y+dy);selectedRoom=room.id;}else return;
    const selector=p?`[data-map-pc="${p.dataset.mapPc}"]`:`[data-map-room="${r.dataset.mapRoom}"]`;changed({render:true});host.querySelector(selector)?.focus();
  });
}
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>navigate(b.dataset.step));
$('nextStep').onclick=()=>navigate(steps[steps.indexOf(step)+1]);$('previousStep').onclick=()=>navigate(steps[steps.indexOf(step)-1]);
$('saveDraft').onclick=()=>void save();$('retrySave').onclick=()=>void save();$('refreshClients').onclick=()=>void refresh();
$('downloadDraft').onclick=()=>{const blob=new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='softech-klub-qoralama.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('rebaseDraft').onclick=async()=>{
  try{
    const latest=await api('/api/setup/context');
    const differences=draftChanges(latest.initialDraft,baseline);
    const summary=differences.slice(0,8).map(c=>`${c.kind}: ${c.label} ${c.name}`).join('\n');
    if(!await confirmAction('Amaldagi klub qayta o‘qildi.\n'+(summary||'Xona va PC ma’lumotlarida farq yo‘q.')+'\nQoralamangiz qoladi. Taqqoslashni shu holatga yangilaysizmi?'))return;
    context=latest;baseline=structuredClone(latest.initialDraft);baseFingerprint=latest.fingerprint;contextFresh=true;lastLiveAt=Date.now();changed({render:true});
  }catch(e){flash(e.message);}
};
async function completeSetup(){
  if(completing)return;
  try{
    if(!pendingCompletion){
      error='';if(!await save())return;
      await refresh();
      if(!await confirmAction(`${draft.rooms.length} ta xona, ${draft.computers.length} ta PC va ${draft.tariffs.length} ta tarif klubga qo‘llanadi. Davom etasizmi?`))return;
      pendingCompletion={requestId:crypto.randomUUID(),revision};
      sessionStorage.setItem(pendingKey,JSON.stringify(pendingCompletion));
    }
    completing=true;renderStatus();
    const result=await api('/api/setup/complete','POST',pendingCompletion);
    if(!result.success||result.receipt?.requestId!==pendingCompletion.requestId)throw Error('Saqlash tasdig‘i olinmadi. Natijani qayta tekshiring.');
    sessionStorage.removeItem(pendingKey);pendingCompletion=null;allowExit=true;location.replace('/');
  }catch(e){
    if([400,409,422].includes(e.status)){pendingCompletion=null;sessionStorage.removeItem(pendingKey);}
    error=e.message;
  }finally{completing=false;renderStatus();}
}
$('completeSetup').onclick=()=>void completeSetup();
$('loadRemote').onclick=async()=>{
  if(!await confirmAction('Serverdagi nusxa ochiladi. Bu oynadagi saqlanmagan o‘zgarishlar almashtiriladi. Kerak bo‘lsa avval qoralamani yuklab oling.'))return;
  try{const state=await api('/api/setup/draft');draft=state.draft;baseFingerprint=state.baseFingerprint;revision=state.revision;readiness=state.readiness;generation=savedGeneration=0;conflict=false;error='';step=draft.step;renderStage();}catch(e){flash(e.message);}
};
$('exitSetup').onclick=async e=>{if(!dirty()&&!saveTask)return;e.preventDefault();if(await save())location.href='/';
  else if(await confirmAction('O‘zgarishlar serverga saqlanmadi. Chiqsangiz shu oynadagi saqlanmagan ma’lumot yo‘qoladi. Kerak bo‘lsa avval qoralamani yuklab oling. Baribir chiqasizmi?')){allowExit=true;location.href='/';}};
window.addEventListener('beforeunload',e=>{if(!allowExit&&(dirty()||saveTask)){e.preventDefault();e.returnValue='';}});
window.addEventListener('blur',()=>{if(drag)mapEnd(null,true);});
window.addEventListener('storage',e=>{if(e.key==='softech_token'&&e.newValue!==token){accessLost=true;flash('Akkaunt o‘zgardi. Kirish oynasiga qayting.');clearInterval(pollTimer);}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
document.addEventListener('focusin',e=>{
  if(!e.target.matches('input,select')||$('setupFooter').hidden)return;
  requestAnimationFrame(()=>{const bottom=e.target.getBoundingClientRect().bottom,edge=$('setupFooter').getBoundingClientRect().top;
    if(bottom>edge-20)window.scrollBy({top:bottom-edge+30,behavior:'instant'});});
});
try{
  const [state,source]=await Promise.all([api('/api/setup/draft'),api('/api/setup/context')]);
  context=source;baseline=structuredClone(source.initialDraft);contextFresh=true;lastLiveAt=Date.now();revision=state.revision;
  baseFingerprint=state.baseFingerprint||(revision===0?source.fingerprint:null);
  try{pendingCompletion=JSON.parse(sessionStorage.getItem(pendingKey)||'null');}catch{sessionStorage.removeItem(pendingKey);}
  const hasExisting=source.initialDraft.rooms.length||source.initialDraft.computers.length;
  draft=state.revision===0&&hasExisting?structuredClone(source.initialDraft):state.draft;
  if(state.revision===0&&hasExisting){generation=1;readiness=null;}else readiness=state.readiness;
  step=draft.step;selectedRoom=tariffRoom=draft.rooms[0]?.id;selectedPc=draft.computers[0]?.id;
  $('clubName').textContent=source.clubName;$('clubLimit').textContent=source.maxComputers?`Litsenziya: ${source.maxComputers} ta PC`:'Litsenziya limiti aniqlanmagan';
  $('loading').hidden=true;$('workspace').hidden=false;$('setupFooter').hidden=false;renderStage();
  // Reading an existing club does not silently write a new draft. The first
  // edit or explicit Save persists the imported working configuration.
  pollTimer=setInterval(()=>void refresh(),10000);
  if(pendingCompletion)void completeSetup();
}catch(e){$('loading').hidden=true;$('loadError').hidden=false;$('loadErrorText').textContent=accessLost?'Sozlash uchun faol litsenziya va menejer akkaunti kerak. Bosh oynada menejer sifatida kiring.':e.message;}
