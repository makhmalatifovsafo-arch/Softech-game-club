// These releases intentionally open without the full-screen presentation.
export const presentationlessReleases=['1.3.5','1.3.6'];
export const releaseNotes={
 '1.3.10':{
  title:'Aniq logo va qulay qo‘llanma',
  intro:'Server va client ko‘rinishi saytimizga moslandi.',
  slides:[
   {roles:['club_owner','manager','administrator'],icon:'✦',title:'Softech belgisi tiniqroq',text:'Server ochilganda va clientning qulflangan ekranida yangilangan logo ko‘rinadi. Yozuv va belgi katta ekranlarda ham aniq chiqadi. Clientdagi o‘zgarish uning dasturi yangilangandan keyin ko‘rinadi.',action:'Server va client → 1.3.10 versiyasi'},
   {roles:['club_owner','manager','administrator'],icon:'?',title:'Kerakli joyda qisqa yordam',text:'Seans, bar yoki tarif oynasidagi «?» belgisini bosing. Aynan shu funksiyani tushuntiradigan qisqa qo‘llanma yangi saytimizda ochiladi.',action:'Server → Kerakli oyna → ?'}
  ]
 },
 '1.3.9':{
  title:'Xonalarni o‘zingiz xohlagandek chizing',
  intro:'Serverdagi klubni sozlash oynasida xona chizish va tahrirlash qulayroq.',
  slides:[
   {roles:['club_owner','manager'],icon:'✎',title:'Pero bilan erkin xona shakli',text:'To‘rtburchak yoki Pero asbobini tanlang. Pero bilan burchaklarni birma-bir belgilang — L shaklidagi xonani ham chizish mumkin. Birinchi nuqtaga yoki «Xonani tugatish»ga bosing.',action:'Server → Sozlamalar → Klubni sozlash → Xonalar'},
   {roles:['club_owner','manager'],icon:'↔',title:'Burchagidan tortib moslang',text:'Xonani tanlab, tutqichlarini torting. Pero bilan chizilgan xonaga yangi burchak qo‘shish ham mumkin. + va − xaritani yaqinlashtiradi; Esc boshlangan chizish yoki tortishni bekor qiladi.',action:'Server → Klubni sozlash → Xonalar'}
  ]
 },
 '1.3.8':{
  title:'Tariflar va klubni sozlash tushunarliroq',
  intro:'Xona narxlari bitta joyda, sozlash oynalari esa soddaroq.',
  slides:[
   {roles:['club_owner','manager'],icon:'🕒',title:'Xona tariflari bitta joyda',text:'Xonani tanlab, vaqt oralig‘i, hafta kunlari va soatlik narxni o‘zgartiring. Oraliq qo‘shish va olib tashlash ham shu yerda. O‘zgarishlar «Tariflarni saqlash» bosilganda qo‘llanadi.',action:'Server → Sozlamalar → Dinamik tariflar'},
   {roles:['club_owner','manager'],icon:'🛠️',title:'Sozlash ustasi amaldagi narxlarni oladi',text:'Tugatilgan ustani qayta ochganda hozirgi xona tariflari ko‘rinadi. Kompyuterlar soni va yakuniy tekshiruv ham soddalashtirildi. Tariflarni o‘zgartirish uchun xonadagi faol seanslar tugashini kuting.',action:'Server → Sozlamalar → Klubni sozlash'},
   {roles:['club_owner','manager','administrator'],icon:'🎮',title:'VIP Postpaid uchun ortiqcha tugma yo‘q',text:'VIP Postpaid seansi yopilguncha davom etadi, shuning uchun unga «Vaqt qo‘shish» ko‘rsatilmaydi. Menejer VIP rejimini o‘chirib saqlasa, yangi VIP seans ochish ham to‘xtaydi.',action:'Server yoki mobil dastur → Kompyuterlar'},
   {roles:['club_owner','manager','administrator'],icon:'🖥️',title:'Kassa oynasini o‘zingizga moslang',text:'Serverdagi dastur oynasini cheti yoki burchagidan ushlab kattalashtirish va kichraytirish mumkin.',action:'Serverdagi dastur oynasining chetidan torting'}
  ]
 },
 '1.3.7':{
  title:'Klubni tayyorlash va o‘rganish osonroq',
  intro:'Server dasturida yangi sozlash ustasi, qisqa mashqlar va kerakli joyda yordam.',
  slides:[
   {roles:['club_owner','manager'],icon:'🛠️',title:'Yangi klubni bosqichma-bosqich sozlang',text:'Server dasturidagi usta xonalar, kompyuterlar va tariflarni ketma-ket tayyorlaydi. Ishni boshlashdan oldin barcha clientlar ulanishi va tariflar haftaning barcha soatlarini qoplashi tekshiriladi.',action:'Server → Sozlamalar → Klubni sozlash'},
   {roles:['club_owner','manager','administrator'],icon:'🎮',title:'Bosib ko‘rib o‘rganing',text:'Serverdagi qisqa tanishtirish seans, bar va yakuniy hisobni namuna bilan tushuntiradi. Mashqlar haqiqiy seans ochmaydi va pul hisobiga ta’sir qilmaydi. Keyinroq davom ettirish ham mumkin.',action:'Server → Sozlamalar → Qisqa tanishtirish'},
   {roles:['club_owner','manager','administrator'],icon:'❔',title:'Kerakli joyda qisqa yordam',text:'Serverdagi ayrim funksiyalar yonidagi «?» belgisi aynan shu funksiyani tushuntiradigan sahifani ochadi. Qisqa ko‘rsatmalar va misollar ishni tezroq tushunishga yordam beradi.',action:'Serverdagi «?» belgisini bosing'},
   {roles:['club_owner','manager'],icon:'📊',title:'Hisobot kassani kamroq kutdiradi',text:'Server statistikasi alohida hisoblanadi, tayyor natija esa qayta ishlatiladi. Katta hisobot ochilganda seans va savdo amallariga tushadigan yuk kamayadi.',action:'Server → Statistika'}
  ]
 },
 '1.3.4':{
  title:'Mobil boshqaruv tezroq va tushunarli',
  intro:'v1.3.4 da kundalik ish uchun nimalar yaxshilanganini ko‘ring.',
  slides:[
   {roles:['club_owner','manager','administrator'],icon:'✨',title:'Yangiliklar endi shu yerda',text:'Har yangi versiya birinchi ochilganda sizga kerakli o‘zgarishlarni qisqa va tushunarli ko‘rsatadi. Uni keyin ham qayta ochishingiz mumkin.',action:'Sozlamalar yoki Akkaunt → Versiya yangiliklari'},
   {roles:['club_owner','manager'],icon:'📊',title:'Mobil ma’lumotlar tezroq yangilanadi',text:'Kompyuterlar, kassa va bar ma’lumotlari serverdan bir vaqtda olinadi. Hisobot va klub holatini kutish vaqti qisqardi.',action:'Mobil dastur → Hisobot'},
   {roles:['administrator'],icon:'⚡',title:'Mobil amallar tezroq tasdiqlanadi',text:'Seans ochish, vaqt qo‘shish va boshqa mobil buyruqlarning server javobi tezroq telefonga qaytadi.',action:'Mobil dastur → Kompyuterlar'},
   {roles:['administrator'],icon:'🖥️',title:'Seans ochish qulayroq',text:'Mobil dasturdagi seans serverning haqiqiy tarifi va hisob-kitobi bilan ochiladi. Amal natijasi kelmaguncha takroriy buyruq yuborilmaydi.',action:'Kompyuter → Seans ochish'},
   {roles:['club_owner','manager'],icon:'🔄',title:'Klub holati ishonchliroq yetib boradi',text:'Ko‘p kompyuterli klublarda holat bulutga bitta paketda yuboriladi. Mobil va Super Admin panelidagi kechikish kamayadi.',action:'Mobil dastur → Kompyuterlar'},
   {roles:['club_owner','manager','administrator'],icon:'📱',title:'Telefon ekraniga to‘liq mos',text:'Dynamic Island, Android kamera maydoni va pastki boshqaruv chizig‘i hisobga olinadi. Tugmalar ekran chetida qolib ketmaydi.',action:'iPhone va Android uchun'}
  ]
 }
};
