# Bron qilish — implementatsiya rejasi

Sana: 2026-11-20. Tekshirilgan paket: **1.3.10**, Git HEAD:
`31d103d82453a68f0a0e0e2f72fac0fdd19f408a`; mahalliy ishchi o‘zgarishlar ham mavjud.
Asosiy qoida: [AI-PROJECT-CONTEXT.md](../AI-PROJECT-CONTEXT.md).

**Holat (2026-11-21): A poydevori, B bron/seans va C depozit backend oqimi
kodda tayyorlandi; qaydlar 14–16-bo‘limlarda.** Quyidagi bo‘limlar to‘liq
funksiyaning rejasidir, barchasi implementatsiya qilingan degani emas.
Yangi desktop/mobil/client UI hali tayyor emas, reliz qilinmagan.
Ishlayotgan klublarning bazasiga tegilmadi.

## 1. Tasdiqlangan mahsulot qoidalari

- Bron — `[boshlanish, tugash)` vaqt oralig‘ini band qilish. Bron yaratish PCni
  yoqmaydi, qulfini ochmaydi, seans boshlamaydi va o‘yin pulini hisoblamaydi.
- Ekranda sana va **24 soatlik vaqt**, masalan `21-noyabr, 18:00–20:00`.
- **Clientning bron holatidagi ekranida login/parol o‘rniga «Kompyuter bron
  qilingan» yozuvi chiqadi.** Bu talab 2026-11-20 kuni qo‘shildi; client UI va
  server protokoli bo‘yicha tafsilotlar 9.1-bo‘limda.
- To‘lovsiz bron: 0 so‘m. Mijoz kelmasa kutish muddati tugagach bekor qilinadi.
- **Kutish muddatini administrator ham, menejer ham server sozlamalarida
  o‘zgartira oladi.** Buning uchun administratorga barcha sozlamalarni tahrirlash
  huquqi berilmaydi: alohida bron sozlamasi va alohida endpoint bo‘ladi.
- Depozit naqd kassadan yoki tanlangan mijoz balansidan olinadi. U haqiqiy
  seansga bir marta qo‘llanadi; qayta to‘lov sifatida yozilmaydi.
- Depozitli bron bekor qilinsa yoki mijoz kelmasa **to‘liq qaytariladi**:
  balansga avtomatik, naqd esa kassir tasdig‘i bilan. Tasdiqlanmagan naqd
  qaytim «qaytarildi» deb belgilanmaydi.
- `18:00–20:00` broniga mijoz `18:15` da kelsa, avval tasdiqlangan qoida bo‘yicha
  bron oxirigacha rejimida **20:00 da tugaydi**; o‘tib ketgan 15 daqiqa olinmaydi.
  2026-11-21 talabi bilan barcha oddiy seans rejimlari ham ochiladi (9-bo‘lim).
  Administrator boshqa muddat yoki VIP tanlasa, boshqa bron bilan kesishmagan
  holda asl bron oxiridan keyin davom etishi mumkin (2026-11-21 tasdig‘i).
- **2026-11-21:** «Mijoz keldi» odatdagi seans oynasini ochadi: vaqt, summa,
  tugash vaqti, VIP Postpaid, mijoz hisobidan. Bron uchun alohida cheklangan
  seans oynasi yaratilmaydi. Har bir rejim o‘zining mavjud ruxsat/tarif qoidalari
  va boshqa bronlar bilan to‘qnashuv tekshiruvidan o‘tadi.
- Yaratish, to‘lov, kelish, bekor qilish, qaytim — mahalliy `netcafe.db`da.
  Internet yoki bulut biznes hisobining majburiy sharti emas.
- Narx, vaqt, qaytim: mavjud `pricingEngine`, `prepaidQuote`, `memberBilling`
  qoidalari. Brauzer, PWA yoki yangi booking modulida ikkinchi formula yo‘q.

Quyidagi mayda siyosatlar **implementatsiya taklifi**, foydalanuvchining alohida
tasdig‘i sifatida talqin qilinmasin:

1. Yangi klubda kutish muddati boshlang‘ich 10 daqiqa, sozlamada 1–180 daqiqa.
   D sinovida 0 daqiqa bronni check-in uchun vaqt qoldirmasdan bekor qilishi
   aniqlandi; yangi sozlama va bronlarda bu qiymat rad etiladi. Eski yozuvlar o‘zgartirilmaydi.
   Qiymat bron yaratilganda unga nusxalanadi; sozlama o‘zgarishi eski bronlarni
   bildirmasdan bekor qilmaydi. Depozitli bron uchun ham shu muddat taklif etiladi.
   Mijoz kelmagan bronning muddati hech qachon bron tugashidan oshmaydi.
2. Bron paytidagi narx — oldindan ko‘rsatiladigan hisob. Kelganda amaldagi tarif
   bilan yangi server hisobi olinadi; narx o‘zgargan bo‘lsa kassirga ochiq ko‘rsatiladi
   va tasdiqlanadi. Depozit narxni muzlatib qo‘yadigan tarif emas.
3. Erta kelganda o‘yin avtomatik boshlanmaydi; boshlanishni oldinga surish uchun
   alohida oldindan hisob va to‘qnashuv tekshiruvi kerak. Birinchi versiyada
   kassir belgilangan vaqtni kutadi yoki bronni tekshirilgan tahrir orqali o‘zgartiradi.
4. Oldingi «faqat belgilangan tugashli prepaid, VIP keyinroq» taklifi
   2026-11-21 talabi bilan bekor qilindi. Barcha beshta rejim booking check-inga
   kiradi. **Tasdiqlandi:** administrator tanlagan vaqt/summa yoki VIP seansi
   boshqa bron bilan kesishmasa asl tugashdan oshishi mumkin. VIPning tugashi
   noma’lum bo‘lgani uchun kelgusi boshqa bron bor PCda VIP rad qilinadi.
   Bron oxirigacha rejimida avvalgi tugash vaqti saqlanadi.

## 2. Mavjud kodda nima bor va nimasi yetishmaydi

| Tekshirilgan manba | Hozirgi holat va kerakli o‘zgarish |
| --- | --- |
| `NetCafeServer/schema.sql:156`, `src/db.js:375` | `bookings` bor. Holatlar CHECK: PENDING/CONFIRMED/CANCELLED/COMPLETED. Depozit, seans bog‘lanishi va grace yo‘q. |
| `NetCafeServer/src/services/bookingService.js` | Sana va bronlar orasidagi overlap tekshiruvi bor. `ACTIVE`ni status API qabul qiladi, ammo haqiqiy DB CHECK rad etadi. Yaratish check+insert atomar tranzaksiyada emas. |
| `NetCafeServer/src/server.js:3389` atrofidagi booking API | GET/POST/status/DELETE bor; rol tekshiriladi, lekin requestId va moliyaviy holat mashinasi yo‘q. DELETE yozuvni jismonan o‘chiradi. |
| Shu fayldagi booking GET | `computer_id`ni bir vaqtning o‘zida PC raqami yoki ID deb JOIN qiladi. Aniq bitta PCga bog‘lash kerak. |
| Shu fayldagi PC o‘chirish, taxminan 832-qator | Bronning `computer_id`si 0 qilib qo‘yiladi. Faol/depozitli bron bo‘lsa bu yo‘lni himoyalash kerak. |
| `NetCafeServer/public/index.html:862`, `public/app.js:201` | «Tez orada…» ochiladi; eski bron ekranlari yashirilgan, asosiy navigatsiya bronni yuklamaydi. |
| `app.js`dagi eski bron funksiyalari | «Seans boshlash» faqat oddiy modalni ochadi. Bron va seans bitta tranzaksiyada bog‘lanmaydi. Soatni `%24` bilan aylantirib sanani o‘zgartirmaslik yarim tunda xato beradi; UTC orqali tanlangan kun lokal kun bilan farq qilishi mumkin. |
| `server.js:1956–2173`, `services/prepaidQuote.js` | Oddiy preview/start narx mexanizmi bor. Bron bilan overlap tekshirilmaydi. Preview hozir hours/price/postpaid bilan cheklangan; endtime engine’da bor. |
| `services/memberBilling.js`, `services/moneyOperations.js` | Balansli seans va money receipt mavjud. Ikkalasi ham tranzaksiya egasi bo‘la oladi: ularni ichma-ich BEGIN bilan chaqirish mumkin emas. |
| `services/netSessionReceipts.js`, `financialBreakdown.js` | Qaytimdan keyingi haqiqiy seans tushumi, bar va top-up ajratilgan. Depozit oqimi hozir yo‘q. |
| `schema.sql`dagi pul jadvallari | `transactions.transaction_type` hamda `client_transactions.type` CHECK bilan cheklangan. Ularga yangi BOOKING turi nomini shunchaki INSERT qilish ishlamaydi. |
| `public/mobile/operator-tools.js`, server `mobileAgent.js` | Eski bron yaratish va erkin holat o‘zgartirish mobil tomonda ham bor. Yangi qoidalarni aylanib o‘tmasligi uchun moslashtirish shart. |

Dalil: haqiqiy `schema.sql`dagi bookings CREATE statement alohida **in-memory
SQLite**da bajarildi. `createBooking`dan keyin `updateBookingStatus(...,'ACTIVE')`
haqiqatan `CHECK constraint failed` berdi. Klub bazalari ishlatilmadi.

Mavjud `tests/audit-regressions.test.mjs` bron sinovida CHECKsiz soddalashtirilgan
jadval yaratilgan; shu sababli bu nomuvofiqlik ushlanmagan. `tests/startup.test.mjs`
yaratish/to‘qnashuv/bekor qilishni tekshiradi, ammo depozit va kelishni emas.

## 3. Tavsiya etilgan arxitektura

```text
Desktop / mobil administrator
  -> autentifikatsiya + mahalliy club scope + ruxsat
  -> bookingApplicationService (amal egasi)
     -> bookingAvailability (barcha kirish yo‘llari uchun)
     -> prepaidQuote / pricingEngine / memberBilling
     -> runMoneyOperation: BEGIN IMMEDIATE
        bron + pul manbalari + seans + receipt + audit
        COMMIT
     -> client buyruqlari / WoL / UI xabari / snapshot invalidation
```

