/**
 * Admin panel API turlari — docs/api-contract.ts dagi ADMIN bo'limidan ko'chirilgan.
 * Shartnomada izoh ichida berilgan (nomlanmagan) shakllar pastda alohida nom bilan
 * e'lon qilingan ("Izohlardan olingan turlar").
 *
 * Umumiy qoidalar:
 * - Barcha vaqtlar ISO-8601 UTC satr. Ekranda Asia/Tashkent (UTC+5).
 * - Pul — butun son, so'mda.
 * - Xato: HTTP 4xx/5xx + { "detail": string }.
 */

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
// GET  /api/admin/funnels/{id}/deeplink?source=ig_reels3 -> { url: string }

export interface FunnelSettings {
  // brand / design
  course_title: string; webinar_title: string; topic: string;
  speaker_name: string; speaker_title: string; speaker_photo_url: string | null;
  logo_url: string | null; theme_primary: string; theme_background: string; bg_image_url: string | null;
  welcome_text: string;
  lead_magnet_media_id: number | null; lead_magnet_caption: string;
  // slots
  slot_times: string[];
  weekdays: number[];              // 0=dushanba … 6=yakshanba
  excluded_dates: string[];
  min_hours_before: number;        // N
  options_count: number;           // K
  late_entry_minutes: number;      // L
  reschedule_limit: number;
  day1_watch_threshold: number;    // 0.75
  quiet_start: string; quiet_end: string;
  // video
  day1_video_id: string; day1_duration_sec: number; day1_soft_offer_sec: number | null;
  day2_video_id: string; day2_duration_sec: number; day2_offer_sec: number;
  between_summary: string[];
  // sales
  offer_course_title: string; bonuses: string[];
  deadline_hours: number;          // D
  after_deadline: 'regular_price' | 'closed';
  channel_id: number | null;
  // stuck thresholds (minutes)
  stuck_no_phone_min: number; stuck_no_session_min: number; stuck_no_receipt_min: number;
}
// GET/PUT /api/admin/funnels/{id}/settings -> FunnelSettings
//   PUT javobi: FunnelSettings & { warnings: string[] }

export interface Requisites { card_number: string; card_holder: string; payme_url: string; click_url: string }
// GET/PUT /api/admin/funnels/{id}/requisites -> Requisites   (faqat super_admin)

// GET/POST /api/admin/funnels/{id}/tariffs, PUT/DELETE /api/admin/tariffs/{tid}
export interface TariffAdmin {
  id: number; name: string; description: string; special_price: number; regular_price: number;
  deposit_enabled: boolean; deposit_amount: number; sort: number;
}

// ── Progrev zanjiri ──
export type ChainKind = 'text' | 'photo' | 'video' | 'video_note' | 'voice' | 'audio' | 'document' | 'album';
export type TriggerType =
  | 'after_registration'
  | 'before_day'         // 1-kun yoki 2-kundan X oldin
  | 'at_day_start'       // kun boshlanishida (+X daqiqa)
  | 'after_day_end'      // kun tugaganidan X keyin
  | 'left_live'          // efir davomida chiqib ketgandan X keyin (trigger_day — qaysi kun; qaytsa bekor bo'ladi)
  | 'before_deadline'    // shaxsiy deadline tugashidan X oldin
  | 'on_button'
  | 'stuck';
export type Segment =
  | 'all'
  // video ko'rish bo'yicha — segment_day (1|2) kerak, *_min uchun segment_minute ham
  | 'not_joined'        // efirga kirmaganlar
  | 'reached_min'       // videoning X-daqiqasigacha ko'rganlar
  | 'left_before_min'   // kirgan, lekin X-daqiqaga yetmay chiqib ketganlar
  | 'watched_full'      // oxirigacha (95%) ko'rganlar
  | 'not_full'          // kirgan, lekin oxirigacha ko'rmaganlar
  // kun natijasi
  | 'day1_attended' | 'day1_missed' | 'day2_attended' | 'day2_missed'
  | 'reached_offer' | 'left_before_offer'
  // to'lov
  | 'receipt_sent' | 'deposit_paid' | 'full_paid' | 'not_paid';
export type StuckStep = 'no_phone' | 'no_session' | 'no_receipt' | 'receipt_rejected';
/** next — faqat sxemadagi «Xabar» blokida: lid shu tugmaning chizig'i bo'ylab keyingi blokka o'tadi (id — server beradi). */
export type ButtonType = 'url' | 'webapp' | 'reschedule' | 'pay' | 'next';
export interface ChainButton { type: ButtonType; text: string; url?: string; id?: string }

