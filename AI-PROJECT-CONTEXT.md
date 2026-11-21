# Softech Game Club — AI uchun loyiha qo‘llanmasi

Yangilangan sana: **2026-11-21**. Joriy manba versiyasi: **1.3.11**.
Asos bo‘lgan Git commit: `31d103d82453a68f0a0e0e2f72fac0fdd19f408a`.
Ushbu commitdan keyingi mahalliy login himoyasi o‘zgarishlari ham quyida bayon qilingan.

Bu fayl boshqa AI yoki dasturchiga Softech mahsuloti, arxitekturasi, biznes
qoidalari, ma’lumotlar oqimi, fayllari, testlari va qolgan ishlarini tushuntiradi.
Haqiqiy parollar, tokenlar, yopiq kalitlar, `.env` qiymatlari va mijozlar bazasi
kiritilmagan. Fayl bilan birga repozitoriy berilmasa, AI arxitekturani tushunishi
mumkin, ammo ko‘rmagan kodiga aniq patch yozilgan yoki xato tuzatilgan deb aytmasligi kerak.

**Holatlarni ajrating:** kodda mavjud imkoniyat, testdan o‘tgan holat, yig‘ilgan
EXE/ZIP, GitHub’da e’lon qilingan reliz va klubga o‘rnatilgan versiya — beshta
alohida narsa. Ushbu hujjat production tizimning jonli holati emas.

## 1. AI birinchi navbatda bilishi kerak bo‘lgan narsalar

1. Softech — kompyuter klublari uchun real pul, mijoz balansi, seanslar, bar va
   xodimlar bilan ishlaydigan tizim. Ishlayotgan klublar bor. Ma’lumot yo‘qotish
   yoki serverni bloklab qo‘yish haqiqiy biznes zarariga olib keladi.
2. **Mahalliy klub serveri biznes hisobining asosiy manbasi.** Client va mobil
   interfeyslar narx, qaytim va qarzni alohida formula bilan hisoblamasligi kerak.
3. Bulut barcha klublarni boshqaradi, litsenziya beradi va mobil hisobot nusxalarini
   saqlaydi. U mahalliy klub bazasining to‘liq o‘rnini bosmaydi.
4. Server ichidagi `club_id=1` bilan bulutdagi klub ID bir xil bo‘lishi shart emas.
   Mahalliy klub 1 bo‘lishi mumkin, bulutda esa boshqa IDga ega. Ularni aralashtirmang.
5. Root `src/`, `api/`, `public/` — bulutning asosiy manbasi.
   `SoftechCloudAdmin/` — skript bilan sinxronlanadigan nusxa.
6. `NetCafeServer/src/*.js` ishlaydi. Eski TypeScript server implementatsiyasi
   ishlaydigan manba emas. `types/protocol.ts` protokol ma’lumotnomasi bo‘lishi mumkin.
7. Mobil administrator va mobil menejerning vazifalari turlicha. Tugmani yashirish
   yetmaydi: server va relay ham rol/ruxsatni tekshirishi kerak.
8. Biznes amalining javobi yo‘qolsa, u bajarilmagan degani emas. Qayta yuborish
   o‘sha amalning `requestId`si bilan bo‘lishi, ikki marta pul yozmasligi kerak.
9. Yangilanishda config, litsenziya, baza, balans, seans va operatsiya tasdiqlari
   saqlanadi. Buzilgan bazani yashirish uchun yangi bo‘sh baza yaratish taqiqlanadi.
10. 2026-11-20 auditida asosiy testlar o‘tdi, ammo xavfsizlik va tarqatish bo‘yicha
    muhim ishlar qoldi. Ularni 24-bo‘limdan o‘qing; «hammasi tayyor» deb taxmin qilmang.

## 2. Mahsulot va foydalanuvchilar

Softech bir klubdagi server-kassa kompyuteri va o‘yin kompyuterlarini boshqaradi.
Egasi telefondan hisobot ko‘rishi va ruxsat etilgan sozlamalarni o‘zgartirishi
mumkin. Administrator telefondan ham kassa operatsiyalarini bajarishi mumkin.
Softech egasi esa super admin panelidan turli klublarning litsenziya va holatini boshqaradi.

| Rol | Asosiy vazifa | Muhim chegara |
| --- | --- | --- |
| Super admin | Klub yaratish, litsenziya, xodim hisobini yetkazish, diagnostika, masofaviy boshqaruv, client yangilanishlari | Boshqa klublar o‘rtasida ma’lumot va buyruq aralashmasligi kerak |
| Klub menejeri / `club_owner` / ayrim joylarda `manager` | Hisobot, statistika, tarif va xodim/ruxsat boshqaruvi | Mobil menejer seans ochmaydi, bar sotmaydi, PC quvvatini boshqarmaydi |
| Administrator | Seans, bar, mijoz balansi, ruxsat etilgan quvvat amallari | Mobil interfeysda moliyaviy hisobot va umumiy tushumlar berilmaydi |
| Mijoz / `client` | O‘z login/telefon-paroli bilan PCga kirish, balansli seans, o‘z hisobini boshqarish | Xodim yoki boshqa mijoz hisobiga kira olmaydi |
| Texnik xizmat egasi | Clientdan parolli favqulodda chiqish | Alohida favqulodda parol; menejer/mijoz paroli bilan bir narsa emas |

Desktop va mobil ruxsatlar har doim aynan bir xil emas. Haqiqiy tekshiruvlar:
`NetCafeServer/src/auth.js`, `middleware/auth.js`, `services/mobileRolePolicy.js`,
`services/mobileCloudSession.js`, bulutdagi `mobileDashboard.js` va `mobileRelay.js`.

Mahsulot interfeysi asosan o‘zbekcha. Soatlar **24 soatlik** shaklda: `13:00`,
`14:00`; AM/PM emas. Pul UZS/so‘m. Xato va holat xabarlari kassir tushunadigan tilda bo‘lishi kerak.

## 3. Umumiy arxitektura

```text
Klub ichidagi LAN
  Server kompyuteri
    Windows xizmati SoftechService
      -> Node.js backend :5000
         -> netcafe.db (SQLite, asosiy biznes bazasi)
         -> HTTP API va kassa HTML/CSS/JS
         -> WebSocket /ws
    SoftechCockpit.exe (WPF + WebView2)
      -> mahalliy HTTP kassa oynasi

  Client kompyuterlari
    NetCafeClient.exe (WPF kiosk)
      <-> WebSocket /ws <-> klub backend
      -> ekran qulfi, vaqt vidjeti, xabarlar, yangilanish

Internet
  Klub backend -> HTTPS -> Vercel api/index.js -> Supabase PostgreSQL
                   |            |
                   |            +-- litsenziya, telemetry, buyruq, relay, snapshot
                   |            +-- Telegram webhook
                   |
  Telefon PWA -----+-- /mobile/ (menejer yoki administrator)
  Super admin -----+-- / va /login
  Marketing sayti -+-- /site/ va /site/help/<mavzu>/

  Alohida doimiy Node jarayoni: scripts/live-hub.mjs
    -> WebSocket orqali «yangi ish / natija / ma’lumot bor» signali
    -> biznes amali va moliyaviy natija baribir tekshirilgan API orqali

  GitHub Releases
    -> version.json -> SoftechServer.zip / SoftechClient.zip
    -> SoftechUpdater -> tekshirish, almashtirish, qabul qilish yoki rollback
```

Bu mikroservislarga to‘liq bo‘lingan tizim emas: mahalliy serverda katta bitta HTTP
router va bir nechta xizmat modullari bor. Bulutda ham bir Vercel API entrypointi
ko‘p marshrutlarni xizmat qiladi. Faqat UI o‘zgargani uchun hisoblashni yangi joyga ko‘chirmang.

## 4. Texnologiyalar

| Qism | Texnologiya |
| --- | --- |
| Mahalliy backend | JavaScript ES Modules, Node.js 22.x, native `http`, `ws` |
| Mahalliy baza | Node `node:sqlite` / `DatabaseSync`, SQLite WAL |
| Windows ilovalari | C#, .NET 8, WPF, XAML, Windows API integratsiyasi |
| Kassa shell | WPF + Microsoft WebView2 |
| Windows xizmati | .NET Windows service, `ServiceBase`, backend lifecycle |
| Veb UI | HTML, CSS, browser JavaScript; mavjud asosiy ilovalar React/Next.js emas |
| Bulut API | Node.js serverless, Vercel catch-all rewrite |
| Bulut bazasi | Supabase PostgreSQL, `@supabase/supabase-js`, SQL migratsiyalar |
| Lokal bulut/test | `src/local-server.js`, `src/db/` ichidagi SQLite adapter |
| Mobil ilova | PWA: manifest, service worker, rolga mos veb interfeys |
| Jonli signal | Alohida Node WebSocket hub; polling zaxira mexanizmi |
| Avtomatik test | Node test runner, PGlite, C# test dasturlari, Playwright/Edge |
| Build/deploy | PowerShell, `dotnet publish`, GitHub Actions, GitHub Releases |

Node 22 ishlatish muhim: `node:sqlite` imkoniyatlari va CI runtime shu asosda.
Ba’zi eski hujjatlarda Node 24 yoki eski test sonlari uchraydi; joriy `package.json`,
`.nvmrc`, workflow va test natijalari bilan solishtiring. SQLite haqidagi
`ExperimentalWarning`ning o‘zi test muvaffaqiyatsiz bo‘lganini anglatmaydi.

## 5. Repozitoriy xaritasi va asosiy manba qoidasi