Tavsiya etilgan yangi modullar: `bookingAvailability.js`, `bookingFunds.js`,
`bookingApplicationService.js`, `bookingScheduler.js`; mavjud `bookingService.js`
esa validatsiya/o‘qish va repository vazifasiga moslashtiriladi. Nomlar reja,
hozir mavjud fayllar deb hisoblanmasin.

Seans boshlash yozuvlarini `server.js`dan kichik umumiy xizmatga ajratish kerak:
`prepareSession(...)` narx/reja tayyorlaydi, `insertPreparedSessionInTransaction(...)`
faqat DBga yozadi. O‘zi BEGIN/COMMIT qilmaydigan primitive bo‘ladi; HTTP start yoki
booking check-in tashqi tranzaksiyani boshqaradi. `memberBilling`da ham mavjud
hisoblash saqlanib, pul yechish va seans yozish bosqichlari ajratiladi.

Booking ichidan `/api/sessions/start`ga HTTP so‘rov yuborish yoki to‘liq pulni
yechadigan funksiyani yana chaqirish **mumkin emas**. Booking yaratishda clientga
START_SESSION yuborish ham mumkin emas.

## 4. Mahalliy baza va migratsiya

Migratsiya `NetCafeServer/src/db.js` orqali, yangi o‘rnatish sxemasi
`NetCafeServer/schema.sql` bilan mos. Booking uchun Supabase jadvali talab qilinmaydi.

Tavsiya etilgan ma’lumot modeli:

- `bookings`: mavjud ID/tarix saqlanadi; `computer_ref TEXT` — `computers.id`;
  mijoz `user_id` (balansda majburiy); UTC start/end; `grace_minutes`,
  `no_show_at`, `session_id`, `revision`, holat va sabab/timestamp maydonlari.
- Holatlar: eski PENDINGni qo‘llab turish, CONFIRMED, ACTIVE, COMPLETED,
  CANCELLED, NO_SHOW. UI yangi bronni CONFIRMED yaratadi; status clientdan erkin
  olinmaydi. `ACTIVE` faqat seans yozuvi bilan birga, COMPLETED seans yakunida.
- `booking_funds`: o‘zgarmas pul hodisalari — CASH_CAPTURE, BALANCE_HOLD,
  APPLY_TO_SESSION, CASH_REFUND, BALANCE_RELEASE. Miqdor butun so‘m, musbat;
  hodisa turi yo‘nalishni bildiradi. `club_id`, booking/session, mijoz, asl pul
  hodisasi IDsi, actor, requestId, vaqt va unique biznes identifikatori saqlanadi.
- `session_funding_allocations`: seans pulining qaysi qismi booking holdidan,
  qaysi qismi yangi to‘lovdan kelganini bog‘laydi. Har bir manba faqat o‘z
  qoldig‘icha ishlatiladi/qaytariladi; summa qismlari seans to‘langaniga teng.
- Naqd qaytim majburiyati va uning holati saqlanadi: REFUND_PENDING/REFUNDED.
  Fizik pul qaytarilmaguncha refund ledger yozuvi yaratilmaydi.
- Mavjud `money_operation_receipts` qayta ishlatiladi. Booking write APIlarida
  requestId **majburiy**. Replay tekshiruvi actor + club + operation + payloadga
  bog‘langan. Alohida unique booking→session bog‘lanishi boshqa requestId bilan
  ikkinchi check-inni ham to‘sadi.

Bu alohida ledger yo‘li mavjud transactions CHECKni shoshilib kengaytirishdan
saqlaydi. Ammo ledgerning o‘zi yetarli emas: 5-bo‘limdagi hisob proyeksiyasi va
qaytim integratsiyasisiz depozitli bronni yoqish taqiqlanadi.

Migratsiya ketma-ketligi:

1. Mavjud WAL-aware backup mexanizmi orqali tekshiriladigan zaxira.
2. Eski bronning PC raqami aynan o‘sha klubda yagona PCga mos bo‘lsa IDga bog‘lash.
   PC-0, yo‘q/ikkita mos keluvchi PC yoki noto‘g‘ri interval — tarixni saqlash,
   `needs_review` belgilash; boshqa PC/klubga taxmin bilan ulash yo‘q.
3. CHECKni o‘zgartirish uchun jadvalni transaction ichida rebuild qilish;
   IDlar, eski yozuvlar, indekslar saqlanadi. Asl jadval o‘rnini almashtirish
   faqat tekshiruvlardan keyin. `foreign_key_check`, row count va legacy fixturelar.
4. `(club_id, computer_ref, status, start_time, end_time)`, no-show navbati,
   session unique bog‘lanishi va pul manbalari indekslari. Query plan tekshiruvi.
5. Takror migratsiya hech narsa buzmasin; xatoda rollback. Bo‘sh baza yaratish yo‘q.

Kelajakdagi faol bron/depozit mavjud PCni o‘chirish rad etiladi: avval bronni
ko‘chirish yoki bekor qilish/qaytimni yakunlash. Tugallangan tarixda PC nomi/raqami
snapshoti saqlanadi; bronlar PC-0ga ko‘r-ko‘rona ko‘chirilmaydi.

## 5. Depozit, tushum va qaytimning bitta hisobi

**Kassaga pul kelishi, bajarilgan xizmat va mijoz balansi bir xil ko‘rsatkich emas.**
Bron uchun olingan pul «Bron depoziti» bo‘lib ko‘rinadi; u hali o‘ynalgan seans emas.
Hisobotda ko‘rsatkichlar bir-biriga qo‘shilib takror hisoblanmasligi kerak.

| Amal | Kassa/balansdagi harakat | Xizmat hisobidagi natija |
| --- | --- | --- |
| 0 so‘mlik bron | Harakat yo‘q | Seans yo‘q |
| Naqd 3 000 depozit | Kassa +3 000, booking funds hold | GAME tushumi sifatida hali yozilmaydi |
| 10 000 seansga kelish | Qolgan naqd +7 000; 3 000 hold qo‘llanadi | Seans to‘langan jami 10 000; yangi pul 7 000 |
| Balansdan 3 000 hold | Mijozning ishlatish mumkin bo‘lgan balansi −3 000 | TOPUP ham, o‘ynalgan GAME ham emas |
| Shu balansdan 10 000 seans | Faqat yana −7 000 | O‘yin to‘lovi jami 10 000; kassa +0 |
| Bron bekor, balans hold | Bir marta +3 000 balansga | Seans tushumi 0 |
| Bron bekor, naqd hold | «3 000 qaytarish kerak»; tasdiqda kassa −3 000 | Seans tushumi 0 |

`netSessionReceipts`/`financialBreakdown`ga booking ledgerdan yagona normalizatsiya
qatlami qo‘shiladi. APPLY — ichki o‘tkazma, yangi kassa kirimi emas. Bir xil pul
ham yangi PREPAID, ham booking capture sifatida qayta yig‘ilmaydi. Wallet holdni
ham qaytadan SESSION_DEDUCT deb balansdan yechish mumkin emas.

Hisobotda kassa harakati **asl pul olingan sanada** qoladi. Seansga qo‘llangan
qism manba receipt bilan bog‘lanadi. Hisobot sanasi filtri, balansdan sarflangan
pul, bar, refund va pending depozit alohida olinadi. Mavjud seanslar uchun
tarixiy retained-payment sanasi siyosati booking bahonasida o‘zgartirilmaydi.

Kechikib kelganda narx 2 000, hold 3 000 bo‘lib qolsa: seansga 2 000 qo‘llanadi,
ortiqcha 1 000 balansga avtomatik qaytadi yoki naqd qaytimni kutadi. Bu qarz ham,
yo‘qoladigan pul ham emas. Har bir pulning applied/refunded/pending qismlari
asl olingan summadan oshmasligi transaction ichida tekshiriladi.

Seans muddatidan oldin yopilsa, avval mavjud checkout/member refund mexanizmi
ishlatilgan vaqt va barni hisoblaydi; natija manba to‘lovlar bo‘yicha ajratiladi.
Bar qaytimni kamaytirishi, naqd va balans qaytimi turlicha bo‘lishi, ko‘chirilgan
seans ham shu booking/session bog‘lanishini saqlashi sinovdan o‘tadi.

O‘zgarish barcha tegishli o‘quvchilarga birga yetishi shart: server hisoboti,
statistika worker/cache, audit ko‘rinishi, mobil snapshot va Super Admin moliyaviy
ko‘rinishi. Cloud yangi xizmat hisobini o‘zi qayta hisoblamaydi. Snapshotning eski
o‘quvchisi noma’lum depozit maydonini GAMEga qo‘shmasligi kerak.

## 6. To‘qnashuv va vaqt siyosati

- Ikki interval kesishishi: `existing.start < requested.end` va
  `existing.end > requested.start`. `18:00–19:00` va `19:00–20:00` kesishmaydi.
- UI sana+HH:mmni klub vaqt zonasiga bog‘laydi. API aniq offset/UTC talab qiladi;
  telefon vaqt zonasi yoki noaniq `YYYY-MM-DD HH:mm`ga tayanmaydi. Yarim tundan
  o‘tish tugash sanasi bilan ko‘rsatiladi.
- Preview o‘qish uchun; oxirgi tekshiruv va yozish bir BEGIN IMMEDIATE ichida.
  Parallel ikki kassirdan faqat bittasi bir slotni oladi.
- Bron yaratish/tahrirlash: boshqa bron + haqiqiy ochiq seans tekshiriladi.
- Oddiy seans boshlashning barcha yo‘llari: single/group HTTP, mijoz HTTP/WS
  loginidan ochiladigan balansli seans, mobil relay — umumiy availability check.
- Uzaytirish, target PCga ko‘chirish, bronning sanasi/PCsini o‘zgartirish ham shu
  checkdan o‘tadi. Faqat UI ogohlantirishi bilan cheklanilmaydi.
