# Avtowebinar bot — Texnik topshiriq
2026-10-22 · @Diyor Bakhromov
## 1. Loyiha haqida
Tizim yozib olingan webinar videosini har kuni ishlaydigan avtowebinarga aylantirib, kurs sotuvini avtomatlashtiradi. Har bir webinar uchun yangi kanal ochib trafik yig'ish o'rniga reklama doimiy ishlaydi va har bir lid bir kun ichida efirga tushadi. Webinar 2 kunlik: 1-kun va 2-kun videolari ketma-ket kunlarda, bir xil vaqtda ochiladi.
Maqsadlar:
- Har kuni ishlaydigan voronka: ro'yxat → progrev → efir → oferta → to'lov.
- Progrevni bot avtomatik qiladi; kontentni jamoa admin paneldan dasturchisiz kiritadi va o'zgartiradi.
- Har bir bosqich bo'yicha aniq statistika — natijani jonli webinar bilan solishtirish uchun.
Auditoriya: o'zbek tilida so'zlashuvchi, asosan ayollar, Telegramdan mobil telefonda foydalanadi. Interfeys tili — o'zbek (lotin).
| Qism | Kim uchun | Vazifasi |
| Telegram bot | Lid | Ro'yxat, sessiya tanlash, progrev, eslatmalar, to'lov rekvizitlari, chek qabul qilish |
| Mini App (efir sahifasi) | Lid | Videoni belgilangan vaqtda sinxron ko'rsatish, sotuv tugmasi, savollar |
| Admin panel (veb) | Jamoa | Progrev kontenti, slotlar, video, lidlar, to'lovlar, statistika |
| Backend | — | Rejalashtiruvchi, ma'lumotlar bazasi, video va to'lov integratsiyalari |

## 2. Atamalar
| Atama | Ma'nosi |
| Voronka | Bitta kurs uchun to'plam: webinar videosi, slotlar, progrev zanjiri, oferta. Tizim bir nechta voronkani qo'llab-quvvatlaydi. |
| Lid | Botga /start bosgan foydalanuvchi. |
| Slot | Efir boshlanadigan vaqt shabloni, masalan har kuni 14:00 va 20:00. |
| Sessiya | Ikki kunlik efir: 1-kun (tanlangan slot) va 2-kun (1-kundan aniq 24 soat keyin), masalan 23-oktabr 20:00 va 24-oktabr 20:00. Har bir lid bir vaqtda bitta sessiyaga yoziladi. |
| Progrev zanjiri | Lidga vaqt bo'yicha avtomatik yuboriladigan xabarlar ketma-ketligi. |
| Trigger | Xabar qachon yuborilishini belgilaydigan qoida: ro'yxatdan keyin, 1-kun yoki 2-kundan oldin, kun tugaganidan keyin. |
| Segment | Lidlar guruhi holat bo'yicha: 1-kunga keldi / kelmadi, 2-kunga keldi / kelmadi, oferta momentigacha ko'rdi, chek yubordi, boshlang'ich to'ladi, to'liq to'ladi. |
| Oferta timecode | 2-kun videosida sotuv taklifi boshlanadigan daqiqa; shu payt sotuv tugmasi chiqadi. 1-kunda ixtiyoriy yumshoq taklif bo'lishi mumkin. |
| Shaxsiy deadline | Lidning maxsus narx muddati: 2-kun efiri tugaganidan keyin admin belgilagan soatlar. |
| Lid magnit | Ro'yxatdan keyin darhol beriladigan sovg'a: PDF, qisqa video dars. |

