/**
 * Server soati va Asia/Tashkent (UTC+5, yozgi vaqtsiz) formatlash.
 * Barcha taymerlar va pleyer pozitsiyasi serverNow() dan foydalanadi.
 */

let offsetMs = 0;

/**
 * Server vaqtiga moslash. requestStartedAt/receivedAt — so'rov yuborilgan va javob kelgan
 * Date.now() qiymatlari; tarmoq kechikishining yarmi hisobga olinadi.
 */
export function syncClock(serverTimeIso: string, requestStartedAt: number, receivedAt: number): void {
  const server = Date.parse(serverTimeIso);
  if (!Number.isFinite(server)) return;
  const midpoint = requestStartedAt + (receivedAt - requestStartedAt) / 2;
  offsetMs = server - midpoint;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Muddat 30 soniyadan ko'proq oldin o'tib ketganmi (eskirgan taymerni yashirish uchun). */
export function isLongPast(iso: string | null): boolean {
  if (!iso) return true;
  const ms = Date.parse(iso);
  return !Number.isFinite(ms) || serverNow() - ms > 30_000;
}

export function clockOffsetMs(): number {
  return offsetMs;
}

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;

const MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

// Date#getUTCDay(): 0 = yakshanba
const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

function tashkent(ms: number): Date {
  return new Date(ms + TZ_OFFSET_MS);
}

export function toMs(iso: string): number {
  return Date.parse(iso);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "20:00" */
export function formatClock(iso: string | number): string {
  const d = tashkent(typeof iso === 'number' ? iso : toMs(iso));
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** "23-oktabr" */
export function formatDayMonth(iso: string | number): string {
  const d = tashkent(typeof iso === 'number' ? iso : toMs(iso));
  return `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}`;
}

export function weekday(iso: string | number): string {
  const d = tashkent(typeof iso === 'number' ? iso : toMs(iso));
  return WEEKDAYS[d.getUTCDay()];
}

/** Toshkent bo'yicha kunlar farqi: 0 = bugun, 1 = ertaga, -1 = kecha. */
export function dayDiff(iso: string | number, nowMs: number = serverNow()): number {
  const target = tashkent(typeof iso === 'number' ? iso : toMs(iso));
  const now = tashkent(nowMs);
  const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}

/** "Bugun" | "Ertaga" | null */
export function relativeDay(iso: string | number, nowMs: number = serverNow()): string | null {
  const diff = dayDiff(iso, nowMs);
  if (diff === 0) return 'Bugun';
  if (diff === 1) return 'Ertaga';
  return null;
}

/** Kartochka uchun qismlar: chiziqcha bo'yicha uzilmasligi uchun alohida ko'rsatiladi. */
export function dateParts(iso: string, nowMs: number = serverNow()): { lead: string | null; dayMonth: string; tail: string | null } {
  const rel = relativeDay(iso, nowMs);
  return rel
    ? { lead: rel, dayMonth: formatDayMonth(iso), tail: null }
    : { lead: null, dayMonth: formatDayMonth(iso), tail: weekday(iso) };
}

/** Gap ichida: "bugun soat 20:00", "kecha soat 20:00", "23-oktabr soat 20:00" */
export function formatWhenInSentence(iso: string, nowMs: number = serverNow()): string {
  const diff = dayDiff(iso, nowMs);
  const day = diff === 0 ? 'bugun' : diff === 1 ? 'ertaga' : diff === -1 ? 'kecha' : formatDayMonth(iso);
  return `${day} soat ${formatClock(iso)}`;
}

/** "Ertaga, 20:00" yoki "25-oktabr, 20:00" */
export function formatWhen(iso: string, nowMs: number = serverNow()): string {
  const rel = relativeDay(iso, nowMs);
  return `${rel ?? formatDayMonth(iso)}, ${formatClock(iso)}`;
}

/** "26-oktabr, 21:22" */
export function formatDateTime(iso: string): string {
  return `${formatDayMonth(iso)}, ${formatClock(iso)}`;
}

/** Video vaqti: 760 -> "12:40", 4440 -> "74:00" (daqiqalar 60 dan oshishi mumkin). */
export function formatVideoTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

export interface Remaining {
  total: number; // soniya
  hours: number; // umumiy soat (24 dan oshishi mumkin)
  minutes: number;
  seconds: number;
}

export function remaining(targetMs: number, nowMs: number): Remaining {
  const total = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return {
    total,
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** "47:12:05" */
export function formatHms(r: Remaining): string {
  return `${pad2(r.hours)}:${pad2(r.minutes)}:${pad2(r.seconds)}`;
}

export { pad2 };
