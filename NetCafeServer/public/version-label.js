(() => {
  async function refreshVersions() {
    for (const label of document.querySelectorAll('[data-app-version]')) {
      try {
        const response = await fetch(label.dataset.appVersion, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) continue;
        const data = await response.json();
        if (!/^\d+\.\d+\.\d+$/.test(data.version || '')) continue;
        label.textContent = 'v' + data.version;
        label.title = 'Ishlayotgan dastur versiyasi';
      } catch { label.title = 'Versiyani olish uchun ulanishni tekshiring'; }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshVersions);
  else refreshVersions();
  window.addEventListener('online', refreshVersions);
})();
