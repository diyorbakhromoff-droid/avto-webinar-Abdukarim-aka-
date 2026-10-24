# Mini App — efir sahifasi

Telegram bot ichida ochiladigan efir sahifasi (React 18 + TypeScript + Vite, HLS uchun hls.js).
Backend shartnomasi: `docs/api-contract.ts` (MINI APP bo'limi), texnik topshiriq: `docs/tz.md` (7, 8, 11-bo'limlar).

## Buyruqlar

```bash
npm install
npm run dev        # http://localhost:5173, /api -> http://localhost:8000 (Vite proxy)
npm run dev:mock   # backendsiz: mahalliy fixture'lar + pastki chapdagi "M" holat almashtirgich
npm run build      # tsc --noEmit + vite build -> dist/
npm run build:mock # mock rejimdagi statik build -> dist-mock/ (brauzerda ko'rib chiqish uchun)
npm run preview    # dist/ ni mahalliy serverda ko'rish
```

`dist/` — statik fayllar; Caddy ilova domenining ildizida beradi (`base: './'`).
API boshqa domenda bo'lsa, build vaqtida `VITE_API_BASE=https://api.example.uz` bering (standart — shu domen, `/api`).

## Qanday ishlaydi

- **Auth:** har bir so'rovda `Authorization: tma <Telegram.WebApp.initData>`. 401/403 — "Sahifani bot ichidan oching" ekrani.
- **Holat:** `GET /api/app/state` → `no_session | waiting | live | between | missed | closed | ended`.
  Holat taymer nolga yetganda, video tugaganda, sahifa fondan qaytganda va har 60 soniyada qayta so'raladi.
- **Soat:** `server_time` bo'yicha farq hisoblanadi (tarmoq kechikishining yarmi hisobga olinadi);
  barcha taymerlar va pleyer pozitsiyasi server vaqtida. Ekranda vaqt — Asia/Tashkent (UTC+5).
- **Pleyer:** pozitsiya = (server vaqti − `live.start_at`). Pauza, o'tkazish, tezlik yo'q — faqat ovoz va to'liq ekran.
  Farq 5 soniyadan oshsa (internet uzilishi, fon rejimi) server pozitsiyasiga qaytadi. iOS/Safari — native HLS,
  qolganlari — hls.js (adaptiv sifat). Birinchi ochilishda "Ko'rishni boshlash" tugmasi (iOS ovozli autoplay'ga ruxsat bermaydi).
  Imzolangan havola yangilansa, tarmoq xatosida yangi havola bilan qayta ulanadi.
- **Heartbeat:** ijro boshlanganda va har 30 soniyada `POST /api/app/heartbeat`.
- **Lenta (pleyer ostida, 2 ta tab):** "Efir izohlari" — "Asl efir ishtirokchilarining izohlari", `t <= pozitsiya`
  bo'lganlari, yangisi pastda; "Mening chatim (N)" — `live.my_messages` (lidning shu efirdagi o'z xabarlari va jamoa
  javoblari, faqat o'ziga ko'rinadi).
- **Efir chati:** `POST /api/app/question` (backend videoning soniyasini o'zi saqlaydi). Yuborilgan xabar darhol
  "Mening chatim" ga qo'shiladi (joriy video soniyasi bilan), tab almashadi, toast chiqadi va holat qayta so'raladi;
  server ro'yxati kelganda mahalliy nusxa almashtiriladi (javobda id yo'q — yuborilgandan keyingi id + bir xil matn
  bo'yicha). Xatoda xabar olib tashlanadi, matn maydonga qaytadi.
- **Sotuv bloki:** `offer.visible_from_sec` dan keyin (`soft` — 1-kundagi ixcham banner). "Kursga yozilish" →
  `POST /api/app/offer-click` → `Telegram.WebApp.close()` (to'lovni bot davom ettiradi). `offer.closed` — tugma yo'q.
- **Qayta vaqt tanlash:** `POST /api/app/reschedule` → Mini App yopiladi, bot vaqt tugmalarini yuboradi.
- **Halollik (TZ §11):** interfeysda "jonli", "live", "hozir efirda" so'zlari va soxta tomoshabin hisoblagichi yo'q.

## Tuzilma

```
src/
  main.tsx, App.tsx            holat mashinasi, mavzu (funnel.theme -> CSS o'zgaruvchilari)
  api/types.ts                 shartnomadan ko'chirilgan turlar
  api/client.ts                fetch + tma auth + soat sinxroni
  api/mock.ts                  mock fixture'lar (faqat VITE_MOCK=1)
  lib/time.ts                  server soati, Toshkent vaqti, o'zbekcha sana
  lib/money.ts                 "1 990 000 so'm"
  lib/telegram.ts              Telegram WebApp SDK qatlami
  lib/hooks.ts                 useServerNow, bot amallari
  lib/chat.ts                  efir chati: server ro'yxati + optimistik xabarlar
  components/                  Player, Countdown, OfferBlock, LiveFeed (tablar), Comments, QuestionBox (chat maydoni),
                               SpeakerCard, Decor (mikrofon, tovush to'lqinlari — inline SVG), ...
  screens/                     Waiting, Live, Between, Missed (missed/closed), Ended, NoSession, ErrorScreen
  styles.css                   palitra (tinch ko'k, CSS o'zgaruvchilari) va barcha uslublar
```

## Mock rejim

`npm run dev:mock` — Telegram'siz oddiy brauzerda ochiladi. Pastki chapdagi "M" tugmasi barcha holatlarni
(va ba'zi variantlarni: yumshoq taklif, efir chatida xabarlar, deadline tugashi, limit tugagan, 401 xato) almashtiradi.
Efir chatiga `xato` deb yozilsa, mock yuborish xatosini qaytaradi (xato holatini tekshirish uchun).
"live" holatida ommaviy namunaviy HLS oqimi ishlatiladi. Vaqt o'tishi bilan holatlar o'zgaradi
(masalan, "waiting — 10 soniya" efirga o'tadi). Mock kodi production build'ga kirmaydi.
