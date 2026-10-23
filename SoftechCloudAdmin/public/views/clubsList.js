/**
 * Softech Super Admin — Interactive Clubs Live Directory View
 * Location: SoftechCloudAdmin/public/views/clubsList.js
 * Optimized for One-Hand Mobile Use, Real-Time Telemetry & PWA Standalone Mode
 */

import './addClubModal.js';

// Global Directory State
export const clubsListState = {
  allClubs: [],
  searchQuery: '',
  sortBy: 'REVENUE', // 'REVENUE' | 'PCS' | 'OFFLINE'
  selectedClub: null,
  isLoading: false,
  lastUpdated: null
};

// ============================================================================
// 1. DATA FETCHING (TELEMETRY API)
// ============================================================================

/**
 * Fetch all enrolled clubs with real-time health and revenue
 */
export async function fetchClubsDirectory() {
  const token = localStorage.getItem('softech_access_token');
  if (!token) {
    window.location.href = '/login';
    return [];
  }

  clubsListState.isLoading = true;
  try {
    const res = await fetch('/api/telemetry/clubs', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      localStorage.removeItem('softech_access_token');
      window.location.href = '/login';
      return [];
    }

    const data = await res.json();
    if (data.success && Array.isArray(data.clubs)) {
      clubsListState.allClubs = data.clubs;
      clubsListState.lastUpdated = new Date();
    }
  } catch (err) {
    console.error('❌ [Clubs Directory] Filiallarni yuklashda xatolik:', err);
    showDirectoryToast("Tarmoq xatosi: Ma'lumotlarni yuklab bo'lmadi");
  } finally {
    clubsListState.isLoading = false;
  }

  return clubsListState.allClubs;
}

// ============================================================================
// 2. FILTERING & SORTING LOGIC
// ============================================================================

export function getFilteredAndSortedClubs() {
  let list = [...clubsListState.allClubs];

  // 1. Matnli qidiruv (Klub nomi yoki egasining ismi bo'yicha)
  const q = clubsListState.searchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(c => {
      const name = (c.name || '').toLowerCase();
      const owner = (c.owner_name || '').toLowerCase();
      const city = (c.city || '').toLowerCase();
      const ip = (c.server_lan_ip || '').toLowerCase();
      return name.includes(q) || owner.includes(q) || city.includes(q) || ip.includes(q);
    });
  }

  // 2. Saralash (Sort By)
  list.sort((a, b) => {
    if (clubsListState.sortBy === 'REVENUE') {
      // Bugungi tushum bo'yicha kamayish tartibida
      return (Number(b.today_revenue) || 0) - (Number(a.today_revenue) || 0);
    }

    if (clubsListState.sortBy === 'PCS') {
      // Kompyuterlar soni bo'yicha kamayish tartibida
      return (Number(b.total_workstations) || 0) - (Number(a.total_workstations) || 0);
    }

    if (clubsListState.sortBy === 'OFFLINE') {
      // Aloqa uzilganlar (offline) birinchi bo'lib chiqadi
      const aOnline = a.is_online_now ? 1 : 0;
      const bOnline = b.is_online_now ? 1 : 0;
      if (aOnline !== bOnline) {
        return aOnline - bOnline; // 0 (offline) avval keladi
      }
      return (b.offline_minutes || 0) - (a.offline_minutes || 0);
    }

    return 0;
  });

  return list;
}

// ============================================================================
// 3. UI RENDER ENGINE
// ============================================================================

/**
 * Vaqt davomiyligini qulay formatlash (masalan: 15 daq, 2 soat)
 */
