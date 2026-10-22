/**
 * Vaqt yordamchilari. Barcha ko'rsatish Asia/Tashkent (UTC+5, yozgi vaqt yo'q).
 * Backend UTC ISO satr beradi va qabul qiladi.
 */
export const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
export const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
/** 0 = Dushanba … 6 = Yakshanba (shartnoma bilan bir xil). */
export const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
export const WEEKDAYS_SHORT = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

export const pad2 = (n: number) => String(n).padStart(2, '0');

type TimeInput = string | number | Date;
function ms(v: TimeInput): number {
  return v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
}

export interface TzParts { y: number; m: number; d: number; hh: number; mm: number; wd: number }
/** Toshkent vaqtidagi qismlar (m: 0-11, wd: 0=Dushanba). */
export function tzParts(v: TimeInput): TzParts {
  const t = new Date(ms(v) + TZ_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), wd: (t.getUTCDay() + 6) % 7 };
}

/** Toshkent mahalliy vaqtidan UTC ms. */
export function tzToUtc(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return Date.UTC(y, m, d, hh, mm) - TZ_OFFSET_MS;
}

function valid(v: TimeInput | null | undefined): v is TimeInput {
  return v !== null && v !== undefined && v !== '' && !Number.isNaN(ms(v));
}

export function fmtTime(v: TimeInput | null | undefined): string {
  if (!valid(v)) return '—';
  const p = tzParts(v);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** "23-oktabr" (boshqa yil bo'lsa "23-oktabr 2025"). */
export function fmtDate(v: TimeInput | null | undefined): string {
  if (!valid(v)) return '—';
  const p = tzParts(v);
  const y = tzParts(Date.now()).y;
  return `${p.d}-${MONTHS[p.m]}${p.y !== y ? ` ${p.y}` : ''}`;
}

/** "23-okt". */
export function fmtDateShort(v: TimeInput | null | undefined): string {
  if (!valid(v)) return '—';
  const p = tzParts(v);
  const y = tzParts(Date.now()).y;
  return `${p.d}-${MONTHS_SHORT[p.m]}${p.y !== y ? ` ${p.y}` : ''}`;
}

/** "23-okt, 20:00". */
export function fmtDateTime(v: TimeInput | null | undefined): string {
  if (!valid(v)) return '—';
  return `${fmtDateShort(v)}, ${fmtTime(v)}`;
}

/** "23-oktabr, 12:04". */
export function fmtDateTimeLong(v: TimeInput | null | undefined): string {
  if (!valid(v)) return '—';
  return `${fmtDate(v)}, ${fmtTime(v)}`;
}

/** "YYYY-MM-DD" — Toshkent kuni. */
export function dayKey(v: TimeInput): string {
  const p = tzParts(v);
  return `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`;
}

export function todayKey(): string {
  return dayKey(Date.now());
}

/** "YYYY-MM-DD" ni o'zbekcha ko'rinishga: "31-dekabr 2026". */
export function fmtDayKey(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const sameYear = Number(m[1]) === tzParts(Date.now()).y;
  return `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}${sameYear ? '' : ` ${m[1]}`}`;
}

/** "Bugun" / "Ertaga" / "Kecha" / "23-okt" — ref kuniga nisbatan. */
export function dayLabel(v: TimeInput, ref: TimeInput = Date.now()): string {
  const a = tzParts(v), b = tzParts(ref);
  const diff = Math.round((Date.UTC(a.y, a.m, a.d) - Date.UTC(b.y, b.m, b.d)) / DAY);
  if (diff === 0) return 'Bugun';
  if (diff === 1) return 'Ertaga';
  if (diff === -1) return 'Kecha';
  if (diff > 1 && diff < 7) return WEEKDAYS[a.wd];
  return fmtDateShort(v);
}

/** <input type="datetime-local"> qiymati (Toshkent). */
export function toLocalInput(v: TimeInput | null | undefined): string {
  if (!valid(v)) return '';
  const p = tzParts(v);
  return `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}T${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** datetime-local (Toshkent) → UTC ISO. Noto'g'ri bo'lsa null. */
export function fromLocalInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return new Date(tzToUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString();
}

function spanParts(diffMs: number): string {
  const min = Math.max(0, Math.round(diffMs / 60000));
  if (min < 1) return '1 daq';
  if (min < 60) return `${min} daq`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rest = min % 60;
    return rest && h < 10 ? `${h} soat ${rest} daq` : `${h} soat`;
  }
  const d = Math.floor(h / 24);
  return `${d} kun`;
}

/** Kelajakdagi vaqtgacha: "2 soat 14 daq", "20 soat", "3 kun"; o'tgan bo'lsa "boshlandi". */
export function untilLabel(v: TimeInput, now = Date.now()): string {
  const diff = ms(v) - now;
  if (diff <= 0) return 'boshlandi';
  return spanParts(diff);
}

/** O'tgan vaqt: "4 daq oldin", "3 soat oldin", "hozirgina". */
export function agoLabel(v: TimeInput | null | undefined, now = Date.now()): string {
  if (!valid(v)) return '—';
  const diff = now - ms(v);
  if (diff < 60000) return 'hozirgina';
  return `${spanParts(diff)} oldin`;
}
