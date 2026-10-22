/**
 * Avtowebinar — backend API shartnomasi (contract).
 *
 * Backend (FastAPI) aynan shu shakllarni qaytaradi. Mini App va admin panel
 * shu turlarni o'z `src/api/types.ts` fayliga ko'chirib ishlatadi.
 *
 * Umumiy qoidalar:
 * - Barcha vaqtlar ISO-8601 UTC satr ("2026-10-23T15:00:00Z"). Ekranda
 *   Asia/Tashkent (UTC+5) da ko'rsatiladi.
 * - Pul — butun son, so'mda (integer). Ko'rsatishda "1 990 000 so'm".
 * - Xato javobi: HTTP 4xx/5xx + { "detail": string }.
 * - Prefiks: /api. Dev rejimda Vite proxy /api -> http://localhost:8000.
 */

// ───────────────────────────── MINI APP ─────────────────────────────
// Auth: har bir so'rovda `Authorization: tma <Telegram.WebApp.initData>`.

export type MiniState =
  | 'no_session' // lid sessiya tanlamagan
  | 'waiting'    // 1-kungacha
  | 'live'       // efir (1-kun yoki 2-kun) — video o'ynaydi
  | 'between'    // 1-kun tugadi (≥75% ko'rdi), 2-kungacha
  | 'missed'     // kunni ko'rmadi — qayta vaqt tanlash
  | 'closed'     // kech kirish chegarasi (L) o'tdi, kirmagan
  | 'ended';     // 2-kun tugadi — sotuv bloki + deadline

export interface Tariff {
  id: number;
  name: string;            // "Standart"
  description: string;     // "Darslar + uy vazifasi tekshiruvi"
  special_price: number;   // maxsus narx
  regular_price: number;   // oddiy narx
  price_now: number;       // hozir amal qiladigan narx (deadline'ga qarab)
  deposit_amount: number | null; // boshlang'ich to'lov (yoqilgan bo'lsa)
}

export interface Offer {
  course_title: string;        // "Arab tili: 3 oylik kurs"
  tariffs: Tariff[];
  bonuses: string[];
  deadline_at: string | null;  // lidning shaxsiy deadline'i
  special_active: boolean;     // maxsus narx hali amal qiladimi
  closed: boolean;             // deadline tugagan va taklif yopilgan
  /** live holatda: video shu soniyaga yetganda sotuv bloki chiqadi. null = bu kunda taklif yo'q */
  visible_from_sec: number | null;
  soft: boolean;               // 1-kundagi yumshoq taklif
}

export interface FunnelBrand {
  course_title: string;      // "Arab tili kursi"
  webinar_title: string;     // "Bepul webinar · 2 kun"
  topic: string;             // efir mavzusi
  speaker_name: string;
  speaker_title: string;
  speaker_photo_url: string | null;
  logo_url: string | null;
  theme: { primary: string; background: string; bg_image_url: string | null };
  late_entry_minutes: number; // L
}

export interface LiveComment { t: number; author: string; text: string } // t — videodagi soniya

export interface AppStateResponse {
  server_time: string;
  lead: { first_name: string };
  funnel: FunnelBrand;
  state: MiniState;
  session: {
    id: number;
    day1_at: string;
    day2_at: string;
    can_change: boolean;       // 1-kungacha ≥ N soat qolgan bo'lsa
  } | null;
  /** state === 'live' */
  live: {
    day: 1 | 2;
    start_at: string;          // shu kun efirining boshlanish vaqti
    duration_sec: number;
    hls_url: string;           // imzolangan, vaqtinchalik HLS havola
    comments: LiveComment[];   // "Asl efir ishtirokchilarining izohlari"
  } | null;
  /** state === 'between' */
  between: { day1_percent: number; day2_at: string; summary: string[] } | null;
  /** state === 'missed' | 'closed' */
  missed: { day: 1 | 2; started_at: string | null; reschedules_left: number } | null;
  /** state === 'live' (visible_from_sec bilan) yoki 'ended' */
  offer: Offer | null;
}

// POST /api/app/heartbeat  body: HeartbeatRequest  -> { ok: true, server_time }
export interface HeartbeatRequest { session_id: number; day: 1 | 2; position_sec: number }

// POST /api/app/question   body: { text: string }   -> { ok: true }
// POST /api/app/offer-click body: { tariff_id: number | null } -> { ok: true }
//   Bot lidga tarif/to'lov xabarini yuboradi; Mini App keyin Telegram.WebApp.close() qiladi.
// POST /api/app/reschedule  body: {}  -> { ok: true }
//   Bot lidga vaqt tanlash tugmalarini yuboradi; Mini App yopiladi.

// ───────────────────────────── ADMIN ─────────────────────────────
// Auth: `Authorization: Bearer <token>`. 401 -> login sahifasiga.

