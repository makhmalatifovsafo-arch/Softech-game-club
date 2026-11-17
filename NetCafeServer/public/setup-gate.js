// Loaded before authentication runs. A failed status request does not expose
// the cashier underneath an unverified first-run state.
(() => {
  window.softechSetupReady=false;
  let root,timer,epoch=0;
  function hide(){root?.remove();root=null;clearTimeout(timer);}
  function show(message,retry){
    if(!root){root=document.createElement('div');root.id='setupGate';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
      root.style.cssText='position:fixed;inset:0;z-index:99990;background:#090d0a;color:#eaf2e0;display:grid;place-items:center;padding:24px;font-family:Segoe UI,sans-serif';
      root.innerHTML='<section style="max-width:560px;text-align:center"><img src="/brand-icon.svg" alt="Softech" width="64" height="64"><h1 style="font-size:30px">Klubni tayyorlash</h1><p role="status" style="line-height:1.7;color:#b7c6ad"></p><button type="button" style="padding:14px;background:#c8ff31;color:#111;border:0;border-radius:8px;margin:12px">Qayta tekshirish</button><button type="button" style="padding:14px;background:#233020;color:#fff;border:0;border-radius:8px">Hisobdan chiqish</button><p><a href="https://t.me/softech_support" target="_blank" rel="noopener noreferrer" style="color:#c8ff31">Yordam: @softech_support</a></p></section>';
      document.body.append(root);
      root.onkeydown=event=>{
        if(event.key!=='Tab')return;
        const items=[...root.querySelectorAll('button,a[href]')],first=items[0],last=items.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      };
      root.querySelector('button').focus();
      root.querySelectorAll('button')[1].onclick=()=>{epoch++;hide();localStorage.removeItem('softech_token');location.reload();};}
    root.querySelector('[role=status]').textContent=message;root.querySelector('button').onclick=retry;
  }
  async function check(token,user){
    const id=++epoch;clearTimeout(timer);window.softechSetupReady=false;
    if(!['club_owner','administrator'].includes(user?.role)){hide();window.softechSetupReady=true;return true;}
    const retry=()=>check(token,user).then(ready=>{if(ready)location.reload();});
    show('Klubning tayyorligi tekshirilmoqda…',retry);
    try{
      const response=await fetch('/api/setup/status',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error(response.status===403?'Litsenziya yoki akkaunt holatini tekshiring.':'Server bilan aloqa tiklanishi kutilmoqda.');
      const state=await response.json();if(id!==epoch||localStorage.getItem('softech_token')!==token)return false;
      if(state.required===false){hide();window.softechSetupStatus=state;window.softechSetupReady=true;return true;}
      if(state.required!==true)throw Error('Klub tayyorligini aniqlab bo‘lmadi.');
      if(user.role==='club_owner'){location.replace('/club-setup.html');return false;}
      show('Menejer klubni sozlamoqda. Xonalar, tariflar va clientlar tayyor bo‘lgach kassa avtomatik ochiladi.',retry);
    }catch(error){if(id!==epoch)return false;show(error.message,retry);}
    timer=setTimeout(retry,4000);return false;
  }
  window.SoftechSetupGate={check};
  window.addEventListener('storage',event=>{if(event.key==='softech_token'){epoch++;hide();window.softechSetupReady=false;location.reload();}});
})();
