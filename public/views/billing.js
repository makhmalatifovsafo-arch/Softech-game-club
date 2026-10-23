/**
 * Softech Super Admin — SaaS Subscription & Billing Tracker
 * Location: SoftechCloudAdmin/public/views/billing.js
 * Optimized for One-Hand Mobile Use, Recurring Revenue Tracking & Payment Processing
 */

// Global Billing State
export const billingState = {
  summary: {
    totalClubs: 0,
    mrr: 0,
    currentMonthCollected: 0,
    currentMonthPaymentsCount: 0,
    statusCounts: { green: 0, yellow: 0, red: 0 },
    recentPayments: []
  },
  clubs: [],
  selectedClubForPayment: null,
  selectedClubForTariff: null,
  activeFilter: 'ALL', // 'ALL' | 'GREEN' | 'YELLOW' | 'RED'
  isLoading: false
};

// ============================================================================
// 1. DATA FETCHING (BILLING API)
// ============================================================================

/**
 * Fetch billing summary and club subscriptions
 */
export async function fetchBillingData() {
  const token = localStorage.getItem('softech_access_token');
  if (!token) {
    window.location.href = '/login';
    return;
  }

  billingState.isLoading = true;
  try {
    const [summaryRes, clubsRes] = await Promise.all([
      fetch('/api/billing/summary', { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch('/api/billing/clubs', { headers: { 'Authorization': `Bearer ${token}` } })
    ]);

    if (summaryRes.status === 401 || clubsRes.status === 401) {
      window.location.href = '/login';
      return;
    }

    const summaryData = await summaryRes.json();
    const clubsData = await clubsRes.json();

    if (summaryData.success && summaryData.summary) {
      billingState.summary = summaryData.summary;
    }
    if (clubsData.success && Array.isArray(clubsData.clubs)) {
      billingState.clubs = clubsData.clubs;
    }
  } catch (err) {
    console.error('❌ [Billing] Ma\'lumotlarni yuklashda xatolik:', err);
    showBillingToast("Billing ma'lumotlarini yuklab bo'lmadi");
  } finally {
    billingState.isLoading = false;
  }
}

// ============================================================================
// 2. UI RENDER SUB-COMPONENTS
// ============================================================================

/**
 * 1. Top Financial KPI Cards (MRR & Status Counts)
 */
function renderBillingKpiCards() {
  const sum = billingState.summary;
  const mrrFormatted = (sum.mrr || 0).toLocaleString();
  const collectedFormatted = (sum.currentMonthCollected || 0).toLocaleString();

  return `
    <div class="space-y-3">
      <!-- MRR & Total Revenue Highlight Card -->
      <div class="glass-card rounded-3xl p-4.5 border border-sky-500/25 glow-cyan relative overflow-hidden">
        <div class="absolute -right-8 -bottom-8 w-28 h-28 bg-sky-500/10 rounded-full blur-2xl pointer-events-none"></div>

        <div class="flex items-center justify-between">
          <span class="text-[10px] uppercase font-mono font-bold text-sky-400 tracking-wider">
            SaaS Oylik Obuna Prognozi (MRR)
          </span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-sky-500/20 text-sky-300">
            ${sum.totalClubs} ta filial
          </span>
        </div>

        <div class="mt-2 flex items-baseline justify-between">
          <div>
            <div class="text-xl sm:text-2xl font-black font-mono text-white tracking-tight">
              ${mrrFormatted} <span class="text-xs font-sans text-zinc-400 font-normal">UZS / oy</span>
            </div>
            <p class="text-[11px] text-zinc-400 mt-0.5">
              Bu oy tushgan to'lovlar: <strong class="text-emerald-400 font-mono">${collectedFormatted} UZS</strong> (${sum.currentMonthPaymentsCount} ta)
            </p>
          </div>
          <span class="text-2xl">💳</span>
        </div>
      </div>

      <!-- License Status Tickers (Yashil, Sariq, Qizil) -->
      <div class="grid grid-cols-3 gap-2">
        <!-- 🟢 Yashil: To'lov qilingan -->
        <button 
          type="button" 
          onclick="setBillingFilter('GREEN')" 
          class="p-2.5 rounded-2xl glass-card border transition active:scale-95 text-left flex flex-col justify-between ${billingState.activeFilter === 'GREEN' ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-zinc-800'}"
        >
          <div class="flex items-center justify-between">
            <span class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"></span>
            <span class="text-[9px] font-mono text-zinc-400">FAOL</span>
          </div>
          <div class="mt-2">
            <div class="text-base font-black font-mono text-emerald-400">${sum.statusCounts.green} ta</div>
            <div class="text-[9px] text-zinc-400 font-medium">To'lov qilingan</div>
          </div>
        </button>

        <!-- 🟡 Sariq: Muddati yaqinlashmoqda (3 kun) -->
        <button 
          type="button" 
          onclick="setBillingFilter('YELLOW')" 
          class="p-2.5 rounded-2xl glass-card border transition active:scale-95 text-left flex flex-col justify-between ${billingState.activeFilter === 'YELLOW' ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-800'}"
        >
          <div class="flex items-center justify-between">
            <span class="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse"></span>
            <span class="text-[9px] font-mono text-amber-400">3 KUN</span>
          </div>
          <div class="mt-2">
            <div class="text-base font-black font-mono text-amber-400">${sum.statusCounts.yellow} ta</div>
            <div class="text-[9px] text-zinc-400 font-medium">To'lov yaqin</div>
          </div>
        </button>

        <!-- 🔴 Qizil: Muddati o'tgan (Qarzdor) -->
        <button 
          type="button" 
          onclick="setBillingFilter('RED')" 
          class="p-2.5 rounded-2xl glass-card border transition active:scale-95 text-left flex flex-col justify-between ${billingState.activeFilter === 'RED' ? 'border-rose-500/50 bg-rose-500/10' : 'border-zinc-800'}"
        >
          <div class="flex items-center justify-between">
            <span class="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
            <span class="text-[9px] font-mono text-rose-400">QARZDOR</span>
          </div>
          <div class="mt-2">
            <div class="text-base font-black font-mono text-rose-400">${sum.statusCounts.red} ta</div>
            <div class="text-[9px] text-zinc-400 font-medium">To'xtatilgan</div>
          </div>
        </button>
      </div>
    </div>
  `;
}

/**
 * 2. Alohida Klub Obunasi Kartochkasi
 */
function renderClubBillingCard(club) {
  const lic = club.licenseStatus;
  const tariff = club.tariff;
  const isPerPc = tariff.type === 'PER_PC';

  // Litsenziya holati badgesi
  let statusBadge = '';
  if (lic.code === 'GREEN') {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        <span>To'lov qilingan (${lic.daysLeft} kun)</span>
      </span>
    `;
  } else if (lic.code === 'YELLOW') {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
        <span>${lic.daysLeft} kun qoldi!</span>
      </span>
    `;
  } else {
    statusBadge = `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
        <span>Muddati o'tgan</span>
      </span>
    `;
  }

  return `
    <div class="glass-card rounded-2xl p-4 border border-zinc-800/80 hover:border-sky-500/30 transition shadow-lg space-y-3">
      <!-- Card Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-white tracking-tight truncate">${club.name}</h3>
            <span class="px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-800 text-sky-300">
              📍 ${club.city}
            </span>
          </div>
          <p class="text-[11px] text-zinc-400 mt-0.5 truncate">
            Rahbar: <strong class="text-zinc-300 font-medium">${club.ownerName}</strong> • ${club.ownerPhone}
          </p>
        </div>
        <div class="flex-shrink-0">
          ${statusBadge}
        </div>
      </div>

      <!-- Sariq Ogohlantirish xabari (agar 3 kun qolgan bo'lsa) -->
      ${lic.code === 'YELLOW' ? `
        <div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300 flex items-center justify-between">
          <span class="flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Kassa ekraniga eslatma yuborilmoqda</span>
          </span>
          <a href="https://t.me/+${club.ownerPhone.replace(/[^\d]/g, '')}" target="_blank" class="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-bold">
            Eslatish ➔
          </a>
        </div>
      ` : ''}

      <!-- Tariff & Rate Details -->
      <div class="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/60 flex items-center justify-between">
        <div>
          <div class="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Tarif Rejasi</div>
          <div class="text-xs font-bold text-white mt-0.5 flex items-center gap-1.5">
            <span class="px-1.5 py-0.5 rounded text-[9px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
              ${isPerPc ? 'HAR BIR PC' : 'QAT\'IY OBL'}
            </span>
            <span>${isPerPc ? `${(tariff.pricePerPc || 20000).toLocaleString()} UZS / PC` : 'Fiks Obuna'}</span>
          </div>
          <div class="text-[10px] text-zinc-400 mt-0.5 font-mono">
            ${isPerPc ? `${club.totalWorkstations} PC × ${(tariff.pricePerPc || 20000).toLocaleString()} UZS` : 'Oylik qat\'iy narx'}
          </div>
        </div>

        <div class="text-right">
          <div class="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Oylik To'lov</div>
          <div class="text-sm font-black font-mono text-emerald-400 mt-0.5">
            ${(tariff.monthlyFee || 0).toLocaleString()} <span class="text-[9px] font-normal text-zinc-400">UZS/oy</span>
          </div>
          <button 
            type="button" 
            onclick="openTariffEditModal(${club.id})" 
            class="text-[10px] text-sky-400 hover:text-sky-300 underline mt-0.5"
          >
            Tarifni o'zgartirish
          </button>
        </div>
      </div>

      <!-- Expiration Date & Actions -->
      <div class="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
        <div class="text-[10px] text-zinc-400 font-mono">
          Amal qilish muddati: <strong class="text-zinc-200">${club.licenseExpiresAt ? club.licenseExpiresAt.slice(0, 10) : '2026-12-31'}</strong>
        </div>

        <!-- [To'lov Kiritish] Tugmasi -->
        <button 
          type="button" 
          onclick="openPaymentModal(${club.id})" 
          class="py-1.5 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 active:scale-95 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition"
        >
          <span>💳</span>
          <span>To'lov kiritish</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * 3. To'lov Qabul Qilish Modali (Payment Acceptance Sheet)
 */
function renderPaymentModal() {
  const club = billingState.selectedClubForPayment;
  if (!club) return '';

  const monthlyFee = club.tariff?.monthlyFee || 400000;

  return `
    <div id="paymentModalContainer" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div class="glass-card w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-5 space-y-4 border border-emerald-500/30 glow-cyan max-h-[90vh] overflow-y-auto ios-scroll shadow-2xl">
        <!-- Pull Handle -->
        <div class="w-10 h-1 bg-zinc-700 rounded-full mx-auto -mt-1 mb-2 sm:hidden"></div>

        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 class="text-sm font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>💳 To'lov Qabul Qilish</span>
            </h3>
            <p class="text-xs text-sky-400 font-mono mt-0.5 truncate">${club.name}</p>
          </div>
          <button type="button" onclick="closePaymentModal()" class="w-7 h-7 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition">
            ✕
          </button>
        </div>

        <form onsubmit="handleRecordPaymentSubmit(event)" class="space-y-3.5">
          <!-- 1. Summa Inputi -->
          <div>
            <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
              To'lov Summasi (UZS):
            </label>
            <div class="relative">
              <input 
                id="inputPaymentAmount" 
                type="number" 
                required 
                min="1000" 
                value="${monthlyFee}" 
                class="w-full pl-3.5 pr-12 py-2.5 rounded-xl glass-card text-sm font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500 transition"
              />
              <span class="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs font-mono text-zinc-400 pointer-events-none">
                UZS
              </span>
            </div>
            <p class="text-[10px] text-zinc-400 mt-1 font-mono">
              Oylik tarif bo'yicha hisoblangan summa: ${monthlyFee.toLocaleString()} UZS
            </p>
          </div>

          <!-- 2. To'lov Turi (Payment Method) -->
          <div>
            <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
              To'lov Turi:
            </label>
            <div class="grid grid-cols-4 gap-1.5">
              <button type="button" onclick="selectPaymentMethod('CLICK')" class="btn-pay-method py-2 rounded-xl text-xs font-bold border border-sky-500/40 bg-sky-500/20 text-sky-300">
                Click
              </button>
              <button type="button" onclick="selectPaymentMethod('PAYME')" class="btn-pay-method py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
                Payme
              </button>
              <button type="button" onclick="selectPaymentMethod('CASH')" class="btn-pay-method py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
                Naqd
              </button>
              <button type="button" onclick="selectPaymentMethod('BANK_TRANSFER')" class="btn-pay-method py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
                Bank
              </button>
            </div>
            <input type="hidden" id="inputPaymentMethod" value="CLICK" />
          </div>

          <!-- 3. Uzaytirish Muddati (Months Added) -->
          <div>
            <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
              Litsenziyani Uzaytirish:
            </label>
            <div class="grid grid-cols-3 gap-1.5">
              <button type="button" onclick="selectPaymentMonths(1, ${monthlyFee})" class="btn-pay-months py-2 rounded-xl text-xs font-bold border border-emerald-500/40 bg-emerald-500/20 text-emerald-300">
                +1 oy
              </button>
              <button type="button" onclick="selectPaymentMonths(2, ${monthlyFee})" class="btn-pay-months py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
                +2 oy
              </button>
              <button type="button" onclick="selectPaymentMonths(12, ${monthlyFee})" class="btn-pay-months py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
                +1 yil
              </button>
            </div>
            <input type="hidden" id="inputPaymentMonths" value="1" />
          </div>

          <!-- 4. Izoh / Eslatma -->
          <div>
            <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
              Izoh (ixtiyoriy):
            </label>
            <input 
              id="inputPaymentNotes" 
              type="text" 
              placeholder="Masalan: Click orqali oylik to'lov" 
              class="w-full px-3.5 py-2 rounded-xl glass-card text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <!-- Submit Action -->
          <div class="pt-2">
            <button 
              type="submit" 
              class="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-600 hover:from-emerald-600 hover:to-sky-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition"
            >
              <span>✓</span>
              <span>To'lovni Tasdiqlash va Litsenziyani Ochish</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

/**
 * 4. Tarifni O'zgartirish Modali (Tariff Edit Sheet)
 */
function renderTariffModal() {
  const club = billingState.selectedClubForTariff;
  if (!club) return '';

  const isPerPc = (club.tariff?.type || 'PER_PC') === 'PER_PC';
  const pricePerPc = club.tariff?.pricePerPc || 20000;
  const fixedPrice = club.tariff?.fixedPrice || 500000;

  return `
    <div id="tariffModalContainer" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div class="glass-card w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-5 space-y-4 border border-sky-500/30 max-h-[85vh] overflow-y-auto ios-scroll shadow-2xl">
        <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 class="text-sm font-bold text-white tracking-tight">Tarif Rejasini O'zgartirish</h3>
            <p class="text-xs text-sky-400 font-mono mt-0.5">${club.name}</p>
          </div>
          <button type="button" onclick="closeTariffEditModal()" class="text-zinc-400 hover:text-white text-sm">✕</button>
        </div>

        <form onsubmit="handleUpdateTariffSubmit(event)" class="space-y-3.5">
          <!-- Reja Turi: PER_PC yoki FIXED -->
          <div>
            <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Tarif Formati:</label>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" id="btnTariffPerPc" onclick="selectTariffType('PER_PC')" class="py-2 rounded-xl text-xs font-bold border transition ${isPerPc ? 'border-sky-500/40 bg-sky-500/20 text-sky-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400'}">
                🖥️ Har bir PC
              </button>
              <button type="button" id="btnTariffFixed" onclick="selectTariffType('FIXED')" class="py-2 rounded-xl text-xs font-bold border transition ${!isPerPc ? 'border-sky-500/40 bg-sky-500/20 text-sky-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400'}">
                🏢 Qat'iy Obuna
              </button>
            </div>
            <input type="hidden" id="inputTariffType" value="${isPerPc ? 'PER_PC' : 'FIXED'}" />
          </div>

          <!-- Per PC Price Input -->
          <div id="sectionPerPcPrice" class="${isPerPc ? '' : 'hidden'}">
            <label class="block text-[11px] font-semibold text-zinc-300 mb-1">1 ta PC uchun oylik narx (UZS):</label>
            <input id="inputPricePerPc" type="number" step="1000" value="${pricePerPc}" class="w-full px-3.5 py-2 rounded-xl glass-card text-xs font-mono text-white focus:outline-none focus:border-sky-500" />
            <p class="text-[10px] text-zinc-400 mt-1 font-mono">
              Jami: ${club.totalWorkstations} PC × narx = oylik kutilayotgan summa
            </p>
          </div>

          <!-- Fixed Price Input -->
          <div id="sectionFixedPrice" class="${isPerPc ? 'hidden' : ''}">
            <label class="block text-[11px] font-semibold text-zinc-300 mb-1">Oylik qat'iy to'lov (UZS):</label>
            <input id="inputFixedPrice" type="number" step="10000" value="${fixedPrice}" class="w-full px-3.5 py-2 rounded-xl glass-card text-xs font-mono text-white focus:outline-none focus:border-sky-500" />
          </div>

          <div class="pt-2">
            <button type="submit" class="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-bold text-xs shadow-lg shadow-sky-500/20 active:scale-95 transition">
              Saqlash
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// ============================================================================
// 3. MAIN BILLING VIEW RENDERER
// ============================================================================

export function renderBillingView() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;

  const filter = billingState.activeFilter;
  let clubsToDisplay = [...billingState.clubs];

  if (filter !== 'ALL') {
    clubsToDisplay = clubsToDisplay.filter(c => c.licenseStatus?.code === filter);
  }

  container.innerHTML = `
    <div class="space-y-4 pb-24 animate-fade-in">
      <!-- Header -->
      <div class="flex items-center justify-between pt-1">
        <div>
          <h2 class="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>SaaS Obuna & Billing</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              RECURRING
            </span>
          </h2>
          <p class="text-[11px] text-zinc-400 mt-0.5">
            Filiallar litsenziyasi, tarif rejalari va oylik obuna to'lovlari
          </p>
        </div>

        <button 
          type="button" 
          onclick="refreshBillingData()" 
          class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-zinc-400 hover:text-white active:scale-90 transition"
          title="Yangilash"
        >
          <svg class="w-4 h-4 ${billingState.isLoading ? 'animate-spin text-sky-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
        </button>
      </div>

      <!-- Financial Metrics Summary Cards -->
      ${renderBillingKpiCards()}

      <!-- Filter Chips -->
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        <button 
          type="button" 
          onclick="setBillingFilter('ALL')" 
          class="px-3 py-1.5 rounded-xl text-xs font-semibold transition flex-shrink-0 ${filter === 'ALL' ? 'bg-sky-500 text-black font-bold' : 'glass-card text-zinc-300'}"
        >
          Barchasi (${billingState.clubs.length})
        </button>
        <button 
          type="button" 
          onclick="setBillingFilter('GREEN')" 
          class="px-3 py-1.5 rounded-xl text-xs font-semibold transition flex-shrink-0 ${filter === 'GREEN' ? 'bg-emerald-500 text-black font-bold' : 'glass-card text-zinc-300'}"
        >
          🟢 Faollar (${billingState.summary.statusCounts.green})
        </button>
        <button 
          type="button" 
          onclick="setBillingFilter('YELLOW')" 
          class="px-3 py-1.5 rounded-xl text-xs font-semibold transition flex-shrink-0 ${filter === 'YELLOW' ? 'bg-amber-500 text-black font-bold' : 'glass-card text-zinc-300'}"
        >
          🟡 3 kun qolganlar (${billingState.summary.statusCounts.yellow})
        </button>
        <button 
          type="button" 
          onclick="setBillingFilter('RED')" 
          class="px-3 py-1.5 rounded-xl text-xs font-semibold transition flex-shrink-0 ${filter === 'RED' ? 'bg-rose-500 text-white font-bold' : 'glass-card text-zinc-300'}"
        >
          🔴 Qarzdorlar (${billingState.summary.statusCounts.red})
        </button>
      </div>

      <!-- Clubs Subscriptions List -->
      <div class="space-y-3 pt-1">
        ${clubsToDisplay.length > 0 ? (
          clubsToDisplay.map(c => renderClubBillingCard(c)).join('')
        ) : (
          `
            <div class="glass-card rounded-2xl p-8 text-center space-y-2">
              <span class="text-3xl">✓</span>
              <h4 class="text-sm font-bold text-white">Bu toifada klublar mavjud emas</h4>
              <p class="text-xs text-zinc-400">Barcha filiallar litsenziyalari so'nggi holatda saqlanmoqda.</p>
            </div>
          `
        )}
      </div>
    </div>

    <!-- Modals -->
    ${renderPaymentModal()}
    ${renderTariffModal()}
  `;
}

// ============================================================================
// 4. INTERACTION HANDLERS & MODAL TRIGGERS
// ============================================================================

window.setBillingFilter = function(filter) {
  triggerHaptic(10);
  billingState.activeFilter = filter;
  renderBillingView();
};

window.openPaymentModal = function(clubId) {
  triggerHaptic(15);
  const club = billingState.clubs.find(c => c.id === Number(clubId));
  if (club) {
    billingState.selectedClubForPayment = club;
    renderBillingView();
  }
};

window.closePaymentModal = function() {
  triggerHaptic(10);
  billingState.selectedClubForPayment = null;
  renderBillingView();
};

window.selectPaymentMethod = function(method) {
  triggerHaptic(10);
  const hidden = document.getElementById('inputPaymentMethod');
  if (hidden) hidden.value = method;

  document.querySelectorAll('.btn-pay-method').forEach(btn => {
    if (btn.textContent.trim().toUpperCase() === method || (method === 'CASH' && btn.textContent.includes('Naqd')) || (method === 'BANK_TRANSFER' && btn.textContent.includes('Bank'))) {
      btn.className = 'btn-pay-method py-2 rounded-xl text-xs font-bold border border-sky-500/40 bg-sky-500/20 text-sky-300';
    } else {
      btn.className = 'btn-pay-method py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300';
    }
  });
};

window.selectPaymentMonths = function(months, monthlyFee) {
  triggerHaptic(10);
  const hidden = document.getElementById('inputPaymentMonths');
  const amountInput = document.getElementById('inputPaymentAmount');
  if (hidden) hidden.value = months;
  if (amountInput) amountInput.value = monthlyFee * months;

  document.querySelectorAll('.btn-pay-months').forEach(btn => {
    if ((months === 1 && btn.textContent.includes('+1 oy')) || (months === 2 && btn.textContent.includes('+2 oy')) || (months === 12 && btn.textContent.includes('+1 yil'))) {
      btn.className = 'btn-pay-months py-2 rounded-xl text-xs font-bold border border-emerald-500/40 bg-emerald-500/20 text-emerald-300';
    } else {
      btn.className = 'btn-pay-months py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300';
    }
  });
};

window.handleRecordPaymentSubmit = async function(e) {
  e.preventDefault();
  triggerHaptic([20, 40]);

  const club = billingState.selectedClubForPayment;
  if (!club) return;

  const amount = parseFloat(document.getElementById('inputPaymentAmount').value);
  const paymentMethod = document.getElementById('inputPaymentMethod').value;
  const monthsAdded = parseInt(document.getElementById('inputPaymentMonths').value, 10);
  const notes = document.getElementById('inputPaymentNotes').value.trim();

  showBillingToast("To'lov tranzaksiyasi qayd etilmoqda...");

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch('/api/billing/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        clubId: club.id,
        amount,
        paymentMethod,
        monthsAdded,
        notes
      })
    });

    const data = await res.json();
    if (data.success) {
      alert(`✅ To'lov muvaffaqiyatli qabul qilindi!\n\nFilial: ${data.clubName}\nSumma: ${data.amount.toLocaleString()} UZS\nTo'lov turi: ${data.paymentMethod}\nYangi amal qilish muddati: ${data.newExpiryDate.slice(0, 10)}\n\nFilial serveriga UNLOCK signali yuborildi.`);
      closePaymentModal();
      await fetchBillingData();
      renderBillingView();
    } else {
      showBillingToast(`Xatolik: ${data.error}`);
    }
  } catch (err) {
    showBillingToast("Tarmoq xatosi: To'lovni saqlab bo'lmadi");
  }
};

window.openTariffEditModal = function(clubId) {
  triggerHaptic(12);
  const club = billingState.clubs.find(c => c.id === Number(clubId));
  if (club) {
    billingState.selectedClubForTariff = club;
    renderBillingView();
  }
};

window.closeTariffEditModal = function() {
  billingState.selectedClubForTariff = null;
  renderBillingView();
};

window.selectTariffType = function(type) {
  triggerHaptic(10);
  const inputType = document.getElementById('inputTariffType');
  const btnPerPc = document.getElementById('btnTariffPerPc');
  const btnFixed = document.getElementById('btnTariffFixed');
  const secPerPc = document.getElementById('sectionPerPcPrice');
  const secFixed = document.getElementById('sectionFixedPrice');

  if (inputType) inputType.value = type;

  if (type === 'PER_PC') {
    if (btnPerPc) btnPerPc.className = 'py-2 rounded-xl text-xs font-bold border transition border-sky-500/40 bg-sky-500/20 text-sky-300';
    if (btnFixed) btnFixed.className = 'py-2 rounded-xl text-xs font-bold border transition border-zinc-700 bg-zinc-800 text-zinc-400';
    if (secPerPc) secPerPc.classList.remove('hidden');
    if (secFixed) secFixed.classList.add('hidden');
  } else {
    if (btnPerPc) btnPerPc.className = 'py-2 rounded-xl text-xs font-bold border transition border-zinc-700 bg-zinc-800 text-zinc-400';
    if (btnFixed) btnFixed.className = 'py-2 rounded-xl text-xs font-bold border transition border-sky-500/40 bg-sky-500/20 text-sky-300';
    if (secPerPc) secPerPc.classList.add('hidden');
    if (secFixed) secFixed.classList.remove('hidden');
  }
};

window.handleUpdateTariffSubmit = async function(e) {
  e.preventDefault();
  triggerHaptic(20);

  const club = billingState.selectedClubForTariff;
  if (!club) return;

  const tariffType = document.getElementById('inputTariffType').value;
  const pricePerPc = parseFloat(document.getElementById('inputPricePerPc').value);
  const fixedPrice = parseFloat(document.getElementById('inputFixedPrice').value);

  showBillingToast("Tarif yangilanmoqda...");

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch(`/api/billing/tariff/${club.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ tariffType, pricePerPc, fixedPrice })
    });

    const data = await res.json();
    if (data.success) {
      showBillingToast("✓ Tarif muvaffaqiyatli saqlandi");
      closeTariffEditModal();
      await fetchBillingData();
      renderBillingView();
    }
  } catch (err) {
    showBillingToast("Tarifni yangilab bo'lmadi");
  }
};

window.refreshBillingData = async function() {
  triggerHaptic(15);
  showBillingToast("Billing ma'lumotlari yangilanmoqda...");
  await fetchBillingData();
  renderBillingView();
  showBillingToast("✓ Barcha obunalar yangilandi");
};

function triggerHaptic(pattern = 15) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function showBillingToast(message) {
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

export async function initBillingView() {
  await fetchBillingData();
  renderBillingView();
}