export type Role = 'super_admin' | 'content' | 'sales';

export interface AdminUser { id: number; name: string; login: string; role: Role; tg_user_id: number | null; active: boolean }

// POST /api/admin/auth/login {login, password} -> { token: string, user: AdminUser }
// GET  /api/admin/me -> AdminUser
// GET/POST /api/admin/users, PUT /api/admin/users/{id}   (super_admin)  body: Partial<AdminUser> & {password?: string}

export interface Funnel { id: number; slug: string; name: string; bot_username: string }
// GET  /api/admin/funnels -> Funnel[]
// POST /api/admin/funnels {slug, name} -> Funnel
// POST /api/admin/funnels/{id}/copy {slug, name} -> Funnel
// GET  /api/admin/funnels/{id}/deeplink?source=ig_reels3 -> { url: string }  // t.me/<bot>?start=<slug>_<source>

export interface FunnelSettings {
  // brand / design
  course_title: string; webinar_title: string; topic: string;
  speaker_name: string; speaker_title: string; speaker_photo_url: string | null;
  logo_url: string | null; theme_primary: string; theme_background: string; bg_image_url: string | null;
  welcome_text: string;            // /start dan keyingi salom ({ism} bilan)
  lead_magnet_media_id: number | null; lead_magnet_caption: string;
  // slots
  slot_times: string[];            // ["14:00","20:00"]
  weekdays: number[];              // 0=dushanba … 6=yakshanba
  excluded_dates: string[];        // ["2026-12-31"]
  min_hours_before: number;        // N
  options_count: number;           // K
  late_entry_minutes: number;      // L
  reschedule_limit: number;        // har bir kun uchun
  day1_watch_threshold: number;    // 0.75
  quiet_start: string; quiet_end: string; // "23:00", "08:00"
  // video
  day1_video_id: string; day1_duration_sec: number; day1_soft_offer_sec: number | null;
  day2_video_id: string; day2_duration_sec: number; day2_offer_sec: number;
  between_summary: string[];
  // sales
  offer_course_title: string; bonuses: string[];
  deadline_hours: number;          // D
  after_deadline: 'regular_price' | 'closed';
  channel_id: number | null;       // yopiq kurs kanali
  // stuck thresholds (minutes)
  stuck_no_phone_min: number; stuck_no_session_min: number; stuck_no_receipt_min: number;
}
// GET/PUT /api/admin/funnels/{id}/settings -> FunnelSettings
//   PUT javobi: FunnelSettings & { warnings: string[] }  (masalan L > 1-kun videosining 25%)

export interface Requisites { card_number: string; card_holder: string; payme_url: string; click_url: string }
// GET/PUT /api/admin/funnels/{id}/requisites -> Requisites   (faqat super_admin; o'zgarish loglanadi)

// GET/POST /api/admin/funnels/{id}/tariffs, PUT/DELETE /api/admin/tariffs/{tid}
export interface TariffAdmin {
  id: number; name: string; description: string; special_price: number; regular_price: number;
  deposit_enabled: boolean; deposit_amount: number; sort: number;
}

// ── Progrev zanjiri ──
export type ChainKind = 'text' | 'photo' | 'video' | 'video_note' | 'voice' | 'audio' | 'document' | 'album';
export type TriggerType =
  | 'after_registration' // ro'yxatdan X keyin
  | 'before_day'         // 1-kun yoki 2-kundan X oldin
  | 'at_day_start'       // kun boshlanishida (+X daqiqa: "sessiya boshidan X keyin")
  | 'after_day_end'      // kun tugaganidan X keyin
  | 'on_button'          // tugma bosilganda
  | 'stuck';             // qadamda X vaqt to'xtab qolganda
export type Segment =
  | 'all' | 'day1_attended' | 'day1_missed' | 'day2_attended' | 'day2_missed'
  | 'reached_offer' | 'left_before_offer' | 'receipt_sent' | 'deposit_paid' | 'full_paid' | 'not_paid';
export type StuckStep = 'no_phone' | 'no_session' | 'no_receipt' | 'receipt_rejected';
export type ButtonType = 'url' | 'webapp' | 'reschedule' | 'pay';
export interface ChainButton { type: ButtonType; text: string; url?: string }

