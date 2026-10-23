/**
 * Softech NetCafe Server — Cashier & Admin License Lock Overlay
 * Location: NetCafeServer/public/licenseGuard.js
 */

(function () {
  let licensePollingTimer = null;

  async function checkLicenseStatus() {
    try {
      const res = await fetch('/api/license/status');
      if (!res.ok) return;
      const status = await res.json();
      updateLicenseOverlay(status);
    } catch (err) {
      console.warn('⚠️ Litsenziya holatini tekshirishda xatolik:', err);
    }
  }

  function ensureOverlayContainer() {
    let overlay = document.getElementById('softechLicenseLockOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'softechLicenseLockOverlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '999999';
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
      overlay.style.display = 'none';
      return;
    }

    overlay.style.display = 'flex';

    // 1. PENDING_ACTIVATION (Birinchi o'rnatish)
    if (status.state === 'PENDING_ACTIVATION') {
      overlay.innerHTML = `
        <div style="max-width: 440px; width: 90%; background: rgba(18, 18, 21, 0.85); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 24px; padding: 32px; box-shadow: 0 0 40px rgba(56, 189, 248, 0.15); text-align: center;">
          <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 16px;">
            ⚡
          </div>
          <h2 style="font-size: 18px; font-weight: 800; color: #ffffff; margin: 0 0 8px;">Ushbu Server Faollashtirilmagan</h2>
          <p style="font-size: 13px; color: #a1a1aa; line-height: 1.5; margin: 0 0 20px;">
            Dasturdan foydalanish uchun litsenziya so'rovi Super Adminga yuborilgan. Tasdiqlanishi kutilmoqda.
          </p>

          <div style="background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 14px; text-align: left; margin-bottom: 20px;">
            <div style="font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Mashina HWID Kaliti:</div>
            <div style="font-family: monospace; font-size: 14px; font-weight: 700; color: #38bdf8; margin-top: 4px; word-break: break-all;">
              ${status.hwid}
            </div>
            <div style="font-size: 11px; color: #fbbf24; margin-top: 8px; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; animation: pulse 1.5s infinite;"></span>
              <span>Holat: Super Admin tasdig'i kutilmoqda</span>
            </div>
          </div>

          <div style="display: flex; gap: 10px;">
            <button onclick="window.requestServerActivation()" style="flex: 1; padding: 12px; border-radius: 12px; background: #38bdf8; color: #000; font-weight: 700; font-size: 12px; border: none; cursor: pointer; transition: 0.2s;">
              🚀 So'rovni Qayta Yuborish
            </button>
            <button onclick="window.checkLicenseNow()" style="padding: 12px 18px; border-radius: 12px; background: rgba(255, 255, 255, 0.1); color: #fff; font-weight: 600; font-size: 12px; border: none; cursor: pointer; transition: 0.2s;">
              🔄 Tekshirish
            </button>
          </div>
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

        <div style="display: flex; flex-direction: column; gap: 10px;">
          <a href="tel:+998952220644" style="display: block; text-decoration: none; padding: 14px; border-radius: 14px; background: #f43f5e; color: #fff; font-weight: 800; font-size: 13px; text-align: center; box-shadow: 0 4px 15px rgba(244, 63, 94, 0.4);">
            📞 Ta'minotchi: +998 95 222 06 44 / +998 99 563 45 16
          </a>
          <button onclick="window.checkLicenseNow()" style="padding: 12px; border-radius: 14px; background: rgba(255, 255, 255, 0.08); color: #d4d4d8; font-weight: 600; font-size: 12px; border: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer;">
            🔄 Litsenziyani Qayta Tekshirish
          </button>
        </div>
      </div>
    `;
  }

  window.checkLicenseNow = function () {
    checkLicenseStatus();
  };

  window.requestServerActivation = async function () {
    const clubName = prompt("Klub nomini kiriting:", "CyberArena Prime");
    if (!clubName) return;

    try {
      const res = await fetch('/api/license/request-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubName, totalPcs: 20 })
      });
      const data = await res.json();
      alert(data.message || "So'rov yuborildi!");
      checkLicenseStatus();
    } catch (err) {
      alert("Xatolik: " + err.message);
    }
  };

  // Dastlabki tekshirish va har 10 soniyada so'rov
  document.addEventListener('DOMContentLoaded', () => {
    checkLicenseStatus();
    licensePollingTimer = setInterval(checkLicenseStatus, 10000);
  });
})();
