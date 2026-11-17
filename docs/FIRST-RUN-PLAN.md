# Klubni birinchi sozlash va amaliy tanishtirish

Holat: 2026-11-17. 1–4-bosqichlar kodda bajarildi: qoralama, to‘liq ekranli usta, atomar yakunlash va amaliy tanishtirish.
Yangi, hali sozlanmagan klubda menejer ustaga avtomatik kiradi; administrator sozlash tugashini kutadi.
Ishlayotgan klub odatdagidek ochiladi; menejer Sozlamalar → Klubni sozlash orqali ustani qayta ochishi mumkin.
Cyberpunk faollashish animatsiyasi va amaliy tanishtirish ulandi. Foydalanuvchi topshirig‘i bilan 1.3.7 relizga tayyorlandi. Setup.exe bilan VM sinovi hali bajarilmagan; quyidagi tekshiruv chegaralari saqlanadi.

## Tasdiqlangan qoidalar

- Faqat yangi klubda avtomatik ochiladi. Ishlayotgan klub yangilanishdan keyin odatdagidek ishlaydi; ustani menejer sozlamadan ochishi mumkin.
- Sozlashni faqat menejer bajaradi. Yangi klub administratori «Menejer klubni sozlamoqda» oynasini ko‘radi. Hisobdan chiqish va yordam olish imkoniyati qoladi.
- Ishni boshlashdan oldin barcha rejalashtirilgan clientlar haqiqiy, yangi aloqaga ega bo‘lishi kerak. Faqat bazadagi ONLINE yozuvi yetmaydi.
- Hozir barcha klublarda har bir xona tarifi haftaning 7 kuni, kuniga 24 soatni qoplashi shart. Bo‘sh yoki ustma-ust oraliqlar bilan yakunlab bo‘lmaydi.
- Bir marta yakunlangan sozlashni keyingi internet/PC uzilishi yoki yangilanish qaytadan majburiy ochmaydi.
- Litsenziya va super admin bergan akkauntlar avvalgi tekshiruvlaridan o‘tadi. Usta litsenziyani yoki ruxsatlarni almashtirmaydi.

## Foydalanuvchi ko‘radigan ketma-ketlik

1. **Xush kelibsiz.** Klub nomi, litsenziya limiti va «Klubni tayyorlash». Yon menyu, kassa va hisobot tugmalari ko‘rinmaydi.
2. **Zalni tayyorlang.** PC soni → xonalarni chizish/nomlash → PC’larni xonalarga joylashtirish. Ulangan clientlarning haqiqiy IP/MAC manzillarini tanlash; qo‘lda kiritish ham mumkin. IP yozish Windows tarmoq sozlamasini o‘zgartirmaydi.
3. **Tariflarni sozlang.** Har xona uchun kunlar, vaqt oralig‘i va narx. Oddiy boshlash: haftaning barcha kunlari uchun bitta soatlik narx; keyin alohida oraliqlar. VIP Postpaid ruxsati va narxlash qoidasi alohida tushuntiriladi. Amaldagi pricingEngine hisobidan misol ko‘rsatiladi; ikkinchi hisoblash mexanizmi yaratilmaydi.
4. **Tekshiring.** PC soni, xonalar, takrorlangan raqam/IP/MAC, xona biriktirish, tarifdagi bo‘sh va kesishgan oraliqlar, barcha clientlarning jonli aloqasi. Noto‘g‘ri joy yonida sodda xabar va o‘sha bosqichga qaytish tugmasi.
5. **Saqlash va ishni boshlash.** Server holatni yana tekshiradi va bitta tranzaksiyada yakunlaydi. Tasdiq kelmaguncha muvaffaqiyat animatsiyasi chiqmaydi. Saqlangan natija takror bosishda qayta yaratilmaydi.
6. **Tizim tayyor.** 1–2 soniyali qora/yashil cyberpunk yoritilish. Miltillashsiz, ovozsiz; animatsiyani kamaytirish sozlamasini hurmat qiladi. Animatsiya ishlamasa ham kassa ochiladi.
7. **Qisqa amaliy tanishtirish.** «Kompyuterni tanlang» → «Seans ochish» → «Vaqt / summa / tugash vaqti / VIP» → «Bar» → «Yakuniy hisob». Ekrandagi joy ajratib ko‘rsatiladi. Haqiqiy pullik seans yoki savdo avtomatik yaratilmaydi. «Keyinroq», «Orqaga» va sozlamadan qayta ko‘rish mavjud. Menejer va administrator uchun ko‘rsatmalar ruxsatlariga mos bo‘ladi.

