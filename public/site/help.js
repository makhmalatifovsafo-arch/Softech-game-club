const search=document.getElementById('help-search');
if(search){
 const cards=[...document.querySelectorAll('[data-search]')];
 const normalize=value=>value.toLocaleLowerCase('uz').normalize('NFKC').replace(/[‘’ʻʼ'`]/g,'').replace(/\s+/g,' ').trim();
 search.addEventListener('input',()=>{
  const words=normalize(search.value).split(' ').filter(Boolean);let count=0;
  cards.forEach(card=>{const matches=words.every(word=>normalize(card.dataset.search).includes(word));card.hidden=!matches;if(matches)count++;});
  document.getElementById('help-count').textContent=`${count} ta qo‘llanma`;
  document.getElementById('help-empty').hidden=count!==0;
 });
}
