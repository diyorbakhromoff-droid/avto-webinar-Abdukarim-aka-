import type { ChainKind, ChainMessage, ChainMessageInput, Segment, TriggerType } from '../api/types';
import { offsetLabel } from './format';
import { fmtDateTime, fmtDateTimeLong } from './time';
import { KIND_SHORT, SEGMENT_SHORT, STUCK_LABEL, isMinuteSegment, isWatchSegment } from './labels';

export type PhaseKey = 'reg' | 'day1' | 'between' | 'day2' | 'after' | 'other';

export const PHASES: { key: PhaseKey; title: string }[] = [
  { key: 'reg', title: "Ro'yxat" },
  { key: 'day1', title: '1-kun' },
  { key: 'between', title: 'Kunlar orasi' },
  { key: 'day2', title: '2-kun' },
  { key: 'after', title: '2-kundan keyin' },
  { key: 'other', title: "Tugma / to'xtab qolish / aniq sana" },
];

type Msg = Pick<ChainMessage, 'trigger_type' | 'trigger_day' | 'offset_minutes' | 'stuck_step' | 'button_key' | 'sort'> & { fixed_at?: string | null };
type Aud = Pick<ChainMessage, 'segment' | 'segment_day' | 'segment_minute' | 'trigger_type' | 'trigger_day'>;

/** Kun (1/2) talab qiladigan triggerlar. */
export const DAY_TRIGGERS: ReadonlySet<TriggerType> = new Set<TriggerType>(['before_day', 'at_day_start', 'after_day_end', 'left_live']);
export function needsDay(t: TriggerType): boolean {
  return DAY_TRIGGERS.has(t);
}
export function isSpecialTrigger(t: TriggerType): boolean {
  return t === 'stuck' || t === 'on_button';
}
/** Aniq sana-vaqt: offset o'rniga fixed_at. */
export function isFixedTrigger(t: TriggerType): boolean {
  return t === 'at_datetime';
}

/** "Qachon yuboriladi?" — asosiy tanlov (oddiy tilda). */
export const MAIN_TRIGGERS: { value: TriggerType; label: string; after: string }[] = [
  { value: 'after_registration', label: "Ro'yxatdan o'tgach … keyin", after: 'keyin' },
  { value: 'before_day', label: 'Efirdan … oldin', after: 'oldin' },
  { value: 'at_day_start', label: 'Efir boshlanganda (+… daqiqadan keyin)', after: 'keyin' },
  { value: 'after_day_end', label: 'Efir tugagach … keyin', after: 'keyin' },
  { value: 'left_live', label: 'Efirdan chiqib ketganda … keyin', after: 'keyin' },
  { value: 'before_deadline', label: 'Deadline tugashidan … oldin', after: 'oldin' },
  { value: 'at_datetime', label: 'Aniq sana va vaqtda', after: '' },
];
/** Faqat «Qo'shimcha sozlamalar»da. */
export const SPECIAL_TRIGGERS: { value: TriggerType; label: string }[] = [
  { value: 'stuck', label: "Lid biror qadamda to'xtab qolganda" },
  { value: 'on_button', label: 'Tugma bosilganda' },
];

/** Trigger turi almashtirilganda qo'yiladigan boshlang'ich vaqt (daqiqa). */
export const DEFAULT_OFFSET: Record<TriggerType, number> = {
  after_registration: 60, before_day: 120, at_day_start: 0, after_day_end: 10, left_live: 3,
  before_deadline: 180, on_button: 0, stuck: 120, at_datetime: 0,
};

export function phaseOf(m: Msg): PhaseKey {
  switch (m.trigger_type) {
    case 'after_registration': return 'reg';
    case 'before_day':
    case 'at_day_start':
    case 'left_live': return m.trigger_day === 2 ? 'day2' : 'day1';
    case 'after_day_end': return m.trigger_day === 2 ? 'after' : 'between';
    case 'before_deadline': return 'after';
    default: return 'other';
  }
}

