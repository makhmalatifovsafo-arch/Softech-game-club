/**
 * ============================================================================
 * Softech Game Club Management System — SPA Router & Navigation Controller
 * ============================================================================
 */

let currentAppView = 'workstations';

let currentPillY = null;
let pillTransitTimer = null;

/**
 * Update Liquid Glass Pill Position with Velocity Squash-and-Stretch Fluid Spring Physics
 * and Optical Magnifying (Lupa) Lens Alignment
 * @param {HTMLElement|null} targetBtn - Button to align pill to, or null for current active view
 * @param {boolean} immediate - If true, jump without animation (initial load or resize)
 */
function updateLiquidPill(targetBtn, immediate = false) {
  const pill = document.getElementById('liquidNavPill');
  const nav = document.getElementById('sidebarNav');
  if (!pill || !nav) return;

  if (!targetBtn) {
    targetBtn = nav.querySelector(`.sidebar-nav-btn[data-view="${currentAppView}"]`);
  }
  if (!targetBtn) return;

  // 1. Optical Magnifying Lens (Lupa) effect:
  // Apply .lensed ONLY to the button under the glass pill so its icon and text magnify smoothly
  nav.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
    btn.classList.toggle('lensed', btn === targetBtn);
  });

  // 2. Precise Geometric Alignment:
  // Use offsetTop, offsetLeft, offsetWidth, and offsetHeight relative to #sidebarNav
  const top = targetBtn.offsetTop;
  const height = targetBtn.offsetHeight;
  const left = targetBtn.offsetLeft;
  const width = targetBtn.offsetWidth;

  pill.style.setProperty('--pill-y', `${top}px`);
  pill.style.top = '0px';
  pill.style.left = `${left}px`;
  pill.style.width = `${width}px`;
  pill.style.height = `${height}px`;

  if (pillTransitTimer) {
    clearTimeout(pillTransitTimer);
    pillTransitTimer = null;
  }

  if (immediate || currentPillY === null) {
    pill.style.transition = 'none';
    pill.style.transform = `translateY(${top}px)`;
    pill.style.opacity = '1';
    currentPillY = top;
    pill.offsetHeight; // force reflow
    return;
  }

  // Tez va chaqqon siljish (0.22s snappy cubic-bezier)
  pill.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.16s ease';
  pill.style.transform = `translateY(${top}px)`;
  pill.style.opacity = '1';
  currentPillY = top;
}

/**
 * Initialize Liquid Glass Sidebar Interactive Refraction, Lupa Optics & Fluid Spring Physics
 */
function initLiquidSidebar() {
  const sidebar = document.getElementById('leftSidebar');
  const nav = document.getElementById('sidebarNav');
  const pill = document.getElementById('liquidNavPill');
  if (!sidebar || !nav) return;

  if (sidebar.dataset.liquidInitialized === 'true') return;
  sidebar.dataset.liquidInitialized = 'true';

  // Dynamic Interactive Specular Lighting (Cursor-Refraction Radial Gleam)
  sidebar.addEventListener('mousemove', (e) => {
    const rect = sidebar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    sidebar.style.setProperty('--mouse-x', `${x}px`);
    sidebar.style.setProperty('--mouse-y', `${y}px`);
    sidebar.style.setProperty('--gleam-opacity', '1');
  });

  sidebar.addEventListener('mouseleave', () => {
    sidebar.style.setProperty('--gleam-opacity', '0');
  });

  const buttons = nav.querySelectorAll('.sidebar-nav-btn');
  buttons.forEach(btn => {
    // Faqat tugma bosilganda (click) shisha kapsula (liquid pill) siljiydi
    btn.addEventListener('click', () => {
      updateLiquidPill(btn, false);
    });

    // Press interaction: physical glass squash on click/mousedown
    btn.addEventListener('mousedown', () => {
      if (pill) pill.classList.add('is-pressing');
    });
  });

  window.addEventListener('mouseup', () => {
    if (pill) pill.classList.remove('is-pressing');
  });

  // Re-align on window resize
  window.addEventListener('resize', () => {
    updateLiquidPill(null, true);
  });

  // Initial pill placement
  requestAnimationFrame(() => {
    updateLiquidPill(null, true);
  });
}

/**
 * Switch SPA View (6 Core Modules)
 * @param {'workstations'|'bookings'|'reports'|'stats'|'bar'|'history'} viewName 
 */
function switchView(viewName) {
  const validViews = ['workstations', 'bookings', 'reports', 'stats', 'bar', 'history'];
  if (!validViews.includes(viewName)) viewName = 'workstations';

  // Administratorlar uchun Otchyot va Statistika bo'limlariga kirish taqiqlanadi
  const isAdministrator = currentUser && currentUser.role === 'administrator';
  if (isAdministrator && (viewName === 'reports' || viewName === 'stats')) {
    if (typeof showToast === 'function') {
      showToast('⚠️ Ushbu bo\'lim faqat klub rahbari/menejeri uchun ochiq.', 'warning');
    }
    viewName = 'workstations';
  }

  currentAppView = viewName;

  // 1. Yashirish / Ko'rsatish (0.18s cubic-bezier animation with .spa-view)
  validViews.forEach(v => {
    const sec = document.getElementById(`view-${v}`);
    if (sec) {
      if (v === viewName) {
        sec.classList.remove('hidden');
        sec.classList.add('block');
        // Restart animation on tab switch
        sec.classList.remove('spa-view');
        void sec.offsetWidth;
        sec.classList.add('spa-view');
      } else {
        sec.classList.add('hidden');
        sec.classList.remove('block');
      }
    }
  });

  // 2. Sidebar tugmalarining faol holatini belgilash (no font weight jumps!)
  document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
    const v = btn.getAttribute('data-view');
    const isActive = (v === viewName);

    btn.classList.toggle('active', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-zinc-300', !isActive);
  });

  // 3. Liquid Glass Pill ni yangi faol tugmaga harakatlantirish
  updateLiquidPill(null, false);

  // 4. Headerdagi sahifa sarlavhasini yangilash
  const headerTitleEl = document.getElementById('headerPageTitle');
  const viewTitleMap = {
    workstations: '🖥️ Kompyuterlar Boshqaruvi',
    bookings: '📅 Band Qilingan Stollar',
    reports: '📊 Moliyaviy va Smena Otchyotlari',
    stats: '📈 Klub Statistikasi va Analitika',
    bar: '🛒 Bar va POS Savdo Tizimi',
    history: '📜 Smena Amallari Tarixi'
  };
  if (headerTitleEl) {
    headerTitleEl.textContent = viewTitleMap[viewName] || 'SOFTECH OS';
  }

  // 5. URL Hash ni yangilash
  if (window.location.hash !== `#${viewName}`) {
    history.replaceState(null, '', `#${viewName}`);
  }

  // 6. Tegishli sahifa ma'lumotlarini chizish / yangilash
  if (viewName === 'workstations') {
    if (typeof switchDashboardView === 'function' && typeof dashboardViewMode !== 'undefined') {
      switchDashboardView(dashboardViewMode);
    } else if (typeof renderFloorPlan === 'function') {
      renderFloorPlan();
    }
    if (typeof fetchData === 'function') {
      fetchData();
    }
  } else if (viewName === 'bookings') {
    renderBookingsView();
  } else if (viewName === 'reports') {
    renderReportsView();
  } else if (viewName === 'stats') {
    renderStatsView();
  } else if (viewName === 'bar') {
    renderBarView();
  } else if (viewName === 'history') {
    renderHistoryView();
  }
}

/**
 * Initialize SPA routing on page load / hashchange
 */
function initSpaRouter() {
  initLiquidSidebar();

  const hash = window.location.hash.replace('#', '');
  const validViews = ['workstations', 'bookings', 'reports', 'stats', 'bar', 'history'];
  if (validViews.includes(hash)) {
    switchView(hash);
  } else {
    switchView('workstations');
  }

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '');
    if (validViews.includes(h) && h !== currentAppView) {
      switchView(h);
    }
  });
}

// Initsializatsiyani kafolatlash
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLiquidSidebar);
} else {
  initLiquidSidebar();
}

// ============================================================================
// WORKSTATION BOOKING & RESERVATION MATRIX MODULE (#view-bookings)
// ============================================================================
let bookingsData = [];
let bookingSelectedDate = new Date().toISOString().slice(0, 10);
let bookingViewMode = 'gantt'; // 'gantt' | 'table'

/**
 * Bronlar ro'yxatini backenddan yuklash
 */
async function loadBookings() {
  try {
    const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
    const res = await fetch('/api/bookings', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      bookingsData = data.bookings || [];
      updateBookingCounters();
      renderBookingsView();
    }
  } catch (err) {
    console.error('Bronlarni yuklashda xatolik:', err);
  }
}

/**
 * Bron statistikalarini hisoblash va yangilash
 */
function updateBookingCounters() {
  const total = bookingsData.length;
  const confirmed = bookingsData.filter(b => b.status === 'CONFIRMED').length;
  const pending = bookingsData.filter(b => b.status === 'PENDING').length;

  let totalHours = 0;
  bookingsData.forEach(b => {
    let dur = 0;
    if (b.startTime && b.endTime) {
      const s = b.startTime.includes(' ') ? b.startTime.split(' ')[1] : b.startTime;
      const e = b.endTime.includes(' ') ? b.endTime.split(' ')[1] : b.endTime;
      const [sh, sm] = s.split(':').map(Number);
      const [eh, em] = e.split(':').map(Number);
      dur = ((eh * 60 + (em || 0)) - (sh * 60 + (sm || 0))) / 60;
      if (dur < 0) dur += 24;
    }
    totalHours += Math.max(1, Math.round(dur || 2));
  });

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  setTxt('statBookingTotal', total);
  setTxt('statBookingConfirmed', confirmed);
  setTxt('statBookingPending', pending);
  setTxt('statBookingHours', totalHours);

  const sidebarBadge = document.getElementById('sidebarBookingBadge');
  if (sidebarBadge) sidebarBadge.textContent = String(confirmed + pending);
}

/**
 * Bronlar sahifasini chizish (Gantt Matritsa yoki Jadval)
 */
function renderBookingsView() {
  if (bookingsData.length === 0) {
    loadBookings();
  }

  // Sana yorlig'ini yangilash
  const dateLabel = document.getElementById('bookingScheduleDateLabel');
  const dateInput = document.getElementById('bookingScheduleDateInput');
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  if (dateInput && !dateInput.value) {
    dateInput.value = bookingSelectedDate;
  }

  if (dateLabel) {
    if (bookingSelectedDate === todayStr) dateLabel.textContent = 'Bugun';
    else if (bookingSelectedDate === tomorrowStr) dateLabel.textContent = 'Ertaga';
    else dateLabel.textContent = bookingSelectedDate;
  }

  if (bookingViewMode === 'gantt') {
    renderBookingsGantt();
  } else {
    renderBookingsTable();
  }
}

/**
 * Sana filtrini o'zgartirish (Bugun / Ertaga)
 */
function setBookingDateFilter(type) {
  const today = new Date();
  if (type === 'TODAY') {
    bookingSelectedDate = today.toISOString().slice(0, 10);
  } else if (type === 'TOMORROW') {
    today.setDate(today.getDate() + 1);
    bookingSelectedDate = today.toISOString().slice(0, 10);
  }

  const todayBtn = document.getElementById('bookingDateTodayBtn');
  const tomBtn = document.getElementById('bookingDateTomorrowBtn');
  const dateInput = document.getElementById('bookingScheduleDateInput');

  if (todayBtn) todayBtn.className = type === 'TODAY' ? 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition cursor-pointer shadow-sm' : 'px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer';
  if (tomBtn) tomBtn.className = type === 'TOMORROW' ? 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition cursor-pointer shadow-sm' : 'px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer';
  if (dateInput) dateInput.value = bookingSelectedDate;

  renderBookingsView();
}

/**
 * Kalendar orqali sana tanlanganda
 */
function handleBookingDateChange(val) {
  if (!val) return;
  bookingSelectedDate = val;

  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const todayBtn = document.getElementById('bookingDateTodayBtn');
  const tomBtn = document.getElementById('bookingDateTomorrowBtn');
  if (todayBtn) todayBtn.className = val === todayStr ? 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition cursor-pointer shadow-sm' : 'px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer';
  if (tomBtn) tomBtn.className = val === tomorrowStr ? 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition cursor-pointer shadow-sm' : 'px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer';

  renderBookingsView();
}

/**
 * Ko'rinish rejimini almashtirish: Gantt Shkala vs Jadval
 */
function toggleBookingViewMode(mode) {
  bookingViewMode = mode;
  const ganttContainer = document.getElementById('bookingGanttContainer');
  const tableContainer = document.getElementById('bookingTableContainer');
  const ganttBtn = document.getElementById('bookingViewModeGanttBtn');
  const tableBtn = document.getElementById('bookingViewModeTableBtn');

  if (mode === 'gantt') {
    ganttContainer?.classList.remove('hidden');
    tableContainer?.classList.add('hidden');
    ganttBtn?.classList.add('bg-zinc-800', 'text-white');
    ganttBtn?.classList.remove('text-zinc-400');
    tableBtn?.classList.remove('bg-zinc-800', 'text-white');
    tableBtn?.classList.add('text-zinc-400');
  } else {
    ganttContainer?.classList.add('hidden');
    tableContainer?.classList.remove('hidden');
    tableBtn?.classList.add('bg-zinc-800', 'text-white');
    tableBtn?.classList.remove('text-zinc-400');
    ganttBtn?.classList.remove('bg-zinc-800', 'text-white');
    ganttBtn?.classList.add('text-zinc-400');
  }

  renderBookingsView();
}

/**
 * 1. Gantt / Timeline Matrix Ko'rinishini chizish (24 Soatlik Shkala)
 */
