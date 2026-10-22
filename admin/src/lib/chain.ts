import type { ChainKind, ChainMessage, ChainMessageInput, TriggerType } from '../api/types';
import { offsetLabel } from './format';
import { KIND_SHORT, SEGMENT_SHORT, STUCK_LABEL } from './labels';

export type PhaseKey = 'reg' | 'day1' | 'between' | 'day2' | 'after' | 'other';

export const PHASES: { key: PhaseKey; title: string }[] = [
  { key: 'reg', title: "Ro'yxat" },
  { key: 'day1', title: '1-kun' },
  { key: 'between', title: 'Kunlar orasi' },
  { key: 'day2', title: '2-kun' },
  { key: 'after', title: '2-kundan keyin' },
  { key: 'other', title: "Tugma / to'xtab qolish" },
];

type Msg = Pick<ChainMessage, 'trigger_type' | 'trigger_day' | 'offset_minutes' | 'stuck_step' | 'button_key' | 'sort'>;

export function phaseOf(m: Msg): PhaseKey {
  switch (m.trigger_type) {
    case 'after_registration': return 'reg';
    case 'before_day':
    case 'at_day_start': return m.trigger_day === 2 ? 'day2' : 'day1';
    case 'after_day_end': return m.trigger_day === 2 ? 'after' : 'between';
    default: return 'other';
  }
}

/** Faza ichidagi vaqt tartibi (kichik — oldin). */
export function timeKey(m: Msg): number {
  switch (m.trigger_type) {
    case 'before_day': return -m.offset_minutes;
    case 'at_day_start':
    case 'after_day_end':
    case 'after_registration': return m.offset_minutes;
    case 'on_button': return 1e6;
    case 'stuck': return 2e6 + m.offset_minutes;
  }
}

export function sortChain<T extends Msg>(list: T[]): T[] {
  return [...list].sort((a, b) => timeKey(a) - timeKey(b) || a.sort - b.sort);
}

export function whenLabel(m: Msg): string {
  const o = m.offset_minutes;
  switch (m.trigger_type) {
    case 'after_registration': return o === 0 ? 'darhol' : `+${offsetLabel(o)}`;
    case 'before_day': return `${offsetLabel(o)} oldin`;
    case 'at_day_start': return o === 0 ? 'boshlanishda' : `boshidan +${offsetLabel(o)}`;
    case 'after_day_end': return o === 0 ? 'tugagach' : `tugagach +${offsetLabel(o)}`;
    case 'on_button': return `tugma «${m.button_key ?? '—'}»${o ? ` +${offsetLabel(o)}` : ''}`;
    case 'stuck': return `${m.stuck_step ? STUCK_LABEL[m.stuck_step].toLowerCase() : "to'xtasa"} · ${offsetLabel(o)}`;
  }
}

export function metaLabel(m: Pick<ChainMessage, 'kind' | 'segment' | 'required' | 'status' | 'buttons'>): string {
  const parts: string[] = [KIND_SHORT[m.kind]];
  if (m.buttons.length) parts.push('tugmalar');
  if (m.segment !== 'all') parts.push(SEGMENT_SHORT[m.segment]);
  if (m.required) parts.push('majburiy');
  if (m.status === 'draft') parts.push('qoralama');
  return parts.join(' · ');
}

export function needsDay(t: TriggerType): boolean {
  return t === 'before_day' || t === 'at_day_start' || t === 'after_day_end';
}

export const OFFSET_LABEL: Record<TriggerType, string> = {
  after_registration: "Ro'yxatdan keyin",
  before_day: 'Kun boshlanishidan oldin',
  at_day_start: 'Kun boshlanganidan keyin',
  after_day_end: 'Kun tugaganidan keyin',
  on_button: 'Tugma bosilgandan keyin',
  stuck: "To'xtab qolgandan keyin",
};

export function textLimit(kind: ChainKind): number {
  return kind === 'text' ? 4096 : 1024;
}

export function defaultsForPhase(phase: PhaseKey, sort: number): ChainMessageInput {
  const base: ChainMessageInput = {
    title: 'Yangi xabar', kind: 'text', text: '', media_ids: [], buttons: [],
    trigger_type: 'after_registration', trigger_day: null, offset_minutes: 0,
    stuck_step: null, button_key: null, segment: 'all', required: false, status: 'draft', sort,
  };
  switch (phase) {
    case 'reg': return base;
    case 'day1': return { ...base, trigger_type: 'before_day', trigger_day: 1, offset_minutes: 120 };
    case 'between': return { ...base, trigger_type: 'after_day_end', trigger_day: 1, offset_minutes: 60, segment: 'day1_attended' };
    case 'day2': return { ...base, trigger_type: 'before_day', trigger_day: 2, offset_minutes: 120 };
    case 'after': return { ...base, trigger_type: 'after_day_end', trigger_day: 2, offset_minutes: 120, segment: 'not_paid' };
    case 'other': return { ...base, trigger_type: 'stuck', stuck_step: 'no_session', offset_minutes: 120 };
  }
}

export function toInput(m: ChainMessage): ChainMessageInput {
  return {
    title: m.title, kind: m.kind, text: m.text, media_ids: [...m.media_ids],
    buttons: m.buttons.map((r) => r.map((b) => ({ ...b }))),
    trigger_type: m.trigger_type, trigger_day: m.trigger_day, offset_minutes: m.offset_minutes,
    stuck_step: m.stuck_step, button_key: m.button_key, segment: m.segment, required: m.required,
    status: m.status, sort: m.sort,
  };
}

/** Saqlashdan oldin trigger turiga mos bo'lmagan maydonlarni tozalaydi. */
export function normalize(m: ChainMessageInput): ChainMessageInput {
  return {
    ...m,
    title: m.title.trim(),
    trigger_day: needsDay(m.trigger_type) ? (m.trigger_day ?? 1) : null,
    stuck_step: m.trigger_type === 'stuck' ? (m.stuck_step ?? 'no_session') : null,
    button_key: m.trigger_type === 'on_button' ? (m.button_key ?? '').trim() || null : null,
    media_ids: m.kind === 'text' ? [] : m.media_ids,
    text: m.kind === 'video_note' ? '' : m.text,
  };
}
