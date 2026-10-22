/** Raqam va pul formatlari. Pul: "1 990 000 so'm". */
const NBSP = ' ';

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (neg ? '−' : '') + grouped + (frac ? `.${frac.slice(0, 2)}` : '');
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${num(Math.round(n))}${NBSP}so'm`;
}

/** Ulush (0..1) → "52%" yoki "6.3%". */
export function pct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return '—';
  const v = rate * 100;
  if (v !== 0 && Math.abs(v) < 10) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
}

/** Faqat raqamlar: "1 990 000" → 1990000. Bo'sh/noto'g'ri → null. */
export function parseMoney(s: string): number | null {
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return null;
  return Number(digits);
}

/** "Qancha vaqtdan beri": "15 daq", "3 soat", "1 kun". */
export function sinceLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'hozirgina';
  if (min < 60) return `${min} daq`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} soat`;
  return `${Math.floor(h / 24)} kun`;
}

/** Soniya → "58:00" (daqiqa 59 dan oshishi mumkin: "74:30"). */
export function timecode(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "mm:ss", "h:mm:ss" yoki faqat daqiqa ("74" yoki "74.5") → soniya.
 * Noto'g'ri bo'lsa null.
 */
export function parseTimecode(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);
  const m = /^(\d+):([0-5]?\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const h = /^(\d+):([0-5]?\d):([0-5]?\d)$/.exec(s);
  if (h) return Number(h[1]) * 3600 + Number(h[2]) * 60 + Number(h[3]);
  return null;
}

/** Daqiqa → "2 soat", "15 daq", "1 kun", "1 soat 30 daq". */
export function offsetLabel(min: number): string {
  const a = Math.abs(min);
  if (a === 0) return '0 daq';
  if (a % 1440 === 0) return `${a / 1440} kun`;
  if (a >= 60) {
    const h = Math.floor(a / 60), r = a % 60;
    return r ? `${h} soat ${r} daq` : `${h} soat`;
  }
  return `${a} daq`;
}

export type OffsetUnit = 'min' | 'hour' | 'day';
export const UNIT_MIN: Record<OffsetUnit, number> = { min: 1, hour: 60, day: 1440 };
export const UNIT_LABEL: Record<OffsetUnit, string> = { min: 'daqiqa', hour: 'soat', day: 'kun' };

/** Daqiqani eng katta butun birlikka ajratadi: 120 → {2, 'hour'}. */
export function splitOffset(min: number): { value: number; unit: OffsetUnit } {
  if (min !== 0 && min % 1440 === 0) return { value: min / 1440, unit: 'day' };
  if (min !== 0 && min % 60 === 0) return { value: min / 60, unit: 'hour' };
  return { value: min, unit: 'min' };
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Faqat butun musbat son; bo'sh → fallback. */
export function intOr(s: string, fallback: number): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}