export interface ChainMessage {
  id: number;
  title: string;
  kind: ChainKind;
  text: string;
  media_ids: number[];
  buttons: ChainButton[][];
  trigger_type: TriggerType;
  trigger_day: 1 | 2 | null;
  offset_minutes: number;
  stuck_step: StuckStep | null;
  button_key: string | null;
  segment: Segment;
  segment_day: 1 | 2 | null;     // ko'rish segmentlari: qaysi kun videosi (bo'sh bo'lsa trigger_day)
  segment_minute: number | null; // reached_min / left_before_min: X-daqiqa
  required: boolean;
  status: 'active' | 'draft';
  sort: number;
  /** sxemadagi «Xabar» yoki «Zanjir» blokiga tegishli bo'lsa — blok id si (oddiy zanjirda null) */
  flow_node_id?: number | null;
  updated_at: string; updated_by: string | null;
  stats?: { sent: number; clicks: number; blocked_after: number };
  warnings?: string[];
}
export type ChainMessageInput = Omit<ChainMessage, 'id' | 'updated_at' | 'updated_by' | 'stats' | 'warnings'>;
/** Sxemadagi «Xabar» blokining xabari: trigger_type = 'flow' (vaqtni sxema belgilaydi). */
export type FlowMessage = Omit<ChainMessage, 'trigger_type'> & { trigger_type: TriggerType | 'flow' };
export type FlowMessageInput = Omit<ChainMessageInput, 'trigger_type'> & { trigger_type: TriggerType | 'flow' };
// GET    /api/admin/funnels/{id}/chain -> ChainMessage[]
// POST   /api/admin/funnels/{id}/chain  body: ChainMessageInput -> ChainMessage
// PUT    /api/admin/chain/{mid} body: same -> ChainMessage
// DELETE /api/admin/chain/{mid}
// POST   /api/admin/chain/{mid}/duplicate -> ChainMessage
// POST   /api/admin/chain/{mid}/test -> { ok: true }
// GET    /api/admin/chain/{mid}/history -> ChainHistoryEntry[]
// POST   /api/admin/funnels/{id}/chain/simulate { registered_at, day1_at } -> SimulationRow[]
export interface SimulationRow {
  message_id: number; title: string; trigger: string;
  send_at: string | null;
  status: 'scheduled' | 'compressed' | 'skipped' | 'quiet_shifted' | 'event';
  reason: string | null;
}

// POST /api/admin/media (multipart: file) -> MediaInfo
export interface MediaInfo { id: number; kind: 'photo' | 'video' | 'video_note' | 'voice' | 'audio' | 'document'; filename: string; size: number; url: string; warnings: string[] }

// ── Izohlar (asl efir) ──
export interface CommentRow { id: number; day: 1 | 2; t: number; author: string; text: string }
// GET /api/admin/funnels/{id}/comments?day=1 -> CommentRow[]
// POST /api/admin/funnels/{id}/comments {day,t,author,text}; DELETE /api/admin/comments/{cid}
// POST /api/admin/funnels/{id}/comments/import (multipart: file, day) -> { imported: number }

// ── Lidlar ──
export type LeadStep =
  | 'started' | 'phone' | 'session' | 'day1_missed' | 'day1_watched' | 'day2_missed'
  | 'left_before_offer' | 'reached_offer' | 'clicked_buy' | 'receipt_sent' | 'receipt_rejected'
  | 'deposit_paid' | 'full_paid' | 'cold';
export type PaymentStatus = 'none' | 'deposit' | 'full';

export interface LeadRow {
  id: number; name: string; phone: string | null; username: string | null; source: string;
  day1_minutes: number | null;
  day2_minutes: number | null;
  reached_offer: boolean; clicked_buy: boolean; receipt: 'none' | 'pending' | 'approved' | 'rejected';
  payment_status: PaymentStatus;
  manager: { id: number; name: string } | null;
  step: LeadStep; step_label: string; step_since: string;
  last_contact_at: string | null;
  blocked: boolean; unsubscribed: boolean;
  created_at: string;
  stage: PipelineStage; stage_label: string;
}
export type CallListKey =
  | 'deposit_paid' | 'full_paid' | 'offer_not_paid' | 'clicked_no_receipt' | 'receipt_rejected'
  | 'no_session' | 'day1_missed' | 'day2_missed' | 'left_before_offer' | 'cold' | 'blocked';
// GET /api/admin/call-lists?funnel_id= -> CallList[]
// GET /api/admin/leads?funnel_id&list&step&source&manager_id&q&date_from&date_to&page&page_size -> LeadsPage
// GET /api/admin/leads/export.xlsx?<same filters>