```text
api/index.js                         Vercel uchun markaziy API
src/local-server.js                  Lokal bulut serveri
src/services/                        Bulut biznes xizmatlari
src/db/                              Lokal bulut SQLite adapteri/sxemasi
src/routes/, src/middleware/          Bulut autentifikatsiya/telemetry qismlari
src/utils/jwt.js                     Super admin tokenlari
public/index.html, public/views/     Super admin UI
public/mobile/                       Klub PWA
public/site/                         Hosil qilinadigan marketing/help sayt nusxasi
website/softech/dist/                Sayt statik manbasi
supabase_schema.sql                  Bulut bazasining boshlang‘ich sxemasi
migrations/                         Bulut SQL o‘zgarishlari
vercel.json                         API rewrite va statik sahifa yo‘llari
SoftechCloudAdmin/                   Root bulut kodining boshqariladigan nusxasi

NetCafeServer/src/server.js          Klub HTTP API, WS, startup va servis ulanishi
NetCafeServer/src/db.js              Klub DB init va migratsiyalar
NetCafeServer/schema.sql             Boshlang‘ich lokal sxema
NetCafeServer/src/auth.js            Mahalliy login, token va ruxsatlar
NetCafeServer/src/handlers/          Client protokoli
NetCafeServer/src/services/          Narx, seans, bar, hisobot, mobil, OTA, tiklash
NetCafeServer/src/emergency-server.js Favqulodda vaqtli seans rejimi
NetCafeServer/public/                Kassa sahifalari va frontend modullari
NetCafeServer/Launcher/              SoftechCockpit WPF/WebView2 oynasi
NetCafeServer/Service/               SoftechService Windows xizmati

NetCafeClient/                      Client WPF kiosk va yangilovchi integratsiyasi
SoftechUpdater/                     Alohida Windows yangilash yordamchisi
Shared/Updates/                    Updater/service/rollback umumiy qismlari
Shared/Security/                   Favqulodda parol himoyasi
Shared/Networking/                 Server manzilini talqin qilish
Shared/Branding/                   Logo resurslari va Manrope shriftlari
Installers/ServerSetup/            Server o‘rnatuvchi
Installers/ClientSetup/            Client o‘rnatuvchi
Directory.Build.props              .NET versiyalari
RELEASE-NOTES.txt                   Reliz o‘zgarishlari
scripts/                           Sinxronlash, versiya, paket, live hub, support
tests/                             Node/C#/browser integratsiya va regressiyalar
docs/                              Barqarorlik, lifecycle, live va onboarding rejalari
.github/workflows/release.yml      Build, tekshiruv va e’lon qilish pipeline’i
Releases/vX.Y.Z/                   Mahalliy yig‘ilgan EXE/ZIP/manifest; Git manbasi emas
.tools/, .test-output/             Mahalliy yordamchi vositalar va ajratilgan sinovlar
```

Bulut nusxasini qo‘lda parallel rivojlantirmang. `scripts/sync-cloud.mjs` rootdagi
`src`, `api`, `public`, `migrations`, `supabase_schema.sql`, `vercel.json`ni
`SoftechCloudAdmin/`ga ko‘chiradi. `npm run check:cloud` farqni xato deb hisoblaydi.
Skript `.env`, haqiqiy bazalar va install configlarini ko‘chirmaydi.

`scripts/sync-website.mjs` saytni `website/softech/dist`dan `public/site`ga,
belgi va shriftlarni tegishli native/kassa papkalariga olib o‘tadi. Hosil qilingan
nusxani tahrirlash bilan cheklanilsa, keyingi sinxronlash o‘zgarishni yo‘qotishi mumkin.

## 6. Ma’lumotlar bazalari va egalik

### 6.1 Mahalliy klub bazasi

Asosiy fayl `NetCafeServer/netcafe.db`; o‘rnatilgan nusxada serverning o‘z ildizida.
Yo‘l `NetCafeServer/src/db.js` joylashuviga nisbatan aniqlanadi, tasodifiy terminal cwd’siga emas.
`PRAGMA journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`.

| Jadval/guruh | Ma’nosi |
| --- | --- |
| `clubs` | Lokal klub sozlamalari va holati |
| `users`, `auth_sessions` | Xodim/mijoz, balans, rol, parol xeshi, saqlanuvchi login sessiyasi |
| `computers` | Haqiqiy PC, xona, raqam, IP/MAC, holat, joriy seans |
| `zones`, `grid_layout` | Xona va xarita geometriyasi |
| `tariffs`, `tariff_schedules`, `club_settings` | Narx, vaqt/hafta qoidalari, VIP va klub sozlamalari |
| `sessions` | Boshlanish/tugash, to‘lov, mijoz, prepaid reja, postpaid davomiylik |
| `transactions`, `client_transactions` | Pul yozuvlari; mijoz balansi alohida |
| `bar_items`, `bar_orders`, `bar_order_items` | Ombor, sotuv, mahsulotlar, seansga biriktirilgan qarz |
| `audit_logs` | Amallar tarixi, tushunarli ko‘rsatish uchun audit dalillari |
| `session_end_notices` | Seans oxirida ko‘rsatiladigan va keyin olinadigan qarz/xabarlar |
| `money_operation_receipts` | Moliyaviy amalning takror yuborilishiga qarshi saqlangan natija |
| Setup/transfer/mobile yordamchi jadvallar | Qoralama, tayyorlik, tarix, mobil buyruq natijalari |
| `shifts`, `bookings`, ayrim eski `orders` tuzilmalari | Tarixiy yoki hozir UI’da cheklangan imkoniyatlar; ko‘rinmasligi o‘chirishga ruxsat emas |

Bu jadval ro‘yxati sxemaning o‘rnini bosmaydi. Yangi ustunlar va yordamchi jadvallar
`db.js` hamda xizmatlarning init funksiyalarida ham yaratiladi. Faqat `schema.sql`ni
o‘qish mavjud bazaning to‘liq holatini bermaydi.

### 6.2 Bulut PostgreSQL bazasi

Muhim jadvallar: `super_admins`, `clubs`, `club_metrics`, `club_workstations_cache`,
`remote_commands`, `subscription_payments`, `mobile_agents`, `mobile_requests`,
`mobile_dashboard_data`, `mobile_dashboard_sessions`, `mobile_dashboard_limits`,
`club_server_diagnostics`.

`clubs.id` — barcha klublar orasidagi bulut identifikatori. Klub so‘rovining tenantini
shunchaki body/query’dagi IDdan ishonib olmang; autentifikatsiya/litsenziya bilan bog‘lang.
RLS va public/anon/authenticated huquqlari cheklangan. `service_role` kaliti faqat
ishonchli bulut backendda bo‘lishi kerak, browser yoki client distributivida emas.

Lokal bulut `softech_cloud.db`dan foydalanishi mumkin; `SOFTECH_CLOUD_DATA_DIR`
uni ajratishga xizmat qiladi. Vercel’dagi vaqtinchalik SQLite fallback mavjudligi
uni doimiy production baza qiladi degani emas. Production ma’lumotlar uchun
Supabase adapteri va SQL sxemasi tayyor bo‘lishi kerak.

### 6.3 Migratsiyalar

| Fayl | Vazifa |
| --- | --- |
| `migrations/20261031_activation_hwid.sql` | Dastlabki HWID sxemasi |
| `migrations/20261031_cloud_audit.sql` | Bulut audit/billing/RLS o‘zgarishlari |
| `migrations/20261031_mobile_relay.sql` | Mobil agent va buyruqlar navbati |
| `migrations/20261110_activation_hwid_unique.sql` | Telegram aktivatsiyasidagi ON CONFLICT uchun to‘liq unique HWID indeksi |
| `migrations/20261110_mobile_dashboard.sql` | Saqlanuvchi mobil hisobot, sessiya, login limit va SQL funksiyalar |
| `migrations/20261113_server_diagnostics.sql` | Server diagnostikasi |
| `migrations/20261114_client_fleet.sql` | Client versiya/update holati, buyruq va receipt ma’lumotlari |

Git push SQL’ni Supabase’da avtomatik bajarildi degani emas. Migratsiyani qo‘llash
alohida boshqariladigan amal. HWID takror bo‘lsa, unique migratsiya to‘xtaydi va
klublarni o‘zi o‘chirmaydi; tekshiruvni chetlab o‘tish o‘rniga dublikat sababini aniqlang.
`private-cloud-admin.sql` kabi shaxsiy provisioning faylini public hujjat/paketga
ko‘chirmang. Bazada bajarilgan SQL ta’siri fayl Git’da bo‘lishiga bog‘liq emas.

## 7. Narx va seanslar qanday ishlaydi

Asosiy modullar:

- `pricingEngine.js`: vaqt oralig‘i, faol xona tarifi, summa/vaqt hisoblash.
- `prepaidQuote.js`: bitta/guruh/mobil seans uchun umumiy quote va mode validatsiyasi.
- `tariffValidation.js`, `roomTariffs.js`: tarif vaqtlarini tekshirish va saqlash.
- `clientSessionState.js`: serverdan yuboriladigan seans va postpaid hisob holati.
- `sessionScheduler.js`: tugash, yakuniy hisob, clientga xabar va saqlash.
- `memberBilling.js`: mijoz balansidan seans, saqlangan narx rejasi, qaytim.
- `sessionMode.js`: seans turini bir xil talqin qilish; UI matniga qarab aniqlamang.

### 7.1 Oldindan to‘langan seans

Uch asosiy usul bor:

1. **Summa bo‘yicha.** Berilgan byudjetga tarif bo‘yicha vaqt ajratiladi. Soati
   7000 bo‘lsa, 10000 so‘m taxminan 85.7142857 daqiqa: 1 soat 25 daqiqa 42.86 soniya.
   «1 soat 25 daqiqa» qisqa matn bo‘lishi mumkin, hisob vaqtini shunchaki 85 daqiqaga qirqmang.
2. **Davomiylik bo‘yicha.** Soat yoki daqiqa kiritiladi; `durationMinutes` bo‘lsa
   quote uni soatga aylantiradi. Masalan 90 daqiqa — 1.5 soat.
3. **Tugash vaqti bo‘yicha.** Aynan bu rejimda boshlanish sekundlari nol qilinadi.
   12:38 dan 13:38 gacha, soati 7000 bo‘lsa, 7000 chiqishi kerak. O‘tib ketgan
   tugash vaqti yashirincha ertangi kunga aylantirilmaydi.

Dinamik tarif vaqt davomida almashsa, kerakli bo‘laklar hisobga olinadi.
Qoplamagan vaqt oralig‘ini boshqa xona tarifi yoki tasodifiy standart narx bilan
to‘ldirmang. Quote xatoni aniq bildirishi kerak. Yangi seans yangi tarifni oladi;
oldin sotilgan prepaid vaqtning qaytimi keyingi tarif tahriridan o‘zgarmasligi kerak.

### 7.2 VIP Postpaid

Mijoz oldindan vaqt sotib olmaydi; ishlagan vaqt bo‘yicha qarz yig‘iladi va kassir
yopganda yakunlanadi. Server hisoblagan `gameAmount` asosiy manba. Barga mahsulot
qo‘shilganida PC vaqti narxi yo‘qolib, faqat bar summasi ko‘rinmasligi kerak.

