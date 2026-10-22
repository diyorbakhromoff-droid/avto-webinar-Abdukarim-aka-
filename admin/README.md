# Avtowebinar — admin panel

Jamoa uchun veb-ilova: voronkalar, webinar videosi, slotlar, progrev zanjiri, sotuv bloki,
izohlar, lidlar va qo'ng'iroq ro'yxatlari, to'lovlar (cheklar navbati), savollar, ommaviy xabar,
statistika va sozlamalar. Interfeys tili — o'zbek (lotin). Barcha vaqtlar Asia/Tashkent (UTC+5)
da ko'rsatiladi, backendga UTC ISO satr yuboriladi.

Stack: React 18.3.1, TypeScript 5.6, Vite 5.4, react-router-dom 6.28. UI kit yo'q — oddiy CSS
o'zgaruvchilari (`src/styles.css`), grafiklar qo'lda chizilgan SVG.

## Ishga tushirish

```bash
npm install
npm run dev        # http://localhost:5174, /api -> http://localhost:8000 (Vite proxy)
npm run dev:mock   # backendsiz demo: src/api/mock.ts dagi fixture'lar
npm run build      # tsc --noEmit + vite build -> dist/
npm run preview    # dist/ ni lokal ko'rish
```

### Demo rejim (`npm run dev:mock`)

`.env.mock` faylida `VITE_MOCK=1`. Barcha so'rovlar `src/api/mock.ts` ga yo'naltiriladi,
yozish amallari xotirada saqlanadi (sahifa yangilansa — boshlang'ich holat). Login: istalgan
login/parol; `kamola` — kontent menejer, `nodira` — sotuv menejeri, boshqasi — super admin.
Demo Excel eksporti CSV mazmunli fayl qaytaradi. Production build'ga mock kodi kirmaydi.

## Joylashtirish (Caddy)

Panel admin domenining ildizida beriladi, SPA fallback kerak:

```caddy
admin.example.uz {
    encode gzip
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle {
        root * /srv/admin/dist
        try_files {path} /index.html
        file_server
    }
}
```

## Tuzilma

```
src/
  main.tsx, App.tsx          marshrutlar, AuthGuard, rol bo'yicha ruxsat
  api/types.ts               docs/api-contract.ts dagi ADMIN turlari
  api/client.ts              fetch + Bearer token, 401 -> login, blob yuklab olish
  api/admin.ts               har bir endpoint uchun turlangan funksiya
  api/mock.ts                demo rejim fixture'lari va xotiradagi router
  lib/                       vaqt (Toshkent), formatlar, auth/funnel/toast/confirm kontekstlari,
                             halollik tekshiruvi, Telegram HTML preview, slot hisobi (TZ §5)
  components/                Layout (sidebar), Modal, TextEditor, ButtonsEditor, MediaPicker,
                             TelegramPreview, RetentionChart, maydonlar
  pages/                     har bir bo'lim uchun sahifa
```

## Rollar

| Rol | Bo'limlar |
| --- | --- |
| Super admin | hammasi, jumladan Sozlamalar va karta rekvizitlari |
| Kontent menejer | Dashboard, Voronkalar, Webinar videosi, Slotlar, Progrev zanjiri, Sotuv bloki (rekvizitsiz), Izohlar, Ommaviy xabar, Statistika |
| Sotuv menejeri | Dashboard, Lidlar, Savollar, To'lovlar, Statistika |

Frontend faqat menyuni yashiradi; huquqlar backendda tekshiriladi.

## Mahalliy saqlash

`localStorage`: `aw_admin_token` (token), `aw_admin_funnel` (tanlangan voronka),
`aw_admin_dash_period` (Dashboard davri).
