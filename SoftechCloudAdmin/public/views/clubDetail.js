/**
 * Softech Super Admin — Individual Club Inspector View
 * Location: SoftechCloudAdmin/public/views/clubDetail.js
 * Optimized for One-Hand Mobile Drill-Down, Touch Gestures & Real-Time Telemetry
 */

import {renderServerDiagnostics} from './serverDiagnostics.js';
const fleetEsc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const semver=value=>/^\d+\.\d+\.\d+$/.test(String(value||''))?String(value):null;
function fleetStatus(pc){
  const labels={IDLE:'Yangilanish kutilmayapti',REQUESTED:'Buyruq qabul qilindi',CHECKING:'Versiya tekshirilmoqda',DOWNLOADING:'Yuklanmoqda',READY:'O‘rnatishga tayyor',WAITING_FOR_SESSION:'Seans tugashi kutilmoqda',INSTALLING:'O‘rnatilmoqda',VERIFYING:'Yangi versiya tekshirilmoqda',INSTALLED:'O‘rnatildi',ERROR:'Xatolik'};
  const status=String(pc.updateStatus||'IDLE').toUpperCase(),client=semver(pc.clientVersion),server=semver(pc.serverVersion);
  let compatibility='Versiya aniqlanmadi',tone='text-zinc-400';
  if(client&&server){const [cm,cn]=client.split('.').map(Number),[sm,sn]=server.split('.').map(Number);if(cm!==sm){compatibility='Server bilan mos emas';tone='text-rose-400';}else if(cm===sm&&cn<sn){compatibility='Client eski — yangilang';tone='text-amber-400';}else if(client!==server){compatibility='Versiyalar farqli';tone='text-amber-300';}else{compatibility='Server bilan mos';tone='text-emerald-400';}}
  return {status,label:labels[status]||status,client,server,compatibility,tone};
}
// Global Inspector State
export const clubInspectorState = {
  activeClubId: null,
  clubData: null,
  diagnostic: null,
  diagnosticLoadState: 'ready',
  requestGeneration: 0,
  kassaData: null,
  workstations: [],
  selectedPc: null,
  isLoading: false,
  activeFilterZone: 'ALL', // 'ALL' | 'VIP' | 'PRO' | 'STANDARD'
  isKillSwitchModalOpen: false,
  killSwitchClubId: null,
  killSwitchClubName: ''
};

// ============================================================================
// 1. DATA FETCHING
// ============================================================================

/**
 * Fetch complete club drill-down telemetry from backend
 */
