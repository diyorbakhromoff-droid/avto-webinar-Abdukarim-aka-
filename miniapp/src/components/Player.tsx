import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type Hls from 'hls.js';
import { sendHeartbeat } from '../api/client';
import { haptic } from '../lib/telegram';
import { formatVideoTime, serverNow } from '../lib/time';
import { IconExitFullscreen, IconFullscreen, IconMuted, IconPlay, IconVolume } from './Icons';

/**
 * Sinxron pleyer: pozitsiya = (server vaqti − efir boshlanishi).
 * Pauza, o'tkazish va tezlik yo'q; faqat ovoz va to'liq ekran.
 * Farq 5 soniyadan oshsa, server pozitsiyasiga qaytadi.
 */

interface Props {
  hlsUrl: string;
  startAtMs: number;
  durationSec: number;
  sessionId: number;
  day: 1 | 2;
  /** Ko'rsatish uchun pozitsiya (soniya), ota komponent har soniyada hisoblaydi */
  positionSec: number;
  /** Ixcham ko'rinish (sotuv bloki chiqqanda): vaqt yozuvi yuqori panelda */
  compact?: boolean;
  title?: string;
  artist?: string;
  onEnded(): void;
}

const DRIFT_LIMIT_SEC = 5;
const FIRST_ALIGN_SEC = 1.5;
const HEARTBEAT_MS = 30_000;
const SEEK_GUARD_SEC = 3;

type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};
type WebkitDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type WebkitEl = HTMLElement & { webkitRequestFullscreen?: () => void };

function isApple(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  return iOS || safari;
}