export interface LeadEvent { at: string; type: string; title: string; details: string }
export interface LeadCard extends LeadRow {
  registered_at: string;
  sessions: { id: number; day1_at: string; day2_at: string; status: 'active' | 'replaced' | 'completed' }[];
  watch: { day: 1 | 2; minutes: number; duration_min: number; percent: number; reached_offer: boolean; offer_min: number | null }[];
  deadline_at: string | null;
  remaining_amount: number | null; remaining_due_date: string | null;
  payments: PaymentRow[];
  contacts: { at: string; manager: string; result: ContactResult; callback_at: string | null; note: string }[];
  events: LeadEvent[];
  messages: { at: string; title: string; status: string }[];
  tags?: string[];
  flow_runs?: LeadFlowRun[];
  stage_at: string;
  /** avtovoronka yo'li: asosiy nuqtalar (bajardi / o'tkazib yubordi / oldinda) */
  path: FunnelPathStep[];
}
export interface FunnelPathStep {
  key: 'start' | 'phone' | 'session' | 'day1' | 'day2' | 'offer' | 'buy' | 'receipt' | 'paid';
  label: string; state: 'done' | 'missed' | 'wait'; at: string | null; detail: string;
}

// ── Sotuv doskasi (amoCRM kabi) ──
export type PipelineStage = 'new' | 'contacted' | 'callback' | 'waiting_payment' | 'won' | 'lost';
export interface PipelineCard {
  id: number; name: string; phone: string | null; username: string | null;
  stage: PipelineStage; stage_at: string;
  step: LeadStep; step_label: string; step_since: string;
  manager: { id: number; name: string } | null;
  payment_status: PaymentStatus; receipt: LeadRow['receipt']; paid: number;
  day1_minutes: number | null; day2_minutes: number | null;
  /** faqat «Qayta qo'ng'iroq» ustunida */
  callback_at: string | null;
  /** oxirgi izoh */
  note: string;
  blocked: boolean; unsubscribed: boolean; created_at: string;
}
export interface PipelineColumn { key: PipelineStage; label: string; count: number; sum: number; items: PipelineCard[] }
export interface StageInput { stage: PipelineStage; callback_at?: string | null; note?: string }
// GET  /api/admin/pipeline?funnel_id&<leads filters> -> { stages: PipelineColumn[] }
// GET  /api/admin/pipeline?funnel_id&<filters>&stage&offset -> { items: PipelineCard[] }
// POST /api/admin/leads/{id}/stage {stage, callback_at?, note?} -> { ok, stage }
/** Lidning sxemadagi yo'llari (oxirgi 20 tasi). */
export interface LeadFlowRun {
  id: number; flow_id: number; flow_name: string;
  node_title: string | null; node_type: FlowNodeType | null;
  status: 'active' | 'waiting' | 'done' | 'stopped';
  waiting_for: 'button' | 'time' | 'event' | 'chain' | null;
  wait_until: string | null; started_at: string; updated_at: string; reason: string | null;
}
export type ContactResult = 'no_answer' | 'callback' | 'sold' | 'refused';
// GET  /api/admin/leads/{id} -> LeadCard
// POST /api/admin/leads/{id}/contact {result, callback_at, note}
// POST /api/admin/leads/{id}/assign {manager_id: number | null}
// POST /api/admin/leads/{id}/deadline {deadline_at: string}
// POST /api/admin/leads/{id}/payment-plan {remaining_amount, remaining_due_date}
// POST /api/admin/leads/{id}/send-invite
// POST /api/admin/leads/{id}/receipt (multipart: file, tariff_id, kind, method, amount)
// POST /api/admin/leads/message {lead_ids, text, buttons, media_id} -> { queued: number }

// ── To'lovlar ──
export type PaymentKind = 'deposit' | 'full' | 'remaining';
export type PaymentMethod = 'card' | 'payme' | 'click';
export interface PaymentRow {
  id: number; lead_id: number; lead_name: string; lead_phone: string | null;
  tariff: string; method: PaymentMethod; kind: PaymentKind; amount: number;
  status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null;
  submitted_at: string; decided_at: string | null; decided_by: string | null;
  within_deadline: boolean; duplicate_of: number | null; refunded: boolean;
  file_url: string;
  file_mime: string;
}
// GET  /api/admin/payments?funnel_id&status=pending|approved|rejected|all -> PaymentRow[]
// POST /api/admin/payments/{id}/approve -> PaymentRow
// POST /api/admin/payments/{id}/reject {reason} -> PaymentRow
// POST /api/admin/payments/{id}/refund -> PaymentRow
export const REJECT_REASONS = ["Summa mos emas", "Chek o'qilmaydi", "To'lov topilmadi", "Boshqa sabab"];

