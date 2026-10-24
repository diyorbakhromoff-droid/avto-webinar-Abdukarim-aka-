/**
 * Demo rejim (VITE_MOCK=1, `npm run dev:mock`): backendsiz ishlash uchun xotiradagi fixture'lar.
 * Yozish so'rovlari xotirada saqlanadi (sahifa yangilansa — boshlang'ich holat).
 */
import { ApiError } from './errors';
import { getToken } from './client';
import type {
  AdSpendRow, AdminUser, AuditRow, Broadcast, CallList, CallListKey, ChainHistoryEntry, ChainMessage,
  ChainMessageInput, ChatRow, ChatSession, CommentRow, ContactResult, DashboardResponse, FailedMessage, Funnel,
  FunnelSettings, GlobalSettings, LeadCard, LeadEvent, LeadRow, LeadStep, LiveResults, MediaInfo, PaymentKind,
  PaymentMethod, PaymentRow, QuestionRow, Requisites, SimulationRow, StatsResponse, TariffAdmin, WatchBucket, WatchStats,
} from './types';
import { CALL_LIST_FALLBACK, MINUTE_SEGMENTS, STEP_LABEL, WATCH_SEGMENTS } from '../lib/labels';
import { DAY_TRIGGERS, audienceShort, whenLabel } from '../lib/chain';
import { dayKey, pad2, tzParts, tzToUtc } from '../lib/time';
import { slotOptions } from '../lib/slots';

// ───────────── yordamchilar ─────────────
const M = 60_000, H = 60 * M, D = 24 * H;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261022);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => Math.floor(a + rand() * (b - a + 1));

/** Toshkent vaqti bo'yicha bugungi soat. */
function todayAt(hh: number, mm = 0, dayOffset = 0): number {
  const p = tzParts(NOW);
  return tzToUtc(p.y, p.m, p.d + dayOffset, hh, mm);
}

// ───────────── foydalanuvchilar va voronkalar ─────────────
const users: (AdminUser & { password: string })[] = [
  { id: 1, name: 'Diyor Bakhromov', login: 'admin', role: 'super_admin', tg_user_id: 100200300, active: true, password: 'x' },
  { id: 2, name: 'Kamola Yusupova', login: 'kamola', role: 'content', tg_user_id: 100200301, active: true, password: 'x' },
  { id: 3, name: 'Nodira Karimova', login: 'nodira', role: 'sales', tg_user_id: 100200302, active: true, password: 'x' },
  { id: 4, name: 'Aziz Rahimov', login: 'aziz', role: 'sales', tg_user_id: 100200303, active: true, password: 'x' },
  { id: 5, name: 'Sardor Olimov', login: 'sardor', role: 'sales', tg_user_id: null, active: false, password: 'x' },
];
const publicUser = ({ password: _pw, ...u }: AdminUser & { password: string }): AdminUser => (void _pw, u);

const funnels: Funnel[] = [
  { id: 1, slug: 'notiqlik', name: 'Notiqlik', bot_username: 'notiqlik_webinar_bot' },
  { id: 2, slug: 'bolalar', name: 'Bolalar notiqligi', bot_username: 'notiqlik_webinar_bot' },
];

function baseSettings(): FunnelSettings {
  return {
    course_title: 'Notiqlik kursi', webinar_title: 'Bepul webinar · 2 kun',
    topic: "Ishonch bilan gapirish: sahna qo'rquvini 2 kunda yengamiz", speaker_name: 'Jasur Karimov',
    speaker_title: "Notiqlik murabbiyi, 8 yillik tajriba", speaker_photo_url: null, logo_url: null,
    theme_primary: '#D4AF5A', theme_background: '#14110C', bg_image_url: null,
    welcome_text: "Assalomu alaykum, {ism}! 🎤\n\nBepul 2 kunlik notiqlik webinariga xush kelibsiz. Sovg'a — <b>«Sahnada 5 daqiqa»</b> mashqlar varag'i (PDF).",
    lead_magnet_media_id: 901, lead_magnet_caption: "«Sahnada 5 daqiqa» — har kuni 5 daqiqalik ovoz va nafas mashqlari",
    slot_times: ['14:00', '20:00'], weekdays: [0, 1, 2, 3, 4, 5, 6], excluded_dates: ['2026-12-31', '2027-01-01'],
    min_hours_before: 3, options_count: 2, late_entry_minutes: 15, reschedule_limit: 3, day1_watch_threshold: 0.75,
    quiet_start: '23:00', quiet_end: '08:00',
    day1_video_id: '7f3c1a2e-91b4-4c55-a1e0-2d9b8e6f0a11', day1_duration_sec: 122 * 60, day1_soft_offer_sec: 110 * 60,
    day2_video_id: 'b2e94d70-3f1a-4a8e-9c62-5e0d7a1c4b22', day2_duration_sec: 96 * 60, day2_offer_sec: 78 * 60,
    between_summary: ["Sahna qo'rquvi qayerdan kelishini tushundik", "Nafas va ovoz uchun 3 ta mashq", "Uy vazifasi: o'zingiz haqingizda 1 daqiqalik video yozing"],
    offer_course_title: 'Notiqlik kursi: 8 hafta',
    bonuses: ["Shaxsiy ovoz tahlili (audio)", "Kurator bilan haftalik jonli mashg'ulot", "Yopiq Telegram guruh"],
    deadline_hours: 24, after_deadline: 'regular_price', channel_id: -1002233445566,
    stuck_no_phone_min: 60, stuck_no_session_min: 120, stuck_no_receipt_min: 60,
  };
}
const settings: Record<number, FunnelSettings> = { 1: baseSettings(), 2: { ...baseSettings(), course_title: 'Bolalar notiqligi', slot_times: ['19:00'], weekdays: [0, 1, 2, 3, 4] } };
const requisites: Record<number, Requisites> = {
  1: { card_number: '8600 1234 5678 9012', card_holder: 'JASUR KARIMOV', payme_url: 'https://payme.uz/fallback/notiqlik', click_url: 'https://my.click.uz/services/pay?service_id=0000' },
  2: { card_number: '8600 1234 5678 9012', card_holder: 'JASUR KARIMOV', payme_url: '', click_url: '' },
};
let seq = 5000;
const nextId = () => ++seq;

const tariffs: Record<number, TariffAdmin[]> = {
  1: [
    { id: 11, name: 'Standart', description: '16 ta dars + uy vazifalari tekshiruvi', special_price: 1490000, regular_price: 1990000, deposit_enabled: true, deposit_amount: 100000, sort: 1 },
    { id: 12, name: 'VIP', description: 'Standart + shaxsiy kurator va ovoz tahlili', special_price: 2490000, regular_price: 3290000, deposit_enabled: true, deposit_amount: 100000, sort: 2 },
  ],
  2: [{ id: 21, name: 'Standart', description: 'Bolalar uchun: 8 ta dars', special_price: 790000, regular_price: 990000, deposit_enabled: false, deposit_amount: 0, sort: 1 }],
};