- Kesishsa 409 + kassirga «PC-03 soat 19:00 dan band. Seansni 19:00 gacha
  ochishingiz mumkin». Qisqartirilgan variant serverdan qayta quote qilinadi,
  avtomatik va roziliksiz vaqt qisqartirilmaydi.
- VIP Postpaidning haqiqiy tugash vaqti noma’lum. Uning texnik 24 soatlik
  `ends_at` qiymatini aniq bo‘shash vaqti deb qabul qilish mumkin emas. Birinchi
  bosqichda kelgusi broni bor PCga VIP rad qilinadi; ochiq VIP bor PCga yangi
  bronni tasdiqlash rad qilinadi. Mijozni avtomatik chiqarib yuborish yo‘q.
- Bron endtime seansi belgilangan vaqtdan oshmaydi. Oddiy endtime rejimidagi
  sekundni yumaloqlash siyosati mavjud helperda; yangi booking formula yozilmaydi.

## 7. API shartnomasi — taklif

| API | Vazifa va himoya |
| --- | --- |
| GET `/api/bookings?from=...&to=...&computerId=...&status=...` | Cheklangan sana oralig‘i, pagination, klub scoping; haqiqiy summarylar |
| POST `/api/bookings/preview` | Vaqt/PC/quote, to‘qnashuvlar, serverNow va vaqt zonasi; pul yozmaydi |
| POST `/api/bookings` | requestId, computerId, customer, startsAt/endsAt, payment `{kind: NONE/CASH/BALANCE, amount, clientId}`; bron va hold bir transaction |
| PATCH `/api/bookings/:id` | requestId + expectedRevision; hali boshlanmagan bronning PC/vaqti/izohi; qayta overlap/quote, yashirin pul yechish yo‘q |
| POST `/api/bookings/:id/check-in-preview` | Oddiy modalning mode/value/durationMinutes/endTime/clientId parametrlari; shu rejimning mavjud quote mexanizmi, hold va settlement, quote revision/token |
| POST `/api/bookings/:id/check-in` | requestId + expectedRevision + tasdiqlangan mode/quote + to‘lov ma’lumotlari; yagona seans va yagona pul yozuvi |
| POST `/api/bookings/:id/cancel` | requestId, sabab; balans release yoki naqd pending; aktiv seansni bu API bilan o‘chirmaydi |
| POST `/api/bookings/:id/refund` | Naqd fizik qaytim tasdig‘i, requestId; mavjud pending miqdoridan ortiq emas |
| GET/PUT `/api/booking-settings` | Kutish daqiqasi; administrator/menejer uchun tor scope, PUT audit va validatsiya bilan |

POST javobida server hisoblagan `booking`, `settlement`, `requestId`, kerak bo‘lsa
`sessionId` qaytadi. Xarajat yoki quote o‘zgarsa 409 `QUOTE_CHANGED` va yangi preview;
yangi summa yashirin olinmaydi. Mablag‘ yetishmasa 409, invalid input 400,
ruxsatsiz 403, boshqa klub/mavjud bo‘lmagan ID 404.

Check-in tartibi: auth → transaction/receipt replay → bron revision/holat/vaqt →
PC va bandlik → mavjud pricing bilan hisob → hold/qolgan mablag‘ → seans yozuvi →
booking ACTIVE → pul aloqalari/audit/receipt → COMMIT → START_SESSION/WoL/broadcast.

Audit yozuvi ham transactionda saqlansin. Hozirgi `logAuditEvent` xatoni yutadi va
darhol broadcast qiladi; booking uchun commitdan oldin xabar tarqatmaydigan,
xatoni qaytaradigan DB primitive ajratish kerak. Mavjud chaqiruvchilarning
xatti-harakatini bilmasdan birdan almashtirish yo‘q.

COMMITdan keyin clientga xabar yetmasa seans/pul qayta yaratilmaydi. Seans holati
va yetkazish kutilayotgani saqlanadi; reconnectda shu sessionId tiklanadi. UI
«Seans ochildi, clientga yetkazish kutilmoqda»ni «to‘lov bajarilmadi»dan ajratadi.
Uncertain javobdan keyin aynan o‘sha requestId bilan retry/status olish kerak.

Eski erkin status API `ACTIVE/COMPLETED`ga o‘tishga ruxsat bermaydi; DELETE ham
depozitni chetlab o‘tib tarixni o‘chirmaydi. Eski PWAga aniq «Ilovani yangilang»
javobi beriladi yoki xavfsiz cancel adapteri ishlatiladi; yashirin downgrade yo‘q.

## 8. Ruxsatlar va mobil moslik

- `clubId` request bodydan olinmaydi, autentifikatsiya kontekstidan olinadi.
  Mahalliy ID bilan bulut IDsi aralashtirilmaydi.
- Booking read/manage/cancel/refund uchun aniq permission mapping beriladi.
  Check-in qo‘shimcha mavjud `session:manage`ni talab qiladi. Role tekshiruvi
  faqat tugma yashirishdan iborat bo‘lmaydi.
- Serverdagi administrator va menejer kutish daqiqasini tahrirlaydi; bu tor
  sozlama umumiy `tariffs:manage` yoki xodim boshqaruvini ochmaydi.
- Mobil menejerning seans/bar/power amallarini bajarmaslik chegarasi saqlanadi.
  Mobil bron operatsiyalari administratorga; menejerga sozlama endpointini mobil
  ochish kerak bo‘lsa faqat shu endpoint alohida allowlist qilinadi.
- `mobileAgent.js` yangi endpointlarni aniq regex/method bilan qabul qiladi.
  `mobileRolePolicy.js`, root `public/mobile/operator-tools.js` birga tekshiriladi.
  Root o‘zgarsa `scripts/sync-cloud.mjs` orqali SoftechCloudAdmin nusxalanadi.
- Mobil snapshotdan write qilish yo‘q: mahalliy server offline bo‘lsa bron
  yaratildi/to‘lov olindi deyilmaydi. Mavjud seans va bronlar LANda ishlayveradi.

## 9. O‘zbekcha desktop UI

«Band qilingan» ochilganda real sahifa: sana tanlash, xona/PC filtri, kunlik
jadval va oddiy ro‘yxat. Asosiy tugma — **«Bron qo‘shish»**. Mobil ekran uchun
kartochkalar; uzoq izohlar va texnik statuslar foydalanuvchiga chiqarilmaydi.

Bron shakli:

1. PC, mijoz ismi/telefon; balans tanlansa mavjud mijoz hisobini tanlash.
2. Boshlanish sanasi/vaqti va tugash sanasi/vaqti; yonida davomiylik.
3. «To‘lovsiz» / «Naqd depozit» / «Mijoz balansidan», summa.
4. Serverdan: «18:00–20:00 band qilinadi. Seans hali boshlanmaydi»;
   narx, depozit, kutish tugashi va to‘qnashuv bo‘lsa aniq PC/vaqt.
5. Bitta saqlash. Ikki bosish va javob yo‘qolishida bir requestId saqlanadi.

Kartochka: PC, mijoz, interval, «Kutilmoqda / Seansda / Bekor / Kelmagan /
Tugallangan», depozit va «Naqd qaytim kutilmoqda» holati. Sonlar server querysidan;
statuslar ikki marta sanalmaydi, 0 o‘rniga sun’iy qiymat qo‘yilmaydi.

**«Mijoz keldi / Seans ochish» mavjud oddiy seans modalini ochadi.** Tekshirilgan
manba: `NetCafeServer/public/index.html`dagi `startTab-hours/price/endtime/postpaid/client`,
`openStartModal` va `setStartMode`. Modalga booking konteksti qo‘shiladi, boshqa
mustaqil billing formasi yaratilmaydi:

- **Vaqt bo‘yicha** — odatdagidek soat yoki daqiqa.
- **Summa bo‘yicha** — administrator belgilagan jami seans budjeti. Depozit
  budjetga qo‘shimcha yashirin summa emas: 10 000 budjet va 3 000 depozitda
  yangi to‘lov 7 000. Davomiylikni mavjud engine 10 000 asosida beradi.
- **Tugash vaqti bo‘yicha** — bronning tugash sanasi/vaqti oldindan to‘ldiriladi;
  qolgan vaqt serverda hisoblanadi.
- **VIP Postpaid** — aynan mavjud VIP hisobi; xona/sozlamada VIP taqiqlangan
  bo‘lsa bron ham ruxsat bermaydi. Depozit yakuniy hisobga kredit sifatida
  bog‘lanadi, tugamagan o‘yinga sun’iy prepaid summa yozilmaydi.
- **Mijoz hisobidan** — mavjud mijoz/balans qoidalari. Balansdan oldin olingan
  depozit ikkinchi marta yechilmaydi. Boshqa mijoz hisobiga o‘tishda eski mijoz
  holdini yashirin ko‘chirish mumkin emas; avval manbasiga qaytarish talab qilinadi.

Modal tepasida «PC-03 • Bron: 18:00–20:00», depozit va tanlangan rejimning
serverdan kelgan hisobi turadi. Tavsiya etilgan boshlang‘ich tab — tugash vaqti;
administrator boshqa tabni tanlay oladi. To‘qnashuv va summa o‘zgarsa preview
yangilanadi. Modal yopilsa yoki xato bo‘lsa bron va depozit o‘z holida qoladi.

Yakuniy bitta amal: «7 000 so‘m qabul qilish va seans ochish» yoki «Seansni
ochish». Kassir bronni oldin bekor qilib, keyin alohida seans yaratmaydi;
bookingId bilan atomar check-in chaqiriladi. Oddiy `openStartModal`ning global
booking konteksti keyingi boshqa PC seansiga sizib o‘tmasligi uchun ochish/yopishda
tozalanadi. Naqd tugma fizik pul olinganini anglatishi aniq yoziladi.

VIP uchun yakuniy hisob noma’lum ekan depozit darhol ortiqcha deb qaytarilmaydi.
Yopishda mavjud postpaid/bar hisobi → depozit krediti → qolgan qarz yoki qaytim
ketma-ketligi ishlaydi. Bir xil pul cash receipt, prepaid va VIP settlementda
uch marta yozilmaydi. Cash/balance manbasi alohida saqlanadi; qolgan balans yetmasa
mavjud qarz/checkout qoidasi ishlaydi. Shu oqim C bosqichidagi majburiy moliyaviy ish.

