/**
 * Softech Super Admin — Remote Action Dispatcher Dialogs
 * Location: SoftechCloudAdmin/public/views/remoteControlModal.js
 * 
 * Provides interactive mobile UI dialogs for:
 * 1. Reset Admin Password
 * 2. Lock / Activate Club License
 * 3. Force Restart Club Server
 * 4. Broadcast Cashier Announcement
 */

export const remoteControlState = {
  activeClubId: null,
  activeClubName: '',
  activeTab: 'PASSWORD', // 'PASSWORD' | 'LICENSE' | 'RESTART' | 'BROADCAST'
  isSubmitting: false,
  lastResult: null
};

// ============================================================================
// 1. UI RENDER ENGINE
// ============================================================================

/**
 * 1. Admin Parolini Yangilash Dialogi
 */
function renderPasswordDialog() {
  return `
    <form onsubmit="handleResetPasswordSubmit(event)" class="space-y-3.5 animate-fade-in">
      <div class="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
        <span class="text-base leading-none">🔑</span>
        <p class="leading-relaxed">
          Ushbu amal filial serveridagi <strong>admin</strong> parolini masofadan yangilaydi. Yangi parol filial serveri keyingi heartbeat'da qabul qilishi bilan darhol kuchga kiradi.
        </p>
      </div>

      <!-- Yangi Parol Inputi va Generator -->
      <div>
        <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
          Yangi Master Parol:
        </label>
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <input 
              id="inputNewPassword" 
              type="text" 
              required 
              minlength="6"
              placeholder="Masalan: Softech2026!" 
              class="w-full px-3.5 py-2.5 rounded-xl glass-card text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 transition"
            />
          </div>
          <button 
            type="button" 
            onclick="generateRandomPassword()" 
            class="px-3 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-sky-400 text-xs font-bold transition flex items-center gap-1 border border-zinc-700"
            title="Tasodifiy kuchli parol generatsiya qilish"
          >
            <span>🎲</span>
            <span>Generatsiya</span>
          </button>
        </div>
      </div>

      <!-- Tiklash Sababi -->
      <div>
        <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
          Yangilanish Sababi:
        </label>
        <input 
          id="inputPasswordReason" 
          type="text" 
          value="Klub egasi iltimosiga binoan parolni yangilash" 
          class="w-full px-3.5 py-2 rounded-xl glass-card text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500 transition"
        />
      </div>

      <!-- Submit Button -->
      <div class="pt-2">
        <button 
          type="submit" 
          class="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-indigo-600 hover:from-rose-600 hover:to-indigo-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-500/25 transition"
        >
          <span>🚀</span>
          <span>Parolni Yangilash Buyrug'ini Yuborish</span>
        </button>
      </div>
    </form>
  `;
}

/**
 * 2. Klub Litsenziyasini Bloklash / Faollashtirish Dialogi
 */
