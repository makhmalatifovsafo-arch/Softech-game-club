# 🎮 Softech Game Club Management System

**Softech Game Club** — Kompyuter klublari, internet kafelar va kiber-arenalar uchun mo'ljallangan to'liq avtomatlashtirilgan, xavfsiz va markazlashgan SaaS boshqaruv ekotizimi.

---

## 🌟 Tizim Arxitekturasi

Loyihada 3 ta asosiy mustaqil komponent mavjud:

```
Softech-game-club/
├── NetCafeServer/           # Lokal Kassa Serveri (Node.js 24 + Standalone WPF Cockpit)
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