export interface ChainMessage {
  id: number;
  title: string;                 // ichki nom: "Efirgacha 2 soat"
  kind: ChainKind;
  text: string;                  // Telegram HTML (b, i, a, tg-spoiler) + {ism} {efir_sanasi} {efir_vaqti} {deadline}
  media_ids: number[];           // POST /api/admin/media javobidagi id lar
  buttons: ChainButton[][];      // 1–3 qator
  trigger_type: TriggerType;
  trigger_day: 1 | 2 | null;     // before_day / at_day_start / after_day_end uchun
  offset_minutes: number;        // X (daqiqa)
  stuck_step: StuckStep | null;  // trigger_type === 'stuck'
  button_key: string | null;     // trigger_type === 'on_button'
  segment: Segment;
  required: boolean;             // siqish qoidasi uchun
  status: 'active' | 'draft';
  sort: number;
  updated_at: string; updated_by: string | null;
  stats?: { sent: number; clicks: number; blocked_after: number };
  warnings?: string[];           // masalan: matnda "jonli" so'zi bor
}
// GET    /api/admin/funnels/{id}/chain -> ChainMessage[]
// POST   /api/admin/funnels/{id}/chain  body: Omit<ChainMessage,'id'|'updated_at'|'updated_by'|'stats'|'warnings'> -> ChainMessage
// PUT    /api/admin/chain/{mid} body: same -> ChainMessage
// DELETE /api/admin/chain/{mid}
// POST   /api/admin/chain/{mid}/duplicate -> ChainMessage
// POST   /api/admin/chain/{mid}/test -> { ok: true }   // adminning o'z Telegramiga
// GET    /api/admin/chain/{mid}/history -> { at: string; user: string; changes: Record<string, [unknown, unknown]> }[]
// POST   /api/admin/funnels/{id}/chain/simulate { registered_at: string, day1_at: string } -> SimulationRow[]
export interface SimulationRow {
  message_id: number; title: string; trigger: string;
  send_at: string | null;
  status: 'scheduled' | 'compressed' | 'skipped' | 'quiet_shifted' | 'event';
  reason: string | null;   // "vaqt yetmaydi", "tungi tinchlik: 08:00 ga surildi", "segmentga bog'liq"
}

// POST /api/admin/media (multipart: file) -> MediaInfo
export interface MediaInfo { id: number; kind: 'photo' | 'video' | 'video_note' | 'voice' | 'audio' | 'document'; filename: string; size: number; url: string; warnings: string[] }

// ── Izohlar (asl efir) ──
export interface CommentRow { id: number; day: 1 | 2; t: number; author: string; text: string }
// GET /api/admin/funnels/{id}/comments?day=1 -> CommentRow[]
// POST /api/admin/funnels/{id}/comments {day,t,author,text}; DELETE /api/admin/comments/{cid}
// POST /api/admin/funnels/{id}/comments/import (multipart: file CSV "timecode,ism,matn", day) -> { imported: number }

// ── Lidlar ──
export type LeadStep =
  | 'started' | 'phone' | 'session' | 'day1_missed' | 'day1_watched' | 'day2_missed'
  | 'left_before_offer' | 'reached_offer' | 'clicked_buy' | 'receipt_sent' | 'receipt_rejected'
  | 'deposit_paid' | 'full_paid' | 'cold';
export type PaymentStatus = 'none' | 'deposit' | 'full';

export interface LeadRow {
  id: number; name: string; phone: string | null; username: string | null; source: string;
  day1_minutes: number | null;  // null = ko'rmadi / hali yo'q
  day2_minutes: number | null;
  reached_offer: boolean; clicked_buy: boolean; receipt: 'none' | 'pending' | 'approved' | 'rejected';
  payment_status: PaymentStatus;
  manager: { id: number; name: string } | null;
  step: LeadStep; step_label: string; step_since: string;
  last_contact_at: string | null;
  blocked: boolean; unsubscribed: boolean;
  created_at: string;
}
export type CallListKey =
  | 'deposit_paid' | 'full_paid' | 'offer_not_paid' | 'clicked_no_receipt' | 'receipt_rejected'
  | 'no_session' | 'day1_missed' | 'day2_missed' | 'left_before_offer' | 'cold' | 'blocked';
// GET /api/admin/call-lists?funnel_id= -> { key: CallListKey; label: string; count: number }[]
// GET /api/admin/leads?funnel_id&list&step&source&manager_id&q&date_from&date_to&page&page_size
//   -> { items: LeadRow[]; total: number }
// GET /api/admin/leads/export.xlsx?<same filters>  (fayl)

