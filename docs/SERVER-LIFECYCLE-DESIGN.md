# Serverni alohida Windows xizmati sifatida ishlatish loyihasi

Windows xizmati kodi va setup integratsiyasi qo'shildi. Mahalliy worker/Node/OTA
sinovlari o'tdi; haqiqiy SCM sinovi CI'ga qo'shildi, lekin bu kompyuterda
administrator huquqi yo'qligi sababli bajarilmadi. Klublarga hali o'rnatilmagan.

## Vazifalarni ajratish

| Qism | Vazifa |
| --- | --- |
| Windows xizmati | Yagona Node jarayonini boshlash, kuzatish, chegaralangan qayta urinish va diagnostika |
| Kassa oynasi | Mahalliy serverga ulanish; oynani yopish xizmatni to'xtatmasligi |
| Yangilovchi | Tekshirilgan paket, zaxira, yozuvlarni yakunlash, backendni almashtirish, qabul yoki tiklash |
| Bulut | Oxirgi kuzatuv va xato sababini ko'rsatish; klubning mahalliy hisobiga ega bo'lmaslik |

Xizmat Windows 10/11 Pro uchun sinovdan o'tkaziladi. U alohida kam huquqli
hisobda ishlaydi; faqat o'z dastur/ma'lumot/log papkalariga zarur huquqlar beriladi.
Interaktiv oynani xizmat ichidan ochmaydi. Kundalik ishlash administrator UAC
so'roviga bog'lanmaydi; xizmatni birinchi o'rnatish alohida setup vazifasi bo'ladi.

## Ishga tushish va nazorat

1. Mutlaq ma'lumot manzili aniqlanadi; ishchi papka o'zgarishi boshqa bo'sh baza
   yaratilishiga olib kelmasligi kerak. Sozlama va litsenziyaning klubga mosligi saqlanadi.
2. Tugamagan yangilash jurnali ko'riladi; dalilsiz eski bazaga qaytilmaydi.
3. Yagona jarayon qulfi olinadi, baza/sozlama tekshiriladi, keyin backend boshlanadi.
4. Jarayon tirikligi va sog'lom javobi ajratiladi. Uzoq migratsiya yoki band server
   faqat bitta HTTP timeout tufayli majburan yopilmaydi.
5. Qayta urinishlar orasida kutish va takroriy yiqilish chegarasi bo'ladi. Chegara
   oshsa raw log yuborilmaydi, tushunarli xato va mahalliy diagnostika qoladi.
6. SCM restart qoidasi va xizmatning ichki qayta urinishlari bitta siyosatga bo'ysunadi;
   ikki kuzatuvchi bir-biri bilan raqobatlashmaydi.

## Yangilash bilan kelishuv

Yangilovchi avval paketni tayyorlaydi. Mahalliy autentifikatsiyalangan boshqaruv
kanali orqali yangi yozuvlarni to'xtatib, bajarilayotgan amallar tugashini kutadi.
Oddiy setup SCM stop tugashini kutadi. OTA esa xizmatni o'chirmaydi: yangilovchi
`.ota/update.lock` ni ushlab turganda xizmat backend boshlamaydi. Ishlayotgan host
`.service/SoftechService.exe` da saqlanadi va OTA undan nusxa ustiga yozmaydi.
Hostni yangilash uchun setup kerak; paketdagi ildiz `SoftechService.exe` keyingi
setup uchun tayyor nusxadir. Jurnal va alohida server qulfi saqlanadi.

Yangilovchi yangi backendni tekshiruv rejimida boshlaydi. Sog'lomlik javobi versiya va
yangilash identifikatoriga bog'lanadi; qabul qarori diskka yozilgandan keyingina
savdo ochiladi. Qabuldan keyingi nosozlikda eski baza qaytarilmaydi. Moliya
yozuvlarini yo'qotmasdan tuzatish yoki oldinga mos migratsiya talab qilinadi.
Qabuldan keyin xizmat health javobidagi PID va executable manzilini solishtirib,
shu Node jarayonini kuzatishga oladi. Hostning o'zi yiqilsa ham tirik backendni
takroran ochmaydi. Boshqa dasturning band portini bo'shatish uchun uni o'ldirmaydi.

Service Session 0 dagi klaviatura bekor turishini kassir faolligi deb qabul
qilmaydi. Kassa oynalari har 2 soniyada o'z faolligi haqida mahalliy belgi beradi.
Eskirgan yoki yo'q belgi avtomatik o'rnatishni kutishga qo'yadi; tekshirish/yuklash
davom etadi. Barcha oynalar yopiq bo'lsa ham administrator tasdiqlagan yangilash
buyrug'i ishlashi mumkin. OTA kassa oynalarini yopadi; ularni xizmat Session 0 dan
qayta ochmaydi, foydalanuvchi yorliq orqali ochadi.

Eski versiya va yangi xizmat bir vaqtda ishlamasligi setup sinovining shartidir.
Xizmatga ko'chishda avto-start yozuvlari, eski launcher nazorati, yangilash markerlari
va fayl ruxsatlari birgalikda ko'chiriladi. Bu alohida reliz bo'lishi kerak.

## Client va uzilish chegaralari