function fullscreenElement(): Element | null {
  const d = document as WebkitDoc;
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

const BLOCKED_KEYS = new Set([
  ' ',
  'k',
  'K',
  'j',
  'J',
  'l',
  'L',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  '<',
  '>',
  ',',
  '.',
  'MediaPlayPause',
  'MediaPause',
  'MediaPlay',
  'MediaStop',
  'MediaTrackNext',
  'MediaTrackPrevious',
  'MediaFastForward',
  'MediaRewind',
]);

export function Player({
  hlsUrl,
  startAtMs,
  durationSec,
  sessionId,
  day,
  positionSec,
  compact,
  title,
  artist,
  onEnded,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const latestUrlRef = useRef(hlsUrl);
  latestUrlRef.current = hlsUrl;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  /** Lid "Ko'rishni boshlash" ni bosganmi (ijro ruxsati bor) */
  const startedRef = useRef(false);
  const alignedRef = useRef(false);
  const heartbeatSentRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [fs, setFs] = useState<'none' | 'native' | 'pseudo'>('none');
  const [fatal, setFatal] = useState<string | null>(null);

  const expected = useCallback(() => (serverNow() - startAtMs) / 1000, [startAtMs]);
  const target = useCallback(
    () => Math.min(Math.max(expected(), 0), Math.max(durationSec - 0.5, 0)),
    [expected, durationSec],
  );

  const heartbeat = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    sendHeartbeat({ session_id: sessionId, day, position_sec: Math.floor(v.currentTime) }).catch(() => {
      /* keyingi urinishda */
    });
  }, [sessionId, day]);

  const tryPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !startedRef.current || v.ended) return;
    if (expected() < 0) return; // efir hali boshlanmagan (soat farqi)
    if (expected() >= durationSec) return;
    const p = v.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err: unknown) => {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError') {
          // Brauzer ruxsat bermadi — tugmani qayta ko'rsatamiz
          startedRef.current = false;
          setStarted(false);
        }
      });
    }
  }, [expected, durationSec]);

  const syncNow = useCallback(
    (threshold: number) => {
      const v = videoRef.current;
      if (!v || v.readyState < 1) return;
      const t = target();
      if (Math.abs(v.currentTime - t) > threshold) {
        try {
          v.currentTime = t;
        } catch {
          /* metadata hali yo'q */
        }
      }
    },
    [target],
  );

  // ── Manba ulash (hls.js yoki native HLS) ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let destroyed = false;
    let retryTimer = 0;

    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('x-webkit-airplay', 'deny');
    v.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback noplaybackrate');
    v.setAttribute('disablePictureInPicture', '');
    v.setAttribute('disableRemotePlayback', '');

    const nativeOk = v.canPlayType('application/vnd.apple.mpegurl') !== '';

    const attachNative = () => {
      v.src = latestUrlRef.current;
      v.preload = 'auto';
      v.load();
    };

    if (nativeOk && isApple()) {
      attachNative();
    } else {
      import('hls.js')
        .then(({ default: HlsCtor }) => {
          if (destroyed) return;
          if (!HlsCtor.isSupported()) {
            if (nativeOk) attachNative();
            else setFatal("Bu qurilmada video ochilmadi. Telegram ilovasini yangilab, qayta oching.");
            return;
          }
          const hls = new HlsCtor({
            startPosition: Math.max(0, target()),
            capLevelToPlayerSize: true,
            maxBufferLength: 30,
            backBufferLength: 30,
            enableWorker: true,
          });
          hlsRef.current = hls;
          let loadedUrl = latestUrlRef.current;
          let mediaRecoveries = 0;
          hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
            if (!data.fatal || destroyed) return;
            if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 3) {
              mediaRecoveries += 1;
              hls.recoverMediaError();
              return;
            }
            // Tarmoq xatosi: biroz kutib, eng so'nggi (yangi imzolangan) havola bilan qayta yuklash
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => {
              if (destroyed) return;
              const url = latestUrlRef.current;
              hls.stopLoad();
              if (url !== loadedUrl || data.details === HlsCtor.ErrorDetails.MANIFEST_LOAD_ERROR) {
                loadedUrl = url;
                hls.loadSource(url);
              }
              hls.startLoad(Math.max(0, target()));
              alignedRef.current = false;
            }, 3000);
          });
          hls.attachMedia(v);
          hls.loadSource(loadedUrl);
        })
        .catch(() => {
          if (!destroyed) setFatal("Pleyer yuklanmadi. Internetni tekshirib, sahifani qayta oching.");
        });
    }

    const onNativeError = () => {
      if (hlsRef.current || destroyed) return;
      const err = v.error;
      if (!err) return;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        if (destroyed) return;
        attachNative();
        alignedRef.current = false;
        tryPlay();
      }, 3000);
    };
    v.addEventListener('error', onNativeError);

    return () => {
      destroyed = true;
      window.clearTimeout(retryTimer);
      v.removeEventListener('error', onNativeError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      v.removeAttribute('src');
      try {
        v.load();
      } catch {
        /* */
      }
    };
    // Manba faqat bir marta ulanadi; yangi imzolangan havola latestUrlRef orqali xatoda ishlatiladi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Video hodisalari: pauza / o'tkazish / tezlikni bloklash ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onSeeking = () => {
      if (!startedRef.current) return;
      if (Math.abs(v.currentTime - target()) > SEEK_GUARD_SEC) {
        try {
          v.currentTime = target();
        } catch {
          /* */
        }
      }
    };
    const onPause = () => {
      if (!startedRef.current || v.ended || document.visibilityState === 'hidden') return;
      if (expected() >= durationSec) return;
      window.setTimeout(tryPlay, 50);
    };
    const onRate = () => {
      if (v.playbackRate !== 1) v.playbackRate = 1;
      if (v.defaultPlaybackRate !== 1) v.defaultPlaybackRate = 1;
    };
    const onMeta = () => {
      if (startedRef.current) syncNow(FIRST_ALIGN_SEC);
    };
    const onPlaying = () => {
      setBuffering(false);
      if (!alignedRef.current) {
        syncNow(FIRST_ALIGN_SEC);
        alignedRef.current = true;
      }
      if (!heartbeatSentRef.current) {
        heartbeatSentRef.current = true;
        heartbeat();
      }
    };
    const onWaiting = () => setBuffering(true);
    const onCanPlay = () => setBuffering(false);
    const onVolume = () => setMuted(v.muted);
    const onEndedEvt = () => onEndedRef.current();
    const onEndFs = () => {
      setFs('none');
      window.setTimeout(tryPlay, 50);
    };
    const onBeginFs = () => setFs('native');

    v.addEventListener('seeking', onSeeking);
    v.addEventListener('pause', onPause);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('volumechange', onVolume);
    v.addEventListener('ended', onEndedEvt);
    v.addEventListener('webkitbeginfullscreen', onBeginFs);
    v.addEventListener('webkitendfullscreen', onEndFs);
    return () => {
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('volumechange', onVolume);
      v.removeEventListener('ended', onEndedEvt);
      v.removeEventListener('webkitbeginfullscreen', onBeginFs);
      v.removeEventListener('webkitendfullscreen', onEndFs);
    };
  }, [durationSec, expected, heartbeat, syncNow, target, tryPlay]);

  // ── Sinxronlash tsikli (har soniya) ──
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || !startedRef.current) return;
      const exp = expected();
      if (exp >= durationSec) {
        if (!v.paused) v.pause();
        onEndedRef.current();
        return;
      }
      if (exp < 0) return;
      if (v.paused) {
        if (document.visibilityState === 'visible') tryPlay();
        return;
      }
      syncNow(alignedRef.current ? DRIFT_LIMIT_SEC : FIRST_ALIGN_SEC);
      if (v.playbackRate !== 1) v.playbackRate = 1;
    }, 1000);
    return () => window.clearInterval(id);
  }, [durationSec, expected, syncNow, tryPlay]);

  // ── Heartbeat (har 30 s, faqat ijro paytida) ──
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (v && startedRef.current && !v.paused && !v.ended) heartbeat();
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [heartbeat]);

  // ── Fondan qaytganda: server pozitsiyasiga moslash va davom ettirish ──
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || !startedRef.current) return;
      syncNow(DRIFT_LIMIT_SEC);
      tryPlay();
    };
    const onOnline = () => {
      if (!startedRef.current) return;
      syncNow(DRIFT_LIMIT_SEC);
      hlsRef.current?.startLoad(Math.max(0, target()));
      tryPlay();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  }, [syncNow, target, tryPlay]);

  // ── Media Session: qulf ekranidagi o'tkazish/pauza tugmalarini o'chirish ──
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const noop = () => {
      /* bloklangan */
    };
    const actions: MediaSessionAction[] = ['pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'];
    actions.forEach((a) => {
      try {
        ms.setActionHandler(a, noop);
      } catch {
        /* qo'llab-quvvatlanmaydi */
      }
    });
    try {
      if (title && typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({ title, artist: artist ?? '' });
      }
    } catch {
      /* */
    }
    return () => {
      actions.forEach((a) => {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* */
        }
      });
    };
  }, [title, artist]);

  // ── To'liq ekran holatini kuzatish ──
  useEffect(() => {
    const onChange = () => {
      if (!fullscreenElement()) setFs((s) => (s === 'native' ? 'none' : s));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  /** Foydalanuvchi bosishi bilan (iOS uchun sinxron) ijroni boshlash */
  const start = () => {
    const v = videoRef.current;
    if (!v) return;
    haptic('tap');
    startedRef.current = true;
    setStarted(true);
    v.muted = false;
    setMuted(false);
    if (v.readyState >= 1) syncNow(FIRST_ALIGN_SEC);
    const p = v.play();
    if (expected() < 0) {
      // Efir bir necha soniyadan keyin boshlanadi: element "ochildi", 0 da kutamiz
      p?.then(() => v.pause()).catch(() => undefined);
      return;
    }
    p?.catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') {
        startedRef.current = false;
        setStarted(false);
      }
    });
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    haptic('tap');
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current as WebkitEl | null;
    const v = videoRef.current as WebkitVideo | null;
    if (!el || !v) return;
    haptic('tap');
    if (fs === 'pseudo') {
      setFs('none');
      return;
    }
    if (fullscreenElement()) {
      const d = document as WebkitDoc;
      if (document.exitFullscreen) document.exitFullscreen().catch(() => undefined);
      else d.webkitExitFullscreen?.();
      setFs('none');
      return;
    }
    if (typeof el.requestFullscreen === 'function') {
      el.requestFullscreen()
        .then(() => {
          setFs('native');
          const orientation = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>;
          };
          orientation?.lock?.('landscape').catch(() => undefined);
        })
        .catch(() => setFs('pseudo'));
      return;
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      el.webkitRequestFullscreen();
      setFs('native');
      return;
    }
    if (typeof v.webkitEnterFullscreen === 'function') {
      // iPhone: tizim pleyeri; pauza/o'tkazish hodisalari yuqoridagi himoya bilan qaytariladi
      try {
        v.webkitEnterFullscreen();
        return;
      } catch {
        /* pseudo ga o'tamiz */
      }
    }
    setFs('pseudo');
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const isButton = (e.target as HTMLElement).tagName === 'BUTTON';
    if (isButton && (e.key === ' ' || e.key === 'Enter')) return;
    if (BLOCKED_KEYS.has(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === 'Escape' && fs === 'pseudo') setFs('none');
  };

  const pos = Math.min(Math.max(positionSec, 0), durationSec);
  const pct = durationSec > 0 ? (pos / durationSec) * 100 : 0;
  const finished = positionSec >= durationSec;
  const beforeStart = expected() < 0;

  return (
    <div
      ref={wrapRef}
      className={`player${compact ? ' player--compact' : ''}${fs !== 'none' ? ' player--fs' : ''}${
        fs === 'pseudo' ? ' player--pseudo-fs' : ''
      }`}
      onKeyDownCapture={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        className="player__video"
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-label={title ? `Video: ${title}` : 'Video'}
        onClick={(e) => e.preventDefault()}
        onDoubleClick={(e) => e.preventDefault()}
      />

      {buffering && started && !finished && (
        <div className="player__spinner" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">Video yuklanmoqda</span>
        </div>
      )}

      {fatal && (
        <div className="player__cover player__cover--msg" role="alert">
          <p>{fatal}</p>
        </div>
      )}

      {!fatal && finished && (
        <div className="player__cover player__cover--msg">
          <p>Video yakunlandi</p>
        </div>
      )}

      {!fatal && !finished && !started && (
        <div className="player__cover">
          <button type="button" className="player__start" onClick={start}>
            <IconPlay size={22} />
            Ko'rishni boshlash
          </button>
          <div className="player__cover-note">
            {beforeStart
              ? `Video ${Math.ceil(-expected())} soniyadan keyin boshlanadi`
              : pos < 10
                ? 'Video boshidan ko\'rsatiladi'
                : `Video ${formatVideoTime(pos)} dan davom etadi`}
          </div>
        </div>
      )}

      <div className="player__controls">
        <button
          type="button"
          className="icon-btn"
          aria-label={muted ? 'Ovozni yoqish' : "Ovozni o'chirish"}
          aria-pressed={muted}
          onClick={toggleMute}
        >
          {muted ? <IconMuted /> : <IconVolume />}
        </button>
        <div
          className="player__progress"
          role="progressbar"
          aria-label="Video davomiyligi"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec)}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${formatVideoTime(pos)} / ${formatVideoTime(durationSec)}`}
        >
          <div className="player__progress-fill" style={{ width: `${pct}%` }} />
        </div>
        {!compact && (
          <div className="player__time" aria-hidden="true">
            {formatVideoTime(pos)} / {formatVideoTime(durationSec)}
          </div>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={fs !== 'none' ? "To'liq ekrandan chiqish" : "To'liq ekran"}
          onClick={toggleFullscreen}
        >
          {fs !== 'none' ? <IconExitFullscreen /> : <IconFullscreen />}
        </button>
      </div>
    </div>
  );
}