function renderLicenseDialog() {
  return `
    <form onsubmit="handleLicenseSubmit(event)" class="space-y-3.5 animate-fade-in">
      <!-- Amalni tanlash (Bloklash yoki Faollashtirish) -->
      <div class="grid grid-cols-2 gap-2 p-1 rounded-xl bg-zinc-900 border border-zinc-800">
        <button 
          type="button" 
          id="btnLicenseLock" 
          onclick="setLicenseSubAction('LOCK')" 
          class="py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-sm"
        >
          <span>🔒</span>
          <span>Bloklash</span>
        </button>

        <button 
          type="button" 
          id="btnLicenseActivate" 
          onclick="setLicenseSubAction('ACTIVATE')" 
          class="py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-zinc-400 hover:text-white"
        >
          <span>🟢</span>
          <span>Faollashtirish</span>
        </button>
      </div>

      <input type="hidden" id="licenseSubAction" value="LOCK" />

      <!-- A) Bloklash Rejimi Kontent -->
      <div id="licenseLockSection" class="space-y-3">
        <!-- Qizil Ogohlantirish Ko'rinishi (Kassir ko'radigan oyna) -->
        <div class="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 space-y-1.5">
          <div class="flex items-center gap-2 text-rose-400 text-xs font-bold">
            <span>⚠️</span>
            <span>Kassa ekranida chiquvchi ogohlantirish:</span>
          </div>
          <p class="text-xs text-rose-200/90 italic bg-black/40 p-2.5 rounded-xl border border-rose-900/50 leading-relaxed font-mono">
            "Softech obuna muddati tugadi. Xizmatni davom ettirish uchun ta'minotchi bilan bog'laning."
          </p>
        </div>

        <div>
          <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
            Bog'lanish uchun telefon raqam:
          </label>
          <input 
            id="inputLockPhone" 
            type="text" 
            value="+998 95 222 06 44, +998 99 563 45 16" 
            class="w-full px-3.5 py-2 rounded-xl glass-card text-xs font-mono text-zinc-200"
          />
        </div>

        <button 
          type="submit" 
          class="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25 transition mt-2"
        >
          <span>🔒</span>
          <span>Litsenziyani To'xtatish (Klubni Bloklash)</span>
        </button>
      </div>

      <!-- B) Faollashtirish Rejimi Kontent -->
      <div id="licenseActivateSection" class="hidden space-y-3">
        <div class="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2">
          <span>✓</span>
          <p>Klub obuna to'lovini amalga oshirganda ushbu buyruq orqali litsenziyani uzaytiring va blokdan chiqaring.</p>
        </div>

        <div>
          <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
            Uzaytirish muddati:
          </label>
          <div class="grid grid-cols-3 gap-2">
            <button type="button" onclick="selectExtensionDays(30)" class="btn-ext-days py-2 rounded-xl text-xs font-bold border border-emerald-500/30 bg-emerald-500/20 text-emerald-300">
              +30 kun
            </button>
            <button type="button" onclick="selectExtensionDays(60)" class="btn-ext-days py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
              +60 kun
            </button>
            <button type="button" onclick="selectExtensionDays(365)" class="btn-ext-days py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
              +1 yil
            </button>
          </div>
          <input type="hidden" id="inputExtensionDays" value="30" />
        </div>

        <button 
          type="submit" 
          class="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition mt-2"
        >
          <span>🟢</span>
          <span>Litsenziyani Faollashtirish va Ochish</span>
        </button>
      </div>
    </form>
  `;
}

/**
 * 3. Kassa Serverini Qayta Ishga Tushirish Dialogi
 */
function renderRestartDialog() {
  return `
    <form onsubmit="handleRestartSubmit(event)" class="space-y-3.5 animate-fade-in">
      <div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
        <span class="text-base leading-none">🔄</span>
        <p class="leading-relaxed">
          Server qotib qolganda yoki profilaktikadan so'ng masofadan qayta yuklash buyrug'ini yuboradi. Barcha mijoz kompyuterlari ulanishni 5 soniya ichida qayta tiklaydi.
        </p>
      </div>

      <!-- Kechikish Vaqti (Delay) -->
      <div>
        <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
          Qayta ishga tushirish kechikishi:
        </label>
        <div class="grid grid-cols-3 gap-2">
          <button type="button" onclick="selectRestartDelay(0)" class="btn-restart-delay py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
            Darhol
          </button>
          <button type="button" onclick="selectRestartDelay(5)" class="btn-restart-delay py-2 rounded-xl text-xs font-bold border border-amber-500/30 bg-amber-500/20 text-amber-300">
            5 soniya
          </button>
          <button type="button" onclick="selectRestartDelay(15)" class="btn-restart-delay py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300">
            15 soniya
          </button>
        </div>
        <input type="hidden" id="inputRestartDelay" value="5" />
      </div>

      <!-- Majburiy To'xtatish (Force Kill) -->
      <label class="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer select-none">
        <input id="checkRestartForce" type="checkbox" checked class="w-4 h-4 rounded text-sky-500 bg-zinc-800 border-zinc-700 focus:ring-sky-500" />
        <div class="text-xs">
          <span class="text-white font-semibold block">Majburiy to'xtatish (Force Kill)</span>
          <span class="text-[10px] text-zinc-400 block">Jarayon osilib qolgan bo'lsa darhol o'chirib qayta yoqadi</span>
        </div>
      </label>

      <!-- Sabab -->
      <div>
        <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
          Qayta yuklash sababi:
        </label>
        <input 
          id="inputRestartReason" 
          type="text" 
          value="SaaS Super Admin orqali rejali qayta ishga tushirish" 
          class="w-full px-3.5 py-2 rounded-xl glass-card text-xs text-zinc-200"
        />
      </div>

      <div class="pt-2">
        <button 
          type="submit" 
          class="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition"
        >
          <span>🔄</span>
          <span>Serverni Qayta Ishga Tushirish</span>
        </button>
      </div>
    </form>
  `;
}