/** Faza ichidagi vaqt tartibi (kichik — oldin). deadlineMin — 2-kun tugashidan deadlinegacha (daqiqa). */
export function timeKey(m: Msg, deadlineMin = 1440): number {
  switch (m.trigger_type) {
    case 'before_day': return -m.offset_minutes;
    case 'left_live': return 1000 + m.offset_minutes; // efir davomida — kun ustunining oxirida
    case 'before_deadline': return deadlineMin - m.offset_minutes;
    case 'at_day_start':
    case 'after_day_end':
    case 'after_registration': return m.offset_minutes;
    case 'on_button': return 1e6;
    case 'stuck': return 2e6 + m.offset_minutes;
    case 'at_datetime': return 3e9 + (m.fixed_at ? Date.parse(m.fixed_at) / 6e4 : 0);
  }
}

export function sortChain<T extends Msg>(list: T[], deadlineMin?: number): T[] {
  return [...list].sort((a, b) => timeKey(a, deadlineMin) - timeKey(b, deadlineMin) || a.sort - b.sort);
}

/** Kartochkadagi qisqa vaqt (kun ustunning o'zidan ma'lum). */
export function whenLabel(m: Msg): string {
  const o = m.offset_minutes;
  switch (m.trigger_type) {
    case 'after_registration': return o === 0 ? 'darhol' : `+${offsetLabel(o)}`;
    case 'before_day': return `${offsetLabel(o)} oldin`;
    case 'at_day_start': return o === 0 ? 'boshlanishda' : `boshidan +${offsetLabel(o)}`;
    case 'after_day_end': return o === 0 ? 'tugagach' : `tugagach +${offsetLabel(o)}`;
    case 'left_live': return o === 0 ? 'efirdan chiqqanda' : `efirdan chiqqach +${offsetLabel(o)}`;
    case 'before_deadline': return `deadline'dan ${offsetLabel(o)} oldin`;
    case 'on_button': return `tugma «${m.button_key ?? '—'}»${o ? ` +${offsetLabel(o)}` : ''}`;
    case 'stuck': return `${m.stuck_step ? STUCK_LABEL[m.stuck_step].toLowerCase() : "to'xtasa"} · ${offsetLabel(o)}`;
    case 'at_datetime': return m.fixed_at ? fmtDateTime(m.fixed_at) : 'sana tanlanmagan';
  }
}

/** Video segmenti qaysi kun videosiga qaraydi (backend: segment_day yoki trigger_day). */
export function segmentDayOf(m: Pick<ChainMessage, 'segment_day' | 'trigger_day'>): 1 | 2 {
  return m.segment_day ?? m.trigger_day ?? 1;
}

/** Kimga — kartochka uchun oddiy so'zlarda: "40-daqiqagacha chiqib ketganlar". */
export function audienceShort(m: Aud): string {
  if (!isWatchSegment(m.segment)) return SEGMENT_SHORT[m.segment];
  const base = SEGMENT_SHORT[m.segment].replace('X', m.segment_minute ? String(m.segment_minute) : '?');
  const d = segmentDayOf(m);
  const sameDay = needsDay(m.trigger_type) && m.trigger_day === d;
  return sameDay ? base : `${d}-kun: ${base}`;
}

export function metaLabel(m: Aud & Pick<ChainMessage, 'kind' | 'required' | 'status' | 'buttons'>): string {
  const parts: string[] = [audienceShort(m), KIND_SHORT[m.kind]];
  if (m.buttons.length) parts.push('tugma');
  if (m.required) parts.push('majburiy');
  if (m.status === 'draft') parts.push('qoralama');
  return parts.join(' · ');
}

/** 120 → "2 soat", 10 → "10 daqiqa", 1440 → "1 kun", 90 → "1 soat 30 daqiqa". */
export function offsetWords(min: number): string {
  const a = Math.abs(min);
  if (a !== 0 && a % 1440 === 0) return `${a / 1440} kun`;
  if (a >= 60) {
    const h = Math.floor(a / 60), r = a % 60;
    return r ? `${h} soat ${r} daqiqa` : `${h} soat`;
  }
  return `${a} daqiqa`;
}

