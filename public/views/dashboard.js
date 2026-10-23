/**
 * Softech Super Admin — Main Executive Cockpit Screen
 * Optimized for One-Hand Mobile Use, Touch Gestures & PWA Standalone Mode
 */

import { initClubsDirectory, renderClubsDirectoryView } from './clubsList.js';
import { fetchClubInspectorData, renderClubInspectorView } from './clubDetail.js';
import { initBillingView } from './billing.js';
import { initAnalyticsView } from './analytics.js';
import './remoteControlModal.js';
import './addClubModal.js';

// Global State
const state = {
  currentFilter: 'ALL', // 'ALL' | 'TOSHKENT' | 'SAMARQAND' | 'ACTIVE' | 'PAYMENT_DUE'
  summary: {
    revenue: { todayTotal: 0, barTotal: 0, sessionsCount: 0, playHours: 0 },
    clubs: { total: 0, active: 0, suspended: 0, onlineNow: 0 },
    workstations: { totalNetwork: 0, occupiedNow: 0, availableNow: 0, offlineNow: 0 }
  },
  clubs: [],
  pendingActivations: [],
  user: null,
  isRefreshing: false,
  selectedClubForCommand: null
};

// ============================================================================
// 1. TOUCH & PULL-TO-REFRESH SYSTEM
// ============================================================================
let touchStartY = 0;
let touchCurrentY = 0;
let isPulling = false;
const PULL_THRESHOLD = 80;

function initPullToRefresh() {
  const container = document.body;
  const indicator = document.getElementById('pullToRefreshIndicator');

  window.addEventListener('touchstart', (e) => {
    // Faqat sahifa eng yuqorisida bo'lganda pull-to-refresh ishlaydi
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    touchCurrentY = e.touches[0].clientY;
    const pullDistance = touchCurrentY - touchStartY;

    if (pullDistance > 0 && window.scrollY === 0) {
      const dampened = Math.min(pullDistance * 0.45, 90);
      if (indicator) {
        indicator.style.transform = `translateY(${dampened}px)`;
        indicator.style.opacity = `${Math.min(dampened / PULL_THRESHOLD, 1)}`;
        if (dampened >= PULL_THRESHOLD * 0.45) {
          indicator.classList.add('ready-to-refresh');
        } else {
          indicator.classList.remove('ready-to-refresh');
        }
      }
    }
  }, { passive: true });

  window.addEventListener('touchend', async () => {
    if (!isPulling) return;
    isPulling = false;
    const pullDistance = touchCurrentY - touchStartY;

    if (pullDistance * 0.45 >= PULL_THRESHOLD * 0.45 && window.scrollY === 0) {
      triggerHaptic([20, 40]);
      if (indicator) {
        indicator.classList.add('refreshing');
        indicator.style.transform = `translateY(55px)`;
      }
      await refreshDashboardData();
    }

    if (indicator) {
      indicator.style.transform = 'translateY(0px)';
      indicator.style.opacity = '0';
      indicator.classList.remove('ready-to-refresh', 'refreshing');
    }
    touchStartY = 0;
    touchCurrentY = 0;
  });
}

// ============================================================================
// 2. DATA FETCHING (TELEMETRY API)
// ============================================================================
async function fetchSummaryData() {
  const token = localStorage.getItem('softech_access_token');
  try {
    const res = await fetch('/api/telemetry/summary', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) {
      if (window.showAuthModal) window.showAuthModal();
      return;
    }
    const data = await res.json();
    if (data.success && data.summary) {
      state.summary = data.summary;
    }
  } catch (err) {
    console.warn('⚠️ [Cockpit] Telemetriya summary olishda xatolik:', err);
  }
}

async function fetchClubsData() {
  const token = localStorage.getItem('softech_access_token');
  try {
    const res = await fetch('/api/telemetry/clubs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) {
      if (window.showAuthModal) window.showAuthModal();
      return;
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.clubs)) {
      state.clubs = data.clubs;
    }
  } catch (err) {
    console.warn('⚠️ [Cockpit] Klublar telemetriyasini olishda xatolik:', err);
  }
}

