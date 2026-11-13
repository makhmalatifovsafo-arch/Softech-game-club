/**
 * Softech NetCafe Server — Cashier & Admin License Lock Overlay
 * Location: NetCafeServer/public/licenseGuard.js
 *
 * Activation goes through the local server so success means the license was verified and saved.
 */

(function () {
  let licensePollingTimer = null;

  let lastOverlayState = null;
  let statusRequestInFlight = false;

  async function localLicenseRequest(url, options = {}) {
    let response;
    try {
      // A forced status refresh may also wait for a new activation request.
      response = await fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(65000) });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError'
        ? 'Mahalliy server javobi kechikdi. So‘rov saqlangan bo‘lishi mumkin; Tekshirish tugmasini bosing.'
        : 'Mahalliy Softech serveri bilan aloqa uzildi. Server dasturini qayta oching va Tekshirish tugmasini bosing.');
    }
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Mahalliy server yaroqsiz javob qaytardi (HTTP ${response.status}). Yangilangan Server Setup ni o‘rnating.`); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Mahalliy server litsenziya javobini qaytarmadi. Yangilangan Server Setup ni o‘rnating.');
    }
    if (!response.ok) throw new Error(data.error || `Mahalliy server xatosi (HTTP ${response.status}).`);
    return data;
  }

  async function checkLicenseStatus(refresh = false) {
    if (statusRequestInFlight) return;
    statusRequestInFlight = true;
    try {
      const status = await localLicenseRequest('/api/license/status' + (refresh ? '?refresh=1' : ''));
      updateLicenseOverlay(status);
      const statusText = document.getElementById('activationStatusText');
      if (statusText && status.state !== 'ACTIVE') {
        statusText.textContent = status.activationError
          ? 'Aktivatsiyani tekshirishda xatolik: ' + status.activationError
          : status.activationStatus === 'PENDING' ? 'So‘rov saqlangan. Super Admin tasdig‘i kutilmoqda.'
          : status.activationStatus === 'APPROVED' ? 'Tasdiq olindi. ' + (status.lockMessage || 'Litsenziya tekshirilmoqda.')
          : 'Bulutdagi litsenziya holati tekshirilmoqda...';
        statusText.style.color = status.activationError ? '#f43f5e' : '#fbbf24';
      }
    } catch (err) {
      console.warn('⚠️ Litsenziya holatini tekshirishda xatolik:', err);
      const statusText = document.getElementById('activationStatusText');
      if (statusText) { statusText.textContent = err.message; statusText.style.color = '#f43f5e'; }
    } finally { statusRequestInFlight = false; }
  }

  function ensureOverlayContainer() {
    let overlay = document.getElementById('softechLicenseLockOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'softechLicenseLockOverlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '999999';
      lastOverlayState = null;
      overlay.style.display = 'none';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.backdropFilter = 'blur(20px)';
      overlay.style.webkitBackdropFilter = 'blur(20px)';
      overlay.style.backgroundColor = 'rgba(9, 9, 11, 0.94)';
      overlay.style.color = '#ffffff';
      overlay.style.fontFamily = "'Plus Jakarta Sans', system-ui, sans-serif";
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function updateLicenseOverlay(status) {
    const overlay = ensureOverlayContainer();

    // Agar ACTIVE bo'lsa, qulfni yashiramiz
    if (status.state === 'ACTIVE') {
      const recovered = lastOverlayState !== null && lastOverlayState !== 'ACTIVE';
      lastOverlayState = 'ACTIVE';
      overlay.style.display = 'none';
      if (recovered) window.dispatchEvent(new Event('softech-license-restored'));
      return;
    }

    overlay.style.display = 'flex';
    if (lastOverlayState === status.state && overlay.innerHTML) return;
    lastOverlayState = status.state;

    if (status.state === 'CONFIG_ERROR') {
      overlay.innerHTML = `<div style="max-width:480px;width:92%;padding:28px;border-radius:20px;background:#18181b;border:1px solid #f59e0b;text-align:center">
        <h2 style="color:#fbbf24">Sozlamalarni tiklash kerak</h2>
        <p style="line-height:1.6">Dastur sozlamalar yozilgan faylni o‘qiy olmadi. Hisoblar va mijozlar ma’lumotlari o‘chirilmagan.</p>
        <p style="line-height:1.6">Softech xizmatiga murojaat qiling. Sozlamalar tuzatilgach, dastur ularni avtomatik qayta tekshiradi.</p>
        <button onclick="window.checkLicenseNow()" style="padding:12px 20px;border:0;border-radius:10px;background:#38bdf8;color:#09090b;font-weight:bold;cursor:pointer">Qayta tekshirish</button>
      </div>`;
      return;
    }

    // 1. PENDING_ACTIVATION (Birinchi o'rnatish)
    if (status.state === 'PENDING_ACTIVATION') {
      overlay.innerHTML = `
        <div style="max-width: 480px; width: 92%; background: rgba(18, 18, 21, 0.92); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 28px; padding: 32px; box-shadow: 0 0 50px rgba(56, 189, 248, 0.15); text-align: center; color: #fff;">
          <div style="width: 56px; height: 56px; border-radius: 18px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 16px; border: 1px solid rgba(56, 189, 248, 0.3);">
            ⚡
          </div>
          <h2 style="font-size: 20px; font-weight: 800; color: #ffffff; margin: 0 0 8px; letter-spacing: -0.5px;">Serverni Faollashtirish</h2>
          <p style="font-size: 13px; color: #a1a1aa; line-height: 1.5; margin: 0 0 20px;">
            Super Admin panelidan olingan litsenziya kalitini kiriting yoki Telegram orqali so'rov yuboring.
          </p>

          <!-- USUL 1: Super Admin Kaliti Bilan Darhol Faollashtirish -->
          <div style="background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 18px; padding: 18px; text-align: left; margin-bottom: 16px;">
            <label style="display: block; font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
              🔑 Super Admin Litsenziya Kaliti:
            </label>
            <div style="display: flex; gap: 8px;">
              <input 
                type="text" 
                id="manualLicenseKeyInput" 
                placeholder="masalan: SOFTECH-XXXX-XXXX" 
                style="flex: 1; padding: 10px 14px; border-radius: 12px; background: #09090b; border: 1px solid #27272a; color: #fff; font-family: monospace; font-size: 13px; outline: none;"
                onfocus="this.style.borderColor='#38bdf8'"
                onblur="this.style.borderColor='#27272a'"
              />
              <button 
                id="btnActivateByKey"
                onclick="window.activateWithKey()" 
                style="padding: 10px 16px; border-radius: 12px; background: #38bdf8; color: #000; font-weight: 800; font-size: 12px; border: none; cursor: pointer; transition: 0.2s; white-space: nowrap;"
              >
                Faollashtirish ↵
              </button>
            </div>
            <div id="activationKeyError" style="display: none; color: #f43f5e; font-size: 11px; margin-top: 8px; font-weight: 600;"></div>
          </div>

          <!-- USUL 2: Telegram Orqali So'rov Yuborish -->
          <div style="background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 18px; padding: 16px; text-align: left; margin-bottom: 16px;">
            <label style="display: block; font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
              🏢 Game Club Nomi:
            </label>
            <input 
              type="text" 
              id="clubNameInput" 
              placeholder="masalan: Apex Gaming Club" 
              style="width: 100%; padding: 10px 14px; border-radius: 12px; background: #09090b; border: 1px solid #27272a; color: #fff; font-size: 13px; outline: none; box-sizing: border-box; margin-bottom: 10px;"
              onfocus="this.style.borderColor='#38bdf8'"
              onblur="this.style.borderColor='#27272a'"
            />
            <div style="font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Mashina HWID Kaliti:</div>
            <div style="font-family: monospace; font-size: 13px; font-weight: 700; color: #38bdf8; margin-top: 4px; word-break: break-all;">
              ${status.hwid}
            </div>
            <div id="activationPollingStatus" style="font-size: 11px; color: #fbbf24; margin-top: 10px; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; animation: pulse 1.5s infinite;"></span>
              <span id="activationStatusText">Holat: Super Admin tasdig'i kutilmoqda (avtomatik tekshirilmoqda...)</span>
            </div>
          </div>

          <div style="display: flex; gap: 10px;">
            <button 
              id="btnSendActivationReq"
              onclick="window.requestServerActivation()" 
              style="flex: 1; padding: 12px; border-radius: 12px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-weight: 700; font-size: 12px; cursor: pointer; transition: 0.2s;"
            >
              🚀 So'rov Yuborish (Telegram)
            </button>
            <button 
              onclick="window.checkLicenseNow()" 
              style="padding: 12px 18px; border-radius: 12px; background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 600; font-size: 12px; border: 1px solid rgba(255, 255, 255, 0.12); cursor: pointer; transition: 0.2s;"
            >
              🔄 Tekshirish
            </button>
          </div>

          <div id="cloudRequestResult" style="display: none; margin-top: 12px; padding: 10px; border-radius: 10px; font-size: 11px; font-weight: 600;"></div>
        </div>
      `;
      return;
    }

    // 2. LOCKED_BY_ADMIN / EXPIRED / HWID_MISMATCH (Remote Kill-Switch Active)
    const isMismatch = status.state === 'HWID_MISMATCH';
    const isClock = status.state === 'CLOCK_TAMPERED';
    const title = isMismatch ? "Qurilma Mos Kelmadi (Anti-Clone Guard)" : (isClock ? "Vaqt Manipulyatsiyasi Aniqlandi" : "Dastur Litsenziyasi To'xtatildi");

    overlay.innerHTML = `
      <div style="max-width: 480px; width: 92%; background: rgba(20, 10, 12, 0.92); border: 2px solid rgba(244, 63, 94, 0.5); border-radius: 28px; padding: 36px; box-shadow: 0 0 50px rgba(244, 63, 94, 0.25); text-align: center;">
        <div style="width: 64px; height: 64px; border-radius: 20px; background: rgba(244, 63, 94, 0.2); color: #f43f5e; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 18px; border: 1px solid rgba(244, 63, 94, 0.4);">
          🚫
        </div>
        
        <h2 style="font-size: 20px; font-weight: 900; color: #ffffff; margin: 0 0 10px; letter-spacing: -0.5px;">
          ${title}
        </h2>

        <p style="font-size: 13px; color: #fda4af; line-height: 1.6; margin: 0 0 24px;">
          ${status.lockMessage || "DIQQAT: Dastur litsenziyasi to'xtatildi. Qayta faollashtirish uchun ta'minotchi bilan bog'laning."}
        </p>

        <div style="background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 18px; padding: 16px; text-align: left; margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px;">
            <span style="color: #9ca3af;">Klub:</span>
            <span style="color: #ffffff; font-weight: 700;">${status.clubName}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px;">
            <span style="color: #9ca3af;">Mashina HWID:</span>
            <span style="color: #38bdf8; font-family: monospace; font-weight: 700;">${status.hwid}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 11px;">
            <span style="color: #9ca3af;">Bog'lanish:</span>
            <span style="color: #34d399; font-weight: 700;">${status.supportPhone || '+998 95 222 06 44, +998 99 563 45 16'}</span>
          </div>
        </div>

        ${isMismatch ? `
        <!-- HWID Qayta Faollashtirish Qismi -->
        <div style="background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 18px; padding: 18px; text-align: left; margin-bottom: 16px;">
          <label style="display: block; font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
            🔑 Super Admin Litsenziya Kaliti:
          </label>
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <input 
              type="text" 
              id="manualLicenseKeyInput" 
              placeholder="masalan: SOFTECH-XXXX-XXXX" 
              style="flex: 1; padding: 10px 14px; border-radius: 12px; background: #09090b; border: 1px solid #27272a; color: #fff; font-family: monospace; font-size: 13px; outline: none;"
            />
            <button 
              id="btnActivateByKey"
              onclick="window.activateWithKey()" 
              style="padding: 10px 16px; border-radius: 12px; background: #38bdf8; color: #000; font-weight: 800; font-size: 12px; border: none; cursor: pointer; white-space: nowrap;"
            >
              Faollashtirish ↵
            </button>
          </div>
          <button 
            id="btnSendActivationReq"
            onclick="window.requestServerActivation()" 
            style="width: 100%; padding: 11px; border-radius: 12px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-weight: 700; font-size: 12px; cursor: pointer;"
          >
            🚀 Ushbu Yangi Qurilma Uchun So'rov Yuborish (Telegram)
          </button>
          <div id="activationKeyError" style="display: none; color: #f43f5e; font-size: 11px; margin-top: 8px; font-weight: 600;"></div>
        </div>
        ` : ''}

        ${!isMismatch && !isClock ? `
        <button id="btnSendActivationReq" onclick="window.requestServerActivation()"
          style="width:100%;padding:14px;margin-bottom:12px;border-radius:14px;border:1px solid #38bdf8;background:rgba(56,189,248,.15);color:#38bdf8;font-weight:800;cursor:pointer;">
          Litsenziyani qayta so‘rash (Telegram)
        </button>
        <p id="activationStatusText" style="font-size:12px;color:#fbbf24;line-height:1.5">So‘rov yuborilgach, Super Admin tasdig‘i kutiladi.</p>
        ` : ''}
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <a href="tel:+998952220644" style="display: block; text-decoration: none; padding: 14px; border-radius: 14px; background: #f43f5e; color: #fff; font-weight: 800; font-size: 13px; text-align: center; box-shadow: 0 4px 15px rgba(244, 63, 94, 0.4);">
            📞 Ta'minotchi: +998 95 222 06 44 / +998 99 563 45 16
          </a>
          <button onclick="window.checkLicenseNow()" style="padding: 12px; border-radius: 14px; background: rgba(255, 255, 255, 0.08); color: #d4d4d8; font-weight: 600; font-size: 12px; border: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer;">
            🔄 Litsenziyani Qayta Tekshirish
          </button>
        </div>
        <div id="cloudRequestResult" style="display: none; margin-top: 12px; padding: 10px; border-radius: 10px; font-size: 11px; font-weight: 600;"></div>
      </div>
    `;
  }

  window.checkLicenseNow = function () {
    return checkLicenseStatus(true);
  };

  // ===================================================================
  // USUL 1: LITSENZIYA KALITI BILAN DARHOL FAOLLASHTIRISH

  // ===================================================================
  window.activateWithKey = async function () {
    const input = document.getElementById('manualLicenseKeyInput');
    const errEl = document.getElementById('activationKeyError');
    const btn = document.getElementById('btnActivateByKey');
    if (!input || !input.value.trim()) {
      if (errEl) { errEl.textContent = "Iltimos, litsenziya kalitini kiriting."; errEl.style.display = 'block'; }
      return;
    }

    const key = input.value.trim();
    if (errEl) errEl.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = 'Tekshirilmoqda...'; }

    try {
      // Hardware identity and installed version are supplied by the local server.
      const cloudData = await localLicenseRequest('/api/license/activate-with-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key })
      });

      if (cloudData.success) {
        if (errEl) { errEl.style.display = 'none'; }
        const resultEl = document.getElementById('cloudRequestResult');
        if (resultEl) {
          resultEl.style.display = 'block';
          resultEl.style.background = 'rgba(34, 197, 94, 0.15)';
          resultEl.style.border = '1px solid rgba(34, 197, 94, 0.3)';
          resultEl.style.color = '#22c55e';
          resultEl.textContent = "✅ " + (cloudData.message || "Litsenziya muvaffaqiyatli faollashtirildi!");
        }
        // Qayta tekshirish
        setTimeout(() => checkLicenseStatus(), 1000);
      } else {
        if (errEl) {
          errEl.textContent = cloudData.error || "Litsenziya kaliti noto'g'ri.";
          errEl.style.display = 'block';
        }
      }
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Faollashtirish ↵'; }
    }
  };

  // ===================================================================
  // USUL 2: TELEGRAM ORQALI SO'ROV YUBORISH

  // ===================================================================
  window.requestServerActivation = async function () {
    const btn = document.getElementById('btnSendActivationReq');
    if (btn?.disabled) return;
    const originalLabel = btn?.textContent;
    const statusText = document.getElementById('activationStatusText');
    const resultEl = document.getElementById('cloudRequestResult');
    const clubNameInput = document.getElementById('clubNameInput');

    const clubName = (clubNameInput && clubNameInput.value.trim()) || 'Yangi Game Club';

    if (btn) { btn.disabled = true; btn.textContent = 'Yuborilmoqda...'; }
    if (resultEl) { resultEl.style.display = 'none'; }

    try {
      const cloudData = await localLicenseRequest('/api/license/request-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubName })
      });
      if (!cloudData.success) throw new Error(cloudData.error || 'So\'rov saqlanmadi.');

      if (statusText) {
        statusText.textContent = cloudData.message || "So\'rov saqlandi. Super Admin tasdig\'i kutilmoqda.";
        statusText.style.color = '#22c55e';
      }
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.style.background = 'rgba(34, 197, 94, 0.15)';
        resultEl.style.border = '1px solid rgba(34, 197, 94, 0.3)';
        resultEl.style.color = '#22c55e';
        resultEl.textContent = "✅ " + (cloudData.message || "So'rov muvaffaqiyatli yuborildi!");
      }

      checkLicenseStatus();
    } catch (err) {
      if (statusText) {
        statusText.textContent = err.message;
        statusText.style.color = '#f43f5e';
      }
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.style.background = 'rgba(244, 63, 94, 0.15)';
        resultEl.style.border = '1px solid rgba(244, 63, 94, 0.3)';
        resultEl.style.color = '#f43f5e';
        resultEl.textContent = "❌ Xatolik: " + err.message;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
    }
  };

  // Dastlabki tekshirish va har 4 soniyada faol tekshirish
  document.addEventListener('DOMContentLoaded', () => {
    checkLicenseStatus();
    licensePollingTimer = setInterval(checkLicenseStatus, 4000);
  });
})();
