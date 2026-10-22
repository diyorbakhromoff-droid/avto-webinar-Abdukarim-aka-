/**
 * Mock rejim (VITE_MOCK=1): backend o'rniga mahalliy fixture'lar.
 * Vaqtlar ssenariy tanlangan paytga nisbatan hisoblanadi va vaqt o'tishi bilan
 * holat o'zgaradi (kutish → efir → kunlar orasi → 2-kun → tugagan).
 */
import { ApiError, type MiniApi } from './client';
import type { AppStateResponse, FunnelBrand, LiveComment, Offer } from './types';

const SAMPLE_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const VIDEO_SEC = 600; // namunaviy video ~10 daqiqa

const funnel: FunnelBrand = {
  course_title: 'Arab tili kursi',
  webinar_title: 'Bepul webinar · 2 kun',
  topic: "Arab tilida o'qishni noldan boshlash",
  speaker_name: 'Nodira Rahimova',
  speaker_title: "Arab tili o'qituvchisi, 8 yillik tajriba",
  speaker_photo_url: null,
  logo_url: null,
  theme: { primary: '#D4AF5A', background: '#120F0B', bg_image_url: null },
  late_entry_minutes: 15,
};

const day1Comments: LiveComment[] = [
  { t: 8, author: 'Madina', text: 'Assalomu alaykum! Kutib turgandim' },
  { t: 20, author: 'Gulnora', text: "Vaalaykum assalom, Samarqanddan qo'shildim" },
  { t: 35, author: 'Sevara', text: 'Daftar va ruchka tayyor' },
  { t: 52, author: 'Dilnoza', text: 'Alifbodan boshlasak bo\'ladimi? Men umuman bilmayman' },
  { t: 70, author: 'Zarina', text: 'Men ham noldanman' },
  { t: 88, author: 'Madina', text: 'Harflar nechta ekan?' },
  { t: 104, author: 'Feruza', text: '28 ta deyishdi' },
  { t: 121, author: 'Sevara', text: "Harflar so'z boshida va oxirida boshqacha yozilarkan, endi tushundim" },
  { t: 140, author: 'Kamola', text: "O'ngdan chapga yozish qiziq ekan" },
  { t: 162, author: 'Dilnoza', text: 'Rahmat, juda tushunarli tushuntiryapsiz' },
  { t: 185, author: 'Nilufar', text: 'Uy vazifasi bo\'ladimi?' },
  { t: 203, author: 'Gulnora', text: 'Alif, ba, ta — yozib oldim' },
  { t: 228, author: 'Mohira', text: 'Bolalarim bilan birga ko\'ryapman' },
  { t: 250, author: 'Zarina', text: 'Talaffuzni yana bir marta aytib bera olasizmi?' },
  { t: 276, author: 'Feruza', text: 'Juda foydali, rahmat ustoz' },
  { t: 300, author: 'Kamola', text: 'Endi Qur\'onni o\'zim o\'qishni xohlayman' },
  { t: 332, author: 'Madina', text: 'Harakatlar mavzusi eng qiyini ekan' },
  { t: 361, author: 'Nilufar', text: 'Fatha, kasra, damma — tushundim' },
  { t: 395, author: 'Sevara', text: "Ertangi kunni ham albatta ko'raman" },
  { t: 430, author: 'Mohira', text: 'Mashq qilish uchun nima tavsiya qilasiz?' },
  { t: 468, author: 'Gulnora', text: "Har kuni 15 daqiqa — yaxshi maslahat" },
  { t: 505, author: 'Dilnoza', text: 'Rahmat! Ertaga ko\'rishguncha' },
  { t: 540, author: 'Feruza', text: 'Juda yoqdi' },
  { t: 575, author: 'Zarina', text: 'Ertaga soat nechada?' },
];

