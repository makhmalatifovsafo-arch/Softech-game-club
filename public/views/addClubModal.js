/**
 * Softech Super Admin — New Club Registration Wizard (Onboarding Modal)
 * Location: SoftechCloudAdmin/public/views/addClubModal.js
 * 
 * Multi-Step Mobile Registration Flow:
 * 1. Klub Ma'lumotlari (Nomi, Shahar/Tuman, Egasi, Telefon)
 * 2. Texnik Sozlamalar & Litsenziya (PC Soni, Trial/Monthly/Annual, Tarif)
 * 3. Litsenziya Kaliti Yaratish (SOFTECH-LICENSE-XXXX-XXXX, QR Kod, Nusxalash)
 */

// Wizard Global State
const wizardState = {
  currentStep: 1, // 1 | 2 | 3
  isSubmitting: false,
  form: {
    name: '',
    city: 'Toshkent',
    district: '',
    ownerName: '',
    ownerPhone: '+998',
    totalWorkstations: 16,
    licenseType: 'MONTHLY', // 'TRIAL' | 'MONTHLY' | 'ANNUAL'
    licenseDays: 30,
    tariffType: 'PER_PC', // 'PER_PC' | 'FIXED'
    tariffPricePerPc: 20000,
    tariffFixedPrice: 500000
  },
  createdClub: null
};

/**
 * Haptic tebranish yordamchisi
 */
function triggerHaptic(pattern = 15) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

/**
 * Toast xabarnoma ko'rsatish
 */
function showModalToast(message) {
  const toast = document.getElementById('toastNotification');
  if (toast) {
    toast.textContent = message;
    toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
    toast.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
    }, 2800);
  }
}

/**
 * Raqamlarni so'm formatida chiqarish
 */
function formatMoney(amount) {
  return (Number(amount) || 0).toLocaleString('uz-UZ') + ' UZS';
}

/**
 * Shisha modal konteynerini yaratish yoki mavjudini olish
 */
function ensureModalContainer() {
  let modal = document.getElementById('addClubModalContainer');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'addClubModalContainer';
    modal.className = 'hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md transition-all duration-300';
    document.body.appendChild(modal);
  }
  return modal;
}

/**
 * Wizard qadamlar boshqaruv paneli (Stepper Header)
 */
function renderStepperHeader() {
  const step = wizardState.currentStep;
  return `
    <div class="px-5 pt-4 pb-2 border-b border-zinc-800/80">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 p-0.5 flex-shrink-0">
            <div class="w-full h-full bg-[#09090b] rounded-[10px] flex items-center justify-center text-sky-400 font-bold text-xs">
              +
            </div>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white tracking-tight">Yangi Klub Qo'shish</h3>
            <p class="text-[10px] text-zinc-400 font-mono">Qadam ${step} / 3: ${
              step === 1 ? "Klub Ma'lumotlari" : (step === 2 ? "Texnik Sozlamalar" : "Litsenziya Kaliti")
            }</p>
          </div>
        </div>
        <button type="button" onclick="window.closeAddClubModal()" class="w-8 h-8 rounded-xl bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition active:scale-95">
          ✕
        </button>
      </div>

      <!-- Step Indicator Dots -->
      <div class="grid grid-cols-3 gap-2 mt-3 mb-1">
        <div class="h-1 rounded-full transition-all duration-300 ${step >= 1 ? 'bg-sky-400 shadow-sm shadow-sky-400/50' : 'bg-zinc-800'}"></div>
        <div class="h-1 rounded-full transition-all duration-300 ${step >= 2 ? 'bg-sky-400 shadow-sm shadow-sky-400/50' : 'bg-zinc-800'}"></div>
        <div class="h-1 rounded-full transition-all duration-300 ${step >= 3 ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-zinc-800'}"></div>
      </div>
    </div>
  `;
}

/**
 * QADAM 1: Klub Ma'lumotlari (Nomi, Shahar, Tuman, Egasi, Telefon)
 */