// ───────────── progrev zanjiri ─────────────
type Seed = Partial<ChainMessage> & Pick<ChainMessage, 'title' | 'trigger_type' | 'offset_minutes'>;
const ENTER = [[{ type: 'webapp' as const, text: 'Efirga kirish' }]];
const BACK = [[{ type: 'webapp' as const, text: 'Efirga qaytish' }]];
const PAY = [[{ type: 'pay' as const, text: 'Kursga yozilish' }]];
const chainSeed: Seed[] = [
  { title: "Xush kelibsiz + sovg'a", kind: 'document', trigger_type: 'after_registration', offset_minutes: 0, required: true, media_ids: [901], text: "Assalomu alaykum, {ism}! Mana va'da qilingan sovg'a — <b>«Sahnada 5 daqiqa»</b> mashqlar varag'i." },
  { title: 'Vaqt tanlash', trigger_type: 'after_registration', offset_minutes: 1, required: true, text: "{ism}, webinar 2 kun davom etadi. O'zingizga qulay vaqtni tanlang 👇", buttons: [[{ type: 'reschedule', text: 'Vaqt tanlash' }]] },
  { title: 'Spiker bilan tanishuv', kind: 'video', trigger_type: 'after_registration', offset_minutes: 60, media_ids: [902], text: "Men Jasur Karimov — 8 yildan beri odamlarga ishonch bilan gapirishni o'rgataman. Efirda nimalarni ko'rsatishimni qisqacha aytib beraman." },
  { title: 'Ertaga efir', trigger_type: 'before_day', trigger_day: 1, offset_minutes: 1440, text: "{ism}, eslatma: webinar {efir_sanasi} kuni soat {efir_vaqti} da. Daftar va ruchka tayyorlab qo'ying ✍️" },
  { title: 'Efirgacha 2 soat', kind: 'photo', trigger_type: 'before_day', trigger_day: 1, offset_minutes: 120, required: true, media_ids: [903], text: "{ism}, efirgacha 2 soat qoldi! Bugun {efir_vaqti} da sahna qo'rquvini 3 qadamda qanday yengishni ko'rsataman. Quloqchinni tayyorlab qo'ying.", buttons: [[{ type: 'reschedule', text: "Vaqtni o'zgartirish" }]] },
  { title: '15 daqiqa qoldi', trigger_type: 'before_day', trigger_day: 1, offset_minutes: 15, required: true, text: 'Webinar 15 daqiqadan keyin boshlanadi ⏰', buttons: ENTER },
  { title: 'Efir boshlandi', trigger_type: 'at_day_start', trigger_day: 1, offset_minutes: 0, required: true, text: '<b>Efir boshlandi!</b> Kirish uchun tugmani bosing 👇', buttons: ENTER },
  { title: 'Hali kirmaganlar', trigger_type: 'at_day_start', trigger_day: 1, offset_minutes: 10, segment: 'not_joined', segment_day: 1, text: "{ism}, efir boshlanganiga 10 daqiqa bo'ldi. Hali ulgurasiz — kiring.", buttons: ENTER },
  { title: '1-kun: efirdan chiqib ketganlar', trigger_type: 'left_live', trigger_day: 1, offset_minutes: 3, required: true, text: "{ism}, efir hali davom etyapti — eng muhim qismi oldinda. Qaytib kiring:", buttons: BACK },
  { title: '1-kun xulosasi', trigger_type: 'after_day_end', trigger_day: 1, offset_minutes: 5, segment: 'watched_full', segment_day: 1, text: "Oxirigacha ko'rganingiz uchun rahmat, {ism}! Bugun sahna qo'rquvi qayerdan kelishini tushundik. Ertaga {efir_vaqti} da — 2-kun." },
  { title: '40-daqiqagacha chiqib ketganlar', trigger_type: 'after_day_end', trigger_day: 1, offset_minutes: 10, segment: 'left_before_min', segment_day: 1, segment_minute: 40, text: "{ism}, efirdan erta chiqib ketdingiz — eng foydali qism 40-daqiqadan keyin edi: «pauza» texnikasi. Ertangi efirni o'tkazib yubormang." },
  { title: 'Boshqa vaqt tanlash', trigger_type: 'after_day_end', trigger_day: 1, offset_minutes: 0, segment: 'day1_missed', text: "{ism}, bugungi webinarga ulgurmadingiz. Hech qisi yo'q — boshqa vaqtni tanlang:", buttons: [[{ type: 'reschedule', text: 'Boshqa vaqt tanlash' }]] },
  { title: 'Uy vazifasi', trigger_type: 'after_day_end', trigger_day: 1, offset_minutes: 120, segment: 'day1_attended', text: "Kichik uy vazifasi: o'zingiz haqingizda 1 daqiqalik video yozing va menga yuboring 🎙", buttons: [[{ type: 'url', text: 'Vazifa', url: 'https://example.com/vazifa' }]] },
  { title: 'Bugun ikkinchi kun', trigger_type: 'before_day', trigger_day: 2, offset_minutes: 120, segment: 'day1_attended', text: "Bugun {efir_vaqti} da 2-kun! Nazariyadan amaliyotga o'tamiz — birinchi nutqingizni tuzamiz." },
  { title: '2-kun boshlandi', trigger_type: 'at_day_start', trigger_day: 2, offset_minutes: 0, segment: 'day1_attended', required: true, text: '2-kun boshlandi! «Efirga kirish» tugmasini bosing.', buttons: ENTER },
  { title: 'Taklif', kind: 'photo', trigger_type: 'at_day_start', trigger_day: 2, offset_minutes: 78, segment: 'day2_attended', media_ids: [904], text: "<b>Notiqlik kursi: 8 hafta</b> — maxsus narx {deadline} gacha amal qiladi.", buttons: PAY },
  { title: 'Muddati tugaydi', trigger_type: 'before_day', trigger_day: 2, offset_minutes: 15, status: 'draft', text: "{ism}, jonli efirdagi maxsus narx tez orada tugaydi!", warnings: ["Matnda «jonli» so'zi bor — halollik qoidasi (TZ §11)"] },
  { title: '2-kun: efirdan chiqib ketganlar', trigger_type: 'left_live', trigger_day: 2, offset_minutes: 3, required: true, text: "{ism}, efirdan chiqib ketdingiz. Kurs haqidagi taklif hali oldinda — qaytib kiring:", buttons: BACK },
  { title: 'Ofertagacha chiqib ketganlar', trigger_type: 'after_day_end', trigger_day: 2, offset_minutes: 0, segment: 'left_before_offer', text: "{ism}, efir oxirida kurs haqida aytdim — siz chiqib ketgan ekansiz. Qisqacha: 8 hafta, 16 ta amaliy dars.", buttons: PAY },
  { title: 'Deadline eslatmasi', trigger_type: 'after_day_end', trigger_day: 2, offset_minutes: 120, segment: 'not_paid', text: 'Maxsus narx {deadline} gacha saqlanadi.', buttons: PAY },
  { title: 'Deadline: 3 soat qoldi', trigger_type: 'before_deadline', offset_minutes: 180, segment: 'not_paid', required: true, text: "{ism}, maxsus narx tugashiga 3 soat qoldi ({deadline} gacha). Keyin oddiy narxga o'tadi.", buttons: PAY },
  { title: 'Raqamni yuborish eslatmasi', trigger_type: 'stuck', stuck_step: 'no_phone', offset_minutes: 60, text: "{ism}, sovg'ani olish va vaqt tanlash uchun raqamingizni yuboring 👇" },
  { title: 'Vaqt tanlash eslatmasi', trigger_type: 'stuck', stuck_step: 'no_session', offset_minutes: 120, text: 'Webinar vaqtini hali tanlamadingiz. Eng yaqin vaqtlar:', buttons: [[{ type: 'reschedule', text: 'Vaqt tanlash' }]] },
  { title: 'Chek yuborish eslatmasi', trigger_type: 'stuck', stuck_step: 'no_receipt', offset_minutes: 60, text: "To'lovni amalga oshirgan bo'lsangiz, chekni shu yerga yuboring. Rekvizitlar:", buttons: [[{ type: 'pay', text: "To'lov rekvizitlari" }]] },
  { title: 'Chek rad etildi', trigger_type: 'stuck', stuck_step: 'receipt_rejected', offset_minutes: 0, required: true, text: "Chekingizni tasdiqlab bo'lmadi. Iltimos, qayta yuboring." },
  { title: 'Uy vazifasi javobi', trigger_type: 'on_button', button_key: 'homework', offset_minutes: 0, status: 'draft', text: "Rahmat, {ism}! Videongizni ko'rib chiqib, fikrimni yozaman." },
];

function mkChain(fid: number): ChainMessage[] {
  return chainSeed.map((s, i) => ({
    id: fid * 100 + i + 1,
    title: s.title, kind: s.kind ?? 'text', text: s.text ?? '', media_ids: s.media_ids ?? [], buttons: s.buttons ?? [],
    trigger_type: s.trigger_type, trigger_day: s.trigger_day ?? null, offset_minutes: s.offset_minutes,
    stuck_step: s.stuck_step ?? null, button_key: s.button_key ?? null, segment: s.segment ?? 'all',
    segment_day: s.segment_day ?? null, segment_minute: s.segment_minute ?? null,
    required: s.required ?? false, status: s.status ?? 'active', sort: i + 1,
    updated_at: iso(NOW - between(1, 200) * H), updated_by: pick(['Kamola Yusupova', 'Diyor Bakhromov']),
    stats: s.status === 'draft' ? undefined : { sent: between(40, 410), clicks: s.buttons ? between(5, 120) : 0, blocked_after: between(0, 6) },
    warnings: s.warnings ?? [],
  }));
}
const chain: Record<number, ChainMessage[]> = { 1: mkChain(1), 2: mkChain(2).slice(0, 8) };
chain[1][4].updated_at = iso(todayAt(11, 20));
chain[1][4].updated_by = 'Kamola Yusupova';
const chainHistory: Record<number, ChainHistoryEntry[]> = {};

function honestyWarnings(text: string): string[] {
  return /(^|[^\p{L}])(jonli|live\b|hozir\s+efirda)/iu.test(text) ? ["Matnda «jonli» / «live» / «hozir efirda» bor — halollik qoidasi (TZ §11)"] : [];
}

// ───────────── lidlar ─────────────
const FIRST = ['Madina', 'Sevara', 'Dilnoza', 'Gulnora', 'Zarina', 'Malika', 'Nilufar', 'Shahnoza', 'Mohira', 'Feruza', 'Kamola', 'Dildora', 'Nargiza', 'Umida', 'Zulfiya', 'Hilola', 'Barno', 'Lobar', 'Munisa', 'Sabina'];
const LAST = ['Karimova', 'Aliyeva', 'Tursunova', 'Rahimova', 'Yusupova', 'Ergasheva', 'Nazarova', 'Saidova', 'Qodirova', 'Ismoilova', 'Abdullayeva', 'Xoliqova'];
const SOURCES = ['ig_reels3', 'ig_story1', 'tg_ads', 'fb_lead2', 'ig_reels5'];
const STEP_WEIGHTS: [LeadStep, number][] = [
  ['started', 6], ['phone', 9], ['session', 14], ['day1_missed', 10], ['day1_watched', 8], ['day2_missed', 9],
  ['left_before_offer', 10], ['reached_offer', 12], ['clicked_buy', 6], ['receipt_sent', 4], ['receipt_rejected', 2],
  ['deposit_paid', 5], ['full_paid', 6], ['cold', 4],
];
function weightedStep(): LeadStep {
  const total = STEP_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [s, w] of STEP_WEIGHTS) {
    r -= w;
    if (r <= 0) return s;
  }
  return 'session';
}
const ORDER: LeadStep[] = ['started', 'phone', 'session', 'day1_missed', 'day1_watched', 'day2_missed', 'left_before_offer', 'reached_offer', 'clicked_buy', 'receipt_sent', 'receipt_rejected', 'deposit_paid', 'full_paid'];
const atLeast = (s: LeadStep, min: LeadStep) => s !== 'cold' && ORDER.indexOf(s) >= ORDER.indexOf(min);

interface LeadState extends LeadRow {
  funnel_id: number;
  extra?: Pick<LeadCard, 'deadline_at' | 'remaining_amount' | 'remaining_due_date' | 'contacts' | 'events' | 'messages' | 'sessions'>;
}

function mkLead(id: number, fid: number, forceStep?: LeadStep, name?: string): LeadState {
  const step = forceStep ?? weightedStep();
  const created = NOW - between(20, 60 * 24 * 9) * M;
  const watched1 = atLeast(step, 'day1_watched') && step !== 'day1_missed';
  const day2 = ['left_before_offer', 'reached_offer', 'clicked_buy', 'receipt_sent', 'receipt_rejected', 'deposit_paid', 'full_paid'].includes(step);
  const reached = day2 && step !== 'left_before_offer';
  const pay = step === 'deposit_paid' ? 'deposit' : step === 'full_paid' ? 'full' : 'none';
  const mgr = atLeast(step, 'left_before_offer') && rand() < 0.75 ? pick([{ id: 3, name: 'Nodira' }, { id: 4, name: 'Aziz' }]) : null;
  const fn = name ?? `${pick(FIRST)} ${pick(LAST)}`;
  return {
    id, funnel_id: fid, name: fn,
    phone: step === 'started' ? null : `+998 ${pick(['90', '91', '93', '94', '97', '99', '88'])} ${between(100, 999)} ${pad2(between(0, 99))} ${pad2(between(0, 99))}`,
    username: rand() < 0.7 ? `${fn.split(' ')[0].toLowerCase()}_${between(1, 99)}` : null,
    source: pick(SOURCES),
    day1_minutes: watched1 ? between(92, 122) : step === 'day1_missed' && rand() < 0.4 ? between(5, 60) : null,
    day2_minutes: day2 ? (reached ? between(78, 96) : between(20, 70)) : step === 'day2_missed' && rand() < 0.3 ? between(5, 30) : null,
    reached_offer: reached, clicked_buy: atLeast(step, 'clicked_buy'),
    receipt: step === 'receipt_sent' ? 'pending' : step === 'receipt_rejected' ? 'rejected' : pay !== 'none' ? 'approved' : 'none',
    payment_status: pay, manager: mgr, step, step_label: STEP_LABEL[step],
    step_since: iso(Math.min(NOW - 5 * M, created + between(1, 60 * 40) * M)),
    last_contact_at: mgr && rand() < 0.6 ? iso(NOW - between(1, 72) * H) : null,
    blocked: rand() < 0.05, unsubscribed: rand() < 0.03, created_at: iso(created),
  };
}