## Bosqichlar va tugallanish mezonlari

### 1. Xavfsiz asos — bajarilgan bosqich

- Alohida, klubga bog‘langan qoralama; haqiqiy xona, PC, tarif va pul jadvallariga yozmaydi.
- Har saqlashda revision: ikki oyna bir-birining yangiroq ma’lumotini bosib ketmaydi.
- Eski bazalar konservativ ravishda mavjud klub hisoblanadi; yangi o‘rnatish holati restartdan keyin ham saqlanadi.
- Tayyorlikni server tekshiradi. IP va PC nomi orqali taxminiy online holat yaratilmaydi.
- Yangi API’lar litsenziya va xodim ruxsatlari bilan himoyalanadi; bu bosqich mavjud kassa oqimini to‘sib qo‘ymaydi.
- Testlar: restart, eski baza, rollar, boshqa klub, noto‘g‘ri ma’lumot, revision to‘qnashuvi, eskirgan/uzilgan aloqa, qoralama moliyaga ta’sir qilmasligi.

Amalga oshirilgan fayllar: `NetCafeServer/src/services/clubSetup.js`, `src/db.js` va `src/server.js`.
`GET /api/setup/draft` va `PUT /api/setup/draft` faqat `club_owner` uchun; klub ID login sessiyasidan olinadi.
Yozish uchun `{ revision, draft }` yuboriladi. To‘qnashuv `409`, noto‘g‘ri qoralama `400`, buzilgan saqlangan qoralama `503` qaytaradi.
Clientning jonli holati shu klubdagi aniq PC ID, ochiq socket va amaldagi HeartbeatMonitor muddati bilan tekshiriladi.
Bu bosqichda `draftValid` faqat kiritilgan qoralama tekshiruvini bildiradi; `canCommit` har doim `false`.
1-bosqichning o‘zida yakunlash endpointi va avtomatik ochilish yo‘q edi; ular quyidagi 3-bosqichda qo‘shildi.

Tekshiruv (2026-11-17): `npm.cmd test` — 255/255 o‘tdi. Shundan 7 ta yangi alohida qoralama/tayyorlik testi;
ikkala bulut varianti bilan mavjud startup sinoviga haqiqiy setup API tekshiruvlari qo‘shildi.
Barcha sinovlar alohida test bazalarida bajarildi. Usta UI hali yo‘qligi sabab uning ko‘rinishi va VM dagi to‘liq birinchi sozlash oqimi hali sinovdan o‘tmagan.

### 2. Usta oynalari va xona chizish

- Alohida ekran, bosqich indikatori, saqlanish holati, aniq xatolar va faollashadigan «Keyingi».
- Klaviatura bilan ishlash, 1366×768 va kichikroq ish maydonlari, scroll va modal o‘lchamlari tekshiriladi.
- Avtomatik topilgan clientlar bilan qo‘lda kiritilgan PC’lar bir-biriga xavfsiz bog‘lanadi; ortiqcha PC avtomatik yaratilmaydi.
- Ishlayotgan klubda mavjud ma’lumotlar avval o‘qiladi, o‘zgarishlar ko‘rsatiladi; faol seans egasi yoki tarifi bexosdan almashtirilmaydi.

**Bajarildi:**

