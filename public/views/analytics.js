/**
 * Softech Super Admin — Global Platform Analytics & Touch Charts
 * Powered by Chart.js 4.x with Dark-Theme Glassmorphism & Touch Tooltips
 */

// Global state for analytics view
let analyticsState = {
  timeframe: 30, // 7 | 30 | 90 days
  chartMode: 'cumulative', // 'cumulative' | 'daily'
  loading: false,
  data: null,
  charts: {
    revenueChart: null,
    topClubsChart: null,
    peakHoursChart: null
  }
};

/**
 * Haptic feedback helper
 */
function triggerHaptic(pattern = 15) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

/**
 * Raqamlarni so'm formatida chiroyli chiqarish
 */
function formatUZS(amount) {
  return (Number(amount) || 0).toLocaleString('uz-UZ') + ' UZS';
}

function formatShortUZS(amount) {
  const num = Number(amount) || 0;
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1) + ' mlrd';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + ' mln';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(0) + ' ming';
  }
  return num.toString();
}

/**
 * Fetch platform analytics data from backend
 */
async function fetchAnalyticsData(days = 30) {
  const token = localStorage.getItem('softech_access_token');
  try {
    const res = await fetch(`/api/analytics/platform?days=${days}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      if (window.showAuthModal) window.showAuthModal();
      return null;
    }

    const data = await res.json();
    if (data.success) {
      return data;
    }
    throw new Error(data.error || 'Noma\'lum xatolik');
  } catch (err) {
    console.error('❌ [Analytics] Ma\'lumotlarni yuklashda xatolik:', err);
    return null;
  }
}

/**
 * 1. Asosiy Analitika HTML Kontentini Yaratish
 */
export function renderAnalyticsView() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;

  const sum = analyticsState.data ? analyticsState.data.summary : {
    totalRevenue: 0,
    avgDailyRevenue: 0,
    topClub: '—',
    peakHour: '20:00 (99%)'
  };

  container.innerHTML = `
    <div class="space-y-4 pb-12 animate-fade-in">
      <!-- 1. Header & Period Selector -->
      <div class="glass-card p-4 rounded-3xl border-sky-500/20 glow-cyan">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-base">📊</span>
              <h2 class="text-sm font-bold text-white tracking-tight">Global Platforma Analitikasi</h2>
            </div>
            <p class="text-[10px] text-zinc-400 font-mono mt-0.5">SaaS aylanmasi va klublar faollik tendensiyalari</p>
          </div>
          <button onclick="window.refreshAnalyticsView()" class="w-8 h-8 rounded-xl glass-card flex items-center justify-center text-zinc-400 hover:text-white active:scale-95 transition">
            <svg class="w-4 h-4 ${analyticsState.loading ? 'animate-spin text-sky-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
        </div>

        <!-- Period Selector Pills -->
        <div class="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-zinc-800/80">
          <button onclick="window.setAnalyticsTimeframe(7)" class="py-1.5 rounded-xl text-xs font-semibold text-center transition active:scale-95 ${analyticsState.timeframe === 7 ? 'bg-sky-400 text-black font-bold shadow-lg shadow-sky-400/20' : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800'}">
            7 kun
          </button>
          <button onclick="window.setAnalyticsTimeframe(30)" class="py-1.5 rounded-xl text-xs font-semibold text-center transition active:scale-95 ${analyticsState.timeframe === 30 ? 'bg-sky-400 text-black font-bold shadow-lg shadow-sky-400/20' : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800'}">
            30 kun
          </button>
          <button onclick="window.setAnalyticsTimeframe(90)" class="py-1.5 rounded-xl text-xs font-semibold text-center transition active:scale-95 ${analyticsState.timeframe === 90 ? 'bg-sky-400 text-black font-bold shadow-lg shadow-sky-400/20' : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800'}">
            90 kun
          </button>
        </div>
      </div>

      <!-- 2. KPI Xulosa Mini-Kartochkalar -->
      <div class="grid grid-cols-2 gap-2.5">
        <div class="glass-card p-3 rounded-2xl flex flex-col justify-between">
          <div class="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase">
            <span>Davr Daromadi</span>
            <span class="text-sky-400 font-mono">📈</span>
          </div>
          <div class="text-base font-extrabold font-mono text-white mt-1 leading-tight">
            ${formatShortUZS(sum.totalRevenue)} <span class="text-[9px] font-sans text-zinc-400 font-normal">UZS</span>
          </div>
          <div class="text-[10px] text-emerald-400 font-mono mt-1 flex items-center gap-1">
            <span>▲</span>
            <span>Platforma o'sishi</span>
          </div>
        </div>

        <div class="glass-card p-3 rounded-2xl flex flex-col justify-between">
          <div class="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase">
            <span>Kunlik O'rtacha</span>
            <span class="text-emerald-400 font-mono">⚡</span>
          </div>
          <div class="text-base font-extrabold font-mono text-emerald-400 mt-1 leading-tight">
            ${formatShortUZS(sum.avgDailyRevenue)} <span class="text-[9px] font-sans text-zinc-400 font-normal">UZS</span>
          </div>
          <div class="text-[10px] text-zinc-400 font-mono mt-1">
            <span>Doimiy barqaror oqim</span>
          </div>
        </div>

        <div class="glass-card p-3 rounded-2xl flex flex-col justify-between">
          <div class="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase">
            <span>Eng Qizg'in Soat</span>
            <span class="text-amber-400 font-mono">🔥</span>
          </div>
          <div class="text-sm font-extrabold font-mono text-amber-300 mt-1 leading-tight">
            ${sum.peakHour}
          </div>
          <div class="text-[10px] text-zinc-400 font-mono mt-1">
            <span>Zallar to'liq band (Peak)</span>
          </div>
        </div>

        <div class="glass-card p-3 rounded-2xl flex flex-col justify-between">
          <div class="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase">
            <span>Top Filial</span>
            <span class="text-purple-400 font-mono">🏆</span>
          </div>
          <div class="text-xs font-bold font-sans text-white mt-1 truncate leading-tight" title="${sum.topClub}">
            ${sum.topClub}
          </div>
          <div class="text-[10px] text-purple-300 font-mono mt-1">
            <span>Eng ko'p daromad keltirgan</span>
          </div>
        </div>
      </div>

      <!-- ==================================================================== -->
      <!-- CHART 1: PLATFORM DYNAMIC REVENUE (LINE CHART) -->
      <!-- ==================================================================== -->
      <div class="glass-card p-4 rounded-3xl space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
              <h3 class="text-xs font-bold text-white uppercase tracking-wider">Platform Dynamic Revenue</h3>
            </div>
            <p class="text-[10px] text-zinc-400 font-mono mt-0.5">Oxirgi ${analyticsState.timeframe} kunlik umumiy daromad dinamikasi</p>
          </div>

          <!-- Mode Toggle (Kumulyativ / Kunlik) -->
          <div class="flex items-center bg-zinc-900/90 p-0.5 rounded-xl border border-zinc-800 text-[10px]">
            <button onclick="window.setRevenueChartMode('cumulative')" class="px-2 py-1 rounded-lg transition ${analyticsState.chartMode === 'cumulative' ? 'bg-sky-400 text-black font-bold' : 'text-zinc-400 hover:text-white'}">
              O'sish
            </button>
            <button onclick="window.setRevenueChartMode('daily')" class="px-2 py-1 rounded-lg transition ${analyticsState.chartMode === 'daily' ? 'bg-sky-400 text-black font-bold' : 'text-zinc-400 hover:text-white'}">
              Kunlik
            </button>
          </div>
        </div>

        <!-- Touch Hint Badge -->
        <div class="text-[10px] text-sky-400/80 bg-sky-500/10 px-2.5 py-1 rounded-xl flex items-center justify-between border border-sky-500/20 font-mono">
          <span>👆 Barmog'ingiz bilan bosing yoki suring</span>
          <span>Aniq summa ko'rsatiladi</span>
        </div>

        <!-- Canvas Container -->
        <div class="relative w-full h-60">
          <canvas id="revenueDynamicChart"></canvas>
        </div>
      </div>

      <!-- ==================================================================== -->
      <!-- CHART 2: TOP KLUBLAR REYTINGI (HORIZONTAL BAR CHART) -->
      <!-- ==================================================================== -->
      <div class="glass-card p-4 rounded-3xl space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <h3 class="text-xs font-bold text-white uppercase tracking-wider">Top Klublar Reytingi</h3>
            </div>
            <p class="text-[10px] text-zinc-400 font-mono mt-0.5">Eng serdaromad 5 ta klub solishtirmasi</p>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            TOP 5
          </span>
        </div>

        <!-- Canvas Container -->
        <div class="relative w-full h-56">
          <canvas id="topClubsBarChart"></canvas>
        </div>
      </div>

      <!-- ==================================================================== -->
      <!-- CHART 3: SOATLAR BO'YICHA ZAL BANDLIGI (AREA CHART) -->
      <!-- ==================================================================== -->
      <div class="glass-card p-4 rounded-3xl space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
              <h3 class="text-xs font-bold text-white uppercase tracking-wider">Soatlar Bo'yicha Zal Bandligi</h3>
            </div>
            <p class="text-[10px] text-zinc-400 font-mono mt-0.5">Shaharlar bo'yicha 24 soatlik eng qizg'in o'yin soatlari (Peak Hours)</p>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20">
            24 SOAT
          </span>
        </div>

        <!-- Legend Pills -->
        <div class="flex items-center gap-2 overflow-x-auto text-[10px] font-mono no-scrollbar">
          <span class="flex items-center gap-1 text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-lg border border-sky-500/20">
            <span class="w-2 h-2 rounded-full bg-sky-400"></span>
            <span>Toshkent</span>
          </span>
          <span class="flex items-center gap-1 text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-lg border border-purple-500/20">
            <span class="w-2 h-2 rounded-full bg-purple-400"></span>
            <span>Samarqand</span>
          </span>
          <span class="flex items-center gap-1 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Farg'ona</span>
          </span>
        </div>

        <!-- Canvas Container -->
        <div class="relative w-full h-64">
          <canvas id="peakHoursAreaChart"></canvas>
        </div>
      </div>
    </div>
  `;

  // Render Charts once DOM is populated
  initCharts();
}

/**
 * 2. Chart.js Grafiklarini Chizish va Touch Tooltiplarni Sozlash
 */
function initCharts() {
  if (!analyticsState.data) return;

  // Chart.js mavjudligini tekshirish
  if (typeof Chart === 'undefined') {
    console.error('❌ [Chart.js] Chart.js kutubxonasi yuklanmagan!');
    return;
  }

  // Umumiy Chart.js qorong'u rejim sozlamalari
  Chart.defaults.color = '#a1a1aa'; // zinc-400
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
  Chart.defaults.font.size = 11;

  destroyExistingCharts();

  renderPlatformRevenueLineChart();
  renderTopClubsHorizontalBarChart();
  renderPeakHoursAreaChart();
}

/**
 * Eski Chart nusxalarini xotiradan tozalash (Memory leaks va canvas flickering oldini olish)
 */
function destroyExistingCharts() {
  if (analyticsState.charts.revenueChart) {
    analyticsState.charts.revenueChart.destroy();
    analyticsState.charts.revenueChart = null;
  }
  if (analyticsState.charts.topClubsChart) {
    analyticsState.charts.topClubsChart.destroy();
    analyticsState.charts.topClubsChart = null;
  }
  if (analyticsState.charts.peakHoursChart) {
    analyticsState.charts.peakHoursChart.destroy();
    analyticsState.charts.peakHoursChart = null;
  }
}

/**
 * CHART 1: Platform Dynamic Revenue (Line Chart with smooth curves & touch tooltips)
 */
function renderPlatformRevenueLineChart() {
  const canvas = document.getElementById('revenueDynamicChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dynamicData = analyticsState.data.dynamicRevenue || [];

  const labels = dynamicData.map(d => d.formattedDate);
  const isCumulative = analyticsState.chartMode === 'cumulative';
  const dataPoints = dynamicData.map(d => isCumulative ? d.cumulativeRevenue : d.totalRevenue);

  // Gradient fon
  const gradientFill = ctx.createLinearGradient(0, 0, 0, 220);
  gradientFill.addColorStop(0, 'rgba(56, 189, 248, 0.38)');
  gradientFill.addColorStop(0.65, 'rgba(56, 189, 248, 0.08)');
  gradientFill.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  analyticsState.charts.revenueChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: isCumulative ? "Umumiy Daromad O'sishi" : "Kunlik Tushum",
          data: dataPoints,
          borderColor: '#38bdf8', // brand cyan
          borderWidth: 2.5,
          pointBackgroundColor: '#38bdf8',
          pointBorderColor: '#09090b',
          pointBorderWidth: 1.5,
          pointRadius: dynamicData.length > 20 ? 0 : 3,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#ffffff',
          pointHoverBorderColor: '#38bdf8',
          pointHoverBorderWidth: 2.5,
          tension: 0.35, // Smooth Bezier curves
          fill: true,
          backgroundColor: gradientFill
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 750,
        easing: 'easeOutQuart'
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(10, 10, 14, 0.94)',
          titleColor: '#ffffff',
          titleFont: { size: 12, weight: 'bold' },
          bodyColor: '#38bdf8',
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12, weight: 'bold' },
          borderColor: 'rgba(56, 189, 248, 0.4)',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            title: function(items) {
              if (!items.length) return '';
              const item = items[0];
              const raw = dynamicData[item.dataIndex];
              return `${raw.date} (${raw.dayOfWeek})`;
            },
            label: function(context) {
              triggerHaptic(10);
              const val = context.parsed.y || 0;
              return `${isCumulative ? '📈 Kumulyativ' : '💰 Kunlik'}: ${val.toLocaleString('uz-UZ')} UZS`;
            },
            afterLabel: function(context) {
              const raw = dynamicData[context.dataIndex];
              if (!raw) return '';
              return `☕ Bardan: ${raw.barRevenue.toLocaleString('uz-UZ')} UZS\n🎮 Seanslar: ${raw.sessionsCount} ta`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: '#71717a',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#71717a',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            callback: function(value) {
              return formatShortUZS(value);
            }
          }
        }
      }
    }
  });
}

/**
 * CHART 2: Top Klublar Reytingi (Horizontal Bar Chart)
 */
function renderTopClubsHorizontalBarChart() {
  const canvas = document.getElementById('topClubsBarChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const topClubs = analyticsState.data.topClubs || [];

  const labels = topClubs.map(c => c.name.replace('Softech ', ''));
  const revenues = topClubs.map(c => c.totalRevenue);

  // Gradient palitrasi (1-o'rin zumrad, 2-osmon rang, 3-binafsha, 4-olov rang, 5-kumush)
  const colors = [
    'rgba(16, 185, 129, 0.85)', // Emerald
    'rgba(56, 189, 248, 0.85)', // Sky
    'rgba(129, 140, 248, 0.85)', // Indigo
    'rgba(245, 158, 11, 0.85)',  // Amber
    'rgba(161, 161, 170, 0.85)'  // Zinc
  ];

  const borderColors = [
    '#10b981',
    '#38bdf8',
    '#818cf8',
    '#f59e0b',
    '#a1a1aa'
  ];

  analyticsState.charts.topClubsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Jami Daromad',
          data: revenues,
          backgroundColor: colors.slice(0, topClubs.length),
          borderColor: borderColors.slice(0, topClubs.length),
          borderWidth: 1.5,
          borderRadius: 8,
          borderSkipped: false,
          barThickness: 18
        }
      ]
    },
    options: {
      indexAxis: 'y', // Horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: 'easeOutQuart'
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(10, 10, 14, 0.94)',
          titleColor: '#ffffff',
          titleFont: { size: 12, weight: 'bold' },
          bodyColor: '#34d399',
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12, weight: 'bold' },
          borderColor: 'rgba(16, 185, 129, 0.4)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: function(items) {
              if (!items.length) return '';
              const club = topClubs[items[0].dataIndex];
              return `${club.rank}-o'rin: ${club.name}`;
            },
            label: function(context) {
              triggerHaptic(10);
              const club = topClubs[context.dataIndex];
              return `💰 Tushum: ${club.totalRevenue.toLocaleString('uz-UZ')} UZS`;
            },
            afterLabel: function(context) {
              const club = topClubs[context.dataIndex];
              return `📍 Shahar: ${club.city} • 🖥️ ${club.workstations} ta PC • Bandlik: ${club.occupancyRate}%`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#71717a',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            callback: function(value) {
              return formatShortUZS(value);
            }
          }
        },
        y: {
          grid: {
            display: false
          },
          ticks: {
            color: '#e4e4e7',
            font: { size: 11, weight: 'bold' }
          }
        }
      }
    }
  });
}