const leads: LeadState[] = [];
(() => {
  // dizayndagi 6 ta lid — "Ofertagacha chiqib ketgan"
  const named = ['Madina Karimova', 'Sevara Aliyeva', 'Dilnoza Tursunova', 'Gulnora Rahimova', 'Zarina Yusupova', 'Malika Ergasheva'];
  named.forEach((n, i) => {
    const l = mkLead(1001 + i, 1, 'left_before_offer', n);
    l.step_since = iso(NOW - [3, 5, 6, 26, 30, 50][i] * H);
    l.blocked = false;
    l.unsubscribed = false;
    leads.push(l);
  });
  leads[0].phone = '+998 90 123 45 67';
  leads[0].username = 'madina_k';
  leads[0].source = 'ig_reels3';
  leads[0].day1_minutes = 118;
  leads[0].day2_minutes = 41;
  leads[0].manager = { id: 3, name: 'Nodira' };
  for (let i = 0; i < 131; i++) leads.push(mkLead(1100 + i, 1));
  for (let i = 0; i < 23; i++) leads.push(mkLead(2100 + i, 2));
  // 5 ta chek kutilmoqda (dizayn bo'yicha)
  ['Dilnoza Tursunova', 'Gulnora Rahimova', 'Zarina Yusupova', 'Malika Ergasheva'].forEach((n, i) => leads.push({ ...mkLead(1300 + i, 1, i === 3 ? 'deposit_paid' : 'receipt_sent', n), blocked: false }));
})();

function stepOrderLabel(s: LeadStep) {
  return STEP_LABEL[s];
}

function callListMatch(l: LeadState, key: CallListKey): boolean {
  switch (key) {
    case 'deposit_paid': return l.payment_status === 'deposit';
    case 'full_paid': return l.payment_status === 'full';
    case 'offer_not_paid': return l.reached_offer && l.payment_status === 'none';
    case 'clicked_no_receipt': return l.step === 'clicked_buy';
    case 'receipt_rejected': return l.step === 'receipt_rejected';
    case 'no_session': return l.step === 'phone';
    case 'day1_missed': return l.step === 'day1_missed';
    case 'day2_missed': return l.step === 'day2_missed';
    case 'left_before_offer': return l.step === 'left_before_offer';
    case 'cold': return l.step === 'cold';
    case 'blocked': return l.blocked;
  }
}
const CALL_KEYS: CallListKey[] = ['deposit_paid', 'full_paid', 'left_before_offer', 'offer_not_paid', 'clicked_no_receipt', 'receipt_rejected', 'no_session', 'day1_missed', 'day2_missed', 'cold', 'blocked'];

// ───────────── to'lovlar ─────────────
const payments: (PaymentRow & { funnel_id: number })[] = [];
(() => {
  let pid = 1000;
  for (const l of leads) {
    if (l.receipt === 'none') continue;
    const t = tariffs[l.funnel_id]?.[rand() < 0.75 ? 0 : 1] ?? tariffs[l.funnel_id][0];
    const kind: PaymentKind = l.payment_status === 'deposit' ? 'deposit' : l.payment_status === 'full' ? 'full' : rand() < 0.5 ? 'deposit' : 'full';
    const method: PaymentMethod = pick(['card', 'card', 'payme', 'click']);
    const status = l.receipt === 'pending' ? 'pending' : l.receipt === 'approved' ? 'approved' : 'rejected';
    const submitted = l.receipt === 'pending' ? NOW - between(3, 45) * M : Date.parse(l.step_since) - between(10, 300) * M;
    payments.push({
      id: ++pid, funnel_id: l.funnel_id, lead_id: l.id, lead_name: l.name, lead_phone: l.phone, tariff: t.name, method, kind,
      amount: kind === 'deposit' ? t.deposit_amount || 100000 : t.special_price, status,
      reject_reason: status === 'rejected' ? pick(["Summa mos emas", "Chek o'qilmaydi"]) : null,
      submitted_at: iso(submitted), decided_at: status === 'pending' ? null : iso(submitted + between(4, 40) * M),
      decided_by: status === 'pending' ? null : pick(['Nodira Karimova', 'Aziz Rahimov']),
      within_deadline: rand() < 0.85, duplicate_of: null, refunded: false,
      file_url: `/api/admin/payments/${pid}/file`, file_mime: rand() < 0.12 ? 'application/pdf' : 'image/png',
    });
  }
  // remaining payment for deposit lead + duplicate warning
  const dep = leads.find((l) => l.id === 1303)!;
  payments.push({
    id: ++pid, funnel_id: 1, lead_id: dep.id, lead_name: dep.name, lead_phone: dep.phone, tariff: 'Standart', method: 'card', kind: 'remaining',
    amount: 1390000, status: 'pending', reject_reason: null, submitted_at: iso(NOW - 41 * M), decided_at: null, decided_by: null,
    within_deadline: true, duplicate_of: null, refunded: false, file_url: `/api/admin/payments/${pid}/file`, file_mime: 'image/png',
  });
  const pend = payments.filter((p) => p.status === 'pending' && p.funnel_id === 1);
  if (pend.length > 1) pend[1].duplicate_of = payments.find((p) => p.status === 'approved')?.id ?? null;
  const first = leads[0];
  payments.push({
    id: 1042, funnel_id: 1, lead_id: first.id, lead_name: first.name, lead_phone: first.phone, tariff: 'Standart', method: 'card', kind: 'deposit',
    amount: 100000, status: 'pending', reject_reason: null, submitted_at: iso(NOW - 4 * M), decided_at: null, decided_by: null,
    within_deadline: true, duplicate_of: null, refunded: false, file_url: '/api/admin/payments/1042/file', file_mime: 'image/png',
  });
})();

// ───────────── qolganlar ─────────────
const questions: (QuestionRow & { funnel_id: number })[] = [
  { id: 1, funnel_id: 1, lead_id: 1001, lead_name: 'Madina Karimova', text: "Kurs necha hafta davom etadi va darslar qaysi kunlari bo'ladi? Ishdan keyin ulguramanmi?", source: 'bot', created_at: iso(NOW - 25 * M), answer: null, answered_at: null },
  { id: 2, funnel_id: 1, lead_id: 1102, lead_name: leads[8].name, text: "Bo'lib to'lash mumkinmi?", source: 'bot', created_at: iso(NOW - 3 * H), answer: null, answered_at: null },
  { id: 3, funnel_id: 1, lead_id: 1105, lead_name: leads[11].name, text: "Men 45 yoshdaman, notiqlikni o'rganishga kech emasmi?", source: 'bot', created_at: iso(NOW - 7 * H), answer: null, answered_at: null },
  { id: 4, funnel_id: 1, lead_id: 1110, lead_name: leads[16].name, text: 'Keyingi guruh qachon boshlanadi?', source: 'bot', created_at: iso(NOW - 2 * D), answer: "Keyingi guruh dushanba kuni boshlanadi, to'lovdan keyin kanal havolasi keladi.", answered_at: iso(NOW - 2 * D + 30 * M) },
];

// ───────────── efir chati (Mini App'da efir davomida) ─────────────
const chat: (ChatRow & { funnel_id: number })[] = [];
(() => {
  // Oxirgi o'tgan slotlar (14:00 / 20:00), eng yangisi birinchi
  const slots: number[] = [];
  for (let d = 0; d >= -4; d--) for (const hh of [20, 14]) slots.push(todayAt(hh, 0, d));
  const past = slots.filter((t) => t <= NOW - 20 * M).sort((a, z) => z - a);
  const sessions: { day: 1 | 2; at: number }[] = [
    { day: 1, at: past[0] },
    { day: 2, at: past[1] },
    { day: 1, at: past[1] - D },
    { day: 1, at: past[4] },
  ];
  const texts: [string, number][] = [
    ["Assalomu alaykum! Samarqanddan kuzatyapman 👋", 95],
    ["Sahnaga chiqsam ovozim titraydi. Shu nafas mashqi yordam beradimi?", 1012],
    ["Nafas mashqini kuniga necha marta qilish kerak?", 1390],
    ["Ishda taqdimot qilishdan juda qo'rqaman, kurs menga mos keladimi?", 2052],
    ["Pauza haqida yana bir marta tushuntirib bera olasizmi?", 2290],
    ["Juda foydali, rahmat! Yozib oldim ✍️", 2765],
    ["Ovoz biroz uzilib qoldi, faqat mendami?", 3301],
    ["Mikrofon bilan gapirganda qo'llarimni qayerga qo'yaman?", 4120],
    ["Farzandim 14 yoshda, u ham qatnasha oladimi?", 5480],
    ["Kurs onlaynmi yoki oflaynmi?", 6650],
  ];
  const fl = leads.filter((l) => l.funnel_id === 1 && l.phone);
  let id = 1;
  sessions.forEach((ss, si) => {
    const dur = ss.day === 1 ? 122 * 60 : 96 * 60;
    const n = [7, 5, 4, 3][si];
    for (let k = 0; k < n; k++) {
      const [text, sec0] = texts[(k * 3 + si * 2) % texts.length];
      const video_sec = Math.min(dur - 30, sec0 + si * 37 + k * 11);
      const created = ss.at + (video_sec + between(20, 180)) * 1000;
      if (created > NOW - M) continue;
      const lead = fl[(si * 7 + k * 5) % fl.length];
      const answered = si >= 2 || (si === 1 && k < 2) || (si === 0 && k === 1);
      chat.push({
        id: id++, funnel_id: 1, lead_id: lead.id, lead_name: lead.name, lead_phone: lead.phone,
        text, day: ss.day, video_sec, session_at: iso(ss.at), created_at: iso(created),
        answer: answered ? pick(["Ha, albatta! Kursda buni alohida darsda mashq qilamiz.", "Rahmat savolingiz uchun — efir oxirida batafsil aytaman.", "Kuniga 2 marta, 5 daqiqadan yetarli."]) : null,
        answered_at: answered ? iso(Math.min(NOW - M, created + between(2, 30) * M)) : null,
        answered_by: answered ? pick(['Kamola Yusupova', 'Nodira Karimova']) : null,
      });
    }
  });
})();

const broadcasts: (Broadcast & { funnel_id: number })[] = [
  { id: 1, funnel_id: 1, segment: 'cold', text: "Assalomu alaykum! Yangi bepul webinar vaqtlari ochildi — o'zingizga qulay vaqtni tanlang.", buttons: [[{ type: 'reschedule', text: 'Vaqt tanlash' }]], media_id: null, send_at: null, status: 'done', recipients: 214, created_at: iso(NOW - 3 * D) },
  { id: 2, funnel_id: 1, segment: 'not_paid', text: "Kurs bo'yicha savollaringiz bormi? Menejerimiz javob beradi.", buttons: [], media_id: null, send_at: iso(todayAt(19, 0, 1)), status: 'scheduled', recipients: 0, created_at: iso(NOW - 2 * H) },
];

const comments: (CommentRow & { funnel_id: number })[] = [];
(() => {
  const texts = ["Assalomu alaykum!", "Toshkentdan salom 👋", "Juda tushunarli tushuntiryapsiz", "Men ham sahnada shunday qotib qolaman", "Rahmat, yozib oldim", "Nafas mashqi rostdan yordam berdi!", "Ovoz yaxshi eshitilyapti", "Uy vazifasi qayerda bo'ladi?", "Ajoyib, davom eting", "Ertaga ham bo'ladimi?"];
  let cid = 1;
  for (const day of [1, 2] as const) {
    for (let i = 0; i < 10; i++) comments.push({ id: cid++, funnel_id: 1, day, t: 30 + i * between(200, 420), author: pick(FIRST), text: texts[(i + day) % texts.length] });
  }
})();

