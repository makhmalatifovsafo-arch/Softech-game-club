let refreshTimer;
window.closeManagerAccount = function(){clearInterval(refreshTimer);document.getElementById('managerAccountModalContainer')?.remove();};
window.openManagerAccount = async function(clubId,accountType='manager'){
  if(!['manager','administrator'].includes(accountType))return;
  const label=accountType==='manager'?'Menejer':'Administrator';
  const description=accountType==='manager'?'Bu login-parolni faqat klub egasi yoki menejeriga bering.':'Administrator shu akkaunt bilan seans va bar savdosini yuritadi. Menejer paroli unga kerak emas.';
  clubId=Number(clubId);if(!Number.isSafeInteger(clubId)||clubId<1)return;
  window.closeManagerAccount();
  const modal=document.createElement('div');modal.id='managerAccountModalContainer';
  modal.style.cssText='position:fixed;inset:0;z-index:100;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML=`<form style="width:min(100%,440px);background:#141418;border:1px solid #3f3f46;border-radius:20px;padding:24px;color:white;max-height:90dvh;overflow:auto">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><h2 style="font-size:18px;font-weight:700">${label} akkaunti · Klub #${clubId}</h2><button type="button" aria-label="Yopish" onclick="closeManagerAccount()" style="min-width:44px">×</button></div>
    <p style="font-size:12px;color:#a1a1aa;margin:12px 0">${description} Internet bo‘lganda klub serveriga yetkaziladi.</p>
    <a href="/mobile/?club=${clubId}" target="_blank" rel="noopener" style="display:block;margin:12px 0;color:#78e8c3">Klub #${clubId} mobil dasturini ochish ↗</a>
    <label style="display:block;margin:16px 0">Login<input name="username" required minlength="3" maxlength="40" pattern="([a-zA-Z0-9_.]|-){3,40}" autocomplete="off" style="display:block;width:100%;margin-top:6px;padding:12px;border:1px solid #3f3f46;border-radius:10px;background:#09090b;font-size:16px"></label>
    <label style="display:block;margin:16px 0">Yangi parol<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" style="display:block;width:100%;margin-top:6px;padding:12px;border:1px solid #3f3f46;border-radius:10px;background:#09090b;font-size:16px"></label>
    <label style="display:block;margin:16px 0">Parolni takrorlang<input name="confirmPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password" style="display:block;width:100%;margin-top:6px;padding:12px;border:1px solid #3f3f46;border-radius:10px;background:#09090b;font-size:16px"></label>
    <p role="status" style="font-size:13px;line-height:1.5;min-height:40px;margin:12px 0"></p>
    <button type="submit" style="width:100%;padding:12px;border-radius:12px;background:#38bdf8;color:#09090b;font-weight:700">${label} akkauntini saqlash</button>
  </form>`;
  document.body.appendChild(modal);const form=modal.querySelector('form'),status=modal.querySelector('[role=status]'),submit=form.querySelector('[type=submit]');
  const request=async(method,body)=>{const response=await fetch('/api/clubs/'+clubId+'/'+accountType,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('softech_access_token')},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error || 'Saqlab bo‘lmadi.');return data[accountType];};
  const show=manager=>{status.textContent=!manager.configured?label+' hali belgilanmagan.':manager.applied?'Klub serverida qo‘llandi. '+label+' yangi login-parol bilan kira oladi.':'Saqlangan. Klub serveriga yetkazilishi kutilmoqda.';status.style.color='#a1a1aa';};
  const poll=()=>{clearInterval(refreshTimer);refreshTimer=setInterval(async()=>{try{const m=await request('GET');if(!modal.isConnected)return;show(m);if(m.applied)clearInterval(refreshTimer);}catch{}},5000);};
  try{const manager=await request('GET');if(!modal.isConnected)return;form.elements.username.value=manager.username || accountType;show(manager);if(manager.configured&&!manager.applied)poll();}catch(error){status.textContent=error.message;}
  form.onsubmit=async event=>{
    event.preventDefault();clearInterval(refreshTimer);
    if(form.elements.password.value!==form.elements.confirmPassword.value){status.textContent='Parollar mos emas.';return;}
    submit.disabled=true;
    try{const manager=await request('PUT',{username:form.elements.username.value.trim(),password:form.elements.password.value});if(!modal.isConnected)return;show(manager);form.elements.password.value='';form.elements.confirmPassword.value='';poll();}
    catch(error){status.textContent=error.message;status.style.color='#fda4af';}finally{submit.disabled=false;}
  };
};

window.openAdministratorAccount = clubId => window.openManagerAccount(clubId,'administrator');