VIP uchun «+ vaqt» menyusi bo‘lmaydi. VIP ochish ruxsati o‘chirilsa, saqlash tugmasi
ishlashda davom etadi va yangi VIP seans API’da ham rad etiladi. Allaqachon ochilgan
seansni qanday tugatish — alohida biznes holati; sozlamani o‘chirish uni yo‘qotmasin.

### 7.3 Mijoz balansidan seans

`startMemberSession` haqiqiy mijozni tekshiradi, yetarli balansni atomar kamaytiradi,
seans va `SESSION_DEDUCT` yozuvini birga saqlaydi. Balans va seans ID o‘sha mijozga
tegishli qoladi. Self-service orqali boshlangan seans bilan kassir ochgan seansni
ajrating: client o‘zi yopish ruxsati `canSelfClose`/seans kelib chiqishiga bog‘liq.

Login/parol o‘zgartirish: `customerCredentials.js`, client
`Views/AccountSettingsWindow.xaml*`, serverdagi Mijozlar/Top-up boshqaruvi.
Login o‘zgarsa yangi mijoz/balans yaratilmaydi; o‘sha hisob identifikatori saqlanadi.

### 7.4 Oldindan yopish, bar va qaytim

**Asosiy katta raqam — hozir mijozdan olinadigan yoki unga qaytariladigan summa.**
Uni jami xizmat narxi bilan aralashtirmang.

Soddalashtirilgan misol: faqat oldindan to‘langan o‘yin va hali to‘lanmagan bar bor:

```text
o‘yin uchun qoladigan tushum = haqiqatan ishlatilgan vaqt narxi
o‘yin qaytimi = oldindan to‘langan o‘yin puli - ishlatilgan vaqt narxi
hozir olinadigan summa = to‘lanmagan bar qarzi - o‘yin qaytimi
```

Musbat natija — olinadi; manfiy natija — qaytariladi; nol — qo‘shimcha to‘lov yo‘q.
Bu faqat tushuntirish formulasi: haqiqiy kodda CASH/CARD/BALANCE, oldin to‘langan
bar, oldingi qaytimlar va takror checkout yozuvlarini ham hisobga olish zarur.

| Soati 10 000, oldindan 10 000, bar qarzi 5000 | O‘yin tushumi | Bar | Hozir olinadi |
| --- | ---: | ---: | ---: |
| 30 daqiqada yopish | 5000 | 5000 | 0 |
| 50 daqiqada yopish | 8333 | 5000 | 3333 |

Bular maxsus 30/50 daqiqalik shartlar emas: istalgan summa, tarif va davomiylikka
umumiy algoritm qo‘llanadi. Yakuniy yaxlitlashni turli UI’larda takrorlamang.

Manbalar: `sessionBarDebt.js`, `barLedgerService.js`, `sessionScheduler.js`,
`memberBilling.js`, `netSessionReceipts.js`, `financialBreakdown.js`,
mobil `checkout-view.js` va client `MemberSessionSummary.cs`.

## 8. Bar savdosi, balans va takror so‘rov himoyasi

Barni alohida sotish yoki faol PC/seans hisobiga qo‘shish mumkin. Ombor soni,
mahsulotlar, to‘lov kanali, hali to‘lanmagan qarz va seans bilan bog‘lanish birga
saqlanadi. Mahsulotni PCga qo‘shish har doim naqd pul olindi degani emas.

`clientBarOrders.js` mijoz buyurtmasini xodim tasdiqlash/qarzni undirish oqimlari
bilan bog‘laydi. `barLedgerService.js` ledger hisobini yuritadi. Eski qarzni undirish
yangi seansni yopmasligi yoki o‘yin pulini yana olmasligi kerak.

Top-up — mijoz balansini to‘ldirish. Hisobotda balansga tushgan pul bilan keyin
o‘ynab ishlatilgan pulni ikki marta umumiy daromad deb qo‘shmang.

`moneyOperations.js` va frontend `money-requests.js`:

- Har yangi moliyaviy amal uchun `requestId`.
- Shu amal qayta yuborilsa, saqlangan natija qaytariladi.
- Receipt kaliti klub + operatsiya + request IDga bog‘langan.
- Actor va payload fingerprint mos kelmasa konflikt.
- Pul, ombor va receipt bitta tranzaksiyada commit bo‘ladi.
- Balans qaytadan to‘ldirilganda bu yangi amal va yangi ID. Oldin sarflab bo‘lingan
  10000dan keyin yangi 10000 qo‘shilsa, balans 10000 bo‘ladi.
- Receipti o‘chirib yuborish eski so‘rovni qayta moliyaviy amal qilib qo‘yishi
  mumkin. Diskni tozalash bahonasida bularni avtomatik o‘chirmang.
- Eski clientlar bilan moslik uchun ayrim yo‘llarda ID yo‘qligi qabul qilinadi;
  bu yo‘l yangilangan UI’dagidek takror so‘rov kafolatini bermaydi.

## 9. Seansni boshqa kompyuterga ko‘chirish

Manbalar: `sessionTransfer.js`, `prepaidTransferPlan.js`, `sessionTransferHistory.js`.

VIP: oldingi PCda yig‘ilgan summa saqlanadi; ko‘chganidan keyingi vaqt yangi
xona narxida hisoblanadi. Masalan 5320 so‘m qarz yo‘qolmaydi, yangi PCda undan davom etadi.

Prepaid: qolgan vaqtning **pul qiymati** saqlanib, yangi tarifga aylantiriladi.
7000/soat tarifida 30 daqiqa qoldi = 3500 so‘m; 14000/soat xonada 15 daqiqa.
Ko‘chirish oldidan eski/yangi vaqt va tarif ko‘rsatiladi, o‘zgarish tasdiqlanadi.
`quoteRevision` eskirgan taklif bo‘yicha ko‘chirishni to‘sadi.

Bar qarzi seans/mijoz bilan ko‘chadi, eski PCga kelgan yangi mijozga qolmaydi.
Faol seansli nishon, tarif xatosi yoki yozish xatosida hammasi rollback bo‘ladi.
Statistikada oldingi ishlatilgan vaqt/tushum birinchi PCga, keyingi qism ikkinchisiga
tegishli bo‘lishi kerak; hammasini yakuniy PCga yozish noto‘g‘ri.

## 10. Hisobot, statistika va audit bir xil narsa emas

| Ko‘rinish | Vazifa |
| --- | --- |
| Moliyaviy hisobot | Saqlangan to‘lov, ishlatilgan balans, bar, qaytim va kanallar bo‘yicha hisob |
| Statistika | Vaqt oralig‘i, PC foydalanishi, taqsimot va tahlil |
| Amallar tarixi | Kim nima qilgan, boshlang‘ich to‘lov, qaytim va o‘zgarish dalillari |
| Mobil snapshot | Serverdan oxirgi sinxronlangan hisobot/holat nusxasi |

Foydalanuvchining muhim qoidasi: 10000lik seansdan 6000 qaytim berilgan bo‘lsa,
hisobotdagi o‘yin tushumi **4000**. Dastlabki 10000 audit tarixida turishi mumkin,
ammo daromad qatoriga yana 10000 qilib chiqmasin. Seans va balans to‘ldirish
alohida ko‘rsatiladi. Keyingi kuni berilgan qaytim asl to‘lov kuni hisobotiga ham
to‘g‘ri ta’sir qilishi va u kun bulutga qayta yuborilishi kerak.

`PC-0` kabi eski xarita/placeholder yozuvlari haqiqiy kompyuter yoki foydalanish
statistikasi sifatida sanalmasligi kerak. **Litsenziyadagi maksimal PC soni**, bazada
ro‘yxatdan o‘tgan haqiqiy PC soni va ayni paytda online PC soni — alohida ko‘rsatkichlar.

Statistika `analyticsCache.js` orqali `analyticsWorker.js`da hisoblanadi.
Bu **Node worker thread**, alohida Windows xizmati yoki mutlaqo mustaqil OS jarayoni emas.
Worker bazani read-only ochadi, `query_only` va transaction bilan izchil nusxa o‘qiydi;
`db.js`ni import qilib migratsiya yoki yangi baza yaratmasligi kerak.

Joriy cache sozlamalari: 5 soniya TTL, 8 tagacha natija, 30 soniya hisoblash timeouti,
worker uchun 192 MB old-generation limiti. Eski tayyor natija ko‘rinib, yangisi
fonda tayyorlanishi mumkin; UI `generatedAt`, `refreshing`, `stale`, xatoni ko‘rsatadi.
Moliya yozish/statistika o‘qish bir-birining hisobini o‘zgartirmaydi.

## 11. Desktop interfeyslarining umumiy mexanizmi

Klassik Grid, Jadval va 2D xarita bitta backenddagi PC/seanslarni ko‘rsatadi.
Ularning alohida billing mexanizmi bo‘lmasligi kerak. Kartochka menyulari orqali
seans, bar, xabar, quvvat amallari bir xil endpointlarga boradi.

O‘chiq PC uchun asosiy tugma «Seans ochish». Server zarur bo‘lsa WoL orqali yoqishga
urinadi. Seanssiz yoqish, o‘chirish, qayta ishga tushirish, xabar va bar qo‘shish
kontekst menyusida bo‘lishi mumkin. WoL uchun to‘g‘ri MAC, LAN va kompyuterning
apparat/BIOS/tarmoq quvvat sozlamalari kerak; faqat IP yetmaydi.

PC holati faqat seansga qarab aniqlanmaydi: uzilgan PCda faol seans bo‘lishi mumkin.
Hech ulanmagan PCni «online» deb ko‘rsatmang. Shared UI modeli `computer-state.js`
nusxalarida; ularning mosligini testlar nazorat qiladi.

Asosiy frontend `NetCafeServer/public/index.html`, `app.js`, `style.css` va xizmat
modullarida. Katta inline JS yoki HTMLga tahrir kiritganda sintaksis, fokus, scroll,
selection va qo‘shni kartochka amallariga ta’sirini tekshiring.

## 12. Client kiosk va protokol

Client faol shell/o‘yin launcherini almashtirish uchun emas. Hozirgi mahsulot rejimi:

- Seans yo‘q: chiroyli qulflangan ekran, login/telefon va parol.
- Kassir ochsa yoki mijoz o‘z hisobiga kirsa: qulf olinadi; mavjud Windows desktop
  yoki RunPad kabi shell ko‘rinadi. Ichki o‘yin katalogini majburan ochish yo‘q.
- Vaqt va pul kichik vidjetda. Fullscreen o‘yin holati alohida ishlangan;
  har bir o‘yindagi natijani test qilmasdan mutlaq kafolat bermang.