const adSpend: Record<number, AdSpendRow[]> = {
  1: [
    { id: 1, source: 'ig_reels3', date: dayKey(NOW - 2 * D), amount: 1500000 },
    { id: 2, source: 'ig_story1', date: dayKey(NOW - 2 * D), amount: 900000 },
    { id: 3, source: 'tg_ads', date: dayKey(NOW - D), amount: 1200000 },
  ],
  2: [],
};
const liveResults: Record<number, LiveResults> = { 1: { day1_watch_rate: 0.41, paid_rate: 0.048, cost_per_sale: 980000 }, 2: { day1_watch_rate: null, paid_rate: null, cost_per_sale: null } };
let globalSettings: GlobalSettings = { admin_group_chat_id: -1001987654321, bot_username: 'notiqlik_webinar_bot' };
const audit: AuditRow[] = [
  { at: iso(NOW - 2 * H), user: 'Kamola Yusupova', action: 'chain.update', details: '«Efirgacha 2 soat»: matn o\'zgardi' },
  { at: iso(NOW - 5 * H), user: 'Nodira Karimova', action: 'payment.approve', details: "Chek #1031 tasdiqlandi (100 000 so'm)" },
  { at: iso(NOW - D), user: 'Diyor Bakhromov', action: 'requisites.update', details: 'Notiqlik: Payme havolasi yangilandi' },
  { at: iso(NOW - 2 * D), user: 'Diyor Bakhromov', action: 'user.create', details: 'Aziz Rahimov (sotuv menejeri)' },
];
const failed: FailedMessage[] = [
  { id: 1, lead_name: 'Hilola Saidova', title: 'Efirgacha 2 soat', error: 'Forbidden: bot was blocked by the user', at: iso(NOW - 3 * H) },
];

// ───────────── marshrutlash ─────────────
interface Ctx { m: RegExpExecArray; q: Record<string, string>; body: unknown; user: AdminUser }
type Handler = (c: Ctx) => unknown;
const routes: { method: string; re: RegExp; h: Handler; open?: boolean }[] = [];
function on(method: string, pattern: string, h: Handler, open = false) {
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), h, open });
}
const n = (s: string) => Number(s);
const b = <T>(c: Ctx) => (c.body ?? {}) as T;
function need(c: Ctx, ...roles: AdminUser['role'][]) {
  if (!roles.includes(c.user.role)) throw new ApiError(403, "Bu amal uchun ruxsat yo'q");
}
function notFound(): never {
  throw new ApiError(404, 'Topilmadi');
}
function currentUser(): AdminUser | null {
  const t = getToken();
  const m = t && /^mock:(\d+)$/.exec(t);
  const u = m ? users.find((x) => x.id === Number(m[1])) : undefined;
  return u ? publicUser(u) : null;
}
function audited(c: Ctx, action: string, details: string) {
  audit.unshift({ at: iso(Date.now()), user: c.user.name, action, details });
}

// auth
on('POST', '/admin/auth/login', (c) => {
  const { login } = b<{ login: string; password: string }>(c);
  const u = users.find((x) => x.login === login.toLowerCase()) ?? users[0];
  if (!u.active) throw new ApiError(403, 'Foydalanuvchi o\'chirilgan');
  return { token: `mock:${u.id}`, user: publicUser(u) };
}, true);
on('GET', '/admin/me', (c) => c.user);
on('GET', '/admin/users', (c) => (need(c, 'super_admin'), users.map(publicUser)));
on('GET', '/admin/managers', () => users.filter((u) => u.active && (u.role === 'sales' || u.role === 'super_admin')).map((u) => ({ id: u.id, name: u.name })));
on('POST', '/admin/users', (c) => {
  need(c, 'super_admin');
  const body = b<AdminUser & { password?: string }>(c);
  if (users.some((u) => u.login === body.login)) throw new ApiError(409, 'Bu login band');
  const u = { ...body, id: nextId(), password: body.password ?? '' } as AdminUser & { password: string };
  users.push(u);
  audited(c, 'user.create', `${u.name} (${u.role})`);
  return publicUser(u);
});
on('PUT', '/admin/users/:id', (c) => {
  need(c, 'super_admin');
  const u = users.find((x) => x.id === n(c.m[1])) ?? notFound();
  Object.assign(u, b<object>(c));
  audited(c, 'user.update', u.name);
  return publicUser(u);
});

// funnels
on('GET', '/admin/funnels', () => funnels);
on('POST', '/admin/funnels', (c) => {
  need(c, 'super_admin', 'content');
  const { slug, name } = b<{ slug: string; name: string }>(c);
  if (funnels.some((f) => f.slug === slug)) throw new ApiError(409, 'Bu slug band');
  const f: Funnel = { id: nextId(), slug, name, bot_username: globalSettings.bot_username };
  funnels.push(f);
  settings[f.id] = { ...baseSettings(), course_title: name };
  requisites[f.id] = { card_number: '', card_holder: '', payme_url: '', click_url: '' };
  tariffs[f.id] = [];
  chain[f.id] = [];
  adSpend[f.id] = [];
  liveResults[f.id] = { day1_watch_rate: null, paid_rate: null, cost_per_sale: null };
  return f;
});
on('POST', '/admin/funnels/:id/copy', (c) => {
  need(c, 'super_admin', 'content');
  const src = n(c.m[1]);
  const { slug, name } = b<{ slug: string; name: string }>(c);
  if (funnels.some((f) => f.slug === slug)) throw new ApiError(409, 'Bu slug band');
  const f: Funnel = { id: nextId(), slug, name, bot_username: globalSettings.bot_username };
  funnels.push(f);
  settings[f.id] = clone(settings[src]);
  requisites[f.id] = clone(requisites[src]);
  tariffs[f.id] = clone(tariffs[src] ?? []).map((t) => ({ ...t, id: nextId() }));
  chain[f.id] = clone(chain[src] ?? []).map((m) => ({ ...m, id: nextId(), stats: undefined }));
  adSpend[f.id] = [];
  liveResults[f.id] = { day1_watch_rate: null, paid_rate: null, cost_per_sale: null };
  return f;
});
on('GET', '/admin/funnels/:id/deeplink', (c) => {
  const f = funnels.find((x) => x.id === n(c.m[1])) ?? notFound();
  const start = `${f.slug}_${c.q.source ?? ''}`;
  if (start.length > 64 || !/^[A-Za-z0-9_-]+$/.test(start)) throw new ApiError(422, "Manba noto'g'ri: 64 belgigacha, faqat lotin harf, raqam, _ va -");
  return { url: `https://t.me/${f.bot_username}?start=${start}` };
});
on('GET', '/admin/funnels/:id/settings', (c) => settings[n(c.m[1])] ?? notFound());
on('PUT', '/admin/funnels/:id/settings', (c) => {
  need(c, 'super_admin', 'content');
  const fid = n(c.m[1]);
  const s = { ...(settings[fid] ?? notFound()), ...b<FunnelSettings>(c) };
  settings[fid] = s;
  const warnings: string[] = [];
  if (s.late_entry_minutes * 60 > s.day1_duration_sec * 0.25) warnings.push(`Kech kirish L = ${s.late_entry_minutes} daq 1-kun videosining 25% idan oshadi — kech kirgan lid 75% ga yeta olmaydi.`);
  if (s.day2_offer_sec >= s.day2_duration_sec) warnings.push('2-kun oferta timecode video davomiyligidan katta.');
  if (!s.slot_times.length) warnings.push("Slot yo'q — yangi lidlarga vaqt taklif qilinmaydi.");
  return { ...s, warnings };
});
on('GET', '/admin/funnels/:id/requisites', (c) => (need(c, 'super_admin'), requisites[n(c.m[1])] ?? notFound()));
on('PUT', '/admin/funnels/:id/requisites', (c) => {
  need(c, 'super_admin');
  requisites[n(c.m[1])] = b<Requisites>(c);
  audited(c, 'requisites.update', `${funnels.find((f) => f.id === n(c.m[1]))?.name}: rekvizitlar o'zgardi`);
  return requisites[n(c.m[1])];
});

// tariffs
on('GET', '/admin/funnels/:id/tariffs', (c) => tariffs[n(c.m[1])] ?? []);
on('POST', '/admin/funnels/:id/tariffs', (c) => {
  need(c, 'super_admin', 'content');
  const t = { ...b<TariffAdmin>(c), id: nextId() };
  (tariffs[n(c.m[1])] ??= []).push(t);
  return t;
});
on('PUT', '/admin/tariffs/:id', (c) => {
  need(c, 'super_admin', 'content');
  for (const list of Object.values(tariffs)) {
    const i = list.findIndex((t) => t.id === n(c.m[1]));
    if (i >= 0) return (list[i] = { ...list[i], ...b<TariffAdmin>(c), id: list[i].id });
  }
  return notFound();
});
on('DELETE', '/admin/tariffs/:id', (c) => {
  need(c, 'super_admin', 'content');
  for (const k of Object.keys(tariffs)) tariffs[n(k)] = tariffs[n(k)].filter((t) => t.id !== n(c.m[1]));
  return undefined;
});

// chain
function findMsg(id: number): [number, ChainMessage] {
  for (const [fid, list] of Object.entries(chain)) {
    const m = list.find((x) => x.id === id);
    if (m) return [n(fid), m];
  }
  return notFound();
}
/** Backend validatsiyasi (chain.py validate + media_rules.validate_message): 400 + "xato1; xato2". */
function validateChain(m: ChainMessageInput) {
  const errors: string[] = [];
  if (DAY_TRIGGERS.has(m.trigger_type) && m.trigger_day !== 1 && m.trigger_day !== 2) errors.push('Kun (1 yoki 2) tanlanmagan');
  if (m.trigger_type === 'stuck' && !m.stuck_step) errors.push("To'xtab qolish qadami tanlanmagan");
  if (m.trigger_type === 'on_button' && !m.button_key) errors.push('Tugma kaliti kiritilmagan');
  const segDay = m.segment_day || m.trigger_day;
  if (WATCH_SEGMENTS.has(m.segment) && segDay !== 1 && segDay !== 2) errors.push('Qaysi kun videosi ekanini tanlang');
  if (MINUTE_SEGMENTS.has(m.segment) && !(m.segment_minute && m.segment_minute > 0)) errors.push('Videoning daqiqasini kiriting');
  if (m.offset_minutes < 0) errors.push("Vaqt manfiy bo'lishi mumkin emas");
  if (m.kind === 'album' && m.buttons.length) errors.push("Albomga tugma qo'shib bo'lmaydi — tugmalarni keyingi xabarga qo'ying");
  if (m.kind === 'album' && (m.media_ids.length < 2 || m.media_ids.length > 10)) errors.push("Albomda 2–10 ta media bo'lishi kerak.");
  if (m.kind !== 'text' && m.kind !== 'album' && m.media_ids.length !== 1) errors.push('Bu turdagi xabarga bitta media biriktiring.');
  const limit = m.kind === 'text' ? 4096 : 1024;
  if (m.text.length > limit) errors.push(`Matn ${m.text.length} belgi — chegara ${limit}.`);
  if (m.buttons.length > 3) errors.push("Tugmalar 1–3 qator bo'lishi kerak.");
  if (errors.length) throw new ApiError(400, errors.join('; '));
}