export async function fetchClubInspectorData(clubId) {
  const token = localStorage.getItem('softech_access_token');
  if (!token) {
    if (window.showAuthModal) window.showAuthModal();
    return null;
  }

  clubInspectorState.isLoading = true;
  clubInspectorState.activeClubId = clubId;
  const generation=++clubInspectorState.requestGeneration;
  clubInspectorState.diagnostic = null;
  clubInspectorState.diagnosticLoadState = 'loading';
  let diagnosticResult=null;
  void fetch(`/api/clubs/${clubId}/diagnostics`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(8000)})
    .then(async response=>{if(!response.ok)throw Error();return {state:'ready',data:(await response.json()).diagnostic};})
    .catch(()=>({state:'unavailable',data:null}))
    .then(result=>{
      diagnosticResult=result;
      if(clubInspectorState.activeClubId!==clubId||generation!==clubInspectorState.requestGeneration)return;
      clubInspectorState.diagnostic=result.data;clubInspectorState.diagnosticLoadState=result.state;
      renderDiagnosticSection();
    });

  try {
    const res = await fetch(`/api/telemetry/clubs/${clubId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      localStorage.removeItem('softech_access_token');
      if (window.showAuthModal) window.showAuthModal();
      return null;
    }

    if (!res.ok) {
      throw new Error(`Server xatosi: ${res.status}`);
    }

    const data = await res.json();
    if (data.success) {
      if(clubInspectorState.activeClubId!==clubId||generation!==clubInspectorState.requestGeneration)return null;
      clubInspectorState.diagnostic=diagnosticResult?.data||null;
      clubInspectorState.diagnosticLoadState=diagnosticResult?.state||'loading';
      clubInspectorState.clubData = data.club;
      clubInspectorState.kassaData = data.kassa;
      clubInspectorState.workstations = data.workstations || [];
      return data;
    }
  } catch (err) {
    console.error('❌ [Club Inspector] Ma\'lumotlarni olishda xatolik:', err);
    showInspectorToast("Filial telemetriyasini yuklab bo'lmadi");
  } finally {
    if(clubInspectorState.activeClubId===clubId)clubInspectorState.isLoading = false;
  }

  return null;
}

// ============================================================================
// 2. UI RENDER SUB-COMPONENTS
// ============================================================================

/**
 * 1. Club Overview Header
 * - Egasi, telefon, Telegram tugmasi, litsenziya muddati
 */
function renderOverviewHeader(club) {
  // Real-time indicator: Show green ping if club's last_heartbeat is within the last 90 seconds, otherwise display red "OFFLINE"
  let isOnline = false;
  const lastHeartbeatTime = club.last_heartbeat || club.last_heartbeat_at;
  if (lastHeartbeatTime) {
    const diffSeconds = (Date.now() - new Date(lastHeartbeatTime).getTime()) / 1000;
    isOnline = diffSeconds <= 90;
  } else {
    isOnline = Boolean(club.is_online_now);
  }

  const daysLeft = club.license_days_left ?? 0;
  const rawPhone = club.owner_phone || '+998901112233';
  const cleanPhone = rawPhone.replace(/[^\d+]/g, '');
  const telegramUsername = rawPhone.replace(/[^\d]/g, '');

  // Litsenziya holati badgesi
  let licenseBadge = '';
  if (daysLeft <= 0) {
    licenseBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">Muddati tugagan</span>`;
  } else if (daysLeft <= 14) {
    licenseBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">${daysLeft} kun qoldi</span>`;
  } else {
    licenseBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">${daysLeft} kun qoldi</span>`;
  }

  return `
    <div class="glass-card rounded-3xl p-5 border border-zinc-800/80 shadow-xl space-y-4 relative overflow-hidden">
      <!-- Background Ambient Glow -->
      <div class="absolute -top-10 -right-10 w-32 h-32 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <!-- Navigation & Top Bar -->
      <div class="flex items-center justify-between">
        <button 
          type="button" 
          onclick="closeClubDetailInspector()" 
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold active:scale-95 transition border border-zinc-700/60"
        >
          <span>←</span>
          <span>Orqaga</span>
        </button>

        <div class="flex items-center gap-2">
          <!-- 90-Second Heartbeat Indicator Badge -->
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold ${isOnline ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}">
            <span class="w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'bg-rose-500'}"></span>
            <span>${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </span>

          <button 
            type="button" 
            onclick="refreshClubDetailInspector()" 
            class="w-8 h-8 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center active:scale-90 transition border border-zinc-700/60"
            title="Yangilash"
          >
            <svg class="w-3.5 h-3.5 ${clubInspectorState.isLoading ? 'animate-spin text-sky-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Club Title & City -->
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-black text-white tracking-tight leading-snug">${club.name}</h2>
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            📍 ${club.city || 'Toshkent'}
          </span>
        </div>
        <p class="text-xs text-zinc-400 mt-1 font-mono flex items-center gap-2">
          <span>LAN IP: <strong class="text-zinc-200">${club.server_lan_ip || '192.168.1.100'}</strong></span>
          <span class="text-zinc-600">•</span>
          <span>v${club.server_version || '1.0.1'}</span>
          <span class="text-zinc-600">•</span>
          <span class="text-emerald-400">Ping: ${isOnline ? (club.ping_ms == null ? 'O‘lchanmagan' : club.ping_ms + 'ms') : 'Uzilgan'}</span>
        </p>
      </div>

      <!-- Owner Info & One-Tap Contacts -->
      <div class="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Klub Rahbari</div>
          <div class="text-sm font-bold text-white mt-0.5">${club.owner_name}</div>
          <div class="text-xs font-mono text-zinc-400 mt-0.5">${rawPhone}</div>
        </div>

        <div class="flex items-center gap-2 pt-1 sm:pt-0">
          <!-- 📞 To'g'ridan-to'g'ri Telefon -->
          <a 
            href="tel:${cleanPhone}" 
            onclick="triggerHaptic(15)" 
            class="flex-1 sm:flex-initial py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-600/20"
          >
            <span>📞</span>
            <span>Qo'ng'iroq</span>
          </a>

          <!-- ✈️ Telegram orqali ochish -->
          <a 
            href="https://t.me/+${telegramUsername}" 
            target="_blank" 
            rel="noopener noreferrer" 
            onclick="triggerHaptic(15)" 
            class="flex-1 sm:flex-initial py-2 px-3.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 active:scale-95 text-sky-400 border border-sky-500/30 text-xs font-bold flex items-center justify-center gap-1.5 transition"
          >
            <span>✈️</span>
            <span>Telegram</span>
          </a>
        </div>
      </div>

      <!-- License Expiration Status Banner -->
      <div class="flex items-center justify-between p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/60 text-xs">
        <div class="flex items-center gap-2">
          <span class="text-base">🔐</span>
          <div>
            <span class="text-zinc-300 font-medium">Litsenziya muddati:</span>
            <span class="text-[11px] text-zinc-500 block font-mono">${club.license_expires_at ? club.license_expires_at.slice(0, 10) : '2026-12-31'}</span>
          </div>
        </div>
        <div>
          ${licenseBadge}
        </div>
      </div>

      <!-- Supabase-Driven Cloud Licensing & Kill-Switch Panel -->
      <div class="p-3.5 rounded-2xl bg-zinc-900/90 border ${club.status === 'BLOCKED' || club.status === 'SUSPENDED' || club.status === 'SUSPENDED_PAYMENT' || club.license_status === 'LOCKED_BY_ADMIN' ? 'border-rose-500/50 bg-rose-950/20' : 'border-zinc-800'} space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-base">🛡️</span>
            <div>
              <span class="text-xs font-bold text-white tracking-tight">Supabase Cloud Litsenziya & Kill-Switch</span>
              <span class="text-[10px] text-zinc-400 block font-mono">HWID: <strong class="text-sky-400">${club.hardware_fingerprint || 'HWID-7521-4EC1-84CC-9559'}</strong></span>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${club.status === 'BLOCKED' || club.status === 'SUSPENDED' || club.status === 'SUSPENDED_PAYMENT' || club.license_status === 'LOCKED_BY_ADMIN' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'}">
            ${club.status === 'BLOCKED' || club.status === 'SUSPENDED' || club.status === 'SUSPENDED_PAYMENT' || club.license_status === 'LOCKED_BY_ADMIN' ? 'BLOKLANGAN' : 'FAOL (REALTIME)'}
          </span>
        </div>

        <button type="button" onclick="openManagerAccount(${club.id})" class="w-full py-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-300 font-semibold">Menejer login-paroli</button>
        <button type="button" onclick="openAdministratorAccount(${club.id})" class="w-full py-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-300 font-semibold">Administrator login-paroli</button>
        <!-- Kill Switch Action Buttons -->
        <div class="pt-2 border-t border-zinc-800 flex items-center gap-2">
          ${club.status === 'BLOCKED' || club.status === 'SUSPENDED' || club.status === 'SUSPENDED_PAYMENT' || club.license_status === 'LOCKED_BY_ADMIN' ? `
            <button 
              type="button" 
              onclick="triggerKillSwitchAction(${club.id}, 'UNLOCK')" 
              class="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-600/30"
            >
              <span>✅</span>
              <span>QULFDAN CHIQARISH (+30 kun)</span>
            </button>
          ` : `
            <button 
              type="button" 
              onclick="openKillSwitchConfirmModal(${club.id}, '${club.name}')" 
              class="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-rose-600/30"
            >
              <span>🚫</span>
              <span>ZALNI BLOKLASH (Kill-Switch)</span>
            </button>
          `}
        </div>
      </div>
    </div>
  `;
}

