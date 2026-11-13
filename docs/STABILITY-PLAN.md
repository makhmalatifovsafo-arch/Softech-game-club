# Softech barqarorlik rejasi

## Tasdiqlangan hodisa

10-klubda config.json 99 ta NUL baytdan iborat bo'lib qolgan. Eski server uni
o'qishda yopilgan. NUL baytlarni aynan qaysi jarayon yoki qurilma hosil qilgani
aniqlanmagan. Klub bazasining holati masofadagi tekshiruv hisobotisiz tasdiqlanmaydi.
Boshqa boshqaruv dasturi aybdor degan dalil yo'q.

## 1. Ma'lumotlarni saqlash va ishga tushish — kod va testlar tayyor

- Sozlama, litsenziya, vaqt belgisi va bloklash holatini vaqtinchalik faylga yozish,
  diskka saqlashni so'rash, keyin asosiy fayl o'rniga qo'yish.
- O'zgarmagan sozlamani har bir bulut tekshiruvida qayta yozmaslik.
- Buzilgan sozlamani shu klubning imzolangan litsenziyasiga mos sog'lom zaxiradan
  tiklash; buzilgan asl nusxani saqlash. Oddiy litsenziya/HWID/blok tekshiruvlari qoladi.
- Zaxira yo'q yoki ishonchsiz bo'lsa, boshqa klub yoki taxminiy sozlamaga o'tmaslik.
  Diagnostika oynasini ochiq qoldirish.
- Server setupi mavjud sozlamani qayta yozmasligi; yangilash sozlama zaxirasini saqlashi.
- Baza nusxasiga WAL jurnalidagi yakunlangan yozuvlarni ham qo'shish; tiklash mavjud
  bazaning ustiga yozmaydi. Eski zaxiraga avtomatik qaytish savdolarni yo'qotishi mumkin.
- Yozish, fsync va rename xatolari, buzilgan fayllar, mos kelmagan klub, bloklangan
  litsenziya, WAL va haqiqiy server ishga tushishini test qilish.

Diskka saqlash buyrug'i qurilmaning o'zi buzilmasligini kafolatlamaydi. Alohida
qurilmadagi zaxira va elektr himoyasi dasturdagi himoyani to'ldiradi.

## 2. Nosozlikni masofadan aniqlash — kod va testlar tayyor

- Launcher va server holatini ajratish: server to'xtasa ham launcher xato kodini
  yetkazishi; maxfiy qiymatlar va mijoz ma'lumotlarini yubormaslik.
- Super admin panelida oxirgi aloqa, haqiqiy versiya, zaxira va saqlash xatosini ko'rsatish.
- Bitta tugma bilan maxfiy qiymatlarsiz diagnostika olish.
- Disk to'lishi va zaxira olinmayotganini oldindan ko'rsatish.

### Amalga oshirilgan mexanizm

Launcher har 60 soniyada va xato yuz berganda alohida diagnostika so'rovini
yuboradi; urinishlar orasida kamida 30 soniya bor. Bu Node serverini ishga
tushirishga bog'liq emas. Tarmoq kutish muddati 8 soniya; tarmoq xatosi kassa
ishga tushishini yoki qayta urinishni to'xtatmaydi.

Diagnostika alohida jadvalda saqlanadi, klubning heartbeat va litsenziya holatini
o'zgartirmaydi. Xabar imzolangan, muddati o'tmagan litsenziya va klub HWID mosligi
bilan qabul qilinadi; o'qish faqat super admin uchun. Eski yoki takroriy kuzatuv
yangi kuzatuvni almashtirmaydi. Faqat belgilangan maydonlar saqlanadi, raw log,
parol, token, fayl manzili va mijoz ma'lumotlari diagnostikaga kirmaydi.

Klubning batafsil sahifasida alohida karta bor. U 30 soniyada yangilanadi;
3 daqiqadan eski xabar hozirgi holat deb ko'rsatilmaydi. Server paket versiyasi
va launcher versiyasi alohida; paket versiyasi ishlayotgan backend versiyasi
deb talqin qilinmaydi. Sekin diagnostika so'rovi asosiy klub sahifasini kutdirmaydi.