- Seans tugasa: serverning yakuniy hisobi/xabari ko‘rsatiladi va ekran qulflanadi.
- VIP/bar qarzi xabari: mahsulot va kassaga to‘lanadigan summa, 8 soniyali ko‘rsatish;
  bir xil paket takror kelishi oynani cheksiz qaytarmasligi kerak.
- Server xabari: `SEND_MESSAGE`, ko‘rsatilish tasdig‘i `MESSAGE_DISPLAYED`.

Muhim fayllar: `App.xaml.cs`, `LockWindow.xaml*`, `WebSocketClientService.cs`,
`TimeWidgetWindow.xaml*`, `SessionInfo.cs`, `DisplayLockManager.cs`,
`Views/AdminMessageWindow.cs`, `MemberSessionSummary.cs`,
`EmergencyAccessGuard.cs`, `Services/AutoUpdateService.cs`.

### 12.1 WebSocket xabarlari

| Yo‘nalish | Xabarlar misoli |
| --- | --- |
| Client -> server | `CLIENT_HELLO` / `CLIENT_HANDSHAKE`, heartbeat, `CLIENT_MEMBER_LOGIN`, `CLIENT_MEMBER_LOGOUT`, `CLIENT_ACCOUNT_UPDATE`, `CLIENT_BAR_ORDER`, `MESSAGE_DISPLAYED` |
| Server -> client | `HANDSHAKE_ACK`, `CONFIG_UPDATE`, `START_SESSION`, `UPDATE_TIME`, `SESSION_INFO`, `STOP_SESSION`, `LOCK_SCREEN`, `SEND_MESSAGE`, `POWER_COMMAND`, `EMERGENCY_LOCKDOWN` |

Bu to‘liq wire schema emas. Payload, alias va qo‘shimcha update xabarlari uchun
`protocolDispatcher.js`, `clientManager.js`, `WebSocketClientService.cs` hamda
`tests/ClientProtocol/Program.cs`ni birgalikda o‘qing. Eski versiyaga mos parserlar
bor; ularni yangilashda server va client bir kunda yangilanmasligi mumkinligini hisobga oling.

Seans ID va authoritative vaqt eski paket yangi seansni to‘xtatmasligi uchun muhim.
Kelgan har bir `STOP_SESSION`ni ko‘r-ko‘rona joriy seansga qo‘llamang.

### 12.2 Kiosk xavfsizlik chegarasi

Alt+F4, Alt+Tab, Windows tugmalari va ayrim shortcutlar hook/siyosatlar bilan
cheklanadi. **Windows 10/11 Pro’da oddiy WPF dasturi Ctrl+Alt+Del’ni to‘liq tutib
qololmaydi.** Windows administratoridan mutlaq himoya bor deb aytmang. Mijoz uchun
oddiy Windows akkaunti va dastur papkasiga cheklangan yozish huquqi kerak.

Favqulodda texnik chiqish alohida parol bilan ishlaydi; qayta o‘rnatishda ham
mavjud himoyani chetlab o‘tmaslik kerak. `Shared/Security/EmergencyPassword.cs`
tasodifiy salt va PBKDF2-SHA256 600000 iteratsiyali tekshiruv qiymatini saqlaydi.
Client Setupda kamida 8 belgili parol beriladi; tayyor universal parol yo‘q.
Akkaunt paroli, litsenziya kaliti va kiosk favqulodda paroli boshqa-boshqa narsalar.

## 13. Mobil PWA va sinxronlash

`public/mobile/` — iOS/Android browser/PWA. Alohida native APK/IPA emas.
`app.js`, `operator-tools.js`, `manager-tools.js`, `report-view.js`,
`checkout-view.js`, `live.js`, `crypto.js`, `sw.js`, manifest va CSS asosiy qismlar.

### 13.1 Kirish va sessiya

Klub ID + super admin belgilagan menejer yoki administrator akkaunti.
Bulutdagi `mobileDashboard.js` uzoq muddatli login sessiyasini boshqaradi:
joriy lifetime 90 kun, renew oynasi 89 kun. Rol va akkaunt revisioni tekshiriladi;
parol/akkaunt o‘zgarsa eski ruxsat bekor qilinishi mumkin. Bu abadiy login degani emas.

Mahalliy kassaning tokeni alohida: `auth.js`da 24 soatlik sessiya, xeshi SQLite’da.
Server restarti har safar avtomatik logout qilmasligi uchun saqlanadi.
Bulut mobil grantining muddati qisqa (joriy kodda 2 daqiqa), club/HWID/rol/revisionga bog‘langan.

### 13.2 Hisobot o‘qish oqimi

```text
Klubdagi yozilgan biznes ma’lumot
  -> MobileSnapshotSync
  -> bulut dashboard/sync
  -> mobile_dashboard_data
  -> menejer telefonidagi hisobot
```

Server o‘chiq yoki internet yo‘q paytda telefon oxirgi saqlangan nusxani ko‘rsatadi.
Oxirgi yangilangan vaqt, eskirgan/qisman holat to‘g‘ri ko‘rinishi kerak. Bulut hali
olmagan bugungi savdoni telefon «jonli» qilib ko‘rsata olmaydi.

Kunlik snapshot qayta yuborilganda oldingi nusxa almashtiriladi, summasi yana
qo‘shilmaydi. Eski captured_at yangi nusxani bosmasligi kerak. Tarixiy kunlar
bosqichma-bosqich yuboriladi. `accountingVersion` eski/yangi hisob formatini ajratadi.

### 13.3 Mobil amal bajarish oqimi

```text
Administrator telefonda seans/bar/quvvat amalini tanlaydi
 -> oldindan server quote (kerak bo‘lsa)
 -> rolga mos so‘rov, unique ID va shifrlangan payload
 -> bulut mobile_requests navbati
 -> klub MobileAgent so‘rovni oladi
 -> ruxsat, muddat va oldin bajarilgan-bajarilmaganini tekshiradi
 -> localhostdagi shu server HTTP endpointini chaqiradi
 -> haqiqiy DB tranzaksiyasi
 -> saqlangan javob/receipt -> bulut -> telefon
 -> snapshot yangilanadi
```

Relay shifrlashi: RSA-OAEP/SHA-256 bilan AES kalitini o‘rash, AES-GCM bilan payload;
AAD club ID va request IDga bog‘langan. Bu transportdagi maxfiylik mexanizmini
butun tizim xavfsizlik auditi o‘tdi degan xulosa bilan tenglashtirmang.

Asosiy manbalar: bulut `mobileRelay.js`, `mobileDashboard.js`; mahalliy
`mobileAgent.js`, `mobileCrypto.js`, `mobileCloudSession.js`, `mobileRolePolicy.js`,
`mobileSnapshotSync.js`.

Moliyaviy amal muvaffaqiyatli yozilib, snapshot 8 soniyada tugamasa `syncPending`
bo‘lishi mumkin. Bu «yana pul yoz» degani emas. UI pending/unknown/success/errorni
ajratsin; server tasdig‘isiz «bajarildi» demasin.

### 13.4 Jonli signal va polling

`scripts/live-hub.mjs` alohida doimiy hostda ishlaydi. Vercel API bilan bir
serverless funksiya ichiga joylangan doimiy WebSocket server deb o‘ylamang.
Hub faqat `jobs`, `data`, `result` uyg‘otish signallarini uzatadi; pul va buyruqlar
tekshirilgan API’da qoladi. Ticketlar club/rolga bog‘langan va qisqa muddatli.

`SOFTECH_LIVE_URL`, `SOFTECH_LIVE_NOTIFY_URL`, `SOFTECH_LIVE_SECRET` sozlanadi;
`docs/LIVE-CONNECTION.md`da deployment tartibi bor. Hub o‘chsa polling qoladi.
Joriy agent bo‘sh paytda ham har 5 soniyadan keyin poll qiladi; faol ishlarda tezroq.
Periodic snapshot taxminan 30 soniya, muvaffaqiyatli amallar qo‘shimcha flush qiladi.
«Har bir o‘zgarish doim 0 msda barcha telefonlarda ko‘rinadi» degan kafolat yo‘q.

## 14. Super admin, litsenziya va Telegram

Bulut entrypointi `api/index.js`; xizmatlar `src/services/`da.

Aktivatsiya ikki yo‘l bilan: super admin bergan klub kaliti yoki Telegramga so‘rov.
So‘rov HWID bilan bog‘lanadi. Telegram callback tasdiqlaganda bulut holati/litsenziya
yangilanadi; mahalliy server keyingi tekshiruvda tasdiqni olib saqlaydi.
Tugmada loading qolishi server yoki Telegram callback natijasi yetib kelmaganini
anglatishi mumkin; uning o‘zi litsenziya berildi degani emas.

Muhim modullar:

- `cloudActivationService.js`: cloud aktivatsiya/approval va litsenziya imzosi.
- `supabaseClient.js`: production bulut storage va telemetry.
- `telegramBot.js`: yuborish va callback.
- `managerAccountService.js`, `staffAccountSync.js`: xodim provisioning/revision/delivery.
- `remoteControl.js`, `commandDelivery.js`: masofaviy buyruq va natija.
- `serverDiagnostics.js`, `clubInspector.js`, `financialTelemetry.js`: holat va hisobot.
- Mahalliy `licenseManager.js`, `cloudLicenseService.js`, `hwidService.js`:
  imzo, qurilma, muddati, offline lease va bloklash.

Super admin klubni bloklashi, uzaytirishi, xabar yuborishi va ruxsatli masofaviy
yangilash/restart amallarini boshqarishi mumkin. Buyruq yuborildi, server qabul
qildi, bajarildi, yangi versiya bilan qayta ulandi — bular alohida holatlar.

Internet yo‘qligi uchun mahalliy litsenziya offline lease’i bor (joriy siyosat
72 soat). Bu istalgan bloklangan klubga 72 soat ruxsat beradi degani emas:
saqlangan ban, muddati tugash, imzo yoki soatni orqaga surish tekshiruvlari qoladi.

Telegram webhook secret — bot tokeni emas. Vercel environment va webhook sozlashdagi
qiymat bir xil bo‘lishi kerak. `scripts/telegram-webhook.mjs` diagnostika/sozlashni
bajaradi. `getWebhookInfo`dagi oldingi `lastError` yangi muvaffaqiyatli probe’dan
keyin ham tarixiy qiymat bo‘lib turishi mumkin; joriy HTTP natijasini ham tekshiring.

## 15. Client fleet va versiyalar

