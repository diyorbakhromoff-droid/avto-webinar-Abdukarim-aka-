import type { TimingMessage, TimingPage, TriggerType } from '../api/types';
import { tzParts } from './time';

/** Tugma bilan tanlanadigan oraliqlar (daqiqa). */
export const PRESETS: { min: number; label: string }[] = [
  { min: 5, label: '5 daqiqa' }, { min: 10, label: '10 daqiqa' }, { min: 15, label: '15 daqiqa' },
  { min: 30, label: '30 daqiqa' }, { min: 60, label: '1 soat' }, { min: 120, label: '2 soat' },
  { min: 180, label: '3 soat' }, { min: 360, label: '6 soat' }, { min: 720, label: '12 soat' },
  { min: 1440, label: '24 soat' },
];

/** Vaqt sahifasidagi «Qachon» tanlovi. prev — oldingi xabardan keyin (ro'yxatdan keyingi xabarlar ichida). */
export type WhenMode = TriggerType | 'prev';

export const WHEN_OPTIONS: { value: WhenMode; label: string }[] = [
  { value: 'after_registration', label: "Ro'yxatdan o'tgach" },
  { value: 'prev', label: 'Oldingi xabardan keyin' },
  { value: 'before_day', label: 'Efir boshlanishidan oldin' },
  { value: 'at_day_start', label: 'Efir boshlangach' },
  { value: 'after_day_end', label: 'Efir tugagach' },
  { value: 'before_deadline', label: 'Deadline tugashidan oldin' },
  { value: 'at_datetime', label: 'Aniq sana va vaqtda' },
];

/** Lidning o'z harakatiga bog'liq xabarlar — vaqti hodisadan keyin hisoblanadi, turi bu yerda o'zgarmaydi. */
export const EVENT_TRIGGERS: ReadonlySet<TriggerType> = new Set<TriggerType>(['stuck', 'left_live', 'on_button']);
export const DAY_TRIGGERS: ReadonlySet<WhenMode> = new Set<WhenMode>(['before_day', 'at_day_start', 'after_day_end']);
export const BEFORE: ReadonlySet<WhenMode> = new Set<WhenMode>(['before_day', 'before_deadline']);

/** Namunaviy lid uchun yuborish vaqti (siqish va tungi tinchlikni hisobga olmagan holda). */
export function previewAt(trigger: TriggerType, day: 1 | 2 | null, offset: number, fixedAt: string | null,
  s: TimingPage['sample']): number | null {
  const m = offset * 60_000;
  const d = day ?? 1;
  switch (trigger) {
    case 'after_registration': return Date.parse(s.registered_at) + m;
    case 'before_day': return Date.parse(d === 1 ? s.day1_at : s.day2_at) - m;
    case 'at_day_start': return Date.parse(d === 1 ? s.day1_at : s.day2_at) + m;
    case 'after_day_end': return Date.parse(d === 1 ? s.day1_end : s.day2_end) + m;
    case 'before_deadline': return Date.parse(s.deadline_at) - m;
    case 'at_datetime': return fixedAt ? Date.parse(fixedAt) : null;
    default: return null;
  }
}

/** "HH:MM" oralig'iga tushadimi (Toshkent vaqti; 23:00–08:00 kabi yarim tundan o'tadigan oraliq ham). */
export function inQuiet(t: number, start: string, end: string): boolean {
  const p = tzParts(t);
  const cur = p.hh * 60 + p.mm;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const a = sh * 60 + sm, b = eh * 60 + em;
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

/** Ikki vaqt orasidagi farq: "45 daq", "2 soat 15 daq", "1 kun 3 soat". */
export function gapLabel(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min === 0) return 'shu vaqtda';
  if (min < 60) return `${min} daq`;
  const h = Math.floor(min / 60), r = min % 60;
  if (h < 24) return r ? `${h} soat ${r} daq` : `${h} soat`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} kun ${rh} soat` : `${d} kun`;
}

/** Ro'yxatdan keyingi xabarlar ichida berilgan xabardan oldingisi (o'zi hisobga olinmaydi). */
export function previousReg(all: TimingMessage[], self: TimingMessage): TimingMessage | null {
  const reg = all.filter((x) => x.id !== self.id && x.status === 'active' && x.trigger_type === 'after_registration')
    .sort((a, b) => a.offset_minutes - b.offset_minutes || a.sort - b.sort);
  if (self.trigger_type !== 'after_registration') return reg[reg.length - 1] ?? null;
  const before = reg.filter((x) => x.offset_minutes < self.offset_minutes
    || (x.offset_minutes === self.offset_minutes && (x.sort < self.sort || (x.sort === self.sort && x.id < self.id))));
  return before[before.length - 1] ?? null;
}