Sozlamalar → Bron qilish: **«Mijozni kutish: [15] daqiqa»**, saqlash va qisqa
misol. Kutish muddati joriy bronlarda qaysi qiymatda qolganini bron ichida ko‘rish mumkin.

Yangi yordam sahifasi qisqa misollar bilan bog‘lanadi; bu uchun backend tayyor
bo‘lmasdan «Tez orada…»ni shunchaki yashirish bilan funksiyani yoqish mumkin emas.

### 9.1. Client ekrani: «Kompyuter bron qilingan»

Foydalanuvchi talabi: bron uchun ajratilgan clientda login/parol formasi
ko‘rinmaydi. O‘rnida Softech dizayniga mos katta matn:

> **Kompyuter bron qilingan**
>
> 18:00–20:00
>
> Seansni boshlash uchun administratorga murojaat qiling.

Mijozning ismi, telefoni, balans yoki depozit summasi umumiy ekranga chiqarilmaydi.
Login/parol bilan birga QR orqali seans ochish ham bron holatida yashiriladi.
Serverning login/seans API himoyasi saqlanadi: faqat formani yashirish yetmaydi.
Egaga mo‘ljallangan mavjud parolli favqulodda chiqish mexanizmi saqlanadi.

Vaqt talqini — oldindan band qilish qoidasiga mos implementatsiya taklifi:

- Ertangi yoki keyinroq boshlanadigan bron PCni hozirdan bloklamaydi. Hozirgi
  qonuniy seans davom etadi; bo‘sh PCda odatiy kirish va «18:00 dan bron qilingan»
  ogohlantirishi bo‘lishi mumkin. Ochiladigan seans kelgusi bron bilan kesishmaydi.
- Bron boshlanganda, hali check-in qilinmagan va faol seansi yo‘q PCda login
  o‘rnini bron xabari egallaydi. Bu o‘yin hisoblagichini ishga tushirmaydi.
- Kassir «Mijoz keldi / Seansni ochish» amalini bajargach, faqat serverda
  tasdiqlangan haqiqiy seans bu ekranni olib tashlaydi va mavjud desktop/shellni ochadi.
- Bron bekor qilinsa yoki server no-show deb yakunlasa, boshqa amaldagi bron
  bo‘lmasa login formasi qaytadi. Naqd qaytim pending bo‘lishi PCni band tutmaydi.
- Faol seans bor paytda eski yoki kechikkan bron xabari mijoz ekranini qulflamaydi.
  Kutilmagan seans/bron ziddiyati serverda qayd etilib kassirga ko‘rsatiladi.

Tekshirilgan kirish nuqtalari: `NetCafeClient/LockWindow.xaml`dagi
`PanelPhoneLogin` va QR paneli; `LockWindow.xaml.cs`dagi login/QR boshqaruvi;
`NetCafeClient/WebSocketClientService.cs`dagi `LOCK_SCREEN`, `START_SESSION`
va seans eventlari; serverdagi `handlers/protocolDispatcher.js` handshake va login.
Bu dastlabki loyiha tavsifi; amaldagi D implementatsiyasi 17-bo‘limda qayd etilgan.

Rejalashtiriladigan protokol: PCga tegishli rezerv holati (`bookingId`,
`revision`, `startsAt`, `endsAt`, `noShowAt`, `serverNow`, holat), serverdan
snapshot va o‘zgarish xabari orqali yetkaziladi. Handshake/reconnect ham shu
holatni qayta beradi. Aniq event nomi protokol implementatsiyasida belgilanadi;
begona PC/klub payloadi va eski revision qo‘llanmaydi. Bekor qilish ham yuqoriroq
revisionli ochiq holat sifatida yetkaziladi, eski paket bronni qayta yoqmaydi.

Aloqa uzilganda clientdagi soat bronni seansga aylantirmaydi yoki qulfni
ochmaydi. Tasdiqlangan rezerv intervali bo‘yicha ko‘rinish saqlanadi, internet/LAN
holati ajratiladi; server qaytganda authoritative snapshot olinadi. Davom etayotgan
seanslarning mavjud offline himoyasi bu ekran sabab o‘zgartirilmaydi.

Bu ekran uchun **server ham, client ham yangilanishi kerak**. Client capability
ko‘rsatadi; eski client yangi bron ekranini kafolatlamaydi. Server barcha
versiyalarda bronni chetlab o‘tuvchi loginni rad etadi, kassirga esa clientni
yangilash zarurligini bildiradi. Eski clientning ulanishi yoki qonuniy faol
seansi faqat yangi eventni tushunmagani uchun uzilmaydi.

### 9.2. Asosiy menyuda PC ustidan boshqarish va ranglar

2026-11-20 aniqlashtirilgan talab: PC kartochkasini bosish bronni chetlab o‘tib
oddiy seans ochishga imkon bermaydi. Hozirgi vaqtni band qilib turgan bronda
asosiy amal «Bronni ko‘rish / Mijoz keldi» bo‘ladi. Oddiy seans API ham buni
rad etadi; eski ochiq modal, group start, mobil yoki bevosita so‘rov istisno emas.
Vakolatli kassir bronni bekor qilsa, avval cancellation/refund oqimi bajariladi.

Kelajakdagi bron uchun shu PCni hozirdan kun bo‘yi bloklamaymiz: faqat bron
boshlanishigacha tugaydigan oddiy seansga ruxsat. Masalan 18:00–20:00 bron
bo‘lsa, 16:00–17:00 mumkin; 17:30–18:30 mumkin emas. Bronni ko‘rish yoki
bekor qilish mijozning depozitini avtomatik yangi seansga o‘tkazmaydi.

Rang dizayni taklifi: **amaldagi bron — binafsha kontur/fon va «Bron qilingan»
yozuvi**; kelajakdagi bron — mavjud PC rangini saqlagan holda binafsha kalendar
belgisi va «18:00 dan bron». Aloqa holati alohida matn/belgi bilan ko‘rsatiladi:
«Offline • Bron qilingan» ham mumkin. Bronning o‘zi PC online degani emas.
Bron seansga aylangach odatiy faol seans ko‘rinishi qaytadi. Faqat rangga
tayanilmaydi: matn, interval va amal tugmasi ham mavjud.

Klassik Grid, Jadval va 2D xarita **bir server holati va bir xil action resolver**
orqali ishlaydi. Rang va tugmalarni uch joyda mustaqil biznes formulasi bilan
hisoblash yo‘q. Bu ko‘rinishlar yangi UI implementatsiyasi rejasi, hozirgi
ishlayotgan ranglarga berilgan tasdiq emas.

### 9.3. Bron tarixi va takror bron

Bir PCga kesishadigan ikki amaldagi bron taqiqlanadi. Boshqa, kesishmaydigan
vaqtda shu PCni yana bron qilish mumkin; bekor/no-show bron slotni bo‘shatadi.
Bir xil requestId bilan retry yangi bron emas, eski natijani qaytaradi.

Amallar tarixida kamida quyidagilar o‘zbekcha saqlanadi: bron yaratildi;
vaqti/PCsi/mijoz ma’lumoti tahrirlandi (oldingi va yangi qiymat); depozit olindi;
mijoz keldi va seans ochildi; bron bekor qilindi; mijoz kelmadi; qaytim
kutilmoqda; pul qaytarildi; kutish sozlamasi o‘zgartirildi. Yozuvda actor yoki
«Tizim», vaqt, booking ID, PC va tegishli pul/seans bog‘lanishi bo‘ladi.

Bron tarixi jismonan DELETE qilinmaydi. Mavjud audit jadvalidagi DELETE/UPDATE
himoyasi saqlanadi; yangi booking audit yozuvi va biznes amal atomar yoziladi.
Oddiy cleanup, no-show scheduler va yangilanish bu tarixni o‘chirmaydi. Ro‘yxat
filtrida ko‘rinmasligi bazadan o‘chirilganini anglatmaydi; arxiv ham o‘qiladigan
bo‘ladi. Tarix va receiptlar backup/restore sinoviga kiritiladi.

«Hech qachon yo‘qolmaydi» degan mutlaq kafolat berilmaydi: disk ishdan chiqishi
yoki bazaning tashqaridan o‘chirilishi ilova himoyasidan tashqarida. Mahalliy
backup bilan birga alohida qurilma/manzildagi tekshirilgan zaxira zarur;
bu reja bunday tashqi backup allaqachon mavjud deb da’vo qilmaydi.

## 10. No-show, restart va buzilishdan himoya

- Scheduler faqat muddati kelgan oz sonli bronlarni indeks bo‘yicha oladi.
  Har bir bron o‘z transactionida; sessiya bor-yo‘qligi yana tekshiriladi.
- Server qayta ochilganda o‘tib ketgan bronlar qayta tekshiriladi. Balans release
  va NO_SHOW bitta transaction, takror ishga tushishi yana pul qo‘shmaydi.
- Kassir check-in va scheduler bir vaqtda kelsa, writer transactiondagi
  shartli status/revision tekshiruvi g‘olibni belgilaydi. Yarim holat qolmaydi.
- Depozitli no-show: balansga qaytarish yoki naqd pending. Cash refundga
  scheduler kassir nomidan tasdiq qo‘ymaydi.
- Disk to‘lsa/DB write ishlamasa yangi bron va pul olindi deb success berilmaydi.
  Mavjud seanslar ishlashini booking scheduler xatosi to‘xtatmasligi kerak.
- Server vaqti katta orqaga/oldinga o‘zgarsa logging va mavjud clock himoyasi
  hisobga olinadi; brauzer soati no-show qarorini chiqarmaydi.

## 11. Bosqichlar va tugallanish mezonlari

### A. Model va migratsiya