Fleet maqsadi: har bir real PCning client versiyasi, ulanishi, update holati,
nishon versiya, xato sababi, buyruq ID va yakuniy tasdiqni ko‘rsatish.
Ma’lumot client handshake/heartbeat -> klub serveri -> cloud workstation cache
orqali boradi. Server versiyasini barcha clientlarning versiyasi deb ko‘rsatmang.

Force update bilan oddiy update bir xil xavfsizlik shartlariga ega emas:
oddiy update faol seans/ish borligini kutadi; qo‘lda berilgan majburiy amal bunga
istisno bo‘lishi mumkin. Paket butunligi, manba/yo‘l tekshiruvi va yozuvlarni
yakunlash himoyasi majburiy amalda ham saqlanishi kerak.

Server yangi, client eski bo‘lsa imkoniyatlar protokolga bog‘liq. Faqat raqamlar
turlicha ekanidan «hammasi buziladi» yoki «to‘liq mos» deb aytmang. Kerakli
capability/versiya, eski client xabar parseri va yakuniy receiptni tekshiring.

## 16. Windows xizmati, launcher va nosozlikdan tiklash

`SoftechService` backendni kassa oynasidan mustaqil yuritadi.
`NetCafeServer/Service/BackendHost.cs` worker kuzatuvi, startup/retry, health,
diagnostika va tegishli fallbacklarni boshqaradi. `Program.cs` service entrypointi.
Launcher `NodeProcessManager.cs` va recovery/diagnostics orqali to‘g‘ri backendga ulanadi.

Kassa oynasini yopish backendni tasodifan o‘chirmasligi kerak. Port band bo‘lsa,
nomi `node.exe` bo‘lgan istalgan jarayonni o‘ldirish mumkin emas. Yagona server
qulfi va haqiqiy PID/executable/SCM dalillari ishlatiladi.

`/api/health` javobi ishlayotgan jarayonni aniqlashga yordam beradi. Yangilash
tekshiruvida health mavjudligi savdo ochiq degani emas: `updatePending` ham muhim.
Loglarni UTF-8 yozish/o‘qish talab qilinadi; buzilgan o‘zbek matni asl xatoni yashirishi mumkin.

### 16.1 Buzilgan config va baza

Oldingi haqiqiy hodisada bir klubning `config.json` fayli 99 ta NUL baytga aylangan;
eski JSON parse startupni to‘xtatgan. Bu baytlarni aynan qaysi qurilma yoki jarayon
hosil qilgani tasdiqlanmagan. Boshqa klub dasturi yoki eski client versiyasi sabab
bo‘lgan deb dalilsiz aytmang.

`durableJson.js`, `serverConfig.js`, `databaseBackup.js` kabi modullar:
vaqtinchalik yozish, fsync/rename, last-good, buzilgan asl faylni saqlash, ishonchli
shu-klub daliliga asoslangan tiklash. Boshqa klub ID yoki bo‘sh default config
yaratib xatoni yashirish mumkin emas.

DB mavjud bo‘lganining marker/WAL/backup dalillari bor-u asosiy fayl yo‘q bo‘lsa,
`guardDatabase` yangi bo‘sh bazani yaratishni rad etadi. Migratsiya oldidan zaxira,
xatoda rollback, `quick_check` kabi tekshiruvlar bor. Ma’lumotni tiklashdan oldin
klub ID, HWID, baza va zaxiraning kelib chiqishini tekshiring.

### 16.2 Zaxira va disk hajmi

`VACUUM INTO` asosidagi backup WAL’dagi commit qilingan yozuvlarni ham oladi;
faqat `.db` faylini nusxalash har doim yetarli emas. Backup avval tekshiriladi,
keyin eskilarini saqlash siyosati bo‘yicha tozalanadi. Log/update vaqtinchalik
fayllari uchun chegaralash modullari bor.

Manbalar: `storageBudget.js`, `databaseBackup.js`, `Shared/Updates/BoundedLog.cs`,
`UpdateStorage.cs`, `UpdateCleanup.cs`. Baza va moliyaviy receiptlar o‘sishi mumkin;
«disk hech qachon to‘lmaydi» deb aytmang. Hozirgi backup bir diskda; tashqi
shifrlangan nusxa va undan tiklash mashqi hali muhim navbatdagi ish.

## 17. Server yoki internet uzilganda

| Hodisa | Kutiladigan xatti-harakat |
| --- | --- |
| Internet uzildi, LAN va backend bor | Mahalliy operatsiyalar litsenziya offline siyosati doirasida davom etadi; bulut nusxasi eskiradi |
| Kassa oynasi yopildi | Windows xizmati backendni ishlatishda davom etishi kerak |
| Node yiqildi | Xizmat kuzatuvi, cheklangan restart/tiklash; status/log bilan sabab ko‘rsatiladi |
| Client-server LAN uzildi, prepaid faol | Clientdagi qolgan vaqt countdowni saqlanadi; vaqt tugasa qulflanadi |
| VIP vaqtida aloqa uzildi | Kassir tasdig‘isiz o‘zicha yakuniy hisob yopilmaydi; eskirgan summa jonli deb ko‘rsatilmaydi |
| Server qayta ulandi | Saqlangan server seansi asosida moslashtirish; eski paket yangi seansni buzmasin |
| Server o‘chiq, menejer telefonda | Oxirgi bulut hisobotini ko‘radi; jonli buyruq bajarilmaydi |
| Clientning o‘zi restart bo‘ldi | Server bilan qayta kelishish talab qilinadi; RAM countdowni diskdagi to‘liq recovery degani emas |

Bir soatlik seansdan 20 daqiqa o‘tgach server qayta ishga tushsa, qolgan vaqtni
yana bir soat qilib berish yoki oldingi pulni yo‘qotish mumkin emas. O‘tgan real
vaqt, yakun muddati, saqlangan tarif va serverdagi seans birgalikda tekshiriladi.

## 18. Favqulodda server rejimi

`NetCafeServer/src/emergency-server.js` asosiy DBsiz cheklangan vaqtli seans uchun mavjud.
Bu cheksiz bepul ishlash yoki litsenziyani chetlab o‘tish emas. Yaroqli mahalliy
litsenziya, xizmat nazorati va tekshiriladigan alohida jurnal talab qilinadi.

- Kassa HTTP boshqaruvi faqat serverning o‘zidan (loopback).
- Clientlar LAN WebSocket orqali ulanadi.
- Narx/bar/top-up/to‘liq moliyaviy hisob yo‘q; vaqtli favqulodda seans.
- Joriy chegaralar: rejim 12 soat, seans 5–720 daqiqa, operator nomi talab qilinadi.
- `data/emergency-sessions.ndjson`ga ketma-ket imzolangan jurnal yoziladi.
- Jurnal buzilsa yangi seans rad etiladi.
- Asosiy serverga qaytishdan oldin faol favqulodda seanslar yopiladi.
- Bu yozuvlarni asosiy tushum deb o‘z-o‘zidan kiritmang; alohida tekshirish kerak.

Hamma nosozlik bu rejimga tushadi deb va’da bermang: masalan diskka yozishning o‘zi,
litsenziya yoki favqulodda jurnal yaroqsiz bo‘lsa xavfsiz davom etish imkoniyati cheklangan.

## 19. Birinchi sozlash ustasi va tanishtirish

Foydalanuvchi bilan kelishilgan talablar:

- Avtomatik usta faqat yangi, hali sozlanmagan klublarda.
- Ishlayotgan klublar yangilanishdan keyin majburan qayta sozlanmaydi; Sozlamadan ochish mumkin.
- Faqat menejer bajaradi; administrator tayyor bo‘lishini kutadi.
- Yakunlashda barcha haqiqiy clientlar ulangan bo‘lishi shart.
- Tarif barcha kun/soatlarni, ya’ni 24/7 qoplashi kerak.
- Xona chizish asosiy dasturdagi xarita tahrirlashdek tushunarli bo‘lishi kerak.
- Avvalgi test/ishchi xonalar va PClar dalilsiz o‘chirilmaydi yoki «namuna» deb tashlanmaydi.

Oqim: xonalar -> kompyuterlar/IP/bog‘lash -> tariflar -> tekshirish ->
«Saqlash va ishni boshlash» -> animatsiya/tanishtirish.

`clubSetup.js` qoralama/revisionni; `clubSetupContext.js` mavjud holat va jonli
clientlarni; `clubSetupFinalize.js` yakuniy atomar qo‘llashni boshqaradi.
Qoralama tahrirlash amaldagi biznes jadvallarini darhol o‘zgartirmaydi.
Yakunlashda revision, rol, litsenziya, faol seanslar, tarif qoplamasi va bog‘lanish
qayta tekshiriladi. Javob yo‘qolsa completion receipt orqali natija olinadi.

Frontend: `club-setup.*`, `club-setup-model.js`, `club-setup-geometry.js`,
`setup-gate.js`, `setup-connection.js`, `onboarding.js/css`.
IP maydonini yozish Windows adapterini qayta sozlamaydi.
Yangilangan UI’ni tushunishda tarixiy bosqich tavsifidan ko‘ra joriy kod/testga qarang.

## 20. UI, brending, sayt va yordam

Brend: qora fon, yashil belgi/aksent; super admin ikonkasida ranglar teskari.
Marketing saytida cyberpunk uslub va scroll animatsiyalari bor. Prezentatsiya
game club egasi/kassir tushunadigan foyda va amallarni ko‘rsatishi kerak.
Soxta dashboard ko‘rsatkichlari yoki real mahsulotda yo‘q demo funksiyani reklama qilmang.

Sayt vazifalari: sotuv/bog‘lanish, qisqa mahsulot namoyishi, aniq funksiyani
tushuntiruvchi yordam sahifalari. Kontakt: **@softech_support**, **+998 99 563 45 16**.
Marketingdagi telefon/Telegram bilan texnik botning identifikatorini aralashtirmang.

Joriy routing: super admin `/`, login `/login`, klub PWA `/mobile/`, sayt `/site/`,
yordam `/site/help/<topic>/`. Asosiy konfiguratsiya domeni
`https://softech-game-club.vercel.app`; saytning oldingi Sites preview domeni ham
tarixda bor. Production qaysi commitdan deploy bo‘lganini alohida tekshiring.

`context-help.js/css` ichidagi «?» kerakli mavzu sahifasini ochadi.
Yordam qisqa, tushunarli, zarur bo‘lsa misolli; ichki texnik matnni kassirga ko‘chirmang.