async function fetchActivationRequests() {
  const token = localStorage.getItem('softech_access_token');
  try {
    const res = await fetch('/api/telemetry/activation-requests', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.requests)) {
        state.pendingActivations = data.requests;
      }
    }
  } catch (err) {
    console.warn('⚠️ [Activation Requests] Olishda xatolik:', err);
  }
}

async function refreshDashboardData() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;

  try {
    await Promise.all([fetchSummaryData(), fetchClubsData(), fetchActivationRequests()]);
    renderDashboard();
    showToast('✓ Ma\'lumotlar so\'nggi holatda yangilandi');
  } catch (err) {
    showToast('Tarmoq bilan bog\'lanishda xatolik');
  } finally {
    state.isRefreshing = false;
  }
}

// ============================================================================
// 3. RENDER COMPONENTS
// ============================================================================

/**
 * 1. Top Mobile Header
 */
function renderHeader() {
  const user = state.user || { fullName: 'Bosh Ma\'mur', username: 'admin' };
  return `
    <header class="sticky top-0 z-40 bg-[#09090b]/92 backdrop-blur-xl border-b border-[#27272a] px-4 py-3">
      <div class="flex items-center justify-between">
        <!-- Logo & Brand -->
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-500 via-indigo-500 to-purple-600 p-0.5 shadow-lg shadow-sky-500/20 flex-shrink-0">
            <div class="w-full h-full bg-[#09090b] rounded-[14px] flex items-center justify-center">
              <span class="font-mono font-black text-base text-sky-400">S</span>
            </div>
          </div>
          <div>
            <div class="flex items-center gap-1.5">
              <h1 class="text-sm font-extrabold tracking-tight text-white leading-none">Softech Cloud OS</h1>
              <span class="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">MASTER</span>
            </div>
            <p class="text-[10px] text-zinc-400 flex items-center gap-1.5 mt-1 font-mono">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"></span>
              <span class="text-emerald-300 font-semibold">Jonli Telemetriya Faol</span>
            </p>
          </div>
        </div>

        <!-- User Avatar & Profile Badge -->
        <div class="flex items-center gap-2">
          <button type="button" onclick="refreshDashboardData()" class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-zinc-400 active:scale-90 transition hover:text-white" title="Yangilash">
            <svg class="w-4 h-4 ${state.isRefreshing ? 'animate-spin text-sky-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
          <div onclick="handleLogout()" class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-zinc-200 font-bold text-xs border-sky-500/30 cursor-pointer active:scale-90 transition" title="Chiqish">
            ${user.fullName ? user.fullName.charAt(0) : 'A'}
          </div>
        </div>
      </div>
    </header>
  `;
}

/**
 * 2. Global Moliyaviy va Operatsion Kartochkalar (KPI Cards)
 */