Launcherda "Diagnostika" / "Diagnostikani saqlash", panelda esa
"Diagnostikani yuklab olish" tugmalari bor. Mahalliy eksport internet va
litsenziya o'qilishiga bog'liq emas. Zaxiralash ishchisi raw xatosiz natija yozadi;
panel 1 GB dan kam disk joyi va 2 soatdan eski/yo'q zaxira haqida ogohlantiradi.
Zaxira sanasi har safar uning to'liq yaxlitligi qayta tekshirildi degani emas.

### Ishga joriy qilish tartibi va chegaralar

1. Supabase SQL Editor'da `migrations/20261113_server_diagnostics.sql` bajariladi.
   Bu yangi diagnostika jadvali; savdo, balans yoki klub heartbeatini o'zgartirmaydi.
2. Bulut kodi deploy qilinadi. Root va SoftechCloudAdmin nusxalari bir xil bo'lishi kerak.
3. Yangilangan launcher va server kodi bitta yangi reliz orqali o'rnatiladi.
   Eski launcherlar bu mexanizmni bajarmaydi.
4. Avval sinov kompyuterida backend ishlamayotgan holat, xabar kelishi, tiklanish,
   eksport va eskirgan ma'lumot belgisi tekshiriladi.

Launcher yopiq, kompyuter o'chirilgan yoki internet yo'q bo'lsa xabar kelmaydi.
Sozlama va zaxirasi birga buzilganida bulut manzilini, litsenziya buzilganida klubni
taxmin qilib yubormaydi. Litsenziya muddati o'tganda ham avtomatik yuborish rad
etiladi; mahalliy eksport ishlaydi. Soat 2 daqiqadan ko'p oldinga yoki 24 soatdan
ko'p orqaga ketgan xabar qabul qilinmaydi. Bu holatlarda panel oxirgi kuzatuvni
eskirgan deb ko'rsatadi; sababni taxmin qilmaydi. Hali Windows xizmati emas.

SQL migratsiya ishlab turgan Supabase bazasida bajarilmadi; yangi release va
klublarga o'rnatish bu bosqichdagi kod tekshiruvidan alohida ish.

Tekshiruv: `npm test` 184/184 o'tdi. Windows StartupSafety testlari haqiqiy
backend jarayoni, diagnostika eksporti, tarmoq xatosi, yuborish chegarasi va buzilgan
sozlamani qamrab oldi. Edge brauzerida kechikkan diagnostika klub sahifasini
kutdirmasligi, boshqa klubga o'tilganda eski javob aralashmasligi, JSON yuklash va
503 javobida sahifa saqlanishi tekshirildi. Launcher buildi 0 xato bilan tugadi;
mavjud nullable va NuGet tarmoq ogohlantirishlari qoldi. Supabase RPC ishlashi
test adapterida tekshirildi; migratsiya haqiqiy PostgreSQL serverida bajarilmadi.

## 3. Xavfsiz yangilanish va qayta ishga tushish — kod va alohida sinovlar tayyor

- Mavjud yangilash/rollback mexanizmini buzilgan paket, quvvat uzilishi,
  band port va backend ishga tushmasligi bilan alohida tekshirish.
- UI yopilishi bilan server ishlashi o'rtasidagi bog'liqlikni kamaytirish;
  yagona backend jarayoni va Windows xizmatini boshqarish loyihasini tayyorlash.
- Eski va yangi dastur bir vaqtda bazaga xizmat ko'rsatmasligi.
- Sinov klubida tekshirilgan relizni bosqichma-bosqich tarqatish; barcha klublarni
  bir vaqtda majburan yangilamaslik.

### Amalga oshirilgan himoya

- Updater fayllarni almashtirishdan oldin tiklash jurnalini va zaxira nusxalarining
  SHA-256 qiymatlarini diskka yozadi. Uzilgan operatsiya keyingi launcher ochilishida
  aniqlanadi. Buzilgan zaxira yoki band port bo'lsa, tiklash dalillari saqlanadi.
  Ishlayotgan launcher o'z EXE faylini almashtirmaydi: avval alohida helper tayyorlanadi,
  u launcher yopilishini kutadi, keyin tiklab qayta ochadi. Helper tayyor bo'lmasa
  diagnostika oynasi ochiq qoladi; tiklash xatosi bo'lsa qayta ochilgan oynada ko'rsatiladi.