Logo WPF’da `Shared/Branding/Brand.xaml` va Manrope shriftlari orqali.
`LockWindow`/launcher o‘z resource dictionarysini aniq assembly URI bilan yuklaydi;
faqat `App.xaml` ishga tushganiga ishonish `SoftechMark` topilmasligi xatosini bergan.
Native test ilovasi ham oynani mustaqil yaratishi mumkin.

Hozir yashirilgan/cheklangan UX qarorlari:

- Bron/Band qilingan menyusi ichida «Tez orada…»; backend mavjudligini tayyor UI deb bilmang.
- Smena ochish/yopish, boshlang‘ich/kutilayotgan naqd hozir umumiy UI’da kerak emas.
- Tepada umumiy kassa tushumi olib tashlangan.
- Mobil seans ochishda mijoz ismi kiritish talab qilinmaydi.
- Summa maydonida telefonning raqam klaviaturasi, ekran safe-area, qulay touch o‘lchamlari.
- Reliz taqdimoti alohida reliz ma’lumotlari bilan boshqariladi; har versiyada majburiy
  taqdimot yoki faol seans paytida majburiy UI restart shart emas.

## 21. API uchun boshlang‘ich xarita

Bu to‘liq OpenAPI kontrakti emas. Body, query, status va ruxsatlar uchun router/test
manbasini o‘qing. Jadvaldagi yo‘llar muhim navigatsiya nuqtalaridir.

| Klub HTTP yo‘li | Vazifa |
| --- | --- |
| `GET /api/health` | Backend holati/versiya/process/update tekshiruvi |
| `POST /api/auth/login` | Mahalliy login |
| `/api/license/status`, `/api/license/request-activation`, `/api/license/activate-with-key` | Litsenziya |
| `/api/setup/status`, `/api/setup/context`, `/api/setup/draft`, `/api/setup/complete` | Sozlash ustasi |
| `/api/computers`, `/api/admin/computers/…`, `/api/layout`, `/api/zones` | PC va xarita |
| `/api/tariffs`, `/api/tariff-schedules`, `/api/admin/tariffs`, `/api/settings` | Tarif va sozlama |
| `POST /api/sessions/start-preview`, `/api/sessions/start`, `/api/sessions/batch-start` | Quote va seans ochish |
| `/api/sessions/checkout-preview`, `/api/sessions/checkout`, `/api/sessions/stop-early` | Yakuniy hisob va oldindan yopish |
| `/api/sessions/extend`, `/api/sessions/stop` | Uzaytirish/yopish; seans turiga mos tekshiruv |
| `/api/sessions/transfer-preview`, `/api/sessions/transfer` | Ko‘chirish |
| `/api/computers/power` | WoL/o‘chirish/restart |
| `/api/clients/topup`, `/api/clients/login-session` | Mijoz balansi va hisobidan seans |
| `/api/bar/items`, `/api/bar/orders`, `/api/bar/orders/confirm`, `/api/bar/orders/reject` | Bar |
| `/api/admin/users`, `/api/admin/users/…/permissions` | Xodimlar va ruxsat |
| `/api/reports/financial`, `/api/reports/audit`, `/api/reports/analytics` | Hisobot/audit/statistika |
| `/api/updates/status`, `/api/updates/check`, `/api/updates/apply` | Server update boshqaruvi |

Bulut API guruhlari: `/api/auth/*`, klub boshqaruvi, `/api/telemetry/*`,
`/api/telegram/webhook`, `/api/mobile/dashboard/*`, `/api/mobile/connection`,
`/api/mobile/live`, `/api/mobile/agent`, `/api/mobile/request`, `/api/mobile/result`,
diagnostika va remote commands. `vercel.json` barcha `/api/*`ni bitta
`api/index.js`ga yo‘naltiradi. Alias/regex route’larni ham tekshiring.

## 22. Muhit sozlamalari va maxfiylik

Faqat nomlari keltirilgan; haqiqiy qiymatlar bu hujjatga kiritilmaydi.

| Nom | Vazifa |
| --- | --- |
| `PORT` | Mahalliy HTTP yoki alohida hub porti |
| `SOFTECH_CLOUD_URL` | Klub serverining bulut manzili |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Bulut PostgreSQL adapteri |
| `SUPERADMIN_JWT_SECRET` / `JWT_SECRET`, `REFRESH_SECRET` | Super admin token imzolari |
| `SUPERADMIN_INITIAL_PASSWORD`, `SUPERADMIN_INITIAL_PIN` | Lokal/bootstrap konfiguratsiya; tarqatma umumiy parol emas |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Telegram bot va webhook himoyasi |
| `SOFTECH_CLOUD_KEY` | Hozirgi umumiy litsenziya/command imzolash kaliti; migratsiya talab etiladi |
| `SOFTECH_LIVE_SECRET`, `SOFTECH_LIVE_URL`, `SOFTECH_LIVE_NOTIFY_URL` | Alohida live hub |
| `SOFTECH_CLOUD_DATA_DIR` | Lokal cloud/test bazasini ajratish |
| `UPDATE_MANIFEST_URL` | Test/runtime update manifest override |
| `SOFTECH_SERVICE_CONTROL_SECRET` | Mahalliy service boshqaruv kanali |
| `NODE_ENV` | Test/production xatti-harakatlari |

`.env`ning Git ignore qilinishi avval commit qilingan secretni tarixdan olib
tashlamaydi. Config va diagnostic paketlarni ham secret nuqtayi nazaridan tekshiring.
`NODE_ENV=test` namuna hisoblar va test xatti-harakatlarini yoqishi mumkin;
production o‘rnatishda uni ishlatmang. `.test-output` bazasini haqiqiy klubga yubormang.

## 23. EXE, ZIP, OTA va reliz jarayoni

| Artefakt | Qachon kerak |
| --- | --- |
| `SoftechServerSetup.exe` | Serverni birinchi o‘rnatish yoki setup orqali xizmat/hostni yangilash |
| `SoftechClientSetup.exe` | Client o‘rnatish va favqulodda parol kabi install sozlamalari |
| `SoftechServer.zip`, `SoftechClient.zip` | Avtomatik yangilovchi uchun payload |
| `version.json` | Versiya, ZIP URL, SHA256 va changelog |
| `update-package.json` | Paket turi/versiyasi va fayllar hash ro‘yxati |

Kod o‘zgarsa, diskdagi eski EXE o‘z-o‘zidan yangilanmaydi. GitHub Actions
muvaffaqiyatli paket yig‘ishi kerak yoki mahalliy to‘liq build bajariladi.
Bir xil chiqarilgan versiyani qayta overwrite qilmang: eski client uni yangilik
deb tanimasligi va paket/manifest mosligi buzilishi mumkin.

`SoftechUpdater` oqimi: yuklash -> hash/yo‘l/paket tekshiruvi -> tayyorlash ->
yozuvlarni tugatish -> transaction journal/zaxira -> fayllarni almashtirish ->
yangi backend health/versiya tekshiruvi -> qabul qilish yoki rollback.
Probation paytida biznes yozuvlari yopiq turadi. Yangilanish qabul qilingandan
keyingi yangi savdolarni yo‘qotadigan eski DBga rollback qilish mumkin emas.

Windows xizmatining ishlayotgan host nusxasi `.service/`da bo‘lishi mumkin;
OTA uni o‘z ustiga yozib almashtirmaydi. Hostning o‘zini ko‘chirish uchun setup
kerak bo‘lishi mumkin. Kassa oynasi, service Session 0 va backendni bitta jarayon deb bilmang.

Muhim modullar: mahalliy `updater.js`, `updatePolicy.js`, `updateProbation.js`,
`updateTransport.js`, `remoteMaintenance.js`; C# `SoftechUpdater/Program.cs`,
`Shared/Updates/UpdateJournal.cs`, `RecoveryHandover.cs`, `SafePackageExtraction.cs`,
`ServerService.cs`, `UpdatePlan.cs`.

Reliz tartibi:

1. Yangi raqam: `npm run version:set -- X.Y.Z`.
2. `RELEASE-NOTES.txt` birinchi yozuvi yangi versiya bilan boshlansin:
   `YYYY-MM-DD: X.Y.Z ...`. Bu tekshiruv publishdan oldin turadi.
3. Bulut/sayt o‘zgargan bo‘lsa `npm run sync:cloud`; `npm run check:cloud`.
4. Node, tegishli C#/UI/SQL va paket testlari.
5. `scripts/build-release.ps1 -Version X.Y.Z -Repository <owner/repo>`.
6. `.github/workflows/release.yml` barcha tekshiruvlardan keyin artefaktlarni chiqaradi.
7. GitHub release holati va EXE/ZIP/hash/manifest mosligini tekshirish.
8. VM/pilotga o‘rnatish, keyin bosqichli tarqatish.

`Releases/`, `.tools/`, `.test-output/`, bin/obj, runtime, EXE/ZIP va bazalar Git
manba fayllari emas. Yangi build eski install bazasi/configini payloadga qo‘shmasin.
Cloud deploy, SQL migratsiya va Windows update — alohida tarqatish kanallari.

## 24. 2026-11-20 audit natijasi va hali bajarilmagan ishlar

### Bajarilgan mahalliy o‘zgarish

HTTP kassa va WebSocket mijoz loginlariga umumiy limiter qo‘shilgan:
`NetCafeServer/src/services/loginThrottle.js`, `server.js`, `protocolDispatcher.js`.
10 daqiqada akkauntga 20, TCP manziliga 80 urinish; ko‘pi bilan 4096 bucket.
Username trim/case, IPv4-mapped manzil normallashtiriladi; HTTP proxy headeriga
ishonilmaydi. Limit hash/bulut chaqirig‘idan oldin. To‘g‘ri HTTP paroli ikki marta
hisoblanmaydi. HTTP 429/Retry-After, clientda odatiy login-failed javobi.

Limit RAM’da, restartda yangidan boshlanadi; bu diskda saqlanuvchi yoki to‘liq
DoS himoyasi emas. Ochilgan foydalanuvchi sessiyasini bloklash uchun emas.
Yangi test: `tests/login-throttle.test.mjs`; `tests/startup.test.mjs`da haqiqiy
HTTP -> WS o‘tib limitni chetlab o‘tishga urinish va normal hisobot davom etishi.

**Bu o‘zgarish audit yakunida hali commit/push/deploy qilinmagan va EXE/ZIPga
yig‘ilmagan.** 1.3.10 raqami ishlab turgan barcha kompyuterlarda bor deb taxmin qilmang.