/** "Qachon" qismi — to'liq jumla uchun. */
export function whenSentence(m: Msg): string {
  const o = m.offset_minutes;
  const w = offsetWords(o);
  const d = m.trigger_day ?? 1;
  switch (m.trigger_type) {
    case 'after_registration': return o === 0 ? "Ro'yxatdan o'tishi bilan" : `Ro'yxatdan o'tgach ${w}dan keyin`;
    case 'before_day': return o === 0 ? `${d}-kun efiri boshlanishida` : `${d}-kun efiridan ${w} oldin`;
    case 'at_day_start': return o === 0 ? `${d}-kun efiri boshlanganda` : `${d}-kun efiri boshlangach ${w}dan keyin`;
    case 'after_day_end': return o === 0 ? `${d}-kun efiri tugashi bilan` : `${d}-kun efiri tugagach ${w}dan keyin`;
    case 'left_live': return o === 0 ? `Lid ${d}-kun efiridan chiqib ketishi bilan` : `Lid ${d}-kun efiridan chiqib ketgach ${w}dan keyin`;
    case 'before_deadline': return o === 0 ? 'Shaxsiy deadline tugaganda' : `Shaxsiy deadline tugashidan ${w} oldin`;
    case 'stuck': return `Lid «${m.stuck_step ? STUCK_LABEL[m.stuck_step] : '—'}» holatida ${w} to'xtab qolganda`;
    case 'on_button': return o === 0 ? `«${m.button_key || '—'}» tugmasi bosilganda` : `«${m.button_key || '—'}» tugmasi bosilgach ${w}dan keyin`;
    case 'at_datetime': return m.fixed_at ? `${fmtDateTimeLong(m.fixed_at)} da (Toshkent vaqti)` : 'Aniq sana tanlanmagan';
  }
}

const AUDIENCE_TO: Record<Exclude<Segment, 'not_joined' | 'reached_min' | 'left_before_min' | 'watched_full' | 'not_full'>, string> = {
  all: 'hammaga',
  day1_attended: "1-kunni ko'rganlarga (≥75%)",
  day1_missed: "1-kunni ko'rmaganlarga",
  day2_attended: '2-kunga kelganlarga',
  day2_missed: '2-kunga kelmaganlarga',
  reached_offer: "ofertagacha ko'rganlarga",
  left_before_offer: 'ofertagacha chiqib ketganlarga',
  receipt_sent: 'chek yuborganlarga',
  deposit_paid: "boshlang'ich to'laganlarga",
  full_paid: "to'liq to'laganlarga",
  not_paid: "to'lamaganlarga",
};

/** "Kimga" qismi — jo'nalish kelishigida: "1-kun videosining 40-daqiqasiga yetmay chiqib ketganlarga". */
export function audienceSentence(m: Aud): string {
  const d = segmentDayOf(m);
  const x = m.segment_minute ? String(m.segment_minute) : '__';
  switch (m.segment) {
    case 'not_joined': return `${d}-kun efiriga kirmaganlarga`;
    case 'reached_min': return `${d}-kun videosining ${x}-daqiqasigacha ko'rganlarga`;
    case 'left_before_min': return `${d}-kun videosining ${x}-daqiqasiga yetmay chiqib ketganlarga`;
    case 'watched_full': return `${d}-kun videosini oxirigacha ko'rganlarga`;
    case 'not_full': return `${d}-kun efiriga kirib, oxirigacha ko'rmaganlarga`;
    default: return AUDIENCE_TO[m.segment];
  }
}

export function ruleSentence(m: Msg & Aud): string {
  return `${whenSentence(m)} → ${audienceSentence(m)}`;
}

