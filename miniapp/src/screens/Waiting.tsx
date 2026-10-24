import type { AppStateResponse, SessionInfo } from '../api/types';
import { BrandHeader } from '../components/BrandHeader';
import { Countdown } from '../components/Countdown';
import { WaveLines } from '../components/Decor';
import { IconInfo } from '../components/Icons';
import { SpeakerCard } from '../components/SpeakerCard';
import { useBotAction } from '../lib/hooks';
import { dateParts, formatClock } from '../lib/time';

function DayDate({ iso }: { iso: string }) {
  const { lead, dayMonth, tail } = dateParts(iso);
  return (
    <div className="day-card__date">
      {lead && <>{lead}, </>}
      <span className="nowrap">{dayMonth}</span>
      {tail && <>, {tail}</>}
    </div>
  );
}

interface Props {
  data: AppStateResponse;
  session: SessionInfo;
  onRefresh(): void;
}

export function Waiting({ data, session, onRefresh }: Props) {
  const { funnel } = data;
  const { busy, reschedule } = useBotAction();

  return (
    <main className="screen screen--page">
      <WaveLines />
      <BrandHeader funnel={funnel} />

      <div className="topic">
        <div className="eyebrow">Efir mavzusi</div>
        <h1 className="topic__title">{funnel.topic}</h1>
      </div>

      <section className="card countdown-card spotlight" aria-label="1-kun efirigacha qolgan vaqt">
        <div className="countdown-card__label">1-kun efirigacha qoldi</div>
        <Countdown target={session.day1_at} onDone={onRefresh} size="lg" />
      </section>

      <div className="days">
        <div className="day-card day-card--active">
          <div className="day-card__label">1-KUN</div>
          <DayDate iso={session.day1_at} />
          <div className="day-card__time">{formatClock(session.day1_at)}</div>
        </div>
        <div className="day-card">
          <div className="day-card__label">2-KUN</div>
          <DayDate iso={session.day2_at} />
          <div className="day-card__time">{formatClock(session.day2_at)}</div>
        </div>
      </div>

      <SpeakerCard funnel={funnel} />

      <div className="info-line">
        <IconInfo className="info-line__icon" />
        <p>
          Vaqt kelganda video shu sahifada o'zi boshlanadi. Boshlanganidan keyin {funnel.late_entry_minutes} daqiqa
          ichida kirish mumkin.
        </p>
      </div>

      {session.can_change && (
        <div className="bottom-actions">
          <button type="button" className="btn btn--outline" onClick={reschedule} disabled={busy !== null}>
            {busy === 'reschedule' ? 'Yuborilmoqda…' : "Vaqtni o'zgartirish"}
          </button>
        </div>
      )}
    </main>
  );
}
