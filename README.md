# 🎮 Softech Game Club Management System

**Softech Game Club** — Kompyuter klublari, internet kafelar va kiber-arenalar uchun mo'ljallangan to'liq avtomatlashtirilgan, xavfsiz va markazlashgan SaaS boshqaruv ekotizimi.

---

## 🌟 Tizim Arxitekturasi

Loyihada 3 ta asosiy mustaqil komponent mavjud:

```
Softech-game-club/
├── NetCafeServer/           # Lokal Kassa Serveri (Node.js 22.x + Standalone WPF Cockpit)
├── NetCafeClient/           # Mijoz Kompyuterlari uchun Kiosk (C# WPF .NET 8, AAA UI)
├── SoftechCloudAdmin/       # Vercel & Supabase asosidagi Mobil Super Admin PWA
├── Installers/              # Server va Client uchun avtomatlashtirilgan o'rnatuvchilar
└── SoftechUpdater/          # GitHub Releases orqali Zero-Downtime OTA Auto-Updater
```

### 1. 🖥️ NetCafeServer (Kassa Serveri)
- **Standalone Cockpit (`SoftechCockpit.exe`):** WPF .NET 8 va WebView2 asosida, qora CMD oynasisiz, Discord/Spotify kabi toza interfeys.
- **Xavfsizlik & Anti-Piracy:** WMI Hardware Fingerprinting (HWID) orqali litsenziyani mashina apparatiga bog'lash.
- **Tariflar:** Standart va VIP zonalar, daqiqabay va soatbay paketlar, bar buyurtmalari kassa bilan 100% integratsiyalashgan.
- **Avtomatik Yangilanish:** GitHub Releases manifesti (`version.json`) orqali 0 ta seans vaqtida o'zini avtomatik yangilash.

### 2. 🔒 NetCafeClient (Mijoz Kioski)
- **Buzilmas Himoya:** Windows Task Manager, Win+D, Alt+Tab, Alt+F4, Ctrl+Esc va Win tugmalarini to'liq bloklash.
- **Zamonaviy AAA Dizayn:** Balans, o'yin vaqti vidjeti, telefon raqam orqali kirish va QR-kod avtorizatsiyasi.
- **Avtomatik Blokirovka:** Vaqt tugaganda yoki Super Admin tomonidan Kill-Switch berilganda darhol bloklash.

### 3. ☁️ SoftechCloudAdmin (Super Admin & SaaS)
- **Vercel & Supabase:** Serverless PostgreSQL va jonli Realtime WebSocket kanallari.
- **Masofadan Boshqarish:** Bir marta bosish bilan klub litsenziyasini bloklash (Kill-Switch) yoki uzaytirish.
- **Telegram Bot (@softech_superadmin006_bot):** Server uzilishlari, yangilanishlar va tushumlar haqida real vaqtda xabarnomalar.

---