Clientning mavjud monotonic hisoblagichi tekshirildi: LAN/server uzilishi prepaid
muddatini o'zgartirmaydi, vaqt tugaganda bir marta qulflaydi. VIP ochiq seans
kassir tasdig'isiz yopilmaydi; ekranda aloqa uzilganligi ko'rsatiladi va summa
yangidek ko'rsatilmaydi. Qayta ulanishda serverdagi saqlangan seans asos bo'ladi.
Clientning o'zi qayta yuklansa, server tasdig'isiz kesh orqali qulf ochilmaydi.
Server tiklanmaguncha yangi seans, sotuv va boshqa server amallari bajarilmaydi.

Asosiy server ketma-ket uch marta yopilsa, xizmat haqiqiy litsenziyani tekshirib
favqulodda backendni avtomatik ochadi. Tirik, lekin javob bermayotgan jarayonni
o'zboshimchalik bilan o'ldirmaydi; kassa xato oynasidagi favqulodda tugma mahalliy
so'rov yuboradi. Ulangan clientlar bazasiz jonli ro'yxat bo'ladi. Faqat 5–720
daqiqalik seans ochiladi. Kassir ismi majburiy; bar, balans, akkaunt, tarif,
summa, VIP va Postpaid yo'q. Rejim 12 soatdan keyin yangi seansni bloklaydi.

Amallar `data/emergency-sessions.ndjson` fayliga ketma-ket HMAC bilan va diskka
flush qilib yoziladi. U asosiy moliyaviy hisobotga avtomatik qo'shilmaydi. Jurnal
o'zgartirilgan bo'lsa yangi seans bloklanadi. Rejim qayta ishga tushsa tugamagan
seanslarni client qayta ulanishida davom ettiradi. Asosiy serverni sinashdan oldin
barcha favqulodda seanslar yopilishi shart; bu ikki xil holatning aralashishiga yo'l
qo'ymaydi.

Normal SCM stop mahalliy maxfiy kalit bilan yangi HTTP yozuvlarni to'xtatib,
boshlangan yozuvlarni tugatishni kutadi. Majburiy Windows shutdown, disk nosozligi
yoki vaqt chegarasidan o'tgan jarayonda mutlaq uzluksizlik kafolati yo'q; committed
SQLite WAL yozuvlari va zaxira/tiklash himoyasi qoladi. 3 ta ketma-ket ishga tushish
urinishidan keyin 5 daqiqalik oynada kutadi. Tirik, lekin javobi sekin jarayonni
faqat HTTP timeout sababli o'ldirmaydi.

## Joriy bosqichni tarqatish

1. CI testlari, yangi installer/ZIP buildlari va aynan paketdan ishga tushish
   tekshiruvi o'tadi. GitHub'da mavjud immutable reliz almashtirilmaydi.
2. Alohida sinov kompyuterida eski o'rnatmadan yangilash, restart, seans/bar,
   buzilgan paket, disk to'lishi va elektr uzilishini taqlid qilish tekshiriladi.
3. Umumiy avtomatik yangilash manifestini e'lon qilishdan oldin tayyor artefakt
   bitta kelishilgan sinov klubiga nazorat bilan o'rnatiladi. Avval zaxira va
   tiklash mashqi bajariladi; kamida bir ish smenasi, tavsiya 24–48 soat kuzatiladi.
4. Balanslar, qaytim, seanslar, mobil hisobot va diagnostika taqqoslanadi. Nosozlik
   aniqlansa ommaviy tarqatish to'xtatiladi; qabuldan keyin pulni orqaga suruvchi
   avtomatik database rollback ishlatilmaydi.
5. Keyin umumiy reliz chiqariladi. Hozir avtomatik klub guruhlari bo'yicha
   tarqatish mexanizmi yo'q: umumiy manifestni chiqarish barcha mos klublarga
   yangilash taklif qiladi. Buni nazoratli sinov o'rniga ishlatmaslik kerak.

## Xizmatni chiqarishdan oldingi majburiy sinovlar

- Windows reboot, logout, oddiy UI yopilishi va Task Manager orqali UI yopilishi.
- Ikkita launcher, qo'lda Node boshlanishi, SCM restart va OTA bir paytda kelishi.
- Seans/bar to'lovi yozilayotganda stop; takroriy mobil buyruq; WAL tiklanishi.
- Har bir yangilash bosqichida jarayon uzilishi va qabuldan keyingi yangi savdo.
- Band port, yo'q runtime, noto'g'ri ruxsat, disk to'lishi, yaroqsiz sozlama/zaxira.
- Internet yo'qligi mahalliy litsenziya siyosatidan tashqari qo'shimcha to'xtash
  keltirmasligi; diagnostika yolg'ondan Online ko'rsatmasligi.
- Xizmatni olib tashlash/qayta o'rnatish ma'lumot va litsenziyani saqlashi.

Moliyaviy restart sinovlari STABILITY-PLAN.md dagi 4-bosqichda qayd etilgan.
Windows 10/11 Pro'da haqiqiy reboot/logout, eski setupdan ko'chish va kamida bir
ish smenasi kuzatuvi hali alohida tarqatish shartidir.
