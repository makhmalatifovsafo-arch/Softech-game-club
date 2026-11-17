// A read-only lesson. No business API, real form click, session or sale is used.
(() => {
  const $=id=>document.getElementById(id);
  const memory=new Map();
  const read=key=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):memory.get(key)||null;}catch{return memory.get(key)||null;}};
  const write=(key,value)=>{memory.set(key,value);try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let user=null,setup=null,root=null,panel=null,marker=null,steps=[],index=0,key='',token='',timer,watch,previousFocus,signature='';
  let mode='time',cola=false,checkout='zero',selected=false,activating=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const blocked=()=>setup?.required===true||window.softechSetupReady===false||['loginModal','softechLicenseLockOverlay','setupGate'].some(id=>visible($(id)));
  const role=()=>user?.role==='manager'?'club_owner':user?.role;
  const manager=()=>role()==='club_owner';
  function lesson(){
    return [
      {id:'welcome',title:'Boshqaruv sizning qo‘lingizda.',text:'Bir necha oddiy qadamda seans, bar va yakuniy hisob bilan tanishing. Bu xavfsiz mashq: haqiqiy pul yoki seans o‘zgarmaydi.'},
      {id:'pc',title:'Avval kompyuterni tanlang.',text:'Seans ochish uchun bo‘sh PC’ni tanlang. Ochilgan amallar ichidan “Seans ochish”ni bosasiz. Hozir belgilangan joyda namuna bilan mashq qiling.',target:'#pcGrid > [data-pc-id], #floorPlanDesksContainer .floor-desk[data-pc-id], #pcTableBody tr[data-pc-id]'},
      {id:'session',title:'Mijozga mos seans.',text:'Vaqt, summa, tugash vaqti yoki VIP Postpaid. Quyidagi turlarni bosib farqini ko‘ring. Haqiqiy ochishda server hisoblagan narxni tekshirasiz.',target:'#viewBtnMap, #viewBtnTable, #viewBtnGrid'},
      {id:'bar',title:'Cola ham shu PC hisobiga.',text:'Faol PC amallaridan bar mahsuloti va miqdorini tanlang. PC hisobiga yozilgan, hali to‘lanmagan mahsulot seans yakunida hisobga qo‘shiladi.',target:'.sidebar-nav-btn[data-view="bar"]'},
      {id:'checkout',title:'Olinadimi yoki qaytimmi?',text:'Seansni yopishda asosiy summaga va uning yonidagi yozuvga qarang. O‘yin, to‘lanmagan bar va oldindan to‘lov yakuniy hisobda birga tekshiriladi.',target:'.sidebar-nav-btn[data-view="workstations"]'},
      ...(manager()?[
        {id:'tariffs',title:'Har xonaning o‘z narxi.',text:'Sozlama → Dinamik tariflar. Xonani, kunlarni va vaqt oralig‘ini tanlang. Masalan, oddiy zal — 7 000, VIP xona — 10 000 so‘m/soat. Yangi seans oldidan narxni tekshiring.',target:'[onclick="openSettingsModal()"]'},
        {id:'reports',title:'Natijalar bir joyda.',text:'Otchyotda sanani tanlab tushumlarni ko‘ring. Statistika bandlikni tushuntiradi; Amallar tarixi esa kim nima qilganini ko‘rsatadi.',target:'.sidebar-nav-btn[data-view="reports"]'}
      ]:[]),
      {id:'finish',title:'Birinchi seansga tayyorsiz.',text:'Endi haqiqiy PC’ni tanlab ish boshlashingiz mumkin. Kerak bo‘lsa Sozlama → Qisqa tanishtirish orqali shu mashqni yana oching. “?” belgisi yonidagi funksiyani tushuntiradi.'}
    ];
  }
  const sampleLabel='<p class="ob-demo-label">NAMUNA · HAQIQIY AMAL BAJARILMAYDI</p>';
  function preview(id){
    if(id==='welcome')return '<div class="ob-icon" aria-hidden="true">◇</div><div class="ob-check-row"><span>01 / TANLANG</span><b>Kompyuter</b></div><div class="ob-check-row"><span>02 / BOSHLANG</span><b>Seans va bar</b></div><div class="ob-check-row"><span>03 / TEKSHIRING</span><b>Yakuniy hisob</b></div>';
    if(id==='pc')return sampleLabel+`<button type="button" class="ob-primary" data-action="select-pc">${selected?'✓ PC tanlandi':'▣ PC-01 ni tanlash'}</button><p>${selected?'Keyin “Seans ochish” tugmasini tanlaysiz.':'Bu namuna PC. Tanlasangiz haqiqiy kompyuter ochilmaydi.'}</p>${selected?'<button type="button" data-action="next">Seans ochish →</button>':''}`;
    if(id==='session'){
      const modes={time:['Vaqt','1 soat yoki 60 daqiqa','Aniq davomiylikni soat yoki daqiqada kiritasiz.'],amount:['Summa','7 000 so‘m → 1 soat','Namuna tarifi: 7 000 so‘m/soat. Mijoz bergan summaga mos vaqt ajratiladi.'],until:['Tugash vaqti','12:00 → 13:00','Seans qachon tugashini tanlaysiz. Tasdiqlashdan oldin davomiylik va narxga qarang.'],vip:['VIP Postpaid','Avval o‘yin, keyin to‘lov','Vaqtga qarab hisob ortib boradi. Seans yopilganda ishlatilgan vaqt va to‘lanmagan bar summasi olinadi.']};
      return sampleLabel+`<div class="ob-choices">${Object.entries(modes).map(([id,m])=>`<button type="button" data-mode="${id}" aria-pressed="${id===mode}">${m[0]}</button>`).join('')}</div><strong>${modes[mode][1]}</strong><p>${modes[mode][2]}</p>`;
    }
    if(id==='bar')return sampleLabel+`<div class="ob-check-row"><span>PC-01 · Cola × 1</span><b>5 000 so‘m</b></div><button type="button" data-action="cola" style="margin-top:14px" aria-pressed="${cola}">${cola?'✓ Namunaga qo‘shildi · bekor qilish':'＋ Namunaga Cola qo‘shish'}</button><strong>${cola?'Bar: 5 000 so‘m':'Bar: 0 so‘m'}</strong><small>Darhol naqd sotuv va PC hisobiga qo‘shish — alohida amallar.</small>`;
    if(id==='checkout'){
      const cases={zero:[5000,5000,'0 so‘m','Qo‘shimcha to‘lov ham, qaytim ham yo‘q.'],due:[8333,5000,'3 333 so‘m','Mijozdan olinadi.'],refund:[5000,0,'5 000 so‘m','Mijozga qaytim beriladi.']},v=cases[checkout];
      return sampleLabel+`<div class="ob-choices">${[['zero','Teng hisob'],['due','Qo‘shimcha to‘lov'],['refund','Qaytim']].map(([id,label])=>`<button type="button" data-checkout="${id}" aria-pressed="${checkout===id}">${label}</button>`).join('')}</div><div class="ob-check-row"><span>Oldindan to‘langan</span><b>10 000 so‘m</b></div><div class="ob-check-row"><span>Ishlatilgan o‘yin</span><b>${v[0].toLocaleString('ru-RU')} so‘m</b></div><div class="ob-check-row"><span>To‘lanmagan bar</span><b>${v[1].toLocaleString('ru-RU')} so‘m</b></div><div class="ob-check-row total"><span>Yakun</span><b>${v[2]}</b></div><p>${v[3]}</p><small>Bu misol. Haqiqiy summa serverdagi seans va sotuvlardan olinadi.</small>`;
    }
    if(id==='tariffs')return '<div class="ob-check-row"><span>1. Xona</span><b>Oddiy zal</b></div><div class="ob-check-row"><span>2. Kun va vaqt</span><b>Har kuni · 24 soat</b></div><div class="ob-check-row"><span>3. Soatlik narx</span><b>7 000 so‘m</b></div><small>Namuna. Ishlayotgan seansning hisobini bu mashq o‘zgartirmaydi.</small>';
    if(id==='reports')return '<div class="ob-check-row"><span>Otchyot</span><b>Tushum va to‘lovlar</b></div><div class="ob-check-row"><span>Statistika</span><b>Bandlik va tahlil</b></div><div class="ob-check-row"><span>Amallar tarixi</span><b>Amallar tafsiloti</b></div>';
    return '<div class="ob-icon" aria-hidden="true">✓</div><strong>Tanishtirish yakunlandi.</strong><p>Yaxshi ish tilaymiz!</p>';
  }
  function target(){
    const selector=steps[index]?.target;if(!selector)return null;
    // Never move the cashier's viewport or close an edited modal to show a lesson.
    if(visible($('settingsModal')))return null;
    return [...document.querySelectorAll(selector)].find(el=>{
      if(!visible(el))return false;const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight;
    });
  }
  function position(){
    if(!panel||activating)return;
    const el=target(),b=el?.getBoundingClientRect();marker.hidden=!b;
    if(b){Object.assign(marker.style,{left:(b.left-4)+'px',top:(b.top-4)+'px',width:(b.width+8)+'px',height:(b.height+8)+'px'});}
    const box=panel.getBoundingClientRect(),margin=16;
    let x=(innerWidth-box.width)/2,y=(innerHeight-box.height)/2;
    if(b&&innerWidth>760){
      if(b.right+box.width+32<innerWidth)x=b.right+20;
      else if(b.left-box.width-20>0)x=b.left-box.width-20;
      else if(b.bottom+box.height+32<innerHeight)y=b.bottom+20;
      y=Math.max(margin,Math.min(y,innerHeight-box.height-margin));
    }
    panel.style.left=Math.max(12,x)+'px';panel.style.top=Math.max(12,y)+'px';
  }
  function progress(status='viewing'){write(key,{status,index,at:new Date().toISOString()});}
  function render(){
    if(!root)return;
    activating=false;clearTimeout(timer);const step=steps[index];progress();
    root.innerHTML=`<div class="ob-veil"></div><button type="button" class="ob-target" ${step.id==='pc'?'data-action="select-pc"':''} tabindex="-1" aria-label="PC’ni namuna sifatida tanlash" aria-hidden="${step.id!=='pc'}"><span>↓ NAMUNA SIFATIDA TANLANG</span></button><section class="ob-panel" role="dialog" aria-modal="true" aria-labelledby="ob-title" aria-describedby="ob-copy"><div class="ob-top"><p class="ob-eyebrow">SOFTECH / ${String(index+1).padStart(2,'0')} — ${String(steps.length).padStart(2,'0')}</p><button type="button" class="ob-close" data-action="later" aria-label="Tanishtirishni yopish">×</button></div><h1 id="ob-title">${step.title}</h1><p id="ob-copy" class="ob-copy">${step.text}</p><div class="ob-demo">${preview(step.id)}</div><div class="ob-progress" aria-label="${index+1} / ${steps.length} qadam">${steps.map((_,i)=>`<span class="${i<=index?'done':''}"></span>`).join('')}</div><div class="ob-footer"><button type="button" data-action="later">Keyinroq</button><div>${index?'<button type="button" data-action="back">← Orqaga</button>':''}<button type="button" class="ob-primary" data-action="next">${index===steps.length-1?'Ishni boshlash':index===0?'Boshladik →':'Keyingi →'}</button></div></div><p class="ob-hint">${step.target&&!target()?'Bu joy hozir ekranda ko‘rinmayapti. Namuna orqali davom etishingiz mumkin.':'Esc — yopish · Sozlamadan qayta ochish mumkin.'}</p></section>`;
    panel=root.querySelector('.ob-panel');marker=root.querySelector('.ob-target');position();panel.querySelector('[data-action=next]').focus({preventScroll:true});
  }
  function close(status){
    if(status&&key)progress(status);
    clearTimeout(timer);clearInterval(watch);activating=false;root?.remove();root=panel=marker=null;
    document.removeEventListener('keydown',keys,true);
    if(!blocked()&&visible(previousFocus))previousFocus.focus({preventScroll:true});
  }
  function action(name){
    if(name==='later'){close('paused');return;}
    if(activating){render();return;}
    if(name==='next'){if(index===steps.length-1){close('done');return;}index++;}
    if(name==='back')index=Math.max(0,index-1);
    if(name==='select-pc')selected=true;
    if(name==='cola')cola=!cola;
    render();
  }
  function keys(event){
    if(!root)return;
    // Capture before the cashier's shortcuts and never let practice trigger them.
    event.stopImmediatePropagation();
    if(event.key==='Escape'){event.preventDefault();close('paused');return;}
    if(!root.contains(document.activeElement)){
      event.preventDefault();root.querySelector('.ob-panel button, .ob-skip')?.focus({preventScroll:true});return;
    }
    if(event.key==='Tab'){
      const buttons=[...root.querySelectorAll('button')].filter(el=>visible(el)&&el.tabIndex>=0);
      const first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){event.preventDefault();first?.focus();}
    }
  }
  function start(manual=false){
    if(root||!user||!['club_owner','administrator'].includes(role())||blocked()||visible($('softechReleasePresentation')))return false;
    steps=lesson();const saved=read(key);index=saved?.status!=='done'&&Number.isInteger(saved?.index)?Math.min(Math.max(saved.index,0),steps.length-1):0;
    previousFocus=document.activeElement;mode='time';cola=false;checkout='zero';selected=false;
    root=document.createElement('div');root.id='softechOnboarding';document.body.append(root);
    if(getComputedStyle(root).position!=='fixed'){root.remove();root=null;return false;}
    root.addEventListener('pointerdown',e=>e.stopPropagation());
    root.addEventListener('wheel',e=>{if(!panel?.contains(e.target))e.preventDefault();},{passive:false});
    root.addEventListener('touchmove',e=>{if(!panel?.contains(e.target))e.preventDefault();},{passive:false});
    root.onclick=event=>{
      event.stopPropagation();const b=event.target.closest('button');if(!b)return;
      if(b.dataset.mode){mode=b.dataset.mode;render();return;}
      if(b.dataset.checkout){checkout=b.dataset.checkout;render();return;}
      action(b.dataset.action);
    };
    document.addEventListener('keydown',keys,true);
    watch=setInterval(()=>{if(localStorage.getItem('softech_token')!==token||blocked())close();else position();},250);
    const activationKey='softech-activation:'+String(user.clubId??user.club_id??1)+':'+String(setup?.completedAt);
    if(!manual&&setup?.installationKind==='NEW'&&setup.completedAt&&!read(activationKey)){
      write(activationKey,true);activating=true;
      root.innerHTML=`<section class="ob-activation" role="dialog" aria-modal="true" aria-labelledby="ob-activation-title"><div class="ob-grid"></div><div class="ob-ring"></div><button type="button" class="ob-skip" data-action="continue">Davom etish →</button><div class="ob-activation-content"><img src="/brand-icon.svg" alt="Softech"><p class="ob-eyebrow">SOZLASH YAKUNLANDI</p><h1 id="ob-activation-title">KLUBINGIZ TAYYOR.</h1><p>${esc(user.clubName||'Softech')} · Yangi o‘yinlar. Yangi imkoniyatlar.</p><div class="ob-activation-track"><span></span></div><p>Xonalar, clientlar va tariflar saqlandi.</p></div></section>`;
      root.querySelector('button').focus();timer=setTimeout(render,reduced.matches?100:1700);
    }else render();
    return true;
  }
  function onAuthenticated(nextUser,status){
    const nextToken=localStorage.getItem('softech_token'),nextSignature=JSON.stringify([nextUser?.id,nextUser?.role,nextToken,status?.completedAt]);
    if(nextSignature===signature)return;
    close();signature=nextSignature;user=nextUser;setup=status;token=nextToken;
    key='softech-tour:v1:'+String(user?.clubId??user?.club_id??1)+':'+String(user?.id??user?.username)+':'+role()+':'+String(setup?.completedAt||'existing');
    if(setup?.required===false&&setup.installationKind==='NEW'&&setup.completedAt&&!['done','paused'].includes(read(key)?.status))start();
  }
  window.SoftechOnboarding={onAuthenticated,open:()=>start(true),isActive:()=>!!root,suspend:()=>{close();user=null;signature='';}};
  window.addEventListener('resize',position);
  window.addEventListener('storage',event=>{if(event.key==='softech_token')window.SoftechOnboarding.suspend();});
})();
