(() => {
  const heading = "Sizga Softech'dan yangi xabar!";
  let notices=[],overlay=null,currentId=null,checking=false,tokenSeen=null;
  const dismissed=new Set();
  const token=()=>localStorage.getItem('softech_token');
  const headers=()=>({Authorization:'Bearer '+token()});
  function clear(){overlay?.remove();overlay=null;currentId=null;}
  function render(){
    const next=notices.find(n=>!dismissed.has(n.id));
    if(!next){clear();return;}
    if(currentId===next.id){overlay.querySelector('[data-count]').textContent=notices.length>1?`${notices.length} ta xabar kutilmoqda`:'';return;}
    clear();currentId=next.id;
    overlay=document.createElement('div');overlay.id='softechAnnouncements';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;background:#020617e8;backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;box-sizing:border-box;font-family:Segoe UI,Arial,sans-serif';
    overlay.innerHTML=`<section role="alertdialog" aria-modal="true" aria-labelledby="softechMessageHeading" aria-describedby="softechMessageBody" style="position:relative;width:min(860px,100%);box-sizing:border-box;max-height:92vh;overflow:auto;padding:clamp(22px,5vw,48px);border:2px solid #38bdf8;border-radius:28px;background:linear-gradient(145deg,#172554,#0f172a);color:#fff;box-shadow:0 20px 90px #0009">
      <button type="button" data-close aria-label="Softech xabarini yopish" style="position:absolute;right:16px;top:10px;background:transparent;color:white;border:0;font-size:36px;line-height:1.3;cursor:pointer">×</button>
      <div aria-hidden="true" style="font-size:58px;margin-bottom:18px">✉️</div>
      <h2 id="softechMessageHeading" style="font-size:clamp(24px,3vw,34px);font-weight:800;line-height:1.25;color:#7dd3fc;padding-right:16px"></h2>
      <h3 data-title style="font-size:24px;font-weight:700;margin:24px 0 12px;overflow-wrap:anywhere"></h3>
      <p id="softechMessageBody" style="font-size:clamp(21px,2.5vw,28px);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere"></p>
      <p data-count style="margin-top:24px;color:#7dd3fc;font-size:14px"></p>
      <p style="margin-top:14px;color:#94a3b8;font-size:14px">Xabarni o‘qigach, yuqoridagi × tugmasini bosing.</p>
      <p data-error role="status" style="margin-top:12px;color:#fda4af"></p>
    </section>`;
    overlay.querySelector('#softechMessageHeading').textContent=heading;
    const title=overlay.querySelector('[data-title]');title.textContent=next.title===heading?'':next.title;title.hidden=!title.textContent;
    overlay.querySelector('#softechMessageBody').textContent=next.message;
    overlay.querySelector('[data-count]').textContent=notices.length>1?`${notices.length} ta xabar kutilmoqda`:'';
    const button=overlay.querySelector('[data-close]');
    button.onclick=async()=>{
      button.disabled=true;const requestToken=token();
      try {
        const response=await fetch('/api/cloud-announcements/'+next.id+'/dismiss',{method:'POST',headers:headers(),signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error('Xabar yopilgani saqlanmadi. Qayta urinib ko‘ring.');
        if(token()!==requestToken)return;
        dismissed.add(next.id);notices=notices.filter(n=>n.id!==next.id);render();refresh();
      }catch(error){if(button.isConnected){overlay.querySelector('[data-error]').textContent=error.message;button.disabled=false;}}
    };
    overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}
      if(event.key==='Tab'){event.preventDefault();button.focus();}
    });
    document.body.append(overlay);button.focus();
  }
  async function refresh(){
    const requestToken=token();
    if(tokenSeen!==requestToken){tokenSeen=requestToken;notices=[];dismissed.clear();clear();}
    if(!requestToken||checking)return;
    checking=true;
    try {
      const response=await fetch('/api/cloud-announcements',{headers:headers(),cache:'no-store',signal:AbortSignal.timeout(5000)});
      if(response.ok){const data=await response.json();if(token()!==requestToken)return;notices=(data.notices||[]).filter(n=>!dismissed.has(n.id));render();}
    }catch{}finally{checking=false;}
  }
  window.SoftechMessages={refresh};
  refresh();setInterval(refresh,10000);
  window.addEventListener('storage',refresh);
})();