export const OFFSET_LABEL: Record<TriggerType, string> = {
  after_registration: "Ro'yxatdan keyin",
  before_day: 'Efirdan oldin',
  at_day_start: 'Efir boshlanganidan keyin',
  after_day_end: 'Efir tugaganidan keyin',
  left_live: 'Efirdan chiqib ketgandan keyin',
  before_deadline: 'Deadline tugashidan oldin',
  on_button: 'Tugma bosilgandan keyin',
  stuck: "To'xtab qolgandan keyin",
  at_datetime: 'Aniq sana va vaqt',
};

export function textLimit(kind: ChainKind): number {
  return kind === 'text' ? 4096 : 1024;
}

function baseInput(sort: number): ChainMessageInput {
  return {
    title: 'Yangi xabar', kind: 'text', text: '', media_ids: [], buttons: [],
    trigger_type: 'after_registration', trigger_day: null, offset_minutes: 60, fixed_at: null,
    stuck_step: null, button_key: null, segment: 'all', segment_day: null, segment_minute: null,
    required: false, status: 'draft', sort,
  };
}

export function defaultsForPhase(phase: PhaseKey, sort: number): ChainMessageInput {
  const base = baseInput(sort);
  switch (phase) {
    case 'reg': return base;
    case 'day1': return { ...base, trigger_type: 'before_day', trigger_day: 1, offset_minutes: 120 };
    case 'between': return { ...base, trigger_type: 'after_day_end', trigger_day: 1, offset_minutes: 60, segment: 'day1_attended' };
    case 'day2': return { ...base, trigger_type: 'before_day', trigger_day: 2, offset_minutes: 120 };
    case 'after': return { ...base, trigger_type: 'after_day_end', trigger_day: 2, offset_minutes: 120, segment: 'not_paid' };
    case 'other': return { ...base, trigger_type: 'stuck', stuck_step: 'no_session', offset_minutes: 120 };
  }
}

/** Tomosha statistikasidagi «Shu yerda chiqib ketganlarga xabar» uchun tayyor qoralama. */
export function leftBeforeDraft(minute: number, day: 1 | 2, sort: number): ChainMessageInput {
  return {
    ...baseInput(sort),
    title: `${minute}-daqiqagacha chiqib ketganlar`,
    trigger_type: 'after_day_end', trigger_day: day, offset_minutes: 10,
    segment: 'left_before_min', segment_day: day, segment_minute: minute,
  };
}

export function toInput(m: ChainMessage): ChainMessageInput {
  return {
    title: m.title, kind: m.kind, text: m.text, media_ids: [...m.media_ids],
    buttons: m.buttons.map((r) => r.map((b) => ({ ...b }))),
    trigger_type: m.trigger_type, trigger_day: m.trigger_day, offset_minutes: m.offset_minutes,
    fixed_at: m.fixed_at ?? null, stuck_step: m.stuck_step, button_key: m.button_key, segment: m.segment,
    segment_day: m.segment_day ?? null, segment_minute: m.segment_minute ?? null,
    required: m.required, status: m.status, sort: m.sort,
  };
}

/** Saqlashdan oldin trigger va segment turiga mos bo'lmagan maydonlarni tozalaydi. */
export function normalize(m: ChainMessageInput): ChainMessageInput {
  const trigger_day = needsDay(m.trigger_type) ? (m.trigger_day ?? 1) : null;
  return {
    ...m,
    title: m.title.trim(),
    trigger_day,
    stuck_step: m.trigger_type === 'stuck' ? (m.stuck_step ?? 'no_session') : null,
    fixed_at: m.trigger_type === 'at_datetime' ? m.fixed_at : null,
    offset_minutes: m.trigger_type === 'at_datetime' ? 0 : m.offset_minutes,
    button_key: m.trigger_type === 'on_button' ? (m.button_key ?? '').trim() || null : null,
    segment_day: isWatchSegment(m.segment) ? (m.segment_day ?? trigger_day ?? 1) : null,
    segment_minute: isMinuteSegment(m.segment) ? m.segment_minute : null,
    media_ids: m.kind === 'text' ? [] : m.media_ids,
    text: m.kind === 'video_note' ? '' : m.text,
  };
}