- Yangi server dastlab faqat sog'lomlik tekshiruviga javob beradi. Seans, bar,
  mobil buyruq, bulut buyruqlari va seans hisoblagichlari tasdiqni kutadi. Client
  aloqasi vaqtinchalik yopilib, yangi handshake bilan qayta ulanishga yo'naltiriladi.
- To'g'ri versiya va aynan shu yangilashning belgisi 10 soniya sog'lom javob bersa,
  qabul qilinganlik avval diskka yoziladi, keyin ishga ruxsat beriladi. Shundan keyin
  bazani avtomatik eski nusxaga qaytarish taqiqlangan: yangi savdolar yo'qolmasligi kerak.
- Ishga tushmagan versiya uchun eski dastur va tekshiruvdan oldingi baza qaytariladi.
  Tasdiqlangan versiyada keyinroq yuz bergan xato uchun baza orqaga qaytarilmaydi.
- Bir bazaga bir vaqtda ikki server xizmat ko'rsatishini alohida SQLite/Windows
  qulfi to'sadi. Server majburan yopilganda yoki Windows qayta yoqilganda qulfni
  operatsion tizim bo'shatadi. PID raqami qayta ishlatilishiga tayanilmaydi.
- Yangilovchi ham bazani almashtirish vaqtida shu faylga alohida kirish huquqini
  ushlab turadi. Bu server hali portni ochmagan paytdagi poygani ham to'sadi.
- Oddiy Node orqali ishga tushirish tugamagan yangilash jurnalini chetlab o'tmaydi.
  Launcher tiklashi kerakligi aniq yoziladi; klub va baza taxmin qilib yaratilmaydi.
- Kassadagi X tugmasi oynani kichraytiradi; backend va diagnostika davom etadi.
  OTA yopilishida launcher Node'ni majburan o'ldirmaydi, yozuvlarni tugatishni kutadi.
  Windows'dan chiqish/o'chirish bunga kirmaydi.
- Qayta ishga tushirish ham backend javobini kutadi. Super admin diagnostikasida
  takroriy server, jarayon qulfi xatosi va yangilanishni tiklash talabi alohida ko'rsatiladi.

### Tekshiruv va qolgan chegaralar

