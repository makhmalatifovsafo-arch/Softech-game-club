# O‘rnatish oldidan hisob-kitob auditi — 2026-11-21

Audit paytidagi manba versiyasi: **1.3.11**; reliz uchun **1.3.12** ga ko‘tarildi.
Bu hujjat mahalliy kod tekshiruvi;
GitHub relizi yoki klubga o‘rnatilgan setup tasdig‘i emas.
Testlar `.test-output` ichidagi alohida server/baza nusxalari, localhost
bulut, headless Edge va native client test hostida bajarildi.
Ishlayotgan klublarga so‘rov yuborilmadi, ularning bazalari o‘zgartirilmadi.

## Topilib, qayta chiqarilgan va tuzatilgan xatolar

1. **Depozitli seans uzaytirilishi.** Eski minutli narx rejasi uzaytirilmasdi.
   10 000/soat, 60+60 daqiqalik seans 90 daqiqada yopilganda 15 000 o‘rniga
   10 000 hisoblanib, 5 000 ortiq qaytim chiqardi. Eski minutli rejalar va
   ko‘chirilgan seanslarning segmentli rejalari endi eski narxlarni saqlagan
   holda uzaytiriladi. Haqiqiy HTTP regression: `booking-session-flow.mjs`.
   Tuzatishdan oldingi dalil: `.test-output/preinstall-extension-before.log`.

2. **Tarif oralig‘i almashganda naqd/karta qaytimi.** 16:00–17:00 7 000,
   17:00–18:00 14 000 bo‘lsa, ikki soatga 21 000 to‘lagan mijoz 17:00 da
   yopganda eski oddiy seans hisobi 10 500 ishlatilgan deb olardi. Endi
   yangi oddiy va guruh seanslarida ham sotib olingan minut narxlari saqlanadi:
   ishlatilgan 7 000, qaytim 14 000. Keyingi tarif tahriri bu kelishuvni
   o‘zgartirmaydi. Soat/summa/tugash vaqti, CASH/CARD, uzaytirish va kasrli
   minut sinovlari: `cashier-refund-tariffs.test.mjs`.
   Oldingi dalil: `.test-output/preinstall-tariffs-before.log`.

3. **Bar to‘lov manbasi va hisobot tafsilotlari.** Naqd avansdan qoplangan
   mahsulot karta sifatida belgilanishi mumkin edi. Endi checkout ichida
   `bar_order_payments` har bir buyurtmaning haqiqiy CASH/CARD ulushlarini
   saqlaydi. Masalan, 8 000 bar = 5 000 naqd avans + 3 000 yangi karta.
   Hisobotdagi kanal summalari kvitansiyalar bilan mos; bitta mahsulot ikki
   marta sotilgan deb hisoblanmaydi. Ikki kanalga bo‘lingan mahsulot satrida
   «to‘lov qismi» va unga mos miqdor ulushi ko‘rsatiladi. PC ichki ID orqali
   bog‘langan bo‘lsa ham nomi chiqadi. `booking-funds.test.mjs` oddiy va bron
   seanslarini, qayta yopishni rad qilishni ham tekshiradi.
   Oldingi dalil: `.test-output/preinstall-bar-before.log`.

4. **Uzoq integration testdagi uzilish.** Sinov clienti heartbeat yubormagan,
   shu sabab haqiqiy server 15 soniyadan keyin uni uzgan. Test endi haqiqiy
   client singari heartbeat yuboradi va yakunida timerni tozalaydi. Ishlab
   turgan server timeouti yoki login himoyasi yumshatilmadi.

## Ma’lumotlarni saqlash chegarasi

- `db.js` migratsiyasi yangi to‘lov ulushlari jadvalini qo‘shadi; eski
  buyurtma, seans, balans yoki tranzaksiyalarni qayta yozmaydi.
- Eski bar buyurtmalarida aniq ulush qayd qilinmagan bo‘lsa, hisobot avval
  saqlangan to‘lov turini ko‘rsatadi. Yetishmayotgan tarix taxmin qilinmaydi.
- Eski prepaid seansining saqlanmagan narx jadvalini hozirgi tarifdan qayta
  yasamaymiz. Yangi seanslar narx rejasini saqlaydi; eski seansni uzaytirishda
  avvalgi to‘langan summa va davomiylik saqlanadi.
- Barcha pul yozuvlari mahalliy SQLite checkout tranzaksiyasida. Mobil va
  desktop uchun alohida yangi moliyaviy formula kiritilmadi.

## Tekshiruv dalillari

- Yakuniy to‘liq Node suite **308/308**, fail **0**:
  `.test-output/preinstall-full-final.log` (262 soniya).
- Tarif/depozit/guruh sinovlari **4/4**: `.test-output/preinstall-pricing-final.log`.
- Desktop + mobil bron oynalari **o‘tdi**: `.test-output/preinstall-browser.log`.
- Windows client build + protokol **o‘tdi**: `.test-output/preinstall-native.log`.
  Buildda mavjud ikkita nullable ogohlantirishi qoldi; error 0.
- Ajratilgan PostgreSQL API **o‘tdi**: `.test-output/preinstall-postgres.log`.
- Test loglaridagi ataylab yaratilgan xatolar test natijasi bilan baholanadi;
  `not ok` va yakuniy fail soni muhim.

## Klubga qo‘yish tartibi

1. Barcha o‘zgarishlarni, yangi service/test fayllarini ham commitga kiriting.
   GitHub Actions to‘liq yashil tugagach, aynan shu commitdan yig‘ilgan Server
   va Client setuplarini oling. Oldingi EXE bu tuzatishlarni o‘z ichiga olmaydi.
2. Avval VMda o‘sha setuplarni o‘rnating: yangi o‘rnatish va eski test bazasini
   saqlab yangilashni tekshiring. Litsenziya, PC ulanishi va Windows xizmati
   ishga tushishini ko‘ring. Native test hosti bu setup sinovining o‘rnini bosmaydi.
3. 1 ta test PCda oddiy seans + bar + erta yopish; VIP + depozit + bar;
   uzaytirish; boshqa PCga ko‘chirish; takror bosish; mobil va desktop hisob
   tengligini tekshiring. Natijalarni hisobot bilan solishtiring.
4. Test seansi davomida internetni uzib, keyin qayta ulang; alohida server
   qayta ishga tushishini sinang. Qolgan vaqt, to‘lov va bron saqlansin.
5. Ishlayotgan klubni yangilashdan oldin dastur yaratgan tekshirilgan SQLite
   zaxirasini alohida diskka ko‘chiring; faol bazaning faqat `netcafe.db`
   faylini nusxalash WALdagi oxirgi yozuvlarni qoldirib ketishi mumkin.

Bu audit «hech qachon xato bo‘lmaydi» kafolati emas. Haqiqiy klub apparati,
elektr uzilishi, setup/OTA hamda LAN sharoitlari bu safar jonli klubda
sinovdan o‘tkazilmadi. `AI-PROJECT-CONTEXT.md` 24-bo‘limidagi umumiy signing
secret, client pairing va boshqa diskdagi backup cheklovlari ham qolmoqda;
ularni seans hisobiga berilgan test tasdig‘i bilan aralashtirmang.