Schema/legacy migratsiya, requestId, holat mashinasi, settings, availability.
Avval actual-schema fixture testlari; production UI hali yopiq. Eski PC/history
va nol moliyaviy o‘zgarish bilan qayta migratsiya o‘tishi shart.

### B. Umumiy seans mexanizmi va to‘lovsiz bron

Mavjud session write primitive ajratiladi; non-booking natijalari oldingidek.
Bron yaratish, check-in, cancel/no-show, oddiy start/extend/transfer/member
kirishlarining barchasida conflict nazorati. Faqat ajratilgan sinovda yoqiladi.

### C. Depozit va to‘liq moliyaviy bog‘lanish

Cash/balance hold, application, qolgan to‘lov, ortiqcha depozit, cancellation,
no-show, qaytim, bar, hisobot/snapshot/worker. Pul yo‘qolmasligi va ikki marta
yozilmasligi tasdiqlanmaguncha live klublarda depozit tugmasi ochilmaydi.

### D. Desktop va eski mobil yo‘llar

Yangi Uzbek UI, sozlama, server settlement, pending/retry, modal/24h/accessibility.
Eski status/DELETE yo‘llari himoyalanadi; mobil administrator bir xil API ishlatadi.
Coming-soon testi funksional UI/permission/loading testlariga almashtiriladi.
Clientning bron ekrani, server rezerv holati va eski client bilan moslik ham
shu bosqichda qo‘shiladi; WPF/protokol sinovlari alohida bajariladi.

### E. Integratsiya va sinov klubida rollout

Mavjud suite + booking regression + browser/relay + disposable Windows VM.
Avval bitta test klub; keyin kuzatuv bilan tarqatish. Alohida release/build qarori.
Feature flag yangi bron yaratishni to‘xtata oladi, ammo oldingi bronlar bilan
conflict himoyasi, hisob, read/cancel/refundni o‘chirib qo‘ymaydi. Yangi ledger
yozilgan bazani uni tushunmaydigan eski binarga ko‘r-ko‘rona rollback qilmaymiz.

## 12. Majburiy qabul sinovlari

1. Haqiqiy eski CHECKli schema → yangi schema; ikki marta migratsiya; xatoda
   rollback; PC-0/ambiguous tarix saqlanishi; FK va indekslar.
2. 0 so‘m bron session/transactions/client balansini o‘zgartirmaydi, PCni yoqmaydi.
3. 18–20 / 19–21 to‘qnashadi, 20–21 to‘qnashmaydi; yarim tun, telefon boshqa
   timezone, Asia/Tashkent +05:00, noto‘g‘ri/past vaqt, mavjud uzun seans.
4. Ikki DB connectiondan bir PC/interval — bittasi muvaffaqiyat, ikkinchisi 409.
5. Naqd 3 000 + kelganda 7 000 = 10 000; 13 000 emas. Balansda ham aynan bir
   debit; depozit va seans boshqa kunlarda bo‘lsa ham sanalar/pul to‘g‘ri.
6. Check-in CREATE/COMMITdan oldin va keyin process uzilishi; response yo‘qolishi;
   bir xil/boshqa requestId bilan replay; ikki kassir; bir bookingdan bitta seans.
7. 18–20, kelish18:15 → engine bo‘yicha qolgan 105 daqiqa, end20:00. Tarifning
   interval ichida o‘zgarishi, narx o‘zgargan quote, ortiqcha/yetishmagan depozit.
8. Bekor qilish/no-show: balans bir marta qaytadi; cash pending → bitta tasdiq;
   ikkinchi refund rad; restart va scheduler/check-in race.
9. Oddiy/group start, WS/member login, extend, transfer, mobil relay bronni
   chetlab o‘tmaydi; VIP uchun noma’lum tugash xavfsiz bloklanadi.
10. Erta yopish + bar: mavjud 10 000/5 000 misoli 30 daqiqada net0, 50 daqiqada
    net3 333; turli tarif/muddatlar; cash/balance/depozit qismlari; transfer.
11. Server, mobil hisobot, Super Admin proyeksiyasi, statistika va audit summalari
    mos. Top-up, bar, pending depozit va haqiqiy game tushumi ikki marta jamlanmaydi.
12. Tenant/role/permission; administrator faqat bron sozlamasini o‘zgartiradi;
    mobil menejer seans boshlay olmaydi; SQL/HTML injection va pagination limitlari.
13. Server/internet/client uzilishi, disk write failure; success faqat commitdan
    keyin; clientga yetkazish xatosi yangi seans/to‘lov yaratmaydi.
14. Non-booking seanslar, VIP, bar, balans va qaytimning mavjud testlari hammasi
    o‘tadi. UI uchun kichik ekran, 24h format, klaviatura, double click sinovi.
15. Client: bron boshlanishida login/QR o‘rniga bron matni; check-in ochadi;
    cancel/no-show loginni qaytaradi; kelgusi bron faol seansni to‘xtatmaydi.
    Kechikkan event/revision, reconnect, server restart, aloqa uzilishi, boshqa
    PC payloadi va eski client versiyasi sinovdan o‘tadi. WPF resurslari haqiqiy
    render/obyekt yaratish testida tekshiriladi; kundalik PCda kiosk ishga tushirilmaydi.
16. Grid/Jadval/2D orqali band PCni bosish, eski modal va group start rezervni
    chetlab o‘tmaydi; future/current/offline bron matni va rangi mos. Har bir
    bron/pul/status/sozlama amali tarixda bir marta ko‘rinadi; cancel, cleanup,
    restart, upgrade va backupdan tiklash tarixni yo‘qotmaydi.
17. Brondan beshta rejimning har biri: vaqt, summa, endtime, VIP, mijoz hisobi;
    depozitsiz/naqd/balans depoziti, VIP taqiqlangan xona, boshqa mijozni tanlash,
    keyingi bron bilan overlap, modalni bekor qilish va boshqa PCni ochish.
    VIP yakunida depozit bir marta ayriladi; foydalanilmagan qismi tegishli
    manbaga qaytariladi. Oddiy seans modalining booking bo‘lmagan oqimi o‘zgarmaydi.

## 13. Ushbu rejalashtirish bosqichining yakuni

Tekshirilgan: yuqorida sanalgan manba fayllari va haqiqiy booking CHECK
nomuvofiqligining in-memory reproduksiyasi. Boshqa avvalgi audit natijalari
yangi booking implementatsiyasining testi deb olinmaydi.

Shu bosqichda Node 22.23.5 bilan bajarilgan bazaviy tekshiruv:
`node --test --test-name-pattern=booking tests/audit-regressions.test.mjs tests/bookings-coming-soon.test.mjs`
— **2/2 o‘tdi**. Bu hozirgi overlap/tenant validatsiyasi va «Tez orada…»
ko‘rinishining sinovi; depozit yoki check-in tayyorligini tasdiqlamaydi.
Production baza, Windows xizmati va kiosk ishga tushirilmadi.

Bu 13-bo‘lim dastlabki rejalashtirish tekshiruvini qayd etadi. Keyingi kod
o‘zgarishlari va ularning alohida tekshiruvlari quyida yuritiladi.

## 14. A bosqichi — 2026-11-21 implementatsiya qaydi

Kodga qo‘shildi:

- `bookingSchema.js`, `db.js`, `schema.sql`: mavjud startup backup/tranzaksiyasi
  ichidagi migratsiya; yangi lifecycle holatlari, PCning barqaror IDsi, grace,
  revision, session bog‘lanishi, tekshirish belgisi va indekslar. Eski qo‘shimcha
  ustun/indeks/FK references va AUTOINCREMENT hisoblagichi saqlanadi.
- `bookingAvailability.js`: aniq offsetli interval, yarim tun va yonma-yon
  vaqtlar, bron/ochiq seans va noma’lum tugashli VIP yoki live balans tekshiruvi.
- `bookingFoundation.js`: requestId majburiy bo‘lgan to‘lovsiz yaratish/cancel,
  atomar audit va receipt, holat/revision tekshiruvlari, cheklangan no-show sweep.
  Depozitli so‘rov bu bosqichda rad etiladi; pul/seans yozilmaydi.
- GET/PUT `/api/booking-settings`: administrator/menejer uchun tor mahalliy
  sozlama. PUT requestId va expectedRevision talab qiladi, audit yozadi.
  UI hali qo‘shilmagan; boshqa manager sozlamalariga ruxsat kengaytirilmagan.
- Auditda yangi amallar o‘zbekcha nomlanadi. Yangi v2 bronlar DELETE bilan
  o‘chirilmaydi, eski generic status yo‘li orqali o‘zgartirilmaydi.
  Legacy API endi ACTIVE/COMPLETEDni qo‘lda belgilashga ruxsat bermaydi.

**Chegaralar:** yangi bron yaratish/cancel primitivelari hali HTTP/PWA/desktopga
ulanmagan; no-show sweep server timeriga ulanmagan. Oddiy seans/extend/transfer/
member login yo‘llariga availability ulash — B bosqichi. Eski v1 bron API
mosligi hozircha saqlangan; uning requestId va DELETE yo‘llarini almashtirish
ham B/D bosqichida. Bu sabab «bron himoyasi hamma kirish yo‘lida ishlayapti»
degan da’vo qilinmaydi. Pul ledgerlari va check-in C/B bosqichlarida yoziladi.

Yangi test: `tests/booking-foundation.test.mjs` — migratsiya, qayta migratsiya,
xatoda rollback, tarixni saqlash, vaqt/tenant/ruxsat, requestId replay, audit
xatosidagi rollback, no-show va haqiqiy ikki parallel writer. Startup testi
ajratilgan serverda sozlama API auth/revision/replayni ham tekshiradi.

Tekshiruv natijalari: to‘liq `node --test --test-concurrency=1 tests/*.test.mjs`
**285/285** o‘tdi. Shu suite boshlanganidan keyin qo‘shilgan parallel writer testi
va linked-session no-show tekshiruvi bilan yangi modul yana alohida bajarildi:
**10/10**. Cloud/website/brending nusxalari va `git diff --check` o‘tdi.
Suite logi: `.test-output/booking-phase-a-tests.log` (lokal, relizga kiritilmaydi).

