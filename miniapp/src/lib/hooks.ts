import { useCallback, useEffect, useRef, useState } from 'react';
import { serverNow } from './time';
import { sendOfferClick, sendReschedule } from '../api/client';
import { closeApp, haptic } from './telegram';
import { toast } from '../components/Toast';

/**
 * Server vaqti (ms), har soniya chegarasida yangilanadi.
 * Sahifa fondan qaytganda darhol yangilanadi (fon rejimida taymerlar sekinlashadi).
 */
export function useServerNow(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const n = serverNow();
      setNow(n);
      timer = window.setTimeout(tick, 1000 - (n % 1000) + 15);
    };
    timer = window.setTimeout(tick, 1000 - (serverNow() % 1000) + 15);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return now;
}

/**
 * Taymer nolga yetganda onDone chaqiriladi; server holati hali o'zgarmagan bo'lsa,
 * har 5 soniyada qayta chaqiriladi (ko'pi bilan 6 marta — keyin 60 s lik umumiy yangilanish ishlaydi).
 */
export function useOnReached(targetMs: number | null, nowMs: number, onDone?: () => void): void {
  const lastRef = useRef(0);
  const attemptsRef = useRef(0);
  const cbRef = useRef(onDone);
  cbRef.current = onDone;
  useEffect(() => {
    attemptsRef.current = 0;
    lastRef.current = 0;
  }, [targetMs]);
  useEffect(() => {
    if (targetMs === null || !Number.isFinite(targetMs) || !cbRef.current) return;
    if (nowMs < targetMs || attemptsRef.current >= 6) return;
    const t = Date.now();
    if (t - lastRef.current < 5000) return;
    lastRef.current = t;
    attemptsRef.current += 1;
    cbRef.current();
  }, [targetMs, nowMs]);
}

export type ActionKind = 'reschedule' | 'offer';

/**
 * Botga yo'naltiruvchi amallar: so'rov yuboriladi, keyin Mini App yopiladi
 * (bot suhbatda davom ettiradi).
 */
export function useBotAction() {
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(async (kind: ActionKind, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    haptic('tap');
    try {
      await fn();
      haptic('success');
      closeApp();
    } catch {
      haptic('error');
      toast("Xatolik yuz berdi. Qayta urinib ko'ring.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  const reschedule = useCallback(() => run('reschedule', sendReschedule), [run]);
  const offerClick = useCallback(
    (tariffId: number | null) => run('offer', () => sendOfferClick(tariffId)),
    [run],
  );

  return { busy, reschedule, offerClick };
}