/**
 * 2. Kunlik Kassa Bo'linishi
 * - Seanslar tushumi, Bar tushumi, Qaytimlar summasi va Sof Kassa
 */
function renderKassaBreakdown(kassa) {
  const totalRevenue = Number(kassa.totalDailyRevenue) || 0;
  const sessionsRevenue = Number(kassa.sessionsRevenue ?? (totalRevenue - Number(kassa.barRevenue || 0)));
  const barRevenue = Number(kassa.barRevenue) || 0;
  const topups = kassa.topupRevenue == null ? '—' : Number(kassa.topupRevenue).toLocaleString();
  const cashReceipts = kassa.cashReceipts == null ? '—' : Number(kassa.cashReceipts).toLocaleString();

  const totalCalculated = Math.max(1, sessionsRevenue + barRevenue);
  const sessionsPercent = Math.round((sessionsRevenue / totalCalculated) * 100);
  const barPercent = Math.round((barRevenue / totalCalculated) * 100);

  return `
    <div class="glass-card rounded-3xl p-5 border border-zinc-800/80 shadow-xl space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>💵 Kunlik savdo va kassa</span>
          </h3>
          <p class="text-[11px] text-zinc-400 mt-0.5">O‘yin va bar savdosi; balans to‘ldirish alohida. Qaytimlar hisobga olingan.</p>
        </div>
        <div class="text-right">
          <span class="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block">O‘yin + bar savdosi</span>
          <span class="text-sm font-black font-mono text-emerald-400">${totalRevenue.toLocaleString()} UZS</span>
        </div>
      </div>

      <p class="text-[11px] text-zinc-400">${kassa.capturedAt ? 'Sinxronlangan: '+new Date(kassa.capturedAt).toLocaleString('uz-UZ', { hourCycle: 'h23' }) : 'Batafsil hisobot hali sinxronlanmagan. Serverni yangilang va internetga ulang.'}</p>
      <!-- Financial Split Cards Grid -->
      <div class="grid grid-cols-3 gap-2.5">
        <!-- 1. Seanslar Tushumi -->
        <div class="bg-zinc-900/80 p-3 rounded-2xl border border-sky-500/20 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1 text-[10px] text-sky-400 font-semibold">
              <span>🎮</span>
              <span>Seanslar</span>
            </div>
            <div class="text-xs sm:text-sm font-extrabold font-mono text-white mt-1.5 leading-none">
              ${sessionsRevenue.toLocaleString()}
            </div>
          </div>
          <div class="text-[9px] text-zinc-400 mt-2 font-mono">${kassa.totalSessionsCount || 0} ta seans</div>
        </div>

        <!-- 2. Bar Tushumi -->
        <div class="bg-zinc-900/80 p-3 rounded-2xl border border-amber-500/20 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
              <span>🥤</span>
              <span>Bar & Snak</span>
            </div>
            <div class="text-xs sm:text-sm font-extrabold font-mono text-white mt-1.5 leading-none">
              ${barRevenue.toLocaleString()}
            </div>
          </div>
          <div class="text-[9px] text-zinc-400 mt-2 font-mono">Mini-market</div>
        </div>

        <!-- 3. Qaytimlar Summasi -->
        <div class="bg-zinc-900/80 p-3 rounded-2xl border border-rose-500/20 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1 text-[10px] text-rose-400 font-semibold">
              <span>🔄</span>
              <span>Balans to‘ldirish</span>
            </div>
            <div class="text-xs sm:text-sm font-extrabold font-mono text-rose-300 mt-1.5 leading-none">
              ${topups}
            </div>
          </div>
          <div class="text-[9px] text-zinc-400 mt-2 font-mono">Savdoga qo‘shilmaydi</div>
        </div>
      </div>

      <!-- Visual Proportion Bar -->
      <div class="space-y-1.5">
        <div class="flex justify-between items-center text-[10px] text-zinc-400 font-mono">
          <span class="text-sky-400 flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-sky-400"></span>
            <span>O'yin Seanslari: ${sessionsPercent}%</span>
          </span>
          <span class="text-amber-400 flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>Bar Savdosi: ${barPercent}%</span>
          </span>
        </div>
        <div class="w-full h-2 bg-zinc-800 rounded-full overflow-hidden flex">
          <div class="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-500" style="width: ${sessionsPercent}%"></div>
          <div class="h-full bg-amber-400 transition-all duration-500" style="width: ${barPercent}%"></div>
        </div>
      </div>

      <!-- Net Revenue Summary Footer -->
      <div class="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs">
        <span class="text-zinc-400 font-medium">Kassa tushumi (naqd + karta):</span>
        <span class="font-mono font-bold text-white text-sm">${cashReceipts} <span class="text-[10px] text-zinc-400 font-normal">UZS</span></span>
      </div>
    </div>
  `;
}