function formatOfflineTime(minutes) {
  const m = Math.max(1, parseInt(minutes, 10) || 15);
  if (m < 60) {
    return `${m} daq`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}s ${remM}d` : `${h} soat`;
}

/**
 * Har bir klub holati badgesini hisoblash
 * - Yashil: "ONLINE" (Server onlayn va seanslar bor)
 * - Sariq: "SEANS YO'Q" (Server onlayn, ammo band PC yo'q)
 * - Qizil: "OFFLINE X daq" (Oxirgi heartbeat vaqtidan buyon uzilgan)
 */
function getClubStatusBadge(club) {
  if (club.status === 'BLOCKED' || club.license_status === 'BLOCKED' || club.status === 'SUSPENDED') {
    return `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.2)]">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
        <span>BLOKLANGAN</span>
      </span>
    `;
  }

  let isOnline = false;
  const lastHeartbeatTime = club.last_heartbeat || club.last_heartbeat_at;
  if (lastHeartbeatTime) {
    const diffSeconds = (Date.now() - new Date(lastHeartbeatTime).getTime()) / 1000;
    isOnline = diffSeconds <= 90;
  } else {
    isOnline = Boolean(club.is_online_now);
  }

  const occupiedPcs = Number(club.occupied_pcs_now) || 0;

  if (isOnline) {
    if (occupiedPcs > 0 || (club.today_sessions && Number(club.today_sessions) > 0)) {
      return `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.15)]">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"></span>
          <span>ONLINE</span>
        </span>
      `;
    }

    return `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
        <span>SEANS YO'Q</span>
      </span>
    `;
  }

  const durationStr = formatOfflineTime(club.offline_minutes);
  return `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
      <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
      <span>OFFLINE ${durationStr}</span>
    </span>
  `;
}

/**
 * Alohida Shisha Klub Kartochkasi
 */
function renderClubCard(club) {
  const totalPcs = Math.max(1, Number(club.total_workstations) || 0);
  const occupiedPcs = Math.min(totalPcs, Number(club.occupied_pcs_now) || 0);
  const occupancyPercent = Math.round((occupiedPcs / totalPcs) * 100);
  const revenueFormatted = (Number(club.today_revenue) || 0).toLocaleString();
  const dutyCashier = club.duty_cashier || (club.owner_name ? (club.owner_name.split(' ')[0].toLowerCase() + '_admin') : 'Ali_admin');
  const pingDisplay = club.is_online_now ? `${club.ping_ms || 18}ms` : 'Uzilgan';
  const pingColor = club.is_online_now ? 'text-emerald-400' : 'text-zinc-500';

  return `
    <div class="glass-card rounded-2xl p-4 border border-zinc-800/80 hover:border-sky-500/30 transition-all duration-200 active:scale-[0.99] relative overflow-hidden group shadow-lg">
      <!-- Glow Accent Effect -->
      <div class="absolute -top-12 -right-12 w-28 h-28 bg-sky-500/5 rounded-full blur-2xl pointer-events-none group-hover:bg-sky-500/10 transition"></div>

      <!-- Card Top: Club Name, City & Status Badge -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-white tracking-tight truncate">${club.name}</h3>
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-800 text-sky-300 border border-zinc-700">
              📍 ${club.city || 'Toshkent'}
            </span>
          </div>
          <p class="text-[11px] text-zinc-400 mt-0.5 truncate flex items-center gap-2">
            <span>Rahbar: <strong class="text-zinc-300 font-medium">${club.owner_name}</strong></span>
            <span class="text-zinc-600">•</span>
            <span class="font-mono text-zinc-500">${club.server_lan_ip || '192.168.1.100'}</span>
          </p>
        </div>

        <div class="flex-shrink-0">
          ${getClubStatusBadge(club)}
        </div>
      </div>

      <!-- Core Metrics Grid -->
      <div class="mt-3.5 pt-3 border-t border-zinc-800/80 grid grid-cols-2 gap-2.5">
        <!-- 🖥️ Bandlik Metric with Mini Progress Bar -->
        <div class="bg-zinc-900/60 rounded-xl p-2.5 border border-zinc-800/50">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-zinc-400 flex items-center gap-1">
              <span>🖥️</span>
              <span>Bandlik:</span>
            </span>
            <span class="font-mono font-bold text-white text-xs">${occupiedPcs} / ${totalPcs} PC</span>
          </div>
          <div class="w-full h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
            <div class="h-full bg-gradient-to-r from-sky-400 to-indigo-500 rounded-full transition-all duration-500" style="width: ${occupancyPercent}%"></div>
          </div>
          <div class="flex justify-between items-center text-[9px] text-zinc-500 mt-1 font-mono">
            <span>Bandlik darajasi</span>
            <span class="${occupancyPercent > 80 ? 'text-amber-400 font-bold' : 'text-zinc-400'}">${occupancyPercent}%</span>
          </div>
        </div>

        <!-- 💰 Bugungi Tushum Metric -->
        <div class="bg-zinc-900/60 rounded-xl p-2.5 border border-zinc-800/50 flex flex-col justify-between">
          <div class="text-[11px] text-zinc-400 flex items-center gap-1">
            <span>💰</span>
            <span>Bugungi tushum:</span>
          </div>
          <div class="mt-1">
            <div class="text-xs sm:text-sm font-extrabold font-mono text-white tracking-tight">${revenueFormatted} <span class="text-[9px] font-normal text-zinc-400">UZS</span></div>
            <div class="text-[9px] text-emerald-400 font-mono mt-0.5 flex items-center gap-1">
              <span>↑</span>
              <span>${club.today_sessions || 0} ta seans qayd etildi</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Additional Telemetry: Cashier & Server Health -->
      <div class="mt-2.5 px-1 flex items-center justify-between text-[11px] text-zinc-400">
        <div class="flex items-center gap-1.5 truncate">
          <span class="text-xs">👤</span>
          <span class="text-zinc-500">Navbatchi kassir:</span>
          <span class="font-mono font-semibold text-zinc-300 truncate">${dutyCashier}</span>
        </div>

        <div class="flex items-center gap-1.5 font-mono text-[10px] flex-shrink-0">
          <span class="text-xs">📡</span>
          <span class="text-zinc-400">v${club.server_version || '1.0.1'}</span>
          <span class="text-zinc-600">•</span>
          <span class="${pingColor} font-semibold">Ping: ${pingDisplay}</span>
        </div>
      </div>

      <!-- Action Buttons Row -->
      <div class="mt-3.5 pt-3 border-t border-zinc-800/80 flex items-center gap-2">
        <button 
          type="button" 
          onclick="openClubDetailView(${club.id})" 
          class="flex-1 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700/80 active:scale-95 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition border border-zinc-700/60 shadow-sm"
        >
          <span>Batafsil tekshirish</span>
          <span class="text-sky-400 text-sm leading-none">➔</span>
        </button>

        <button 
          type="button" 
          onclick="openRemoteCommandModal(${club.id}, '${club.name}')" 
          class="py-2 px-3 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 active:scale-95 text-sky-400 border border-sky-500/30 font-semibold text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
          title="Masofaviy Boshqaruv"
        >
          <span>⚙️</span>
          <span>Boshqaruv</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Qidiruv Paneli va Saralash Filtr Tugmalari
 */