export interface LeadEvent { at: string; type: string; title: string; details: string }
export interface LeadCard extends LeadRow {
  registered_at: string;
  sessions: { id: number; day1_at: string; day2_at: string; status: 'active' | 'replaced' | 'completed' }[];
  watch: { day: 1 | 2; minutes: number; duration_min: number; percent: number; reached_offer: boolean; offer_min: number | null }[];
  deadline_at: string | null;
  remaining_amount: number | null; remaining_due_date: string | null;
  payments: PaymentRow[];
  contacts: { at: string; manager: string; result: ContactResult; callback_at: string | null; note: string }[];
  events: LeadEvent[];            // yangi -> eski
  messages: { at: string; title: string; status: string }[];
}
export type ContactResult = 'no_answer' | 'callback' | 'sold' | 'refused';
// GET  /api/admin/leads/{id} -> LeadCard
// POST /api/admin/leads/{id}/contact {result, callback_at, note}
// POST /api/admin/leads/{id}/assign {manager_id: number | null}
// POST /api/admin/leads/{id}/deadline {deadline_at: string}
// POST /api/admin/leads/{id}/payment-plan {remaining_amount: number|null, remaining_due_date: string|null}
// POST /api/admin/leads/{id}/send-invite
// POST /api/admin/leads/{id}/receipt (multipart: file, tariff_id, kind, method, amount)
// POST /api/admin/leads/message {lead_ids: number[], text: string, buttons: ChainButton[][], media_id: number|null} -> { queued: number }

// ── To'lovlar ──
export type PaymentKind = 'deposit' | 'full' | 'remaining';
export type PaymentMethod = 'card' | 'payme' | 'click';
export interface PaymentRow {
  id: number; lead_id: number; lead_name: string; lead_phone: string | null;
  tariff: string; method: PaymentMethod; kind: PaymentKind; amount: number;
  status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null;
  submitted_at: string; decided_at: string | null; decided_by: string | null;
  within_deadline: boolean; duplicate_of: number | null; refunded: boolean;
  file_url: string;   // GET bilan rasm/PDF (Bearer token bilan fetch qiling)
  file_mime: string;
}
// GET  /api/admin/payments?funnel_id&status=pending|approved|rejected|all -> PaymentRow[]
// POST /api/admin/payments/{id}/approve -> PaymentRow
// POST /api/admin/payments/{id}/reject {reason} -> PaymentRow
// POST /api/admin/payments/{id}/refund -> PaymentRow
export const REJECT_REASONS = ["Summa mos emas", "Chek o'qilmaydi", "To'lov topilmadi", "Boshqa sabab"];

// ── Savollar ──
export interface QuestionRow { id: number; lead_id: number; lead_name: string; text: string; source: 'miniapp' | 'bot'; created_at: string; answer: string | null; answered_at: string | null }
// GET  /api/admin/questions?funnel_id&answered=false -> QuestionRow[]
// POST /api/admin/questions/{id}/answer {text}

// ── Ommaviy xabar ──
export interface Broadcast { id: number; segment: Segment | 'cold'; text: string; buttons: ChainButton[][]; media_id: number | null; send_at: string | null; status: 'scheduled' | 'sending' | 'done'; recipients: number; created_at: string }
// GET  /api/admin/funnels/{id}/broadcasts -> Broadcast[]
// POST /api/admin/funnels/{id}/broadcasts {segment, text, buttons, media_id, send_at} -> Broadcast
// POST /api/admin/broadcasts/test {text, buttons, media_id} -> {ok:true}

// ── Dashboard va statistika ──
export interface DashboardResponse {
  kpis: { start: number; phone: number; day1_watched: number; full_paid: number; deposit_paid: number; cost_per_sale: number | null };
  funnel: { label: string; n: number; rate: number | null }[]; // rate — oldingi bosqichdan, 0..1
  upcoming: { at: string; day1_count: number; day2_count: number }[];
  pending_receipts: number; unanswered_questions: number; failed_messages: number;
}
// GET /api/admin/dashboard?funnel_id&period=today|7d|30d

export interface StatsResponse {
  metrics: { key: string; label: string; value: number | null; rate: number | null; display?: string }[];
  retention: { day: 1 | 2; duration_min: number; offer_min: number | null; points: { minute: number; share: number }[] }[];
  messages: { id: number; title: string; sent: number; clicks: number; blocked_after: number }[];
  steps: { step: StuckStep | 'day1_missed' | 'day2_missed' | 'left_before_offer'; label: string; stuck: number; returned_by_bot: number; returned_by_call: number }[];
  live_compare: { label: string; auto: number | null; live: number | null }[];
}
// GET /api/admin/stats?funnel_id&date_from&date_to&source&slot&weekday&method&manager_id
// GET /api/admin/stats/export.xlsx?<same>
// GET/POST /api/admin/funnels/{id}/ad-spend  {source, date, amount}
// GET/PUT  /api/admin/funnels/{id}/live-results  { day1_watch_rate, paid_rate, cost_per_sale }

// ── Sozlamalar ──
export interface GlobalSettings { admin_group_chat_id: number | null; bot_username: string }
// GET/PUT /api/admin/settings
// GET /api/admin/audit -> { at: string; user: string; action: string; details: string }[]
// GET /api/admin/failed-messages -> { id: number; lead_name: string; title: string; error: string; at: string }[]
