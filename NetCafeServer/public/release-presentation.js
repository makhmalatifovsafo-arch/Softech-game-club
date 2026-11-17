import {releaseNotes} from './release-notes.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let active=null,index=0,role=null,version=null,audience='device';
const key=()=>`softech-release-seen:${audience}:${role}:${version}`;
async function currentVersion(){
 const response=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error();const data=await response.json();
 return /^\d+\.\d+\.\d+$/.test(data.version||'')?data.version:null;
}
function slides(){return (active?.slides||[]).filter(item=>item.roles.includes(role));}
function render(){
 let root=document.getElementById('softechReleasePresentation');
 if(!root){root=document.createElement('div');root.id='softechReleasePresentation';root.className='release-presentation';document.body.append(root);}
 const items=slides(),slide=items[index];if(!slide){close();return;}
 root.innerHTML=`<section class="release-stage" role="dialog" aria-modal="true" aria-labelledby="releaseTitle">
  <div class="release-glow"></div>
  <header><span class="release-version">YANGI VERSIYA · v${esc(version)}</span><button type="button" data-release-close aria-label="Yopish">×</button></header>
  <main><div class="release-icon">${esc(slide.icon)}</div><p class="release-kicker">${esc(active.intro)}</p><h1 id="releaseTitle">${esc(slide.title)}</h1><p class="release-text">${esc(slide.text)}</p><div class="release-action">${esc(slide.action)}</div></main>
  <footer><div class="release-dots">${items.map((_,i)=>`<span class="${i===index?'active':''}"></span>`).join('')}</div><div class="release-buttons">${index?'<button type="button" data-release-prev>Orqaga</button>':'<button type="button" data-release-close>O‘tkazib yuborish</button>'}<button type="button" class="primary" data-release-next>${index===items.length-1?'Ishni boshlash':'Keyingi'}</button></div></footer>
 </section>`;
 root.querySelectorAll('[data-release-close]').forEach(b=>b.onclick=close);
 root.querySelector('[data-release-prev]')?.addEventListener('click',()=>{index--;render();});
 root.querySelector('[data-release-next]').onclick=()=>{if(index<items.length-1){index++;render();}else close();};
 root.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='ArrowRight')root.querySelector('[data-release-next]')?.click();if(e.key==='ArrowLeft')root.querySelector('[data-release-prev]')?.click();};
 root.tabIndex=-1;root.focus();
}
function close(){try{localStorage.setItem(key(),new Date().toISOString());}catch{}document.getElementById('softechReleasePresentation')?.remove();}
async function open(userRole,{force=false,identity='device'}={}){
 if(window.softechSetupReady===false||window.SoftechOnboarding?.isActive())return;
 audience=String(identity||'device').replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,100)||'device';
 role=userRole==='manager'?'club_owner':userRole;
 if(!['club_owner','administrator'].includes(role))return;
 try{version=await currentVersion();if(window.softechSetupReady===false||window.SoftechOnboarding?.isActive())return;active=releaseNotes[version];if(!active)return;if(!force&&localStorage.getItem(key()))return;index=0;render();}catch{}
}
window.SoftechReleasePresentation={showIfNeeded:(userRole,identity)=>open(userRole,{identity}),open:(userRole,identity)=>open(userRole,{force:true,identity})};
window.addEventListener('softech:authenticated',event=>open(event.detail?.role,{identity:event.detail?.identity}));
if(window.softechReleaseAudience)open(window.softechReleaseAudience.role,{identity:window.softechReleaseAudience.identity});