UI «Tez orada…» holatida saqlanadi; real booking UI yoki clientning bron
ekrani tayyor deb hisoblanmaydi. Hech qanday reliz, push yoki live migratsiya
bajarilmadi. A yakunida ochiq qolgan bron oxiridan oshish savoli keyinchalik
tasdiqlandi; amaldagi qoida 1-bo‘lim va B bosqichida qayd etilgan.

## 15. B bosqichi — to‘lovsiz bronni seansga ulash

- `cashierSessionStart.js`: oddiy cashier start va booking check-in aynan bitta
  session write/quote modulini ishlatadi; narx `prepaidQuote/pricingEngine`,
  balans rejalari `memberBilling`dan olinadi. To‘lovsiz bron yaratishda pul
  olinmaydi, check-inda odatiy PREPAID yoki balans yechimi bir marta yoziladi.
- POST `/api/bookings/:id/check-in-preview` va `/check-in`: oldindan hisob,
  `expectedRevision`, `quoteRevision`, `requestId`, rol/ruxsat, tenant va
  kutish vaqti tekshiruvi. Holat, seans, pul, booking auditi va receipt bitta
  tranzaksiyada saqlanadi. Javob yo‘qolganda bir xil requestId avvalgi natijani
  qaytaradi. Tarif o‘zgarsa eski hisob bilan ochilmaydi.
- Rejimlar: vaqt, summa, endtime (default bron oxiri), VIP va mijoz balansi.
  Administrator boshqa muddat tanlasa bron oxiridan oshishi mumkin; keyingi
  bron himoyalanadi. VIP uchun kelgusidagi bron ham to‘qnashuv hisoblanadi.
- Oddiy/batch start, member login, prepaid extension va transfer ichida
  tranzaksion bandlik tekshiruvi qo‘shildi. Transfer qilingan seans eski PCni
  bron sababli band tutmaydi; booking session_id orqali kuzatiladi.
- POST yaratish va cancel API yangi requestId/revision himoyasiga o‘tdi.
  Eski `/status` yo‘li faqat tekshirilgan CANCELLEDga ruxsat beradi; DELETE
  ham tarixni o‘chirmasdan faqat shu cancel qoidalari bilan ishlaydi.
  Mobilning eski yaratish/cancel formalariga requestId/revision qo‘shildi;
  ACTIVE/COMPLETEDni qo‘lda belgilash olib tashlandi.
- Saqlangan ACTIVE seans yakunlanganda booking ham COMPLETED bo‘ladi;
  audit va holat seans tranzaksiyasi ichidagi trigger bilan yoziladi.
  Bron bor PCni o‘chirish taqiqlanadi. No-show server qabul qilingan startupdan
  keyin har 5 soniyada cheklangan partiyalarda ishlaydi, update vaqtida to‘xtaydi.
  Xatolar server jarayonini qulatmasdan logga yoziladi; pulli bronlar tegilmaydi.

**Qolgan ishlar:** depozit va uning ledger/report/refund oqimi — C;
odatiy seans modalidan check-in, desktop/mobil yangi bron UI, client ekranidagi
bron yozuvi va protokol mosligi — D. Bu bosqich ushbu UIlar tayyor degani emas.
Yangi check-in hozir mahalliy server API orqali sinovdan o‘tkaziladi;
mobil relay check-in yo‘llari va interfeysi D bosqichida birga ulanadi.

Sinovlar: `booking-sessions.test.mjs` beshta rejimning narx tengligi, replay,
tarif o‘zgarishi, audit xatosida rollback, balans, transfer/extend/member
to‘qnashuvi va completion tarixini tekshiradi. `booking-session-flow.mjs`
ajratilgan haqiqiy HTTP serverida batch rollback, check-in, bar/checkout,
receipt va no-show timerini tekshiradi; startup suite orqali bajariladi.
Haqiqiy klublar bazasi/xizmati yoki kiosk ishga tushirilmadi, reliz/push yo‘q.

**Tekshiruv:** Node 22.23.5 bilan to‘liq suite **287/287 o‘tdi**;
log `.test-output/booking-phase-b-tests.log`. Suite davomida qo‘shilgan
ENDTIME aliasi va customerId tenant tekshiruvi yakunda alohida booking-session
testida qayta tekshirildi — **1/1**. `sync-cloud.mjs --check`, JS syntax va
`git diff --check` ham o‘tdi. Paket versiyasi o‘zgartirilmadi.

## 16. C bosqichi — depozit va umumiy hisob-kitob

`bookingFunds.js` faqat pul manbasini hisobga oladi. Seans narxi va ishlatilgan
vaqt avvalgidek `prepaidQuote`, `pricingEngine`, `memberBilling.prepaidRefund`
va `postpaidGameBill`dan olinadi; bar qarzi `getSessionBarDebt`dan olinadi.
Oddiy seans ham, bron seansi ham `BarLedgerService` orqali yopiladi.

- `payment: {kind: 'CASH'|'BALANCE', amount, userId?}` yaratishda qabul qilinadi.
  `NONE` uchun summa 0; balans manbasi faqat shu klubdagi mijoz bo‘lishi mumkin.
  Depozit alohida `booking_funds` tarixida saqlanadi; o‘yin yoki top-up deb
  darhol yozilmaydi. Balansdan band qilingan summa o‘sha payt bir marta yechiladi.
- Check-in umumiy seans hisobiga depozitni qo‘llaydi. Masalan, 10 000 so‘mlik
  seansga 3 000 depozit bo‘lsa, yangi to‘lov 7 000. `session_funding_allocations`
  asl manbani saqlaydi. Qo‘llangan depozit uchun odatiy seans receipt yozuvi
  asl olingan sana bilan yaratiladi; mijoz balansidan qayta yechilmaydi.
- Ortiqcha depozit yoki cancel/no-show: balansga avtomatik qaytim; naqd esa
  `cashRefundPending`. POST `/api/bookings/:id/refund` uchun `requestId`,
  `expectedRevision`, aynan qaytariladigan `amount`, `confirmed:true` va
  xodimning seans boshqarish ruxsati talab qilinadi.
- Erta yopish, VIP va bar: umumiy hisob topgan o‘yin summasi avval mavjud
  balans to‘lovi, keyin naqd/karta bilan qoplanadi. Ishlatilmagan balans asl
  hisobiga qaytadi; ortgan naqd/karta krediti barni qoplaydi, qolgani qaytim.
  Bu odatiy balansli va naqd seanslarning manba qoidalarini saqlaydi.
- Bronning yaratish/check-in/cancel/qaytim amallari pul, audit, holat va
  idempotency receipt bilan bitta tranzaksiyada. `BOOKING_FUNDS_*` tarixi va
  allocationlar o‘zgarmas; qarzi qolgan PCni o‘chirish taqiqlanadi.
  Eski `*FreeReservation` eksport nomlari moslik uchun saqlangan, lekin
  endi depozitli bronlarni ham shu tekshirilgan oqim boshqaradi.
- Seans ko‘chirilganda ID va pul manbasi saqlanadi. Majburiy to‘xtashda umumiy
  hisoblangan summa saqlanadi, ortgan balans qaytadi, naqd qaytim kassir
  tasdiqlamaguncha berilgan deb yozilmaydi. `session_funding_settlements`
  to‘xtagan seans hisobini keyin yakunlash va takror to‘lovdan himoya uchun.
- Hisobotning GAME/BAR/TOPUP asosi o‘zgarmaydi. Alohida `bookingDeposits`
  cashCaptured/cashRefunded harakatlari va cashHeld/balanceHeld/cashRefundPending
  qoldiqlarini qaytaradi; ular GAME yoki umumiy tushumga yana qo‘shilmaydi.
  Harakatlar sana bo‘yicha, qoldiqlar hisoblash paytidagi holat. Mobil nusxada
  qoldiqlar kunlar bo‘yicha jamlanmaydi, eng so‘nggi sana nusxasidan olinadi;
  bu server o‘chiq paytda jonli qoldiq degani emas.

Migratsiya mavjud db.js startup backup/tranzaksiyasi ichida. Jadval triggerlari
legacy booking qayta qurilishidan keyin o‘rnatiladi. Haqiqiy klub bazalarida
migratsiya bajarilmadi.

**Tekshiruv:** to‘liq Node 22 suite **288/288** o‘tdi
(`.test-output/booking-phase-c-tests.log`). Keyin kengaytirilgan booking
va mobil hisobot testlari **18/18** o‘tdi (`.test-output/booking-c-targeted-final.log`): naqd,
balans, aralash to‘lov, VIP, bar, erta yopish, ortiqcha depozit, cancel/no-show,
replay, audit xatosidagi rollback, tenant/ruxsat, majburiy to‘xtash, tabiiy
tugash, transfer, boshqa kundagi receipt/refund va qayta migratsiya.
HTTP deposit/check-in/refund tekshiruvlari `booking-session-flow.mjs`ga
qo‘shildi; startup suite orqali bajariladi.

HTTP sinovida narx o‘zgarmagan holda quote tasdiqlanishini ba’zan rad etadigan
kasr aniqligi xatosi topildi. `quoteRevision` imzosida faqat ahamiyatsiz kasr
shovqini normallashtirildi; saqlanadigan tarif, vaqt va pul formulasi o‘zgarmadi.
Bir necha soniya kechikib tasdiqlash regressiyasi qo‘shildi; haqiqiy tarif
o‘zgarganda rad etish testi saqlandi. Eski karta extension yozuvlarida
`payment_type` manbasi ham hisobga olinadi.

Ushbu yakuniy tuzatishlardan keyin to‘liq suite qayta bajarildi: **288/288**,
xato 0; `.test-output/booking-phase-c-tests-final.log`. Root va standalone
cloud bilan ajratilgan HTTP sinovlari, jumladan yangi depozit check-in/refund
yo‘llari ham o‘tdi. Cloud/website/brending sinxronligi va `git diff --check` o‘tdi.

