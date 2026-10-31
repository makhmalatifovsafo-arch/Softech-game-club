// Softech Cockpit: fresh application files online, cached shell offline.
const CACHE_NAME = 'softech-cockpit-v1.0.6';
const STATIC_ASSETS = [
  '/', '/index.html', '/views/login.html', '/manifest.json', '/layout.css',
  '/views/dashboard.js', '/views/clubsList.js', '/views/clubDetail.js',
  '/views/remoteControlModal.js', '/views/billing.js', '/views/analytics.js',
  '/views/addClubModal.js', '/views/managerAccount.js', '/icons/icon-192.svg', '/icons/icon-512.svg',
  '/vendor/chart-4.4.7.js', '/vendor/tailwind-3.4.17.js'
];
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {}));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    (key.startsWith('softech-cockpit-') || key.startsWith('softech-dynamic-')) && key !== CACHE_NAME
  ).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Authentication and club controls must never fall back to cached API successes.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({
      offline: true, error: 'Internet aloqasi mavjud emas. Qayta urinib ko‘ring.'
    }), {status: 503, headers: {'Content-Type': 'application/json'}})));
    return;
  }
  if (request.method !== 'GET') return;
  const response = (async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const fresh = await fetch(request);
      if (fresh.ok) await cache.put(request, fresh.clone()).catch(() => {});
      return fresh;
    } catch {
      const saved = await cache.match(request);
      if (saved) return saved;
      if (request.mode === 'navigate') {
        const shell = await cache.match('/index.html');
        if (shell) return shell;
      }
      return new Response('Internet aloqasi mavjud emas.', {status: 503});
    }
  })();
  event.respondWith(response);
  event.waitUntil(response.then(() => {}));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
