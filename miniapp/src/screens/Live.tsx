import { useCallback, useRef } from 'react';
import type { AppStateResponse, LiveInfo, SessionInfo } from '../api/types';
import { Comments } from '../components/Comments';
import { OfferBlock, SoftOfferBanner, useSelectedTariff } from '../components/OfferBlock';
import { Player } from '../components/Player';
import { QuestionBox } from '../components/QuestionBox';
import { useBotAction, useServerNow } from '../lib/hooks';
import { formatClock, formatVideoTime, toMs } from '../lib/time';

interface Props {
  data: AppStateResponse;
  live: LiveInfo;
  session: SessionInfo;
  onRefresh(): void;
}

export function Live({ data, live, session, onRefresh }: Props) {
  const now = useServerNow();
  const startMs = toMs(live.start_at);
  const rawPos = (now - startMs) / 1000;
  const pos = Math.min(Math.max(rawPos, 0), live.duration_sec);

  const offer = data.offer;
  const offerVisible = !!offer && offer.visible_from_sec !== null && rawPos >= offer.visible_from_sec;
  const fullOffer = offerVisible && !!offer && !offer.soft;
  const softOffer = offerVisible && !!offer && offer.soft;

  const [selectedId, setSelectedId] = useSelectedTariff(offer);
  const { busy, offerClick } = useBotAction();

  // Video tugadi → holatni qayta so'rash (server hali "live" desa, 5 s da bir)
  const lastEndAsk = useRef(0);
  const handleEnded = useCallback(() => {
    const t = Date.now();
    if (t - lastEndAsk.current < 5000) return;
    lastEndAsk.current = t;
    onRefresh();
  }, [onRefresh]);

  const endMs = startMs + live.duration_sec * 1000;
  const headerRight = fullOffer
    ? `${formatVideoTime(pos)} / ${formatVideoTime(live.duration_sec)}`
    : `${formatClock(startMs)} – ${formatClock(endMs)}`;

  // Barqaror key'lar: sotuv bloki chiqqanda tartib o'zgaradi, lekin pleyer (va yozilayotgan savol)
  // qayta yaratilmasligi kerak.
  const player = (
    <Player
      key="player"
      hlsUrl={live.hls_url}
      startAtMs={startMs}
      durationSec={live.duration_sec}
      sessionId={session.id}
      day={live.day}
      positionSec={rawPos}
      compact={fullOffer}
      title={data.funnel.topic}
      artist={data.funnel.speaker_name}
      onEnded={handleEnded}
    />
  );

  const header = (
    <header className="live-head" key="head">
      <div className="live-head__left">
        <span className="pill">{live.day}-KUN</span>
        <span className="live-head__label">Efir</span>
      </div>
      <div className="live-head__right">{headerRight}</div>
    </header>
  );

  if (fullOffer && offer) {
    return (
      <main className="screen screen--live screen--offer">
        {header}
        {player}
        <div className="live-scroll">
          <h1 className="sr-only">{data.funnel.topic}</h1>
          <OfferBlock offer={offer} selectedId={selectedId} onSelect={setSelectedId} onDeadline={onRefresh} />
          <Comments key="comments" comments={live.comments} positionSec={pos} variant="boxed" />
          <QuestionBox key="question" />
        </div>
        {!offer.closed && offer.tariffs.length > 0 && (
          <div className="sticky-cta">
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={() => offerClick(selectedId)}
              disabled={busy !== null}
            >
              {busy === 'offer' ? 'Yuborilmoqda…' : 'Kursga yozilish'}
            </button>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="screen screen--live">
      {header}
      {player}
      <div className="live-info">
        <h1 className="live-info__title">{data.funnel.topic}</h1>
        <p className="live-info__note">Pauza va o'tkazish yo'q — video barcha uchun bir vaqtda boradi</p>
      </div>
      {softOffer && offer && (
        <SoftOfferBanner
          offer={offer}
          busy={busy === 'offer'}
          onClick={() => offerClick(offer.tariffs.length === 1 ? offer.tariffs[0].id : null)}
        />
      )}
      <Comments key="comments" comments={live.comments} positionSec={pos} variant="fill" />
      <QuestionBox key="question" />
    </main>
  );
}