on('GET', '/admin/funnels/:id/chain', (c) => chain[n(c.m[1])] ?? []);
on('POST', '/admin/funnels/:id/chain', (c) => {
  need(c, 'super_admin', 'content');
  const body = b<ChainMessageInput>(c);
  validateChain(body);
  const m: ChainMessage = { ...body, id: nextId(), updated_at: iso(Date.now()), updated_by: c.user.name, warnings: honestyWarnings(body.text) };
  (chain[n(c.m[1])] ??= []).push(m);
  chainHistory[m.id] = [{ at: m.updated_at, user: c.user.name, changes: { title: [null, m.title] } }];
  return m;
});
on('PUT', '/admin/chain/:id', (c) => {
  need(c, 'super_admin', 'content');
  const [, m] = findMsg(n(c.m[1]));
  const body = b<ChainMessageInput>(c);
  validateChain(body);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(body)) {
    const old = (m as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(old) !== JSON.stringify(v)) changes[k] = [old, v];
  }
  Object.assign(m, body, { updated_at: iso(Date.now()), updated_by: c.user.name, warnings: honestyWarnings(body.text) });
  if (Object.keys(changes).length) (chainHistory[m.id] ??= []).push({ at: m.updated_at, user: c.user.name, changes });
  return m;
});
on('DELETE', '/admin/chain/:id', (c) => {
  need(c, 'super_admin', 'content');
  const [fid] = findMsg(n(c.m[1]));
  chain[fid] = chain[fid].filter((x) => x.id !== n(c.m[1]));
  return undefined;
});
on('POST', '/admin/chain/:id/duplicate', (c) => {
  need(c, 'super_admin', 'content');
  const [fid, m] = findMsg(n(c.m[1]));
  const copy: ChainMessage = { ...clone(m), id: nextId(), title: `${m.title} (nusxa)`, status: 'draft', stats: undefined, updated_at: iso(Date.now()), updated_by: c.user.name };
  chain[fid].push(copy);
  return copy;
});
on('POST', '/admin/chain/:id/test', (c) => {
  if (!c.user.tg_user_id) throw new ApiError(400, "Profilingizda Telegram ID yo'q — Sozlamalarda kiriting");
  findMsg(n(c.m[1]));
  return { ok: true };
});
on('GET', '/admin/chain/:id/history', (c) => {
  const [, m] = findMsg(n(c.m[1]));
  return chainHistory[m.id] ?? [
    { at: iso(Date.parse(m.updated_at) - 3 * D), user: 'Diyor Bakhromov', changes: { title: [null, m.title], status: [null, 'draft'] } },
    { at: m.updated_at, user: m.updated_by ?? 'Kamola Yusupova', changes: { status: ['draft', m.status], offset_minutes: [m.offset_minutes + 60, m.offset_minutes] } },
  ];
});
on('POST', '/admin/funnels/:id/chain/simulate', (c) => {
  const fid = n(c.m[1]);
  const s = settings[fid];
  const { registered_at, day1_at } = b<{ registered_at: string; day1_at: string }>(c);
  const reg = Date.parse(registered_at), d1 = Date.parse(day1_at), d2 = d1 + D;
  const rows: SimulationRow[] = [];
  const active = (chain[fid] ?? []).filter((m) => m.status === 'active');
  const limit = d1 - 30 * M;
  const compressQueue: ChainMessage[] = [];
  for (const m of active) {
    const trig = whenLabel(m);
    const seg = m.segment !== 'all' ? `faqat: ${audienceShort(m)}` : null;
    let t: number | null = null;
    switch (m.trigger_type) {
      case 'after_registration':
        t = reg + m.offset_minutes * M;
        if (t > limit && m.offset_minutes > 1) {
          if (m.required) compressQueue.push(m);
          else rows.push({ message_id: m.id, title: m.title, trigger: trig, send_at: null, status: 'skipped', reason: 'vaqt yetmaydi' });
          continue;
        }
        break;
      case 'before_day': t = (m.trigger_day === 2 ? d2 : d1) - m.offset_minutes * M; break;
      case 'at_day_start': t = (m.trigger_day === 2 ? d2 : d1) + m.offset_minutes * M; break;
      case 'after_day_end': t = (m.trigger_day === 2 ? d2 + s.day2_duration_sec * 1000 : d1 + s.day1_duration_sec * 1000) + m.offset_minutes * M; break;
      case 'before_deadline': t = d2 + s.day2_duration_sec * 1000 + s.deadline_hours * H - m.offset_minutes * M; break;
      default:
        rows.push({
          message_id: m.id, title: m.title, trigger: trig, send_at: null, status: 'event',
          reason: m.trigger_type === 'stuck' ? "lid qadamda to'xtasa" : m.trigger_type === 'left_live' ? `lid ${m.trigger_day}-kun efiridan chiqib ketsa (qaytsa — bekor)` : 'tugma bosilganda',
        });
        continue;
    }
    if (t < reg) {
      rows.push({ message_id: m.id, title: m.title, trigger: trig, send_at: null, status: 'skipped', reason: "vaqti ro'yxatdan oldin o'tib ketgan" });
      continue;
    }
    const p = tzParts(t);
    const hm = `${pad2(p.hh)}:${pad2(p.mm)}`;
    const quiet = s.quiet_start > s.quiet_end ? hm >= s.quiet_start || hm < s.quiet_end : hm >= s.quiet_start && hm < s.quiet_end;
    if (quiet) {
      const [qh, qm] = s.quiet_end.split(':').map(Number);
      let shifted = tzToUtc(p.y, p.m, p.d, qh, qm);
      if (shifted < t) shifted += D;
      rows.push({ message_id: m.id, title: m.title, trigger: trig, send_at: iso(shifted), status: 'quiet_shifted', reason: `tungi tinchlik: ${s.quiet_end} ga surildi` });
      continue;
    }
    rows.push({ message_id: m.id, title: m.title, trigger: trig, send_at: iso(t), status: 'scheduled', reason: seg });
  }
  if (compressQueue.length) {
    const start = reg + 2 * M;
    const gap = Math.max(20 * M, (limit - start) / (compressQueue.length + 1));
    compressQueue.forEach((m, i) => rows.push({ message_id: m.id, title: m.title, trigger: whenLabel(m), send_at: iso(start + gap * (i + 1)), status: 'compressed', reason: "majburiy: qolgan vaqtga siqildi (≥20 daq oraliq)" }));
  }
  return rows.sort((a, z) => (a.send_at ? Date.parse(a.send_at) : Infinity) - (z.send_at ? Date.parse(z.send_at) : Infinity));
});

// media
on('POST', '/admin/media', (c) => {
  const form = c.body as FormData;
  const f = form.get('file') as File;
  const kind: MediaInfo['kind'] = f.type.startsWith('image/') ? 'photo' : f.type.startsWith('video/') ? (/note|doira|circle/i.test(f.name) ? 'video_note' : 'video') : f.type === 'audio/ogg' ? 'voice' : f.type.startsWith('audio/') ? 'audio' : 'document';
  const warnings: string[] = [];
  if (f.size > 50 * 1024 * 1024) warnings.push('Fayl 50 MB dan katta — bot orqali yuborib bo\'lmaydi.');
  if (kind === 'photo' && f.size > 10 * 1024 * 1024) warnings.push('Rasm 10 MB dan katta.');
  if (kind === 'video_note') warnings.push("Demo: video-doira kvadrat va ≤ 60 soniya ekanini server tekshiradi.");
  return { id: nextId(), kind, filename: f.name, size: f.size, url: URL.createObjectURL(f), warnings } satisfies MediaInfo;
});

on('GET', '/admin/media/:id', (c) => ({ id: n(c.m[1]), kind: 'photo', filename: `media-${c.m[1]}.jpg`, size: 120_000, url: '', warnings: [] }) satisfies MediaInfo);

// comments
on('GET', '/admin/funnels/:id/comments', (c) => comments.filter((x) => x.funnel_id === n(c.m[1]) && x.day === n(c.q.day ?? '1')));
on('POST', '/admin/funnels/:id/comments', (c) => {
  const row = { ...b<CommentRow>(c), id: nextId(), funnel_id: n(c.m[1]) };
  comments.push(row);
  return row;
});
on('DELETE', '/admin/comments/:id', (c) => {
  const i = comments.findIndex((x) => x.id === n(c.m[1]));
  if (i >= 0) comments.splice(i, 1);
  return undefined;
});
on('POST', '/admin/funnels/:id/comments/import', async (c) => {
  const form = c.body as FormData;
  const text = await (form.get('file') as File).text();
  const day = n(String(form.get('day') ?? '1')) as 1 | 2;
  let imported = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+):(\d{1,2})\s*,\s*([^,]+?)\s*,\s*(.+)$/.exec(line);
    if (!m) continue;
    comments.push({ id: nextId(), funnel_id: n(c.m[1]), day, t: n(m[1]) * 60 + n(m[2]), author: m[3], text: m[4].replace(/^"|"$/g, '') });
    imported++;
  }
  if (!imported) throw new ApiError(422, "CSV dan birorta qator o'qilmadi. Format: timecode,ism,matn");
  return { imported };
});

// leads
function filterLeads(q: Record<string, string>): LeadState[] {
  const fid = n(q.funnel_id ?? '1');
  const s = (q.q ?? '').toLowerCase();
  const digits = s.replace(/\D/g, '');
  return leads
    .filter((l) => l.funnel_id === fid)
    .filter((l) => !q.list || callListMatch(l, q.list as CallListKey))
    .filter((l) => !q.step || l.step === q.step)
    .filter((l) => !q.source || l.source.includes(q.source))
    .filter((l) => !q.manager_id || l.manager?.id === n(q.manager_id))
    .filter((l) => !q.date_from || dayKey(l.created_at) >= q.date_from)
    .filter((l) => !q.date_to || dayKey(l.created_at) <= q.date_to)
    .filter((l) => !s || l.name.toLowerCase().includes(s) || (l.username ?? '').includes(s) || (digits.length >= 3 && (l.phone ?? '').replace(/\D/g, '').includes(digits)))
    .sort((a, z) => Date.parse(z.step_since) - Date.parse(a.step_since));
}
const row = (l: LeadState): LeadRow => {
  const { funnel_id: _f, extra: _e, ...r } = l;
  void _f; void _e;
  return r;
};
on('GET', '/admin/call-lists', (c) => {
  const fid = n(c.q.funnel_id ?? '1');
  const list = leads.filter((l) => l.funnel_id === fid);
  return CALL_KEYS.map<CallList>((key) => ({ key, label: CALL_LIST_FALLBACK[key], count: list.filter((l) => callListMatch(l, key)).length }));
});
on('GET', '/admin/leads', (c) => {
  need(c, 'super_admin', 'sales');
  const all = filterLeads(c.q);
  const page = Math.max(1, n(c.q.page ?? '1')), size = n(c.q.page_size ?? '50');
  return { items: all.slice((page - 1) * size, page * size).map(row), total: all.length };
});