### Tarqatishdan oldin hal qilinadigan xavflar

1. **Umumiy signing secret.** Bulut va klub serveri HMAC tekshiruv/imzosida bir
   umumiy kalitdan foydalanadi; env yo‘q bo‘lsa koddagi standart qiymatga tushadi.
   Actual production qiymati tekshirilmagan. Yechim: imzo yaratish yopiq kaliti
   faqat bulutda, klublarda ochiq tekshirish kaliti; litsenziya, remote command,
   staff provisioning va mobil grantlar uchun xavfsiz versiyalangan migratsiya.
   Eski kalitni shunchaki almashtirish ishlayotgan klublarni bloklashi mumkin.
2. **Client pairing yo‘q.** `handleClientHello` nom/raqam/MAC/IPdan PCni tanlaydi,
   qurilmaga xos sirni tekshirmaydi. Begona LAN qurilmasi PC sifatida ulanishi
   xavfi bor. Menejer tasdiqlaydigan pairing va per-device auth kerak.
3. **Zaxira bir diskda.** Alohida qurilmaga shifrlangan backup va undan tiklash
   mashqi yo‘q. Cloud report to‘liq mahalliy DB backup emas.
4. **Haqiqiy 10 klub yuklamasi tasdiqlanmagan.** Idle agentning 5 soniyali polli,
   javob vaqtini hisobga olmaganda, bir klubga taxminan 17280 so‘rov/kun; 10 klubga
   172800, boshqa so‘rovlarsiz. Bu hisoblangan taxmin, o‘lchangan natija emas.
   Hub ishlaganda pollingni kamaytirish, production live sozlamalari va p95/timeout/
   retry ko‘rsatkichlarini o‘lchash kerak.

Mavjud Node testlarining o‘tishi yuqoridagi dizayn kamchiliklarini yo‘q qilmaydi.
Sinovlardan o‘tgan soxta/autorizatsiyalangan xabar bilan haqiqiy ishonchsiz tarmoq
xavfsizlik tekshiruvi boshqa-boshqa narsalar.

## 25. Sinovlar va dalillar

2026-11-20 auditidagi natijalar:

- Boshlang‘ich `npm test`: **272/272**.
- HTTP login tuzatishidan keyin to‘liq suite: **276/276**.
- Yakuniy HTTP/WS umumiy limiter va haqiqiy startup oqimlari: **6/6**.
- `postgres-audit.mjs`, `activation-schema.mjs`, `mobile-dashboard-schema.mjs`,
  `postgres-api-audit.mjs` — ajratilgan PostgreSQL/PGlite sinovlari o‘tdi.
- `client-protocol-audit.mjs` — native client handshake, reconnect, vaqt/lock,
  xabar, buzilgan update, mahalliy resurslar sinovlari o‘tdi.
- `updater-server-transaction.mjs` — Windows updater success/rollback/interrupted/
  restart; 5320 so‘mlik test yozuvi saqlandi.
- Cloud va sayt/brending nusxalari mosligi, `git diff --check` o‘tdi.

Sinovlar haqiqiy klublarning bazalarida emas, ajratilgan vaqtinchalik nusxalarda.
Bu hujjatda barcha UI qo‘lda qayta tekshirildi, elektr fizik uzildi, haqiqiy
SCM service shu kompyuterga o‘rnatildi, 10 klub 72 soat sinaldi yoki production
Supabase migratsiyalari tekshirildi degan da’vo yo‘q.

| O‘zgarish turi | Tekshirishga kirish nuqtasi |
| --- | --- |
| Seans/tarif/bar/qaytim | `tests/startup.test.mjs`, prepaid/postpaid/mobile oqim fayllari, billing regressiyalar |
| Balans/bar idempotency | `tests/money-operations-flow.mjs`, money operation testlari |
| Setup | `tests/club-setup*.test.mjs`, `tests/club-setup-browser.mjs` |
| Login/rol | `tests/auth*.test.mjs`, staff/manager/mobile testlari, `tests/login-throttle.test.mjs` |
| Client/native | `tests/ClientProtocol/`, `tests/client-protocol-audit.mjs`, `tests/UiLayout/`, `tests/Branding/` |
| Xizmat/OTA | `tests/ServerService/`, `tests/ServiceCancellation/`, `tests/UpdatePolicy/`, updater `*.mjs` |
| Bulut SQL | PostgreSQL/PGlite auditlari va migratsiya testlari |
| Mobil UI | `tests/mobile-roles-browser.mjs`, relay/dashboard va checkout testlari |
| Statistika | `tests/analytics-worker.test.mjs`, `tests/analytics-ui.test.mjs`, hisobot regressiyalari |
| Paket | `tests/release-artifacts.mjs`, `tests/updater-network-staging.mjs`, version testlari |

Ba’zi `*.mjs`lar oddiy `npm test` wildcardiga kirmaydi; ularni workflow yoki
alohida buyruq ishga tushiradi. C# integration uchun avval tegishli test projectini
yig‘ish, browser uchun Playwright/Edge, SQL uchun PGlite kerak bo‘lishi mumkin.

GitHub logida `API Error` chiqishi negative testning kutilgan holati bo‘lishi mumkin.
Haqiqiy yiqilish: `not ok`, `failureType`, `AssertionError`, yakuniy exit code va
test summary. Xato logini upload qilish qadami o‘tgani — oldingi testlar o‘tdi degani emas.

## 26. Dasturchi uchun xavfsiz ish tartibi

```powershell
# Repozitoriy holatini avval o‘qing
git status --short
git diff --stat

# Node 22.x bilan dependency va nusxa tekshiruvi
npm ci
npm run check:cloud

# Standart testlar; pretest cloud/website mosligini ham tekshiradi
npm test

# Bulut yoki generatsiya manbasi o‘zgarganda
npm run sync:cloud
npm run check:cloud
```

`npm start` lokal bulutni, `npm run start:server` mahalliy klub serverini ochadi va
root `.env`ni yuklaydi. **Ajratmasdan ishga tushirmang:** asl repo ichidagi baza,
litsenziya, port yoki cloud endpointdan foydalanishi mumkin. Testlar kabi alohida
papka, ma’lumot yo‘li, test cloud, alohida port va manifest ishlating.

Windowsga service o‘rnatadigan yoki kiosk/registry/keyboard hook ishga tushiradigan
testlarni kundalik kompyuterda odatiy unit test deb bajarmang. Disposable Windows
VM yoki tegishli CI harnessidan foydalaning. WPF faqat obyekt yaratish/render testi
bilan to‘liq kioskni ishga tushirish o‘rtasidagi farqni saqlang.

PowerShell yo‘llarida apostrof va bo‘shliq bo‘lishi mumkin. `-LiteralPath`, aniq
mutlaq yo‘l tekshiruvi va to‘g‘ri quoting ishlating. Computed path ustidan recursive
delete yoki jarayon nomi bo‘yicha ommaviy kill ishlatmang.

Bir o‘zgarishni tekshirish uchun imkon qadar relevant test; seans/DB/auth/update
o‘zgarsa kengroq integratsiya kerak. UI tuzatishi bahonasida billingni qayta yozmang.
Testni o‘chirish yoki assertni yumshatish bilan haqiqiy xatoni yashirmang.

## 27. Muammo chiqqanda qayerdan boshlash

| Alomat | Tekshirish tartibi |
| --- | --- |
| Launcher ochilib yopiladi | Launcher logi, WPF resource, WebView2, backend health, service identity |
| «Windows xizmati kutilmoqda» | Service status, haqiqiy PID/health, executable ruxsati, port bandligi; browser kirishi backend tirikligini ko‘rsatishi mumkin |
| Node exit code 1 | `logs/node-startup-error.log`dagi asl exception; umumiy exit code sabab emas |
| JSON parse / buzilgan config | Byte/encoding/NUL tekshiruvi, durable config/last-good, shu klub dalili; asl faylni saqlash |
| «Asosiy baza topilmadi» | DB marker, WAL/SHM, backup; guardni olib tashlab bo‘sh DB ochmang |
| Telegram tugmasi loading | Webhook URL/secret/HTTP, callback ishlovi, DB migration, pending/active holati |
| Login noto‘g‘ri | Lokal/cloud akkaunt farqi, staff revision/delivery, parol format/limit, aniq 401/403/429/503 |
| PC narxi 0 yoki eski | Xona ID, amaldagi schedule, VIP ruxsati, seans mode, prepaid frozen plan, backend quote |
| Mobil sekin/pending | Agent poll/live, server heartbeat, pending job/receipt, API status, snapshot vaqti, version mismatch |
| Offline vaqti noto‘g‘ri | Oxirgi heartbeatning haqiqiy timestampi va UI yangilanishi; fixed/fallback matn emas |
| PC soni noto‘g‘ri | License limit vs inventory vs online, PC-0, eski cache, id/name/number dublikatlari |
| OTA update bo‘lmadi | Latest manifest, versiya katta-kichikligi, SHA256, disk joyi, seans/idle gate, helper log/receipt |
| Yangi build to‘xtadi | `RELEASE-NOTES` header, barcha paket versiyasi, mirror sync, yiqilgan test, buildning aniq exceptioni |

Diagnostika: `NetCafeServer/diagnose-connection.*`, `scripts/support/` vositalari.
`Recover-Club10.*` kabi bir hodisaga bag‘ishlangan vositani barcha klublarga universal
repair sifatida ishlatmang. Log yuborishda token/parol/config sirlarini yashiring.

## 28. Keyingi AI uchun o‘zgartirishning muhim qoidalari

- Avval joriy commit, versiya va `git diff`ni tekshiring; oldingi suhbatdagi
  «qildik» jumlasini diskdagi/yetkazilgan holat o‘rniga qabul qilmang.
- Ishchi tree’dagi egasining yoki boshqa ishning o‘zgarishini reset/checkout bilan yo‘qotmang.
- Server, client, cloud, PWA va SQLni bir reliz deb aralashtirmang. Har biriga
  tegishli deploy va moslikni aniq ayting.