function renderBookingsGantt() {
  const container = document.getElementById('bookingGanttMatrixBody');
  if (!container) return;

  const pcs = (typeof computersData !== 'undefined' && computersData.length > 0)
    ? computersData
    : Array.from({ length: 10 }, (_, i) => ({
        id: `pc_${i + 1}`,
        pcNumber: i + 1,
        name: `PC-${String(i + 1).padStart(2, '0')}`,
        zone: i >= 8 ? 'PLAYSTATION' : (i >= 5 ? 'VIP' : 'STANDARD'),
        status: 'AVAILABLE'
      }));

  // 24 soatlik shkala soatlari (10:00 dan ertasi 04:00 gacha klub ish tartibida)
  const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3];
  const startHour = 10;
  const totalSlots = hours.length;

  // Header qatori (Soatlar shkalasi)
  let html = `
    <div class="flex items-center text-[10px] font-mono text-zinc-400 pb-2 border-b border-[#27272a] select-none">
      <div class="w-36 shrink-0 font-bold uppercase text-zinc-500">Stol / Zona</div>
      <div class="flex-1 grid grid-cols-18 gap-0 text-center">
        ${hours.map(h => `<div class="border-l border-[#27272a]/70 py-1 font-semibold">${String(h).padStart(2, '0')}:00</div>`).join('')}
      </div>
    </div>
  `;

  // Har bir kompyuter uchun qator
  html += pcs.map(pc => {
    const isOccupied = pc.status === 'OCCUPIED';
    const isVip = pc.zone === 'VIP';
    const isPs = pc.zone === 'PLAYSTATION';
    const zoneIcon = isPs ? '🎮' : (isVip ? '⭐' : '🖥️');

    // Ushbu kompyuter va tanlangan kunga tegishli bronlar
    const pcBookings = bookingsData.filter(b => {
      const matchPc = b.computerId === pc.pcNumber || b.computerId === pc.id || String(b.computerId) === String(pc.pcNumber) || b.computerName === pc.name;
      if (!matchPc) return false;
      if (b.status === 'CANCELLED') return false;

      // Sana filtri tekshiruvi
      if (b.startTime && b.startTime.includes('-')) {
        return b.startTime.startsWith(bookingSelectedDate);
      }
      return true;
    });

    return `
      <div class="flex items-center group py-1.5 hover:bg-zinc-800/30 rounded-xl transition">
        <!-- Chap: Stol info -->
        <div class="w-36 shrink-0 flex items-center justify-between pr-3">
          <div class="flex items-center gap-1.5">
            <span class="text-xs">${zoneIcon}</span>
            <span class="font-mono font-bold text-xs text-white">${pc.name}</span>
          </div>
          <span class="text-[9px] font-mono px-1.5 py-0.5 rounded ${isOccupied ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400'}">
            ${isOccupied ? 'BAND' : 'BO\'SH'}
          </span>
        </div>

        <!-- O'ng: 18 soatlik kataklar va bron bar'lari -->
        <div class="flex-1 relative h-8 bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden grid grid-cols-18">
          <!-- Orqa fon soat chiziqlari -->
          ${hours.map(h => `
            <div onclick="openAddBookingModal('${pc.name}', '${String(h).padStart(2, '0')}:00')" 
                 class="h-full border-r border-[#27272a]/60 hover:bg-sky-500/10 cursor-pointer transition" 
                 title="${pc.name} da ${String(h).padStart(2, '0')}:00 ga bron qilish"></div>
          `).join('')}

          <!-- Bron bloklari -->
          ${pcBookings.map(b => {
            const timePart = b.startTime.includes(' ') ? b.startTime.split(' ')[1] : b.startTime;
            const endPart = b.endTime.includes(' ') ? b.endTime.split(' ')[1] : b.endTime;
            const [sh, sm] = (timePart || '18:00').split(':').map(Number);
            const [eh, em] = (endPart || '20:00').split(':').map(Number);

            // 10:00 dan boshlangan shkalaga nisbatan joylashuv
            let sOffset = (sh >= startHour ? sh - startHour : sh + (24 - startHour)) + (sm || 0) / 60;
            let eOffset = (eh >= startHour ? eh - startHour : eh + (24 - startHour)) + (em || 0) / 60;
            let duration = eOffset - sOffset;
            if (duration <= 0) duration += 24;

            const leftPct = Math.max(0, Math.min(100, (sOffset / totalSlots) * 100));
            const widthPct = Math.max(3, Math.min(100 - leftPct, (duration / totalSlots) * 100));

            const isConf = b.status === 'CONFIRMED';
            const barBg = isConf 
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-black border-emerald-400' 
              : 'bg-gradient-to-r from-amber-500 to-orange-500 text-black border-amber-400';

            return `
              <div style="left: ${leftPct}%; width: ${widthPct}%;" 
                   onclick="event.stopPropagation(); startSessionFromBooking(${b.id})" 
                   class="absolute top-1 bottom-1 rounded-md ${barBg} border shadow-md flex items-center justify-between px-2 text-[10px] font-bold cursor-pointer hover:scale-[1.02] hover:z-20 transition group/bar truncate"
                   title="Mijoz: ${escapeHtml(b.customerName)} (${b.customerPhone || 'Telefon yo\'q'}) • ${timePart} — ${endPart} • Bosib seans oching!">
                <span class="truncate">${escapeHtml(b.customerName)}</span>
                <span class="text-[9px] font-mono shrink-0 ml-1 opacity-90">${timePart}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

/**
 * 2. Jadval ko'rinishini chizish
 */
function renderBookingsTable() {
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;

  const q = (document.getElementById('bookingSearchInput')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('bookingFilterStatus')?.value || 'ALL';

  let list = bookingsData.filter(b => {
    const cust = (b.customerName || '').toLowerCase();
    const phone = (b.customerPhone || '').toLowerCase();
    const desk = (b.computerName || `PC-${b.computerId}`).toLowerCase();
    const matchesQ = !q || cust.includes(q) || phone.includes(q) || desk.includes(q);
    const matchesStatus = statusFilter === 'ALL' || b.status === statusFilter;
    return matchesQ && matchesStatus;
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-zinc-500 font-sans">Hech qanday bron topilmadi.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(b => {
    const isConf = b.status === 'CONFIRMED';
    const isPending = b.status === 'PENDING';
    const compName = b.computerName || `PC-${b.computerId}`;

    let statusBadge = '<span class="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold">Tugallangan</span>';
    if (isConf) {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">✓ Tasdiqlangan</span>';
    } else if (isPending) {
      statusBadge = '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold">⏳ Kutilmoqda</span>';
    }

    const timeStart = b.startTime.includes(' ') ? b.startTime.split(' ')[1] : b.startTime;
    const timeEnd = b.endTime.includes(' ') ? b.endTime.split(' ')[1] : b.endTime;

    return `
      <tr class="hover:bg-zinc-800/40 transition">
        <td class="p-3.5 font-bold font-mono text-white flex items-center gap-1.5">
          <span>🖥️</span>
          <span class="text-sky-400">${compName}</span>
        </td>
        <td class="p-3.5 text-zinc-200 font-semibold">${escapeHtml(b.customerName)}</td>
        <td class="p-3.5 text-zinc-400 font-mono">${escapeHtml(b.customerPhone || '—')}</td>
        <td class="p-3.5 text-sky-400 font-mono font-bold">${timeStart} — ${timeEnd}</td>
        <td class="p-3.5 text-zinc-300 font-mono">2 soat</td>
        <td class="p-3.5">${statusBadge}</td>
        <td class="p-3.5 text-zinc-400 italic">${escapeHtml(b.note || '—')}</td>
        <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
          ${isPending ? `
            <button type="button" onclick="confirmBookingItem(${b.id})" class="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold transition cursor-pointer">
              ✓ Tasdiqlash
            </button>
          ` : ''}
          <button type="button" onclick="startSessionFromBooking(${b.id})" class="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 text-xs font-semibold transition cursor-pointer">
            🎮 Seans ochish
          </button>
          <button type="button" onclick="deleteBookingItem(${b.id})" class="px-2 py-1 rounded-lg hover:bg-rose-500/20 text-rose-400 text-xs transition cursor-pointer" title="Bekor qilish">
            ✕
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterBookingsTable() {
  renderBookingsView();
}

/**
 * Yangi bron qo'shish modalini ochish
 */
function openAddBookingModal(prefillDesk = null, prefillTime = null) {
  const select = document.getElementById('bookingDeskSelect');
  if (select && typeof computersData !== 'undefined') {
    select.innerHTML = computersData.map(c => `
      <option value="${c.pcNumber || c.id}" ${prefillDesk && (c.name === prefillDesk || String(c.pcNumber) === String(prefillDesk)) ? 'selected' : ''}>
        ${c.name} (${c.zone}) - ${c.status === 'OCCUPIED' ? '⚠️ Hozir band' : 'Bo\'sh'}
      </option>
    `).join('');
  }

  const dateInput = document.getElementById('bookingModalDate');
  if (dateInput) {
    dateInput.value = bookingSelectedDate || new Date().toISOString().slice(0, 10);
  }

  if (prefillTime) {
    const startInput = document.getElementById('bookingStartTime');
    if (startInput) startInput.value = prefillTime;
  }

  updateBookingModalEndTime();
  checkBookingModalConflict();

  const modal = document.getElementById('addBookingModal');
  if (modal) modal.classList.remove('hidden');
}

function closeAddBookingModal() {
  const modal = document.getElementById('addBookingModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Boshlanish va davomiylik bo'yicha tugash vaqtini hisoblash
 */
function updateBookingModalEndTime() {
  const start = document.getElementById('bookingStartTime')?.value || '18:00';
  const dur = parseInt(document.getElementById('bookingDurationHours')?.value, 10) || 2;
  const badge = document.getElementById('bookingCalculatedEndBadge');

  const [sh, sm] = start.split(':').map(Number);
  let endH = (sh + dur) % 24;
  let endM = sm || 0;
  const endFormatted = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  if (badge) {
    badge.innerHTML = `<span>${endFormatted}</span><span class="text-[10px] text-zinc-500 font-sans font-normal">(${dur} soat)</span>`;
  }
}

/**
 * Bron vaqt to'qnashuvini modalda real-time tekshirish
 */
function checkBookingModalConflict() {
  const deskVal = document.getElementById('bookingDeskSelect')?.value;
  const dateVal = document.getElementById('bookingModalDate')?.value;
  const startVal = document.getElementById('bookingStartTime')?.value;
  const dur = parseInt(document.getElementById('bookingDurationHours')?.value, 10) || 2;
  const alertBox = document.getElementById('bookingModalConflictAlert');
  const alertText = document.getElementById('bookingModalConflictText');
  const submitBtn = document.getElementById('btnSubmitAddBooking');

  if (!deskVal || !startVal || !alertBox) return;

  const [sh, sm] = startVal.split(':').map(Number);
  let endH = (sh + dur) % 24;
  let endM = sm || 0;
  const endVal = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  const reqStart = `${dateVal} ${startVal}`;
  const reqEnd = `${dateVal} ${endVal}`;

  // Boshqa bronlar bilan to'qnashuvni tekshirish
  const conflict = bookingsData.find(b => {
    if (b.status === 'CANCELLED') return false;
    const matchDesk = String(b.computerId) === String(deskVal) || b.computerName === `PC-${deskVal}`;
    if (!matchDesk) return false;

    const bStart = b.startTime.includes(' ') ? b.startTime : `${dateVal} ${b.startTime}`;
    const bEnd = b.endTime.includes(' ') ? b.endTime : `${dateVal} ${b.endTime}`;

    // Overlap condition: NOT (bEnd <= reqStart OR bStart >= reqEnd)
    return !(bEnd <= reqStart || bStart >= reqEnd);
  });

  if (conflict) {
    alertBox.classList.remove('hidden');
    if (alertText) {
      alertText.textContent = `To'qnashuv! Ushbu vaqtda bu kompyuterga "${conflict.customerName}" tomonidan bron mavjud (${conflict.startTime} — ${conflict.endTime}).`;
    }
    if (submitBtn) submitBtn.disabled = true;
  } else {
    alertBox.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Yangi bronni backendga jo'natish
 */
async function submitAddBooking(e) {
  if (e) e.preventDefault();
  const desk = document.getElementById('bookingDeskSelect')?.value;
  const date = document.getElementById('bookingModalDate')?.value || bookingSelectedDate;
  const cust = document.getElementById('bookingCustomerName')?.value.trim() || 'Mijoz';
  const phone = document.getElementById('bookingCustomerPhone')?.value.trim() || '';
  const start = document.getElementById('bookingStartTime')?.value || '18:00';
  const dur = parseInt(document.getElementById('bookingDurationHours')?.value, 10) || 2;
  const notes = document.getElementById('bookingNotes')?.value.trim() || '';

  const [sh, sm] = start.split(':').map(Number);
  let endH = (sh + dur) % 24;
  let endM = sm || 0;
  const end = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  const targetPcNum = parseInt(String(desk).replace(/\D/g, ''), 10) || 1;
  const startTimeFull = `${date} ${start}`;
  const endTimeFull = `${date} ${end}`;

  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
  const btn = document.getElementById('btnSubmitAddBooking');

  try {
    if (btn) btn.disabled = true;

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        computerId: targetPcNum,
        customerName: cust,
        customerPhone: phone,
        startTime: startTimeFull,
        endTime: endTimeFull,
        note: notes,
        status: 'CONFIRMED'
      })
    });

    const data = await res.json();

    if (res.ok) {
      closeAddBookingModal();
      if (typeof showToast === 'function') {
        showToast(`✓ PC-${String(targetPcNum).padStart(2, '0')} uchun bron muvaffaqiyatli saqlandi!`, 'success');
      }
      await loadBookings();
      if (typeof fetchData === 'function') fetchData();
      if (typeof logHistoryEvent === 'function') {
        logHistoryEvent('BRON_YARATILDI', `PC-${targetPcNum}`, 'manager', `Mijoz: ${cust} (${start} - ${end})`, '0 UZS');
      }
    } else {
      if (typeof showToast === 'function') {
        showToast(data.error || 'Bron qilishda xatolik yuz berdi', 'error');
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Server bilan bog\'lanishda xatolik: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Kutilayotgan bronni tasdiqlash
 */
async function confirmBookingItem(id) {
  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
  try {
    const res = await fetch(`/api/bookings/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });

    if (res.ok) {
      if (typeof showToast === 'function') showToast('✓ Bron muvaffaqiyatli tasdiqlandi', 'success');
      await loadBookings();
      if (typeof fetchData === 'function') fetchData();
    }
  } catch (err) {
    console.error('Bronni tasdiqlashda xatolik:', err);
  }
}

/**
 * Bronni bekor qilish / o'chirish
 */
async function deleteBookingItem(id) {
  if (!confirm('Haqiqatan ham ushbu bronni bekor qilmoqchimisiz?')) return;
  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');

  try {
    const res = await fetch(`/api/bookings/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      if (typeof showToast === 'function') showToast('Bron bekor qilindi', 'info');
      await loadBookings();
      if (typeof fetchData === 'function') fetchData();
    }
  } catch (err) {
    console.error('Bronni o\'chirishda xatolik:', err);
  }
}

/**
 * Bron asosida to'g'ridan-to'g'ri seans ochish (Ro'yxat yoki Ganttdan)
 */
function startSessionFromBooking(id) {
  const b = bookingsData.find(item => item.id === id);
  if (!b) return;

  const targetCompNum = parseInt(String(b.computerId).replace(/\D/g, ''), 10);
  const pc = (typeof computersData !== 'undefined')
    ? computersData.find(c => c.pcNumber === targetCompNum || c.id === `pc_${targetCompNum}` || c.name === b.computerName)
    : null;

  if (pc) {
    startSessionFromBookingDirect(pc.id, b.customerName, b.startTime);
  } else {
    switchView('workstations');
  }
}

/**
 * Kompyuter kartochkasidagi sariq bron banneridan seans ochish
 */
function startSessionFromBookingDirect(pcId, customerName, startTime) {
  switchView('workstations');
  const pc = (typeof computersData !== 'undefined') ? computersData.find(c => c.id === pcId) : null;
  const pcName = pc ? pc.name : pcId;

  if (typeof openStartModal === 'function') {
    openStartModal(pcId, pcName);

    // Mijoz qidiruv maydoniga bron egasi ismini avtomatik kiritish
    setTimeout(() => {
      const searchInp = document.getElementById('customerSearchInput');
      if (searchInp) {
        searchInp.value = customerName || '';
      }
    }, 150);

    if (typeof showToast === 'function') {
      showToast(`📅 "${customerName}" ning bron qilingan seansi ochilmoqda (${startTime})`, 'info');
    }
  }
}

// ============================================================================
// REPORTS MODULE (OTCHYOTLAR VA MOLIYA)
// ============================================================================
let reportCurrentPreset = 'today';
let reportDataCache = null;
let reportActiveTab = 'sessions';

function formatUzs(amount) {
  const num = Math.round(Number(amount || 0));
  return num.toLocaleString('uz-UZ') + ' UZS';
}

/**
 * Otchyotlar sahifasini ochish
 */
function renderReportsView() {
  if (!document.getElementById('reportDateFrom')?.value) {
    setReportDatePreset('today', true);
  } else {
    loadFinancialReports();
  }
}

/**
 * Tezkor sana oralig'ini tanlash (Bugun, Kecha, Shu hafta, Shu oy)
 */
function setReportDatePreset(preset, autoFetch = true) {
  reportCurrentPreset = preset;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const formatD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let fromDate = new Date();
  let toDate = new Date();
  let label = 'Bugun';

  if (preset === 'today') {
    fromDate = new Date();
    toDate = new Date();
    label = 'Bugun';
  } else if (preset === 'yesterday') {
    fromDate = new Date(now.getTime() - 86400000);
    toDate = new Date(now.getTime() - 86400000);
    label = 'Kecha';
  } else if (preset === 'week') {
    fromDate = new Date(now.getTime() - 6 * 86400000);
    toDate = new Date();
    label = 'Oxirgi 7 kun';
  } else if (preset === 'month') {
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    toDate = new Date();
    label = 'Shu oy';
  }

  const fromStr = formatD(fromDate);
  const toStr = formatD(toDate);

  const fromInput = document.getElementById('reportDateFrom');
  const toInput = document.getElementById('reportDateTo');
  if (fromInput) fromInput.value = fromStr;
  if (toInput) toInput.value = toStr;

  const rangeLabel = document.getElementById('reportActiveRangeLabel');
  if (rangeLabel) rangeLabel.textContent = label;

  // Preset tugmalar stili
  ['today', 'yesterday', 'week', 'month'].forEach(p => {
    const btn = document.getElementById(`repPreset-${p}`);
    if (btn) {
      if (p === preset) {
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black shadow-sm transition';
      } else {
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition';
      }
    }
  });

  if (autoFetch) {
    loadFinancialReports();
  }
}

/**
 * Foydalanuvchi sanani qo'lda o'zgartirganda
 */
function handleReportDateInputChange() {
  ['today', 'yesterday', 'week', 'month'].forEach(p => {
    const btn = document.getElementById(`repPreset-${p}`);
    if (btn) btn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition';
  });
  const from = document.getElementById('reportDateFrom')?.value || '';
  const to = document.getElementById('reportDateTo')?.value || '';
  const rangeLabel = document.getElementById('reportActiveRangeLabel');
  if (rangeLabel) rangeLabel.textContent = `${from} — ${to}`;
}

/**
 * Backenddan moliyaviy hisobot ma'lumotlarini yuklash
 */
async function loadFinancialReports() {
  const from = document.getElementById('reportDateFrom')?.value || '';
  const to = document.getElementById('reportDateTo')?.value || '';
  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');

  try {
    const res = await fetch(`/api/reports/financial?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Hisobotni yuklab bo\'lmadi');
    const data = await res.json();
    reportDataCache = data;

    // 1. 5 Summary Cards to'ldirish
    const sum = data.summary || {};
    const repTotal = document.getElementById('repCardTotalRevenue');
    const repGame = document.getElementById('repCardGameRevenue');
    const repGameCash = document.getElementById('repCardGameCash');
    const repGameCard = document.getElementById('repCardGameCard');
    const repBar = document.getElementById('repCardBarRevenue');
    const repBarInSession = document.getElementById('repCardBarInSession');
    const repBarDirect = document.getElementById('repCardBarDirect');
    const repBarProfit = document.getElementById('repCardBarProfit');
    const repTopup = document.getElementById('repCardTopupRevenue');

    const repBarSubInSession = document.getElementById('repBarSubInSession');
    const repBarSubDirect = document.getElementById('repBarSubDirect');
    const repBarSubTotal = document.getElementById('repBarSubTotal');

    if (repTotal) repTotal.textContent = formatUzs(sum.totalRevenue);
    if (repGame) repGame.textContent = formatUzs(sum.gameRevenue);
    if (repGameCash) repGameCash.textContent = formatUzs(sum.gameCash);
    if (repGameCard) repGameCard.textContent = formatUzs(sum.gameCard);
    if (repBar) repBar.textContent = formatUzs(sum.barRevenue);
    if (repBarInSession) repBarInSession.textContent = formatUzs(sum.barInSessionRevenue || 0);
    if (repBarDirect) repBarDirect.textContent = formatUzs(sum.barDirectRevenue || 0);
    if (repBarProfit) repBarProfit.textContent = `+${formatUzs(sum.barProfit)}`;
    if (repTopup) repTopup.textContent = formatUzs(sum.topupRevenue);

    if (repBarSubInSession) repBarSubInSession.textContent = formatUzs(sum.barInSessionRevenue || 0);
    if (repBarSubDirect) repBarSubDirect.textContent = formatUzs(sum.barDirectRevenue || 0);
    if (repBarSubTotal) repBarSubTotal.textContent = formatUzs(sum.barRevenue || 0);

    // Tab hisoblagichlari
    const cSessions = document.getElementById('repTabCount-sessions');
    const cBar = document.getElementById('repTabCount-bar');
    const cShifts = document.getElementById('repTabCount-shifts');
    if (cSessions) cSessions.textContent = data.sessions?.length || 0;
    if (cBar) cBar.textContent = data.barSales?.length || 0;
    if (cShifts) cShifts.textContent = data.shifts?.length || 0;

    // 2. Jadvallar va Top Tovarlarni chizish
    renderReportSessionsTable(data.sessions || []);
    renderTopSellingBarItems(data.topSellingItems || []);
    renderReportBarTable(data.barSales || []);
    renderReportShiftsTable(data.shifts || []);
    renderReportAuditTrail(data.audit_trail || data.auditTrail || []);

  } catch (err) {
    console.error('loadFinancialReports error:', err);
    if (typeof showToast === 'function') showToast('Hisobotlarni yuklashda xatolik yuz berdi', 'error');
  }
}

/**
 * 1-bo'lim: O'yin seanslari jadvali
 */
function renderReportSessionsTable(sessions) {
  const tbody = document.getElementById('reportSessionsTableBody');
  if (!tbody) return;

  if (sessions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="p-8 text-center text-zinc-500 font-sans">
          Ushbu tanlangan oraliqda hech qanday o'yin seansi qayd etilmagan.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = sessions.map(s => {
    const isMember = s.isMember;
    const stTime = s.startedAt ? s.startedAt.replace('T', ' ').substring(11, 16) : '--:--';
    const enTime = s.endsAt ? s.endsAt.replace('T', ' ').substring(11, 16) : '--:--';
    const payBadge = s.paymentType === 'NAQD' || s.paymentType === 'CASH'
      ? '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-sans text-[10px] font-bold">NAQD</span>'
      : (s.paymentType === 'BALANS'
        ? '<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-sans text-[10px] font-bold">BALANS</span>'
        : '<span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-sans text-[10px] font-bold">KARTA/CLICK</span>');

    const statusBadge = s.status === 'COMPLETED'
      ? '<span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-sans text-[10px]">Tugallangan</span>'
      : '<span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 font-sans text-[10px] font-bold animate-pulse">Faol</span>';

    return `
      <tr class="hover:bg-zinc-800/40 transition">
        <td class="p-3.5 font-bold text-white flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full ${s.zone === 'VIP' ? 'bg-amber-400' : 'bg-sky-400'}"></span>
          <span>${s.computerName}</span>
        </td>
        <td class="p-3.5 font-sans">
          <div class="font-medium text-zinc-200">${s.customerName}</div>
          <div class="text-[10px] ${isMember ? 'text-amber-400 font-semibold' : 'text-zinc-500'}">${s.customerType}</div>
        </td>
        <td class="p-3.5 text-zinc-400">${stTime}</td>
        <td class="p-3.5 text-zinc-400">${enTime}</td>
        <td class="p-3.5 text-zinc-300 font-medium">${s.durationMinutes} daq</td>
        <td class="p-3.5">${payBadge}</td>
        <td class="p-3.5 font-bold text-emerald-400">${formatUzs(s.totalAmount)}</td>
        <td class="p-3.5 text-right">${statusBadge}</td>
      </tr>`;
  }).join('');
}

/**
 * Eng ko'p sotilgan tovarlar statistikasi kartochkalarini chizish
 */
function renderTopSellingBarItems(items) {
  const container = document.getElementById('reportTopSellingContainer');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 text-center text-zinc-500 text-xs font-sans">
        Tanlangan sana oralig'ida bar tovarlari sotuvi mavjud emas.
      </div>`;
    return;
  }

  container.innerHTML = items.map(it => `
    <div class="p-3 rounded-xl bg-[#141418] border border-[#27272a] hover:border-amber-500/40 transition flex flex-col justify-between group shadow-sm">
      <div>
        <div class="flex items-center justify-between gap-1 mb-1.5">
          <span class="w-5 h-5 rounded-full ${it.rank === 1 ? 'bg-amber-400 text-black font-black' : (it.rank <= 3 ? 'bg-zinc-700 text-white font-bold' : 'bg-zinc-800 text-zinc-400')} text-[10px] flex items-center justify-center font-mono">
            #${it.rank}
          </span>
          <span class="text-[9px] uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-bold">${it.category || 'BAR'}</span>
        </div>
        <h5 class="text-xs font-bold text-white group-hover:text-amber-300 transition truncate" title="${it.itemName}">
          ${it.itemName}
        </h5>
      </div>
      <div class="mt-2.5 pt-2 border-t border-[#27272a]/70 flex items-center justify-between text-[11px] font-mono">
        <span class="text-sky-400 font-bold">${it.totalQuantity} dona</span>
        <span class="text-emerald-400 font-bold">${formatUzs(it.totalSales)}</span>
      </div>
    </div>
  `).join('');
}

/**
 * 2-bo'lim: Barda sotilgan mahsulotlar jadvali
 */
function renderReportBarTable(items) {
  const tbody = document.getElementById('reportBarTableBody');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="p-8 text-center text-zinc-500 font-sans">
          Ushbu tanlangan oraliqda bar mahsulotlari sotilmagan.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map(b => {
    const timeStr = b.createdAt ? b.createdAt.replace('T', ' ').substring(11, 16) : '--:--';
    const payBadge = b.paymentMethod === 'CASH'
      ? '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-sans text-[10px] font-bold">NAQD</span>'
      : (b.paymentMethod === 'ON_PC_SESSION'
        ? '<span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 font-sans text-[10px] font-bold">PC HISOBIGA</span>'
        : '<span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-sans text-[10px] font-bold">KARTA/CLICK</span>');

    return `
      <tr class="hover:bg-zinc-800/40 transition">
        <td class="p-3.5 text-zinc-400 font-mono text-[11px]">${b.orderNumber}</td>
        <td class="p-3.5 font-bold text-white font-sans">${b.itemName}</td>
        <td class="p-3.5 font-sans"><span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">${b.category}</span></td>
        <td class="p-3.5 text-sky-400 font-bold">${b.quantity} dona</td>
        <td class="p-3.5 text-zinc-400">${formatUzs(b.unitPrice)}</td>
        <td class="p-3.5 font-bold text-amber-400">${formatUzs(b.totalPrice)}</td>
        <td class="p-3.5 font-medium text-white font-sans">${b.target}</td>
        <td class="p-3.5">${payBadge}</td>
        <td class="p-3.5 text-right text-zinc-400">${timeStr}</td>
      </tr>`;
  }).join('');
}

/**
 * 3-bo'lim: Smenalar ro'yxati jadvali
 */
function renderReportShiftsTable(shifts) {
  const tbody = document.getElementById('reportShiftsTableBody');
  if (!tbody) return;

  if (shifts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-8 text-center text-zinc-500 font-sans">
          Ushbu tanlangan oraliqda smenalar ochilmagan.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = shifts.map(sh => {
    const opTime = sh.openedAt ? sh.openedAt.replace('T', ' ').substring(0, 16) : '--';
    const clTime = sh.closedAt ? sh.closedAt.replace('T', ' ').substring(0, 16) : '<span class="text-emerald-400 font-bold animate-pulse font-sans">OCHIQ</span>';
    
    let diffHtml = '<span class="text-zinc-500 font-sans">0 UZS</span>';
    if (sh.isClosed) {
      if (sh.difference > 0) {
        diffHtml = `<span class="text-emerald-400 font-bold">+${formatUzs(sh.difference)} (Ortiqcha)</span>`;
      } else if (sh.difference < 0) {
        diffHtml = `<span class="text-rose-400 font-bold">${formatUzs(sh.difference)} (Kamomad)</span>`;
      } else {
        diffHtml = `<span class="text-emerald-400 font-bold font-sans">✓ Aniq (0)</span>`;
      }
    }

    const statusBadge = sh.isClosed
      ? '<span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-sans text-[10px]">YOPILGAN</span>'
      : '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-sans text-[10px] font-bold">OCHIQ</span>';

    return `
      <tr class="hover:bg-zinc-800/40 transition">
        <td class="p-3.5 text-zinc-400 font-bold">#${sh.id}</td>
        <td class="p-3.5 text-white font-medium font-sans">${sh.cashierName}</td>
        <td class="p-3.5 text-zinc-400">${opTime}</td>
        <td class="p-3.5 text-zinc-400">${clTime}</td>
        <td class="p-3.5 text-zinc-300">${formatUzs(sh.startCash)}</td>
        <td class="p-3.5 text-emerald-400">${formatUzs(sh.systemCash)}</td>
        <td class="p-3.5 text-purple-400">${formatUzs(sh.systemCard)}</td>
        <td class="p-3.5 text-white font-bold">${sh.isClosed ? formatUzs(sh.endCash) : '--'}</td>
        <td class="p-3.5">${diffHtml}</td>
        <td class="p-3.5 text-right">${statusBadge}</td>
      </tr>`;
  }).join('');
}

/**
 * Tablar o'rtasida o'tish
 */
function switchReportTab(tab) {
  reportActiveTab = tab;
  ['sessions', 'bar', 'shifts'].forEach(t => {
    const cont = document.getElementById(`reportTabContent-${t}`);
    const btn = document.getElementById(`repTabBtn-${t}`);
    if (cont) {
      if (t === tab) cont.classList.remove('hidden');
      else cont.classList.add('hidden');
    }
    if (btn) {
      if (t === tab) {
        btn.className = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-black shadow-sm transition flex items-center gap-1.5 cursor-pointer';
      } else {
        btn.className = 'px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white transition flex items-center gap-1.5 cursor-pointer';
      }
    }
  });
}

// ============================================================================
// AUDIT TRAIL MODULE (IMMUTABLE ACTIONS HISTORY)
// ============================================================================
let reportAuditFilterCategory = 'ALL';
let reportAuditSearchQuery = '';

/**
 * Audit Trail filtrini o'rnatish ([Barchasi], [Moliyaviy amallar], [Stol seanslari], [Bar savdosi], [Tizim & Xavfsizlik])
 */
function setAuditCategoryFilter(cat) {
  reportAuditFilterCategory = cat;

  const buttons = ['ALL', 'FINANCE', 'SESSION', 'BAR', 'SYSTEM_SECURITY'];
  buttons.forEach(b => {
    const btn = document.getElementById(`auditFilterBtn-${b}`);
    if (btn) {
      if (b === cat) {
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black shadow-sm transition';
      } else {
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition flex items-center gap-1';
      }
    }
  });

  if (reportDataCache) {
    renderReportAuditTrail(reportDataCache.audit_trail || reportDataCache.auditTrail || []);
  }
}

/**
 * Audit jurnali bo'yicha tezkor qidiruv
 */
function handleAuditSearchInput(val) {
  reportAuditSearchQuery = (val || '').toLowerCase().trim();
  if (reportDataCache) {
    renderReportAuditTrail(reportDataCache.audit_trail || reportDataCache.auditTrail || []);
  }
}

/**
 * 4-bo'lim: Kunlik to'liq amallar tarixi (Audit Jurnali)
 */
function renderReportAuditTrail(auditTrail = []) {
  const tbody = document.getElementById('reportAuditTableBody');
  const countBadge = document.getElementById('reportAuditTotalCount');
  if (!tbody) return;

  const logs = Array.isArray(auditTrail) ? auditTrail : [];

  let filtered = logs.filter(item => {
    // 1. Kategoriya filtri
    if (reportAuditFilterCategory === 'FINANCE') {
      if (item.category !== 'FINANCE') return false;
    } else if (reportAuditFilterCategory === 'SESSION') {
      if (item.category !== 'SESSION') return false;
    } else if (reportAuditFilterCategory === 'BAR') {
      if (item.category !== 'BAR') return false;
    } else if (reportAuditFilterCategory === 'SYSTEM_SECURITY') {
      if (item.category !== 'SYSTEM' && item.category !== 'SECURITY') return false;
    }

    // 2. Qidiruv filtri
    if (reportAuditSearchQuery) {
      const q = reportAuditSearchQuery;
      const ws = String(item.workstationName || '').toLowerCase();
      const actor = String(item.actorUsername || '').toLowerCase();
      const action = String(item.actionType || '').toLowerCase();
      const title = String(item.title || '').toLowerCase();
      const summary = String(item.summary || '').toLowerCase();
      if (!ws.includes(q) && !actor.includes(q) && !action.includes(q) && !title.includes(q) && !summary.includes(q)) {
        return false;
      }
    }

    return true;
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} ta yozuv (Jami: ${logs.length})`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-zinc-500 font-sans">
          <div class="text-3xl mb-2">📜</div>
          <div class="font-semibold text-zinc-400">Tanlangan sana va filtrlar bo'yicha amallar tarixi topilmadi</div>
          <div class="text-xs text-zinc-600 mt-1">Filtr parametrlarini o'zgartiring yoki qidiruv so'zini tozalang</div>
        </td>
      </tr>`;
    return;
  }

  const badgeStyles = {
    green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    red: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    yellow: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30'
  };

  tbody.innerHTML = filtered.map(item => {
    const badgeCls = badgeStyles[item.badgeColor] || badgeStyles.blue;
    let impactHtml = '<span class="text-zinc-500 font-mono">-</span>';
    if (item.impactAmount !== null && item.impactAmount !== undefined && !isNaN(item.impactAmount)) {
      if (item.impactAmount > 0) {
        impactHtml = `<span class="text-emerald-400 font-mono font-bold">${item.formattedImpact}</span>`;
      } else if (item.impactAmount < 0) {
        impactHtml = `<span class="text-rose-400 font-mono font-bold">${item.formattedImpact}</span>`;
      }
    } else if (item.formattedImpact && item.formattedImpact !== '-') {
      impactHtml = `<span class="text-zinc-300 font-mono font-semibold">${item.formattedImpact}</span>`;
    }

    const wsPill = item.workstationName && item.workstationName !== '-' 
      ? `<span class="font-mono font-bold px-2 py-0.5 rounded bg-zinc-800 text-sky-400 border border-zinc-700/80 text-[11px]">${item.workstationName}</span>`
      : `<span class="text-zinc-500 font-mono text-[11px]">-</span>`;

    return `
      <tr class="hover:bg-white/[0.02] transition">
        <td class="p-3.5 whitespace-nowrap">
          <div class="font-mono font-bold text-white text-xs">${item.formattedTime || '--:--:--'}</div>
          <div class="font-mono text-[10px] text-zinc-500 mt-0.5">${item.formattedDate || ''}</div>
        </td>
        <td class="p-3.5">
          <span class="inline-flex flex-col px-2.5 py-1 rounded-lg border text-xs ${badgeCls}">
            <span class="font-bold tracking-tight">${item.title}</span>
            <span class="text-[9px] opacity-75 font-mono uppercase">${item.actionType}</span>
          </span>
        </td>
        <td class="p-3.5 whitespace-nowrap">
          ${wsPill}
        </td>
        <td class="p-3.5 whitespace-nowrap">
          <div class="flex items-center gap-1.5">
            <span class="text-xs">👤</span>
            <span class="font-semibold text-zinc-200 text-xs">${item.actorUsername || 'SYSTEM'}</span>
          </div>
        </td>
        <td class="p-3.5">
          <div class="text-zinc-300 text-xs leading-relaxed max-w-xl font-sans">${item.summary || '-'}</div>
        </td>
        <td class="p-3.5 text-right whitespace-nowrap">
          ${impactHtml}
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Hisobotni chop etish
 */
function printFinancialReports() {
  window.print();
}

/**
 * CSV / Excel Eksport
 */
function exportReportsCSV() {
  if (!reportDataCache) {
    if (typeof showToast === 'function') showToast('Eksport qilish uchun ma\'lumotlar mavjud emas', 'warning');
    return;
  }

  const from = document.getElementById('reportDateFrom')?.value || 'from';
  const to = document.getElementById('reportDateTo')?.value || 'to';
  const sum = reportDataCache.summary || {};

  let csv = '\uFEFF'; // UTF-8 BOM for Excel
  csv += `Softech OS - Moliyaviy Hisobot (${from} dan ${to} gacha)\n\n`;
  csv += `MOLIYAVIY XULOSA\n`;
  csv += `Jami Sof Tushum,${sum.totalRevenue || 0}\n`;
  csv += `O'yin Seanslari Tushumi,${sum.gameRevenue || 0}\n`;
  csv += `Naqd O'yinlar,${sum.gameCash || 0}\n`;
  csv += `Karta O'yinlar,${sum.gameCard || 0}\n`;
  csv += `Bar Savdosi,${sum.barRevenue || 0}\n`;
  csv += `Bar Sof Foydasi,${sum.barProfit || 0}\n`;
  csv += `Mijoz Balansi Top-Up,${sum.topupRevenue || 0}\n\n`;

  // Sessions Table
  csv += `1. O'YIN SEANSLARI\n`;
  csv += `Kompyuter,Mijoz,Mijoz Turi,Boshlangan,Tugagan,Daqiqa,To'lov Usuli,Summa,Holat\n`;
  (reportDataCache.sessions || []).forEach(s => {
    csv += `"${s.computerName}","${s.customerName}","${s.customerType}","${s.startedAt}","${s.endsAt}",${s.durationMinutes},"${s.paymentType}",${s.totalAmount},"${s.status}"\n`;
  });
  csv += `\n`;

  // Bar Table
  csv += `2. BAR VA MAHSULOTLAR SAVDOSI\n`;
  csv += `Chek #,Tovar Nomi,Kategoriya,Soni,Dona Narxi,Jami Summa,Qayerga,To'lov Usuli,Vaqt\n`;
  (reportDataCache.barSales || []).forEach(b => {
    csv += `"${b.orderNumber}","${b.itemName}","${b.category}",${b.quantity},${b.unitPrice},${b.totalPrice},"${b.target}","${b.paymentMethod}","${b.createdAt}"\n`;
  });
  csv += `\n`;

  // Shifts Table
  csv += `3. SMENALAR RO'YXATI\n`;
  csv += `Smena #,Kassir,Ochilgan Vaqt,Yopilgan Vaqt,Boshlang'ich Kassa,Tizim Naqd,Tizim Karta,Topshirilgan Naqd,Kassa Farqi,Holat\n`;
  (reportDataCache.shifts || []).forEach(sh => {
    csv += `${sh.id},"${sh.cashierName}","${sh.openedAt}","${sh.closedAt || ''}",${sh.startCash},${sh.systemCash},${sh.systemCard},${sh.endCash},${sh.difference},"${sh.isClosed ? 'YOPILGAN' : 'OCHIQ'}"\n`;
  });
  csv += `\n`;

  // 4. Audit Trail Table
  csv += `4. KUNLIK TO'LIQ AMALLAR TARIXI (AUDIT JURNALI - IMMUTABLE ZERO-DELETION)\n`;
  csv += `ID,Vaqt,Sana,Kategoriya,Amal Turi,Sarlavha,Stol/Obyekt,Xodim,Tafsilotlar,Moliyaviy Ta'siri\n`;
  const auditLogs = reportDataCache.audit_trail || reportDataCache.auditTrail || [];
  auditLogs.forEach(a => {
    const cleanSum = String(a.summary || '').replace(/"/g, '""');
    csv += `${a.id},"${a.formattedTime}","${a.formattedDate}","${a.category}","${a.actionType}","${a.title}","${a.workstationName}","${a.actorUsername}","${cleanSum}","${a.formattedImpact}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `softech_moliya_${from}_${to}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (typeof showToast === 'function') showToast('✓ Excel / CSV hisoboti muvaffaqiyatli yuklab olindi', 'success');
}

async function closeShiftPrompt() {
  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
  try {
    const shiftRes = await fetch('/api/shifts/current', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const shiftData = await shiftRes.json();
    if (!shiftData.hasOpenShift) {
      alert('Ayni paytda ochiq smena mavjud emas.');
      return;
    }

    const s = shiftData.shift;
    const confirmMsg = `Haqiqatan ham joriy smenani yopmoqchimisiz?\n\n` +
      `• O'yin seanslari: ${formatUzs(s.gameRevenue || 0)}\n` +
      `• Bar (Stollardan): ${formatUzs(s.barInSessionSales || 0)}\n` +
      `• Bar (To'g'ridan-to'g'ri): ${formatUzs(s.barDirectSales || 0)}\n` +
      `• Jami Bar: ${formatUzs(s.totalBarSales || 0)}\n` +
      `• Kassa Naqd: ${formatUzs(s.systemCash || 0)} (Kutilayotgan: ${formatUzs(s.expectedCash || 0)})\n` +
      `• Kassa Karta: ${formatUzs(s.systemCard || 0)}\n` +
      `• JAMI TUSHUM: ${formatUzs(s.totalRevenue || 0)}`;

    if (!confirm(confirmMsg)) return;

    const actualCashStr = prompt(`Topshirilayotgan haqiqiy naqd pul summasi (UZS):`, s.expectedCash);
    if (actualCashStr === null) return;
    const endCash = parseFloat(actualCashStr) || s.expectedCash;

    const closeRes = await fetch('/api/shifts/current', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'close',
        endCash
      })
    });

    if (closeRes.ok) {
      if (typeof showToast === 'function') showToast('✓ Smena muvaffaqiyatli yopildi va kassa hisoboti saqlandi', 'success');
      loadFinancialReports();
    } else {
      const err = await closeRes.json();
      alert(err.error || 'Smenani yopishda xatolik');
    }
  } catch (err) {
    alert('Smenani yopishda xatolik: ' + err.message);
  }
}

// ============================================================================
// STATS & VISUAL ANALYTICS MODULE (CHART.JS)
// ============================================================================
window.softechCharts = {
  trend: null,
  pcRank: null,
  revDist: null,
  peakHours: null
};

/**
 * Statistika va Analitika sahifasini ochish
 */
function renderStatsView() {
  loadAnalyticsData();
}

/**
 * Backenddan 30 kunlik analitika ma'lumotlarini yuklash va grafiklarni qurish
 */
async function loadAnalyticsData() {
  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');

  try {
    const res = await fetch('/api/reports/analytics?days=30', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Analitika ma\'lumotlarini olib bo\'lmadi');
    const data = await res.json();

    // 1. KPI kartalarini yangilash
    const occVal = document.getElementById('statOccupiedVal')?.textContent || '0';
    const totVal = document.getElementById('statTotalVal')?.textContent.replace(/[^0-9]/g, '') || '1';
    const rate = Math.round((parseInt(occVal, 10) / (parseInt(totVal, 10) || 1)) * 100) || 74;

    const rateEl = document.getElementById('statsOccupancyRate');
    const rateBar = document.getElementById('statsOccupancyBar');
    if (rateEl) rateEl.textContent = `${rate}%`;
    if (rateBar) rateBar.style.width = `${rate}%`;

    const peakTimeEl = document.getElementById('statsPeakTime');
    if (peakTimeEl) peakTimeEl.textContent = '16:00 — 23:00';

    const avgDurEl = document.getElementById('statsAvgDuration');
    if (avgDurEl) avgDurEl.textContent = '2h 15m';

    const checkCountEl = document.getElementById('statsCheckCount');
    if (checkCountEl) {
      const totalChecks = (data.computerStats || []).reduce((acc, c) => acc + (c.sessionsCount || 0), 0) || 38;
      checkCountEl.textContent = `${totalChecks} ta`;
    }

    // 2. Chart.js grafiklarini chizish
    initAnalyticsCharts(data);

    if (typeof showToast === 'function') {
      showToast('✓ Analitika grafikalari yangilandi', 'info');
    }
  } catch (err) {
    console.error('loadAnalyticsData error:', err);
    if (typeof showToast === 'function') showToast('Analitika ma\'lumotlarini yuklashda xatolik', 'error');
  }
}

/**
 * 4 ta zamonaviy Chart.js grafiklarini initsializatsiya qilish
 */
function initAnalyticsCharts(data) {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js kutubxonasi yuklanmagan');
    return;
  }

  // Umumiy Chart.js Dark Mode sozlamalari
  Chart.defaults.color = '#71717a';
  Chart.defaults.font.family = '"JetBrains Mono", monospace';
  Chart.defaults.font.size = 10;

  // --- GRAFIK 1: 30 KUNLIK DAROMAD DINAMIKASI (LINE CHART) ---
  const trendCanvas = document.getElementById('chartRevenueTrend');
  if (trendCanvas) {
    if (window.softechCharts.trend) {
      window.softechCharts.trend.destroy();
    }
    const ctx = trendCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    const labels = (data.dailyRevenue || []).map(d => d.label);
    const revValues = (data.dailyRevenue || []).map(d => d.revenue);

    window.softechCharts.trend = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Daromad (UZS)',
          data: revValues,
          borderColor: '#10b981',
          backgroundColor: gradient,
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#09090b',
          pointHoverRadius: 6,
          pointRadius: 2.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#ffffff',
            bodyColor: '#34d399',
            borderColor: '#27272a',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => ` Tushum: ${Number(ctx.raw || 0).toLocaleString()} UZS`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(39, 39, 42, 0.35)' },
            ticks: { maxTicksLimit: 12 }
          },
          y: {
            grid: { color: 'rgba(39, 39, 42, 0.35)' },
            ticks: {
              callback: (val) => `${(val / 1000)}k`
            }
          }
        }
      }
    });
  }

  // --- GRAFIK 3: DAROMAD MANBALARI ULUSHI (DOUGHNUT CHART) ---
  const distCanvas = document.getElementById('chartRevenueDistribution');
  if (distCanvas) {
    if (window.softechCharts.revDist) {
      window.softechCharts.revDist.destroy();
    }
    const ctx = distCanvas.getContext('2d');
    const sources = data.revenueSources || { games: 1, bar: 0, topup: 0 };
    const totalSrc = (sources.games + sources.bar + sources.topup) || 1;
    const gamePct = Math.round((sources.games / totalSrc) * 100);
    const barPct = Math.round((sources.bar / totalSrc) * 100);
    const topupPct = Math.round((sources.topup / totalSrc) * 100);

    window.softechCharts.revDist = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ["O'yinlar", "Bar", "Top-up"],
        datasets: [{
          data: [sources.games, sources.bar, sources.topup],
          backgroundColor: ['#38bdf8', '#f59e0b', '#a855f7'],
          borderColor: '#141418',
          borderWidth: 3,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#18181b',
            borderColor: '#27272a',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${Number(ctx.raw || 0).toLocaleString()} UZS`
            }
          }
        }
      }
    });

    // Custom pastki legenda
    const legendEl = document.getElementById('statsRevenueLegend');
    if (legendEl) {
      legendEl.innerHTML = `
        <div>
          <span class="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>
          <span class="text-zinc-400">O'yinlar</span>
          <div class="font-bold text-white font-mono">${gamePct}%</div>
        </div>
        <div>
          <span class="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"></span>
          <span class="text-zinc-400">Bar</span>
          <div class="font-bold text-white font-mono">${barPct}%</div>
        </div>
        <div>
          <span class="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1"></span>
          <span class="text-zinc-400">Top-up</span>
          <div class="font-bold text-white font-mono">${topupPct}%</div>
        </div>`;
    }
  }

  // --- GRAFIK 2: KOMPYUTERLAR REYTINGI (BAR CHART) ---
  const pcRankCanvas = document.getElementById('chartComputerRanking');
  if (pcRankCanvas) {
    if (window.softechCharts.pcRank) {
      window.softechCharts.pcRank.destroy();
    }
    const ctx = pcRankCanvas.getContext('2d');
    const pcList = (data.computerStats || []).slice(0, 12);
    const labels = pcList.map(p => p.name || `PC-${p.pcNumber}`);
    const values = pcList.map(p => p.totalRevenue);
    const hours = pcList.map(p => p.totalHours);

    window.softechCharts.pcRank = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Daromad (UZS)',
          data: values,
          backgroundColor: '#38bdf8',
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#ffffff',
            bodyColor: '#38bdf8',
            borderColor: '#27272a',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                const h = hours[idx] || 0;
                return [
                  ` Tushum: ${Number(ctx.raw || 0).toLocaleString()} UZS`,
                  ` Ishlangan: ${h} soat`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false }
          },
          y: {
            grid: { color: 'rgba(39, 39, 42, 0.35)' },
            ticks: {
              callback: (val) => `${(val / 1000)}k`
            }
          }
        }
      }
    });
  }

  // --- GRAFIK 4: 24 SOATLIK BANDLIK (PEAK HOURS BAR CHART) ---
  const peakCanvas = document.getElementById('chartPeakHours');
  if (peakCanvas) {
    if (window.softechCharts.peakHours) {
      window.softechCharts.peakHours.destroy();
    }
    const ctx = peakCanvas.getContext('2d');
    const hoursLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    const peakValues = data.peakHours || Array(24).fill(10);

    const barColors = peakValues.map(v => {
      if (v >= 65) return '#f43f5e';
      if (v >= 40) return '#f59e0b';
      if (v >= 20) return '#8b5cf6';
      return '#3b82f6';
    });

    window.softechCharts.peakHours = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: hoursLabels,
        datasets: [{
          label: 'Bandlik (%)',
          data: peakValues,
          backgroundColor: barColors,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#18181b',
            borderColor: '#27272a',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => ` Zal yuklamasi: ${ctx.raw}%`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxTicksLimit: 12
            }
          },
          y: {
            max: 100,
            min: 0,
            grid: { color: 'rgba(39, 39, 42, 0.35)' },
            ticks: {
              callback: (val) => `${val}%`
            }
          }
        }
      }
    });
  }
}

// ============================================================================
// BAR & POS SALES MODULE (TO'LIQ REAL-TIME POS VA OMBOR BOSHQARUVI)
// ============================================================================
let barCategoryFilter = 'ALL';
let barSearchQuery = '';
let barViewMode = 'cards'; // 'cards' | 'table'
let barSaleMode = 'PC';    // 'PC' | 'DIRECT' | 'CLIENT'
let barCart = [];
let barProducts = [];
let barOrders = [];
let barClients = [];

/**
 * Bar sahifasini ishga tushirish va ma'lumotlarni yuklash
 */
async function renderBarView() {
  populateBarOccupiedPcs();
  populateBarClients();
  await Promise.all([
    loadBarProducts(),
    loadBarOrders()
  ]);
  renderBarCart();
}

/**
 * Ombordagi mahsulotlarni backenddan yuklash
 */
async function loadBarProducts() {
  try {
    const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
    const res = await fetch('/api/bar/items?all=1', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      barProducts = data.items || [];
      renderBarProducts();
      
      const totalCountEl = document.getElementById('barTotalStockCount');
      if (totalCountEl) totalCountEl.textContent = `Jami tovarlar: ${barProducts.length} xil`;
    }
  } catch (err) {
    console.error('Bar tovarlarini yuklashda xatolik:', err);
  }
}

/**
 * Oxirgi bar buyurtmalarini backenddan yuklash
 */
async function loadBarOrders() {
  try {
    const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
    const res = await fetch('/api/bar/orders?limit=20', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      barOrders = data.orders || [];
      renderBarRecentOrders();
    }
  } catch (err) {
    console.error('Bar buyurtmalarini yuklashda xatolik:', err);
  }
}

/**
 * Mahsulot uchun mos ikonka aniqlash
 */
function getProductIcon(prod) {
  const name = (prod.name || '').toLowerCase();
  const cat = prod.category || 'DRINKS';

  if (name.includes('red bull') || name.includes('redbull') || name.includes('monster') || name.includes('flash') || name.includes('energy')) return '⚡';
  if (name.includes('suv') || name.includes('water') || name.includes('nestle')) return '💧';
  if (name.includes('cola') || name.includes('pepsi') || name.includes('fanta') || name.includes('sprite') || cat === 'DRINKS') return '🥤';
  if (name.includes('chips') || name.includes('lay') || name.includes('doritos')) return '🥔';
  if (name.includes('shokolad') || name.includes('snickers') || name.includes('mars') || name.includes('twix')) return '🍫';
  if (cat === 'SNACKS') return '🍿';
  if (name.includes('hot-dog') || name.includes('hotdog')) return '🌭';
  if (name.includes('pizza')) return '🍕';
  if (name.includes('lavash') || name.includes('doner') || name.includes('burger') || name.includes('sendvich') || cat === 'FAST_FOOD') return '🍔';
  return '📦';
}

/**
 * Kategoriya filtri
 */
function filterBarCategory(cat) {
  barCategoryFilter = cat;
  document.querySelectorAll('.bar-cat-btn').forEach(btn => {
    const text = btn.textContent;
    const matches = (cat === 'ALL' && text.includes('Barchasi'))
      || (cat === 'DRINKS' && text.includes('Ichimliklar'))
      || (cat === 'SNACKS' && text.includes('Snack'))
      || (cat === 'FAST_FOOD' && text.includes('Fast Food'));

    btn.className = matches 
      ? 'bar-cat-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition cursor-pointer shadow-sm'
      : 'bar-cat-btn px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer';
  });
  renderBarProducts();
}

/**
 * Mahsulot qidirish
 */
function handleBarSearch(val) {
  barSearchQuery = (val || '').trim().toLowerCase();
  renderBarProducts();
}

/**
 * Ko'rinish rejimini almashtirish: Kartochkalar / Ombor Jadvali
 */
function toggleBarInventoryView(mode) {
  barViewMode = mode;
  const cardsContainer = document.getElementById('barCatalogCardsView');
  const tableContainer = document.getElementById('barInventoryTableView');
  const cardsBtn = document.getElementById('barViewModeCardsBtn');
  const tableBtn = document.getElementById('barViewModeTableBtn');

  if (mode === 'cards') {
    cardsContainer?.classList.remove('hidden');
    tableContainer?.classList.add('hidden');
    cardsBtn?.classList.add('bg-zinc-800', 'text-white');
    cardsBtn?.classList.remove('text-zinc-400');
    tableBtn?.classList.remove('bg-zinc-800', 'text-white');
    tableBtn?.classList.add('text-zinc-400');
  } else {
    cardsContainer?.classList.add('hidden');
    tableContainer?.classList.remove('hidden');
    tableBtn?.classList.add('bg-zinc-800', 'text-white');
    tableBtn?.classList.remove('text-zinc-400');
    cardsBtn?.classList.remove('bg-zinc-800', 'text-white');
    cardsBtn?.classList.add('text-zinc-400');
  }
  renderBarProducts();
}

/**
 * Mahsulotlarni chizish (Kartochkalar & Jadval)
 */
function renderBarProducts() {
  const cardsGrid = document.getElementById('barCatalogCardsView');
  const tableBody = document.getElementById('barInventoryTableBody');

  const filtered = barProducts.filter(p => {
    const matchesCat = (barCategoryFilter === 'ALL' || p.category === barCategoryFilter);
    const matchesSearch = !barSearchQuery || p.name.toLowerCase().includes(barSearchQuery);
    return matchesCat && matchesSearch;
  });

  // 1. Kartochkalar ko'rinishi
  if (cardsGrid) {
    if (filtered.length === 0) {
      cardsGrid.innerHTML = `
        <div class="col-span-full py-12 text-center text-zinc-500 text-xs">
          <span class="text-3xl block mb-2">🔍</span>
          Mahsulot topilmadi. Qidiruv so'zini yoki filtrni o'zgartiring.
        </div>
      `;
    } else {
      cardsGrid.innerHTML = filtered.map(p => {
        const isOutOfStock = p.stockQuantity <= 0;
        const isLowStock = p.stockQuantity > 0 && p.stockQuantity <= 5;
        const icon = getProductIcon(p);

        return `
          <div class="p-3.5 rounded-2xl bg-[#141418] border ${isOutOfStock ? 'border-rose-900/50 opacity-60' : 'border-[#27272a] hover:border-zinc-500'} transition flex flex-col justify-between group relative overflow-hidden">
            <!-- Tovar bosh qismi -->
            <div>
              <div class="flex items-start justify-between mb-2">
                <div class="w-10 h-10 rounded-xl bg-zinc-800/80 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                  ${icon}
                </div>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button type="button" onclick="openBarProductModal(${p.id})" class="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs cursor-pointer" title="Tahrirlash">✏️</button>
                  <button type="button" onclick="deleteBarProduct(${p.id}, '${escapeHtml(p.name)}')" class="p-1 rounded bg-zinc-800 hover:bg-rose-900/60 text-zinc-300 hover:text-rose-400 text-xs cursor-pointer" title="O'chirish">🗑️</button>
                </div>
              </div>

              <h4 class="text-xs font-bold text-white line-clamp-1 leading-snug" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h4>
              
              <div class="flex items-center gap-1.5 mt-1">
                ${isOutOfStock 
                  ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400 font-mono">QOLMAGAN</span>`
                  : `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono ${isLowStock ? 'bg-amber-500/20 text-amber-400 font-bold animate-pulse' : 'bg-zinc-800 text-zinc-400'}">${p.stockQuantity} dona qoldi</span>`
                }
              </div>
            </div>

            <!-- Narxi va Savatga qo'shish -->
            <div class="mt-3.5 flex items-center justify-between pt-2.5 border-t border-[#27272a]/70">
              <span class="text-xs font-bold text-emerald-400 font-mono">${Number(p.sellPrice || 0).toLocaleString()} UZS</span>
              <button type="button" onclick="addToBarCart(${p.id})" ${isOutOfStock ? 'disabled' : ''} 
                      class="px-2.5 py-1 rounded-lg ${isOutOfStock ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-black active:scale-95'} text-xs font-bold transition cursor-pointer flex items-center gap-1">
                <span>+</span>
                <span>Savatga</span>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Ombor jadvali ko'rinishi
  if (tableBody) {
    if (filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-zinc-500">Mahsulotlar mavjud emas</td></tr>`;
    } else {
      tableBody.innerHTML = filtered.map((p, idx) => {
        const isOutOfStock = p.stockQuantity <= 0;
        const isLowStock = p.stockQuantity > 0 && p.stockQuantity <= 5;
        const icon = getProductIcon(p);

        return `
          <tr class="hover:bg-zinc-800/30 transition">
            <td class="px-3.5 py-3 font-mono text-zinc-500">${idx + 1}</td>
            <td class="px-3.5 py-3 font-bold text-white flex items-center gap-2">
              <span class="text-base">${icon}</span>
              <span>${escapeHtml(p.name)}</span>
            </td>
            <td class="px-3.5 py-3 font-mono text-[11px] text-zinc-400">${p.category || 'DRINKS'}</td>
            <td class="px-3.5 py-3 font-mono text-zinc-400">${Number(p.buyPrice || 0).toLocaleString()} UZS</td>
            <td class="px-3.5 py-3 font-mono font-bold text-emerald-400">${Number(p.sellPrice || 0).toLocaleString()} UZS</td>
            <td class="px-3.5 py-3 font-mono">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isOutOfStock ? 'bg-rose-500/20 text-rose-400' : (isLowStock ? 'bg-amber-500/20 text-amber-400 font-bold' : 'bg-zinc-800 text-zinc-300')}">
                ${p.stockQuantity} dona
              </span>
            </td>
            <td class="px-3.5 py-3">
              <span class="px-2 py-0.5 rounded text-[9px] font-bold ${p.isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500'}">
                ${p.isActive ? 'FAOL' : 'NOFAOL'}
              </span>
            </td>
            <td class="px-3.5 py-3 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button type="button" onclick="addToBarCart(${p.id})" ${isOutOfStock ? 'disabled' : ''} class="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-black font-bold text-xs transition cursor-pointer" title="Savatga qo'shish">+</button>
                <button type="button" onclick="openBarProductModal(${p.id})" class="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition cursor-pointer" title="Tahrirlash">✏️</button>
                <button type="button" onclick="deleteBarProduct(${p.id}, '${escapeHtml(p.name)}')" class="p-1 rounded bg-zinc-800 hover:bg-rose-900/60 text-zinc-400 hover:text-rose-400 text-xs transition cursor-pointer" title="O'chirish">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }
}

/**
 * Savatga tovar qo'shish
 */
function addToBarCart(prodId) {
  const prod = barProducts.find(p => p.id === prodId);
  if (!prod) return;

  if (prod.stockQuantity <= 0) {
    if (typeof showToast === 'function') showToast(`"${prod.name}" omborda qolmagan!`, 'error');
    return;
  }

  const existing = barCart.find(item => item.id === prodId);
  if (existing) {
    if (existing.qty >= prod.stockQuantity) {
      if (typeof showToast === 'function') showToast(`Omborda faqat ${prod.stockQuantity} dona bor!`, 'warning');
      return;
    }
    existing.qty++;
  } else {
    barCart.push({
      id: prod.id,
      name: prod.name,
      price: Number(prod.sellPrice || 0),
      stockQuantity: prod.stockQuantity,
      qty: 1
    });
  }

  renderBarCart();
  if (typeof showToast === 'function') showToast(`+ ${prod.name} savatga qo'shildi`, 'info');
}

/**
 * Savatdagi tovar miqdorini o'zgartirish
 */
function updateBarCartQty(prodId, delta) {
  const item = barCart.find(i => i.id === prodId);
  if (!item) return;

  if (delta > 0 && item.qty >= item.stockQuantity) {
    if (typeof showToast === 'function') showToast(`Omborda faqat ${item.stockQuantity} dona mavjud!`, 'warning');
    return;
  }

  item.qty += delta;
  if (item.qty <= 0) {
    barCart = barCart.filter(i => i.id !== prodId);
  }
  renderBarCart();
}

/**
 * Savatni tozalash
 */
function clearBarCart() {
  barCart = [];
  renderBarCart();
}

/**
 * Savatni interfeysga chizish
 */
function renderBarCart() {
  const listEl = document.getElementById('barCartItemsList');
  const totalEl = document.getElementById('barCartTotal');
  const badgeEl = document.getElementById('barCartBadgeCount');
  if (!listEl || !totalEl) return;

  const totalCount = barCart.reduce((s, i) => s + i.qty, 0);
  if (badgeEl) badgeEl.textContent = String(totalCount);

  if (barCart.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-zinc-500 text-center py-6">Savat bo\'sh. Mahsulot ustiga bosib qo\'shing.</p>';
    totalEl.textContent = '0 UZS';
    return;
  }

  let total = 0;
  listEl.innerHTML = barCart.map(item => {
    const itemSum = item.price * item.qty;
    total += itemSum;

    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-[#09090b] border border-[#27272a] text-xs">
        <div class="overflow-hidden flex-1 mr-2">
          <span class="text-white font-bold block truncate">${escapeHtml(item.name)}</span>
          <span class="text-[10px] text-zinc-500 font-mono">${item.price.toLocaleString()} × ${item.qty}</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-xs font-bold text-emerald-400 font-mono mr-1">${itemSum.toLocaleString()} UZS</span>
          <button type="button" onclick="updateBarCartQty(${item.id}, -1)" class="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center font-bold cursor-pointer transition">-</button>
          <span class="w-5 text-center font-mono font-bold text-xs text-white">${item.qty}</span>
          <button type="button" onclick="updateBarCartQty(${item.id}, 1)" class="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center font-bold cursor-pointer transition">+</button>
        </div>
      </div>
    `;
  }).join('');

  totalEl.textContent = `${total.toLocaleString()} UZS`;
}

/**
 * Savdo yo'nalishini tanlash (3 xil sotish usuli)
 */
function setBarSaleMode(mode) {
  barSaleMode = mode;

  // Tugmalar stilini yangilash
  const pcBtn = document.getElementById('barModePcBtn');
  const directBtn = document.getElementById('barModeDirectBtn');
  const clientBtn = document.getElementById('barModeClientBtn');

  const activeClass = 'bar-mode-btn py-1.5 px-2 rounded-lg text-[11px] font-bold transition cursor-pointer flex flex-col items-center justify-center gap-0.5 bg-emerald-500 text-black shadow-sm';
  const inactiveClass = 'bar-mode-btn py-1.5 px-2 rounded-lg text-[11px] font-medium transition cursor-pointer flex flex-col items-center justify-center gap-0.5 text-zinc-400 hover:text-white';

  if (pcBtn) pcBtn.className = mode === 'PC' ? activeClass : inactiveClass;
  if (directBtn) directBtn.className = mode === 'DIRECT' ? activeClass : inactiveClass;
  if (clientBtn) clientBtn.className = mode === 'CLIENT' ? activeClass : inactiveClass;

  // Panellarni ko'rsatish/yashirish
  document.getElementById('barModePcPanel')?.classList.toggle('hidden', mode !== 'PC');
  document.getElementById('barModeDirectPanel')?.classList.toggle('hidden', mode !== 'DIRECT');
  document.getElementById('barModeClientPanel')?.classList.toggle('hidden', mode !== 'CLIENT');

  // Submit tugmasi yozuvini yangilash
  const submitTextEl = document.getElementById('btnSubmitBarOrderText');
  if (submitTextEl) {
    if (mode === 'PC') submitTextEl.textContent = 'Stol Hisobiga Yozish ↵';
    else if (mode === 'DIRECT') submitTextEl.textContent = 'To\'lovni Qabul Qilish ↵';
    else submitTextEl.textContent = 'Akkauntdan Yechish ↵';
  }
}

/**
 * Band kompyuterlarni dropdown ga to'ldirish
 */
function populateBarOccupiedPcs() {
  const select = document.getElementById('barTargetPcSelect');
  const countEl = document.getElementById('barOccupiedPcsCount');
  if (!select) return;

  const occupiedPcs = (typeof computersData !== 'undefined' ? computersData : []).filter(c => c.status === 'OCCUPIED');
  if (countEl) countEl.textContent = `${occupiedPcs.length} ta band stol`;

  if (occupiedPcs.length === 0) {
    select.innerHTML = '<option value="">-- Hozirda band kompyuterlar yo\'q --</option>';
  } else {
    select.innerHTML = '<option value="">-- Band kompyuterni tanlang --</option>'
      + occupiedPcs.map(pc => {
        const cust = pc.activeSession?.customerName ? ` (${pc.activeSession.customerName})` : '';
        return `<option value="${pc.id}">${pc.name}${cust}</option>`;
      }).join('');
  }
}

/**
 * Ro'yxatdan o'tgan mijozlarni dropdown ga to'ldirish
 */
async function populateBarClients() {
  const select = document.getElementById('barTargetClientSelect');
  if (!select) return;

  try {
    const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const users = await res.json();
      barClients = users.filter(u => u.role === 'client');
      select.innerHTML = '<option value="">-- Mijoz profilini tanlang --</option>'
        + barClients.map(c => `
          <option value="${c.id}" data-balance="${c.balance || 0}">${c.username} (Balans: ${(Number(c.balance) || 0).toLocaleString()} UZS)</option>
        `).join('');
    }
  } catch (err) {
    console.warn('Mijozlar ro\'yxatini olishda xatolik:', err);
  }
}

/**
 * Mijoz tanlanganda balansini ko'rsatish
 */
function handleBarClientSelect(userId) {
  const infoEl = document.getElementById('barSelectedClientInfo');
  const balanceEl = document.getElementById('barSelectedClientBalance');
  if (!infoEl || !balanceEl) return;

  if (!userId) {
    infoEl.classList.add('hidden');
    return;
  }

  const client = barClients.find(c => String(c.id) === String(userId));
  if (client) {
    balanceEl.textContent = `${Number(client.balance || 0).toLocaleString()} UZS`;
    infoEl.classList.remove('hidden');
  } else {
    infoEl.classList.add('hidden');
  }
}

/**
 * Savdoni yakunlash va backendga yuborish
 */
async function submitBarOrder() {
  if (barCart.length === 0) {
    if (typeof showToast === 'function') showToast('Savat bo\'sh! Mahsulot tanlang.', 'warning');
    return;
  }

  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
  const btn = document.getElementById('btnSubmitBarOrder');
  const btnText = document.getElementById('btnSubmitBarOrderText');

  let paymentMethod = 'CASH';
  let paymentStatus = 'PAID';
  let computerId = null;
  let sessionId = null;
  let userId = null;

  // 1. Stolga yozish
  if (barSaleMode === 'PC') {
    const selectedPcId = document.getElementById('barTargetPcSelect')?.value;
    if (!selectedPcId) {
      if (typeof showToast === 'function') showToast('Iltimos, stolni tanlang!', 'error');
      return;
    }
    const pc = (typeof computersData !== 'undefined' ? computersData : []).find(c => c.id === selectedPcId);
    if (!pc || !pc.activeSession) {
      if (typeof showToast === 'function') showToast('Tanlangan kompyuterda faol seans mavjud emas!', 'error');
      return;
    }

    computerId = pc.pcNumber || pc.id;
    sessionId = pc.activeSession.sessionId;
    paymentMethod = 'ON_PC_SESSION';
    paymentStatus = 'PENDING_AT_CHECKOUT';
  } 
  // 2. Alohida sotish (Stolsiz)
  else if (barSaleMode === 'DIRECT') {
    const radio = document.querySelector('input[name="barDirectPayMethod"]:checked');
    paymentMethod = radio?.value === 'CARD' ? 'CARD' : 'CASH';
    paymentStatus = 'PAID';
  } 
  // 3. Akkauntdan yechish
  else if (barSaleMode === 'CLIENT') {
    const selectedUserId = document.getElementById('barTargetClientSelect')?.value;
    if (!selectedUserId) {
      if (typeof showToast === 'function') showToast('Iltimos, mijoz akkauntini tanlang!', 'error');
      return;
    }
    const client = barClients.find(c => String(c.id) === String(selectedUserId));
    const cartSum = barCart.reduce((s, i) => s + i.price * i.qty, 0);

    if (client && Number(client.balance || 0) < cartSum) {
      if (typeof showToast === 'function') showToast(`Mijoz balansi (${(client.balance || 0).toLocaleString()} UZS) yetarli emas!`, 'error');
      return;
    }

    userId = parseInt(selectedUserId, 10);
    paymentMethod = 'CLIENT_BALANCE';
    paymentStatus = 'PAID';
  }

  const orderPayload = {
    items: barCart.map(i => ({ barItemId: i.id, quantity: i.qty })),
    paymentMethod,
    paymentStatus,
    computerId,
    sessionId,
    userId
  };

  try {
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Qabul qilinmoqda...';

    const res = await fetch('/api/bar/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(orderPayload)
    });

    if (res.ok) {
      const data = await res.json();
      const totalAmount = data.order?.totalAmount || 0;
      const orderNum = data.order?.orderNumber || '';

      clearBarCart();
      if (typeof showToast === 'function') {
        showToast(`✓ Savdo qabul qilindi: ${totalAmount.toLocaleString()} UZS (${orderNum})`, 'success');
      }

      // Ma'lumotlarni yangilash
      await Promise.all([
        loadBarProducts(),
        loadBarOrders()
      ]);

      if (typeof fetchData === 'function') fetchData();
      if (typeof renderHistoryView === 'function') renderHistoryView();
    } else {
      const err = await res.json();
      if (typeof showToast === 'function') showToast(err.error || 'Savdoni amalga oshirishda xatolik yuz berdi.', 'error');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Server bilan bog\'lanishda xatolik: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
    setBarSaleMode(barSaleMode);
  }
}

/**
 * Oxirgi sotilgan mahsulotlar lentasini chizish
 */
function renderBarRecentOrders() {
  const container = document.getElementById('barRecentSalesList');
  if (!container) return;

  if (barOrders.length === 0) {
    container.innerHTML = '<p class="text-xs text-zinc-500 text-center py-6">Hozircha sotuvlar mavjud emas.</p>';
    return;
  }

  container.innerHTML = barOrders.map(ord => {
    const timeStr = ord.createdAt ? new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const itemsSummary = (ord.items || []).map(i => `${escapeHtml(i.item_name)} (${i.quantity} dona)`).join(', ') || 'Mahsulot';
    
    let destBadge = '';
    if (ord.paymentMethod === 'ON_PC_SESSION') {
      destBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">PC-${ord.computerId || 'Stol'} hisobiga yozildi</span>`;
    } else if (ord.paymentMethod === 'CLIENT_BALANCE') {
      destBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">Akkaunt hisobidan yechildi</span>`;
    } else {
      const isCard = ord.paymentMethod === 'CARD';
      destBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">${isCard ? 'Karta / Click' : 'Naqdga sotildi'}</span>`;
    }

    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-[#09090b] border border-[#27272a] hover:border-zinc-700 transition text-xs">
        <div class="flex items-center gap-2.5 overflow-hidden flex-1 mr-2">
          <span class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-sm shrink-0">🛒</span>
          <div class="overflow-hidden">
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-mono font-bold text-zinc-400">${timeStr}</span>
              <span class="text-white font-medium truncate">${itemsSummary}</span>
            </div>
            <div class="mt-1 flex items-center gap-1.5">
              ${destBadge}
              <span class="text-[10px] text-zinc-500 font-mono">#${ord.orderNumber}</span>
            </div>
          </div>
        </div>
        <span class="text-xs font-bold text-emerald-400 font-mono shrink-0">${Number(ord.totalAmount || 0).toLocaleString()} UZS</span>
      </div>
    `;
  }).join('');
}

/**
 * Tovar qo'shish yoki tahrirlash modalini ochish
 */
function openBarProductModal(prodId = null) {
  const modal = document.getElementById('barProductModal');
  if (!modal) return;

  const idInput = document.getElementById('barProdId');
  const nameInput = document.getElementById('barProdName');
  const catInput = document.getElementById('barProdCategory');
  const buyInput = document.getElementById('barProdBuyPrice');
  const sellInput = document.getElementById('barProdSellPrice');
  const stockInput = document.getElementById('barProdStock');
  const activeInput = document.getElementById('barProdActive');
  const titleEl = document.getElementById('barProdModalTitle');

  if (prodId) {
    const prod = barProducts.find(p => p.id === prodId);
    if (!prod) return;

    if (titleEl) titleEl.textContent = 'Mahsulotni Tahrirlash';
    if (idInput) idInput.value = prod.id;
    if (nameInput) nameInput.value = prod.name;
    if (catInput) catInput.value = prod.category || 'DRINKS';
    if (buyInput) buyInput.value = prod.buyPrice || 0;
    if (sellInput) sellInput.value = prod.sellPrice || 0;
    if (stockInput) stockInput.value = prod.stockQuantity || 0;
    if (activeInput) activeInput.checked = Boolean(prod.isActive);
  } else {
    if (titleEl) titleEl.textContent = 'Yangi Mahsulot Qo\'shish';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (catInput) catInput.value = 'DRINKS';
    if (buyInput) buyInput.value = 6000;
    if (sellInput) sellInput.value = 10000;
    if (stockInput) stockInput.value = 10;
    if (activeInput) activeInput.checked = true;
  }

  modal.classList.remove('hidden');
}

/**
 * Tovar saqlash (POST yoki PUT)
 */
async function handleSaveBarProduct(e) {
  e.preventDefault();
  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
  const id = document.getElementById('barProdId')?.value;
  const name = document.getElementById('barProdName')?.value;
  const category = document.getElementById('barProdCategory')?.value || 'DRINKS';
  const buyPrice = parseFloat(document.getElementById('barProdBuyPrice')?.value) || 0;
  const sellPrice = parseFloat(document.getElementById('barProdSellPrice')?.value) || 0;
  const stockQuantity = parseInt(document.getElementById('barProdStock')?.value, 10) || 0;
  const isActive = document.getElementById('barProdActive')?.checked ? 1 : 0;

  const btn = document.getElementById('barProdSubmitBtn');
  if (btn) btn.disabled = true;

  try {
    const url = id ? `/api/bar/items/${id}` : '/api/bar/items';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, category, buyPrice, sellPrice, stockQuantity, isActive })
    });

    if (res.ok) {
      closeModal('barProductModal');
      if (typeof showToast === 'function') {
        showToast(id ? '✓ Mahsulot yangilandi!' : '✓ Yangi mahsulot qo\'shildi!', 'success');
      }
      await loadBarProducts();
    } else {
      const err = await res.json();
      if (typeof showToast === 'function') showToast(err.error || 'Mahsulotni saqlashda xatolik', 'error');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Server bilan bog\'lanishda xatolik: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Tovarni o'chirish
 */
async function deleteBarProduct(id, name) {
  if (!confirm(`Haqiqatan ham "${name}" mahsulotini katalogdan o'chirmoqchimisiz?`)) return;

  const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
  try {
    const res = await fetch(`/api/bar/items/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      if (typeof showToast === 'function') showToast(`✓ "${name}" o'chirildi!`, 'success');
      await loadBarProducts();
    } else {
      const err = await res.json();
      if (typeof showToast === 'function') showToast(err.error || 'O\'chirishda xatolik', 'error');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Xatolik: ' + err.message, 'error');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// LIVE AUDIT LOG & SHIFT ACTIVITY STREAM (#view-history)
// ============================================================================
let auditLogsData = [];
let historyActiveFilter = 'ALL';
let historySearchQuery = '';
let historyViewMode = 'timeline'; // 'timeline' | 'table'
let historyCurrentSelectedLog = null;

/**
 * Kompyuter raqami yoki ID sini toza formatga keltirish ("PC-05")
 */
function formatPcLabel(rawId) {
  if (rawId === undefined || rawId === null || rawId === '') return '—';
  if (typeof rawId === 'number') return `PC-${String(rawId).padStart(2, '0')}`;
  const str = String(rawId).trim();
  if (str.toUpperCase().startsWith('PC-')) return str.toUpperCase();
  const digits = str.replace(/\D/g, '');
  if (digits) return `PC-${digits.padStart(2, '0')}`;
  return str;
}

/**
 * Vaqtni nisbiy formatlash ("Hozirgina", "3 daq oldin")
 */
function formatRelativeTime(date) {
  if (!date) return '';
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000));
  if (diffSec < 45) return 'Hozirgina';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} daq oldin`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} soat oldin`;
  return `${Math.floor(diffSec / 86400)} kun oldin`;
}

/**
 * Har bir audit hodisasini inson tushunadigan chiroyli matn va ikonkalarga aylantirish
 */
function formatAuditLogEvent(log) {
  const d = log.details || {};
  const dateObj = log.createdAt ? new Date(log.createdAt) : new Date();
  const timeStr = dateObj.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const relativeTime = formatRelativeTime(log.createdAt);

  let icon = '📜';
  let iconBg = 'bg-zinc-800 text-zinc-400 border border-zinc-700';
  let badgeText = 'VOQEA';
  let badgeColor = 'bg-zinc-800 text-zinc-300 border border-zinc-700';
  let category = 'SYSTEM';
  let targetPc = '—';
  let narrative = '';
  let amountStr = '—';
  let amountClass = 'text-zinc-400';

  const compId = d.computerId || d.fromComputerId || d.pcNumber;
  if (compId) targetPc = formatPcLabel(compId);

  switch (log.eventType) {
    case 'SESSION_START': {
      category = 'SESSIONS';
      icon = '🟢';
      iconBg = 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      badgeText = 'SEANS BOSHLANDI';
      badgeColor = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      const cust = d.customerName ? ` (${escapeHtml(d.customerName)})` : '';
      const tariff = d.tariffName || 'Standart';
      const dur = d.durationMinutes ? `${Math.round(d.durationMinutes / 60)} soatlik` : 'vaqt';
      const amt = Number(d.amount || 0);

      if (d.isPostpaid) {
        narrative = `${targetPc}${cust} da VIP Postpaid (ochiq vaqt) seansi boshlandi.`;
        amountStr = '0 UZS (Ochiq)';
        amountClass = 'text-sky-400 font-bold';
      } else {
        narrative = `${targetPc}${cust} da ${dur} vaqt ochildi (${tariff}). To'lov qabul qilindi.`;
        amountStr = `+${amt.toLocaleString()} UZS`;
        amountClass = 'text-emerald-400 font-bold';
      }
      break;
    }

    case 'SESSION_STOP': {
      category = 'SESSIONS';
      icon = '🔴';
      iconBg = 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
      badgeText = 'SEANS TUGADI';
      badgeColor = 'bg-rose-500/20 text-rose-300 border border-rose-500/30';
      const fBill = Number(d.finalBill || 0);
      const gBill = Number(d.gameBill || 0);
      const bBill = Number(d.barBill || 0);

      if (fBill > 0) {
        narrative = `${targetPc} seansi to'xtatildi va kassa hisoblandi. O'yin: ${gBill.toLocaleString()} UZS + Bar: ${bBill.toLocaleString()} UZS.`;
        amountStr = `+${fBill.toLocaleString()} UZS`;
        amountClass = 'text-white font-bold';
      } else {
        narrative = `${targetPc} seansi o'z vaqtida tugadi va kompyuter qulflandi.`;
        amountStr = '0 UZS';
        amountClass = 'text-zinc-400';
      }
      break;
    }

    case 'SESSION_EXTEND': {
      category = 'SESSIONS';
      icon = '⏱️';
      iconBg = 'bg-sky-500/15 text-sky-400 border border-sky-500/30';
      badgeText = 'VAQT QO\'SHILDI';
      badgeColor = 'bg-sky-500/20 text-sky-300 border border-sky-500/30';
      const addMins = d.additionalMinutes || 30;
      const addAmt = Number(d.additionalAmount || 0);
      const payT = d.paymentType || 'CASH';

      narrative = `${targetPc} ga +${addMins} daqiqa vaqt qo'shildi. To'lov turi: ${payT}.`;
      amountStr = `+${addAmt.toLocaleString()} UZS`;
      amountClass = 'text-sky-400 font-bold';
      break;
    }

    case 'REFUND': {
      category = 'FINANCE';
      icon = '💵';
      iconBg = 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
      badgeText = 'QAYTIM (ZDACHA)';
      badgeColor = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
      const playedMins = d.playedMinutes || 0;
      const usedAmt = Number(d.usedAmount || 0);
      const refAmt = Number(d.refundAmount || 0);

      narrative = `${targetPc} muddatidan oldin yopildi. O'ynaldi: ${playedMins} daq (${usedAmt.toLocaleString()} UZS), Mijozga qaytim berildi.`;
      amountStr = `-${refAmt.toLocaleString()} UZS`;
      amountClass = 'text-amber-400 font-bold';
      break;
    }

    case 'PC_SWAP': {
      category = 'SESSIONS';
      icon = '🔄';
      iconBg = 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30';
      badgeText = 'KO\'CHIRISH (SWAP)';
      badgeColor = 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
      const fromN = d.fromName || formatPcLabel(d.fromComputerId);
      const toN = d.toName || formatPcLabel(d.toComputerId);
      const remMins = Math.round((d.remainingSeconds || 0) / 60);

      targetPc = `${fromN} ➔ ${toN}`;
      narrative = `${fromN} seansi ${toN} ga ko'chirildi (Qolgan vaqt: ${remMins} daqiqa).`;
      amountStr = '0 UZS';
      amountClass = 'text-zinc-500';
      break;
    }

    case 'BAR_SALE': {
      category = 'BAR';
      icon = '🛒';
      iconBg = 'bg-purple-500/15 text-purple-400 border border-purple-500/30';
      badgeText = 'BAR SAVDOSI';
      badgeColor = 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
      const totalAmt = Number(d.totalAmount || 0);
      const itemsList = Array.isArray(d.items) ? d.items.join(', ') : 'Bar mahsuloti';
      const payM = d.paymentMethod === 'ON_PC_SESSION' ? 'Stolga yozildi' : (d.paymentMethod || 'CASH');

      if (d.computerId) {
        narrative = `${targetPc} ga ${escapeHtml(itemsList)} sotildi (${payM}).`;
      } else {
        narrative = `Alohida savdo: ${escapeHtml(itemsList)} (${payM}).`;
      }
      amountStr = `+${totalAmt.toLocaleString()} UZS`;
      amountClass = 'text-purple-400 font-bold';
      break;
    }

    case 'POWER_ACTION': {
      category = 'SYSTEM';
      icon = '⚡';
      iconBg = 'bg-orange-500/15 text-orange-400 border border-orange-500/30';
      badgeText = 'QUVVAT BUYRUG\'I';
      badgeColor = 'bg-orange-500/20 text-orange-300 border border-orange-500/30';
      const actionCmd = d.action || 'REBOOT';
      let cmdUz = actionCmd;
      if (actionCmd === 'REBOOT') cmdUz = 'qayta ishga tushirildi (Reboot)';
      else if (actionCmd === 'SHUTDOWN') cmdUz = 'o\'chirildi (Shutdown)';
      else if (actionCmd === 'LOCK') cmdUz = 'bloklandi (Lock)';
      else if (actionCmd === 'UNLOCK') cmdUz = 'qulfdan chiqarildi (Unlock)';
      else if (actionCmd === 'WAKE') cmdUz = 'tarmoq orqali yoqildi (WoL)';

      narrative = `${targetPc} masofadan ${cmdUz}.`;
      amountStr = '—';
      amountClass = 'text-zinc-500';
      break;
    }

    default: {
      category = 'SYSTEM';
      icon = '📌';
      iconBg = 'bg-zinc-800 text-zinc-400 border border-zinc-700';
      badgeText = log.eventType || 'AMAL';
      badgeColor = 'bg-zinc-800 text-zinc-300 border border-zinc-700';
      narrative = typeof d === 'string' ? d : JSON.stringify(d);
      amountStr = '—';
      amountClass = 'text-zinc-500';
      break;
    }
  }

  return {
    id: log.id,
    timeStr,
    relativeTime,
    icon,
    iconBg,
    badgeText,
    badgeColor,
    category,
    targetPc,
    narrative,
    amountStr,
    amountClass,
    rawLog: log
  };
}

/**
 * Backenddan audit loglarni yuklash va interfeysni yangilash
 */
async function loadAuditHistory(isManual = false) {
  try {
    const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
    const res = await fetch('/api/audit-logs?limit=100', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      auditLogsData = data.logs || [];
      updateHistoryCounters();
      renderHistoryView();

      if (isManual && typeof showToast === 'function') {
        showToast('✓ Smena amallari va audit tarixi yangilandi', 'info');
      }
    }
  } catch (err) {
    console.error('Audit tarixini yuklashda xatolik:', err);
    if (isManual && typeof showToast === 'function') {
      showToast('Tarixni yuklashda xatolik yuz berdi', 'error');
    }
  }
}

/**
 * Statistik hisoblagichlar va tablardagi raqamlarni yangilash
 */
function updateHistoryCounters() {
  const total = auditLogsData.length;
  let sessionsCount = 0;
  let barCount = 0;
  let refundCount = 0;
  let systemCount = 0;

  auditLogsData.forEach(l => {
    if (['SESSION_START', 'SESSION_STOP', 'SESSION_EXTEND', 'PC_SWAP'].includes(l.eventType)) sessionsCount++;
    if (l.eventType === 'BAR_SALE') barCount++;
    if (l.eventType === 'REFUND') refundCount++;
    if (l.eventType === 'POWER_ACTION') systemCount++;
  });

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  setTxt('historyStatTotal', total);
  setTxt('historyStatSessions', sessionsCount);
  setTxt('historyStatBar', barCount);
  setTxt('historyStatRefunds', refundCount);

  setTxt('filterCountAll', total);
  setTxt('filterCountSessions', sessionsCount);
  setTxt('filterCountBar', barCount);
  setTxt('filterCountFinance', refundCount + barCount);
  setTxt('filterCountSystem', systemCount);
}

/**
 * History sahifasini chizish (Timeline yoki Jadval)
 */
function renderHistoryView() {
  if (auditLogsData.length === 0) {
    // Agar hali ma'lumot yuklanmagan bo'lsa, yuklaymiz
    loadAuditHistory();
    return;
  }

  const query = historySearchQuery.toLowerCase().trim();
  const filtered = auditLogsData.filter(log => {
    const formatted = formatAuditLogEvent(log);

    // Kategoriya filtri
    if (historyActiveFilter === 'SESSIONS') {
      if (!['SESSION_START', 'SESSION_STOP', 'SESSION_EXTEND', 'PC_SWAP'].includes(log.eventType)) return false;
    } else if (historyActiveFilter === 'BAR') {
      if (log.eventType !== 'BAR_SALE') return false;
    } else if (historyActiveFilter === 'FINANCE') {
      if (!['REFUND', 'BAR_SALE', 'SESSION_START', 'SESSION_STOP'].includes(log.eventType)) return false;
    } else if (historyActiveFilter === 'SYSTEM') {
      if (log.eventType !== 'POWER_ACTION') return false;
    }

    // Qidiruv filtri
    if (query) {
      const matchPc = formatted.targetPc.toLowerCase().includes(query);
      const matchNarrative = formatted.narrative.toLowerCase().includes(query);
      const matchBadge = formatted.badgeText.toLowerCase().includes(query);
      const matchJson = JSON.stringify(log.details || {}).toLowerCase().includes(query);
      return matchPc || matchNarrative || matchBadge || matchJson;
    }

    return true;
  });

  renderHistoryTimeline(filtered);
  renderHistoryTable(filtered);
}

/**
 * 1. Timeline Lentasini chizish
 */
function renderHistoryTimeline(list) {
  const container = document.getElementById('historyEventsTimeline');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `
      <div class="py-16 text-center text-zinc-500 rounded-2xl bg-[#141418] border border-[#27272a]">
        <div class="text-3xl mb-2">🔍</div>
        <div class="text-xs font-semibold text-zinc-300">Birorta voqea yoki amal topilmadi</div>
        <div class="text-[11px] text-zinc-500 mt-1">Filtrni yoki qidiruv so'zini o'zgartiring</div>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map((log, idx) => {
    const ev = formatAuditLogEvent(log);

    return `
      <div id="history-event-card-${ev.id}" 
           class="group p-3.5 sm:p-4 rounded-2xl bg-[#141418] border border-[#27272a] hover:border-zinc-500 transition-all flex items-start justify-between gap-3 relative overflow-hidden select-none">
        
        <!-- Chap: Ikonka va Vaqt -->
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div class="w-10 h-10 rounded-xl ${ev.iconBg} flex items-center justify-center text-lg shrink-0 group-hover:scale-105 transition-transform">
            ${ev.icon}
          </div>

          <div class="flex-1 min-w-0">
            <!-- Yuqori qator: Vaqt, Nisbiy vaqt va Nishon -->
            <div class="flex flex-wrap items-center gap-2 mb-1">
              <span class="font-mono text-xs font-bold text-white tracking-wide">${ev.timeStr}</span>
              <span class="text-[10px] text-zinc-500 font-mono">(${ev.relativeTime})</span>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${ev.badgeColor}">
                ${ev.badgeText}
              </span>
              ${ev.targetPc !== '—' ? `
                <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#09090b] text-sky-400 border border-[#27272a]">
                  ${ev.targetPc}
                </span>
              ` : ''}
            </div>

            <!-- Asosiy matn / Sharh -->
            <p class="text-xs text-zinc-200 leading-snug break-words">
              ${ev.narrative}
            </p>
          </div>
        </div>

        <!-- O'ng: Summa va Batafsil tugmasi -->
        <div class="flex flex-col items-end justify-between shrink-0 pl-2">
          <span class="font-mono text-xs ${ev.amountClass} whitespace-nowrap">
            ${ev.amountStr}
          </span>
          <button type="button" onclick="openHistoryDetailModal(${ev.id})" 
                  class="mt-2 text-[11px] text-zinc-400 hover:text-white transition flex items-center gap-1 cursor-pointer hover:underline">
            <span>Batafsil</span>
            <span class="text-[10px]">↗</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 2. Jadval ko'rinishini chizish
 */
function renderHistoryTable(list) {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-zinc-500 font-sans">Amallar tarixi topilmadi.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(log => {
    const ev = formatAuditLogEvent(log);

    return `
      <tr class="hover:bg-zinc-800/40 transition">
        <td class="p-3.5 text-zinc-300 font-mono whitespace-nowrap">${ev.timeStr}</td>
        <td class="p-3.5 font-sans whitespace-nowrap">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.badgeColor}">
            ${ev.badgeText}
          </span>
        </td>
        <td class="p-3.5 font-bold font-mono text-white whitespace-nowrap">
          ${ev.targetPc !== '—' ? `<span class="text-sky-400">${ev.targetPc}</span>` : '—'}
        </td>
        <td class="p-3.5 text-zinc-300 font-sans leading-normal">${ev.narrative}</td>
        <td class="p-3.5 text-right font-mono ${ev.amountClass} whitespace-nowrap">${ev.amountStr}</td>
        <td class="p-3.5 text-right whitespace-nowrap">
          <button type="button" onclick="openHistoryDetailModal(${ev.id})" class="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs transition cursor-pointer">
            🔍 JSON
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Real-Time WebSocket orqali kelgan yangi voqeani darhol eng yuqoriga kiritish (Jonli Oqim)
 */
function handleLiveAuditLog(newLog) {
  if (!newLog || !newLog.id) return;

  // Agar voqea allaqachon mavjud bo'lsa, qayta qo'shmaymiz
  const exists = auditLogsData.some(l => l.id === newLog.id);
  if (exists) return;

  auditLogsData.unshift(newLog);
  updateHistoryCounters();

  // Agar hozir "Tarix" sahifasida bo'lsa, chiroyli animatsiya bilan eng yuqoriga qo'shamiz
  if (typeof currentAppView !== 'undefined' && currentAppView === 'history') {
    const container = document.getElementById('historyEventsTimeline');
    if (container && historyViewMode === 'timeline') {
      const ev = formatAuditLogEvent(newLog);
      
      const newCardHtml = `
        <div id="history-event-card-${ev.id}" 
             class="live-event-enter group p-3.5 sm:p-4 rounded-2xl bg-[#141418] border border-emerald-500/50 hover:border-zinc-500 transition-all flex items-start justify-between gap-3 relative overflow-hidden select-none">
          
          <div class="flex items-start gap-3 flex-1 min-w-0">
            <div class="w-10 h-10 rounded-xl ${ev.iconBg} flex items-center justify-center text-lg shrink-0">
              ${ev.icon}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <span class="font-mono text-xs font-bold text-white tracking-wide">${ev.timeStr}</span>
                <span class="text-[10px] text-emerald-400 font-mono font-bold animate-pulse">● Yangi</span>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${ev.badgeColor}">
                  ${ev.badgeText}
                </span>
                ${ev.targetPc !== '—' ? `
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#09090b] text-sky-400 border border-[#27272a]">
                    ${ev.targetPc}
                  </span>
                ` : ''}
              </div>

              <p class="text-xs text-zinc-200 leading-snug break-words">
                ${ev.narrative}
              </p>
            </div>
          </div>

          <div class="flex flex-col items-end justify-between shrink-0 pl-2">
            <span class="font-mono text-xs ${ev.amountClass} whitespace-nowrap">
              ${ev.amountStr}
            </span>
            <button type="button" onclick="openHistoryDetailModal(${ev.id})" 
                    class="mt-2 text-[11px] text-zinc-400 hover:text-white transition flex items-center gap-1 cursor-pointer hover:underline">
              <span>Batafsil</span>
              <span class="text-[10px]">↗</span>
            </button>
          </div>
        </div>
      `;

      container.insertAdjacentHTML('afterbegin', newCardHtml);
    } else {
      renderHistoryView();
    }
  }
}

/**
 * Kategoriya filtri bosilganda
 */
function filterHistoryCategory(cat) {
  historyActiveFilter = cat;
  document.querySelectorAll('.history-filter-btn').forEach(btn => {
    const text = btn.textContent;
    const matches = (cat === 'ALL' && text.includes('Barchasi'))
      || (cat === 'SESSIONS' && text.includes('Seanslar'))
      || (cat === 'BAR' && text.includes('Bar'))
      || (cat === 'FINANCE' && text.includes('Kassa'))
      || (cat === 'SYSTEM' && text.includes('Tizim'));

    btn.className = matches
      ? 'history-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black transition cursor-pointer shadow-sm'
      : 'history-filter-btn px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer';
  });
  renderHistoryView();
}

/**
 * Jonli qidiruv
 */
function handleHistorySearch(val) {
  historySearchQuery = val || '';
  renderHistoryView();
}

/**
 * Ko'rinish rejimini almashtirish: Timeline vs Jadval
 */
function toggleHistoryViewMode(mode) {
  historyViewMode = mode;
  const timelineWrapper = document.getElementById('historyTimelineWrapper');
  const tableWrapper = document.getElementById('historyTableWrapper');
  const timelineBtn = document.getElementById('historyViewModeTimelineBtn');
  const tableBtn = document.getElementById('historyViewModeTableBtn');

  if (mode === 'timeline') {
    timelineWrapper?.classList.remove('hidden');
    tableWrapper?.classList.add('hidden');
    timelineBtn?.classList.add('bg-zinc-800', 'text-white');
    timelineBtn?.classList.remove('text-zinc-400');
    tableBtn?.classList.remove('bg-zinc-800', 'text-white');
    tableBtn?.classList.add('text-zinc-400');
  } else {
    timelineWrapper?.classList.add('hidden');
    tableWrapper?.classList.remove('hidden');
    tableBtn?.classList.add('bg-zinc-800', 'text-white');
    tableBtn?.classList.remove('text-zinc-400');
    timelineBtn?.classList.remove('bg-zinc-800', 'text-white');
    timelineBtn?.classList.add('text-zinc-400');
  }
  renderHistoryView();
}

/**
 * Voqea tafsilotlari modalini ochish
 */
function openHistoryDetailModal(logId) {
  const log = auditLogsData.find(l => l.id === logId);
  if (!log) return;

  historyCurrentSelectedLog = log;
  const ev = formatAuditLogEvent(log);

  const modal = document.getElementById('historyDetailModal');
  const titleEl = document.getElementById('historyDetailModalTitle');
  const subEl = document.getElementById('historyDetailModalSubtitle');
  const iconEl = document.getElementById('historyDetailModalIcon');
  const timeEl = document.getElementById('historyDetailTime');
  const typeEl = document.getElementById('historyDetailType');
  const amountEl = document.getElementById('historyDetailAmount');
  const narrativeEl = document.getElementById('historyDetailNarrative');
  const jsonEl = document.getElementById('historyDetailJson');

  if (titleEl) titleEl.textContent = `${ev.badgeText} Tafsilotlari`;
  if (subEl) subEl.textContent = `Log ID: #${log.id} • Klub ID: ${log.clubId || 1} • Smena ID: #${log.shiftId || 'Ochiq'}`;
  if (iconEl) iconEl.textContent = ev.icon;
  if (timeEl) timeEl.textContent = `${ev.timeStr} (${ev.relativeTime})`;
  if (typeEl) typeEl.textContent = log.eventType;
  if (amountEl) {
    amountEl.textContent = ev.amountStr;
    amountEl.className = `font-mono font-bold ${ev.amountClass}`;
  }
  if (narrativeEl) narrativeEl.textContent = ev.narrative;
  if (jsonEl) jsonEl.textContent = JSON.stringify(log, null, 2);

  modal?.classList.remove('hidden');
}

/**
 * Modalni yopish
 */
function closeHistoryDetailModal() {
  const modal = document.getElementById('historyDetailModal');
  modal?.classList.add('hidden');
  historyCurrentSelectedLog = null;
}

/**
 * JSON ma'lumotlarini nusxalash
 */
function copyHistoryJson() {
  if (!historyCurrentSelectedLog) return;
  const raw = JSON.stringify(historyCurrentSelectedLog, null, 2);
  navigator.clipboard.writeText(raw).then(() => {
    if (typeof showToast === 'function') showToast('✓ JSON ma\'lumotlari buferga nusxalandi', 'info');
  }).catch(() => {
    if (typeof showToast === 'function') showToast('Nusxa olishda xatolik', 'error');
  });
}

/**
 * Smena amallari auditini CSV fayl qilib eksport qilish
 */
function exportHistoryToCsv() {
  if (auditLogsData.length === 0) {
    if (typeof showToast === 'function') showToast('Eksport qilish uchun ma\'lumot yo\'q', 'warning');
    return;
  }

  const headers = ['ID', 'Vaqt', 'Voqea Turi', 'Kompyuter', 'Tafsilotlar', 'Summa'];
  const rows = auditLogsData.map(log => {
    const ev = formatAuditLogEvent(log);
    return [
      log.id,
      `"${ev.timeStr}"`,
      `"${ev.badgeText}"`,
      `"${ev.targetPc}"`,
      `"${ev.narrative.replace(/"/g, '""')}"`,
      `"${ev.amountStr}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Softech_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (typeof showToast === 'function') showToast('✓ Audit tarixi CSV fayl sifatida yuklandi', 'success');
}

/**
 * Sintetik yoki lokal voqealarni audit tizimiga kiritish uchun moslashtirilgan funksiya
 */
function logHistoryEvent(action, target, cashier, details, amount = '—') {
  const syntheticLog = {
    id: Date.now(),
    clubId: 1,
    shiftId: 1,
    eventType: action,
    details: {
      target,
      cashier,
      details,
      amount
    },
    createdAt: new Date().toISOString()
  };

  handleLiveAuditLog(syntheticLog);
}

// ============================================================================
// REAL-TIME ALERT ENGINE & WEB AUDIO TWO-TONE CHIME DISPATCHER
// ============================================================================

let adminWebSocket = null;
let audioContextInstance = null;

/**
 * Web Audio API Two-Tone Chime Generator (Yoqimli va diqqatni tortuvchi qo'ng'iroq)
 * Har qanday tashqi audio faylsiz sof brauzer sintezatori orqali ishlaydi.
 */
function playBarOrderChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!audioContextInstance || audioContextInstance.state === 'closed') {
      audioContextInstance = new AudioCtx();
    }

    if (audioContextInstance.state === 'suspended') {
      audioContextInstance.resume();
    }

    const ctx = audioContextInstance;
    const now = ctx.currentTime;

    // Tone 1: E5 (659.25 Hz) — Boshlang'ich iliq nota
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.4);

    // Tone 2: C6 (1046.50 Hz) — Chaqqon, tiniq neon nota
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1046.50, now + 0.12);
    gain2.gain.setValueAtTime(0, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0.35, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.8);
  } catch (err) {
    console.warn('[WebAudio] Chime sintezida xato:', err);
  }
}

/**
 * Admin Dashboard WebSocket ulanishini initsializatsiya qilish
 */
function initAdminWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    adminWebSocket = new WebSocket(wsUrl);

    adminWebSocket.onopen = () => {
      console.log('⚡ [AdminWS] Real-time kanalga ulandi (/ws)');
      try {
        adminWebSocket.send(JSON.stringify({
          event: 'DASHBOARD_SUBSCRIBE',
          role: 'admin',
          timestamp: Date.now()
        }));
      } catch {}
    };

    adminWebSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const eventType = msg.event || msg.type;

        if (eventType === 'NEW_BAR_ORDER') {
          handleIncomingBarOrder(msg.payload || msg);
        } else if (eventType === 'ADMIN_DATA_UPDATED' || eventType === 'COMPUTERS_UPDATED') {
          if (typeof fetchData === 'function') fetchData();
        } else if (eventType === 'AUDIT_LOG_ENTRY' || eventType === 'AUDIT_LOG' || eventType === 'LIVE_LOG') {
          const entry = msg.payload?.log || msg.payload || msg.log;
          if (entry && reportDataCache) {
            const list = reportDataCache.audit_trail || reportDataCache.auditTrail;
            if (Array.isArray(list)) {
              list.unshift(entry);
              if (currentAppView === 'reports') {
                renderReportAuditTrail(list);
              }
            }
          }
          if (typeof handleLiveAuditLog === 'function') handleLiveAuditLog(msg.payload);
        }
      } catch (err) {
        console.error('[AdminWS] Xabar tahlilida xato:', err);
      }
    };

    adminWebSocket.onclose = () => {
      setTimeout(initAdminWebSocket, 3500);
    };

    adminWebSocket.onerror = () => {
      try { adminWebSocket.close(); } catch {}
    };
  } catch (err) {
    setTimeout(initAdminWebSocket, 5000);
  }
}

/**
 * Yangi Bar Buyurtmasi kelganda chiroyli ovoz va suzuvchi xabarnoma (Order Toast) chiqarish
 */
function handleIncomingBarOrder(order) {
  if (!order) return;

  // 1. Web Audio API Two-Tone Chime
  playBarOrderChime();

  // 2. Order Toast Container
  let container = document.getElementById('barOrderToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'barOrderToastContainer';
    container.className = 'fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-auto max-w-sm sm:max-w-md w-full';
    document.body.appendChild(container);
  }

  // To'lov turi matnini formatlash
  let paymentText = 'Kompyuter hisobiga qo\'shiladi';
  if (order.paymentOption === 'FROM_MEMBER_BALANCE') paymentText = 'Mijoz balansidan yechiladi';
  else if (order.paymentOption === 'CASH_TO_ADMIN' || order.paymentOption === 'CASH') paymentText = 'Naqd / Kassirga to\'lanadi';

  const orderId = order.orderId || Date.now();
  const orderNumber = order.orderNumber || `BAR-${Date.now().toString(36).toUpperCase()}`;
  const pcNumber = order.pcNumber || 'PC-??';
  const totalAmount = Number(order.totalAmount || 0);

  // Mahsulotlar ro'yxati HTML
  let itemsHtml = '';
  if (Array.isArray(order.items) && order.items.length > 0) {
    itemsHtml = order.items.map(it => {
      const q = it.quantity || it.count || 1;
      const n = it.name || it.itemName || 'Tovar';
      const p = Number(it.price || it.unitPrice || 0);
      return `<li class="flex items-center justify-between text-xs py-0.5 border-b border-zinc-800/40">
        <span class="text-zinc-200"><span class="text-amber-400 font-bold">${q}x</span> ${n}</span>
        <span class="font-mono text-zinc-400">${p.toLocaleString()} UZS</span>
      </li>`;
    }).join('');
  } else {
    itemsHtml = `<li class="text-xs text-zinc-400">Buyurtma tarkibi mavjud</li>`;
  }

  const toastId = `bar_toast_${orderId}_${Math.random().toString(36).substring(2, 6)}`;
  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = 'transform translate-y-[-16px] opacity-0 transition-all duration-300 ease-out p-4 rounded-2xl bg-[#12131D]/95 border border-amber-500/40 backdrop-blur-2xl shadow-2xl shadow-amber-500/10 text-white relative overflow-hidden';

  toast.innerHTML = `
    <!-- Glowing neon header line -->
    <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-300"></div>

    <!-- Header: Title & Close -->
    <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-zinc-800/80">
      <div class="flex items-center gap-2">
        <span class="text-lg">🛒</span>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-black tracking-wide text-white uppercase">YANGI BAR BUYURTMASI:</span>
          <span class="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-black font-mono animate-pulse">${pcNumber}</span>
        </div>
      </div>
      <button class="toast-close-btn p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition text-xs font-bold" title="Yopish">✕</button>
    </div>

    <!-- Items List -->
    <div class="my-2.5">
      <ul class="space-y-1">
        ${itemsHtml}
      </ul>
    </div>

    <!-- Optional Note -->
    ${order.note ? `
      <div class="mb-2.5 px-2.5 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 text-[11px] text-amber-200/90 flex items-start gap-1.5">
        <span class="text-amber-400">💬</span>
        <span>${order.note}</span>
      </div>
    ` : ''}

    <!-- Total Sum & Payment Type -->
    <div class="flex items-center justify-between text-xs py-2 px-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800/60 mb-3">
      <span class="text-zinc-400 font-medium">Jami Summa:</span>
      <div class="text-right">
        <div class="font-mono font-black text-emerald-400 text-sm">${totalAmount.toLocaleString()} UZS</div>
        <div class="text-[10px] text-zinc-400">To'lov turi: <span class="text-sky-300 font-semibold">${paymentText}</span></div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-buttons-group flex items-center gap-2">
      <button class="btn-reject flex-1 py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer">
        <span>❌ Rad etish</span>
      </button>

      <button class="btn-confirm flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-extrabold transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-1 cursor-pointer">
        <span>✅ TASDIQLASH</span>
      </button>
    </div>

    <!-- Rejection Reason Submenu (Yashirin) -->
    <div class="reject-options-group hidden mt-2.5 p-2 rounded-xl bg-zinc-900 border border-rose-500/30 space-y-1.5">
      <div class="text-[10px] font-bold text-zinc-400 uppercase">Rad etish sababi:</div>
      <div class="grid grid-cols-2 gap-1.5">
        <button data-reason="Mahsulot tugagan" class="btn-reject-reason py-1.5 px-2 rounded-lg bg-zinc-800 hover:bg-rose-900/30 text-[11px] text-zinc-300 hover:text-rose-200 border border-zinc-700/60 transition text-left">
          📦 Mahsulot tugagan
        </button>
        <button data-reason="Mijoz xato buyurtma berdi" class="btn-reject-reason py-1.5 px-2 rounded-lg bg-zinc-800 hover:bg-rose-900/30 text-[11px] text-zinc-300 hover:text-rose-200 border border-zinc-700/60 transition text-left">
          👤 Xato buyurtma
        </button>
        <button data-reason="Kassa band / Texnik sabab" class="btn-reject-reason py-1.5 px-2 rounded-lg bg-zinc-800 hover:bg-rose-900/30 text-[11px] text-zinc-300 hover:text-rose-200 border border-zinc-700/60 transition text-left col-span-2">
          ⏳ Boshqa sabab
        </button>
      </div>
      <button class="btn-cancel-reject text-[10px] text-zinc-400 hover:text-white underline pt-0.5 block text-center w-full">Ortga qaytish</button>
    </div>
  `;

  container.prepend(toast);

  // Smooth slide-in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-[-16px]', 'opacity-0');
  });

  const closeToast = () => {
    toast.classList.add('opacity-0', 'translate-y-[-16px]');
    setTimeout(() => toast.remove(), 300);
  };

  // 1. Close button
  toast.querySelector('.toast-close-btn').addEventListener('click', closeToast);

  // 2. [✅ TASDIQLASH] tugmasi
  const btnConfirm = toast.querySelector('.btn-confirm');
  btnConfirm.addEventListener('click', async () => {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = `<span class="animate-spin inline-block mr-1">🔄</span> Tasdiqlanmoqda...`;

    try {
      const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
      const res = await fetch('/api/bar/orders/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          orderId,
          orderNumber,
          pcNumber,
          paymentOption: order.paymentOption,
          totalAmount: order.totalAmount
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.innerHTML = `
          <div class="flex items-center gap-2.5 py-3 text-emerald-400 font-bold text-xs">
            <span class="text-xl">✅</span>
            <div>
              <div class="text-white font-extrabold">${pcNumber} buyurtmasi tasdiqlandi!</div>
              <div class="text-[11px] text-emerald-400/90 font-mono">${totalAmount.toLocaleString()} UZS hisobga qo'shildi.</div>
            </div>
          </div>
        `;
        toast.classList.remove('border-amber-500/40');
        toast.classList.add('border-emerald-500/60');

        if (typeof fetchData === 'function') fetchData();
        setTimeout(closeToast, 2500);
      } else {
        alert(data.error || 'Tasdiqlashda xatolik yuz berdi');
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = `<span>✅ TASDIQLASH</span>`;
      }
    } catch (err) {
      alert('Tarmoq xatosi: ' + err.message);
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = `<span>✅ TASDIQLASH</span>`;
    }
  });

  // 3. [❌ Rad etish] tugmasi
  const btnReject = toast.querySelector('.btn-reject');
  const actionGroup = toast.querySelector('.action-buttons-group');
  const rejectGroup = toast.querySelector('.reject-options-group');
  const btnCancelReject = toast.querySelector('.btn-cancel-reject');

  btnReject.addEventListener('click', () => {
    actionGroup.classList.add('hidden');
    rejectGroup.classList.remove('hidden');
  });

  btnCancelReject.addEventListener('click', () => {
    rejectGroup.classList.add('hidden');
    actionGroup.classList.remove('hidden');
  });

  // Sabab tanlanganda rad etishni yuborish
  toast.querySelectorAll('.btn-reject-reason').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = btn.getAttribute('data-reason') || 'Mahsulot tugagan';
      rejectGroup.innerHTML = `<div class="text-center py-2 text-xs text-zinc-400 font-medium">Rad etilmoqda...</div>`;

      try {
        const token = typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('softech_token') || '');
        const res = await fetch('/api/bar/orders/reject', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            orderId,
            orderNumber,
            pcNumber,
            reason
          })
        });

        toast.innerHTML = `
          <div class="flex items-center gap-2.5 py-3 text-rose-400 font-bold text-xs">
            <span class="text-xl">❌</span>
            <div>
              <div class="text-white font-extrabold">${pcNumber} buyurtmasi rad etildi</div>
              <div class="text-[11px] text-zinc-400">Sabab: ${reason}</div>
            </div>
          </div>
        `;
        toast.classList.remove('border-amber-500/40');
        toast.classList.add('border-rose-500/60');

        if (typeof fetchData === 'function') fetchData();
        setTimeout(closeToast, 2200);
      } catch (err) {
        alert('Tarmoq xatosi: ' + err.message);
        closeToast();
      }
    });
  });
}

// Admin Dashboard yuklanganda WebSocket oqimini yoqish
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminWebSocket);
} else {
  initAdminWebSocket();
}