function leadById(id: number): LeadState {
  return leads.find((l) => l.id === id) ?? notFound();
}
function ensureExtra(l: LeadState): NonNullable<LeadState['extra']> {
  if (l.extra) return l.extra;
  const reg = Date.parse(l.created_at);
  const s = settings[l.funnel_id];
  const ev: LeadEvent[] = [];
  const push = (at: number, type: string, title: string, details = '') => ev.push({ at: iso(at), type, title, details });
  push(reg, 'start', '/start', `manba: ${l.source}`);
  const sessions: LeadCard['sessions'] = [];
  let day1 = 0;
  if (l.phone) push(reg + M, 'phone', 'Telefon berdi', l.phone);
  if (atLeast(l.step, 'session') || l.step === 'cold') {
    day1 = slotOptions(reg + 2 * M, s)[0] ?? reg + 6 * H;
    if (l.id === 1001) day1 = todayAt(20, 0, -2);
    sessions.push({ id: l.id * 10, day1_at: iso(day1), day2_at: iso(day1 + D), status: day1 + D + s.day2_duration_sec * 1000 < NOW ? 'completed' : 'active' });
    push(reg + 2 * M, 'session', 'Sessiya tanladi', `1-kun: ${new Date(day1).toISOString().slice(0, 10)} · 2-kun birga`);
    push(day1 - 2 * H, 'bot_message', 'Bot: «Efirgacha 2 soat»', 'yetkazildi');
  }
  const d1min = Math.round(s.day1_duration_sec / 60), d2min = Math.round(s.day2_duration_sec / 60), offerMin = Math.round(s.day2_offer_sec / 60);
  if (l.day1_minutes !== null && day1) {
    push(day1 + 2 * M, 'day1_enter', '1-kunga kirdi', '2 daqiqa kech');
    const ok = l.day1_minutes / d1min >= 0.75;
    if (!ok) push(day1 + l.day1_minutes * M, 'left_live', 'Efirdan chiqib ketdi', `1-kun, ${l.day1_minutes}-daqiqada`);
    push(day1 + d1min * M, ok ? 'day1_watched' : 'day1_left', '1-kun tugadi', `${l.day1_minutes} / ${d1min} daqiqa ko'rdi — ${ok ? "2-kunga taklif oldi" : "75% dan kam"}`);
  } else if (l.step === 'day1_missed' && day1) {
    push(day1 + d1min * M, 'day1_missed', "1-kunni ko'rmadi", "Qayta vaqt tanlash xabari yuborildi");
  }
  if (l.day2_minutes !== null && day1) {
    push(day1 + D, 'day2_enter', '2-kunga kirdi', "o'z vaqtida");
    push(day1 + D + l.day2_minutes * M, l.reached_offer ? 'offer_reached' : 'day2_left', l.reached_offer ? 'Oferta momentiga yetdi' : '2-kundan chiqdi', `${l.day2_minutes} daqiqa ko'rdi${l.reached_offer ? '' : ` — ofertagacha ${offerMin - l.day2_minutes} daqiqa qolgan`}`);
    if (!l.reached_offer) push(day1 + D + d2min * M + 30 * M, 'bot_message', 'Bot: «Ofertagacha chiqib ketganlar»', 'Ofertagacha chiqib ketganlar uchun');
  }
  if (l.clicked_buy && day1) push(day1 + D + 60 * M, 'click_buy', '«Kursga yozilish» bosdi', 'Standart');
  for (const p of payments.filter((x) => x.lead_id === l.id)) {
    push(Date.parse(p.submitted_at), 'receipt', 'Chek yubordi', `${p.tariff} · ${money(p.amount)}`);
    if (p.decided_at) push(Date.parse(p.decided_at), p.status === 'approved' ? 'payment_approved' : 'receipt_rejected', p.status === 'approved' ? "To'lov tasdiqlandi" : 'Chek rad etildi', p.status === 'approved' ? `${p.decided_by}` : p.reject_reason ?? '');
  }
  const contacts: LeadCard['contacts'] = [];
  if (l.last_contact_at && l.manager) {
    contacts.push({ at: l.last_contact_at, manager: l.manager.name, result: 'callback', callback_at: iso(Date.parse(l.last_contact_at) + D), note: 'Kechqurun qulay ekan' });
    push(Date.parse(l.last_contact_at), 'manager_note', `Menejer izohi — ${l.manager.name}`, "Qayta qo'ng'iroq: kechqurun qulay ekan");
  }
  const messages = (chain[l.funnel_id] ?? []).filter((m) => m.status === 'active' && m.trigger_type !== 'stuck' && m.trigger_type !== 'on_button').slice(0, ev.length + 2)
    .map((m, i) => ({ at: iso(Math.min(NOW - M, reg + (i + 1) * 45 * M)), title: m.title, status: l.blocked && i > 3 ? 'xato: bloklagan' : 'yetkazildi' }));
  const deadline = day1 && atLeast(l.step, 'left_before_offer') ? day1 + D + s.day2_duration_sec * 1000 + s.deadline_hours * H : null;
  l.extra = {
    sessions, events: ev.filter((e) => Date.parse(e.at) <= NOW).sort((a, z) => Date.parse(z.at) - Date.parse(a.at)),
    contacts, messages, deadline_at: deadline ? iso(deadline) : null,
    remaining_amount: l.payment_status === 'deposit' ? 1390000 : null,
    remaining_due_date: l.payment_status === 'deposit' ? dayKey(NOW + 7 * D) : null,
  };
  return l.extra;
}
function money(v: number) {
  return `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}
function addEvent(l: LeadState, type: string, title: string, details = '') {
  ensureExtra(l).events.unshift({ at: iso(Date.now()), type, title, details });
}

on('GET', '/admin/leads/:id', (c) => {
  need(c, 'super_admin', 'sales');
  const l = leadById(n(c.m[1]));
  const ex = ensureExtra(l);
  const s = settings[l.funnel_id];
  const watch: LeadCard['watch'] = [];
  if (l.day1_minutes !== null) watch.push({ day: 1, minutes: l.day1_minutes, duration_min: Math.round(s.day1_duration_sec / 60), percent: Math.round((l.day1_minutes / (s.day1_duration_sec / 60)) * 100), reached_offer: false, offer_min: s.day1_soft_offer_sec ? Math.round(s.day1_soft_offer_sec / 60) : null });
  if (l.day2_minutes !== null) watch.push({ day: 2, minutes: l.day2_minutes, duration_min: Math.round(s.day2_duration_sec / 60), percent: Math.round((l.day2_minutes / (s.day2_duration_sec / 60)) * 100), reached_offer: l.reached_offer, offer_min: Math.round(s.day2_offer_sec / 60) });
  const card: LeadCard = {
    ...row(l), registered_at: l.created_at, ...ex, watch,
    payments: payments.filter((p) => p.lead_id === l.id).map(({ funnel_id: _f, ...p }) => (void _f, p)),
  };
  return card;
});
on('POST', '/admin/leads/:id/contact', (c) => {
  const l = leadById(n(c.m[1]));
  const body = b<{ result: ContactResult; callback_at: string | null; note: string }>(c);
  const label = { no_answer: 'Javob bermadi', callback: "Qayta qo'ng'iroq", sold: 'Sotildi', refused: 'Rad etdi' }[body.result];
  ensureExtra(l).contacts.unshift({ at: iso(Date.now()), manager: c.user.name, result: body.result, callback_at: body.callback_at, note: body.note });
  l.last_contact_at = iso(Date.now());
  addEvent(l, 'manager_note', `Menejer izohi — ${c.user.name}`, [label, body.note].filter(Boolean).join(': '));
  return { ok: true };
});
on('POST', '/admin/leads/:id/assign', (c) => {
  const l = leadById(n(c.m[1]));
  const { manager_id } = b<{ manager_id: number | null }>(c);
  const u = manager_id ? users.find((x) => x.id === manager_id) : null;
  l.manager = u ? { id: u.id, name: u.name.split(' ')[0] } : null;
  addEvent(l, 'manager_assign', u ? `Menejerga biriktirildi: ${u.name}` : 'Menejer biriktirilishi olib tashlandi', c.user.name);
  return { ok: true };
});
on('POST', '/admin/leads/:id/deadline', (c) => {
  const l = leadById(n(c.m[1]));
  ensureExtra(l).deadline_at = b<{ deadline_at: string }>(c).deadline_at;
  addEvent(l, 'deadline', "Deadline qo'lda uzaytirildi", c.user.name);
  return { ok: true };
});
on('POST', '/admin/leads/:id/payment-plan', (c) => {
  const l = leadById(n(c.m[1]));
  Object.assign(ensureExtra(l), b<object>(c));
  return { ok: true };
});
on('POST', '/admin/leads/:id/send-invite', (c) => {
  const l = leadById(n(c.m[1]));
  if (l.blocked) throw new ApiError(409, "Lid botni bloklagan — havola yuborib bo'lmaydi");
  addEvent(l, 'invite', 'Kanalga havola yuborildi', c.user.name);
  return { ok: true };
});
on('POST', '/admin/leads/:id/receipt', (c) => {
  const l = leadById(n(c.m[1]));
  const form = c.body as FormData;
  const f = form.get('file') as File;
  const tid = n(String(form.get('tariff_id')));
  const t = Object.values(tariffs).flat().find((x) => x.id === tid);
  const p: PaymentRow & { funnel_id: number } = {
    id: nextId(), funnel_id: l.funnel_id, lead_id: l.id, lead_name: l.name, lead_phone: l.phone, tariff: t?.name ?? '—',
    method: String(form.get('method')) as PaymentMethod, kind: String(form.get('kind')) as PaymentKind, amount: n(String(form.get('amount'))),
    status: 'pending', reject_reason: null, submitted_at: iso(Date.now()), decided_at: null, decided_by: null,
    within_deadline: true, duplicate_of: null, refunded: false, file_url: URL.createObjectURL(f), file_mime: f.type || 'image/png',
  };
  payments.push(p);
  l.receipt = 'pending';
  addEvent(l, 'receipt', `Chek yuklandi (menejer: ${c.user.name})`, `${p.tariff} · ${money(p.amount)}`);
  return p;
});
on('POST', '/admin/leads/message', (c) => {
  const { lead_ids } = b<{ lead_ids: number[] }>(c);
  const ok = lead_ids.map((id) => leads.find((l) => l.id === id)).filter((l): l is LeadState => !!l && !l.blocked && !l.unsubscribed);
  ok.forEach((l) => addEvent(l, 'bot_message', 'Bot: menejer xabari', c.user.name));
  return { queued: ok.length };
});

// payments
const payRow = ({ funnel_id: _f, ...p }: PaymentRow & { funnel_id: number }): PaymentRow => (void _f, p);
on('GET', '/admin/payments', (c) => {
  need(c, 'super_admin', 'sales');
  const fid = n(c.q.funnel_id ?? '1');
  const st = c.q.status ?? 'pending';
  return payments.filter((p) => p.funnel_id === fid && (st === 'all' || p.status === st)).map(payRow);
});
function decide(c: Ctx, status: 'approved' | 'rejected', reason: string | null) {
  need(c, 'super_admin', 'sales');
  const p = payments.find((x) => x.id === n(c.m[1])) ?? notFound();
  if (p.status !== 'pending') throw new ApiError(409, `Bu chek allaqachon ${p.status === 'approved' ? 'tasdiqlangan' : 'rad etilgan'} (${p.decided_by})`);
  Object.assign(p, { status, reject_reason: reason, decided_at: iso(Date.now()), decided_by: c.user.name });
  const l = leads.find((x) => x.id === p.lead_id);
  if (l) {
    if (status === 'approved') {
      l.receipt = 'approved';
      if (p.kind === 'deposit') { l.payment_status = 'deposit'; l.step = 'deposit_paid'; } else { l.payment_status = 'full'; l.step = 'full_paid'; }
    } else {
      l.receipt = 'rejected';
      l.step = 'receipt_rejected';
    }
    l.step_label = stepOrderLabel(l.step);
    l.step_since = iso(Date.now());
    addEvent(l, status === 'approved' ? 'payment_approved' : 'receipt_rejected', status === 'approved' ? "To'lov tasdiqlandi" : 'Chek rad etildi', status === 'approved' ? c.user.name : reason ?? '');
  }
  audited(c, `payment.${status === 'approved' ? 'approve' : 'reject'}`, `Chek #${p.id} (${money(p.amount)})${reason ? `: ${reason}` : ''}`);
  return payRow(p);
}
on('POST', '/admin/payments/:id/approve', (c) => decide(c, 'approved', null));
on('POST', '/admin/payments/:id/reject', (c) => decide(c, 'rejected', b<{ reason: string }>(c).reason));
on('POST', '/admin/payments/:id/refund', (c) => {
  need(c, 'super_admin', 'sales');
  const p = payments.find((x) => x.id === n(c.m[1])) ?? notFound();
  p.refunded = true;
  audited(c, 'payment.refund', `Chek #${p.id}`);
  return payRow(p);
});

