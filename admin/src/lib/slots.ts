import type { FunnelSettings } from '../api/types';
import { dayKey, dayLabel, fmtTime, tzParts, tzToUtc } from './time';

type SlotRules = Pick<FunnelSettings, 'slot_times' | 'weekdays' | 'excluded_dates' | 'min_hours_before' | 'options_count'>;

const DAY = 24 * 60 * 60 * 1000;

function dayAllowed(utcMs: number, s: SlotRules): boolean {
  const p = tzParts(utcMs);
  return s.weekdays.includes(p.wd) && !s.excluded_dates.includes(dayKey(utcMs));
}

/**
 * TZ §5: 1-kun ro'yxatdan kamida N soat keyin, keyingi kuni ham efir bo'lishi kerak
 * (2-kun = 1-kun + 24 soat), eng yaqin K ta variant.
 */
export function slotOptions(nowMs: number, s: SlotRules): number[] {
  const times = [...s.slot_times]
    .map((t) => /^(\d{1,2}):(\d{2})$/.exec(t))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [Number(m[1]), Number(m[2])] as const)
    .sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
  if (!times.length || !s.weekdays.length || s.options_count <= 0) return [];
  const earliest = nowMs + s.min_hours_before * 3600_000;
  const out: number[] = [];
  const start = tzParts(nowMs);
  for (let i = 0; i < 60 && out.length < s.options_count; i++) {
    const base = tzToUtc(start.y, start.m, start.d + i, 12, 0);
    if (!dayAllowed(base, s) || !dayAllowed(base + DAY, s)) continue;
    const p = tzParts(base);
    for (const [hh, mm] of times) {
      const t = tzToUtc(p.y, p.m, p.d, hh, mm);
      if (t >= earliest) out.push(t);
      if (out.length >= s.options_count) break;
    }
  }
  return out;
}

/** Tugma matni: "Bugun 20:00", "Ertaga 14:00", "Payshanba 14:00". */
export function slotButtonLabel(t: number, ref: number): string {
  return `${dayLabel(t, ref)} ${fmtTime(t)}`;
}