**D bosqichida qolganlar:** odatiy seans modalidan bron check-in, depozit va
naqd qaytim tasdiqlash UI, mijoz balansiga qaytgan summa ko‘rinishi, desktop/
mobil bron ro‘yxati, mobil relay va client «Kompyuter bron qilingan» ekrani.
Hozir eski UI/native client ushbu yangi moliyaviy maydonlarni to‘liq ko‘rsatadi
deb hisoblanmasin. Depozitli bron yozilgandan keyin eski, bu manbalarni
tanimaydigan serverga downgrade qilish xavfsizligi hali tekshirilmagan;
tarqatishdan oldin D/E bosqichida update/rollback mosligi sinovi shart.
Paket/EXE/ZIP, commit, push va deploy bu bosqichda bajarilmadi.

## 17. D bosqichi — desktop, mobil va client bron interfeysi

2026-11-21. Kod ishchi nusxada; paket versiyasi hali 1.3.10.

- Desktop «Band qilingan» haqiqiy ro‘yxatga ulandi. Sana/PC filtri, kunlik
  interval ko‘rinishi, 100 tadan sahifalash va barcha sanalardagi naqd qaytim
  filtri mavjud. Tarix bazadan o‘chirilmaydi. `bookingList.js` so‘rovni klubga
  bog‘laydi; `bookingId` filtri aynan bitta bronni yangidan o‘qiydi.
- To‘lovsiz/naqd/balans bron yaratish, bekor qilish, naqd qaytimni tasdiqlash
  `money-requests.js` orqali barqaror requestId bilan yuboriladi. Tranzaksiya
  rollback bo‘lganini server aniq bildirgandagina rad etilgan so‘rov tozalanadi.
- «Mijoz keldi» yangi billing oynasi yaratmaydi: mavjud `openStartModal`,
  `setStartMode`, `handleStartSession` ishlaydi. Vaqt/summa/tugash vaqti/VIP/
  mijoz hisobidan rejimlari `/check-in-preview` va `/check-in`ga ulanadi.
  Quote/revision eskirsa server qayta tasdiqlashni talab qiladi. Oddiy PC
  ochilganda bron konteksti tozalanadi. Boshlang‘ich tanlov — bron tugash vaqti.
- Mobil administrator ham shu server APIlarini ishlatadi. `booking-time.js`
  telefonning vaqt zonasidan qat’i nazar klubning IANA vaqt zonasidan UTC
  instant yaratadi; mavjud bo‘lmagan yoki ikki marta uchraydigan DST vaqti rad
  etiladi. Preview moliyaviy write sifatida snapshotni kutmaydi. Balans depoziti
  asl mijozga bog‘langan; checkoutda balans qaytimi naqd qaytimdan alohida.
- Kutish sozlamasi administrator va menejerga ochiq, hatto administratorning
  seans boshqarish ruxsati bo‘lmasa ham. Boshqa bron amallari seans ruxsatini
  talab qiladi; mobil menejerga seans/bar vakolati ochilmadi.
- `BOOKING_STATE` handshake, heartbeat va 5 soniyalik sweepda uzatiladi.
  Client bo‘sh va joriy bron kutayotgan bo‘lsa login/QR o‘rnida «Kompyuter bron
  qilingan» ko‘rinadi. Faol seans uzilmaydi, bronning o‘zi seans ochmaydi.
  Cancel/no-showdan keyin server loginni qaytaradi. Aloqa uzilganda rezerv
  ekrani o‘zicha qulfni ochmaydi; reconnect yangi holatni beradi.
- Paket PC raqami va server vaqtiga bog‘langan; begona/eski xabarlar rad etiladi.
  Shaxsiy ism/telefon/depozit clientga yuborilmaydi. Client
  `bookingScreenVersion:1` bildiradi. Eski/offline client bu imkoniyatni
  tasdiqlamasa seans oynasida yangilash/aloqa ogohlantirishi chiqadi; eski
  clientning qonuniy seanslari to‘xtatilmaydi. API/login collision himoyasi
  client versiyasidan mustaqil ishlaydi.
- Ulangan, faol seanssiz joriy bronli PC holati `RESERVED`, to‘q sariq.
  Aloqa yo‘q bo‘lsa offline belgisi ustun; kelajakdagi bron darhol bloklamaydi.

Tekshiruvlar:

- Node 22 to‘liq suite **291/291**:
  `.test-output/booking-phase-d-tests-final.log`.
- Oxirgi grace/role/list/24h o‘zgarishlari va oddiy prepaid regressiyasi
  **17/17**: `.test-output/booking-ui-final-unit.log`.
- Headless Edge: `tests/booking-ui-browser.mjs` — desktopning besh rejimi,
  depozit, javob yo‘qolganda requestId saqlanishi, modal kontekstining
  tozalanishi, mobil yarim tun/klub vaqti va check-in. Grid/table umumiy
  amallari `tests/pc-actions-browser.mjs` orqali ham tekshirildi.
- WPF `ClientProtocol` build va real localhost WS sinovi: rezerv/login
  almashtirish, loginni ichki guard bilan rad etish, bekor qilish, begona/stale
  paket, reconnect, capability, balans qaytimi xabari. Kiosk asosiy oynasi
  ko‘rsatilmagan, Windows hook/service o‘rnatilmagan, power buyruqlari bajarilmagan.
  Buildda avvalgi nullable warninglar bor, compile error yo‘q.
- Ajratilgan real cloud/club relay: mobil depozit 3 000, seans budjeti
  10 000, qo‘shimcha to‘lov 7 000; menejer rad etilishi, check-in retry,
  checkout va desktop hisobot bilan bir xil ledger tekshirildi.
- Root/standalone cloud nusxalari `sync-cloud.mjs` orqali sinxronlangan.

E bosqichida qolganlar: disposable Windows VMda o‘rnatilgan server+client
paketi bilan to‘liq qabul sinovi, elektr/LAN uzilishi va qayta ishga tushish,
yangi moliyaviy ledgerdan eski binarga rollback siyosati, yangi bron yaratishni
to‘xtatuvchi feature flag, keyin bitta test klubda kuzatuv. Native UI sinovi
real klubda o‘rnatilgan reliz sinovi o‘rnini bosmaydi. Bu bosqichda release,
commit, push, production migratsiya yoki mavjud klublarga o‘rnatish bajarilmadi.

## 18. E bosqichi — uzilish, tiklash va tarqatish himoyasi

2026-11-21. **Avtomatlashtirilgan qism bajarildi; VM/pilot qabul sinovi hali ochiq.**
Manba versiyasi 1.3.10; yangi reliz, commit, push yoki klublarga o‘rnatish qilinmadi.

### Yangi bronlarni vaqtincha to‘xtatish

Desktop «Band qilingan → Bron sozlamalari», mobil administratorning bron
bo‘limi va mobil menejer sozlamalarida «Yangi bron qabul qilish» tanlovi bor.
Administrator va menejer o‘zgartiradi; oddiy mijoz o‘zgartira olmaydi.

- `booking_settings.creation_enabled` klub bo‘yicha saqlanadi; migratsiya
  takrorlansa to‘xtatilgan holat qayta yoqilmaydi. Boshlang‘ich holat yoqilgan.
- O‘chirish faqat yangi bron yaratishni to‘xtatadi. Mavjud bronni ko‘rish,
  seansga aylantirish, bekor qilish, qaytim, no-show va collision ishlaydi.
- Tekshiruv yozish tranzaksiyasi ichida, saqlangan requestId replayidan keyin.
  Javobi yo‘qolgan, allaqachon saqlangan bron qayta yaratilmaydi va yo‘qolmaydi.
- Eski UI faqat graceMinutes yuborsa, creationEnabled holati saqlanadi.
  Revision eskirsa yangi sozlama ustidan yozish rad etiladi; audit saqlanadi.
- Desktop sozlama so‘rovi noaniq javobdan keyin o‘sha requestId bilan takrorlanadi.
  ID yaratish oddiy HTTP LAN sahifasida ham ishlaydi (`getRandomValues`).

### Avtomatik tiklash va eski versiyaga qaytish chegarasi

Mavjud updaterning probation davrida API biznes yozuvlari, client buyruqlari,
bron sweepi va mobil amallar ochilmaydi. Yangilanish tasdiqlanmasdan buzilsa,
avvalgi kod va unga mos baza nusxasi birgalikda tiklanadi. Tiklashdan oldin
zaxira hash va server jarayoni egaligi tekshiriladi.

Yangilanish `ACCEPTED` bo‘lgach yangi depozit/seans yozilishi mumkin. Shu sabab
avtomatik eski bazaga qaytish taqiqlangan. Bu qoida endi `UpdateJournal.Restore`
ichida ham tekshiriladi: chaqiruvchi kod adashsa ham tasdiqlangan tranzaksiyani
tiklash rad etiladi. `Recover` esa qabul qilingan bazani saqlaydi.

**Qo‘lda eski setup o‘rnatish alohida xavf:** eski, bron ledgerini bilmaydigan
binarning ichiga yangi tekshiruvni orqadan qo‘sha olmaymiz. Bron depoziti yoki
seansi ishlatilgach eski setup/ZIPni ustidan o‘rnatmang. Muammoli bronni avval
yuqoridagi sozlamadan yangi yozuvlarga yoping, mavjud bron/qaytimlarni yangi
kod orqali yakunlang va ma’lumotni saqlaydigan tuzatilgan reliz tayyorlang.
Eski DB zaxirasini ko‘chirib yangi pul tarixini yo‘qotish rollback yechimi emas.

### Bajarilgan tekshiruvlar

- To‘liq Node suite **302/302**, `.test-output/booking-e-full.log`. Oddiy
  billing, bar, balans, HTTP booking, ikki cloud nusxasi va mobil relay ham kiradi.
- Keyin qo‘shilgan check-in crash sinovlari **4/4**,
  `.test-output/booking-e-checkin-crash.log`: naqd/balans bronidan seans yozilishi
  COMMITdan oldin va keyin child processni majburan to‘xtatish; qayta ishga
  tushish/retry bitta seans, bitta depozit qo‘llanishi va jami 10 000 saqlaydi.