// questions
on('GET', '/admin/questions', (c) => {
  const fid = n(c.q.funnel_id ?? '1');
  const answered = c.q.answered === 'true';
  return questions.filter((q) => q.funnel_id === fid && (q.answer !== null) === answered).map(({ funnel_id: _f, ...q }) => (void _f, q));
});
on('POST', '/admin/questions/:id/answer', (c) => {
  const q = questions.find((x) => x.id === n(c.m[1])) ?? notFound();
  q.answer = b<{ text: string }>(c).text;
  q.answered_at = iso(Date.now());
  return { ok: true };
});

// efir chati — barcha rollar; kontent menejerga telefon ko'rinmaydi
const chatOut = (r: ChatRow & { funnel_id: number }, u: AdminUser): ChatRow => {
  const { funnel_id: _f, ...row } = r;
  void _f;
  return { ...row, lead_phone: u.role === 'content' ? null : row.lead_phone };
};
on('GET', '/admin/chat', (c) => {
  const fid = n(c.q.funnel_id ?? '1');
  return chat
    .filter((r) => r.funnel_id === fid)
    .filter((r) => !c.q.day || r.day === n(c.q.day))
    .filter((r) => c.q.status !== 'unanswered' || r.answer === null)
    .filter((r) => !c.q.date || dayKey(r.created_at) === c.q.date)
    .sort((a, z) => Date.parse(z.created_at) - Date.parse(a.created_at))
    .map((r) => chatOut(r, c.user));
});
on('GET', '/admin/chat/sessions', (c) => {
  const fid = n(c.q.funnel_id ?? '1');
  const map = new Map<string, ChatSession>();
  for (const r of chat) {
    if (r.funnel_id !== fid || !r.day || !r.session_at) continue;
    const k = `${r.day}|${r.session_at}`;
    const cur = map.get(k) ?? { day: r.day, at: r.session_at, count: 0, unanswered: 0 };
    cur.count++;
    if (r.answer === null) cur.unanswered++;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, z) => Date.parse(z.at) - Date.parse(a.at));
});
on('POST', '/admin/chat/:id/reply', (c) => {
  const r = chat.find((x) => x.id === n(c.m[1]));
  const text = (b<{ text: string }>(c).text ?? '').trim();
  if (!r || !text) throw new ApiError(400, 'Javob matnini yozing');
  const lead = leads.find((l) => l.id === r.lead_id);
  if (lead?.blocked) throw new ApiError(400, "Lidga yuborib bo'lmadi (botni bloklagan bo'lishi mumkin)");
  Object.assign(r, { answer: text, answered_at: iso(Date.now()), answered_by: c.user.name });
  return chatOut(r, c.user);
});

// broadcasts
on('GET', '/admin/funnels/:id/broadcasts', (c) => broadcasts.filter((x) => x.funnel_id === n(c.m[1])).map(({ funnel_id: _f, ...x }) => (void _f, x)));
on('POST', '/admin/funnels/:id/broadcasts', (c) => {
  need(c, 'super_admin', 'content');
  const body = b<Omit<Broadcast, 'id' | 'status' | 'recipients' | 'created_at'>>(c);
  const fid = n(c.m[1]);
  const count = leads.filter((l) => l.funnel_id === fid && !l.blocked && !l.unsubscribed).length;
  const bc = { ...body, id: nextId(), funnel_id: fid, status: body.send_at ? 'scheduled' : 'sending', recipients: body.send_at ? 0 : Math.round(count * 0.6), created_at: iso(Date.now()) } as Broadcast & { funnel_id: number };
  broadcasts.unshift(bc);
  const { funnel_id: _f, ...out } = bc;
  void _f;
  return out;
});
on('POST', '/admin/broadcasts/test', (c) => {
  if (!c.user.tg_user_id) throw new ApiError(400, "Profilingizda Telegram ID yo'q");
  return { ok: true };
});

// dashboard
on('GET', '/admin/dashboard', (c) => {
  const fid = n(c.q.funnel_id ?? '1');
  const k = c.q.period === '30d' ? 3.6 : c.q.period === '7d' ? 1 : 0.16;
  const sc = (v: number) => Math.round(v * k * (fid === 1 ? 1 : 0.2));
  const raw: [string, number][] = [
    ['Start', 412], ['Telefon berdi', 318], ['Sessiya tanladi', 271], ["1-kunni ko'rdi", 142], ['2-kun, ofertagacha', 97],
    ['Tugma bosdi', 41], ['Chek yubordi', 19], ["Boshlang'ich to'lov", 6], ["To'liq to'lov", 9],
  ];
  const funnel = raw.map(([label, v], i) => {
    const nn = sc(v);
    const prev = i > 0 ? sc(raw[i - 1][1]) : 0;
    return { label, n: nn, rate: i === 0 || i >= 7 || !prev ? null : nn / prev };
  });
  const s = settings[fid];
  const upcoming = slotOptions(Date.now() - 10 * M, { ...s, min_hours_before: 0, options_count: 3 }).map((t, i) => ({ at: iso(t), day1_count: [64, 41, 37][i] ?? 20, day2_count: [38, 22, 30][i] ?? 15 }));
  const spend = (adSpend[fid] ?? []).reduce((a, r) => a + r.amount, 0);
  const full = sc(9);
  const res: DashboardResponse = {
    kpis: { start: sc(412), phone: sc(318), day1_watched: sc(142), full_paid: full, deposit_paid: sc(6), cost_per_sale: spend && full ? Math.round((spend * k) / full) : null },
    funnel, upcoming,
    pending_receipts: payments.filter((p) => p.funnel_id === fid && p.status === 'pending').length,
    unanswered_questions: questions.filter((q) => q.funnel_id === fid && q.answer === null).length,
    unanswered_chat: chat.filter((r) => r.funnel_id === fid && r.answer === null).length,
    failed_messages: failed.length,
  };
  return res;
});

// stats
function curve(duration: number, seed: number, dips: [number, number][]): { minute: number; share: number }[] {
  const r = rng(seed);
  const pts: { minute: number; share: number }[] = [];
  let share = 1;
  for (let m = 0; m <= duration; m += 2) {
    if (m > 0) {
      let drop = 0.004 + r() * 0.004;
      for (const [a, z] of dips) if (m > a && m <= z) drop += 0.012;
      share = Math.max(0.05, share - drop);
    }
    pts.push({ minute: m, share: Math.round(share * 1000) / 1000 });
  }
  return pts;
}
on('GET', '/admin/stats', (c) => {
  const fid = n(c.q.funnel_id ?? '1');
  const s = settings[fid];
  const f = [c.q.source, c.q.slot, c.q.weekday, c.q.method, c.q.manager_id].filter(Boolean).length;
  const k = Math.max(0.25, 1 - f * 0.22);
  const v = (x: number) => Math.round(x * k);
  const spend = (adSpend[fid] ?? []).reduce((a, r) => a + r.amount, 0);
  const metrics: StatsResponse['metrics'] = [
    { key: 'start', label: 'Start', value: v(412), rate: null },
    { key: 'phone', label: "Ro'yxat (telefon)", value: v(318), rate: 0.77 },
    { key: 'session', label: 'Sessiya tanlash', value: v(271), rate: 0.85 },
    { key: 'day1', label: "1-kunni ko'rish (≥75%)", value: v(142), rate: 0.52 },
    { key: 'day2', label: "2-kunni ko'rish (ofertagacha)", value: v(97), rate: 0.68 },
    { key: 'offer', label: 'Oferta momentigacha qolish', value: v(97), rate: 0.81 },
    { key: 'click', label: 'Tugma bosish', value: v(41), rate: 0.42 },
    { key: 'receipt', label: 'Chek yuborish', value: v(19), rate: 0.46 },
    { key: 'deposit', label: "Boshlang'ich to'lov", value: v(6), rate: 0.042 },
    { key: 'full', label: "To'liq to'lov", value: v(9), rate: 0.063 },
    { key: 'reschedule', label: 'Qayta tanlash samarasi', value: v(23), rate: 0.31 },
    { key: 'approve_time', label: "Tasdiq vaqti (o'rtacha)", value: 14, rate: null, display: '14 daq' },
    { key: 'cpl', label: 'Bitta lid narxi', value: spend ? Math.round(spend / v(318)) : null, rate: null, display: spend ? money(Math.round(spend / v(318))) : '—' },
    { key: 'cps', label: 'Bitta sotuv narxi', value: spend ? Math.round(spend / Math.max(1, v(9))) : null, rate: null, display: spend ? money(Math.round(spend / Math.max(1, v(9)))) : '—' },
    { key: 'romi', label: 'ROMI', value: spend ? (v(9) * 1490000 + v(6) * 100000 - spend) / spend : null, rate: null, display: spend ? `${Math.round(((v(9) * 1490000 + v(6) * 100000 - spend) / spend) * 100)}%` : '—' },
  ];
  const lr = liveResults[fid];
  return {
    metrics,
    retention: [
      { day: 1, duration_min: Math.round(s.day1_duration_sec / 60), offer_min: s.day1_soft_offer_sec ? Math.round(s.day1_soft_offer_sec / 60) : null, points: curve(Math.round(s.day1_duration_sec / 60), 11 + f, [[0, 6], [35, 40]]) },
      { day: 2, duration_min: Math.round(s.day2_duration_sec / 60), offer_min: Math.round(s.day2_offer_sec / 60), points: curve(Math.round(s.day2_duration_sec / 60), 22 + f, [[20, 25], [78, 84]]) },
    ],
    messages: (chain[fid] ?? []).filter((m) => m.stats).map((m) => ({ id: m.id, title: m.title, sent: v(m.stats!.sent), clicks: v(m.stats!.clicks), blocked_after: m.stats!.blocked_after })),
    steps: [
      { step: 'no_phone', label: "/start bosdi, telefon bermadi", stuck: v(94), returned_by_bot: v(31), returned_by_call: 0 },
      { step: 'no_session', label: 'Telefon berdi, sessiya tanlamadi', stuck: v(47), returned_by_bot: v(18), returned_by_call: v(6) },
      { step: 'day1_missed', label: "1-kunni ko'rmadi", stuck: v(76), returned_by_bot: v(23), returned_by_call: v(4) },
      { step: 'day2_missed', label: "2-kunni ko'rmadi", stuck: v(45), returned_by_bot: v(12), returned_by_call: v(5) },
      { step: 'left_before_offer', label: 'Ofertagacha chiqib ketdi', stuck: v(31), returned_by_bot: v(4), returned_by_call: v(3) },
      { step: 'no_receipt', label: 'Tugma bosdi, chek yubormadi', stuck: v(22), returned_by_bot: v(7), returned_by_call: v(5) },
      { step: 'receipt_rejected', label: 'Chek rad etildi', stuck: v(2), returned_by_bot: v(1), returned_by_call: v(1) },
    ],
    live_compare: [
      { label: "1-kunni ko'rish", auto: 0.52, live: lr.day1_watch_rate },
      { label: "To'liq to'lov / ko'rganlar", auto: 0.063, live: lr.paid_rate },
      { label: 'Bitta sotuv narxi', auto: spend ? Math.round(spend / Math.max(1, v(9))) : null, live: lr.cost_per_sale },
    ],
  } satisfies StatsResponse;
});
/**
 * Tomosha statistikasi: har bir efirga kirish uchun (kirgan soniya, eng uzoq yetgan soniya) generatsiya qilinadi,
 * keyin backend (services/stats.watch_curve) bilan bir xil hisoblanadi.
 */