function renderSearchAndSortingBar() {
  const currentSort = clubsListState.sortBy;
  const currentQuery = clubsListState.searchQuery;

  return `
    <div class="space-y-2.5">
      <!-- 1. Qidiruv input maydoni -->
      <div class="relative">
        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
        </div>
        <input 
          id="clubSearchInput" 
          type="search" 
          value="${currentQuery}"
          oninput="handleClubSearch(this.value)" 
          placeholder="Klub nomi yoki egasining ismi..." 
          class="w-full pl-10 pr-10 py-2.5 rounded-2xl glass-card text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
        />
        ${currentQuery ? `
          <button 
            type="button" 
            onclick="clearClubSearch()" 
            class="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-white"
          >
            ✕
          </button>
        ` : ''}
      </div>

      <!-- 2. Saralash Filtr Tugmalari (Pill Chips) -->
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        <span class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex-shrink-0 mr-1">
          Saralash:
        </span>

        <!-- Daromadi bo'yicha -->
        <button 
          type="button" 
          onclick="setClubsSort('REVENUE')" 
          class="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${currentSort === 'REVENUE' ? 'bg-sky-500 text-black font-bold shadow-md shadow-sky-500/20' : 'glass-card text-zinc-300 hover:text-white'}"
        >
          <span>💰</span>
          <span>Daromadi bo'yicha</span>
        </button>

        <!-- Kompyuterlar soni bo'yicha -->
        <button 
          type="button" 
          onclick="setClubsSort('PCS')" 
          class="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${currentSort === 'PCS' ? 'bg-sky-500 text-black font-bold shadow-md shadow-sky-500/20' : 'glass-card text-zinc-300 hover:text-white'}"
        >
          <span>🖥️</span>
          <span>Kompyuterlar soni</span>
        </button>

        <!-- Aloqa uzilganlar bo'yicha -->
        <button 
          type="button" 
          onclick="setClubsSort('OFFLINE')" 
          class="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${currentSort === 'OFFLINE' ? 'bg-rose-500 text-white font-bold shadow-md shadow-rose-500/25' : 'glass-card text-zinc-300 hover:text-rose-400'}"
        >
          <span>⚠️</span>
          <span>Aloqa uzilganlar</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Batafsil Klub Tekshiruv Modali (Drawer / Bottom Sheet)
 */
function renderClubDetailModal() {
  const club = clubsListState.selectedClub;
  if (!club) return '';

  const totalPcs = Number(club.total_workstations) || 0;
  const occupiedPcs = Number(club.occupied_pcs_now) || 0;
  const availablePcs = Math.max(0, totalPcs - occupiedPcs);
  const revenueFormatted = (Number(club.today_revenue) || 0).toLocaleString();
  const barRevenueFormatted = (Number(club.today_bar_revenue) || 0).toLocaleString();
  const isOnline = Boolean(club.is_online_now);
  const dutyCashier = club.duty_cashier || (club.owner_name ? (club.owner_name.split(' ')[0].toLowerCase() + '_admin') : 'Ali_admin');

  return `
    <div id="clubDetailModalContainer" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div class="glass-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 border border-zinc-700/60 max-h-[90vh] overflow-y-auto ios-scroll shadow-2xl">
        
        <!-- Drawer Handle (for mobile) -->
        <div class="w-12 h-1 bg-zinc-700 rounded-full mx-auto -mt-1 mb-2 sm:hidden"></div>

        <!-- Header -->
        <div class="flex items-start justify-between border-b border-zinc-800 pb-3">
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-base font-extrabold text-white tracking-tight">${club.name}</h3>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                ${club.city}
              </span>
            </div>
            <p class="text-xs text-zinc-400 mt-1 font-mono">
              Server: <span class="text-zinc-200">${club.server_lan_ip || '192.168.1.100'}</span> • v${club.server_version || '1.0.1'}
            </p>
          </div>
          <button type="button" onclick="closeClubDetailView()" class="w-8 h-8 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition">
            ✕
          </button>
        </div>

        <!-- Telemetry Status Banner -->
        <div class="p-3 rounded-2xl ${isOnline ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/20'} flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}"></span>
            <span class="text-xs font-bold ${isOnline ? 'text-emerald-400' : 'text-rose-400'}">
              ${isOnline ? 'Jonli Bog\'lanish Faol' : 'Server bilan aloqa uzilgan'}
            </span>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">
            Ping: ${isOnline ? (club.ping_ms || 18) + 'ms' : 'Noma\'lum'}
          </span>
        </div>

        <!-- Financial Summary -->
        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
            <span class="text-[10px] text-zinc-400 block">Bugungi Kassa Tushumi</span>
            <span class="text-sm font-bold font-mono text-emerald-400 mt-0.5 block">${revenueFormatted} UZS</span>
            <span class="text-[9px] text-zinc-500 mt-1 block">O'yin seanslari: ${club.today_sessions || 0} ta</span>
          </div>

          <div class="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
            <span class="text-[10px] text-zinc-400 block">Bar & Mini-Market</span>
            <span class="text-sm font-bold font-mono text-amber-400 mt-0.5 block">${barRevenueFormatted} UZS</span>
            <span class="text-[9px] text-zinc-500 mt-1 block">Yaxna ichimliklar & snaklar</span>
          </div>
        </div>

        <!-- Workstation Capacity -->
        <div class="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-2">
          <div class="flex justify-between items-center text-xs">
            <span class="text-zinc-300 font-semibold">Kompyuterlar sig'imi:</span>
            <span class="font-mono text-white font-bold">${occupiedPcs} band / ${availablePcs} bo'sh (${totalPcs} ta jami)</span>
          </div>
          <div class="w-full h-2 bg-zinc-800 rounded-full overflow-hidden flex">
            <div class="h-full bg-sky-500" style="width: ${(occupiedPcs / Math.max(1, totalPcs)) * 100}%"></div>
            <div class="h-full bg-emerald-500" style="width: ${(availablePcs / Math.max(1, totalPcs)) * 100}%"></div>
          </div>
          <div class="flex items-center justify-between text-[10px] text-zinc-400 pt-1">
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-sky-500"></span> Band (${occupiedPcs})</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-emerald-500"></span> Bo'sh (${availablePcs})</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-zinc-600"></span> Oflayn</span>
          </div>
        </div>

        <!-- Club Administration Contacts -->
        <div class="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-zinc-400">Filial rahbari:</span>
            <span class="text-white font-medium">${club.owner_name}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-zinc-400">Navbatchi kassir:</span>
            <span class="text-sky-300 font-mono font-semibold">${dutyCashier}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-zinc-400">Litsenziya muddati:</span>
            <span class="text-zinc-300 font-mono">${club.license_expires_at ? club.license_expires_at.slice(0, 10) : '2026-12-31'}</span>
          </div>
        </div>

        <!-- Quick Actions in Modal -->
        <div class="flex items-center gap-2 pt-2">
          <a 
            href="tel:${club.owner_phone || '+998901112233'}" 
            onclick="triggerHaptic(15)" 
            class="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-600/20"
          >
            <span>📞</span>
            <span>Qo'ng'iroq qilish</span>
          </a>

          <button 
            type="button" 
            onclick="closeClubDetailView(); openRemoteCommandModal(${club.id}, '${club.name}')" 
            class="flex-1 py-2.5 px-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 active:scale-95 text-sky-400 border border-sky-500/40 font-bold text-xs flex items-center justify-center gap-2 transition"
          >
            <span>⚙️</span>
            <span>Masofaviy Buyruq</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * 4. Asosiy Klublar Ro'yxati Ekrani (Clubs Directory Main View)
 */
export function renderClubsDirectoryView() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;

  const filteredClubs = getFilteredAndSortedClubs();
  const totalClubs = clubsListState.allClubs.length;
  const onlineCount = clubsListState.allClubs.filter(c => c.is_online_now).length;

  container.innerHTML = `
    <div class="space-y-4 pb-20 animate-fade-in">
      <!-- Top Title & Live Counter -->
      <div class="flex items-center justify-between pt-1">
        <div>
          <h2 class="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>Klublar Katalogi</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
              ${filteredClubs.length} ta
            </span>
          </h2>
          <p class="text-[11px] text-zinc-400 mt-0.5">
            Barcha ulangan filiallar monitoringi va boshqaruvi
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button 
            type="button" 
            onclick="openAddClubModal()" 
            class="py-2 px-3 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-300 hover:to-indigo-400 active:scale-95 text-black font-extrabold text-xs flex items-center gap-1.5 shadow-lg shadow-sky-400/20 transition"
          >
            <span>+</span>
            <span>Yangi Klub</span>
          </button>
          <button 
            type="button" 
            onclick="refreshClubsDirectory()" 
            class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-zinc-400 hover:text-white active:scale-90 transition"
            title="Qayta yuklash"
          >
            <svg class="w-4 h-4 ${clubsListState.isLoading ? 'animate-spin text-sky-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Live Network Summary Pill -->
      <div class="p-3 rounded-2xl glass-card border border-zinc-800 flex items-center justify-between text-xs">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span class="text-zinc-300 font-medium">Faol Tarmoq:</span>
        </div>
        <div class="font-mono text-zinc-200">
          <strong class="text-emerald-400">${onlineCount} onlayn</strong> / <span class="text-zinc-400">${totalClubs} ta filial</span>
        </div>
      </div>

      <!-- Search and Sorting Bar -->
      ${renderSearchAndSortingBar()}

      <!-- Clubs Cards List -->
      <div id="clubsCardsContainer" class="space-y-3 pt-1">
        ${filteredClubs.length > 0 ? (
          filteredClubs.map(c => renderClubCard(c)).join('')
        ) : (
          `
            <div class="glass-card rounded-2xl p-8 text-center space-y-3">
              <div class="w-12 h-12 rounded-2xl bg-zinc-800/80 flex items-center justify-center text-2xl mx-auto text-zinc-500">
                🔍
              </div>
              <div>
                <h4 class="text-sm font-bold text-white">Mos keluvchi filial topilmadi</h4>
                <p class="text-xs text-zinc-400 mt-1 max-w-xs mx-auto">
                  "${clubsListState.searchQuery}" so'rovi bo'yicha hech qanday natija mavjud emas.
                </p>
              </div>
              <button 
                type="button" 
                onclick="clearClubSearch()" 
                class="px-4 py-2 rounded-xl bg-sky-500 text-black text-xs font-bold active:scale-95 transition"
              >
                Qidiruvni tozalash
              </button>
            </div>
          `
        )}
      </div>
    </div>

    <!-- Club Detail Modal Injection -->
    ${renderClubDetailModal()}
  `;
}