/**
 * 4. Xabarnoma Yuborish Dialogi (Broadcast Announcement)
 */
function renderBroadcastDialog() {
  const currentClubName = remoteControlState.activeClubName || "Ushbu Filial";

  return `
    <form onsubmit="handleBroadcastSubmit(event)" class="space-y-3.5 animate-fade-in">
      <div class="p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-300 flex items-start gap-2">
        <span class="text-base leading-none">📢</span>
        <p class="leading-relaxed">
          Kassir va ma'murlar ekraniga to'g'ridan-to'g'ri bildirishnoma chiqarish. Shoshilinch ogohlantirishlar yoki texnik xabarlar uchun.
        </p>
      </div>

      <!-- Manzil (Ushbu klub yoki Barchasi) -->
      <div>
        <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
          Xabarnoma Kimga Yuborilsin:
        </label>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="btnTargetSingle" onclick="selectBroadcastTarget('SINGLE')" class="py-2 px-2.5 rounded-xl text-xs font-bold border border-sky-500/40 bg-sky-500/20 text-sky-300 truncate">
            📍 Faqat ${currentClubName}
          </button>
          <button type="button" id="btnTargetAll" onclick="selectBroadcastTarget('ALL')" class="py-2 px-2.5 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300 truncate">
            🌐 Barcha Filiallarga
          </button>
        </div>
        <input type="hidden" id="inputBroadcastTarget" value="SINGLE" />
      </div>

      <!-- Sarlavha -->
      <div>
        <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
          Xabar Sarlavhasi:
        </label>
        <input 
          id="inputBroadcastTitle" 
          type="text" 
          value="Diqqat! Markaziy Xabarnoma" 
          required
          class="w-full px-3.5 py-2 rounded-xl glass-card text-xs text-white"
        />
      </div>

      <!-- Xabar Matni -->
      <div>
        <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
          Xabarnoma Matni:
        </label>
        <textarea 
          id="inputBroadcastMessage" 
          rows="3" 
          required
          placeholder="Masalan: Ertaga soat 04:00 da serverda texnik profilaktika o'tkaziladi..." 
          class="w-full px-3.5 py-2 rounded-xl glass-card text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 transition"
        >Ertaga soat 04:00 da profilaktika bo'ladi.</textarea>
      </div>

      <!-- Muhimlik Darajasi va Davomiylik -->
      <div class="grid grid-cols-2 gap-2.5">
        <div>
          <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
            Muhimlik Darajasi:
          </label>
          <select id="selectBroadcastPriority" class="w-full px-3 py-2 rounded-xl glass-card text-xs text-zinc-200">
            <option value="HIGH">⚠️ Yuqori (High)</option>
            <option value="CRITICAL">🚨 Favqulodda (Critical)</option>
            <option value="INFO">ℹ️ Oddiy (Info)</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] font-semibold text-zinc-300 mb-1">
            Ko'rsatish vaqti:
          </label>
          <select id="selectBroadcastDuration" class="w-full px-3 py-2 rounded-xl glass-card text-xs text-zinc-200 font-mono">
            <option value="30">30 soniya</option>
            <option value="60">1 daqiqa</option>
            <option value="120">2 daqiqa</option>
          </select>
        </div>
      </div>

      <div class="pt-2">
        <button 
          type="submit" 
          class="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-500/25 transition"
        >
          <span>📡</span>
          <span>Xabarnomani Ekranlarga Tarqatish</span>
        </button>
      </div>
    </form>
  `;
}

/**
 * Asosiy Remote Command Modal Shell
 */
