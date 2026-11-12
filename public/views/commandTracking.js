(() => {
  const watches=new Map();
  const storageKey='softech-remote-commands';
  const save=()=>sessionStorage.setItem(storageKey,JSON.stringify([...watches.values()].map(w=>({clubId:w.clubId,id:w.id}))));
  window.trackRemoteCommand=(clubId,id)=>{
    if(!Number.isSafeInteger(Number(id))||watches.has(String(id)))return;
    let container=document.getElementById('remoteCommandProgress');
    if(!container){container=document.createElement('div');container.id='remoteCommandProgress';container.style.cssText='position:fixed;bottom:20px;right:16px;z-index:99999;width:min(360px,90vw);display:grid;gap:8px';document.body.append(container);}
    const card=document.createElement('section');card.setAttribute('role','status');card.style.cssText='background:#0f172a;border:1px solid #38bdf8;border-radius:16px;padding:16px;color:white;box-shadow:0 8px 30px #0008';
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Buyruq holatini yopish');close.style.cssText='float:right;font-size:24px;background:none;border:0;color:white;cursor:pointer';
    const title=document.createElement('strong');title.textContent=`Klub #${clubId} · Buyruq #${id}`;
    const message=document.createElement('p');message.textContent='Navbatda. Server bilan aloqa kutilmoqda.';
    card.append(close,title,message);container.append(card);
    const watch={clubId:Number(clubId),id:Number(id),timer:null};watches.set(String(id),watch);save();
    close.onclick=()=>{clearTimeout(watch.timer);watches.delete(String(id));card.remove();save();};
    const poll=async()=>{
      if(!watches.has(String(id)))return;
      const token=localStorage.getItem('softech_access_token');
      if(!token){close.click();return;}
      let terminal=false;
      try{
        const response=await fetch(`/api/telemetry/commands/history/${clubId}`,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw Error('Buyruq holatini olishda aloqa xatosi. Qayta tekshiriladi.');
        const data=await response.json(),row=data.history?.find(r=>Number(r.id)===Number(id));
        if(row){
          const payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
          const labels={PENDING:'Kutilmoqda',EXECUTED:'Bajarildi',FAILED:'Xatolik',CANCELLED:'Bekor qilindi'};
          message.textContent=`${labels[row.status]||row.status}: ${payload?.result?.message || 'Server tasdig‘i kutilmoqda.'}`;
          terminal=['EXECUTED','FAILED','CANCELLED'].includes(row.status);
          card.style.borderColor=row.status==='FAILED'?'#f87171':row.status==='EXECUTED'?'#34d399':'#38bdf8';
        }
      }catch(error){message.textContent=error.message;}
      if(terminal){watches.delete(String(id));save();}
      else if(watches.has(String(id)))watch.timer=setTimeout(poll,5000);
    };
    poll();
  };
  try{for(const w of JSON.parse(sessionStorage.getItem(storageKey)||'[]'))window.trackRemoteCommand(w.clubId,w.id);}catch{}
})();