`npm test`: 187/187 o'tdi. Oxirgi WebSocket va diagnostika o'zgarishlaridan keyin
tegishli 8/8 test ham o'tdi. Haqiqiy Windows updater + alohida Node server bilan
4 holat tekshirildi: muvaffaqiyat, yangi server yiqilishi/rollback, updater majburan
uzilishi/tiklash (ishlayotgan EXE bo'shatilishini kutish bilan), oddiy restart. Sinov balansi 5320 saqlanadi; tasdiqdan keyin
6320 qilingan balans qayta tiklash urinishida orqaga qaytmaydi. Tirik SQLite egasi
borida port dalili bo'lmasa ham tiklash rad etiladi.

Client updaterning 5 holati (bekor qilish, parallel urinish, buzilgan paket,
muvaffaqiyat, rollback), native UpdatePolicy va StartupSafety testlari o'tdi.
Super admin sahifasi Edge'da kechikkan javob, klub almashishi, eksport va 503
holatlarida tekshirildi. Launcher/updater buildlari 0 xato; mavjud nullable va
NuGet NU1900 ogohlantirishlari bor. Tarmoqdagi paket zaifliklari auditi bajarilmadi.

Ushbu 3-bosqich tugagan paytda Windows xizmati hali yozilmagan edi; joriy holati
[SERVER-LIFECYCLE-DESIGN.md](SERVER-LIFECYCLE-DESIGN.md) da. Launcherning o'zi
Task Manager'dan yopilishi yoki Windows sessiyasidan chiqish o'sha bosqichda alohida
xizmat bilan himoyalanmagan edi. Sinovlar haqiqiy elektr uzilishi, disk buzilishi, uzoq
muddatli yuklama yoki yangi tarqatish paketidan o'rnatish sinovining o'rnini bosmaydi.
Aralash/buzilgan launcher fayllari uning o'zini ham ochirmasa, yangi setup yoki
alohida tiklash vositasi kerak bo'lishi mumkin. Kod klublarga tarqatilmadi.

## 4. Seanslar va moliyaviy hisob — asosiy tuzatishlar va uzilish sinovlari tayyor

- Server/client qayta ishga tushishi va internet uzilishi paytida seans holatini tekshirish.
- VIP, oldindan to'lov, ko'chirish, bar va qaytimda takroriy buyruq pulni ikki marta
  hisoblamasligini tekshirish.
- Offline hisobotning oxirgi yangilangan vaqtini aniq ko'rsatish.
- Uzoq muddatli yuklama sinovi va nosozlikdan tiklash mashqi.

### Topilgan va tuzatilgan holatlar

- Yopilgan VIP seansga tegishli qolgan bar qarzini undirish o'yin pulini ikkinchi
  marta yozishi mumkin edi. Yakuniy o'yin summasi endi saqlangan hisobdan olinadi;
  o'sha vaqtdan keyingi tarif o'zgarishi uni qayta hisoblamaydi. Oldin to'langan
  qism qayta undirilmaydi; bazada qayd etilgan haqiqiy to'lanmagan qoldiq saqlanadi.
- Qaytim berilgan prepaid seansning bar qarzi yopilganda eski boshlang'ich summa
  yakuniy summani almashtirmaydi. 10000 to'lov minus 6000 qaytim = 4000 o'yin
  tushumi bo'lib qoladi. Yopilgan seans sanasi va oldingi to'lov maydonlari saqlanadi.
- To'lov bazaga yozilib bo'lgandan keyingi interfeysga xabar yuborish xatosi
  saqlangan to'lovni muvaffaqiyatsiz deb qaytarmaydi.
- Mobil snapshot yuborish o'tkazib yuborilsa (operational emas yoki imzolangan
  litsenziya yo'q), `flush()` muvaffaqiyat qaytarmaydi. Yuborilmagan hisobot
  sinxronlangan deb ko'rsatilmaydi.
- Mobil yangilash xatosida ham oxirgi bulut nusxasining haqiqiy sanasi ekranda
  qoladi. Ma'lumot yo'q bo'lsa, yangi sana yoki nol tushum o'ylab topilmaydi.

### Sinovlar

`tests/financial-restart.test.mjs` alohida bazalarda haqiqiy Node jarayonlarini
COMMIT'dan keyin majburan to'xtatib, yangi jarayonda tekshiradi:

- VIP va qaytimli prepaid uchun bar qarzini undirish, SQL xatosida to'liq rollback,
  qayta urinishlarda qo'shimcha pul yozilmasligi va o'yin summasi saqlanishi.
- 5320 ishlagan VIP seansni 14000/soat xonaga ko'chirish; restartdan keyin yana
  30 daqiqa uchun jami 12320 hisoblanishi.
- Bulutga hisobot yuborish 503 bilan yiqilib, jarayon yopilgandan keyin eski kunning
  qaytimi qayta yuborilishi; mobilga ketgan 4000 server hisobotiga aynan tengligi.
- 500 ta bar to'lovi, 500 ta takroriy urinish, besh to'lov to'plami orasidagi
  majburiy restartlar: yakun 5320 + 500 × 2000 = 1005320, bitta o'yin to'lovi.
- Eski yopilgan VIP hisobda qayd etilgan qisman to'lanmagan summa bir marta undirilishi.

`tests/mobile-restart-receipts.test.mjs` diskdagi receipt va kalitlar saqlanishini
tekshiradi: to'lov yozilgach javob yo'qolsa, baza qayta ochilganda takroriy buyruq
ikkinchi savdo yaratmaydi. Natijasi noma'lum buyruq muvaffaqiyat deb ko'rsatilmaydi;
502/409 va holatni tekshirish talabi qaytadi. Bu test haqiqiy tarmoq qurilmasini
uzmaydi; transport xatosini taqlid qiladi.

Umumiy integratsion testda tarif narxi boshqa vaqtda olingani sababli 1 so'm farq
chiqqan. Test endi server saqlagan `started_at` bilan aniq narxni solishtiradi;
ruxsat etilgan farq qo'shilmadi.

### Chegaralar va keyingi nazorat

Yakuniy tekshiruv: Node 22 bilan `npm test` **195/195** o'tdi; root va
SoftechCloudAdmin nusxalari mos. Mobil brauzer sinovi ham o'tdi: menejerning
tarif/xodim boshqaruvi, administrator oynalari, savdo qoralamasi, seans shakllari,
hisobot filtri va login saqlanishi tekshirildi. Mahalliy cloud/server integratsiyasi
seans, bar, qaytim va mobil/server hisobot tengligini ham tasdiqladi.

Bu cheklangan mahalliy yuklama sinovi; 24–48 soatlik sinov klubi kuzatuvi va
haqiqiy elektr/disk nosozligi sinovi hali bajarilmagan. Oldingi tarixiy to'lovlar
avtomatik qayta yozilmadi. Kod yangi relizga yig'ilmadi va klublarga tarqatilmadi.
Mavjud prepaid, balans, seans expiry, ko'chirish, mobil ruxsatlar va offline
hisobot testlari ham regressiya tekshiruviga kiradi.

## Reliz sharti

### Disk joyi va yangilanish fayllari tekshiruvi (2026-11-13)

- Client yuklash/hash/ZIP tekshiruvi xatosida o'zining muvaffaqiyatsiz staging
  papkasini tozalaydi. Yangilanish papkasini yaratib bo'lmasa, kiosk startupi
  to'xtamaydi. Yuklash va o'rnatish bir-birining tayyor paketini almashtirmaydi.
- Server/client restartida oldin yuklangan paket arxiv SHA256 qaydi va barcha
  fayllarining hash qiymati tekshirilgach qayta ishlatiladi. Mos kelmagan yoki
  buzilgan paket qayta ishlatilmaydi. Bekor qilingan yangi versiya handoverlari
  ham updater qulfi bo'shagach tozalanadi.
- Updater va Windows service loglari 2 MiB da aylantiriladi; bitta oldingi
  nusxa qoladi. Uzoq xabarlar 16000 belgigacha cheklanadi.
- Zaxira olish, paket yuklash/ochish va updater nusxalashlarida 256 MiB
  bo'sh joy zaxirasi tekshiriladi. Yuklash 1 GiB, ochilgan ZIP 4 GiB bilan
  cheklangan. Joy tekshiruvi boshqa jarayonning parallel yozuvini kafolatlamaydi.
- Muvaffaqiyatsiz migratsiya sabab takroriy startda ham sog'lom startup
  zaxiralari soni 3 tadan oshmaydi. Umumiy siyosat: startup 3, hourly 4,
  daily 7, setup 3. Bu hajm emas, son chegarasi; baza o'sishi bilan nusxalar o'sadi.

Tekshiruvlar: haqiqiy client updaterga olti marta buzilgan hash/ZIP berilganda
staging bo'sh qoldi; band updates manzili startupni to'xtatmadi. Native testlar
log aylanishi, kam joy, tugallanmagan yuklash, kesh yaxlitligi va faol updater
qulfida tozalash taqiqlanishini tekshiradi. Node testlari kam joyda mavjud baza
va zaxiralar saqlanishini, takroriy migratsiya xatosida saqlanadigan nusxalar
sonini tekshiradi.

Yakuniy tekshiruv: Node 22 to'liq test to'plami 201/201 o'tdi; cloud nusxalari
mosligi tekshirildi. Native ClientProtocol va UpdatePolicy o'tdi. Haqiqiy server
OTA sinovida muvaffaqiyatli yangilanish, rollback, uzilgan yangilanish va restart
holatlarida pul yozuvlari saqlandi. Client, updater, service va ServerSetup
buildlari xatosiz; mavjud nullable va NuGet tekshiruv ogohlantirishlari qoldi.

Chegaralar: moliyaviy tarix, favqulodda seans jurnali va buzilgan fayllarning
tiklash dalillari avtomatik o'chirilmaydi; ular vaqt o'tishi bilan o'sishi mumkin.
Jarayon majburan o'chirilganda qolgan eski/orphan paketlar har doim avtomatik
o'chirilmaydi. Super admin diagnostikasidagi bo'sh disk ko'rsatkichini kuzatish
kerak. Bu o'zgarishlar kodda; klublarga yangi paket o'rnatilmaguncha tatbiq etilmaydi.

### Windows xizmati — kod va mahalliy sinov bosqichi (2026-11-13)

- `NetCafeServer/Service`: SCM host, LocalService hisobida Node nazorati, yagona
  host qulfi, 10 soniyali tanaffus va 5 daqiqada 3 urinish chegarasi, mustaqil diagnostika.
- Xizmat o'rnatilgan bo'lsa kassa faqat ulanadi; X oynani yopadi, Node'ni o'chirmaydi.
  Eski o'rnatmalar setupdan o'tmaguncha avvalgi launcher rejimida qoladi.
- Setup administrator sifatida xizmatni o'rnatadi, eski xizmat to'xtashini kutadi,
  baza zaxirasini oladi, mahalliy config/litsenziyani saqlaydi. Avtostart checkbox
  endi kassa oynasiga tegishli; backend Windows xizmati sifatida avtomatik boshlanadi.
- OTA qulfi egallanganda host aralashmaydi; tugaganda yangi Node'ni PID/manzil bilan
  tekshirib kuzatadi. `.service` fayllari OTA paketidan himoyalangan. Hostning o'zini
  almashtirish uchun setup kerak. Kassa oynasi OTA'dan keyin yorliq bilan qayta ochiladi.
- Local stop endpoint faqat loopback va maxfiy kalitni qabul qiladi; yozuvlar
  tugamaganda 503 qaytarib amaldagi serverni davom ettiradi. Kalitning buzilgan
  JSON nusxasi dalil sifatida saqlanib, yangi control kalit yaratiladi; klub
  litsenziyasi yoki moliyaviy ma'lumot bu jarayonda almashtirilmaydi.
- Client prepaid taymeri server aloqasi uzilganda ham avvalgi muddatda tugashi,
  VIP o'z-o'zidan yopilmasligi, qayta ulangan server vaqti qabul qilinishi native
  testda tekshirildi. Client reboot paytida offline kesh bilan qulfni ochish qo'shilmadi.
- Faol seansning `started_at`, `ends_at`, to'langan summa va tranzaksiyasi restartda
  o'zgartirilmaydi. Server ishga tushishi bilan muddati o'tgan prepaid seanslar
  intervalni kutmasdan yopiladi; muddati bor seans client qayta ulanganda aynan
  qolgan vaqt bilan davom etadi. Eski seansdan kechikkan vaqt/STOP paketi yangi
  seansga qo'llanmaydi. 60 daqiqa - 20 daqiqa = 40 daqiqa va 7000 so'm saqlanishi
  alohida server/client sinovlarida tekshirildi.

Tekshiruv: to'liq `npm test` 200/200; keyin yangi interaktiv idle holati bilan
tegishli service testlari 3/3 o'tdi. Haqiqiy Windows worker va Node bilan crash,
5320 so'm yozuvining saqlanishi, host crashidan keyin mavjud Node'ni davom ettirish,
parallel hostni rad etish, OTA va graceful stop o'tdi. Publish qilingan service
EXE ham shu testdan o'tdi; 99 NUL bo'lgan control fayl bazaga tegmasdan tiklandi.
Native ClientProtocol, StartupSafety va UpdatePolicy o'tdi; launcher/setup/service
buildlari xatosiz. Mavjud nullable/NU1900 ogohlantirishlari qoldi.

`tests/ServerService` haqiqiy SCM/LocalService/Session 0 testini disposable GitHub
runnerda bajaradi. Mahalliy administrator huquqi yo'q: bu SCM testi, haqiqiy
Windows logout/reboot va klubda o'rnatish hali bajarilgan deb hisoblanmaydi.
Yangi ZIP/setup relizi tayyorlanib tarqatilmadi, versiya o'zgartirilmadi.

### Bazadan mustaqil favqulodda seans rejimi (2026-11-13)

- Asosiy backend ketma-ket 3 marta yopilganda Windows xizmati cheklangan emergency
  backendni ochadi. Javob bermayotgan tirik jarayon faqat kassa oynasidagi aniq
  favqulodda so'rovdan keyin to'xtatiladi.
- Imzolangan litsenziya, HWID, muddat, 72 soatlik lease, clock guard va mahalliy
  blok tekshiriladi. Tekshiruv o'tmasa favqulodda rejim ham ochilmaydi.
- Baza yaratilmaydi. Faqat ulangan clientlarga 5–720 daqiqalik seans; narx,
  bar, balans, login, VIP/Postpaid va moliyaviy hisobot yo'q. Rejim 12 soat bilan
  cheklangan va kassir ismini talab qiladi.
- Alohida HMAC-zanjirli, fsync qilingan `data/emergency-sessions.ndjson` jurnal
  ishlatiladi. Restartdan keyin qolgan vaqt davom etadi; jurnal o'zgartirilsa yangi
  seans bloklanadi. Asosiy serverga qaytishdan oldin barcha emergency seanslar yopiladi.
- Real Node sinovi bazasiz start/restart/reconnect/start/stop va jurnal buzilishini;
  service sinovi 3 crashdan emergency rejimga o'tish va tuzatilgan main serverga
  qaytishni tekshirdi. Bu kod ham hali klublarga tarqatilmadi.

### Tarqatishdan oldin

1.2.0 uzilgan OTA tiklash sinovi: `RestoreFile` dagi atomik rename bir martalik
AccessDenied/sharing xatosida darhol to'xtagan. Qaysi jarayon CI faylini ushlab
turgani eski logda qayd qilinmagan. Mahalliy real ochiq EXE va FileShare qulfi
bilan shu turdagi xato takrorlandi. Endi Win32 5/32/33 xatolarida fayl almashtirish
va rollback o'chirishlari ko'pi bilan 30 soniya qayta urinadi; boshqa xatolar darhol
qaytariladi. ACL, read-only atribut yoki begona jarayonlar o'zgartirilmaydi.
Muvaffaqiyatsiz tiklash APPLYING holatida va asl zaxiralari bilan qoladi; xabarda
fayl manzili, Win32 kodi va urinishlar soni bor. Doimiy qulfda baza tegilmagani,
qulf ochilgach qayta tiklash, vaqtinchalik fayllar tozalanishi va real executable
almashishi Windows native testda tekshirildi. Production updater ham ayni
chegaralangan almashtirish funksiyasidan foydalanadi.
Tekshiruv: haqiqiy server OTA success/rollback/interrupted/restart holatlari ikki
marta ketma-ket o'tdi; client updater cancel/concurrent/corrupt/success/rollback,
UpdatePolicy va StartupSafety o'tdi. Updater, xizmat va ServerSetup buildlari
xatosiz. GitHub hosted release pipeline'i qayta o'tishi talab qilinadi.

1.2.0 packaged OTA testida `currentVersion: undefined`: test yangi versiyali
health va success fayli mavjudligini yetarli deb hisoblagan. Updater success
faylini yozgandan keyin server approvalni 250 ms polling bilan qabul qiladi;
shu oraliqda status endpoint 503 UPDATE_VERIFYING qaytaradi. Test endi health
`updatePending === false`, shu versiyaga tegishli success yozuvi va HTTP 200
status javobidagi `currentVersion`ni birgalikda kutadi. Pul yozuvlarini himoya
qiluvchi production probation blokirovkasi o'zgartirilmadi. 6 ta yo'naltirilgan
test o'tdi: kechikkan approval, vaqtinchalik 503, eski status/receipt, muddati
tugagan kutish va haqiqiy serverdagi business blokirovkasi.

1.2.0 SCM keyingi tekshiruv: ServiceBase bilan Node PID yopilgani va
`SCM shutdown completed` tasdiqlandi. Keyingi HTTP yo'qlik tekshiruvi 2 soniyali
HttpClient timeoutini xato sanagan (faqat connection-refused ushlangan).
Test endi jarayon yopilgani tasdiqlangandan keyingina HTTP timeoutini qabul qiladi;
tirik/javob bermayotgan jarayon, istalgan HTTP javobi va aloqasiz cancellation
baribir yiqiladi. 7 mahalliy holat, jumladan real HttpClient timeouti o'tdi.
Bu o'zgarish test va CI'ga tegishli; production xizmat kodi o'zgartirilmadi.
To'liq hosted SCM stop/start sikli va reliz pipeline'i hali qayta o'tishi kerak.

1.2.0 keyingi CI natijasi (`Backend survived SCM stop`): oldingi kutish tuzatishi
yetarli bo'lmadi. Windows STOPPED holatini qaytargan, ammo Node ishlashda qolgan
va managed shutdown yakuni logda yo'q. Mustaqil cancellation sinovida real worker,
OTA va bazaning yopilishi o'tdi; native boshqaruv qismi alohida muammo bo'lib qoldi.
Qo'lda yozilgan SCM dispatcher .NET `ServiceBase` (ServiceController 8.0.1) bilan
almashtirildi. OnStop worker va cancellation yakunini kutadi; shutdown xatosini
yutmaydi. OnShutdown alohida yo'l orqali ishlaydi, unsupported RequestAdditionalTime
chaqirmaydi. Mahalliy sinov yangi StartWorker/StopWorker callbacklarini real Node
bilan bajaradi; faqat SCM vaqt so'rash chaqiruvini almashtiradi. Haqiqiy SCM testi
Node PID yopilganini va managed shutdown logini ham talab qiladi. Mahalliy SCM
o'rnatilmagan; GitHub hosted runner tekshiruvi muvaffaqiyatli o'tishi hali shart.
Tekshirildi: yangi callback bilan normal stop va Windows shutdown yo'li, real
Node crash/restart/adoption, OTA, 5320 so'm yozuvi va SQLite integrity; publish
qilingan service EXE console sinovi ham o'tdi. Service publish va SCM test buildi
xatosiz. Mahalliy sinov SCM o'rnatilganini yoki uning o'tganini anglatmaydi.

1.2.0 CI xizmat sinovi: `StopAndWait` to'xtatish buyrug'i rad etilganda holatni
qayta tekshirmasdan xato chiqargan; eski xabarda Win32 kodi yo'q edi. Pending
holatlarni kutish, rad etilgan buyruqdan keyin STOPPED holatini qayta tekshirish,
monoton 4 daqiqalik chegara va aniq Win32 xatosi qo'shildi. Mahalliy UpdatePolicy
sinovida 10 ta holat o'tdi; service/setup/SCM test loyihalari yig'ildi. Haqiqiy SCM
testi olib tashlanmadi: ketma-ket stop/start va ishga tushayotgan xizmatni to'xtatish
qo'shildi. Nosozlik bo'lsa test logi artifact sifatida saqlanadi va cleanup birlamchi
xatoni yashirmaydi. Bu tuzatishning hosted Windows SCM tasdig'i hali talab qilinadi;
eski logdan Windows qaytargan aniq sababni taxmin qilib tasdiqlab bo'lmaydi.

Tegishli regressiya testlari, to'liq test to'plami, Windows installer buildi va
paketdan real ishga tushish tekshiruvi o'tishi kerak. Keyin sinov klubida nazorat.
Kodning tayyorligi klubga o'rnatilganini anglatmaydi. Versiya chiqarish va tarqatish
holati alohida qayd etiladi. Hech qanday kompaniya mahsulotining ichki mexanizmi
tekshirilmasdan ularga teng ishonchlilik da'vo qilinmaydi.

## Birinchi bosqich tekshiruvi — 2026-11-13

- Node 22: `npm test` — 179/179 o'tdi; cloud nusxalari mosligi tekshirildi.
- Nosozlik va tiklash bo'yicha alohida testlar — 17/17 o'tdi.
- Windows UpdatePolicy: paket yo'llari va qayta o'rnatishda mahalliy ma'lumotlarni
  saqlash testlari o'tdi, config.json.last-good ham tekshirildi.
- ServerSetup build: 0 xato. NuGet zaiflik ma'lumotlarini tarmoqdan olish bo'yicha
  NU1900 ogohlantirishi qoldi; bu tekshiruv bajarilgan deb hisoblanmaydi.
- Joriy o'zgarishlar yangi tarqatish paketiga yig'ilmagan va klublarga o'rnatilmagan.
- Bu sinovlar qurilmada haqiqiy elektr uzilishi yoki uzoq muddatli yuklama sinovining
  o'rnini bosmaydi. O'sha tekshiruv paytida uchinchi–to'rtinchi bosqichlar bajarilmagan edi;
  joriy uchinchi bosqich holati yuqorida alohida qayd etilgan.