// ============================================================================
// 4. GLOBAL INTERACTION HANDLERS (WINDOW EXPORTS)
// ============================================================================

window.handleClubSearch = function(query) {
  clubsListState.searchQuery = query;
  renderClubsDirectoryView();
};

window.clearClubSearch = function() {
  triggerHaptic(10);
  clubsListState.searchQuery = '';
  renderClubsDirectoryView();
};

window.setClubsSort = function(sortBy) {
  triggerHaptic(15);
  clubsListState.sortBy = sortBy;
  renderClubsDirectoryView();
};

window.openClubDetailView = function(clubId) {
  triggerHaptic(20);
  if (typeof window.openClubDetailInspector === 'function') {
    return window.openClubDetailInspector(clubId);
  }
  const club = clubsListState.allClubs.find(c => c.id === Number(clubId));
  if (club) {
    clubsListState.selectedClub = club;
    renderClubsDirectoryView();
  }
};

window.closeClubDetailView = function() {
  triggerHaptic(10);
  clubsListState.selectedClub = null;
  renderClubsDirectoryView();
};

window.refreshClubsDirectory = async function() {
  triggerHaptic(15);
  showDirectoryToast("Filiallar telemetriyasi yangilanmoqda...");
  await fetchClubsDirectory();
  renderClubsDirectoryView();
  showDirectoryToast("✓ Barcha klublar holati yangilandi");
};

function triggerHaptic(pattern = 15) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function showDirectoryToast(message) {
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

// ============================================================================
// 5. INITIALIZER
// ============================================================================

export async function initClubsDirectory() {
  await fetchClubsDirectory();
  renderClubsDirectoryView();
}
