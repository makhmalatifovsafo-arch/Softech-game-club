const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={NONE:'Xato qayd etilmagan',CONFIG_INVALID:'Sozlama fayli buzilgan',DATABASE_INVALID:'Baza faylini tekshirish kerak',DATABASE_MISSING:'Asosiy baza topilmadi',PORT_BUSY:'5000-port boshqa dastur bilan band',DISK_FULL:'Diskda joy qolmagan',ACCESS_DENIED:'Faylga kirish ruxsati yo‘q',RUNTIME_MISSING:'Node.js runtime topilmadi',SCRIPT_MISSING:'Server fayli topilmadi',START_TIMEOUT:'Server belgilangan vaqtda tayyor bo‘lmadi',PROCESS_EXIT:'Server jarayoni kutilmaganda yopilgan',UNKNOWN:'Sabab hali aniqlanmagan'};
const date=value=>{
  if(typeof value==='string'&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(value))value=value.replace(' ','T')+'Z';
  return Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('uz-UZ',{hourCycle:'h23'}):'Ma’lumot yo‘q';
};
Object.assign(labels,{SERVER_ALREADY_RUNNING:'Shu baza bilan boshqa server jarayoni ishlamoqda',SERVER_INSTANCE_LOCK_FAILED:'Server jarayoni himoyasini ochib bo‘lmadi',UPDATE_RECOVERY_REQUIRED:'Uzilgan yangilanishni tiklash kerak — klub kompyuterida launcherni oching'});
export function renderServerDiagnostics(diagnostic,loadState='ready',now=Date.now(),backendLastSeen=null){
  if(loadState==='loading'&&!diagnostic)return '<section class="glass-card rounded-3xl p-5 text-zinc-400">Server diagnostikasi yuklanmoqda...</section>';
  if(!diagnostic)return `<section class="glass-card rounded-3xl p-5 border border-zinc-800"><h3 class="font-bold text-white">Server diagnostikasi</h3><p class="text-sm text-zinc-400 mt-2">${loadState==='unavailable'?'Diagnostikani yuklab bo‘lmadi. Aloqa va diagnostika migratsiyasini tekshiring.':'Launcher diagnostikasi hali kelmagan. Yangilangan launcher ochiq va internetga ulangan bo‘lishi kerak. Eski versiyalar bu ma’lumotni yubormaydi.'}</p></section>`;
  const r=diagnostic.report||{},age=now-Date.parse(diagnostic.receivedAt),observedAge=now-Date.parse(r.observedAt);
  const fresh=loadState!=='unavailable'&&Number.isFinite(age)&&age>=0&&age<=180000&&Number.isFinite(observedAge)&&observedAge>=-120000&&observedAge<=180000;
  const backend={RUNNING:'Server javob bermoqda',EMERGENCY:'Favqulodda rejim: faqat vaqtli seanslar',STARTING:'Server ishga tushmoqda',FAILED:'Serverni ishga tushirishda xato',UNREACHABLE:'Server javob bermayapti'}[r.backendState]||'Noma’lum';
  const backupAge=now-Date.parse(r.lastBackupAt);
  const backupWarning=!Number.isFinite(backupAge)||backupAge>2*3600000||backupAge<0;
  const lowDisk=Number.isFinite(r.freeDiskBytes)&&r.freeDiskBytes<1024**3;
  const line=(name,value)=>`<div><span class="text-zinc-400">${escape(name)}:</span> ${escape(value)}</div>`;
  return `<section class="glass-card rounded-3xl p-5 border border-zinc-800 space-y-3"><h3 class="font-bold text-white">Server diagnostikasi</h3>
    <p class="text-sm ${fresh?'text-sky-300':'text-amber-300'}">${fresh?'Launcher bilan aloqa bor':'Bu eski ma’lumot — hozirgi holat tasdiqlanmagan'}</p>
    <div class="text-sm text-zinc-200 space-y-1">${line('Oxirgi qayd etilgan server holati',backend)}${line('Sabab',labels[r.errorCode]||labels.UNKNOWN)}
    ${line('Launcher xabari kelgan vaqt',date(diagnostic.receivedAt))}${line('Serverdan oxirgi odatiy aloqa',date(backendLastSeen))}${line('Server paket versiyasi',r.serverVersion||'Noma’lum')}${line('Launcher versiyasi',r.launcherVersion||'Noma’lum')}
    ${line('Sozlama',({OK:'O‘qildi',MISSING:'Topilmadi',INVALID:'Buzilgan',UNREADABLE:'O‘qib bo‘lmadi'})[r.configState]||'Noma’lum')}
    ${line('Oxirgi tayyor zaxira',date(r.lastBackupAt))}${line('Bo‘sh disk joyi',Number.isFinite(r.freeDiskBytes)?(r.freeDiskBytes/1024**3).toFixed(1)+' GB':'Noma’lum')}</div>
    ${lowDisk?'<p class="text-amber-300 text-sm">Oxirgi tekshiruvda diskda 1 GB dan kam joy qolgan.</p>':''}
    ${backupWarning?'<p class="text-amber-300 text-sm">So‘nggi 2 soat ichidagi zaxira tasdiqlanmagan. Zaxira holatini tekshiring.</p>':''}
    ${r.backupError&&r.backupError!=='NONE'?`<p class="text-amber-300 text-sm">Zaxiralash: ${escape(r.backupError==='UNKNOWN'?'natija hali ma’lum emas':labels[r.backupError]||'zaxira olishda xato yuz bergan')}.</p>`:''}
    <p class="text-xs text-zinc-500">Launcher aloqasi klub serverining Online holatini yoki litsenziyasini o‘zgartirmaydi. Paket versiyasi oxirgi ishga tushgan versiyadan farq qilishi mumkin.</p>
    <button type="button" onclick="downloadServerDiagnostic()" class="px-3 py-2 rounded-xl bg-zinc-800 text-sky-300 text-sm">Diagnostikani yuklab olish</button></section>`;
}