// ── Tomosha statistikasi (har N daqiqada) ──
// GET /api/admin/funnels/{id}/watch-stats?day=1&step=5&date_from&date_to&source&slot -> WatchStats
export interface WatchStats {
  day: 1 | 2; step: number; duration_min: number; offer_min: number | null;
  joined: number;          // efirga kirganlar
  avg_watch_min: number;   // o'rtacha necha daqiqa ko'rdi
  full: number;            // oxirigacha ko'rganlar
  buckets: WatchBucket[];
  top_drops: { from_minute: number; to_minute: number; left: number }[];  // eng ko'p chiqib ketilgan 3 oraliq
}
/** minute — videoning daqiqasi; viewers — shu daqiqada ko'rib turganlar; share — kirganlarga nisbatan 0..1;
 *  drop — oldingi nuqtadan kamayish (0..1); left — oraliqda chiqib ketganlar. */
export interface WatchBucket { minute: number; viewers: number; share: number; drop: number; left: number }

// ── Efir chati (Mini App'da efir davomida yozilganlar) ──
export interface ChatRow {
  id: number; lead_id: number; lead_name: string; lead_phone: string | null; // kontent menejerga telefon null
  text: string; day: 1 | 2 | null; video_sec: number | null;  // videoning qaysi soniyasida yozilgan
  session_at: string | null;  // shu kun efirining boshlanish vaqti
  created_at: string; answer: string | null; answered_at: string | null; answered_by: string | null;
}
// GET  /api/admin/chat?funnel_id&date=YYYY-MM-DD&day=1|2&status=all|unanswered -> ChatRow[]  (barcha rollar)
// GET  /api/admin/chat/sessions?funnel_id -> ChatSession[]
// POST /api/admin/chat/{id}/reply {text} -> ChatRow   (javob lidga bot orqali boradi)

// ── Savollar (botdagi "Savol berish" — efirdan keyin) ──
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
  funnel: { label: string; n: number; rate: number | null }[];
  upcoming: { at: string; day1_count: number; day2_count: number }[];
  pending_receipts: number; unanswered_questions: number; unanswered_chat: number; failed_messages: number;
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
// GET /api/admin/audit -> AuditRow[]
// GET /api/admin/failed-messages -> FailedMessage[]

// ───────────── Izohlardan olingan turlar (shartnomada nomsiz) ─────────────

export interface LoginResponse { token: string; user: AdminUser }
export type UserInput = Partial<AdminUser> & { password?: string };
export interface DeeplinkResponse { url: string }
export type SettingsSaveResponse = FunnelSettings & { warnings: string[] };
export interface ChainHistoryEntry { at: string; user: string; changes: Record<string, [unknown, unknown]> }
export interface CommentInput { day: 1 | 2; t: number; author: string; text: string }
export interface CallList { key: CallListKey; label: string; count: number }
export interface LeadsPage { items: LeadRow[]; total: number }
export interface ContactInput { result: ContactResult; callback_at: string | null; note: string }
export interface LeadMessageInput { lead_ids: number[]; text: string; buttons: ChainButton[][]; media_id: number | null }
export interface BroadcastInput { segment: Segment | 'cold'; text: string; buttons: ChainButton[][]; media_id: number | null; send_at: string | null }
/** Shartnomada GET javobi shakli yozilmagan — {id?, source, date, amount} deb faraz qilindi. */
export interface AdSpendRow { id?: number; source: string; date: string; amount: number }
/** Stavkalar 0..1 ulush deb faraz qilindi (StatsResponse.rate bilan bir xil). */
export interface LiveResults { day1_watch_rate: number | null; paid_rate: number | null; cost_per_sale: number | null }
export interface AuditRow { at: string; user: string; action: string; details: string }
export interface FailedMessage { id: number; lead_name: string; title: string; error: string; at: string }
export type PaymentsStatusFilter = 'pending' | 'approved' | 'rejected' | 'all';
export type DashboardPeriod = 'today' | '7d' | '30d';
/** GET /api/admin/chat/sessions elementi. */
export interface ChatSession { day: 1 | 2; at: string; count: number; unanswered: number }
export type ChatStatusFilter = 'all' | 'unanswered';

