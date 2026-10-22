import type { AppStateResponse } from '../api/types';
import { ArabicDecor } from '../components/BrandHeader';
import { Countdown } from '../components/Countdown';
import { IconCheck } from '../components/Icons';
import { closeApp } from '../lib/telegram';
import { formatWhen } from '../lib/time';

interface Props {
  data: AppStateResponse;
  onRefresh(): void;
}

export function Between({ data, onRefresh }: Props) {
  const between = data.between;
  const day2At = between?.day2_at ?? data.session?.day2_at ?? null;
  const percent = between ? Math.round(Math.min(Math.max(between.day1_percent, 0), 100)) : null;
  const summary = between?.summary ?? [];

  return (
    <main className="screen screen--page">
      <ArabicDecor text="أحسنت" className="decor--between" />

      <div className="hero hero--center">
        <div className="hero__badge">
          <IconCheck size={30} />
        </div>
        <h1 className="hero__title">1-kun yakunlandi</h1>
        <p className="hero__text">
          {percent !== null && <>Siz videoning {percent}% ini ko'rdingiz. </>}
          2-kunda kurs dasturi va qatnashish shartlari aytiladi.
        </p>
      </div>

      {day2At && (
        <section className="card next-day" aria-label="2-kun efirigacha qolgan vaqt">
          <div className="next-day__text">
            <div className="next-day__label">2-kun efiri</div>
            <div className="next-day__when">{formatWhen(day2At)}</div>
          </div>
          <Countdown target={day2At} variant="inline" onDone={onRefresh} className="next-day__timer" />
        </section>
      )}

      {summary.length > 0 && (
        <section className="summary" aria-labelledby="summary-title">
          <h2 id="summary-title" className="eyebrow">
            1-kun xulosasi
          </h2>
          <ol className="summary__list">
            {summary.map((item, i) => (
              <li key={i} className="summary__item">
                <span className="summary__num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="bottom-actions">
        <p className="muted-center">2-kun boshlanishidan oldin botga eslatma keladi</p>
        <button type="button" className="btn btn--outline btn--solid-bg" onClick={closeApp}>
          Botga qaytish
        </button>
      </div>
    </main>
  );
}