export function renderRemoteControlModalContent() {
  const modal = document.getElementById('remoteCommandModal');
  if (!modal) return;

  const currentTab = remoteControlState.activeTab;
  const clubName = remoteControlState.activeClubName || "Filial";

  modal.innerHTML = `
    <div class="glass-card w-full max-w-md rounded-3xl p-5 space-y-4 border border-sky-500/30 glow-cyan max-h-[90vh] overflow-y-auto ios-scroll shadow-2xl">
      <!-- Modal Top Header -->
      <div class="flex items-start justify-between border-b border-zinc-800 pb-3">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-extrabold text-white tracking-tight">Masofaviy Boshqaruv Markazi</h3>
            <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
              DISPATCHER
            </span>
          </div>
          <p class="text-xs text-sky-400 font-mono mt-0.5 font-medium truncate">
            📍 ${clubName}
          </p>
        </div>
        <button type="button" onclick="closeRemoteCommandModal()" class="w-7 h-7 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition">
          ✕
        </button>
      </div>

      <!-- Action Navigation Tabs -->
      <div class="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-zinc-900 border border-zinc-800 text-[11px] font-semibold">
        <button 
          type="button" 
          onclick="switchRemoteTab('PASSWORD')" 
          class="py-2 rounded-xl transition flex flex-col items-center gap-1 ${currentTab === 'PASSWORD' ? 'bg-rose-500 text-white font-bold shadow-md shadow-rose-500/25' : 'text-zinc-400 hover:text-white'}"
        >
          <span>🔑</span>
          <span>Parol</span>
        </button>

        <button 
          type="button" 
          onclick="switchRemoteTab('LICENSE')" 
          class="py-2 rounded-xl transition flex flex-col items-center gap-1 ${currentTab === 'LICENSE' ? 'bg-amber-500 text-black font-bold shadow-md shadow-amber-500/25' : 'text-zinc-400 hover:text-white'}"
        >
          <span>🔒</span>
          <span>Litsenziya</span>
        </button>

        <button 
          type="button" 
          onclick="switchRemoteTab('RESTART')" 
          class="py-2 rounded-xl transition flex flex-col items-center gap-1 ${currentTab === 'RESTART' ? 'bg-orange-500 text-white font-bold shadow-md shadow-orange-500/25' : 'text-zinc-400 hover:text-white'}"
        >
          <span>🔄</span>
          <span>Server</span>
        </button>

        <button 
          type="button" 
          onclick="switchRemoteTab('BROADCAST')" 
          class="py-2 rounded-xl transition flex flex-col items-center gap-1 ${currentTab === 'BROADCAST' ? 'bg-sky-500 text-black font-bold shadow-md shadow-sky-500/25' : 'text-zinc-400 hover:text-white'}"
        >
          <span>📢</span>
          <span>Xabar</span>
        </button>
      </div>

      <!-- Active Tab Form Body -->
      <div id="remoteModalBody" class="pt-1">
        ${currentTab === 'PASSWORD' ? renderPasswordDialog() : ''}
        ${currentTab === 'LICENSE' ? renderLicenseDialog() : ''}
        ${currentTab === 'RESTART' ? renderRestartDialog() : ''}
        ${currentTab === 'BROADCAST' ? renderBroadcastDialog() : ''}
      </div>
    </div>
  `;
}

// ============================================================================
// 2. FORM ACTIONS & API DISPATCHERS
// ============================================================================

window.switchRemoteTab = function(tabName) {
  triggerHaptic(12);
  remoteControlState.activeTab = tabName;
  renderRemoteControlModalContent();
};

