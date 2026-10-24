import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ApiError, fetchState } from './api/client';
import type { AppStateResponse } from './api/types';
import { Toaster, toast } from './components/Toast';
import { applyTelegramColors, IS_MOCK, onMockClose } from './lib/telegram';
import { Between } from './screens/Between';
import { Ended } from './screens/Ended';
import { ErrorScreen, LoadingScreen } from './screens/ErrorScreen';
import { Live } from './screens/Live';
import { Missed } from './screens/Missed';
import { NoSession } from './screens/NoSession';
import { Waiting } from './screens/Waiting';

const MockSwitcher = IS_MOCK ? lazy(() => import('./components/MockSwitcher')) : null;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; status: number }
  | { kind: 'ready'; data: AppStateResponse };

const SAFETY_REFRESH_MS = 60_000;
const MIN_REFRESH_GAP_MS = 3_000;
/** styles.css dagi standart palitra bilan bir xil (backend standarti ham shu). */
const DEFAULT_BG = '#0e1726';
const DEFAULT_PRIMARY = '#5b9bef';
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Voronka mavzusi (funnel.theme) → CSS o'zgaruvchilari; standart — palitra. */
function applyTheme(theme: AppStateResponse['funnel']['theme']): void {
  const root = document.documentElement;
  if (HEX.test(theme.primary)) {
    root.style.setProperty('--primary', theme.primary);
    // Standartdan farqli rang: bosilgan holat (--primary-strong) shu rangdan hosil qilinadi
    if (theme.primary.toLowerCase() !== DEFAULT_PRIMARY) root.setAttribute('data-custom-primary', '');
    else root.removeAttribute('data-custom-primary');
  } else {
    root.style.removeProperty('--primary');
    root.removeAttribute('data-custom-primary');
  }

  if (HEX.test(theme.background)) {
    root.style.setProperty('--bg', theme.background);
    if (theme.background.toLowerCase() !== DEFAULT_BG) root.setAttribute('data-custom-bg', '');
    else root.removeAttribute('data-custom-bg');
    applyTelegramColors(theme.background);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);
  } else {
    root.style.removeProperty('--bg');
    root.removeAttribute('data-custom-bg');
    applyTelegramColors(DEFAULT_BG.toUpperCase());
  }

  const img = theme.bg_image_url;
  if (img && /^https?:\/\//i.test(img)) {
    root.style.setProperty('--bg-image', `url("${img.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`);
  } else {
    root.style.removeProperty('--bg-image');
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [offline, setOffline] = useState(false);

  const hasData = useRef(false);
  const inflight = useRef(false);
  const queued = useRef(false);
  const lastFetch = useRef(0);
  const timer = useRef(0);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const load = useCallback(async () => {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    lastFetch.current = Date.now();
    try {
      const data = await fetchState();
      hasData.current = true;
      applyTheme(data.funnel.theme);
      setPhase({ kind: 'ready', data });
      setOffline(false);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401 || status === 403 || !hasData.current) {
        hasData.current = false;
        setPhase({ kind: 'error', status });
      } else {
        // Ma'lumot bor — ekranni saqlab qolamiz, keyingi urinishda yangilanadi
        setOffline(true);
      }
    } finally {
      inflight.current = false;
      if (queued.current) {
        queued.current = false;
        window.setTimeout(() => void loadRef.current(), MIN_REFRESH_GAP_MS);
      }
    }
  }, []);
  loadRef.current = load;

  /** Holatni qayta so'rash (taymer nolga yetganda, video tugaganda va h.k.), 3 s da bir martadan ko'p emas. */
  const refresh = useCallback(() => {
    const wait = lastFetch.current + MIN_REFRESH_GAP_MS - Date.now();
    if (wait <= 0) {
      void load();
      return;
    }
    if (!timer.current) {
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        void load();
      }, wait);
    }
  }, [load]);

  const reload = useCallback(() => {
    hasData.current = false;
    setPhase({ kind: 'loading' });
    lastFetch.current = 0;
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    const safety = window.setInterval(refresh, SAFETY_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    if (IS_MOCK) onMockClose(() => toast('[mock] Mini App yopildi — bot suhbatda davom etadi'));
    return () => {
      window.clearInterval(safety);
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      onMockClose(null);
    };
  }, [load, refresh]);

  let screen: ReactElement;
  if (phase.kind === 'loading') {
    screen = <LoadingScreen />;
  } else if (phase.kind === 'error') {
    screen = <ErrorScreen status={phase.status} onRetry={reload} />;
  } else {
    const { data } = phase;
    switch (data.state) {
      case 'waiting':
        screen = data.session ? (
          <Waiting data={data} session={data.session} onRefresh={refresh} />
        ) : (
          <NoSession data={data} />
        );
        break;
      case 'live':
        screen =
          data.live && data.session ? (
            <Live
              key={`${data.session.id}-${data.live.day}-${data.live.start_at}`}
              data={data}
              live={data.live}
              session={data.session}
              onRefresh={refresh}
            />
          ) : (
            <ErrorScreen status={500} onRetry={reload} />
          );
        break;
      case 'between':
        screen = <Between data={data} onRefresh={refresh} />;
        break;
      case 'missed':
      case 'closed':
        screen = <Missed data={data} />;
        break;
      case 'ended':
        screen = <Ended data={data} onRefresh={refresh} />;
        break;
      case 'no_session':
      default:
        screen = <NoSession data={data} />;
    }
  }

  return (
    <div className="app">
      {offline && (
        <div className="offline" role="status">
          Internet aloqasi uzildi — qayta ulanmoqda…
        </div>
      )}
      {screen}
      <Toaster />
      {MockSwitcher && (
        <Suspense fallback={null}>
          <MockSwitcher onSwitch={reload} />
        </Suspense>
      )}
    </div>
  );
}