function renderStep1() {
  const f = wizardState.form;
  const cities = [
    'Toshkent', 'Samarqand', 'Buxoro', 'Farg\'ona', 'Andijon', 'Namangan',
    'Qashqadaryo', 'Surxondaryo', 'Xorazm', 'Navoiy', 'Jizzax', 'Sirdaryo', 'Qoraqalpog\'iston'
  ];

  return `
    <div class="p-5 space-y-4 animate-fade-in">
      <!-- 1. Klub Nomi -->
      <div class="space-y-1.5">
        <label class="block text-xs font-semibold text-zinc-300">
          Klub Nomi <span class="text-rose-400">*</span>
        </label>
        <div class="relative">
          <input 
            type="text" 
            id="wizardClubName" 
            value="${f.name}"
            oninput="wizardState.form.name = this.value"
            placeholder="masalan: Titan Gaming Chilonzor" 
            class="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition font-sans"
          />
        </div>
      </div>

      <!-- 2. Shahar va Tuman -->
      <div class="grid grid-cols-2 gap-2.5">
        <div class="space-y-1.5">
          <label class="block text-xs font-semibold text-zinc-300">Shahar/Viloyat</label>
          <select 
            id="wizardCity"
            onchange="wizardState.form.city = this.value"
            class="w-full px-3 py-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-xs text-white focus:outline-none focus:border-sky-500 transition font-sans"
          >
            ${cities.map(c => `
              <option value="${c}" ${f.city === c ? 'selected' : ''}>${c}</option>
            `).join('')}
          </select>
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-semibold text-zinc-300">Tuman / Hudud</label>
          <input 
            type="text" 
            id="wizardDistrict" 
            value="${f.district}"
            oninput="wizardState.form.district = this.value"
            placeholder="masalan: Chilonzor 9" 
            class="w-full px-3 py-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 transition font-sans"
          />
        </div>
      </div>

      <!-- 3. Egasi / Rahbari -->
      <div class="space-y-1.5">
        <label class="block text-xs font-semibold text-zinc-300">
          Klub Egasi / Menejer F.I.Sh <span class="text-rose-400">*</span>
        </label>
        <input 
          type="text" 
          id="wizardOwnerName" 
          value="${f.ownerName}"
          oninput="wizardState.form.ownerName = this.value"
          placeholder="masalan: Jasur Rahimov" 
          class="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 transition font-sans"
        />
      </div>

      <!-- 4. Telefon Raqami -->
      <div class="space-y-1.5">
        <label class="block text-xs font-semibold text-zinc-300">
          Telefon Raqami <span class="text-rose-400">*</span>
        </label>
        <div class="relative">
          <input 
            type="tel" 
            id="wizardOwnerPhone" 
            value="${f.ownerPhone}"
            oninput="wizardState.form.ownerPhone = this.value"
            placeholder="+998 90 123 45 67" 
            class="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-mono transition"
          />
        </div>
        <p class="text-[10px] text-zinc-500">Kassir yoki rahbar bilan SMS/Telegram orqali bog'lanish uchun ishlatiladi.</p>
      </div>

      <!-- Step 1 Footer -->
      <div class="pt-2">
        <button 
          type="button" 
          onclick="window.goToWizardStep(2)"
          class="w-full py-3 px-4 rounded-xl text-xs font-bold text-black bg-sky-400 hover:bg-sky-300 active:scale-98 transition flex items-center justify-center gap-2 shadow-lg shadow-sky-400/20"
        >
          <span>Keyingisi: Texnik Sozlamalar</span>
          <span class="font-mono text-sm">➔</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * QADAM 2: Texnik Sozlamalar & Tarif (PC Soni, Litsenziya Turi)
 */
function renderStep2() {
  const f = wizardState.form;
  const pcs = f.totalWorkstations || 16;
  const pricePerPc = f.tariffPricePerPc || 20000;
  const monthlyTotal = pcs * pricePerPc;

  return `
    <div class="p-5 space-y-4 animate-fade-in">
      <!-- 1. Kompyuterlar Soni (Interactive Stepper) -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-zinc-300">
            Kompyuterlar Soni (Workstations)
          </label>
          <span class="text-[11px] font-mono text-sky-400 font-bold">${pcs} ta PC</span>
        </div>

        <div class="flex items-center gap-2">
          <button 
            type="button" 
            onclick="window.adjustWorkstations(-5)"
            class="w-10 h-10 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white font-mono font-bold text-sm active:scale-95 transition"
          >
            -5
          </button>
          <button 
            type="button" 
            onclick="window.adjustWorkstations(-1)"
            class="w-10 h-10 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white font-mono font-bold text-lg active:scale-95 transition"
          >
            -
          </button>
          <input 
            type="number" 
            id="wizardPcsInput" 
            value="${pcs}"
            min="1" 
            max="250"
            oninput="window.setWorkstations(this.value)"
            class="flex-1 text-center py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-base font-extrabold font-mono text-white focus:outline-none focus:border-sky-500"
          />
          <button 
            type="button" 
            onclick="window.adjustWorkstations(1)"
            class="w-10 h-10 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white font-mono font-bold text-lg active:scale-95 transition"
          >
            +
          </button>
          <button 
            type="button" 
            onclick="window.adjustWorkstations(5)"
            class="w-10 h-10 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white font-mono font-bold text-sm active:scale-95 transition"
          >
            +5
          </button>
        </div>
      </div>

      <!-- 2. Litsenziya Turi (Trial / Monthly / Annual) -->
      <div class="space-y-2">
        <label class="block text-xs font-semibold text-zinc-300">
          Litsenziya va Obuna Turi
        </label>
        
        <div class="space-y-2">
          <!-- A) Trial (7 kun) -->
          <div 
            onclick="window.setLicenseType('TRIAL')"
            class="p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${f.licenseType === 'TRIAL' ? 'bg-emerald-500/10 border-emerald-500/60 shadow-lg shadow-emerald-500/10' : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'}"
          >
            <div class="flex items-center gap-3">
              <span class="text-xl">🟢</span>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-xs font-bold text-white">Sinov Muddati (Trial)</h4>
                  <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300">BEPUL</span>
                </div>
                <p class="text-[10px] text-zinc-400 mt-0.5">7 kun to'liq funksional sinov rejimi</p>
              </div>
            </div>
            <div class="w-4 h-4 rounded-full border flex items-center justify-center ${f.licenseType === 'TRIAL' ? 'border-emerald-400 bg-emerald-400' : 'border-zinc-600'}">
              ${f.licenseType === 'TRIAL' ? '<span class="text-black text-[9px] font-bold">✓</span>' : ''}
            </div>
          </div>

          <!-- B) Monthly (30 kun) -->
          <div 
            onclick="window.setLicenseType('MONTHLY')"
            class="p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${f.licenseType === 'MONTHLY' ? 'bg-sky-500/10 border-sky-500/60 shadow-lg shadow-sky-500/10' : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'}"
          >
            <div class="flex items-center gap-3">
              <span class="text-xl">⚡</span>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-xs font-bold text-white">Oylik Obuna (Standart)</h4>
                  <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-500/20 text-sky-300">30 KUN</span>
                </div>
                <p class="text-[10px] text-zinc-400 mt-0.5">1 PC uchun oyiga 20 000 UZS</p>
              </div>
            </div>
            <div class="w-4 h-4 rounded-full border flex items-center justify-center ${f.licenseType === 'MONTHLY' ? 'border-sky-400 bg-sky-400' : 'border-zinc-600'}">
              ${f.licenseType === 'MONTHLY' ? '<span class="text-black text-[9px] font-bold">✓</span>' : ''}
            </div>
          </div>

          <!-- C) Annual (365 kun) -->
          <div 
            onclick="window.setLicenseType('ANNUAL')"
            class="p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${f.licenseType === 'ANNUAL' ? 'bg-purple-500/10 border-purple-500/60 shadow-lg shadow-purple-500/10' : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'}"
          >
            <div class="flex items-center gap-3">
              <span class="text-xl">👑</span>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-xs font-bold text-white">Yillik Obuna (Pro)</h4>
                  <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-500/20 text-purple-300">-15% CHEGIRMA</span>
                </div>
                <p class="text-[10px] text-zinc-400 mt-0.5">365 kun uzluksiz texnik ko'mak</p>
              </div>
            </div>
            <div class="w-4 h-4 rounded-full border flex items-center justify-center ${f.licenseType === 'ANNUAL' ? 'border-purple-400 bg-purple-400' : 'border-zinc-600'}">
              ${f.licenseType === 'ANNUAL' ? '<span class="text-black text-[9px] font-bold">✓</span>' : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Kutilayotgan Oylik SaaS To'lovi Xulosasi -->
      <div class="p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-xs space-y-1">
        <div class="flex items-center justify-between text-zinc-400">
          <span>Tarif hisobi (${pcs} ta PC &times; 20 000 UZS):</span>
          <span class="font-mono font-bold text-white">${formatMoney(monthlyTotal)}/oy</span>
        </div>
        <div class="flex items-center justify-between text-zinc-500 text-[10px]">
          <span>Litsenziya muddati:</span>
          <span class="text-sky-400 font-mono">${f.licenseType === 'TRIAL' ? '7 kun (Sinov)' : (f.licenseType === 'ANNUAL' ? '365 kun' : '30 kun')}</span>
        </div>
      </div>

      <!-- Step 2 Buttons -->
      <div class="flex items-center gap-2 pt-2">
        <button 
          type="button" 
          onclick="window.goToWizardStep(1)"
          class="py-3 px-4 rounded-xl text-xs font-semibold text-zinc-300 bg-zinc-800 hover:text-white active:scale-95 transition"
        >
          Ortga
        </button>
        <button 
          type="button" 
          id="btnSubmitClubWizard"
          onclick="window.submitClubRegistration()"
          class="flex-1 py-3 px-4 rounded-xl text-xs font-bold text-black bg-emerald-400 hover:bg-emerald-300 active:scale-98 transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-400/20 ${wizardState.isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}"
        >
          <span>${wizardState.isSubmitting ? 'Saqlanmoqda...' : 'Klubni Saqlash va Token Yaratish'}</span>
          <span>🚀</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * QADAM 3: Litsenziya Kaliti Yaratish & QR-Kod (Success & Server Pairing)
 */
function renderStep3() {
  const club = wizardState.createdClub;
  if (!club) return '';

  const licenseToken = club.licenseKey || 'SOFTECH-LICENSE-XXXX-XXXX';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(licenseToken)}&bgcolor=09090b&color=38bdf8&margin=4`;

  return `
    <div class="p-5 space-y-4 animate-fade-in text-center">
      <!-- Success Icon -->
      <div class="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-2xl mx-auto shadow-lg shadow-emerald-500/10">
        ✓
      </div>

      <div>
        <h4 class="text-sm font-extrabold text-white tracking-tight">${club.name} Muvaffaqiyatli Qo'shildi!</h4>
        <p class="text-xs text-zinc-400 mt-1">Litsenziya kaliti yaratildi va tarmoq kutish rejimiga o'tdi.</p>
      </div>

      <!-- Litsenziya Kaliti Kartochkasi (Monospace + Nusxalash) -->
      <div class="p-3.5 rounded-2xl glass-card border border-sky-500/40 glow-cyan text-left space-y-2">
        <div class="flex items-center justify-between text-[10px] text-zinc-400">
          <span class="font-bold uppercase tracking-wider text-sky-400">UNIKAL LITSENZIYA KALITI</span>
          <span class="font-mono text-zinc-500">AES / HMAC</span>
        </div>

        <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-black/60 border border-zinc-800">
          <span id="createdLicenseKeyDisplay" class="font-mono font-black text-sm sm:text-base text-white tracking-wider truncate">
            ${licenseToken}
          </span>
          <button 
            type="button" 
            onclick="window.copyLicenseKey('${licenseToken}')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-sky-400 hover:bg-sky-300 active:scale-95 transition flex items-center gap-1.5 flex-shrink-0 shadow-md shadow-sky-400/20"
          >
            <span>📋</span>
            <span>Nusxalash</span>
          </button>
        </div>
      </div>

      <!-- QR Kod Kartochkasi (Tezkor skanerlash uchun) -->
      <div class="glass-card p-3.5 rounded-2xl border border-zinc-800 space-y-2.5">
        <div class="text-[11px] font-semibold text-zinc-300">
          📱 Kassir Serveri Uchun QR-Kod
        </div>
        
        <div class="w-44 h-44 mx-auto rounded-2xl bg-[#09090b] p-2 border border-sky-500/30 flex items-center justify-center shadow-xl">
          <img 
            src="${qrUrl}" 
            alt="License QR Code" 
            class="w-full h-full rounded-xl object-contain"
            onerror="this.src=''; this.alt='QR kod yuklanmoqda...';"
          />
        </div>

        <p class="text-[10px] text-zinc-400 max-w-xs mx-auto leading-relaxed">
          Kassir o'z serverida ilovani ishga tushirayotganda ushbu QR-kodni skanerlashi yoki tokenni qo'lda kiritishi kifoya. Tizim avtomatik tarzda markaziy bulutga ulanadi.
        </p>
      </div>

      <!-- Server Terminal Buyrug'i Misoli -->
      <div class="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-left space-y-1">
        <span class="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Lokal Server Buyrug'i:</span>
        <div class="font-mono text-[10px] text-emerald-400 select-all truncate">
          NetCafeServer --cloud-token ${licenseToken}
        </div>
      </div>

      <!-- Finish Button -->
      <div class="pt-2">
        <button 
          type="button" 
          onclick="window.finishAddClubWizard()"
          class="w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 active:scale-98 transition flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20"
        >
          <span>Klublar Ro'yxatiga O'tish</span>
          <span class="font-mono">➔</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Modalni to'liq chizish (Render Modal Wrapper)
 */
export function renderAddClubModal() {
  const container = ensureModalContainer();
  const step = wizardState.currentStep;

  let bodyHtml = '';
  if (step === 1) bodyHtml = renderStep1();
  else if (step === 2) bodyHtml = renderStep2();
  else if (step === 3) bodyHtml = renderStep3();

  container.innerHTML = `
    <div class="glass-card w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-700/60 max-h-[92vh] overflow-y-auto ios-scroll shadow-2xl animate-fade-in relative">
      <!-- Drawer Handle for mobile -->
      <div class="w-10 h-1 bg-zinc-700 rounded-full mx-auto mt-2 mb-1 sm:hidden"></div>

      <!-- Stepper Header -->
      ${renderStepperHeader()}

      <!-- Step Content -->
      ${bodyHtml}
    </div>
  `;
}

/**
 * ============================================================================
 * INTERACTIVE ACTIONS & HANDLERS
 * ============================================================================
 */

window.openAddClubModal = function() {
  triggerHaptic(20);
  wizardState.currentStep = 1;
  wizardState.isSubmitting = false;
  wizardState.createdClub = null;
  wizardState.form = {
    name: '',
    city: 'Toshkent',
    district: '',
    ownerName: '',
    ownerPhone: '+998',
    totalWorkstations: 16,
    licenseType: 'MONTHLY',
    licenseDays: 30,
    tariffType: 'PER_PC',
    tariffPricePerPc: 20000,
    tariffFixedPrice: 500000
  };

  const container = ensureModalContainer();
  container.classList.remove('hidden');
  renderAddClubModal();
};

window.closeAddClubModal = function() {
  triggerHaptic(15);
  const container = document.getElementById('addClubModalContainer');
  if (container) {
    container.classList.add('hidden');
  }
};

window.goToWizardStep = function(step) {
  triggerHaptic(15);

  // Qadam 1 validatsiyasi
  if (step === 2) {
    const f = wizardState.form;
    if (!f.name || !f.name.trim()) {
      showModalToast("⚠️ Iltimos, klub nomini kiriting.");
      return;
    }
    if (!f.ownerName || !f.ownerName.trim()) {
      showModalToast("⚠️ Iltimos, klub egasining ismini kiriting.");
      return;
    }
    if (!f.ownerPhone || f.ownerPhone.trim().length < 9) {
      showModalToast("⚠️ Iltimos, to'liq telefon raqamini kiriting.");
      return;
    }
  }

  wizardState.currentStep = step;
  renderAddClubModal();
};

window.adjustWorkstations = function(delta) {
  triggerHaptic(10);
  let val = (wizardState.form.totalWorkstations || 16) + delta;
  if (val < 1) val = 1;
  if (val > 250) val = 250;
  wizardState.form.totalWorkstations = val;
  renderAddClubModal();
};

window.setWorkstations = function(val) {
  let num = parseInt(val, 10);
  if (isNaN(num) || num < 1) num = 1;
  if (num > 250) num = 250;
  wizardState.form.totalWorkstations = num;
  renderAddClubModal();
};

window.setLicenseType = function(type) {
  triggerHaptic(15);
  wizardState.form.licenseType = type;
  if (type === 'TRIAL') wizardState.form.licenseDays = 7;
  else if (type === 'MONTHLY') wizardState.form.licenseDays = 30;
  else if (type === 'ANNUAL') wizardState.form.licenseDays = 365;
  renderAddClubModal();
};

window.submitClubRegistration = async function() {
  if (wizardState.isSubmitting) return;

  const f = wizardState.form;
  if (!f.name || !f.ownerName || !f.ownerPhone) {
    showModalToast("⚠️ Barcha majburiy maydonlarni to'ldiring.");
    return;
  }

  triggerHaptic([30, 50]);
  wizardState.isSubmitting = true;
  renderAddClubModal();

  try {
    const token = localStorage.getItem('softech_access_token');
    const res = await fetch('/api/telemetry/clubs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: f.name.trim(),
        city: f.city,
        district: f.district.trim(),
        ownerName: f.ownerName.trim(),
        ownerPhone: f.ownerPhone.trim(),
        totalWorkstations: f.totalWorkstations,
        licenseType: f.licenseType,
        licenseDays: f.licenseDays,
        tariffType: f.tariffType,
        tariffPricePerPc: f.tariffPricePerPc,
        tariffFixedPrice: f.tariffFixedPrice
      })
    });

    const data = await res.json();
    if (res.status === 201 || (data.success && data.club)) {
      wizardState.createdClub = data.club;
      wizardState.currentStep = 3;
      showModalToast("✓ Klub saqlandi va litsenziya kaliti yaratildi!");
    } else {
      showModalToast(`Xatolik: ${data.error || "Ro'yxatdan o'tkazib bo'lmadi"}`);
    }
  } catch (err) {
    console.error('❌ [Wizard] Server xatosi:', err);
    showModalToast("Server bilan bog'lanishda xatolik yuz berdi.");
  } finally {
    wizardState.isSubmitting = false;
    renderAddClubModal();
  }
};

window.copyLicenseKey = function(key) {
  triggerHaptic([20, 20]);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(key).then(() => {
      showModalToast("✓ Litsenziya kaliti buferga nusxalandi!");
    }).catch(() => {
      fallbackCopy(key);
    });
  } else {
    fallbackCopy(key);
  }
};

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showModalToast("✓ Litsenziya kaliti buferga nusxalandi!");
  } catch {
    showModalToast("Kalit: " + text);
  }
  document.body.removeChild(ta);
}

window.finishAddClubWizard = function() {
  triggerHaptic(20);
  window.closeAddClubModal();

  // Agar hozir Klublar ro'yxatida bo'lsa yangilaymiz
  if (typeof window.refreshClubsDirectory === 'function') {
    window.refreshClubsDirectory();
  } else if (typeof window.switchTab === 'function') {
    window.switchTab('clubs');
  }
};