const WATCH_PROFILE: Record<1 | 2, { joined: number; dips: [number, number, number][] }> = {
  // [daqiqadan, daqiqagacha, qo'shimcha chiqish ehtimoli / daqiqa]
  1: { joined: 186, dips: [[0, 5, 0.012], [35, 40, 0.026], [60, 65, 0.011], [110, 114, 0.01]] },
  2: { joined: 121, dips: [[20, 25, 0.022], [78, 83, 0.05]] },
};
function watchRows(fid: number, day: 1 | 2, q: Record<string, string>): [number, number][] {
  if (fid !== 1) return [];
  const s = settings[fid];
  const dur = day === 1 ? s.day1_duration_sec : s.day2_duration_sec;
  let k = 1;
  if (q.source) k *= 0.42;
  if (q.slot) k *= q.slot === '20:00' ? 0.62 : 0.38;
  if (q.date_from || q.date_to) {
    const from = q.date_from ? Date.parse(q.date_from) : NOW - 60 * D;
    const to = q.date_to ? Date.parse(q.date_to) + D : NOW;
    k *= Math.max(0, Math.min(1, (to - from) / (24 * D)));
  }
  const prof = WATCH_PROFILE[day];
  const total = Math.round(prof.joined * k);
  const r = rng(fid * 1000 + day * 100 + total);
  const rows: [number, number][] = [];
  for (let i = 0; i < total; i++) {
    const join = r() < 0.93 ? 0 : Math.round(30 + r() * 270); // ozchilik birinchi 5 daqiqada kech kiradi
    let mx = dur;
    for (let m = Math.floor(join / 60); m < dur / 60; m++) {
      let hazard = 0.0042;
      for (const [a, z, extra] of prof.dips) if (m >= a && m < z) hazard += extra;
      if (r() < hazard) {
        mx = Math.min(dur, Math.max(join + 10, m * 60 + Math.floor(r() * 60)));
        break;
      }
    }
    rows.push([join, mx]);
  }
  return rows;
}
on('GET', '/admin/funnels/:id/watch-stats', (c) => {
  const fid = n(c.m[1]);
  const s = settings[fid] ?? notFound();
  const day: 1 | 2 = c.q.day === '2' ? 2 : 1;
  const step = Math.max(1, Math.min(30, n(c.q.step ?? '5') || 5));
  const dur = day === 1 ? s.day1_duration_sec : s.day2_duration_sec;
  const offer = day === 1 ? s.day1_soft_offer_sec : s.day2_offer_sec;
  const rows = watchRows(fid, day, c.q);
  const joined = rows.length;
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const buckets: WatchBucket[] = [];
  let prev: number | null = null;
  for (let m = 0; m <= Math.floor(dur / 60); m += step) {
    const viewers = rows.filter(([j, mx]) => j <= m * 60 && m * 60 <= mx).length;
    const share = joined ? r4(viewers / joined) : 0;
    const left = m ? rows.filter(([j, mx]) => j <= (m - step) * 60 && (m - step) * 60 <= mx && mx < m * 60).length : 0;
    buckets.push({ minute: m, viewers, share, drop: prev !== null ? r4(prev - share) : 0, left });
    prev = share;
  }
  const top = buckets.slice(1).filter((x) => x.left > 0).sort((a, z) => z.left - a.left).slice(0, 3);
  const res: WatchStats = {
    day, step, duration_min: Math.floor(dur / 60), offer_min: offer ? Math.floor(offer / 60) : null,
    joined,
    avg_watch_min: joined ? Math.round(rows.reduce((a, [j, mx]) => a + Math.max(mx - j, 0), 0) / joined / 60) : 0,
    full: rows.filter(([, mx]) => dur && mx >= 0.95 * dur).length,
    buckets,
    top_drops: top.map((x) => ({ from_minute: x.minute - step, to_minute: x.minute, left: x.left })),
  };
  return res;
});
on('GET', '/admin/funnels/:id/ad-spend', (c) => adSpend[n(c.m[1])] ?? []);
on('POST', '/admin/funnels/:id/ad-spend', (c) => {
  const r = { ...b<AdSpendRow>(c), id: nextId() };
  (adSpend[n(c.m[1])] ??= []).push(r);
  return r;
});
on('GET', '/admin/funnels/:id/live-results', (c) => liveResults[n(c.m[1])] ?? { day1_watch_rate: null, paid_rate: null, cost_per_sale: null });
on('PUT', '/admin/funnels/:id/live-results', (c) => (liveResults[n(c.m[1])] = b<LiveResults>(c)));

// settings
on('GET', '/admin/settings', (c) => (need(c, 'super_admin'), globalSettings));
on('PUT', '/admin/settings', (c) => {
  need(c, 'super_admin');
  globalSettings = b<GlobalSettings>(c);
  audited(c, 'settings.update', `admin guruhi: ${globalSettings.admin_group_chat_id ?? '—'}`);
  return globalSettings;
});
on('GET', '/admin/audit', (c) => (need(c, 'super_admin'), audit));
on('GET', '/admin/failed-messages', () => failed);

// ───────────── kirish nuqtalari ─────────────
function normalizePath(path: string): string {
  const p = path.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  return p.startsWith('/api/') ? p.slice(4) : p;
}

export async function mockRequest(method: string, path: string, query: Record<string, string>, body: unknown): Promise<unknown> {
  await sleep(120 + Math.random() * 220);
  const p = normalizePath(path);
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(p);
    if (!m) continue;
    const user = currentUser();
    if (!r.open && !user) throw new ApiError(401, 'Sessiya tugadi, qayta kiring');
    const res = await r.h({ m, q: query, body, user: user ?? publicUser(users[0]) });
    // eslint-disable-next-line no-console
    console.debug('[mock]', method, p, query, res);
    return clone(res);
  }
  throw new ApiError(404, `Demo: ${method} ${p} — mock yo'q`);
}

function receiptSvg(p: PaymentRow): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="560" viewBox="0 0 360 560">
<rect width="360" height="560" fill="#fff"/><rect x="0" y="0" width="360" height="70" fill="${p.method === 'payme' ? '#00B4C8' : p.method === 'click' ? '#0068FF' : '#1C1B18'}"/>
<text x="24" y="44" font-family="Arial" font-size="22" font-weight="700" fill="#fff">${p.method === 'card' ? "O'tkazma cheki" : p.method.toUpperCase()}</text>
<text x="24" y="120" font-family="Arial" font-size="14" fill="#6B665C">Summa</text>
<text x="24" y="152" font-family="Arial" font-size="30" font-weight="700" fill="#1C1B18">${money(p.amount)}</text>
<text x="24" y="210" font-family="Arial" font-size="14" fill="#6B665C">Qabul qiluvchi</text><text x="24" y="234" font-family="Arial" font-size="16" fill="#1C1B18">8600 **** **** 9012</text>
<text x="24" y="280" font-family="Arial" font-size="14" fill="#6B665C">Yuboruvchi</text><text x="24" y="304" font-family="Arial" font-size="16" fill="#1C1B18">${p.lead_name}</text>
<text x="24" y="350" font-family="Arial" font-size="14" fill="#6B665C">Sana</text><text x="24" y="374" font-family="Arial" font-size="16" fill="#1C1B18">${new Date(p.submitted_at).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}</text>
<text x="24" y="420" font-family="Arial" font-size="14" fill="#6B665C">Holat</text><text x="24" y="444" font-family="Arial" font-size="16" font-weight="700" fill="#23703F">Muvaffaqiyatli</text>
<text x="180" y="530" text-anchor="middle" font-family="Arial" font-size="12" fill="#B8B2A5">demo chek #${p.id}</text></svg>`;
}
const MINI_PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 40 100 Td (Demo chek PDF) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';

export async function mockBlob(path: string, query: Record<string, string>): Promise<Blob> {
  await sleep(200 + Math.random() * 300);
  if (!currentUser()) throw new ApiError(401, 'Sessiya tugadi, qayta kiring');
  if (path.startsWith('blob:')) return (await fetch(path)).blob();
  const p = normalizePath(path);
  const pm = /^\/admin\/payments\/(\d+)\/file$/.exec(p);
  if (pm) {
    const pay = payments.find((x) => x.id === Number(pm[1])) ?? notFound();
    if (/pdf/.test(pay.file_mime)) return new Blob([MINI_PDF], { type: 'application/pdf' });
    return new Blob([receiptSvg(pay)], { type: 'image/svg+xml' });
  }
  if (p === '/admin/leads/export.xlsx') {
    const rows = filterLeads(query);
    const csv = ['Ism,Telefon,Manba,1-kun,2-kun,Qadam,Menejer', ...rows.map((l) => [l.name, l.phone ?? '', l.source, l.day1_minutes ?? '', l.day2_minutes ?? '', l.step_label, l.manager?.name ?? ''].join(','))].join('\n');
    return new Blob(['﻿' + csv], { type: 'text/csv' });
  }
  if (p === '/admin/stats/export.xlsx') return new Blob(['﻿Demo statistika eksporti (mock)'], { type: 'text/csv' });
  throw new ApiError(404, `Demo: fayl ${p} yo'q`);
}
