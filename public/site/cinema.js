// Native scroll drives transforms. No wheel interception, timers or animation library.
const cinema=document.getElementById('cinema');
const runway=cinema.querySelector('.cinema-scroll');
const stage=cinema.querySelector('.cinema-stage');
const scenes=[...cinema.querySelectorAll('.cinema-scene')];
const chapterLinks=[...cinema.querySelectorAll('.cinema-rail a:not(.cinema-next)')];
const preference=matchMedia('(prefers-reduced-motion: reduce)');
const chapterPositions=[0,.18,.5,.82];
const transitions=[[.02,.18],[.32,.5],[.64,.82]];
const nextLink=cinema.querySelector('.cinema-next');
const clamp=n=>Math.max(0,Math.min(1,n));
const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
let queued=false,visible=true,enabled=false;
function renderCinema(){
 queued=false;if(!enabled||!visible)return;
 const rect=runway.getBoundingClientRect(),travel=runway.offsetHeight-stage.offsetHeight;
 const p=clamp(-rect.top/Math.max(1,travel));
 let index=0;while(index<3&&p>=chapterPositions[index+1])index++;
 const phase=clamp((p-chapterPositions[index])/((chapterPositions[index+1]??1)-chapterPositions[index]));
 const blend=index===3?0:smooth((p-transitions[index][0])/(transitions[index][1]-transitions[index][0]));
 const active=blend>.5?Math.min(3,index+1):index;
 cinema.dataset.scene=String(active);
 scenes.forEach((scene,i)=>{
  const weight=i===index?1-blend:i===index+1?blend:0;
  const signed=i===index?-blend:1-blend;
  scene.style.opacity=String(weight);
  scene.style.transform=`translate3d(${signed*18}px,${signed*75}px,0)`;
  scene.classList.toggle('is-active',i===active);
  scene.inert=i!==active;scene.setAttribute('aria-hidden',String(i!==active));
  const mobile=innerWidth<=800;
  const drift=clamp(phase/.55);
  scene.querySelector('.screen-frame').style.transform=`perspective(1400px) rotateY(${mobile?0:(1-drift)*-7}deg) rotateX(${mobile?0:(1-drift)*3}deg) scale(${.93+drift*.07})`;
  scene.querySelector('.scene-copy').style.transform=`translate3d(0,${signed*-22}px,0)`;
 });
 chapterLinks.forEach((link,i)=>{if(i===active)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');});
 nextLink.href=active<3?chapterLinks[active+1].getAttribute('href'):'#mobile';
 nextLink.textContent=active<3?`${active+1} / 4 · Davomi: ${['Seans','Bar','Hisobot'][active]} ↓`:'4 / 4 · Keyingi bo‘lim: Mobil boshqaruv ↓';
 cinema.querySelector('.cinema-progress i').style.transform=`scaleX(${p})`;
 cinema.querySelector('.cinema-backword').style.transform=`translate3d(${-p*130}px,0,0)`;
}
function queueCinema(){if(enabled&&visible&&!queued){queued=true;requestAnimationFrame(renderCinema);}}
function configure(){
 enabled=!preference.matches&&innerHeight>=(innerWidth<=800?700:600)&&'IntersectionObserver' in window;
 cinema.classList.toggle('cinema-motion',enabled);
 if(enabled)queueCinema();else{
  scenes.forEach(scene=>{scene.style.opacity='';scene.style.transform='';scene.inert=false;scene.removeAttribute('aria-hidden');scene.querySelector('.screen-frame').style.transform='';scene.querySelector('.scene-copy').style.transform='';});
 }
}
function navigateChapter(event,index){
 if(!enabled)return;event.preventDefault();
 const y=scrollY+runway.getBoundingClientRect().top+(runway.offsetHeight-stage.offsetHeight)*(chapterPositions[index]+.005);
 // Direct navigation jumps to a chapter; normal scrolling supplies the animation.
 scrollTo({top:y,behavior:'instant'});visible=true;renderCinema();
 scenes[index].querySelector('h3').focus({preventScroll:true});
}
chapterLinks.forEach((link,index)=>link.addEventListener('click',event=>navigateChapter(event,index)));
nextLink.addEventListener('click',event=>{const index=chapterLinks.findIndex(link=>link.getAttribute('href')===nextLink.getAttribute('href'));if(index>=0)navigateChapter(event,index);});
if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;queueCinema();},{rootMargin:'200px'}).observe(runway);
addEventListener('scroll',queueCinema,{passive:true});addEventListener('resize',configure);preference.addEventListener('change',configure);configure();