/**
 * CHART 3: Soatlar Bo'yicha Zal Bandligi (Heatmap / Area Chart - 24 Hours)
 */
function renderPeakHoursAreaChart() {
  const canvas = document.getElementById('peakHoursAreaChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const hourly = analyticsState.data.hourlyPeakOccupancy || [];

  const labels = hourly.map(h => h.hour);
  const toshkentData = hourly.map(h => h.toshkent);
  const samarqandData = hourly.map(h => h.samarqand);
  const fargonaData = hourly.map(h => h.fargona);

  // Gradient Toshkent
  const gradTashkent = ctx.createLinearGradient(0, 0, 0, 240);
  gradTashkent.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
  gradTashkent.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  // Gradient Samarqand
  const gradSamarkand = ctx.createLinearGradient(0, 0, 0, 240);
  gradSamarkand.addColorStop(0, 'rgba(168, 85, 247, 0.30)');
  gradSamarkand.addColorStop(1, 'rgba(168, 85, 247, 0.0)');

  // Gradient Farg'ona
  const gradFargona = ctx.createLinearGradient(0, 0, 0, 240);
  gradFargona.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
  gradFargona.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  analyticsState.charts.peakHoursChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Toshkent',
          data: toshkentData,
          borderColor: '#38bdf8',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#38bdf8',
          tension: 0.4,
          fill: true,
          backgroundColor: gradTashkent
        },
        {
          label: 'Samarqand',
          data: samarqandData,
          borderColor: '#c084fc',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#c084fc',
          tension: 0.4,
          fill: true,
          backgroundColor: gradSamarkand
        },
        {
          label: "Farg'ona",
          data: fargonaData,
          borderColor: '#34d399',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#34d399',
          tension: 0.4,
          fill: true,
          backgroundColor: gradFargona
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 900,
        easing: 'easeOutQuart'
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(10, 10, 14, 0.95)',
          titleColor: '#ffffff',
          titleFont: { size: 12, weight: 'bold' },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
          borderColor: 'rgba(192, 132, 252, 0.4)',
          borderWidth: 1,
          padding: 10,
          usePointStyle: true,
          callbacks: {
            title: function(items) {
              if (!items.length) return '';
              const h = items[0].label;
              const isPeak = parseInt(h.split(':')[0], 10) >= 18 || parseInt(h.split(':')[0], 10) <= 2;
              return `⏰ Soat ${h} ${isPeak ? '🔥 (QIZG\'IN O\'YIN VAQTI)' : ''}`;
            },
            label: function(context) {
              triggerHaptic(8);
              return `${context.dataset.label}: ${context.parsed.y}% bandlik`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: '#71717a',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          }
        },
        y: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#71717a',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            callback: function(value) {
              return value + '%';
            }
          }
        }
      }
    }
  });
}

