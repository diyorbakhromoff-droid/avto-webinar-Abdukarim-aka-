import type { AppStateResponse } from '../api/types';
import { IconClock } from '../components/Icons';
import { useBotAction } from '../lib/hooks';
import { closeApp } from '../lib/telegram';
import { formatClock, formatWhenInSentence } from '../lib/time';

interface Props {
  data: AppStateResponse;
}

/** 'missed' (kunni ko'rmadi) va 'closed' (kech kirish chegarasi o'tdi) holatlari. */
export function Missed({ data }: Props) {
  const { busy, reschedule } = useBotAction();
  const closed = data.state === 'closed';
  const missed = data.missed;
  const day = missed?.day ?? 1;
  const startedAt = missed?.started_at ?? (day === 1 ? data.session?.day1_at : data.session?.day2_at) ?? null;
  const left = missed?.reschedules_left ?? 0;
  const L = data.funnel.late_entry_minutes;

  const title = closed ? 'Efir boshlanib ketgan' : `${day}-kun efiri o'tib ketdi`;

  let text: string;
  if (closed) {
    text = startedAt
      ? `${day}-kun efiri soat ${formatClock(startedAt)} da boshlangan. Kech kirish ${L} daqiqagacha mumkin edi`
      : `${day}-kun efiri boshlangan. Kech kirish ${L} daqiqagacha mumkin edi`;
    text += left > 0 ? " — boshidan ko'rishingiz uchun boshqa vaqt tanlang." : '.';
  } else {
    text = startedAt ? `${day}-kun efiri ${formatWhenInSentence(startedAt)} da bo'lib o'tdi.` : `${day}-kun efiri bo'lib o'tdi.`;
    if (left > 0) {
      text +=
        day === 1
          ? " Sizga qulay boshqa vaqtni tanlang — yangi sessiya 1-kundan boshlanadi."
          : " Faqat 2-kunni boshqa vaqtga tanlaysiz — 1-kunni qayta ko'rish shart emas.";
    }
  }

  return (
    <main className="screen screen--page">
      <div className="center-block">
        <div className="round-icon">
          <IconClock size={32} />
        </div>
        <h1 className="hero__title">{title}</h1>
        <p className="hero__text">{text}</p>
        {left > 0 ? (
          <div className="chip">Qayta tanlash: {left} ta imkoniyat qoldi</div>
        ) : (
          <>
            <div className="chip">Qayta tanlash imkoniyati qolmadi</div>
            <p className="hero__text hero__text--sm">
              Qayta vaqt tanlash limiti tugagan. Savollaringiz bo'lsa, botda "Savol berish" orqali yozing.
            </p>
          </>
        )}
      </div>
      <div className="bottom-actions">
        {left > 0 && (
          <button type="button" className="btn btn--primary btn--lg" onClick={reschedule} disabled={busy !== null}>
            {busy === 'reschedule' ? 'Yuborilmoqda…' : 'Boshqa vaqt tanlash'}
          </button>
        )}
        <button type="button" className="btn btn--outline" onClick={closeApp}>
          Botga qaytish
        </button>
      </div>
    </main>
  );
}