- `booking-recovery.test.mjs`ning 10 ssenariysi full suitega kirgan: create,
  cancel va cash refund COMMITdan oldin/keyin uziladi. Uncommitted yozuv
  qolmaydi; committed receipt qaytadi; balans va audit takrorlanmaydi.
- `UpdatePolicy` Windows sinovlari o‘tdi: fayl bandligi, service stop, zaxira
  yaxlitligi, interruption va bevosita ACCEPTED restore rad etilishi.
- Haqiqiy Windows updater + ajratilgan Node/SQLite: success, rollback,
  interrupted va restart **4/4**, `.test-output/booking-e-ota-final.log`.
  Qabul qilingan yangilanishdan keyingi 3 000 depozit va requestId tiklashda
  saqlandi. O‘rnatilgan klub xizmati ishga tushirilmadi/o‘zgartirilmadi.
- Headless Edge desktop va mobil sinovi o‘tdi; desktop HTTP LAN muhiti,
  sozlama retry IDsi, odatiy beshta seans rejimi va mobil klub vaqti tekshirildi.
  `.test-output/booking-e-browser.log`. GitHub workflowga shu browser sinovi
  va log/rasm artifacti qo‘shildi; yangi workflow GitHubda hali bajarilmadi.
- Cloud mirror va `git diff --check` o‘tdi. Updater buildda avvaldan mavjud
  `VersionInfo.cs` nullable warning qoldi, build error yo‘q.

### Qolgan qabul sinovi — tarqatishdan oldin

Hyper-V inventari `Get-VM` bilan tekshirildi, lekin Windows hisobi ruxsati
yetishmadi. VMdagi EXE o‘rnatish, fizik elektr/LAN uzilishi bajarilgan deb
hisoblanmaydi. Process kill sinovi disk/kontroller nosozligini to‘liq taqlid qilmaydi.

1. Alohida server+client test VM va yangi test klub IDsi; ishlab turgan klub
   bazasi/litsenziyasini ularga ko‘chirmaslik. O‘rnatishdan oldin VM checkpoint.
2. Yangi yig‘ilgan server/client setup: yangi va eski sxemadan upgrade;
   server qayta ishga tushganda bronlar, balans va pul tarixi saqlanishi.
3. 0/naqd/balans bron; vaqt boshlanganda clientda login o‘rniga bron ekrani;
   check-in ochishi; cancel/no-show loginni qaytarishi. Eski clientda server
   to‘qnashuvni rad etishi, yangi ekran kafolati berilmasligi.
4. Beshta check-in rejimi, ikki kassirning bir vaqtdagi amali, bar bilan erta
   yopish, qisman depozit/ortiqcha depozit va naqd/balans qaytimi.
5. Faqat test VM tarmog‘ini uzish va server jarayonini to‘xtatish; reconnectdan
   keyin bitta seans/bitta to‘lov, bron holati va auditni tekshirish.
6. Bron yaratishni to‘xtatib eski bronni check-in/cancel/refund qilish;
   server restartdan keyin to‘xtatilgan holat saqlanishi.
7. Qabul natijalari yozilgach alohida versiya/build qarori; bitta test klubda
   administrator bilan kuzatuv. Shundan keyingina boshqa klublarga tarqatish.

Bu bandlar bajarilmaguncha E bosqichi to‘liq yopilmaydi va keng tarqatish
tayyor deb belgilanmaydi.

## 19. 1.3.11 commit oldi qayta tekshiruv — 2026-11-21

Foydalanuvchi yangi versiya va commitni so‘radi. Barcha source package va
Windows metadata 1.3.11, RELEASE-NOTES hamda qisqa staff taqdimoti moslandi.

Qayta ko‘rishda tuzatildi:
- Mobil balans depoziti egasi tanlovi qulflangan bo‘lgani uchun FormData uni
  yubormasdi; qo‘shimcha to‘lovni BALANCE bilan tanlash xato rad etilardi.
  Endi haqiqiy requestdagi bog‘langan mijoz tekshiriladi; backend binding saqlandi.
- Desktop PC kartasidagi bronni ochish tarixiy ro‘yxat filtri/sahifasiga bog‘liq
  edi. Endi PCdagi joriy bookingId orqali bron yangidan o‘qiladi. Xato tutuvchi
  handler PC argumentini tashlab yuborishi ham tuzatildi.
- Ushbu ikki oqim uchun browser regression qo‘shildi va o‘tdi.

Tekshiruv: to‘liq 306 testning 305 tasi o‘tdi; yagona xato yangi versiya uchun
staff taqdimoti yo‘qligi bo‘ldi (`.test-output/release-1.3.11-tests.log`). Taqdimot
qo‘shilgach release-presentation + version testlari **6/6** o‘tdi
(`.test-output/release-1.3.11-metadata.log`). Bu data tuzatishidan keyin to‘liq
suite takror bajarilmadi. Browser, native ClientProtocol build/WS va ajratilgan
PostgreSQL API audit ham o‘tdi. Cloud mirror va staged diff tekshirildi.

VM/pilot cheklovi o‘zgarmadi. Ushbu commit yangi EXE/ZIP yig‘ilgan, GitHubga
push qilingan yoki ishlayotgan klublarga yetkazilganini anglatmaydi.

## 20. Guruhli bron va teng depozit — 2026-11-21

Foydalanuvchi tasdiqlagan qo‘shimcha: bir nechta belgilangan PC uchun bitta
jami depozit; har PCga teng ulush. VIP yakunida yoki prepaid ochishda shu
PCning ulushi ayriladi. Desktop va mobil ekranlar bir xil server hisobini oladi.

Amalga oshirildi:
- `bookings.group_id` migratsiyasi va indeksi; eski bronlar saqlanadi.
- `computerIds` bilan yaratish atomar; readonly allocation-preview. PC raqami
  tartibida butun so‘m qoldig‘i taqsimlanadi: 20000/3 → 6667,6667,6666.
- Har bir bron CAPTURE/APPLY/REFUND tarixi bilan alohida saqlanadi.
- Guruh check-in odatiy cashier quote/write orqali bitta tranzaksiyada.
  Vaqt/summa inputi har bir PC uchun; turli xona tariflari alohida hisoblanadi.
- Guruh checkout mavjud BarLedgerService orqali; barcha seans/pul/receipt
  yozuvlari atomar. Bitta PC avval yopilgan bo‘lsa yana undirilmaydi.
  Client bildirishnomalari faqat commitdan keyin yuboriladi.
- 20000 depozit + 5 PCda jami 50000 VIP o‘yini → 30000 olinadi.
  Hisobotga jami 50000 yoziladi; depozit ikkinchi tushum qilib qo‘shilmaydi.
- Balans depozitining ortig‘i asl balansga qaytadi; bar uchun naqd to‘lov
  bilan aralashtirilmaydi. Naqd guruh qaytimi va naqd qarzi o‘zaro ayriladi.
  Karta to‘lovi va boshqa PCning naqd qaytimi esa alohida ko‘rsatiladi;
  to‘lov usuli o‘zgarsa, UI server bergan tegishli hisobni ko‘rsatadi.
- Desktop drag-selection «Bron qilish»; desktop/mobil ko‘p PC tanlash,
  har PC depoziti, oldindan olingan summa va katta qolgan to‘lov.
  Guruhni ochish/yopish hamda har PCni alohida boshqarish saqlanadi.
- Mobil relay allowlist/RBAC/preview yo‘llari, yangi offline asset va cloud mirror.

Tekshiruv dalillari:
- To‘liq Node suite **307/307**: `.test-output/group-full.log`.
- Keyingi guruh wallet/bar/qaytim, aralash naqd/karta va rol sinovlari **6/6**:
  `.test-output/group-final-focused.log`.
- Desktop va 390px mobil Edge: `.test-output/group-browser-final.log`;
  `booking-group-*.png`. Tanlangan PClar, taqsimot, guruh quote/check-in,
  umumiy yakuniy hisob va oldingi beshta seans rejimi tekshirildi.
- Group checkoutdagi oxirgi PC yozuvini ataylab yiqitish barcha oldingi
  yozuvlarni ham rollback qiladi. Qayta requestId bitta to‘lovni qaytaradi.
- Birinchi qo‘shimcha relay testida funksiyalar o‘tdi, lekin boshqa test bilan
  bir xil 973-PC ishlatilgani sabab keyingi prepaid fixture yiqildi; test PC
  raqami ajratildi. Bu mahsulotdagi tarif/to‘lov o‘zgarishi bilan yashirilmadi.
- Ajratilgan haqiqiy cloud → mobil relay → klub serveri guruhi va qolgan
  startup oqimi qayta **o‘tdi**: `.test-output/group-mobile-http-final.log`.
  Taqsimlash, groupId ro‘yxati, menejer rad etilishi, quote, ochish/yopish va
  takroriy requestId natijasi tekshirildi. Keyingi naqd/karta taqdimoti
  tuzatishidan so‘ng focused va browser testlari bajarildi; to‘liq 307 suite
  shu oxirgi kichik tuzatishdan keyin takror bajarilmadi.

Bu ish source holatida. Yangi versiya/commit/push/build bajarilmadi;
ishlayotgan klub bazasi yoki o‘rnatilgan dasturiga tegilmadi. Oldingi VM/pilot
qabul cheklovi saqlanadi. Server yangilanishi va mobil deploy birga kerak.

## 21. O‘rnatish oldidan qayta audit — 2026-11-21

Guruhli bron va oldingi amallar bilan birga yakuniy Node suite **308/308** o‘tdi.
Uzaytirilgan depozitli seans qaytimi, oddiy naqd/karta seansidagi tarif oralig‘i,
bar to‘lov manbasi va hisobot PC nomi tuzatildi. Browser/native client va
ajratilgan PostgreSQL API tekshiruvlari ham o‘tdi. Aniq reproduksiya, loglar,
eski yozuvlar chegarasi va VM/pilot tartibi:
`docs/PREINSTALL-AUDIT-2026-11-21.md`.
Bu hali yangi build/deploy emas; mavjud klublar o‘zgartirilmadi.