- `public/club-setup.html`, `.css`, `.js` va `club-setup-model.js`: qora/yashil, tashqi kutubxona yoki internetga bog‘liq bo‘lmagan alohida ekran.
- Xonalar: sichqoncha bilan to‘rtburchak chizish, nom/tur/o‘lcham/joylashuv, sudrash va klaviatura strelkalari, tanlangan xonaga yaqinlashish. Mavjud ko‘pburchak shakli saqlanadi; uning cho‘qqilarini tahrirlash bu ustaga qo‘shilmagan.
- Kompyuterlar: rejalangan son, mavjudlarini saqlagan holda yetishmayotganlarini qo‘shish, xona va xaritadagi joy, IP/MAC, haqiqiy ulangan clientdan tanlash. Tanlash yangi PC yaratmaydi; bir clientni ikki PC’ga bog‘lash rad etiladi.
- Tariflar: xonaga tegishli vaqt oralig‘ini qo‘shish/o‘chirish, nom, hafta kunlari, 24 soatlik vaqt maydonlari, soatlik narx va VIP Postpaid ruxsati.
- Serverning mavjud tekshiruvlari “Keyingi” holatini belgilaydi. Client ulanishi tugallanmagan bo‘lsa ham tariflarni tayyorlash mumkin; barcha clientlar ulanganligi yakuniy tayyorlik talabidir.
- Qoralama tahrirdan keyin avtomatik saqlanadi. Yozish davomida fokus saqlanadi, kechikkan javob yangi matnni bosmaydi. Xatoda aniq saqlanmagan holat, takror urinish, to‘qnashuvda qoralamani yuklab olish va server nusxasiga tasdiq bilan qaytish bor.
- “Tekshirish” oynasi muammoli elementga qaytaradi, usta ochilgandagi sozlamalar bilan o‘zgarishlarni taqqoslaydi.
- `GET /api/setup/context`: menejerga o‘z klubining mavjud xona/PC/tariflari va jonli clientlarini qaytaradi. PC-0, boshqa klub va eski heartbeat online hisoblanmaydi. Umumiy/paket tariflari alohida ko‘rsatiladi, boshqa turga aylantirilmaydi.
- Ustani ochishning o‘zi qoralamani ham yozmaydi: mavjud ma’lumotni birinchi tahrir yoki alohida saqlashdan keyin saqlaydi. Amaldagi biznes jadvallariga yozish yo‘q.

Tekshiruv: umumiy `npm.cmd test` — 258/258; undan keyin qo‘shilgan `club-setup-context.test.mjs` — 2/2.
`node tests/club-setup-browser.mjs` — xona chizish va dragni bekor qilish, PC biriktirish, tariflar, 24 soatlik format,
qayta ochish, yozish vaqtida kechikkan javob, javobi yo‘qolgan saqlash/to‘qnashuv, offline holat va ruxsatsiz kirish sinovlari o‘tdi.
Har tahrirlash bosqichi 1366×768, 1024×600 va 390×844 o‘lchamlarida tekshirildi. Namuna rasmlar `.test-output/setup-ui/` ichida.
Sinovlar ajratilgan bazalar va lokal test HTTP serverida bajarildi; ishlab turgan klublarga ulanilmadi.

Qo‘lda ko‘rish: yangi manba kodi bilan ishga tushgan lokal serverda menejer sifatida kiring → Sozlamalar → Klubni sozlash.
2-bosqichda faqat qoralama saqlanardi. Yakuniy “Saqlash va ishni boshlash” quyidagi 3-bosqichda qo‘shildi.

### 3. Atomar yakunlash va yangi klubga ulash

**Bajarildi:**

- `GET /api/setup/status`: yangi klubning tugallanmagan sozlashi serverda saqlanadi. Keyinchalik client uzilishi yoki server restarti tugallangan ustani qayta majburiy ochmaydi.
- `POST /api/setup/complete`: faqat menejer, amaldagi litsenziya va o‘z klubiga tegishli qoralama. So‘rov kelgach rol/litsenziya qayta tekshiriladi.
- Bitta `BEGIN IMMEDIATE` tranzaksiyasi: 24/7 tarif, kesishish, reja, barcha haqiqiy clientlar va faol seans yo‘qligi tekshiriladi. Xona, PC biriktirish, xarita, tariflar, tugallanish holati va natija tasdig‘i birga saqlanadi. Xatoda hammasi avvalgi holatda qoladi.
- Mavjud PC ID va xona ID saqlanadi. Eski xona tariflari tarix uchun qoladi va nofaol qilinadi. Umumiy/paket tariflari saqlanadi. Balans, seans, savdo va moliyaviy hisobot jadvallariga yozilmaydi.
- Usta ochilgandagi bazaning belgilangan nusxasi tekshiriladi. Boshqa oynadan xona/tarif/PC o‘zgartirilgan bo‘lsa, farqlarni ko‘rib, “Amaldagi holatni tekshirish” orqali tasdiqlash kerak. Heartbeat kabi doimiy o‘zgarishlar bu tekshiruvga aralashmaydi.
- Har yakunlashning alohida so‘rov raqami va bazada saqlanadigan tasdig‘i bor. Javob yo‘qolsa “Natijani tekshirish” o‘sha raqam bilan avvalgi natijani oladi. Oynani qayta yuklash ham yangi qo‘llash yaratmaydi.
- Yangi klub menejeri asosiy menyudan oldin ustaga o‘tadi. Administrator kutish oynasida qoladi; sozlash tugagach kassa ochiladi. Kutishda hisobdan chiqish va yordam tugmalari bor. Reliz taqdimoti tayyorlik tekshiruvi tugamaguncha ochilmaydi.
- Tugallanmagan yangi klubda server ham biznes yozuvlarini va clientdan pullik seans boshlashni rad etadi. Clientlar ulanishi, litsenziya, login va tiklash/yangilash oqimlari qoladi.
- Ishlayotgan klublar avtomatik to‘silmaydi. Qoralama-only eski tuzilishda NEW deb belgilangan, ammo allaqachon xona/hisobot/seanslari bor klub ham yangilanishda EXISTING bo‘lib qoladi.

