# Avtowebinar

Yozib olingan 2 kunlik webinarni har kuni ishlaydigan voronkaga aylantiradigan tizim:
ro'yxat → progrev → efir → oferta → to'lov. Texnik topshiriq: [`docs/tz.md`](docs/tz.md),
dizayn: [`docs/design/`](docs/design) (Mini App, bot, admin panel ekranlari).

## Tuzilma

```
Telegram ──► bot (aiogram 3, long polling) ─┐
                                            ├─► PostgreSQL (lidlar, sessiyalar, navbat)
Mini App (React) ─► Caddy ─► api (FastAPI) ─┤
Admin panel (React) ─┘                      └─► Redis (bot holatlari)
                     worker ─► xabarlar navbati (Telegram tezlik chegarasi bilan), kun natijalari,
                               ommaviy xabarlar, menejer eslatmalari, heartbeat agregatsiyasi
Video: Bunny Stream (HLS, tokenli havolalar) — server orqali o'tmaydi
```

| Papka | Nima |
| --- | --- |
| `backend/app/domain` | Sof mantiq: slotlar (TZ 5), progrev rejasi va siqish qoidasi (TZ 6), Mini App holati (TZ 7), segmentlar, halollik |
| `backend/app/services` | Sessiya tanlash/ko'chirish, cheklar va tasdiq, xabar yuborish, statistika |
| `backend/app/bot` | Bot: ro'yxat, telefon, sessiya, menyu, to'lov, adminlar guruhidagi tasdiq tugmalari |
| `backend/app/api` | Mini App API (`/api/app/*`, initData imzosi) va admin API (`/api/admin/*`, JWT + rollar) |
| `backend/app/worker` | Navbat (Postgres `FOR UPDATE SKIP LOCKED`), 429/403 ishlovi, davriy vazifalar |
| `miniapp/` | Efir sahifasi: sinxron pleyer (pauza/o'tkazishsiz), izohlar, sotuv bloki, deadline |
| `admin/` | Admin panel: progrev sxemasi va "Kunlar bo'yicha" zanjir, lidlar va qo'ng'iroq ro'yxatlari, cheklar, statistika |
| `docs/api-contract.ts` | Frontend va backend o'rtasidagi API shartnomasi |

Stack tanlovi bo'yicha bitta farq TZ dan: rejali vazifalar navbati alohida ARQ/Celery emas, PostgreSQL
jadvalida (`scheduled_messages`). Sabab: xabarlar sessiya vaqti o'zgarganda qayta rejalashtiriladi va
"bitta xabar bir marta" qoidasi unikal kalit bilan bazada kafolatlanadi; Redis faqat bot holatlari uchun.

## Progrev sxemasi

Admin panel → Progrev zanjiri → **Sxema**. Har bir bo'lim alohida varaq: bloklar va ularni ulovchi chiziqlar.

| Blok | Nima qiladi | Chiqishlari |
| --- | --- | --- |
| Boshlanish | Hodisada lid bo'limga kiradi: /start, telefon, efir vaqtini tanladi, efirga kirdi, efirdan chiqdi, efir kuni tugadi, oferta, chek, to'lov, adminga yozdi | keyin |
| Xabar | Matn/media/tugmalar. «Sxemada keyingi blok» tugmasining o'z chizig'i bor | har bir tugma, «bosmasa» (X vaqtdan keyin) |
| Kutish | Ma'lum vaqt, webinar vaqtiga bog'lab (masalan, 2-kundan 15 daqiqa oldin), aniq soatgacha yoki biror ish qilguncha | keyin / bo'ldi, vaqt tugadi |
| Shart | Videoni qancha ko'rdi (daqiqa oraliqlari), efirga kirdimi, ofertagacha ko'rdimi, adminga yozdimi, chek, to'lov, teg, manba | har bir shoxcha / ha, yo'q |
| Amal | Yangi efir vaqtini taklif qilish, savol so'rash, teg, sovuq lid, menejerga vazifa | keyin |
| O'tish | Istalgan bo'limning istalgan blokiga, zanjirning N-xabaridan | — |
| Zanjir | O'z vaqtiga bog'langan xabarlar ketma-ketligi; istalgan xabaridan kirish mumkin | zanjir tugagach |
| To'xtatish, Izoh | Yo'lni tugatadi (teg bilan) / sxemaga izoh | — |

Qanday ishlaydi (`backend/app/services/flow_engine.py`):

- Bot va API faqat `lead_events` ga voqea yozadi; worker har 3 soniyada yangi voqealarni o'qib, mos bo'limlarni boshlaydi
  va "biror ish qilguncha" kutayotgan lidlarni davom ettiradi. Har 10 soniyada vaqti kelgan kutishlar keyingi blokka o'tadi.
- Bir lid bir bo'limda bir vaqtda faqat bitta joyda bo'ladi: bo'lim qayta boshlansa yoki boshqa bo'limdan o'tib kelinsa,
  eski yo'li to'xtaydi va hali yuborilmagan xabarlari bekor qilinadi.
- Xabarlar avvalgidek `scheduled_messages` navbati orqali ketadi (tezlik chegarasi, 429/403, tungi tinchlik).
  To'lagan, bloklagan, xabarlarni to'xtatgan va sovuq lidlarga sxema xabari bormaydi (xabarda "to'laganlarga ham" belgisi bo'lsa — to'laganlarga boradi).
- Zanjir xabarlari oddiy zanjir qoidalari bilan rejalashtiriladi; efir vaqti o'zgarsa qayta hisoblanadi. Kalitlar oddiy zanjirnikiday,
  shuning uchun «Kunlar bo'yicha» ustunini sxemaga ko'chirganda xabarlar takrorlanmaydi va yo'qolmaydi.
- Kutishsiz halqa (masalan, xabar → o'tish → o'sha xabar) 60 qadamdan keyin to'xtatiladi.
- «Kunlar bo'yicha» zanjiri o'zgarmagan holda ishlashda davom etadi — sxema unga qo'shimcha.

## Sotuv doskasi (Lidlar → Doska)

Sotuvchilar uchun amoCRM'dagi kabi doska: ustunlar — sotuv bosqichlari, karta — lid. Kartani sichqoncha bilan
boshqa ustunga suriladi; telefonda kartani bosib, ichidagi «Sotuv bosqichi» orqali o'zgartiriladi. «Ro'yxat»
ko'rinishi (jadval, Excel) avvalgidek qoldi, filtrlar ikkalasida bir xil.

| Ustun | Lid qanday tushadi |
| --- | --- |
| Yangi | Botga kirgan har bir lid. Avtovoronkada yaqinda harakat qilganlar tepada |
| Bog'lanildi | «Javob bermadi» natijasi yoki qo'lda surilganda |
| Qayta qo'ng'iroq | Qo'ng'iroq vaqti bilan (vaqti kelganda menejerga Telegram eslatma). Eng yaqin vaqt tepada, o'tib ketgani qizil |
| To'lov kutilmoqda | Lid chek yuborsa — avtomatik |
| Sotildi | To'lov tasdiqlansa yoki «Sotildi» natijasi — avtomatik. Ustun tepasida tushgan pul |
| Rad etdi | «Rad etdi» natijasi (sababi bilan) |

- Bosqich (`leads.stage`) avtovoronka qadamidan (`leads.step`) alohida: kartadagi rangli belgi — lid botda qayerda.
- Kartani bosganda o'ngdan lid paneli ochiladi: qo'ng'iroq tugmasi, bosqich va menejer, **Avtovoronka yo'li**
  (botga kirdi → telefon → efir vaqti → 1-kun → 2-kun → oferta → tugma → chek → to'lov; har birida vaqt,
  ✓ qildi / ✕ o'tkazib yubordi) va aloqa natijalari tarixi. To'liq karta voqealar lentasi bilan avvalgidek.
- Bosqich o'zgarishi lid voqealar lentasiga yoziladi («Sotuv bosqichi: Yangi → Bog'lanildi (Nodira)»).
- Doska har daqiqada o'zi yangilanadi.

## Lokal ishga tushirish

Talablar: Python 3.12+, Node 22, PostgreSQL 16, Redis 7.

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp ../.env.example .env        # BOT_TOKEN, DATABASE_URL, INITIAL_ADMIN_PASSWORD ni to'ldiring
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed   # super admin + standart voronka va 20 ta progrev xabari
.venv/bin/python -m app.devtools demo   # ixtiyoriy: demo lidlar, tariflar, sinov videosi
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m app.bot.main       # alohida terminalda
.venv/bin/python -m app.worker.main    # alohida terminalda

# frontendlar (Vite /api ni localhost:8000 ga yo'naltiradi)
cd miniapp && npm install && npm run dev        # yoki: npm run dev:mock — backendsiz
cd admin && npm install && npm run dev          # yoki: npm run dev:mock
```

API hujjati: http://localhost:8000/api/docs

Mini App'ni brauzerda sinash: `python -m app.devtools initdata 4242` imzolangan initData chiqaradi
(demo lid 4242 uchun efir hozir ochiq).

## Testlar

```bash
cd backend && .venv/bin/python -m pytest      # PostgreSQL'da avtowebinar_test bazasi kerak
```

TZ 14-bo'lim qabul qilish mezonlari testlarda:

| Mezon | Test |
| --- | --- |
| Seshanba 12:00 → "Bugun 20:00", "Ertaga 14:00" (N=3, K=2) | `test_domain.py::test_day1_options_table` |
| 2-kun aniq 24 soatdan keyin; 1-kun ko'chsa 2-kun ham ko'chadi | `test_day2_is_exactly_24h_later`, `test_flows.py::test_change_time_moves_reminders_without_duplicates` |
| 3 soat qolganda majburiy bo'lmagan uzoq xabarlar ketmaydi, majburiylari ketadi | `test_compression_three_hours_before` |
| Vaqt o'zgarsa eslatmalar ko'chadi, yuborilganlar takrorlanmaydi | `test_sent_message_not_resent_after_change` |
| 75% ko'rgan 2-kunga o'tadi, kam ko'rganiga qayta vaqt; 3 martadan keyin taklif yo'q | `test_between_requires_75_percent`, `test_day1_evaluation_and_reschedule_limit` |
| 1-kunni ko'rmaganga 1-kundan, 2-kunni ko'rmaganga faqat 2-kundan | `test_watched_day1_gets_between_and_day2_reschedule` |
| 10 daqiqa kech kirgan lid 10-daqiqadan ko'radi; qayta ochganda joriy daqiqa | `test_late_entry_10_minutes_starts_from_minute_10`, `test_entry_closed_after_l_minutes`, `test_miniapp_state_and_heartbeat` |
| Chek tasdig'i, ikki marta tasdiqlab bo'lmaydi, boshlang'ich to'lovda kanal havolasi yo'q, to'liqda bor | `test_receipt_approve_flow` |
| Rad etilsa lid sababini oladi | `test_reject_sends_reason` |
| Kontent menejer telefon va cheklarni ko'rmaydi; rekvizitlar faqat super admin, logda | `test_roles_content_cannot_see_leads`, `test_requisites_change_is_logged` |
| Botni bloklaganga yuborish to'xtaydi; 429 to'g'ri ishlanadi | `test_sender.py::test_blocked_lead_on_403`, `test_retry_after_postpones` |
| To'lagan lidga sotuv/deadline xabarlari bormaydi | `test_paid_lead_skips_deadline_message`, `test_paid_lead_gets_no_sales_messages` |
| Statistika raqamlari qo'lda sanalganiga mos | `test_unpaid_count_matches_manual` |

Real Telegram va 2000 lidli yuklama sinovi (TZ 14) faqat serverda, haqiqiy bot bilan qilinadi.

## Serverga joylashtirish

1. **Server**: O'zbekistondagi data-markazda VPS (4 vCPU, 8 GB RAM, Ubuntu 24.04), Docker o'rnatilgan.
2. **Domen**: [duckdns.org](https://www.duckdns.org) da subdomen oching (masalan `avtowebinar`) va server IP sini
   kiriting. `app.avtowebinar.duckdns.org` va `admin.avtowebinar.duckdns.org` avtomatik ishlaydi.
3. **Bot**: @BotFather → `/newbot`, tokenni oling.
4. **Bunny Stream**: kutubxona yarating, 1-kun va 2-kun videolarini yuklang; Pull zone → Security →
   Token Authentication ni yoqing va kalitni `.env` ga yozing. Video GUID larini admin paneldagi
   "Webinar videosi" bo'limiga kiriting.
5. `.env.example` ni `.env` ga ko'chirib to'ldiring va ishga tushiring:
   ```bash
   docker compose up -d --build
   ```
   Caddy Let's Encrypt sertifikatini o'zi oladi. Admin panel: `https://admin.<domen>`.
6. **Adminlar guruhi**: Telegram guruh oching, botni qo'shing, guruhda `/chatid` yozing va chiqqan ID ni
   admin panel → Sozlamalar ga kiriting. Adminlar va sotuv menejerlarining Telegram ID larini ham
   Sozlamalar → Foydalanuvchilar da kiriting — faqat ular "Tasdiqlash" tugmasini bosa oladi.
7. **Yopiq kurs kanali**: botni kanalga admin qilib qo'shing ("taklif havolalari" huquqi bilan), kanal ID sini
   Sotuv bloki sozlamalariga kiriting.
8. **Zaxira nusxalar**: `backup` servisi har kuni bazani va cheklar fayllarini `BACKUP_PATH` ga yozadi,
   14 kun saqlaydi. `BACKUP_PATH` ni alohida diskka ulang.

O'z domeniga o'tish: `.env` da `APP_DOMAIN`, `ADMIN_DOMAIN`, `MINIAPP_URL`, `ADMIN_URL` ni almashtiring va
`docker compose up -d`. Eski xabarlardagi tugmalar uchun `deploy/Caddyfile` oxiridagi yo'naltirishni yoqing
(kamida 30 kun).

## Nima tekshirildi va nima tekshirilmadi

- Backend: 71 ta avtomatik test (PostgreSQL bilan), jumladan botning `/start` → telefon → vaqt → tarif →
  chek → guruhda tasdiq oqimi (Telegram so'rovlari soxta sessiyada).
- Mini App va admin panel haqiqiy API bilan brauzerda (Playwright) ochib ko'rildi: efir sinxron boshlanadi,
  heartbeat va savollar yoziladi, admin paneldagi barcha sahifalar xatosiz yuklanadi.
- **Tekshirilmagan:** haqiqiy Telegram bot bilan ishlash, Docker image larni yig'ish (bu muhitda Docker daemon
  yo'q), Bunny token formati (Bunny panelidagi namunaga solishtiring: `backend/app/services/video.py`),
  2000 lidli yuklama.

Ma'lum bo'shliqlar: admin panelda videoni oldindan ko'rish yo'q; to'lovlar va savollar ro'yxati sahifalanmagan
(oxirgi 500 tasi); lidlarni ommaviy biriktirish har bir lid uchun alohida so'rov bilan.

## Keyingi bosqichlar (TZ 13)

- 2-bosqich: Payme / Click Merchant API orqali avtomatik tasdiq (hozir — havola + chek + qo'lda tasdiq).
- 3-bosqich: A/B testlar, admin panel uchun ikki bosqichli tasdiq.
- Ishga tushirishdan oldin: 10 daqiqalik video bilan 4 ta mobil operatorda yuklanish tezligini sinash (TZ 12).
