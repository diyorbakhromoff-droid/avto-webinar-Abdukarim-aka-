import type { AppStateResponse } from '../api/types';
import { ArabicDecor, BrandHeader } from '../components/BrandHeader';
import { IconCalendar } from '../components/Icons';
import { useBotAction } from '../lib/hooks';
import { closeApp } from '../lib/telegram';

export function NoSession({ data }: { data: AppStateResponse }) {
  const { busy, reschedule } = useBotAction();
  const name = data.lead.first_name?.trim();
  return (
    <main className="screen screen--page">
      <ArabicDecor text="عربي" className="decor--waiting" />
      <BrandHeader funnel={data.funnel} />
      <div className="center-block">
        <div className="round-icon">
          <IconCalendar size={30} />
        </div>
        <h1 className="hero__title">Efir vaqtini tanlang</h1>
        <p className="hero__text">
          {name ? `${name}, siz` : 'Siz'} hali efir vaqtini tanlamadingiz. Botda o'zingizga qulay vaqtni tanlang — efir
          shu sahifada ochiladi.
        </p>
        <div className="chip">{data.funnel.topic}</div>
      </div>
      <div className="bottom-actions">
        <button type="button" className="btn btn--primary btn--lg" onClick={reschedule} disabled={busy !== null}>
          {busy === 'reschedule' ? 'Yuborilmoqda…' : 'Vaqt tanlash'}
        </button>
        <button type="button" className="btn btn--outline" onClick={closeApp}>
          Botga qaytish
        </button>
      </div>
    </main>
  );
}