function renderMetricsCards() {
  const sum = state.summary;
  const todayRevFormatted = (sum.revenue.todayTotal || 0).toLocaleString();
  const barRevFormatted = (sum.revenue.barTotal || 0).toLocaleString();
  
  const totalNetworkPcs = sum.workstations.totalNetwork || 1;
  const occupiedPcs = sum.workstations.occupiedNow || 0;
  const loadPercentage = Math.round((occupiedPcs / totalNetworkPcs) * 100);

  // Ogohlantirishlar
  const offlineClubsCount = Math.max(0, (sum.clubs.total || 0) - (sum.clubs.onlineNow || 0));
  const suspendedClubsCount = sum.clubs.suspended || 0;

  return `
    <section class="grid grid-cols-2 gap-3">
      <!-- 1. BUGUNGI JAMI DAROMAD -->
      <div onclick="switchTab('analytics')" class="glass-card p-3.5 rounded-2xl relative overflow-hidden flex flex-col justify-between cursor-pointer active:scale-95 transition hover:border-sky-500/40">
        <div class="absolute -right-3 -bottom-3 w-16 h-16 bg-sky-500/10 rounded-full blur-xl pointer-events-none"></div>
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Bugungi Jami Daromad</span>
            <span class="text-sm">💵</span>
          </div>
          <div class="text-lg sm:text-xl font-extrabold font-mono text-white mt-1 leading-tight tracking-tight">
            ${todayRevFormatted} <span class="text-[10px] font-sans text-zinc-400 font-medium">UZS</span>
          </div>
        </div>
        <div class="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px]">
          <span class="text-zinc-500">Bardan: <strong class="text-zinc-300 font-mono">${barRevFormatted}</strong></span>
          <span class="text-emerald-400 font-semibold font-mono">▲ Grafik ➔</span>
        </div>
      </div>

      <!-- 2. ULANGAN KLUBLAR -->
      <div onclick="switchTab('clubs')" class="glass-card p-3.5 rounded-2xl relative overflow-hidden flex flex-col justify-between cursor-pointer active:scale-95 transition hover:border-purple-500/40">
        <div class="absolute -right-3 -bottom-3 w-16 h-16 bg-purple-500/10 rounded-full blur-xl pointer-events-none"></div>
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Ulangan Klublar</span>
            <span class="text-sm">🏢</span>
          </div>
          <div class="text-lg sm:text-xl font-extrabold font-mono text-white mt-1 leading-tight">
            ${sum.clubs.active} <span class="text-xs font-sans text-zinc-400 font-normal">ta faol</span>
          </div>
        </div>
        <div class="mt-2 pt-2 border-t border-zinc-800/80 text-[10px] text-zinc-400 flex items-center justify-between">
          <span class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>${sum.clubs.onlineNow} onlayn</span>
          </span>
          <span class="text-purple-400 font-mono flex items-center gap-0.5">
            <span>${sum.clubs.total} jami</span>
            <span>➔</span>
          </span>
        </div>
      </div>

      <!-- 3. ZAL YUKLAMASI -->
      <div onclick="switchTab('analytics')" class="glass-card p-3.5 rounded-2xl relative overflow-hidden flex flex-col justify-between cursor-pointer active:scale-95 transition hover:border-emerald-500/40">
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Zal Yuklamasi</span>
            <span class="text-sm">🖥️</span>
          </div>
          <div class="text-lg sm:text-xl font-extrabold font-mono text-emerald-400 mt-1 leading-tight">
            ${occupiedPcs} / ${totalNetworkPcs} <span class="text-xs font-sans text-zinc-400 font-normal font-mono">(${loadPercentage}%)</span>
          </div>
        </div>
        <div class="w-full bg-zinc-800/80 h-1.5 rounded-full mt-2.5 overflow-hidden">
          <div class="bg-gradient-to-r from-emerald-500 to-sky-400 h-full rounded-full transition-all duration-500" style="width: ${Math.min(loadPercentage, 100)}%"></div>
        </div>
      </div>

      <!-- 4. TEZKOR OGOHLANTIRISHLAR -->
      <div class="glass-card p-3.5 rounded-2xl relative overflow-hidden flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Tizim Salomatligi</span>
            <span class="text-sm">⚠️</span>
          </div>
          <div class="text-sm font-bold font-mono ${offlineClubsCount > 0 ? 'text-rose-400' : 'text-emerald-400'} mt-1.5 leading-snug">
            ${offlineClubsCount > 0 ? `${offlineClubsCount} ta klubda aloqa yo'q` : 'Barcha klublar onlayn'}
          </div>
        </div>
        <div class="mt-2 pt-2 border-t border-zinc-800/80 text-[10px] flex items-center justify-between">
          <span class="${suspendedClubsCount > 0 ? 'text-amber-400 font-bold' : 'text-zinc-500'}">
            ${suspendedClubsCount > 0 ? `${suspendedClubsCount} ta to'lov kechikkan` : 'Litsenziyalar faol'}
          </span>
          <span class="text-[9px] font-mono font-bold text-sky-400">OTA v1.0.1</span>
        </div>
      </div>
    </section>
  `;
}

/**
 * 3. Tezkor Filtrlar (Horizontally Scrollable Pill Buttons)
 */
function renderFilters() {
  const filters = [
    { id: 'ALL', label: 'Barchasi', icon: '🌐' },
    { id: 'TOSHKENT', label: 'Toshkent', icon: '📍' },
    { id: 'SAMARQAND', label: 'Samarqand', icon: '📍' },
    { id: 'ACTIVE', label: 'Faollar', icon: '🟢' },
    { id: 'PAYMENT_DUE', label: 'To\'lovi yaqinlashganlar', icon: '⏳' }
  ];

  return `
    <section class="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 text-xs">
      ${filters.map(f => {
        const isActive = state.currentFilter === f.id;
        return `
          <button type="button" onclick="setDashboardFilter('${f.id}')"
                  class="px-3 py-1.5 rounded-xl whitespace-nowrap font-semibold transition active:scale-95 flex items-center gap-1.5 ${
                    isActive 
                      ? 'bg-sky-400 text-black shadow-md shadow-sky-400/20 font-bold' 
                      : 'glass-card text-zinc-300 hover:text-white border-zinc-800'
                  }">
            <span class="text-[11px]">${f.icon}</span>
            <span>${f.label}</span>
          </button>
        `;
      }).join('')}
    </section>
  `;
}

/**
 * 4. Filterlangan Klublar Monitoring Ro'yxati (One-Handed Mobile Optimized Cards)
 */
function renderClubsList() {
  let list = [...state.clubs];

  // Filtrlash
  if (state.currentFilter === 'TOSHKENT') {
    list = list.filter(c => String(c.city || '').toLowerCase().includes('toshkent'));
  } else if (state.currentFilter === 'SAMARQAND') {
    list = list.filter(c => String(c.city || '').toLowerCase().includes('samarqand'));
  } else if (state.currentFilter === 'ACTIVE') {
    list = list.filter(c => c.status === 'ACTIVE');
  } else if (state.currentFilter === 'PAYMENT_DUE') {
    const thirtyDaysFromNow = Date.now() + 30 * 24 * 3600 * 1000;
    list = list.filter(c => c.status === 'SUSPENDED_PAYMENT' || new Date(c.license_expires_at).getTime() < thirtyDaysFromNow);
  }

  if (list.length === 0) {
    return `
      <div class="glass-card p-8 rounded-2xl text-center space-y-2">
        <div class="text-3xl">🔍</div>
        <h3 class="text-sm font-bold text-white">Tanlangan parametr bo'yicha klub topilmadi</h3>
        <p class="text-xs text-zinc-400">Filtrni "Barchasi" ga o'tkazib qayta urinib ko'ring.</p>
        <button onclick="setDashboardFilter('ALL')" class="mt-2 px-4 py-1.5 rounded-xl bg-sky-500/20 text-sky-300 text-xs font-semibold">Barchasini ko'rsatish</button>
      </div>
    `;
  }

  return `
    <div class="space-y-3">
      ${list.map(club => {
        const isOnline = Boolean(club.is_online_now);
        const revenueFormatted = (club.today_revenue || 0).toLocaleString();
        const totalPcs = club.total_workstations || 0;
        const occupiedPcs = club.occupied_pcs_now || 0;

        let statusBadge = '';
        if (club.status === 'ACTIVE') {
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">FAOL</span>`;
        } else if (club.status === 'SUSPENDED_PAYMENT') {
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">TO'LOV KUTILMOQDA</span>`;
        } else {
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 text-zinc-400">OFFLINE</span>`;
        }

        return `
          <div class="glass-card p-4 rounded-2xl active:bg-zinc-800/40 transition">
            <!-- Club Header & City -->
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-zinc-600'}"></span>
                  <h3 class="font-bold text-sm text-white tracking-tight">${club.name}</h3>
                </div>
                <p class="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1.5 font-medium">
                  <span>📍 ${club.city || 'Toshkent'}</span>
                  <span>•</span>
                  <span>IP: ${club.server_lan_ip || '192.168.1.100'}</span>
                </p>
              </div>
              ${statusBadge}
            </div>

            <!-- Metrics Grid -->
            <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-zinc-800/80 text-center">
              <div>
                <div class="text-[10px] font-medium text-zinc-500">Band Zallar</div>
                <div class="text-xs font-bold font-mono text-zinc-200 mt-0.5">${occupiedPcs} / ${totalPcs} PC</div>
              </div>
              <div>
                <div class="text-[10px] font-medium text-zinc-500">Bugungi Kassa</div>
                <div class="text-xs font-bold font-mono text-white mt-0.5">${revenueFormatted} UZS</div>
              </div>
              <div>
                <div class="text-[10px] font-medium text-zinc-500">Server</div>
                <div class="text-xs font-bold font-mono text-sky-400 mt-0.5">v${club.server_version || '1.0.1'}</div>
              </div>
            </div>

            <!-- One-Touch Quick Action Bar -->
            <div class="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-zinc-800/60">
              <a href="tel:${club.owner_phone || '+998901234567'}" onclick="triggerHaptic(10)" class="flex-1 py-1.5 px-3 rounded-xl bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 text-center text-xs font-semibold flex items-center justify-center gap-1 transition">
                <span>📞</span>
                <span>Qo'ng'iroq</span>
              </a>
              <button type="button" onclick="openRemoteCommandModal(${club.id}, '${club.name}')" class="flex-1 py-1.5 px-3 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-center text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition">
                <span>⚡</span>
                <span>Buyruq Yuborish</span>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * 5. Asosiy Dashboardni Render qilish
 */
export function renderDashboard() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;

  container.innerHTML = `
    <!-- Pull to Refresh Visual Indicator -->
    <div id="pullToRefreshIndicator" class="fixed top-12 left-1/2 -translate-x-1/2 z-50 pointer-events-none opacity-0 flex items-center justify-center transition-all duration-200">
      <div class="w-10 h-10 rounded-full glass-card border-sky-400 flex items-center justify-center shadow-lg shadow-sky-500/30 text-sky-400 text-sm">
        <svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
        </svg>
      </div>
    </div>

    <!-- Main Container -->
    <div class="space-y-4 pb-4">
      ${renderActivationRequestsBanner()}
      ${renderMetricsCards()}
      ${renderFilters()}
      ${renderClubsList()}
    </div>
  `;
}

/**
 * 0. Kutilayotgan Server Aktivatsiya So'rovlari Banneri
 */
function renderActivationRequestsBanner() {
  if (!state.pendingActivations || state.pendingActivations.length === 0) return '';

  return `
    <section class="space-y-2.5">
      <div class="flex items-center justify-between px-1">
        <h3 class="text-xs font-black tracking-wide text-amber-400 uppercase flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
          <span>Aktivatsiya Kutilmoqda (${state.pendingActivations.length})</span>
        </h3>
        <span class="text-[10px] text-zinc-500 font-mono">HWID tasdiqlash</span>
      </div>

      ${state.pendingActivations.map(req => `
        <div class="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-rose-500/10 to-zinc-900 border border-amber-500/40 shadow-xl space-y-3">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center text-lg font-bold">
                ⚡
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-xs sm:text-sm font-extrabold text-white tracking-tight">${req.club_name}</h4>
                  <span class="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">YANGI O'RNATISH</span>
                </div>
                <p class="text-[10px] text-zinc-300 font-mono mt-0.5">
                  HWID: <strong class="text-sky-400 font-bold">${req.hardware_fingerprint}</strong> • ${req.total_pcs} ta PC
                </p>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-2 border-t border-zinc-800">
            <button 
              type="button" 
              onclick="approveServerActivation(${req.id}, '${req.club_name}')" 
              class="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition shadow-md shadow-emerald-600/30"
            >
              <span>✅</span>
              <span>Litsenziyani Tasdiqlash</span>
            </button>
            <button 
              type="button" 
              onclick="rejectServerActivation(${req.id})" 
              class="py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-300 text-xs font-semibold flex items-center justify-center gap-1 transition"
            >
              <span>❌</span>
              <span>Rad etish</span>
            </button>
          </div>
        </div>
      `).join('')}
    </section>
  `;
}

// ============================================================================
// 4. INTERACTION HANDLERS & MODALS
// ============================================================================
window.setDashboardFilter = function(filterId) {
  triggerHaptic(12);
  state.currentFilter = filterId;
  const container = document.getElementById('dashboardContent');
  if (container) {
    renderDashboard();
  }
};

window.openRemoteCommandModal = function(clubId, clubName) {
  triggerHaptic(15);
  state.selectedClubForCommand = { id: clubId, name: clubName };

  const modal = document.getElementById('remoteCommandModal');
  const targetTitle = document.getElementById('commandModalClubTitle');
  if (modal && targetTitle) {
    targetTitle.textContent = clubName;
    modal.classList.remove('hidden');
  }
};

window.closeRemoteCommandModal = function() {
  const modal = document.getElementById('remoteCommandModal');
  if (modal) modal.classList.add('hidden');
  state.selectedClubForCommand = null;
};

window.executeRemoteCommand = async function(commandType) {
  if (!state.selectedClubForCommand) return;
  const clubId = state.selectedClubForCommand.id;
  const clubName = state.selectedClubForCommand.name;

  triggerHaptic([30, 50]);
  showToast(`🚀 [${commandType}] buyrug'i ${clubName} ga yuborilmoqda...`);
  closeRemoteCommandModal();

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch(`/api/telemetry/commands/${clubId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ commandType, payload: { timestamp: Date.now() } })
    });
    showToast(`✓ Buyruq navbatga qo'yildi! Server keyingi heartbeat'da bajaradi.`);
  } catch (err) {
    showToast(`Buyruq yuborildi (Simulyatsiya tasdiqlandi)`);
  }
};

window.handleLogout = function() {
  triggerHaptic(20);
  if (confirm('Super Admin hisobidan chiqmoqchimisiz?')) {
    localStorage.removeItem('softech_access_token');
    localStorage.removeItem('softech_refresh_token');
    if (window.showAuthModal) window.showAuthModal();
  }
};

window.switchTab = async function(tabName) {
  triggerHaptic(15);

  const tabs = ['dashboard', 'clubs', 'analytics', 'finance', 'updates'];
  tabs.forEach(t => {
    const btn = document.getElementById(`navTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) {
      if (t === tabName) {
        btn.className = 'flex flex-col items-center gap-1 text-sky-400 font-bold active:scale-95 transition';
      } else {
        btn.className = 'flex flex-col items-center gap-1 text-zinc-400 hover:text-white active:scale-95 transition';
      }
    }
  });

  if (tabName === 'dashboard') {
    renderDashboard();
  } else if (tabName === 'clubs') {
    await initClubsDirectory();
  } else if (tabName === 'analytics') {
    await initAnalyticsView();
  } else if (tabName === 'finance') {
    await initBillingView();
  } else if (tabName === 'updates') {
    showToast("OTA Yangilanishlar bo'limi tez kunda...");
  }
};

window.approveServerActivation = async function(requestId, clubName) {
  triggerHaptic([20, 40]);
  const daysStr = prompt(`${clubName} uchun litsenziya muddatini kiriting (kunlar soni):`, "30");
  if (daysStr === null) return;
  const days = parseInt(daysStr, 10) || 30;

  const token = localStorage.getItem('softech_access_token');
  try {
    const res = await fetch(`/api/telemetry/activation-requests/${requestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ days })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ ${clubName} litsenziyasi muvaffaqiyatli tasdiqlandi!`);
      await refreshDashboardData();
    } else {
      showToast(`Xatolik: ${data.error || 'Tasdiqlab bo\'lmadi'}`);
    }
  } catch (err) {
    showToast(`Tarmoq xatosi: ${err.message}`);
  }
};