## 📞 Texnik Qo'llab-quvvatlash (Support)
- **Asosiy telefon:** `+998 95 222 06 44`
- **Qo'shimcha telefon:** `+998 99 563 45 16`
- **Telegram:** [@softech_superadmin006_bot](https://t.me/softech_superadmin006_bot)

---
*Copyright © 2026 Softech Cloud Systems. Barcha huquqlar himoyalangan.*

## Dasturchilar uchun

### Mobil hisobot — server o‘chiq paytda ham

- Manzil: `/mobile/`. Klub ID va super admin belgilagan menejer/administrator akkaunti ishlatiladi. Kirish va hisobot o‘qish bevosita bulut orqali; jonli buyruqlar mahalliy serverda ruxsat tekshiruvidan o‘tadi.
- Supabase SQL Editor’da `migrations/20261110_mobile_dashboard.sql` ni bajaring (oldingi mobil relay migratsiyasi ham o‘rnatilgan bo‘lishi kerak), keyin bulutni deploy va klub serverini yangilang. Faqat veb deploy serverdagi eski dasturga sinxronlash imkonini qo‘shmaydi.
- Server ishlayotganda kompyuterlar/kassa/bar va bugungi hisobot taxminan har 30 soniyada saqlanadi. Har siklda bitta tarixiy kun ham yuboriladi; avvalgi kunlar bosqichma-bosqich yuklanadi. Sinxronlash kursori qayta ishga tushirishda saqlanadi.
- Bir kun qayta yuborilsa, oldingi nusxa almashtiriladi, tushum ikki marta qo‘shilmaydi. Hisobotga kiritilmagan kunlar «qisman hisobot» deb belgilanadi. Bir so‘rovda 366 kungacha ko‘rish mumkin.
- Server o‘chiq bo‘lsa oxirgi sinxronlangan nusxa va uning vaqti ko‘rsatiladi; hali yuborilmagan operatsiyalar bulutda ko‘rinmaydi. Server uzilgani 90 soniyagacha kechikib aniqlanishi mumkin. Bu vaqtda ham jonli buyruq server tasdig‘isiz muvaffaqiyatli deb ko‘rsatilmaydi.
- Bulut nusxasi 3.4 MB dan oshsa, server uni qisman saqlamaydi; `[Mobile reports]` logida xato chiqadi. Bunday hajm uchun keyingi bosqichda kun ichidagi yozuvlarni bo‘lib sinxronlash kerak.
- Menejer moliyaviy hisobotni ko‘radi. Administrator uchun moliyaviy hisobot yopiq; kompyuter/kassa/bar ma’lumotlari mavjud. Hisobot jadvallari RLS bilan yopiq, faqat server tekshirgan klub sessiyasi orqali o‘qiladi.
- Mobil rollar: menejer — hisobot, kuzatish, tarif va xodim sozlamalari (savdo, seans, quvvat va smena o‘zgartirish API orqali ham yopiq). Administrator — seanslar, quvvat uchun berilgan ruxsat, bar savdosi/qarzi/ombori, mijoz balansi, bron, smena va amallar tarixi. Administratorga moliyaviy hisobot hamda smenaning umumiy tushumlari yuborilmaydi. Desktop ruxsatlari o‘zgarmaydi.
- Mobil savdo serverning o‘z endpointi va tranzaksiyasidan foydalanadi. Muvaffaqiyatli amaldan keyin bulut sinxronlash boshlanadi; 8 soniyada yakunlanmasa amal takrorlanmaydi, javobda `syncPending` belgilanadi va fon sinxronlashi davom etadi. Desktop savdosi ham sinxronlashni tezlashtiradi.
- Telefon interfeysini alohida tekshirish: `node tests/mobile-roles-browser.mjs` (Playwright `.tools/browser-test` ichida va Microsoft Edge o‘rnatilgan bo‘lishi kerak). Test haqiqiy mobil sahifa, shifrlangan relay va ikkala rolning UI chegaralarini tekshiradi; biznes hisob-kitoblar startup testida haqiqiy klub serveri bilan tekshiriladi.
- Tekshiruvlar: `npm test`, `node tests/mobile-dashboard-schema.mjs` (PGlite bilan). Startup testi klub jarayonini to‘xtatib, yangi menejer loginidan keyin saqlangan hisobotni ochadi va summalarni server hisobotiga solishtiradi.

- Reliz versiyasini bir joydan yangilang: `npm run version:set -- 1.0.19`. Bu barcha Node paketlari, lockfile va .NET `Directory.Build.props` versiyasini moslaydi. Keyingi reliz uchun yangi raqam kiriting.
- Push relizi `package.json` dagi versiyani ishlatadi; mavjud reliz qayta yozilmaydi. Server/bulut sahifalari ishlayotgan backend versiyasini, Windows ilovalari esa o'z assembly versiyasini ko'rsatadi.

- Node.js 22.x ishlating (release CI va cloud paketlari bilan bir xil). Versiya .nvmrc faylida ham belgilangan.
- Bulut kodi uchun asosiy manba root ichidagi src/, api/, public/, migrations/, supabase_schema.sql va vercel.json hisoblanadi.
- SoftechCloudAdmin/ mustaqil deploy uchun saqlangan nusxa. Yuqoridagi fayllarni root ichida tahrirlang, keyin npm run sync:cloud bajaring va hosil bo'lgan o'zgarishlarni ham commit qiling. Skript .env, config.json yoki bazalarni ko'chirmaydi.
- npm test avval bulut nusxalarining mosligini tekshiradi; farq bo'lsa test/release to'xtaydi. npm run check:cloud faqat tekshiradi.
- NetCafeServer/src/ ichidagi .js fayllar ishlaydigan implementatsiyadir. Eski parallel .ts implementatsiyalar olib tashlangan; types/protocol.ts protokol turlari uchun ma'lumotnoma sifatida saqlangan. TypeScript build talab qilinmaydi.
- Lokal ishga tushirish: npm ci, npm start (cloud), npm run start:server (kassa). Root .env shu start buyruqlarida yuklanadi.

- Mobil menejerning Sozlamalar bo‘limi: xona tarifi narxi/vaqti/hafta kunlari, umumiy vaqt qoidalari, VIP keyin to‘lash; mahalliy administrator yaratish, ruxsatlarini o‘zgartirish va o‘chirish. Sozlamalar jonli klub serverida saqlanadi. Yangi mahalliy xodimning logini server dasturi uchun; masofaviy akkaunt super admin panelidan belgilanadi.