/**
 * 3. Foydalanuvchi Interfeysi Boshqaruvi
 */
window.setAnalyticsTimeframe = async function(days) {
  triggerHaptic(20);
  analyticsState.timeframe = days;
  analyticsState.loading = true;
  renderAnalyticsView();

  analyticsState.data = await fetchAnalyticsData(days);
  analyticsState.loading = false;
  renderAnalyticsView();
};

window.setRevenueChartMode = function(mode) {
  triggerHaptic(15);
  analyticsState.chartMode = mode;
  renderPlatformRevenueLineChart();

  // Button stylelarini yangilash
  const container = document.getElementById('dashboardContent');
  if (container) {
    renderAnalyticsView();
  }
};

window.refreshAnalyticsView = async function() {
  triggerHaptic([20, 40]);
  analyticsState.loading = true;
  renderAnalyticsView();

  analyticsState.data = await fetchAnalyticsData(analyticsState.timeframe);
  analyticsState.loading = false;
  renderAnalyticsView();

  const toast = document.getElementById('toastNotification');
  if (toast) {
    toast.textContent = '✓ Analitika so\'nggi telemetriya bilan yangilandi';
    toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
    toast.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
    }, 2500);
  }
};

/**
 * 4. Tashqi chaqiruv uchun initsializatsiya
 */
export async function initAnalyticsView() {
  analyticsState.loading = true;
  renderAnalyticsView();

  analyticsState.data = await fetchAnalyticsData(analyticsState.timeframe);
  analyticsState.loading = false;
  renderAnalyticsView();
}
