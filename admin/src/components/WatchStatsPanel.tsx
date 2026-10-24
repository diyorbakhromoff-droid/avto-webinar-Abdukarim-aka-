import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/admin';
import type { WatchBucket, WatchStats } from '../api/types';
import { num } from '../lib/format';
import { pad2 } from '../lib/time';
import { useLoad } from '../lib/useLoad';
import { Empty, ErrorBox, Loading, Segmented } from './ui';

export interface WatchStatsScope {
  date_from?: string;
  date_to?: string;
  source?: string;
  slot?: string;
}

/** Videoning daqiqasi: 60 daqiqadan uzun videoda "0:40", "1:05"; qisqasida "40:00". */
export function fmtVideoMinute(minute: number, durationMin: number): string {
  if (durationMin > 60) return `${Math.floor(minute / 60)}:${pad2(minute % 60)}`;
  return `${minute}:00`;
}

const pctInt = (share: number) => `${Math.round(share * 100)}%`;

function fmtDrop(d: number): string {
  if (d >= 0.005) return `−${Math.round(d * 100)}%`;
  if (d <= -0.005) return `+${Math.round(-d * 100)}%`;
  return '0';
}

/** Ulushni oraliqdagi ikki nuqta orasida chiziqli hisoblaydi. */
function shareAt(buckets: WatchBucket[], minute: number): number | null {
  if (!buckets.length) return null;
  let prev = buckets[0];
  if (minute <= prev.minute) return prev.share;
  for (const b of buckets) {
    if (b.minute >= minute) {
      const k = b.minute === prev.minute ? 0 : (minute - prev.minute) / (b.minute - prev.minute);
      return prev.share + (b.share - prev.share) * k;
    }
    prev = b;
  }
  return prev.share;
}

/** Bir jumlali xulosa: "Eng katta tushish 35–40-daqiqalarda: 18 kishi chiqib ketdi; ofertagacha 54% qoladi." */
export function watchTakeaway(w: WatchStats): string {
  const top = w.top_drops[0];
  let s = top
    ? `Eng katta tushish ${top.from_minute}–${top.to_minute}-daqiqalarda: ${num(top.left)} kishi chiqib ketdi`
    : "Sezilarli chiqib ketish yo'q";
  const offer = w.offer_min !== null ? shareAt(w.buckets, w.offer_min) : null;
  if (w.offer_min !== null && offer !== null) s += `; ofertagacha (${w.offer_min}-daqiqa) ${pctInt(offer)} qoladi`;
  else if (w.joined > 0) s += `; oxirigacha ${pctInt(w.full / w.joined)} ko'radi`;
  return `${s}.`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}>
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ACTION_TEXT = 'Shu yerda chiqib ketganlarga xabar';