## 3. Foydalanuvchi yo'li
Lid reklamadan kursgacha bitta bot ichida, ikki kunlik efir orqali o'tadi; qaysi kunni ko'rmasa ham yo'qolmaydi — shu kunni qayta tanlab voronkaga qaytadi.
[EMBED: lid yo'li · 2 kunlik efir, 3 qaror ref=node/f6bf2e01-1e73]
To'lamagan lid shaxsiy deadline tugaguncha eslatma oladi, keyin oddiy narxga o'tadi. Har bir bosqichning qoidalari 4–8-bo'limlarda.
## 4. Telegram bot funksiyalari
Bot lidni ro'yxatdan o'tkazadi, sessiyaga yozadi va efirdan oldin ham, keyin ham olib boradi.
4.1. /start va manba
- Kirish deep link orqali: t.me/<bot>?start=<voronka>_<manba>. Voronka va manba (kampaniya, kreativ) lid profiliga yoziladi. Parametr 64 belgigacha, faqat lotin harf, raqam, _ va - (Telegram cheklovi).
- Ro'yxatdagi lid qayta /start bossa, qayta ro'yxat qilinmaydi — holatiga mos xabar chiqadi (masalan, "Efiringiz ertaga 20:00 da").
4.2. Ro'yxat
- Ism Telegram profilidan olinadi, lid o'zgartirishi mumkin.
- Telefon — "Raqamni yuborish" tugmasi orqali. Telefon majburiy: raqamsiz sessiya tanlash ochilmaydi, chunki sotuv bo'limi to'lov va boshlang'ich to'lov qilganlar bilan bog'lanadi. Lid boshqa raqam yozsa, +998 XX XXX XX XX formatida tekshiriladi.
- Ro'yxatdan keyin darhol lid magnit yuboriladi va sessiya tanlash tugmalari chiqadi (5-bo'lim).
4.3. Eslatmalar
Standart eslatmalar progrev zanjirining bir qismi bo'lib, admin paneldan tahrirlanadi: 1-kundan 24 soat, 2 soat va 15 daqiqa oldin; 2-kundan 1-kun tugashi bilan, 2 soat va 15 daqiqa oldin; har ikki kunda boshlanganda "Efirga kirish" tugmasi (Mini App). Har bir kun boshlanib 10 daqiqa o'tib ham kirmagan lidga qo'shimcha eslatma boradi.
4.4. Kelmaganlar uchun qayta vaqt tanlash
- 1-kunni ko'rmagan lidga efir tugagach "Boshqa vaqt tanlash" tugmasi bilan xabar boradi; yangi sessiya 1-kundan boshlanadi.
- 1-kunni ko'rib, 2-kunni ko'rmagan lidga faqat 2-kunni boshqa vaqtga qayta tanlash taklif qilinadi — oferta 2-kunda bo'lgani uchun 1-kunni qayta ko'rish shart emas.
- Qayta tanlash soni cheklanadi: standart har bir kun uchun 3 martagacha (admin sozlaydi). Kirmagan yoki chegaradan kam ko'rgan lid "ko'rmagan" hisoblanadi (chegara admin sozlaydi). Chegara: 1-kun — videoning kamida 75% i, shundagina lid 2-kunga taklif oladi; 2-kun — oferta momentiga yetgan bo'lsa. Limitdan keyin lid "sovuq" segmentga o'tadi va faqat ommaviy xabarlar oladi.
4.5. Menyu
- "Mening efirim" — 1-kun va 2-kun sanalari va vaqti, vaqti kelganda "Efirga kirish", 1-kun vaqtini o'zgartirish (kamida N soat oldin; 2-kun birga ko'chadi).
- "Savol berish" — savol admin panelning Savollar bo'limiga tushadi.
- "Xabarlarni to'xtatish" — lid progrev va ommaviy xabarlardan chiqadi.
4.6. Bloklash
Lid botni bloklasa (Telegram 403 xatosi), u "bloklagan" deb belgilanadi va unga yuborish to'xtatiladi. Statistikada alohida ko'rinadi.
4.7. To'lov
Bot oferta tugmasidan keyin tarif va to'lov usulini ko'rsatadi, karta rekvizitlari yoki Payme/Click havolasini beradi va lid yuborgan chekni qabul qiladi (8-bo'lim).
## 5. Slot tanlash mantiqi
Lidga eng yaqin mos sessiyalar taklif qilinadi: kutish qancha qisqa bo'lsa, efirga kelish shuncha yuqori bo'ladi.
1. Slotlar admin paneldan beriladi (standart: har kuni 14:00 va 20:00, Asia/Tashkent). Hafta kunlari va istisno sanalar (bayramlar) sozlanadi.
2. Lid faqat 1-kun vaqtini tanlaydi. 1-kun ro'yxatdan kamida N soat keyin bo'lsagina taklif qilinadi (standart N = 3) — progrevga vaqt qolishi uchun. Faqat ertangi kun kerak bo'lsa, N = 24 qo'yiladi.
3. 2-kun avtomatik belgilanadi: har doim 1-kundan aniq 24 soat keyin (masalan, seshanba 20:00 → chorshanba 20:00). 1-kun faqat keyingi kuni ham efir bo'ladigan kunlarga taklif qilinadi.
4. Lidga 1-kun uchun eng yaqin K ta variant ko'rsatiladi (standart K = 2). Tugma matni: "Bugun 20:00", "Ertaga 14:00".
5. Lid 1-kun vaqtini 1-kundan kamida N soat oldin o'zgartirishi mumkin; 2-kun u bilan birga ko'chadi. 2-kun vaqtini alohida o'zgartirib bo'lmaydi.
6. Kech kirish: har bir kun boshlanganidan keyin L daqiqa ichida kirish mumkin (standart L = 15; 1-kun videosining 25% idan oshmasligi kerak, aks holda kech kirgan lid 75% ga yeta olmaydi). Kech kirgan lid videoni joriy daqiqadan boshlab ko'radi.
| Lid kirgan vaqt | 1-kun uchun taklif (N = 3, K = 2); 2-kun — aniq 24 soatdan keyin |
| Seshanba 09:30 | Bugun 14:00, Bugun 20:00 |
| Seshanba 12:00 | Bugun 20:00, Ertaga 14:00 |
| Seshanba 18:00 | Ertaga 14:00, Ertaga 20:00 |
| Seshanba 23:40 | Ertaga 14:00, Ertaga 20:00 |

## 6. Progrev zanjiri mantiqi
Progrev zanjiri — admin paneldan kiritiladigan xabarlar to'plami; bot har bir lid uchun ularni uning sessiya vaqtiga qarab rejalashtiradi.
| Maydon | Qiymatlar |
| Voronka | Xabar qaysi voronkaga tegishli |
| Turi | Matn, rasm, video, video-doira, ovozli xabar, audio, fayl, albom (2–10 media) |
| Matn | Qalin, kursiv, havola, spoyler; o'zgaruvchilar {ism}, {efir_sanasi}, {efir_vaqti}, {deadline}. Matn 4096 belgigacha, media izohi 1024 belgigacha (Telegram cheklovi) |
| Tugmalar | URL, "Efirga kirish" (Mini App), "Vaqtni o'zgartirish", to'lov havolasi; 1–3 qator |
| Trigger | Ro'yxatdan X keyin · 1-kun yoki 2-kundan X oldin · kun boshlanishida · kun tugaganidan X keyin · tugma bosilganda · qadamda X vaqt to'xtab qolganda |
| Segment | Hammaga · 1-kunga kelganlar / kelmaganlar · 2-kunga kelganlar / kelmaganlar · oferta momentigacha ko'rganlar · chek yuborganlar · boshlang'ich to'laganlar · to'liq to'laganlar · to'lamaganlar |
| Majburiy | Ha / yo'q — siqish qoidasi uchun |
| Holat | Faol / qoralama |

Rejalashtirish qoidalari:
1. Lid sessiya tanlaganida zanjirning barcha xabarlari unga aniq vaqt bilan rejalashtiriladi.
2. Siqish qoidasi. "Ro'yxatdan keyin" triggeridagi xabar 1-kundan 30 daqiqa oldingacha sig'masa: majburiy bo'lmasa — o'tkazib yuboriladi; majburiy bo'lsa — qolgan vaqtga teng oraliqlarda, kamida 20 daqiqa farq bilan yuboriladi.
3. Lid vaqtni o'zgartirsa, sessiyaga bog'liq xabarlar qayta rejalashtiriladi; yuborilganlari qayta yuborilmaydi.
4. Tungi tinchlik: 23:00–08:00 ga tushgan xabarlar 08:00 ga suriladi (oraliq admin panelda sozlanadi).
5. Segment yuborish paytida tekshiriladi: masalan, boshlang'ich yoki to'liq to'lagan lidga sotuv va deadline xabarlari bormaydi.
6. Har bir xabar bitta lidga faqat bir marta yuboriladi.
7. Admin xabarni tahrirlasa, o'zgarish faqat hali yuborilmagan rejalarga ta'sir qiladi.
Kunlar orasidagi progrev
1-kun tugashidan 2-kungacha bo'lgan bir sutkalik oraliq zanjirda alohida blok bo'lib ko'rinadi: 1-kun xulosasi, kichik uy vazifasi, 2-kunda nima bo'lishi. Bu blok faqat 1-kun videosining kamida 75% ini ko'rganlarga ketadi; kelmaganlarga qayta tanlash xabari boradi (4.4).
## 7. Mini App — efir sahifasi
Mini App bot ichida ochiladigan efir sahifasi; video barcha tomoshabinlar uchun sessiya boshlanish vaqtiga sinxron o'ynaydi.
| Holat | Qachon | Ekranda |
| Kutish | 1-kungacha | Qolgan vaqt taymeri, efir mavzusi, spiker rasmi |
| Efir | Har bir kun boshidan shu kun videosi tugaguncha | Sinxron video, asl efir izohlari, savol maydoni; 2-kunda oferta timecode'dan keyin sotuv bloki |
| Kunlar orasida | 1-kun videosi tugagach, 2-kungacha | "1-kun yakunlandi", 2-kungacha taymer, 1-kun qisqa xulosasi |
| Tugagan | 2-kun videosi tugagach | "Efir yakunlandi", sotuv bloki va shaxsiy deadline taymeri; takroriy ko'rish yo'q — ko'rmaganlarga qayta vaqt beriladi (4.4) |
| Kirish yopiq | Kech kirish chegarasi (L) o'tgach | "Efir boshlanib ketgan" va "Boshqa vaqt tanlash" tugmasi |

Pleyer
- Pozitsiya = server vaqti − shu kun efirining boshlanish vaqti. Sahifa yopilib qayta ochilsa, joriy daqiqadan davom etadi.
- Pauza, orqaga/oldinga o'tkazish va tezlik o'chirilgan. Ovoz va to'liq ekran ishlaydi.
- Internet uzilib qaytsa, farq 5 soniyadan oshganda pleyer server vaqtiga qayta moslashadi.
- HLS adaptiv sifat (360p–1080p) — sekin mobil internet uchun.
- iOS ovozli avtomatik ijroga ruxsat bermaydi: birinchi ochilishda "Ko'rishni boshlash" tugmasi chiqadi.
- Video havolasi vaqtinchalik va imzolangan (signed URL). To'liq himoya imkonsiz; maqsad — oddiy yuklab olishni qiyinlashtirish.
- Har 30 soniyada pozitsiya serverga yuboriladi (heartbeat) — ko'rish davomiyligi va oferta momentiga yetganini hisoblash uchun.
Kirish
Lid Telegram initData orqali aniqlanadi, backend uning imzosini bot tokeni bilan tekshiradi; login so'ralmaydi. Lid faqat o'z sessiyasining tegishli kuniga kira oladi.
Izohlar va savollar
- Admin asl jonli webinardagi izohlarni har bir kun uchun alohida, timecode bilan yuklaydi; ular videoga sinxron chiqadi. Lenta sarlavhasi: "Asl efir ishtirokchilarining izohlari". Bu lentaga yangi izoh yozilmaydi.
- "Savol yuborish" maydoni: savol admin panelga tushadi, javob bot orqali lidga boradi.
Dizayn
Voronka bo'yicha sozlanadi: logotip, ranglar, fon rasmi. Arab tili kursi uchun — to'q fon, oltin rang, xattotlik motivlari. Faqat mobil uchun loyihalanadi, minimal kenglik 360 px.
## 8. Sotuv bloki, deadline va to'lov
Sotuv tugmasi 2-kun videosida taklif aytilgan daqiqada chiqadi va lidning shaxsiy deadline'iga qadar maxsus narxda ishlaydi.
Sotuv bloki
- Oferta timecode'da Mini App'da banner chiqadi: kurs nomi, narx, bonuslar, "Kursga yozilish" tugmasi.
- Shu payt bot ham taklif xabarini yuborishi mumkin (zanjirda "sessiya boshidan X daqiqa keyin" triggeri bilan).
- Bir nechta tarif qo'llab-quvvatlanadi (masalan, Standart va VIP). 1-kun videosiga ham ixtiyoriy yumshoq taklif qo'yish mumkin (masalan, erta yozilish bonusi).
Shaxsiy deadline
- Deadline = 2-kun efiri tugashi + D soat (standart D = 24, admin sozlaydi).
- Muddat ichida — maxsus narx. Muddat tugagach — oddiy narx yoki taklif yopiladi (admin tanlaydi).
- Muddat haqiqatan ishlaydi: tugagach maxsus narxga qaytish yo'q; faqat admin lid kartasidan qo'lda uzaytira oladi.
- Mini App va to'lov sahifasidagi taymer lidning o'z deadline'ini ko'rsatadi.
To'lov
To'lov oqimi: tarif tanlash → to'lov usuli → karta rekvizitlari yoki havola → chek yuborish → menejer tasdig'i → kanalga havola (faqat to'liq to'lovda).
| Usul | Lid nima qiladi | Tasdiq |
| Karta orqali o'tkazma | Bot karta raqami, egasi va summani ko'rsatadi (raqam bir bosishda nusxalanadi); lid pul o'tkazib, chek rasmi yoki PDF ni botga yuboradi | Menejer admin panelda chekni ko'rib tasdiqlaydi |
| Payme | "Payme orqali to'lash" tugmasi Payme to'lov havolasini ochadi; to'lovdan keyin lid chek yuboradi | MVP: menejer Payme kabinetidan tekshirib tasdiqlaydi. 2-bosqich: Payme Merchant API orqali avtomatik |
| Click | "Click orqali to'lash" tugmasi Click to'lov havolasini ochadi; to'lovdan keyin lid chek yuboradi | MVP: menejer Click kabinetidan tekshirib tasdiqlaydi. 2-bosqich: Click Merchant API orqali avtomatik |

Chek va tasdiq
- Chek kelishi bilan adminlarning Telegram guruhiga tushadi: chek rasmi yoki PDF, lid ismi va telefoni, tarif, summa (to'liq yoki boshlang'ich), to'lov usuli, deadline va "Tasdiqlash" / "Rad etish" tugmalari. Admin shu yerning o'zida bir bosishda tasdiqlaydi.
- Tugmani faqat admin panelda ro'yxatdan o'tgan admin yoki sotuv menejeri (Telegram ID bo'yicha) bosa oladi. Kim va qachon tasdiqlagani guruhdagi xabarda ko'rinadi; bir chekni ikki marta tasdiqlab bo'lmaydi.
- Rad etishda sabab tanlanadi (summa mos emas, chek o'qilmaydi va h.k.). Natija lidga bot orqali darhol boradi.
- Lidga chek kelishi bilan javob: "Chekingiz qabul qilindi, tez orada tasdiqlanadi."
- Admin panelda ham "Tasdiq kutilmoqda" navbati bor — cheklar tarixi va zaxira yo'l sifatida.
- Chek deadline ichida yuborilgan bo'lsa, tasdiq keyinroq bo'lsa ham maxsus narx saqlanadi.
- Bir xil chek fayli qayta yuborilsa (fayl xeshi mos), guruhdagi xabarda va admin panelda ogohlantirish chiqadi.
- Karta rekvizitlari va Payme/Click havolalari voronka bo'yicha kiritiladi. Ularni faqat super admin o'zgartiradi; har bir o'zgarish loglanadi va boshqa super adminlarga Telegram orqali xabar boradi.
Boshlang'ich to'lov
- Tarifda boshlang'ich to'lov yoqilishi mumkin: lid to'liq summa o'rniga belgilangan summani to'laydi (hozir 100 000 so'm, admin paneldan o'zgartiriladi).
- Lid chekni botga yuboradi yoki to'g'ridan-to'g'ri menejerga beradi. Menejerga kelgan chekni menejer lid kartasiga yuklaydi — u bot cheklari bilan bir xil navbatga tushadi.
- Admin chekni tasdiqlagach, lid "boshlang'ich to'lagan" segmentiga o'tadi. U kanalga avtomatik qo'shilmaydi.
- Bot bu lidga sotuv va deadline xabarlarini to'xtatadi. Keyingi jarayonni sotuvchi olib boradi: lid bilan bog'lanib, darslar boshlanish vaqtini va qolgan to'lov muddatini tushuntiradi.
- Boshlang'ich to'lov deadline ichida tasdiqlansa, maxsus narx shu lid uchun saqlanadi.
- Menejer lid kartasiga qolgan summa va to'lov sanasini kiritadi; sana kelganda menejerga Telegram eslatmasi boradi. Qolgan to'lov ham chek orqali tasdiqlanadi.
- To'liq to'lov tasdiqlangach lid "to'liq to'lagan" bo'ladi va kanal havolasi yuboriladi.
To'lovdan keyin
- To'liq to'lov tasdiqlangach lid "to'liq to'lagan" segmentiga o'tadi, sotuv xabarlari to'xtaydi.
- Bot yopiq kurs kanaliga bir kishilik, muddatli taklif havolasini yuboradi (bot kanalda admin bo'lishi kerak). Boshlang'ich to'lovda havola avtomatik yuborilmaydi; kerak bo'lsa menejer lid kartasidagi "Kanalga havola yuborish" tugmasi bilan qo'lda yuboradi.
- Summa, tarif, to'lov usuli va cheklar lid kartasida saqlanadi.
## 9. Admin panel
Admin panel — jamoa progrev kontenti, slotlar va sotuvni dasturchisiz boshqaradigan veb-ilova; asosiy ish progrev muharririda bo'ladi.
| Bo'lim | Nima qilinadi |
| Dashboard | Bugungi va tanlangan davr bo'yicha voronka ko'rsatkichlari, yaqin sessiyalar, javobsiz savollar |
| Voronkalar | Voronka yaratish va nusxalash; manba bo'yicha deep link generatori |
| Webinar videosi | 1-kun va 2-kun videolari: yuklash yoki hosting ID, davomiylik, oferta timecode (2-kun; 1-kunda ixtiyoriy), kunlar orasidagi xulosa matni; oldindan ko'rish |
| Slotlar | Vaqtlar, hafta kunlari, istisno sanalar, N, K, L sozlamalari |
| Progrev zanjiri | Xabarlar vaqt chizig'ida; qo'shish, tahrirlash, nusxalash, tartiblash, faol/qoralama |
| Sotuv bloki | Tariflar, narxlar, boshlang'ich to'lov summasi, bonuslar matni, deadline soatlari (D), muddatdan keyingi holat; karta rekvizitlari va Payme/Click havolalari |
| Izohlar | Asl efir izohlarini CSV dan import qilish yoki qo'lda kiritish: timecode, ism, matn |
| Lidlar | Ro'yxat, filtrlar, qidiruv, lid kartasi, Excel eksport |
| Savollar | Efir va botdagi savollar; javob yozish (bot orqali yuboriladi) |
| To'lovlar | Cheklar navbati (tasdiqlash / rad etish), to'lovlar ro'yxati usul va turi bo'yicha (boshlang'ich / to'liq), qaytarish belgisi |
| Ommaviy xabar | Segmentga xabar: darhol yoki rejali; test yuborish |
| Statistika | 10-bo'lim |
| Sozlamalar | Foydalanuvchilar va rollar (Telegram ID bilan), cheklar uchun admin Telegram guruhi, bot sozlamalari, tungi tinchlik oralig'i |

Progrev muharriri
- Xabarning Telegram'dagi ko'rinishi jonli oldindan ko'rsatiladi.
- "Menga test yuborish" — xabar adminning o'z Telegramiga keladi.
- Media yuklashda Telegram cheklovlari tekshiriladi: fayl hajmi, video-doira kvadrat va 1 daqiqagacha.
- Zanjir vaqt chizig'ida ko'rinadi: ro'yxat → 1-kun → kunlar orasi → 2-kun → 2-kundan keyin, har bir xabar o'z joyida.
- "Lid sifatida sinash": ro'yxat vaqti va sessiya tanlanadi, qaysi xabar qachon borishi ko'rsatiladi — siqish qoidasini tekshirish uchun.
- Matnda "jonli", "live" so'zlari bo'lsa ogohlantirish chiqadi (11-bo'lim).
- O'zgarishlar tarixi: kim, qachon, nimani o'zgartirdi.
Lid kartasi
Ism, telefon, username, manba, ro'yxat sanasi, sessiyalar, har bir kunda necha daqiqa ko'rgani, oferta momentiga yetgani, yuborilgan xabarlar tarixi, to'lov va cheklar, deadline, menejer izohi.
Sotuv bo'limi: lid tarixi va qo'ng'iroq ro'yxatlari
Sotuv menejeri har bir lid efirni ko'rgan-ko'rmaganini va qayerda to'xtaganini ko'rib, kimga va nima haqida qo'ng'iroq qilishni biladi.
- Lidlar ro'yxati ustunlari: ism, telefon, manba, 1-kun (ko'rgan daqiqasi yoki "ko'rmadi"), 2-kun, oferta momentiga yetdimi, tugma bosdimi, chek, to'lov holati (yo'q / boshlang'ich / to'liq), biriktirilgan menejer, oxirgi aloqa.
- Tayyor qo'ng'iroq ro'yxatlari: "Boshlang'ich to'laganlar", "To'liq to'laganlar", "Ofertani ko'rgan, to'lamagan", "Tugma bosgan, chek yubormagan", "Chek rad etilgan", "2-kunni ko'rmagan".
- Lid kartasida voqealar lentasi vaqt bo'yicha: ro'yxat, sessiya tanlash, har bir kunga kirish va ko'rgan daqiqasi, tugma bosish, chek, to'lov, menejer izohlari.
- Menejer aloqa natijasini belgilaydi: javob bermadi / qayta qo'ng'iroq (sana bilan) / sotildi / rad etdi, izoh bilan.
- Lid menejerga biriktiriladi (qo'lda yoki navbat bilan); menejer o'ziga biriktirilganlarni ko'radi.
- Chek yoki boshlang'ich to'lov kelganda biriktirilgan menejerga Telegram orqali xabar boradi. Lid kartasida qolgan summa va to'lov sanasi maydonlari bor; sana kelganda menejerga eslatma boradi.
### To'xtab qolgan lidlarni qaytarish
Voronkaning istalgan qadamida to'xtab qolgan lid yo'qolmaydi: bot unga avtomatik eslatma yuboradi, eslatma ishlamasa lid menejerning qo'ng'iroq ro'yxatiga tushadi.
| Qayerda to'xtadi | Qachon "to'xtagan" hisoblanadi (standart) | Bot nima yuboradi | Menejer ro'yxati |
| /start bosdi, telefon bermadi | 1 soat o'tdi | "Raqamni yuborish" eslatmasi: 1 soat va 24 soatdan keyin | Yo'q — telefon yo'q, faqat bot orqali |
| Telefon berdi, sessiya tanlamadi | 2 soat o'tdi | Vaqt tanlash tugmalari bilan eslatma: 2 soat va 24 soatdan keyin | "Sessiya tanlamagan" |
| 1-kunni ko'rmadi | 1-kun efiri tugadi | Qayta vaqt tanlash (4.4) | "1-kunni ko'rmagan" |
| 2-kunni ko'rmadi | 2-kun efiri tugadi | 2-kunni qayta tanlash (4.4) | "2-kunni ko'rmagan" |
| 2-kunga kirdi, ofertagacha chiqib ketdi | 2-kun efiri tugadi | Taklif mazmuni, narx, deadline va "Kursga yozilish" tugmasi | "Ofertagacha chiqib ketgan" |
| Tugma bosdi, chek yubormadi | 1 soat o'tdi | To'lov rekvizitlari va "Chek yuborish" eslatmasi | "Tugma bosgan, chek yubormagan" |
| Chek rad etildi | Darhol | Rad etish sababi va chekni qayta yuborish tugmasi | "Chek rad etilgan" |
| Qayta tanlash limiti tugadi | Limitdan keyin | Faqat ommaviy xabarlar | "Sovuq lidlar" |
| Botni bloklagan | 403 xatosi keldi | Hech narsa — bot yubora olmaydi | "Botni bloklagan" — faqat telefon orqali |

- Har bir qadam uchun "to'xtagan" vaqti va eslatmalar matni admin paneldan sozlanadi. Eslatmalar progrev zanjirida "qadamda X vaqt to'xtab qolganda" triggeri bilan kiritiladi.
- Lid keyingi qadamga o'tishi bilan shu qadamning eslatmalari bekor bo'ladi va u ro'yxatdan avtomatik chiqadi.
- Lidlar ro'yxatida har bir lid uchun "Oxirgi qadam" va "Qancha vaqtdan beri" ustunlari bor. Filtr: qadam bo'yicha, manba, sana, menejer.
- Istalgan ro'yxatdan menejer: tanlangan lidlarga bot orqali xabar yuboradi (matn, tugma, media); lid kartasidan qo'ng'iroq qiladi (telefon raqami bosiladigan havola); ro'yxatni telefonlar bilan Excel'ga eksport qiladi.
- "Xabarlarni to'xtatish" bosgan lidga avtomatik va ommaviy xabarlar bormaydi; ro'yxatda belgisi bilan ko'rinadi.
- Statistikada har bir qadam uchun: nechta lid to'xtadi, nechtasi eslatmadan keyin qaytdi, nechtasi qo'ng'iroqdan keyin qaytdi.
Rollar
| Rol | Huquqlar |
| Super admin | Hammasi, jumladan foydalanuvchilar, sozlamalar va karta rekvizitlari (faqat shu rol) |
| Kontent menejer | Progrev, video, izohlar, sotuv bloki; lid telefonlarini ko'rmaydi |
| Sotuv menejeri | Lidlar, lid tarixi, qo'ng'iroq ro'yxatlari, savollar, cheklarni tasdiqlash; kontent va rekvizitlarni o'zgartira olmaydi |

Kirish: login va parol, ixtiyoriy ikki bosqichli tasdiq (kod Telegram orqali).
## 10. Statistika va analitika
Statistika har bir bosqichdagi yo'qotishni va bitta sotuv narxini ko'rsatadi; avtowebinarni davom ettirish qarori shu raqamga qarab qilinadi.
| Ko'rsatkich | Hisoblash |
| Start | /start bosgan lidlar soni |
| Ro'yxat (telefon) | Telefon berganlar ÷ start |
| Sessiya tanlash | Sessiya tanlaganlar ÷ telefon berganlar |
| 1-kunni ko'rish | 1-kunni ko'rganlar (≥ 75%) ÷ sessiya tanlaganlar |
| 2-kunni ko'rish | 2-kunni ko'rganlar (oferta momentigacha) ÷ 1-kunni ko'rganlar |
| Oferta momentigacha qolish | 2-kun oferta timecode'gacha ko'rganlar ÷ 2-kunga kirganlar |
| Tugma bosish | "Kursga yozilish" bosganlar ÷ oferta momentigacha qolganlar |
| Chek yuborish | Chek yuborganlar ÷ tugma bosganlar |
| Boshlang'ich to'lov | Tasdiqlangan boshlang'ich to'lovlar ÷ 1-kunni ko'rganlar |
| To'liq to'lov | Tasdiqlangan to'liq to'lovlar ÷ 1-kunni ko'rganlar |
| Qayta tanlash samarasi | Qayta vaqt tanlab ko'rganlar ÷ qayta taklif olganlar |
| Tasdiq vaqti | Chek kelganidan tasdiqgacha o'rtacha vaqt |
| Bitta lid narxi | Reklama xarajati ÷ telefon berganlar |
| Bitta sotuv narxi | Reklama xarajati ÷ to'liq to'lovlar soni |
| ROMI | (Tushum − reklama xarajati) ÷ reklama xarajati |

- Filtrlar: davr, voronka, manba (deep link), slot (14:00 / 20:00), hafta kuni, to'lov usuli, menejer.
- Reklama xarajati manba bo'yicha qo'lda kiritiladi, so'mda.
- Tomosha grafigi (har kun uchun alohida): videoning har daqiqasida qolgan tomoshabinlar ulushi — odamlar qayerda chiqib ketishini ko'rsatadi.
- Har bir progrev xabari bo'yicha: nechta yuborildi, tugmasi necha marta bosildi, shu xabardan keyin nechta lid botni blokladi.
- Jonli webinar natijalarini qo'lda kiritish maydoni — ikki formatni yonma-yon solishtirish uchun.
- Barcha jadvallar Excel'ga eksport qilinadi.
## 11. Halollik qoidalari
Tizim yozuvni jonli deb ko'rsatmaydi: bu auditoriya uchun ishonch asosiy sotuv omili, aldov fosh bo'lsa voronka butunlay zarar ko'radi.
- Tizim matnlarida "jonli", "live", "hozir efirda" ishlatilmaydi — "efir", "webinar" deyiladi.
- Soxta "onlayn tomoshabinlar" hisoblagichi bo'lmaydi. Hisoblagich kerak bo'lsa, faqat shu sessiyadagi haqiqiy tomoshabinlar soni ko'rsatiladi.
- Izohlar faqat asl efirdan olinadi va "Asl efir ishtirokchilarining izohlari" deb belgilanadi.
- Deadline haqiqiy: muddat tugagach maxsus narx yopiladi. "Oxirgi 3 joy" kabi asossiz da'volar ishlatilmaydi.
- "Xabarlarni to'xtatish" tugmasi doim mavjud.
## 12. Texnik talablar
Quyidagi stack tavsiya; dasturchi asoslab o'zgartirishi mumkin.
| Qism | Tavsiya |
| Bot | Python + aiogram 3 (yoki Node.js + grammY) |
| Backend API | FastAPI (yoki NestJS) |
| Ma'lumotlar bazasi | PostgreSQL |
| Rejali vazifalar | Redis + navbat (ARQ, Celery yoki BullMQ) |
| Mini App va admin panel | React + TypeScript |
| Video | Bunny Stream: HLS, CDN, tokenli havolalar (tanlov asosi quyida) |
| Joylashtirish | O'zbekistondagi data-markazda VPS, Docker, kunlik backup |

Telegram cheklovlari
- Bot umumiy hisobda soniyasiga taxminan 30 ta, bitta chatga soniyasiga 1 ta xabar yuboradi. Yuborish navbat orqali; 429 xatosida retry_after bo'yicha kutiladi.
- Katta sessiyada (masalan, 20:00 da 2000 lid) "Efir boshlandi" xabari sessiyadan 1 daqiqa oldin yuborila boshlaydi va 2 daqiqa ichida hammaga yetadi.
Yuklama
- MVP: bir sessiyada 2000 tagacha tomoshabin.
- Video CDN orqali beriladi; backend faqat server vaqti, heartbeat va sotuv bloki holatini beradi.
- Heartbeat yozuvlari agregatsiya qilinadi, xom yozuvlar 30 kun saqlanadi.
Vaqt
Barcha vaqtlar Asia/Tashkent (UTC+5) da ko'rsatiladi, bazada UTC saqlanadi.
Xavfsizlik va ma'lumotlar
- Mini App initData imzosi har so'rovda tekshiriladi.
- Admin panel faqat HTTPS; parollar hash bilan saqlanadi; rollar backendda tekshiriladi.
- Bot tokeni va to'lov kalitlari faqat server muhit o'zgaruvchilarida.
- Kunlik backup, 14 kun saqlanadi. Chek fayllari alohida xotirada saqlanadi; ularni faqat sotuv menejeri va super admin ko'radi.
- Xatolar va yuborilmagan xabarlar admin panelda ko'rinadi.
- Shaxsga doir ma'lumotlar (ism, telefon, cheklar) O'zbekistondagi serverda saqlanadi — quyidagi "Server va domen" qismi.
Video hosting: Bunny Stream
Tanlov — Bunny Stream, zaxira varianti — Kinescope. Asosiy sabab: Mini App pleyerida pauza va o'tkazishni o'chirib, videoni server vaqtiga moslash kerak; buni to'g'ridan-to'g'ri HLS havola bilan o'z pleyerimizda qilish eng oson.
|  | Bunny Stream | Kinescope |
| Narx | Saqlash $0.01/GB oyiga; yetkazish Osiyo uchun taxminan $0.03/GB; standart kodlash bepul | Trafik €0.03/GB, saqlash €0.03/GB, ishlov €0.01/daqiqa |
| O'z pleyerimiz bilan | To'g'ridan-to'g'ri HLS havola — pleyerni to'liq boshqaramiz | Asosan o'z pleyeri va API orqali |
| Himoya | Tokenli havolalar, domen cheklovi; DRM qo'shimcha to'lov ($99/oydan) | DRM pullik tariflarga kiritilgan |
| To'lov | Xalqaro Visa/Mastercard, ishlatilgancha | Yevroda, ishlatilgancha |

Taxminiy xarajat: 90 daqiqalik efir 720p da bir tomoshabinga 0,6–1,3 GB. Oyiga 3000 ta ko'rish (bir kishining bir kungi efiri = 1 ko'rish) ≈ 2–4 TB ≈ Bunny'da $55–120.
Ishga tushirishdan oldin 10 daqiqalik video bilan O'zbekistondagi to'rt mobil operatorda yuklanish tezligi sinab ko'riladi; natija yomon bo'lsa, Kinescope'ga o'tiladi.
Manbalar: Bunny Stream narxlari, Bunny CDN hududiy narxlari, 2026, Kinescope narxlari
Server va domen
- Server O'zbekistondagi data-markazda bo'ladi. "Shaxsga doir ma'lumotlar to'g'risida"gi qonunning 27-1-moddasi (2021-yil 16-apreldan kuchda) fuqarolarning shaxsga doir ma'lumotlarini mamlakat hududidagi serverlarda saqlashni talab qiladi (Kun.uz, Kun.uz, 2021).
- Videolar Bunny'da turadi — ularda shaxsga doir ma'lumot yo'q.
- MVP uchun server: 4 vCPU, 8 GB RAM, 100 GB NVMe SSD, Ubuntu 24.04 LTS, statik IP, kamida 100 Mbit/s kanal. Video serverdan o'tmagani uchun shu yetarli.
- Zaxira nusxalar alohida joyda saqlanadi (ikkinchi disk yoki boshqa server).
- Hozircha o'z domeni yo'q. Bot long polling rejimida ishlaydi — unga domen kerak emas. Mini App esa faqat HTTPS havola orqali ochiladi, shuning uchun Mini App va admin panel bepul HTTPS subdomenda ishlaydi (masalan, DuckDNS) va Let's Encrypt sertifikati o'rnatiladi.
- Keyin o'z domeniga o'tish faqat sozlama bilan qilinadi: Mini App va admin panel manzili konfiguratsiyada almashtiriladi, kod o'zgarmaydi. Eski xabarlardagi tugmalar eski manzilga bog'langan bo'ladi, shuning uchun eski subdomen kamida 30 kun yangi domenga yo'naltirib turiladi.
- O'z domeni olinganda tuzilma: app. (Mini App), admin. (admin panel), api. (backend).
## 13. Bosqichlar
MVP sotuv qila oladigan to'liq voronkani beradi; keyingi bosqichlar faqat MVP raqamlari jonli webinar bilan solishtirilgandan keyin boshlanadi.
| Bosqich | Tarkibi | Keyingi bosqichga o'tish sharti |
| 1. MVP | 2 kunlik format. Bot: ro'yxat, majburiy telefon, lid magnit, sessiya tanlash, progrev zanjiri, eslatmalar, kelmaganlarga qayta vaqt tanlash. Mini App: sinxron pleyer, barcha holatlar, sotuv bloki, shaxsiy deadline. To'lov: karta va chek, Payme/Click havolalari, boshlang'ich to'lov, cheklar navbati va qo'lda tasdiq. Admin: voronka, video, slotlar, progrev muharriri (test yuborish va sinash bilan), lidlar, sotuv bo'limi uchun lid tarixi va qo'ng'iroq ro'yxatlari, to'xtab qolgan lidlarga avtomatik eslatmalar, to'lovlar, asosiy statistika va bitta sotuv narxi | 2–4 hafta real trafik bilan ishlagan; xabarlarning kamida 99% o'z vaqtida ketgan |
| 2. Sotuvni kuchaytirish | Payme / Click Merchant API orqali avtomatik tasdiq, yopiq kanalga avtomatik havola, asl efir izohlari, savollar bo'limi, ommaviy xabar, tomosha grafigi, xabarlar statistikasi | Bitta sotuv narxi jonli webinardan yomon emas |
| 3. Masshtab | Bir nechta voronka (turli kurslar), A/B test (xabar, oferta, narx), ikki bosqichli tasdiq | — |

## 14. Qabul qilish mezonlari
MVP quyidagi tekshiruvlarning barchasidan o'tganda qabul qilinadi.
- [ ] Lid deep link orqali kiradi; voronka va manba lid kartasida saqlanadi.
- [ ] Telefon raqamisiz sessiya tanlab bo'lmaydi; qo'lda yozilgan raqam +998 formatida tekshiriladi.
- [ ] Seshanba 12:00 da ro'yxatdan o'tgan lidga 1-kun uchun "Bugun 20:00" va "Ertaga 14:00" taklif qilinadi (N = 3, K = 2).
- [ ] Seshanba 20:00 ni tanlagan lidning 2-kuni chorshanba 20:00 da ochiladi; 1-kun ko'chirilsa, 2-kun ham 24 soat farq bilan birga ko'chadi.
- [ ] Admin paneldan qo'shilgan yangi xabar keyingi lidlarga dasturchi aralashuvisiz ketadi.
- [ ] 1-kungacha 3 soat qolgan lidga majburiy bo'lmagan uzoq xabarlar ketmaydi, majburiylari ketadi.
- [ ] 1-kun videosining kamida 75% ini ko'rgan lid 2-kunga taklif va kunlar orasidagi progrevni oladi; kamroq ko'rganiga qayta vaqt taklifi boradi.
- [ ] Lid vaqtni o'zgartirsa, eslatmalar yangi vaqtga ko'chadi va yuborilgan xabarlar takrorlanmaydi.
- [ ] Efir boshlanganidan 10 daqiqa kech kirgan lid videoni 10-daqiqadan ko'radi; pauza va o'tkazish ishlamaydi.
- [ ] Mini App yopilib qayta ochilganda pozitsiya server vaqtiga mos keladi.
- [ ] Sotuv tugmasi 2-kun oferta timecode'ida ±5 soniya aniqlik bilan chiqadi.
- [ ] 1-kunni ko'rmagan lidga 1-kundan, 2-kunni ko'rmagan lidga faqat 2-kundan qayta tanlash taklif qilinadi; 3 martadan keyin taklif bormaydi.
- [ ] Lid yuborgan chek 1 daqiqa ichida adminlar Telegram guruhiga tugmalar bilan tushadi; tugma bosilishi bilan lidga natija boradi; to'liq to'lov tasdiqlangach lid kanalga bir martalik havola oladi, rad etilsa sababini oladi.
- [ ] Boshlang'ich to'lovi tasdiqlangan lid kanalga avtomatik qo'shilmaydi va bot undan sotuv xabarlarini to'xtatadi; lid qo'ng'iroq ro'yxatida paydo bo'ladi va biriktirilgan menejerga Telegram xabari boradi.
- [ ] Sotuv menejeri lid kartasida har bir kunda ko'rgan daqiqasini va barcha voqealarni vaqt bo'yicha ko'radi.
- [ ] Deadline ichida yuborilgan chek keyin tasdiqlansa ham maxsus narx saqlanadi; deadline tugagach maxsus narx ko'rinmaydi.
- [ ] Karta rekvizitlarini faqat super admin o'zgartira oladi, o'zgarish logda ko'rinadi. Guruhdagi tasdiq tugmasini admin ro'yxatida yo'q odam bosa olmaydi.
- [ ] Botni bloklagan lidga yuborish to'xtaydi.
- [ ] 2000 lidli sessiyada "Efir boshlandi" xabari 2 daqiqa ichida hammaga yetadi, 429 xatolari to'g'ri ishlanadi.
- [ ] Statistikadagi raqamlar lidlar ro'yxatidan qo'lda sanalganiga mos keladi.
- [ ] Kontent menejer lid telefon raqamlarini va cheklarni ko'rmaydi.
- [ ] Telefon berib, 2 soat ichida sessiya tanlamagan lidga eslatma boradi va u "Sessiya tanlamagan" ro'yxatida paydo bo'ladi; sessiya tanlashi bilan ro'yxatdan chiqadi.
- [ ] Menejer "Ofertagacha chiqib ketgan" ro'yxatidagi tanlangan lidlarga bot orqali bitta xabar yubora oladi va ro'yxatni telefonlar bilan Excel'ga eksport qiladi.
## 15. Ochiq savollar
Dasturchiga berishdan oldin quyidagilar hal qilinishi kerak.
- [x] Webinar formati: 2 kunlik — 1-kun va 2-kun alohida videolar.
- [x] To'lov: karta orqali o'tkazma va chek, alohida Payme va Click havolalari; boshlang'ich to'lov bor — to'lagan lid kanalga darhol qo'shilmaydi, jarayonni sotuvchi davom ettiradi.
- [x] Boshlang'ich to'lov: 100 000 so'm.
- [x] Ko'rmaganlarga takror: har bir kun uchun 3 martagacha qayta vaqt.
- [x] Telefon raqami majburiy — sotuv bo'limi uchun.
- [x] 2-kun har doim 1-kundan aniq 24 soat keyin.
- [x] Cheklarni admin kelishi bilan Telegram guruhida tasdiqlaydi.
- [x] Video hosting: Bunny Stream, zaxira — Kinescope (12-bo'lim).
- [x] Server alohida, O'zbekistondagi data-markazda; hozircha o'z domenisiz, bepul HTTPS subdomen bilan (12-bo'lim).
- [x] "Ko'rdi" chegarasi: 1-kun — videoning 75% i (shundan keyin 2-kunga taklif); 2-kun — oferta momentiga yetish.
- [x] Kunlar orasidagi progrev uchun 1-kun xulosasi va uy vazifasi tayyorlanadimi?
- [x] Bir nechta kurs uchun voronka MVPda kerakmi yoki 3-bosqichda?
- [ ] O'z domeni qachon va qanday nom bilan olinadi?