**Chegaralar:** mavjud PC’ni o‘chirish/qayta raqamlash yoki xonani o‘chirish bu usta orqali qo‘llanmaydi; bunday o‘zgarish amaldagi asosiy sozlamalarda qilinadi. Ishlayotgan klubdagi faol seanslar tugamaguncha qayta sozlash qo‘llanmaydi. Qoralamani oldindan tayyorlash mumkin. Usta IP maydoni Windows adapterining manzilini o‘zgartirmaydi.

**Tekshiruv:** `tests/club-setup*.test.mjs` — saqlash, barcha xona turlari, tariflar, rollar, tenant chegarasi, uzilgan client, eskirgan nusxa, faol seans, rollback va restartdan keyingi takror so‘rovlar. `tests/startup.test.mjs` ichida haqiqiy server/client WebSocket bilan yangi klubni yakunlash, bir vaqtdagi takror yuborish va saqlangan 7 000 so‘mlik tarifni mavjud hisoblash API’sida olish tekshiriladi.
`node tests/club-setup-browser.mjs` — barcha usta bosqichlari, 24/7 talabi, javob yo‘qolishi + reload, menejer yo‘naltirilishi, administrator kutishi, ishlayotgan klub va aloqa xatosi; 1366×768, 1024×600, 390×844 ekranlari. Sinovlar lokal, ajratilgan bazalarda bajariladi. Haqiqiy Windows VM’da setup.exe bilan to‘liq o‘rnatish tekshiruvi relizdan oldin hali kerak.

Natija (2026-11-17): umumiy `npm.cmd test` — **265/265** (Node 24.18.0); brauzer sinovi o‘tdi. Reliz runtime’i **Node 22.23.5** bilan 17 ta setup testi va ikkala bulut varianti bilan haqiqiy startup integratsiyasi ham o‘tdi. Node 22 SQLite matnida NUL o‘qilishi farq qilgani uchun buzilgan qoralama saqlanishi testi matnni emas, bazadagi aniq baytlarni tekshiradi.

### 4. Amaliy tanishtirish va animatsiya

**Bajarildi:** `public/onboarding.js` va `onboarding.css`; asosiy kassa autentifikatsiyasi, sozlama va reliz taqdimoti bilan ulangan.