function WatchList({ w, onMessage }: { w: WatchStats; onMessage?: (minute: number, day: 1 | 2) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const top = new Map(w.top_drops.map((t) => [t.to_minute, t]));
  const exactOffer = w.offer_min !== null && w.buckets.some((b) => b.minute === w.offer_min);
  const offerBefore = w.offer_min !== null && !exactOffer ? w.buckets.find((b) => b.minute > (w.offer_min as number))?.minute ?? null : null;
  const act = (minute: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onMessage?.(minute, w.day);
  };
  const cols = onMessage ? 6 : 5;

  const rows: ReactNode[] = [];
  for (const b of w.buckets) {
    const t = top.get(b.minute);
    const hl = !!t && b.minute > 0;
    const canAct = !!onMessage && b.minute > 0;
    if (offerBefore === b.minute) {
      rows.push(
        <tr key="offer" className="ws-offer-row">
          <td colSpan={cols}><span className="ws-offer-tag">oferta</span> {fmtVideoMinute(w.offer_min as number, w.duration_min)} — kurs taklifi shu yerda</td>
        </tr>,
      );
    }
    const on = active === b.minute;
    const label = hl && t ? `eng ko'p chiqib ketilgan joy · ${t.from_minute}–${t.to_minute}-daqiqa: ${num(t.left)} kishi chiqdi` : null;
    const hasSub = !!label || canAct;
    const cls = ['ws-row', hl ? 'ws-hl' : '', on ? 'ws-row-on' : '', hasSub && (hl || on) ? 'ws-has-sub' : ''].filter(Boolean).join(' ');
    rows.push(
      <tr key={b.minute} className={cls} onClick={canAct ? () => setActive((a) => (a === b.minute ? null : b.minute)) : undefined}>
        <td className="ws-t tnum">
          {fmtVideoMinute(b.minute, w.duration_min)}
          {exactOffer && b.minute === w.offer_min && <span className="ws-offer-tag">oferta</span>}
        </td>
        <td className="ws-barcell">
          <div className="ws-track" aria-hidden="true"><div className="ws-bar" style={{ width: `${Math.max(0.5, Math.min(100, b.share * 100))}%` }} /></div>
          {label && <div className="ws-label">{label}</div>}
        </td>
        <td className="num tnum">{num(b.viewers)}</td>
        <td className="num tnum">{pctInt(b.share)}</td>
        <td className={b.drop >= 0.005 ? 'num tnum ws-drop' : 'num tnum muted'}>{b.minute === 0 ? '' : fmtDrop(b.drop)}</td>
        {onMessage && (
          <td className="ws-act-cell">
            {canAct && <button type="button" className="btn btn-sm ws-act" onClick={act(b.minute)}>{ACTION_TEXT}</button>}
          </td>
        )}
      </tr>,
    );
    // Tor ekranda: belgi va amal alohida qatorda (keng ekranda yashirin)
    if (hasSub) {
      rows.push(
        <tr key={`${b.minute}-sub`} className={['ws-sub', hl ? 'ws-sub-hl' : '', hl || on ? 'ws-sub-on' : ''].filter(Boolean).join(' ')}>
          <td colSpan={cols}>
            <div className="ws-sub-inner">
              {label && <span className="ws-label">{label}</span>}
              {canAct && <button type="button" className="btn btn-sm ws-act" onClick={act(b.minute)}>{ACTION_TEXT}</button>}
            </div>
          </td>
        </tr>,
      );
    }
  }

  return (
    <table className="ws-table">
      <caption className="visually-hidden">{w.day}-kun videosi: har {w.step} daqiqada efirni ko'rib turganlar</caption>
      <thead>
        <tr>
          <th scope="col">Video</th>
          <th scope="col">Ko'rib turganlar</th>
          <th scope="col" className="num">Soni</th>
          <th scope="col" className="num">Ulush</th>
          <th scope="col" className="num" title="Oldingi qatordan o'zgarish (kirganlarga nisbatan)">O'zgarish</th>
          {onMessage && <th scope="col" className="ws-act-cell"><span className="visually-hidden">Amal</span></th>}
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

/**
 * Tomosha statistikasi: videoning har 5 (10) daqiqasida nechta odam ko'rib turibdi va qayerda chiqib ketishadi.
 * Progrev zanjiri va Statistika sahifalarida ishlatiladi.
 */
export function WatchStatsPanel({ fid, scope, onMessage, collapsible = false, compact = false }: {
  fid: number;
  scope?: WatchStatsScope;
  /** Berilsa — har qatorda «Shu yerda chiqib ketganlarga xabar» amali. */
  onMessage?: (minute: number, day: 1 | 2) => void;
  collapsible?: boolean;
  /** Ro'yxat balandligi cheklanadi (Progrev sahifasi). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [day, setDay] = useState<1 | 2>(1);
  const [step, setStep] = useState<5 | 10>(5);
  const bodyId = useId();
  const scopeKey = JSON.stringify(scope ?? {});
  const st = useLoad<WatchStats>(open ? () => api.watchStats(fid, { day, step, ...scope }) : null, [fid, day, step, open, scopeKey]);
  // Filtr almashganda eski ro'yxat xira ko'rinib turadi — balandlik sakramaydi
  const last = useRef<WatchStats | undefined>(undefined);
  useEffect(() => {
    if (st.data) last.current = st.data;
  }, [st.data]);
  useEffect(() => {
    last.current = undefined;
  }, [fid]);
  const w = st.data ?? last.current;
  const stale = !st.data && !!w;

  const controls = (
    <div className="card-actions">
      <Segmented label="Qaysi kun videosi" value={day} onChange={(v) => setDay(v)} options={[{ value: 1, label: '1-kun' }, { value: 2, label: '2-kun' }]} />
      <Segmented label="Qadam" value={step} onChange={(v) => setStep(v)} options={[{ value: 5, label: '5 daq' }, { value: 10, label: '10 daq' }]} />
    </div>
  );

  return (
    <section className="card ws-card" aria-label="Tomosha statistikasi">
      <div className="card-head ws-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="card-title">Tomosha statistikasi</h2>
          <div className="small muted">Videoning har {step} daqiqasida nechta odam ko'rib turibdi va qayerda chiqib ketishadi</div>
        </div>
        <div className="row">
          {open && controls}
          {collapsible && (
            <button type="button" className="btn btn-sm btn-ghost" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
              {open ? 'Yopish' : 'Ochish'} <Chevron open={open} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div id={bodyId} className="stack-sm" style={{ gap: 12 }}>
          {st.error && !w ? <ErrorBox error={st.error} onRetry={() => void st.reload()} /> : !w ? <Loading /> : w.joined === 0 ? (
            <Empty title="Hali hech kim efirga kirmagan — statistika birinchi efirdan keyin chiqadi." />
          ) : (
            <div className="stack-sm" style={{ gap: 12, opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }} aria-busy={stale}>
              <div className="ws-summary">
                <span>Efirga kirdi: <b>{num(w.joined)}</b></span>
                <span aria-hidden="true">·</span>
                <span>O'rtacha ko'rdi: <b>{num(w.avg_watch_min)} daqiqa</b></span>
                <span aria-hidden="true">·</span>
                <span>Oxirigacha ko'rdi: <b>{num(w.full)}</b></span>
                <span className="muted">· video {w.duration_min} daqiqa</span>
              </div>
              <div className="takeaway ws-takeaway">{watchTakeaway(w)}</div>
              <div className={compact ? 'ws-scroll ws-scroll-compact' : 'ws-scroll'}>
                <WatchList w={w} onMessage={onMessage} />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