window.generateRandomPassword = function() {
  triggerHaptic(10);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let pwd = '';
  for (let i = 0; i < 8; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const input = document.getElementById('inputNewPassword');
  if (input) {
    input.value = pwd;
    showRemoteToast(`🎲 Yangi parol hosil qilindi: ${pwd}`);
  }
};

window.setLicenseSubAction = function(action) {
  triggerHaptic(10);
  const hidden = document.getElementById('licenseSubAction');
  const lockSec = document.getElementById('licenseLockSection');
  const actSec = document.getElementById('licenseActivateSection');
  const btnLock = document.getElementById('btnLicenseLock');
  const btnAct = document.getElementById('btnLicenseActivate');

  if (hidden) hidden.value = action;

  if (action === 'LOCK') {
    if (lockSec) lockSec.classList.remove('hidden');
    if (actSec) actSec.classList.add('hidden');
    if (btnLock) btnLock.className = 'py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-sm';
    if (btnAct) btnAct.className = 'py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-zinc-400 hover:text-white';
  } else {
    if (lockSec) lockSec.classList.add('hidden');
    if (actSec) actSec.classList.remove('hidden');
    if (btnLock) btnLock.className = 'py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-zinc-400 hover:text-white';
    if (btnAct) btnAct.className = 'py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm';
  }
};

window.selectExtensionDays = function(days) {
  triggerHaptic(10);
  const input = document.getElementById('inputExtensionDays');
  if (input) input.value = days;

  document.querySelectorAll('.btn-ext-days').forEach(btn => {
    if (btn.textContent.includes(days + ' kun') || (days === 365 && btn.textContent.includes('1 yil'))) {
      btn.className = 'btn-ext-days py-2 rounded-xl text-xs font-bold border border-emerald-500/30 bg-emerald-500/20 text-emerald-300';
    } else {
      btn.className = 'btn-ext-days py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300';
    }
  });
};

window.selectRestartDelay = function(seconds) {
  triggerHaptic(10);
  const input = document.getElementById('inputRestartDelay');
  if (input) input.value = seconds;

  document.querySelectorAll('.btn-restart-delay').forEach(btn => {
    if ((seconds === 0 && btn.textContent.includes('Darhol')) || btn.textContent.includes(seconds + ' soniya')) {
      btn.className = 'btn-restart-delay py-2 rounded-xl text-xs font-bold border border-amber-500/30 bg-amber-500/20 text-amber-300';
    } else {
      btn.className = 'btn-restart-delay py-2 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300';
    }
  });
};

window.selectBroadcastTarget = function(target) {
  triggerHaptic(10);
  const input = document.getElementById('inputBroadcastTarget');
  const btnSingle = document.getElementById('btnTargetSingle');
  const btnAll = document.getElementById('btnTargetAll');

  if (input) input.value = target;

  if (target === 'SINGLE') {
    if (btnSingle) btnSingle.className = 'py-2 px-2.5 rounded-xl text-xs font-bold border border-sky-500/40 bg-sky-500/20 text-sky-300 truncate';
    if (btnAll) btnAll.className = 'py-2 px-2.5 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300 truncate';
  } else {
    if (btnSingle) btnSingle.className = 'py-2 px-2.5 rounded-xl text-xs font-bold border border-zinc-700 bg-zinc-800 text-zinc-300 truncate';
    if (btnAll) btnAll.className = 'py-2 px-2.5 rounded-xl text-xs font-bold border border-purple-500/40 bg-purple-500/20 text-purple-300 truncate';
  }
};

// ============================================================================
// 3. API SUBMIT HANDLERS
// ============================================================================

window.handleResetPasswordSubmit = async function(e) {
  e.preventDefault();
  triggerHaptic([20, 30]);

  const clubId = remoteControlState.activeClubId;
  const newPassword = document.getElementById('inputNewPassword').value.trim();
  const reason = document.getElementById('inputPasswordReason').value.trim();

  showRemoteToast("🔑 Parol yangilash buyrug'i yuborilmoqda...");

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch(`/api/telemetry/commands/${clubId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'RESET_ADMIN_PASSWORD',
        payload: { newPassword, reason }
      })
    });

    const data = await res.json();
    if (data.success) {
      alert(`✅ Muvaffaqiyatli!\n\n${remoteControlState.activeClubName} admin paroli yangilandi:\n\nLogin: admin\nYangi Parol: ${data.newPassword || newPassword}\n\nFilial serveri navbatdagi so'rovda qabul qiladi.`);
      closeRemoteCommandModal();
    } else {
      showRemoteToast(`Xatolik: ${data.error || 'Buyruq qabul qilinmadi'}`);
    }
  } catch (err) {
    showRemoteToast("Tarmoq xatosi: Buyruqni yuborib bo'lmadi");
  }
};

