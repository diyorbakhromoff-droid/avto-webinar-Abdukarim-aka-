/** Telegram WebApp SDK ustidan yupqa qatlam (faqat ishlatiladigan qismlar). */

interface TelegramWebApp {
  initData: string;
  version: string;
  platform: string;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const IS_MOCK = import.meta.env.VITE_MOCK === '1';

function webApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

export function getInitData(): string {
  return webApp()?.initData ?? '';
}

function atLeast(v: string): boolean {
  const tg = webApp();
  try {
    return !!tg && tg.isVersionAtLeast(v);
  } catch {
    return false;
  }
}

export function initTelegram(): void {
  const tg = webApp();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (atLeast('7.7')) tg.disableVerticalSwipes?.();
  } catch {
    /* Telegram tashqarisida — e'tiborsiz */
  }
}

/** Telegram sarlavha va fon rangini voronka mavzusiga moslash. */
export function applyTelegramColors(bg: string): void {
  const tg = webApp();
  if (!tg || !/^#[0-9a-f]{6}$/i.test(bg)) return;
  try {
    if (atLeast('6.1')) {
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
    }
    if (atLeast('7.10')) tg.setBottomBarColor?.(bg);
  } catch {
    /* eski klient */
  }
}

export function haptic(kind: 'tap' | 'success' | 'error' = 'tap'): void {
  const h = webApp()?.HapticFeedback;
  if (!h || !atLeast('6.1')) return;
  try {
    if (kind === 'tap') h.impactOccurred('light');
    else h.notificationOccurred(kind);
  } catch {
    /* yo'q */
  }
}

type CloseListener = () => void;
let mockCloseListener: CloseListener | null = null;

/** Faqat mock rejimda: yopish o'rniga xabar ko'rsatish uchun. */
export function onMockClose(fn: CloseListener | null): void {
  mockCloseListener = fn;
}

/** Mini App ni yopadi — bot suhbatda davom ettiradi. */
export function closeApp(): void {
  if (IS_MOCK) {
    console.info('[mock] Telegram.WebApp.close()');
    mockCloseListener?.();
    return;
  }
  const tg = webApp();
  try {
    tg?.close();
  } catch {
    /* Telegram tashqarisida */
  }
}