- Taxminiy clock/IP/club ID yoki sun’iy nol qiymat bilan xatoni yashirmang.
- Pulni bitta authoritative hisobdan oling. Har xil UI uchun alohida formula yo‘q.
- Lost response = unknown result; avtomatik yangi payment ID bilan qayta urinish yo‘q.
- Receipt, hisob, audit va session transfer tarixini saqlang; yangilash ularni buzmasin.
- Ayniqsa ma’lumotlar migratsiyasida oldindan backup, atomarlik va ortga/oldinga moslikni tekshiring.
- Ishlayotgan license secretni birdan almashtirmang; per-version migration va rollout rejasini tuzing.
- Client-server pairing joriy etishda eski clientlarni darhol klubdan uzib qo‘ymang.
- Hujjatdagi cheklovni foydalanuvchiga ayting; tekshirmagan narsaga «100% ishlaydi» demang.
- UI sodda, qulay, qisqa o‘zbekcha bo‘lsin; cyberpunk ko‘rinishi kassir ishini qiyinlashtirmasin.
- Mavjud biznesni buzmaydigan kichik bosqichlar, meaningful test, aniq release notes.

## 29. Kodni o‘rganishning tavsiya etilgan ketma-ketligi

1. Ushbu fayl, `package.json`, `Directory.Build.props`, `git status`.
2. `docs/STABILITY-PLAN.md`ning eng yangi audit qismi.
3. `NetCafeServer/src/server.js`, `db.js`, `schema.sql`, `auth.js`.
4. `pricingEngine.js`, `prepaidQuote.js`, `sessionScheduler.js`, `memberBilling.js`.
5. `barLedgerService.js`, `moneyOperations.js`, `financialBreakdown.js`, transfer xizmatlari.
6. `protocolDispatcher.js`, `clientManager.js`, C# `WebSocketClientService.cs`/`LockWindow`.
7. `mobileAgent.js`, `mobileSnapshotSync.js`, root mobile dashboard/relay va PWA.
8. Root `api/index.js`, cloud activation, staff, command, Supabase adapter va migratsiyalar.
9. Windows Service/Launcher, update helper/journal, config/backup/emergency rejim.
10. Setup/onboarding, brending/help/website, tegishli UI testlar.
11. Release workflow va aynan o‘zgartirilayotgan sohaga tegishli testlar.

## 30. Faylni boshqa AIga berganda yozish mumkin bo‘lgan topshiriq

> Ushbu fayl Softech Game Club loyihamizning 2026-11-20 holatidagi arxitektura va
> biznes kontekstidir. Avval uni to‘liq o‘qib, mahalliy server, client, bulut va
> mobil PWA vazifalarini ajratib tushun. Amalga oshirilgan kod, test natijasi va
> hali bajarilmagan rejalarni aralashtirma. Real klublar ishlayapti: balans,
> seans, tarif, hisobot, litsenziya va yangilanish mosligi saqlanishi shart.
> Keyingi topshirig‘imga javob berishda shu kontekstga tayan. Agar repo berilmagan
> bo‘lsa, aniq kodni o‘zgartirdim deb aytma; kerakli manba fayllarini so‘ra.
> Repo berilgan bo‘lsa, hujjatni joriy kod va git holati bilan solishtir.

Bu hujjatni keyingi relizlarda versiya, muhim oqim, xavfsizlik yoki deploy tartibi
o‘zgarganda yangilang. Eski audit natijasini yangi kodning avtomatik tasdig‘i sifatida ishlatmang.

## 31. Bron funksiyasi bo‘yicha mahalliy yangilik — 2026-11-21

`docs/BOOKING-IMPLEMENTATION-PLAN.md` tasdiqlangan talablar, takliflar va
bosqichlarni belgilaydi. A bosqichida `bookingSchema.js`, `bookingAvailability.js`,
`bookingFoundation.js` qo‘shildi; db.js startup migratsiyasi ularga moslashtirildi.
RequestId, atomar audit, to‘lovsiz rezerv/cancel primitivelari, bounded no-show
sweep va GET/PUT `/api/booking-settings` mavjud. Sozlama administrator va
club_owner uchun; boshqa menejer ruxsatlari administratorga berilmaydi.

**B bosqichi ham kodda qo‘shildi:** `cashierSessionStart.js` oddiy cashier start
va booking check-in uchun umumiy narx/write oqimi. Mahalliy
`/api/bookings/:id/check-in-preview` va `/check-in` POST endpointlari mavjud;
check-in `requestId`, `expectedRevision`, `quoteRevision` talab qiladi.
Yaratish/cancel yangi himoyalangan APIga, no-show sweep timerga ulandi.
Oddiy/batch start, member login, extension, transfer bandlikni tranzaksiya
ichida tekshiradi. Booking seans tugaganda COMPLETED va audit yozuvi atomar
yangilanadi. B dastlab to‘lovsiz rezerv uchun yozilgan; C quyida qo‘shilgan.

Administrator tanlagan boshqa muddat/VIP asl bron oxiridan oshishi mumkin —
foydalanuvchi tasdiqlagan. Keyingi bron bilan kesishish rad etiladi;
endtime boshlang‘ich qiymati bron oxiri. VIP kelgusi broni bor PCda rad qilinadi.
Mavjud mobil create/cancel formasi requestId/revisionga moslashtirildi;
generic status API ACTIVE/COMPLETEDga qo‘lda o‘tkazmaydi, DELETE tarixni o‘chirmaydi.

**Tarqatishga tayyorlik alohida:** D interfeysi va native testlari quyida
qo‘shilgan. E bosqichidagi paket/VM/rollback va test klub rollout tugamaguncha
buni klublarga tarqatilgan yoki to‘liq tekshirilgan reliz deb atamang.

A bosqichi: suite 285/285, keyin kengaytirilgan booking moduli 10/10.
B sinovlari `booking-sessions.test.mjs`, `booking-session-flow.mjs` va
yangilangan startup/mobile flowlarda; yakuniy natija reja 15-bo‘limida.
Faqat ajratilgan test bazalari/serverlarida tekshirildi. Paket versiyasi 1.3.10
bo‘lib turibdi; bu kod commit/push/deploy qilingan yoki klublarga yetgan degani emas.

**C bosqichi:** `bookingFunds.js` depozit manbasi va qaytimni umumiy cashier
start/checkoutga ulaydi. Yangi narx formulasi yo‘q. `booking_funds` o‘zgarmas
CAPTURE/APPLY/REFUND tarixi; `session_funding_allocations` seansning asl pul
manbasi; `session_funding_settlements` yopilgan hisob belgisi. Jadval va
triggerlar db.js startup migratsiyasida o‘rnatiladi.
Naqd/balans depozit check-inda bir marta qo‘llanadi, yetmagan qismi odatiy
to‘lov, ortiqcha balans asl mijozga qaytadi. Bekor/no-showda balans avtomatik,
naqd esa POST `/api/bookings/:id/refund` orqali xodim tasdig‘i bilan qaytariladi.
Yaratish/check-in/cancel/refund requestId va atomar receipt/audit bilan himoyalangan.
Hisobot `bookingDeposits`ni alohida qaytaradi; mavjud GAME/BAR/TOPUPga depozitni
ikki marta qo‘shmang. Qoldiq maydonlarini kunlar bo‘yicha jamlamang.
Seans hisobida balans avval o‘yinni qoplaydi; ortig‘i balansga qaytadi,
naqdning ortig‘i barni qoplab, qolgani naqd qaytim bo‘ladi. Narx/bar/qaytim
huquqi mavjud asosiy hisobdan keladi. Majburiy to‘xtash ham shu hisobni saqlaydi.
To‘liq suite 288/288, kengaytirilgan booking/mobil hisobot testlari 18/18 o‘tdi;
batafsil dalil va cheklovlar rejaning 16-bo‘limida. UI/relay/native mosligi va
depozitli ma’lumotlardan eski serverga rollback sinovi tugamaguncha buni
tayyor reliz deb atamang. Hozircha hech qanday live deploy bajarilmagan.

**D bosqichi (2026-11-21):** desktop `booking-ui.js`/CSS real bron ro‘yxati,
sana/PC filtri, sahifalash va naqd qaytim filtrini beradi. `bookingList.js`
GETni klub va 100 satrlik sahifaga bog‘laydi. `check-in-preview` va `check-in`
mavjud oddiy seans modaliga ulangan — frontend narx formulasi yozmaydi.
`public/mobile/booking-tools.js` ham shu APIga, `booking-time.js` klub vaqt
zonasiga tayanadi. Administrator/menejer grace sozlamasini o‘zgartiradi,
mobil menejer operatsion bron/seans boshlamaydi. Kutish vaqti 1–180 daqiqa;
0 yangi bronni darhol no-show qilgani sabab yangi sozlamalarda rad etiladi.
Client `bookingScreenVersion:1` e’lon qiladi, server `BOOKING_STATE` yuboradi.
Joriy bron va faol seans bo‘lmaganda login/QR yashiriladi; faol o‘yin uzilmaydi.
Cancel/no-show va reconnect holati serverdan keladi. Eski clientda yangi
rezerv ekrani kafolatlanmaydi va seans oynasi yangilash ogohlantirishini beradi.
Depozitni qo‘llash, qaytim va billing hali ham umumiy server oqimida.
291/291 suite, browser check-in/retry/timezone va native protocol sinovlari
o‘tdi; batafsil dalillar hamda E cheklovlari rejaning 17-bo‘limida.

**E va 1.3.11 tayyorlash (2026-11-21):** yaratish-only pause bayrog‘i
`booking_settings.creation_enabled`da saqlanadi. Mavjud bron, check-in,
to‘qnashuv tekshiruvi va refund davom etadi; eski UI grace qiymatini saqlaganda
pause o‘zgarmaydi. Receipt replay bayroq tekshiruvidan oldin ishlaydi.
Process uzilishi oldidan/keyin create/cancel/refund/check-in sinovlari bor.
ACCEPTED updater tranzaksiyasi bazasini eski nusxaga qaytarish Restore ichida
ham taqiqlangan. Qo‘lda eski, booking ledgerini bilmaydigan setup o‘rnatish
xavfsiz deb hisoblanmasin. Batafsil E dalillari rejaning 18-bo‘limida.

Mobil balans depoziti egasi disabled input bo‘lsa ham check-in haqiqiy bog‘langan
mijoz IDsi bilan tekshiriladi. Desktop asosiy PC kartasidan bron ochish tarixiy
sana/pagination filtriga bog‘lanmaydi; xavfsiz handler PC argumentini saqlaydi.
Versiya metadata va RELEASE-NOTES 1.3.11. VM o‘rnatish/pilot hali bajarilmagan:
Hyper-V hisobi ruxsati yetmadi. Git commit yoki CI tekshiruvi bu qabul sinovini
almashtirmaydi; real klublarga muvaffaqiyatli tarqatilgan deb da’vo qilmang.