- Server tasdiqlagan NEW klubning `completedAt` holatidan keyin bir martalik, 1,7 soniyali faollashish: Softech belgisi, yashil yorug‘lik, fazoviy to‘r va “Klubingiz tayyor”. Ovoz va chaqnash yo‘q; “Davom etish” darhol o‘tkazadi. Animatsiya tugash hodisasiga bog‘liq emas.
- Administratorga 6 qadam: kirish → PC → seans turlari → bar → to‘lov/qaytim → tayyor. Menejerga qo‘shimcha xona tarifi va hisobot, jami 8 qadam.
- Haqiqiy grid, jadval yoki 2D xaritadagi ko‘rinib turgan PC ajratib ko‘rsatiladi. U joydagi mashq tugmasi haqiqiy PC amalini chaqirmaydi. Nishon yo‘q, yashirin yoki ekrandan tashqarida bo‘lsa namuna oynasi qoladi; ko‘rinish, scroll yoki ochiq tahrir oynasi majburan almashtirilmaydi.
- Seans turlari, namunaviy Cola va 0 so‘m / qo‘shimcha to‘lov / qaytim misollari bosib ko‘riladi. Barchasi NAMUNA deb belgilangan. Biznes API chaqiruvi, savat o‘zgarishi yoki pul hisoblashning ikkinchi mexanizmi yo‘q; misollar oldindan berilgan tushuntirishlardir.
- Qadamlar va “Keyinroq” holati shu brauzerda klub, akkaunt, rol va birinchi sozlash vaqti bo‘yicha saqlanadi. Boshqa akkaunt o‘z tanishtirishini oladi. Pauzadan keyin avtomatik qayta chiqmaydi; Sozlama → Qisqa tanishtirish qolgan joydan davom ettiradi. Tugatilgan tanishtirish qo‘lda boshidan ochiladi.
- Klaviatura orqali kassa amallari mashq ostida ishga tushmaydi. Tab fokusni tanishtirish ichida saqlaydi, Esc yopadi. Litsenziya bloklansa, login oynasi ochilsa yoki akkaunt almashtirilsa mashq to‘xtaydi. Reliz taqdimoti bilan ustma-ust ochilmaydi.
- `prefers-reduced-motion` rejimida bezak harakati o‘chadi. CSS yuklanmasa tanishtirish kassa ustini to‘sib qo‘ymaydi. localStorage’ga yozish rad etilsa tanishtirish joriy oynada davom etadi (qayta ochishda eslab qolish kafolatlanmaydi).

Tekshiruv: `node tests/onboarding-browser.mjs` haqiqiy kassa HTML maketi bilan Edge’da bajarildi. Har uch ko‘rinish, haqiqiy amalga bosish o‘tmasligi, biznes so‘rovlari **0 ta**, rol farqi, resume/reload, chiqish/blok, reliz bilan to‘qnashuv, animatsiyani kamaytirish hamda 1366×768, 1024×600, 390×844 va 568×320 o‘lchamlari tekshirildi. Rasmlar: `.test-output/onboarding/`. Real setup.exe va client bilan VM tekshiruvi 5-bosqichda qoladi.

4-bosqichdan keyin Node **22.23.5** bilan umumiy **265/265** test o‘tdi, cloud mirror tekshiruvi o‘tdi. Tutorial uchun alohida brauzer testi ham o‘tdi; litsenziya yoki kassa amallariga ishlab turgan klublarda murojaat qilinmadi.

### 5. Relizdan oldingi alohida sinov

- Bo‘sh VM: litsenziya → menejer → xona/PC → tarif → barcha clientlar → tayyor → birinchi haqiqiy seans.
- Har bosqichda oynani yopish, server restarti va tarmoq uzilishi.
- Ishlayotgan klub nusxasi: balanslar, savdolar, hisobotlar, faol seanslar o‘zgarishsiz qolishi.
- Dastlab to‘liq VM sinovidan keyin chiqarish rejalashtirilgan edi. 1.3.7 chiqarish bo‘yicha alohida topshiriq olindi; lokal integratsiya va brauzer sinovlari o‘tgan, VM tekshiruvi esa hali bajarilmagan. Uni bajarilgan deb hisoblamaslik kerak.

## Keyingi bosqichda aniqlashtiriladigan tafsilotlar

- Xona chizish uchun biznes amallaridan ajratilgan SVG tahrirlagich tanlandi. Bir xil geometriya ma’lumotlari ishlatiladi, mavjud kassa xaritasi qayta tuzilmagan.
- Ish kunlari/soatlarini alohida cheklash hozir qo‘shilmaydi: foydalanuvchi barcha klublarga 24/7 talabini tasdiqladi.
- Ulangan clientdan tanlash qoralamada raqam/IP/MACni birga yangilaydi. Amaldagi PC ID yakunlashda saqlanadi; MAC maydoni bo‘sh bo‘lsa avval avtomatik topilgan MAC yo‘qotilmaydi.
- Installerning oxirgi oynasi faqat dastur tayyorligini tushuntiradi; klub qoralamasi setup.exe ichida saqlanmaydi.