// ── Progrev sxemasi (bloklar va chiziqlar) ──
export type FlowNodeType = 'start' | 'message' | 'wait' | 'condition' | 'action' | 'goto' | 'chain' | 'stop' | 'note';
export type FlowStartEvent =
  | 'start' | 'phone' | 'session_chosen' | 'joined' | 'left_live' | 'day_end' | 'reached_offer'
  | 'clicked_buy' | 'receipt' | 'payment_approved' | 'payment_rejected' | 'question';
export type FlowWaitEvent = 'joined' | 'question' | 'receipt' | 'clicked_buy' | 'payment_approved';
export type FlowAnchor = 'day1_start' | 'day1_end' | 'day2_start' | 'day2_end' | 'offer' | 'deadline';
export type FlowCheck = 'watch' | 'joined' | 'reached_offer' | 'wrote_admin' | 'clicked_buy' | 'receipt' | 'payment' | 'tag' | 'source';
export type FlowAction = 'reschedule' | 'ask' | 'tag_add' | 'tag_remove' | 'cold' | 'manager_task';
export interface WatchBranch { id: string; label: string; kind: 'not_joined' | 'range'; from_min?: number; to_min?: number | null }

/** Har bir blok turining sozlamasi (config). */
export interface FlowConfig {
  // start
  event?: FlowStartEvent | FlowWaitEvent;
  day?: 1 | 2;
  // message
  timeout_minutes?: number | null;
  paid_ok?: boolean;
  // wait
  mode?: 'duration' | 'anchor' | 'clock' | 'event';
  minutes?: number;
  anchor?: FlowAnchor;
  direction?: 'before' | 'after';
  clock?: string;
  max_minutes?: number;
  quiet?: boolean;
  late?: 'skip' | 'send';
  // condition
  check?: FlowCheck;
  branches?: WatchBranch[];
  value?: string;
  // action
  action?: FlowAction;
  // goto
  target_node_id?: number | null;
  item?: number;
  // stop
  tag?: string;
  // note
  text?: string;
}

export interface FlowSection {
  id: number; funnel_id: number; name: string; status: 'active' | 'draft'; sort: number;
  updated_at: string; updated_by: string | null;
  nodes: number;          // bloklar soni
  active_leads: number;   // hozir shu bo'limda yurgan lidlar
}
export interface FlowNode {
  id: number; flow_id: number; type: FlowNodeType; title: string; x: number; y: number;
  config: FlowConfig;
  ports: string[];             // chiqishlar: next | b:<tugma id> | timeout | <shoxcha id> | else | yes | no | done | expired ...
  messages: FlowMessage[];     // message — 1 ta, chain — zanjir xabarlari (tartib bilan)
  warnings: string[];
}
export interface FlowEdge { id: number; flow_id: number; from_node_id: number; from_port: string; to_node_id: number; to_item: number }
/** entered — tanlangan davrda blokka kirganlar; here — hozir shu blokda kutayotganlar; ports — qaysi chiqishdan chiqqanlar. */
export interface FlowNodeStats { entered: number; here: number; ports: Record<string, number> }
export interface FlowGraph { flow: FlowSection; nodes: FlowNode[]; edges: FlowEdge[]; stats: Record<string, FlowNodeStats>; days: number }
export interface FlowTarget { id: number; flow_id: number; flow_name: string; type: FlowNodeType; title: string; items: string[] }
export type FlowImportPhase = 'reg' | 'day1' | 'between' | 'day2' | 'after';
// GET    /api/admin/funnels/{id}/flows -> FlowSection[]
// POST   /api/admin/funnels/{id}/flows {name} -> FlowSection (qoralama, «Boshlanish» bloki bilan)
// POST   /api/admin/funnels/{id}/flows/example -> FlowSection (namuna, qoralama)
// POST   /api/admin/funnels/{id}/flows/import {phase} -> FlowSection & {moved_messages, moved_leads}
// PUT    /api/admin/flows/{id} {name?, status?, sort?} -> FlowSection ; DELETE /api/admin/flows/{id}
// GET    /api/admin/flows/{id}?days=7 -> FlowGraph
// POST   /api/admin/flows/{id}/nodes {type, x, y, title?, config?} -> FlowNode
// PUT    /api/admin/flow-nodes/{id} {title?, x?, y?, config?} -> FlowNode ; DELETE ; POST .../duplicate -> FlowNode
// POST   /api/admin/flows/{id}/edges {from_node_id, from_port, to_node_id, to_item} -> FlowEdge ; DELETE /api/admin/flow-edges/{id}
// GET    /api/admin/funnels/{id}/flow-targets -> FlowTarget[]
// Xabar matni: PUT /api/admin/chain/{mid} (FlowMessageInput); zanjirga xabar: POST /api/admin/funnels/{id}/chain {..., flow_node_id}