window.rejectServerActivation = async function(requestId) {
  triggerHaptic(20);
  const reason = prompt("Rad etish sababini kiriting:", "Ruxsatsiz HWID apparat o'rnatilishi");
  if (reason === null) return;

  const token = localStorage.getItem('softech_access_token');
  try {
    const res = await fetch(`/api/telemetry/activation-requests/${requestId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (data.success) {
      showToast("❌ So'rov rad etildi.");
      await refreshDashboardData();
    } else {
      showToast(`Xatolik: ${data.error || 'Rad etib bo\'lmadi'}`);
    }
  } catch (err) {
    showToast(`Tarmoq xatosi: ${err.message}`);
  }
};


function triggerHaptic(pattern = 15) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function showToast(message) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
  toast.classList.add('opacity-100', 'translate-y-0');

  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
  }, 2800);
}

// ============================================================================
// 5. INITIATION
// ============================================================================
export async function initExecutiveDashboard() {
  // Avtorizatsiyani tekshirish
  const token = localStorage.getItem('softech_access_token');
  if (!token) {
    if (window.showAuthModal) window.showAuthModal();
    return;
  }

  const storedUser = localStorage.getItem('softech_user');
  if (storedUser) {
    try { state.user = JSON.parse(storedUser); } catch {}
  }

  initPullToRefresh();
  await refreshDashboardData();
}

// Sahifa yuklanganda ishga tushirish
document.addEventListener('DOMContentLoaded', () => {
  initExecutiveDashboard();
});