const day2Comments: LiveComment[] = [
  { t: 10, author: 'Madina', text: 'Yana keldim, uy vazifasini qildim' },
  { t: 40, author: 'Sevara', text: 'Kecha 5 ta harfni yozib chiqdim' },
  { t: 90, author: 'Kamola', text: "So'zlarni o'qishni boshladim" },
  { t: 150, author: 'Dilnoza', text: 'Kurs necha oy davom etadi?' },
  { t: 210, author: 'Nilufar', text: 'Darslar qaysi vaqtda bo\'ladi?' },
  { t: 270, author: 'Gulnora', text: "Uy vazifasi tekshirilishi juda muhim menga" },
  { t: 320, author: 'Feruza', text: "Bo'lib to'lash mumkinmi?" },
  { t: 360, author: 'Mohira', text: 'Men Standart tarifni tanladim' },
  { t: 420, author: 'Zarina', text: 'Bonuslar ham bor ekan, zo\'r' },
  { t: 480, author: 'Madina', text: 'Yozildim, rahmat!' },
  { t: 540, author: 'Sevara', text: 'Kursda ko\'rishguncha' },
];

function makeOffer(over: Partial<Offer> = {}): Offer {
  return {
    course_title: 'Arab tili: 3 oylik kurs',
    tariffs: [
      {
        id: 1,
        name: 'Standart',
        description: 'Darslar + uy vazifasi tekshiruvi',
        special_price: 1_490_000,
        regular_price: 1_990_000,
        price_now: 1_490_000,
        deposit_amount: 100_000,
      },
      {
        id: 2,
        name: 'VIP',
        description: "+ shaxsiy kurator va savol-javob sessiyalari",
        special_price: 2_490_000,
        regular_price: 3_290_000,
        price_now: 2_490_000,
        deposit_amount: 100_000,
      },
    ],
    bonuses: ["Arab alifbosi bo'yicha PDF qo'llanma", "Tajvid asoslari — 5 ta qo'shimcha video dars"],
    deadline_at: null,
    special_active: true,
    closed: false,
    visible_from_sec: null,
    soft: false,
    ...over,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;
const M = 60_000;

/** Toshkent vaqti bo'yicha bugun/ertaga HH:MM ga yaxlitlangan UTC ms. */
function nextSlot(now: number, minAhead: number): number {
  // 14:00 va 20:00 (Toshkent) = 09:00 va 15:00 UTC
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  const slots = [-1, 0, 1, 2].flatMap((d) => [day + d * 86_400_000 + 9 * H, day + d * 86_400_000 + 15 * H]);
  return slots.find((s) => s - now >= minAhead) ?? now + minAhead;
}

function base(now: number): AppStateResponse {
  return {
    server_time: iso(now),
    lead: { first_name: 'Madina' },
    funnel,
    state: 'no_session',
    session: null,
    live: null,
    between: null,
    missed: null,
    offer: null,
  };
}

function session(day1: number, canChange = true) {
  return { id: 101, day1_at: iso(day1), day2_at: iso(day1 + 24 * H), can_change: canChange };
}

function liveFixture(now: number, day: 1 | 2, startMs: number, offer: Offer | null): AppStateResponse {
  const day1 = day === 1 ? startMs : startMs - 24 * H;
  return {
    ...base(now),
    state: 'live',
    session: session(day1, false),
    live: {
      day,
      start_at: iso(startMs),
      duration_sec: VIDEO_SEC,
      hls_url: SAMPLE_HLS,
      comments: day === 1 ? day1Comments : day2Comments,
    },
    offer,
  };
}

function endedFixture(now: number, day2Start: number, over: Partial<Offer> = {}): AppStateResponse {
  const end = day2Start + VIDEO_SEC * 1000;
  return {
    ...base(now),
    state: 'ended',
    session: session(day2Start - 24 * H, false),
    offer: makeOffer({ deadline_at: iso(end + 24 * H), ...over }),
  };
}

function regularPrices(o: Offer): Offer {
  return {
    ...o,
    special_active: false,
    tariffs: o.tariffs.map((t) => ({ ...t, price_now: t.regular_price })),
  };
}

export interface MockScenario {
  key: string;
  label: string;
  build(now: number): AppStateResponse | { error: number };
}

export const MOCK_SCENARIOS: MockScenario[] = [
  { key: 'no_session', label: 'no_session', build: (now) => base(now) },
  {
    key: 'waiting',
    label: 'waiting — 2 soat',
    build: (now) => ({ ...base(now), state: 'waiting', session: session(now + 2 * H + 14 * M + 38_000) }),
  },
  {
    key: 'waiting_soon',
    label: 'waiting — 10 soniya (→ efir)',
    build: (now) => ({ ...base(now), state: 'waiting', session: session(now + 10_000) }),
  },
  {
    key: 'waiting_far',
    label: "waiting — slot, o'zgartirib bo'lmaydi",
    build: (now) => ({ ...base(now), state: 'waiting', session: session(nextSlot(now, 26 * H), false) }),
  },
  {
    key: 'live1',
    label: 'live — 1-kun',
    build: (now) => liveFixture(now, 1, now - 95_000, null),
  },
  {
    key: 'live1_soft',
    label: 'live — 1-kun, yumshoq taklif',
    build: (now) => {
      const start = now - 120_000;
      return liveFixture(now, 1, start, makeOffer({ soft: true, visible_from_sec: 125 }));
    },
  },
  {
    key: 'live2_offer',
    label: 'live — 2-kun, taklif (8 s)',
    build: (now) => {
      const start = now - 300_000;
      const end = start + VIDEO_SEC * 1000;
      return liveFixture(now, 2, start, makeOffer({ visible_from_sec: 308, deadline_at: iso(end + 24 * H) }));
    },
  },
  {
    key: 'between',
    label: 'between',
    build: (now) => {
      const day2 = nextSlot(now, 3 * H);
      return {
        ...base(now),
        state: 'between',
        session: session(day2 - 24 * H, false),
        between: {
          day1_percent: 92,
          day2_at: iso(day2),
          summary: [
            "Arab alifbosi 28 harfdan iborat, o'ngdan chapga yoziladi",
            "Harf so'zdagi o'rniga qarab 4 xil shaklda yoziladi",
            'Uy vazifasi: 5 ta harfni daftarga 10 martadan yozing',
          ],
        },
      };
    },
  },
  {
    key: 'missed1',
    label: 'missed — 1-kun, 2 imkoniyat',
    build: (now) => ({
      ...base(now),
      state: 'missed',
      session: session(now - 3 * H, false),
      missed: { day: 1, started_at: iso(now - 3 * H), reschedules_left: 2 },
    }),
  },
  {
    key: 'missed2_limit',
    label: 'missed — 2-kun, limit tugagan',
    build: (now) => ({
      ...base(now),
      state: 'missed',
      session: session(now - 27 * H, false),
      missed: { day: 2, started_at: iso(now - 3 * H), reschedules_left: 0 },
    }),
  },
  {
    key: 'closed',
    label: 'closed — 1-kun',
    build: (now) => {
      const start = now - 22 * M;
      return {
        ...base(now),
        state: 'closed',
        session: session(start, false),
        missed: { day: 1, started_at: iso(start), reschedules_left: 2 },
      };
    },
  },
  {
    key: 'ended',
    label: 'ended — maxsus narx',
    build: (now) => endedFixture(now, now - VIDEO_SEC * 1000 - 3 * H + 2 * M),
  },
  {
    key: 'ended_soon',
    label: 'ended — deadline 15 s (→ oddiy narx)',
    build: (now) => ({
      ...endedFixture(now, now - 25 * H),
      offer: makeOffer({ deadline_at: iso(now + 15_000) }),
    }),
  },
  {
    key: 'ended_regular',
    label: 'ended — oddiy narx',
    build: (now) => {
      const f = endedFixture(now, now - 30 * H);
      return { ...f, offer: f.offer ? regularPrices(f.offer) : null };
    },
  },
  {
    key: 'ended_closed',
    label: 'ended — taklif yopilgan',
    build: (now) => endedFixture(now, now - 30 * H, { special_active: false, closed: true }),
  },
  { key: 'err401', label: 'xato — 401 (bot tashqarisida)', build: () => ({ error: 401 }) },
  { key: 'err500', label: 'xato — server', build: () => ({ error: 500 }) },
];

const STORAGE_KEY = 'mock-scenario';

function initialKey(): string {
  try {
    const k = window.localStorage.getItem(STORAGE_KEY);
    if (k && MOCK_SCENARIOS.some((s) => s.key === k)) return k;
  } catch {
    /* storage yo'q */
  }
  return 'waiting';
}

let currentKey = initialKey();
let current: AppStateResponse | { error: number } | null = null;

export function getMockScenario(): string {
  return currentKey;
}

export function setMockScenario(key: string): void {
  currentKey = key;
  current = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* storage yo'q */
  }
}

/** Vaqt o'tishi bilan holatni keyingisiga o'tkazish (backend mantig'ining soddalashtirilgani). */
function advance(s: AppStateResponse, now: number): AppStateResponse {
  for (let i = 0; i < 5; i++) {
    if (s.state === 'waiting' && s.session && now >= Date.parse(s.session.day1_at)) {
      s = liveFixture(now, 1, Date.parse(s.session.day1_at), null);
      continue;
    }
    if (s.state === 'live' && s.live && now >= Date.parse(s.live.start_at) + s.live.duration_sec * 1000) {
      const start = Date.parse(s.live.start_at);
      if (s.live.day === 1) {
        s = {
          ...base(now),
          state: 'between',
          session: s.session,
          between: {
            day1_percent: 88,
            day2_at: iso(start + 24 * H),
            summary: ["Arab alifbosi 28 harfdan iborat, o'ngdan chapga yoziladi"],
          },
        };
      } else {
        s = endedFixture(now, start);
      }
      continue;
    }
    if (s.state === 'between' && s.between && now >= Date.parse(s.between.day2_at)) {
      const start = Date.parse(s.between.day2_at);
      s = liveFixture(now, 2, start, makeOffer({ visible_from_sec: 30 }));
      continue;
    }
    if (
      s.state === 'ended' &&
      s.offer &&
      s.offer.special_active &&
      s.offer.deadline_at &&
      now >= Date.parse(s.offer.deadline_at)
    ) {
      s = { ...s, offer: regularPrices(s.offer) };
      continue;
    }
    break;
  }
  return { ...s, server_time: iso(now) };
}

const delay = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export const mockApi: MiniApi = {
  async getState() {
    await delay(350);
    const now = Date.now();
    if (!current) {
      const sc = MOCK_SCENARIOS.find((s) => s.key === currentKey) ?? MOCK_SCENARIOS[0];
      current = sc.build(now);
    }
    if ('error' in current) {
      throw new ApiError(current.error, current.error === 401 ? 'initData invalid' : 'Internal error');
    }
    current = advance(current, now);
    return structuredClone(current);
  },
  async heartbeat(body) {
    console.info('[mock] POST /api/app/heartbeat', body);
    await delay(150);
    return { ok: true, server_time: iso(Date.now()) };
  },
  async question(text) {
    console.info('[mock] POST /api/app/question', { text });
    await delay(500);
    return { ok: true };
  },
  async offerClick(tariff_id) {
    console.info('[mock] POST /api/app/offer-click', { tariff_id });
    await delay(400);
    return { ok: true };
  },
  async reschedule() {
    console.info('[mock] POST /api/app/reschedule', {});
    await delay(400);
    return { ok: true };
  },
};