window.handleLicenseSubmit = async function(e) {
  e.preventDefault();
  triggerHaptic([20, 40]);

  const clubId = remoteControlState.activeClubId;
  const actionType = document.getElementById('licenseSubAction').value; // 'LOCK' | 'ACTIVATE'
  const contactPhone = document.getElementById('inputLockPhone')?.value || '+998 95 222 06 44, +998 99 563 45 16';
  const extensionDays = document.getElementById('inputExtensionDays')?.value || 30;

  const isLocking = actionType === 'LOCK';
  if (isLocking && !confirm(`${remoteControlState.activeClubName} litsenziyasini rostdan ham to'xtatmoqchimisiz? Kassir ekrani qizil blokirovkaga tushadi.`)) {
    return;
  }

  showRemoteToast(isLocking ? "🔒 Litsenziya bloklanmoqda..." : "🟢 Litsenziya faollashtirilmoqda...");

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch(`/api/telemetry/commands/${clubId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: isLocking ? 'LOCK_CLUB_LICENSE' : 'UNLOCK_CLUB_LICENSE',
        payload: isLocking ? { contactPhone } : { extensionDays }
      })
    });

    const data = await res.json();
    if (data.success) {
      showRemoteToast(`✓ ${data.message}`);
      closeRemoteCommandModal();
      if (typeof window.refreshDashboardData === 'function') window.refreshDashboardData();
      if (typeof window.refreshClubsDirectory === 'function') window.refreshClubsDirectory();
    } else {
      showRemoteToast(`Xatolik: ${data.error}`);
    }
  } catch (err) {
    showRemoteToast("Tarmoq xatosi");
  }
};

window.handleRestartSubmit = async function(e) {
  e.preventDefault();
  triggerHaptic([30, 50]);

  const clubId = remoteControlState.activeClubId;
  const delaySeconds = parseInt(document.getElementById('inputRestartDelay').value || 5, 10);
  const force = document.getElementById('checkRestartForce').checked;
  const reason = document.getElementById('inputRestartReason').value;

  showRemoteToast("🔄 Qayta ishga tushirish signali yuborilmoqda...");

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch(`/api/telemetry/commands/${clubId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'RESTART_SERVER',
        payload: { delaySeconds, force, reason }
      })
    });

    const data = await res.json();
    if (data.success) {
      showRemoteToast(`✓ ${data.message}`);
      closeRemoteCommandModal();
    } else {
      showRemoteToast(`Xatolik: ${data.error}`);
    }
  } catch (err) {
    showRemoteToast("Tarmoq xatosi");
  }
};

window.handleBroadcastSubmit = async function(e) {
  e.preventDefault();
  triggerHaptic([20, 40]);

  const targetType = document.getElementById('inputBroadcastTarget').value; // 'SINGLE' | 'ALL'
  const targetClubId = targetType === 'ALL' ? 'ALL' : remoteControlState.activeClubId;
  const title = document.getElementById('inputBroadcastTitle').value.trim();
  const message = document.getElementById('inputBroadcastMessage').value.trim();
  const priority = document.getElementById('selectBroadcastPriority').value;
  const durationSeconds = parseInt(document.getElementById('selectBroadcastDuration').value, 10);

  showRemoteToast("📢 Xabarnoma tarqatilmoqda...");

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch(`/api/telemetry/commands/${targetClubId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'BROADCAST_ANNOUNCEMENT',
        payload: { title, message, priority, durationSeconds }
      })
    });

    const data = await res.json();
    if (data.success) {
      showRemoteToast(`✓ ${data.messageSummary || 'Xabarnoma tarqatildi'}`);
      closeRemoteCommandModal();
    } else {
      showRemoteToast(`Xatolik: ${data.error}`);
    }
  } catch (err) {
    showRemoteToast("Tarmoq xatosi");
  }
};

// ============================================================================
// 4. OVERRIDE GLOBAL MODAL OPENER
// ============================================================================

window.openRemoteCommandModal = function(clubId, clubName) {
  triggerHaptic(15);
  remoteControlState.activeClubId = clubId;
  remoteControlState.activeClubName = clubName;
  remoteControlState.activeTab = 'PASSWORD';

  const modal = document.getElementById('remoteCommandModal');
  if (modal) {
    modal.classList.remove('hidden');
    renderRemoteControlModalContent();
  }
};

window.closeRemoteCommandModal = function() {
  const modal = document.getElementById('remoteCommandModal');
  if (modal) modal.classList.add('hidden');
  remoteControlState.activeClubId = null;
  remoteControlState.activeClubName = '';
};

function triggerHaptic(pattern = 15) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function showRemoteToast(message) {
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
