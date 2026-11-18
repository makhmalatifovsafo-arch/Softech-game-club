// No business APIs, personal-data storage, external analytics or automatic messages.
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const revealElements=[...document.querySelectorAll('.feature,.cinema-heading,.order-copy,.help-strip')];
if('IntersectionObserver' in window&&!motionPreference.matches){
 const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');revealObserver.unobserve(entry.target);}}),{threshold:.08});
 revealElements.forEach(element=>{element.classList.add('reveal-ready');revealObserver.observe(element);});
 motionPreference.addEventListener('change',event=>{if(event.matches){revealObserver.disconnect();revealElements.forEach(element=>element.classList.add('is-visible'));}});
}
const orderForm=document.getElementById('order-form');
const result=document.getElementById('order-result'),draft=document.getElementById('order-draft'),status=document.getElementById('order-status');
orderForm.addEventListener('input',()=>{result.hidden=true;status.textContent='';});
orderForm.addEventListener('submit',event=>{
 event.preventDefault();
 const data=new FormData(orderForm),club=String(data.get('club')).trim(),phone=String(data.get('phone')).trim();
 if(!club||phone.replace(/\D/g,'').length<9){status.textContent='Klub nomini va to‘liq telefon raqamingizni kiriting.';return;}
 draft.value=['Assalomu alaykum! Softech dasturini o‘rnatish bo‘yicha so‘rov.',`Klub: ${club}`,`Shahar: ${String(data.get('city')).trim()}`,`Kompyuterlar: ${data.get('pcs')} ta`,`Telefon: ${phone}`,data.get('note')?`Izoh: ${String(data.get('note')).trim()}`:''].filter(Boolean).join('\n');
 result.hidden=false;status.textContent='So‘rov matni tayyor. Hali yuborilmadi.';document.getElementById('order-result-title').focus();
});
document.getElementById('copy-order').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(draft.value);status.textContent='Nusxalandi. Telegramni ochib, matnni @softech_support chatiga joylang va yuboring.';}
 catch{draft.focus();draft.select();status.textContent='Avtomatik nusxalash imkoni bo‘lmadi. Belgilangan matnni qo‘lda nusxalab, Telegramda yuboring.';}
});
document.getElementById('prepare-order').disabled=false;
