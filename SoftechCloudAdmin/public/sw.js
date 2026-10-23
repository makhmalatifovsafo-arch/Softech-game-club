// Softech Master Cockpit — Service Worker (PWA Engine)
const CACHE_NAME = 'softech-cockpit-v1.0.0';
const DYNAMIC_CACHE = 'softech-dynamic-v1.0.0';

// Statik Shell (Offline va tezkor yuklash uchun asosiy resurslar)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/views/dashboard.js',
  '/views/clubsList.js',
  '/views/clubDetail.js',
  '/views/remoteControlModal.js',
  '/views/billing.js',
  '/views/analytics.js',
  '/views/addClubModal.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

// 1. Install Event — Statik resurslarni oldindan keshlash
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('⚡ [Service Worker] Statik App Shell keshlanmoqda...');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('⚠️ [Service Worker] Ba\'zi tashqi resurslar keshga kirmadi:', err);
      });
    })
  );
});

// 2. Activate Event — Eski versiya keshlarini tozalash
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== DYNAMIC_CACHE) {
            console.log('🧹 [Service Worker] Eski kesh tozalandi:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event — Smart Caching Strategiyalari
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Faqat HTTP va HTTPS so'rovlar
  if (!request.url.startsWith('http')) return;

  // A) API va Dinamik Ma'lumotlar uchun: NETWORK-FIRST STRATEGIYASI
  // Doim eng yangi klub ma'lumotlarini yuklaydi, agar internet o'chsa oxirgi keshdan ko'rsatadi
  if (url.pathname.startsWith('/api/') || request.headers.get('accept')?.includes('application/json')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Muvaffaqiyatli javobni dinamik keshga saqlaymiz
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          console.warn('📡 [Service Worker] Internet uzildi, oxirgi keshdan olinmoqda:', request.url);
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // Agar keshda ham bo'lmasa, offline JSON qaytaramiz
          return new Response(
            JSON.stringify({
              offline: true,
              error: "Internet aloqasi mavjud emas. Oxirgi ma'lumotlar yuklandi.",
              data: []
            }),
            {
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // B) HTML Navigatsiya va Statik App Shell: STALE-WHILE-REVALIDATE / CACHE-FIRST
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Agar tarmoq yo'q bo'lsa va HTML so'ralgan bo'lsa, asosiy index.html ni qaytaramiz
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. Update / Skip Waiting xabari
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
