/**
 * Backend shartnomasidan (docs/api-contract.ts, MINI APP bo'limi) aynan ko'chirilgan turlar.
 * O'zgartirish kerak bo'lsa — avval shartnomani yangilang.
 */

export type MiniState =
  | 'no_session' // lid sessiya tanlamagan
  | 'waiting' // 1-kungacha
  | 'live' // efir (1-kun yoki 2-kun) — video o'ynaydi
  | 'between' // 1-kun tugadi (≥75% ko'rdi), 2-kungacha
  | 'missed' // kunni ko'rmadi — qayta vaqt tanlash
  | 'closed' // kech kirish chegarasi (L) o'tdi, kirmagan
  | 'ended'; // 2-kun tugadi — sotuv bloki + deadline

export interface Tariff {
  id: number;
  name: string;
  description: string;
  special_price: number;
  regular_price: number;
  price_now: number;
  deposit_amount: number | null;
}

export interface Offer {
  course_title: string;
  tariffs: Tariff[];
  bonuses: string[];
  deadline_at: string | null;
  special_active: boolean;
  closed: boolean;
  /** live holatda: video shu soniyaga yetganda sotuv bloki chiqadi. null = bu kunda taklif yo'q */
  visible_from_sec: number | null;
  soft: boolean;
}

export interface FunnelBrand {
  course_title: string;
  webinar_title: string;
  topic: string;
  speaker_name: string;
  speaker_title: string;
  speaker_photo_url: string | null;
  logo_url: string | null;
  theme: { primary: string; background: string; bg_image_url: string | null };
  late_entry_minutes: number;
}

export interface LiveComment {
  t: number;
  author: string;
  text: string;
}

export interface AppStateResponse {
  server_time: string;
  lead: { first_name: string };
  funnel: FunnelBrand;
  state: MiniState;
  session: {
    id: number;
    day1_at: string;
    day2_at: string;
    can_change: boolean;
  } | null;
  live: {
    day: 1 | 2;
    start_at: string;
    duration_sec: number;
    hls_url: string;
    comments: LiveComment[];
  } | null;
  between: { day1_percent: number; day2_at: string; summary: string[] } | null;
  missed: { day: 1 | 2; started_at: string | null; reschedules_left: number } | null;
  offer: Offer | null;
}

export interface HeartbeatRequest {
  session_id: number;
  day: 1 | 2;
  position_sec: number;
}

export interface HeartbeatResponse {
  ok: true;
  server_time: string;
}

export interface OkResponse {
  ok: true;
}

export type LiveInfo = NonNullable<AppStateResponse['live']>;
export type SessionInfo = NonNullable<AppStateResponse['session']>;
export type BetweenInfo = NonNullable<AppStateResponse['between']>;
export type MissedInfo = NonNullable<AppStateResponse['missed']>;