/**
 * 3. Real-Time Kompyuterlar Matritsasi
 * - Miniatyura PC kartochkalari (PC-01 .. PC-N)
 * - Yashil (Bo'sh), Ko'k (Band - o'yinchi ismi/vaqti bilan), Qizil (O'chiq)
 */
function renderWorkstationsMatrix(workstations) {
  const total = workstations.length;
  const occupied = workstations.filter(w => w.status === 'OCCUPIED').length;
  const available = workstations.filter(w => w.status === 'AVAILABLE').length;
  const offline = workstations.filter(w => w.status === 'OFFLINE').length;

  return `
    <div class="glass-card rounded-3xl p-5 border border-zinc-800/80 shadow-xl space-y-4">
      <!-- Section Header -->
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>🖥️ Jonli Kompyuterlar Matritsasi</span>
          </h3>
          <p class="text-[11px] text-zinc-400 mt-0.5">Barcha zallardagi ishchi o'rinlarining real holati</p>
        </div>

        <!-- Occupancy Counter Badge -->
        <span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/30">
          ${occupied} / ${total} Band
        </span>
      </div>

      <!-- Legend & Fast Status Summary -->
      <div class="flex items-center justify-between p-2.5 rounded-2xl bg-zinc-900/70 border border-zinc-800 text-[11px] font-medium">
        <div class="flex items-center gap-1.5 text-emerald-400">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"></span>
          <span>Bo'sh (${available})</span>
        </div>
        <div class="flex items-center gap-1.5 text-sky-400">
          <span class="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]"></span>
          <span>Band (${occupied})</span>
        </div>
        <div class="flex items-center gap-1.5 text-rose-400">
          <span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
          <span>O'chiq (${offline})</span>
        </div>
      </div>

      <!-- Interactive Workstations Mini-Grid (4 columns on mobile, 5-6 on tablet) -->
      <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2.5 pt-1">
        ${workstations.map(pc => {
          const status = pc.status;
          const fleet=fleetStatus(pc);
          let cardStyle = '';
          let badgeDot = '';
          let textStatus = '';
          let playerSubtitle = '';

          if (status === 'OCCUPIED') {
            // Ko'k — Band
            cardStyle = 'bg-sky-500/15 border-sky-500/40 text-sky-300 shadow-md shadow-sky-500/10 hover:border-sky-400';
            badgeDot = 'bg-sky-400 shadow-[0_0_6px_#38bdf8] animate-pulse';
            textStatus = 'BAND';
            const gamer = pc.session?.gamerName || 'Mijoz';
            const mins = pc.session?.playedMinutes ?? '—';
            playerSubtitle = `
              <div class="text-[9px] font-mono text-white font-bold truncate mt-1">${gamer}</div>
              <div class="text-[8px] font-mono text-sky-300">${mins} daq</div>
            `;
          } else if (status === 'AVAILABLE') {
            // Yashil — Bo'sh
            cardStyle = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:border-emerald-400';
            badgeDot = 'bg-emerald-400 shadow-[0_0_6px_#34d399]';
            textStatus = 'BO\'SH';
            playerSubtitle = `
              <div class="text-[9px] font-mono text-emerald-300 mt-1">Tayyor</div>
              <div class="text-[8px] font-mono text-zinc-500">O'yin kutmoqda</div>
            `;
          } else {
            // Qizil — O'chiq
            cardStyle = 'bg-zinc-900/80 border-rose-500/30 text-rose-400 opacity-70 hover:opacity-100';
            badgeDot = 'bg-rose-500';
            textStatus = 'O\'CHIQ';
            playerSubtitle = `
              <div class="text-[9px] font-mono text-rose-400 mt-1">Aloqa yo'q</div>
              <div class="text-[8px] font-mono text-zinc-500">Texnik xizmat</div>
            `;
          }

          return `
            <div 
              onclick="selectInspectorWorkstation('${pc.pcNumber}')" 
              class="rounded-2xl p-2 border flex flex-col justify-between items-center text-center cursor-pointer active:scale-90 transition-all select-none min-h-[82px] ${cardStyle}"
            >
              <!-- Top Row: PC Number & Zone -->
              <div class="w-full flex items-center justify-between text-[9px] font-mono">
                <span class="font-bold text-white">${pc.pcNumber}</span>
                <span class="w-1.5 h-1.5 rounded-full ${badgeDot}"></span>
              </div>

              <!-- Center: Player / Subtitle Info -->
              <div class="w-full my-auto">
                ${playerSubtitle}
              </div>

              <!-- Bottom: Zone indicator pill -->
              <div class="w-full mt-1 pt-1 border-t border-white/10 flex items-center justify-center">
                <span class="text-[8px] font-mono uppercase tracking-wider text-zinc-400">${pc.zoneName || 'STD'} • v${fleet.client||'?'}</span>
              </div>
              ${!['IDLE','INSTALLED'].includes(fleet.status)?`<div class="text-[8px] mt-1 ${fleet.status==='ERROR'?'text-rose-400':'text-violet-300'}">${fleetEsc(fleet.label)}</div>`:''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/**
 * 4. PC Seans Tafsilotlari Modali (Tapped PC Detail Sheet)
 */
function renderWorkstationSessionModal() {
  const pc = clubInspectorState.selectedPc;
  if (!pc) return '';

  const isOccupied = pc.status === 'OCCUPIED';
  const isAvailable = pc.status === 'AVAILABLE';
  const session = pc.session;
  const fleet=fleetStatus(pc);

  return `
    <div id="pcDetailModalContainer" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div class="glass-card w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-5 space-y-4 border border-sky-500/30 glow-cyan max-h-[85vh] overflow-y-auto ios-scroll shadow-2xl">
        
        <!-- Mobile Pull Handle -->
        <div class="w-10 h-1 bg-zinc-700 rounded-full mx-auto -mt-1 mb-2 sm:hidden"></div>

        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-2xl ${isOccupied ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : (isAvailable ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30')} flex items-center justify-center font-mono font-black text-sm">
              ${pc.pcNumber}
            </div>
            <div>
              <h4 class="text-sm font-bold text-white tracking-tight">${pc.pcNumber} Tafsilotlari</h4>
              <p class="text-[10px] text-zinc-400 font-mono">${pc.zoneName} Zal zonasi</p>
            </div>
          </div>
          <button type="button" onclick="closeInspectorWorkstationModal()" class="w-8 h-8 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition">
            ✕
          </button>
        </div>

        <div class="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-xs space-y-2">
          <div class="flex justify-between"><span class="text-zinc-400">Client versiyasi:</span><span class="font-mono font-bold text-white">${fleet.client?`v${fleet.client}`:'Aniqlanmadi'}</span></div>
          <div class="flex justify-between"><span class="text-zinc-400">Server versiyasi:</span><span class="font-mono text-zinc-200">${fleet.server?`v${fleet.server}`:'Aniqlanmadi'}</span></div>
          <div class="flex justify-between gap-3"><span class="text-zinc-400">Moslik:</span><span class="font-bold text-right ${fleet.tone}">${fleet.compatibility}</span></div>
          <div class="flex justify-between gap-3"><span class="text-zinc-400">Yangilanish:</span><span class="font-bold text-right ${fleet.status==='ERROR'?'text-rose-400':'text-violet-300'}">${fleetEsc(fleet.label)}</span></div>
          ${pc.updateTargetVersion?`<div class="flex justify-between"><span class="text-zinc-400">Maqsad:</span><span class="font-mono">v${fleetEsc(pc.updateTargetVersion)}</span></div>`:''}
          ${pc.updateReceiptId?`<div class="text-[10px] text-emerald-400 break-all">Tasdiq receipt: ${fleetEsc(pc.updateReceiptId)}</div>`:''}
          ${pc.updateError?`<div class="p-2 rounded-lg bg-rose-950/40 border border-rose-500/30 text-[10px] text-rose-300">${fleetEsc(pc.updateError)}</div>`:''}
          <button type="button" onclick="updateSingleClient('${fleetEsc(pc.pcNumber)}')" ${pc.status==='OFFLINE'?'disabled':''}
            class="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-bold text-xs">
            Shu clientni yangilash
          </button>
        </div>

        <!-- Real-Time Status Card -->
        <div class="p-3 rounded-2xl ${isOccupied ? 'bg-sky-500/10 border border-sky-500/30' : (isAvailable ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-rose-500/10 border border-rose-500/30')} flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${isOccupied ? 'bg-sky-400 animate-pulse' : (isAvailable ? 'bg-emerald-400' : 'bg-rose-500')}"></span>
            <span class="font-bold text-white">
              ${isOccupied ? 'Faol O\'yin Seansi Ketmoqda' : (isAvailable ? 'Kompyuter Bo\'sh (Kutish rejimida)' : 'Kompyuter O\'chiq / Aloqa yo\'q')}
            </span>
          </div>
          <span class="font-mono text-[10px] text-zinc-400">${pc.status}</span>
        </div>

        ${isOccupied && session ? `
          <!-- Active Session Info -->
          <div class="space-y-2 p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-xs">
            <div class="flex justify-between items-center">
              <span class="text-zinc-400">O'yinchi niki:</span>
              <span class="font-mono font-bold text-white text-sm bg-sky-500/15 px-2 py-0.5 rounded border border-sky-500/30">
                ${session.gamerName}
              </span>
            </div>
            <div class="flex justify-between items-center pt-1.5 border-t border-zinc-800/80">
              <span class="text-zinc-400">Boshlangan vaqti:</span>
              <span class="font-mono text-zinc-200">${session.startedAt}</span>
            </div>
            <div class="flex justify-between items-center pt-1.5 border-t border-zinc-800/80">
              <span class="text-zinc-400">O'ynalgan davomiylik:</span>
              <span class="font-mono text-sky-400 font-bold">${session.playedMinutes ?? '—'} daqiqa</span>
            </div>
            <div class="flex justify-between items-center pt-1.5 border-t border-zinc-800/80">
              <span class="text-zinc-400">Tarif stavkasi:</span>
              <span class="font-mono text-zinc-300">${session.hourlyRate == null ? '—' : session.hourlyRate.toLocaleString()} UZS / soat</span>
            </div>
            <div class="flex justify-between items-center pt-2 border-t border-zinc-800 text-sm font-bold">
              <span class="text-zinc-200">Hisoblangan summa:</span>
              <span class="font-mono text-emerald-400">${session.spentAmount == null ? '—' : session.spentAmount.toLocaleString()} UZS</span>
            </div>
          </div>
        ` : (isAvailable ? `
          <div class="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-center space-y-1">
            <div class="text-2xl">🟢</div>
            <div class="text-xs font-bold text-white">Kompyuter yangi o'yinchiga tayyor</div>
            <p class="text-[11px] text-zinc-400 max-w-xs mx-auto">
              Zal ma'muri yoki mijoz kassadan vaqt xarid qilishi bilan tizim avtomatik jonli seansni boshlaydi.
            </p>
          </div>
        ` : `
          <div class="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-center space-y-1">
            <div class="text-2xl">⚠️</div>
            <div class="text-xs font-bold text-rose-400">Kompyuter tarmog'i uzilgan</div>
            <p class="text-[11px] text-zinc-400 max-w-xs mx-auto">
              Lokal tarmoq kabeli yoki quvvat manbai holatini tekshirish tavsiya etiladi.
            </p>
          </div>
        `)}

        <!-- Quick Remote Actions -->
        <div class="flex items-center gap-2 pt-1">
          <button 
            type="button" 
            onclick="sendWorkstationQuickSignal('${pc.pcNumber}', 'RESTART_PC')" 
            class="flex-1 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition border border-zinc-700"
          >
            <span>🔄</span>
            <span>Qayta Yoqish</span>
          </button>
          
          <button 
            type="button" 
            onclick="sendWorkstationQuickSignal('${pc.pcNumber}', 'LOCK_SCREEN')" 
            class="flex-1 py-2 px-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 active:scale-95 text-sky-400 text-xs font-bold flex items-center justify-center gap-1.5 transition border border-sky-500/30"
          >
            <span>🔒</span>
            <span>Ekranni Qulflash</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 3. MAIN DRILL-DOWN VIEW RENDERER
// ============================================================================

/**
 * Render the entire Club Inspector screen into the root container
 */
export function renderClubInspectorView() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;

  const club = clubInspectorState.clubData;
  const kassa = clubInspectorState.kassaData;
  const workstations = clubInspectorState.workstations;

  if (!club) {
    container.innerHTML = `
      <div class="space-y-4 py-8 animate-pulse text-center">
        <div class="w-12 h-12 rounded-2xl glass-card mx-auto flex items-center justify-center text-sky-400">
          <svg class="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
        </div>
        <p class="text-xs text-zinc-400">Filial telemetriyasi yuklanmoqda...</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="space-y-4 pb-24 animate-fade-in">
      <!-- 1. Club Overview Header -->
      ${renderOverviewHeader(club)}
      <div data-server-diagnostics="${Number(club.id)}">${renderServerDiagnostics(clubInspectorState.diagnostic,clubInspectorState.diagnosticLoadState,Date.now(),club.last_heartbeat_at||club.last_heartbeat)}</div>

      <!-- 2. Kunlik Kassa Bo'linishi -->
      ${renderKassaBreakdown(kassa || {})}

      <!-- 3. Real-Time Kompyuterlar Matritsasi -->
      ${renderWorkstationsMatrix(workstations)}
    </div>

    <!-- 4. PC Session Detail Modal -->
    ${renderWorkstationSessionModal()}

    <!-- 5. Emergency Kill-Switch Confirmation Modal -->
    ${renderKillSwitchModal()}
  `;
}

/**
 * 5. Emergency Kill-Switch Tasdiqlash Modali
 */
function renderKillSwitchModal() {
  if (!clubInspectorState.isKillSwitchModalOpen) return '';

  return `
    <div id="killSwitchModalContainer" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div class="glass-card w-full max-w-sm rounded-3xl p-6 space-y-4 border border-rose-500/50 shadow-2xl shadow-rose-950/50">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center text-2xl font-black">
            🚨
          </div>
          <div>
            <h4 class="text-sm font-extrabold text-white tracking-tight">SHOSHILINCH KILL-SWITCH</h4>
            <p class="text-[11px] text-rose-400 font-mono">${clubInspectorState.killSwitchClubName || 'Filial'}</p>
          </div>
        </div>

        <div class="p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200 leading-relaxed space-y-1.5">
          <p>⚠️ <strong>DIQQAT:</strong> Ushbu buyruq klub serveriga zudlik bilan WebSocket orqali yetib boradi va quyidagilarni amalga oshiradi:</p>
          <ul class="list-disc list-inside text-[11px] text-zinc-300 space-y-0.5">
            <li>Barcha faol o'yin seanslari majburiy uziladi</li>
            <li>Barcha mijoz PC kompyuterlari bloklanadi</li>
            <li>Kassir paneliga qizil blokirovka ekrani chiqadi</li>
          </ul>
        </div>

        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Bloklash sababi:</label>
          <input 
            type="text" 
            id="killSwitchReasonInput" 
            placeholder="Oylik obuna to'lovi qilinmagan..." 
            class="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 font-medium"
            value="Oylik obuna to'lovi muddati tugadi. Xizmatni davom ettirish uchun ta'minotchi bilan bog'laning."
          />
        </div>

        <div class="flex items-center gap-2 pt-2">
          <button 
            type="button" 
            onclick="closeKillSwitchModal()" 
            class="flex-1 py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition active:scale-95"
          >
            Bekor qilish
          </button>
          <button 
            type="button" 
            onclick="confirmKillSwitchLock()" 
            class="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white text-xs font-black transition active:scale-95 shadow-lg shadow-rose-600/40"
          >
            HA, BLOKLASH!
          </button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 4. WINDOW INTERACTION HANDLERS
// ============================================================================

window.openClubDetailInspector = async function(clubId) {
  triggerHaptic(20);
  showInspectorToast("Filial telemetriyasi ochilmoqda...");
  const data = await fetchClubInspectorData(clubId);
  if (data) {
    renderClubInspectorView();
  }
};

window.closeClubDetailInspector = function() {
  triggerHaptic(10);
  clubInspectorState.activeClubId = null;
  clubInspectorState.clubData = null;
  clubInspectorState.diagnostic = null;
  clubInspectorState.selectedPc = null;
  
  // Asosiy klublar ro'yxatiga qaytish
  if (typeof window.switchTab === 'function') {
    window.switchTab('clubs');
  }
};

window.downloadServerDiagnostic = function(){
  if(!clubInspectorState.diagnostic)return;
  const blob=new Blob([JSON.stringify(clubInspectorState.diagnostic,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`Softech-Club-${Number(clubInspectorState.activeClubId)}-Diagnostics.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

function renderDiagnosticSection(){
  const element=document.querySelector('[data-server-diagnostics]');
  if(!element||Number(element.dataset.serverDiagnostics)!==Number(clubInspectorState.activeClubId))return;
  const club=clubInspectorState.clubData;
  element.innerHTML=renderServerDiagnostics(clubInspectorState.diagnostic,clubInspectorState.diagnosticLoadState,Date.now(),club?.last_heartbeat_at||club?.last_heartbeat);
}

let diagnosticRefreshing=false;
setInterval(async()=>{
  if(document.hidden||diagnosticRefreshing||!document.querySelector('[data-server-diagnostics]'))return;
  const id=clubInspectorState.activeClubId,generation=clubInspectorState.requestGeneration;
  const token=localStorage.getItem('softech_access_token');if(!id||!token)return;
  renderDiagnosticSection(); // Expire old observations even when the request fails.
  diagnosticRefreshing=true;
  try{
    const response=await fetch(`/api/clubs/${id}/diagnostics`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error();const data=await response.json();
    if(id!==clubInspectorState.activeClubId||generation!==clubInspectorState.requestGeneration)return;
    clubInspectorState.diagnostic=data.diagnostic;clubInspectorState.diagnosticLoadState='ready';
  }catch{if(id===clubInspectorState.activeClubId&&generation===clubInspectorState.requestGeneration)clubInspectorState.diagnosticLoadState='unavailable';}
  finally{diagnosticRefreshing=false;renderDiagnosticSection();}
},30000);

let fleetRefreshing=false;
setInterval(async()=>{
  if(document.hidden||fleetRefreshing||!document.querySelector('[data-server-diagnostics]'))return;
  const id=clubInspectorState.activeClubId,generation=clubInspectorState.requestGeneration;
  const token=localStorage.getItem('softech_access_token');if(!id||!token)return;
  fleetRefreshing=true;
  try{
    const response=await fetch(`/api/clubs/${id}/fleet`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error();const data=await response.json();
    if(id!==clubInspectorState.activeClubId||generation!==clubInspectorState.requestGeneration)return;
    clubInspectorState.workstations=data.workstations||[];
    if(clubInspectorState.selectedPc){const selected=clubInspectorState.selectedPc.pcNumber;clubInspectorState.selectedPc=clubInspectorState.workstations.find(pc=>pc.pcNumber===selected)||null;}
    renderClubInspectorView();
  }catch{/* The last verified fleet remains visible. */}finally{fleetRefreshing=false;}
},15000);

window.refreshClubDetailInspector = async function() {
  triggerHaptic(15);
  if (!clubInspectorState.activeClubId) return;
  showInspectorToast("Ma'lumotlar qayta yuklanmoqda...");
  await fetchClubInspectorData(clubInspectorState.activeClubId);
  renderClubInspectorView();
  showInspectorToast("✓ Filial holati yangilandi");
};

window.selectInspectorWorkstation = function(pcNumber) {
  triggerHaptic(15);
  const pc = clubInspectorState.workstations.find(w => w.pcNumber === pcNumber);
  if (pc) {
    clubInspectorState.selectedPc = pc;
    renderClubInspectorView();
  }
};

window.closeInspectorWorkstationModal = function() {
  triggerHaptic(10);
  clubInspectorState.selectedPc = null;
  renderClubInspectorView();
};

window.updateSingleClient = async function(pcNumber) {
  const clubId=clubInspectorState.activeClubId,token=localStorage.getItem('softech_access_token');
  if(!clubId||!token)return;
  showInspectorToast(`${pcNumber}: yangilanish navbatga qo‘yilmoqda...`);
  try{
    const response=await fetch(`/api/telemetry/commands/${clubId}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({action:'FORCE_CLIENT_UPDATE',payload:{pcNumber,reason:'Super Admin orqali bitta client yangilanishi'}})});
    const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Buyruq yuborilmadi.');
    showInspectorToast(`${pcNumber}: buyruq yuborildi`);clubInspectorState.selectedPc=null;
    setTimeout(async()=>{await fetchClubInspectorData(clubId);renderClubInspectorView();},1500);
  }catch(error){showInspectorToast(`Xatolik: ${error.message}`);}
};

window.sendWorkstationQuickSignal = function(pcNumber, signalType) {
  triggerHaptic([20, 30]);
  showInspectorToast(`🚀 [${pcNumber}] ga ${signalType} signali yuborildi`);
  closeInspectorWorkstationModal();
};

window.openKillSwitchConfirmModal = function(clubId, clubName) {
  triggerHaptic(20);
  clubInspectorState.isKillSwitchModalOpen = true;
  clubInspectorState.killSwitchClubId = clubId;
  clubInspectorState.killSwitchClubName = clubName;
  renderClubInspectorView();
};

window.closeKillSwitchModal = function() {
  triggerHaptic(10);
  clubInspectorState.isKillSwitchModalOpen = false;
  clubInspectorState.killSwitchClubId = null;
  clubInspectorState.killSwitchClubName = '';
  renderClubInspectorView();
};

window.confirmKillSwitchLock = async function() {
  const reasonInput = document.getElementById('killSwitchReasonInput');
  const reason = reasonInput ? reasonInput.value : "Oylik obuna to'lovi tugadi";
  const clubId = clubInspectorState.killSwitchClubId;
  closeKillSwitchModal();
  await window.triggerKillSwitchAction(clubId, 'LOCK', reason);
};

window.triggerKillSwitchAction = async function(clubId, action, reason = '') {
  triggerHaptic([30, 50]);
  const token = localStorage.getItem('softech_access_token');
  showInspectorToast(action === 'LOCK' ? "🚨 Shoshilinch Kill-Switch yuborilmoqda..." : "✅ Blokdan chiqarilmoqda...");

  try {
    const res = await fetch(`/api/telemetry/kill-switch/${clubId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action, reason })
    });
    const data = await res.json();
    if (data.success) {
      showInspectorToast(action === 'LOCK' ? "🚨 Klub serveri va barcha mijoz PC lari BLOKLANDI!" : "✅ Klub litsenziyasi qayta faollashtirildi!");
      if (clubInspectorState.clubData) {
        clubInspectorState.clubData.license_status = (action === 'LOCK' ? 'BLOCKED' : 'ACTIVE');
        clubInspectorState.clubData.status = (action === 'LOCK' ? 'BLOCKED' : 'ACTIVE');
      }
      await fetchClubInspectorData(clubId);
      renderClubInspectorView();
    } else {
      showInspectorToast(`Xatolik: ${data.error || 'Amal bajarilmadi'}`);
    }
  } catch (err) {
    showInspectorToast(`Tarmoq xatosi: ${err.message}`);
  }
};

function triggerHaptic(pattern = 15) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function showInspectorToast(message) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
  toast.classList.add('opacity-100', 'translate-y-0');

  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
  }, 2500);
}

