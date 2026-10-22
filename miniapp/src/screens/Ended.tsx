import type { AppStateResponse } from '../api/types';
import { ArabicDecor } from '../components/BrandHeader';
import { Countdown } from '../components/Countdown';
import { BonusList, OfferClosedNote, TariffList, useSelectedTariff } from '../components/OfferBlock';
import { useBotAction } from '../lib/hooks';
import { closeApp } from '../lib/telegram';
import { formatDateTime, isLongPast } from '../lib/time';

interface Props {
  data: AppStateResponse;
  onRefresh(): void;
}

export function Ended({ data, onRefresh }: Props) {
  const offer = data.offer;
  const [selectedId, setSelectedId] = useSelectedTariff(offer);
  const { busy, offerClick } = useBotAction();
  const selected = offer?.tariffs.find((t) => t.id === selectedId);
  const canBuy = !!offer && !offer.closed && offer.tariffs.length > 0;
  const showTimer = !!offer && !offer.closed && offer.special_active && !isLongPast(offer.deadline_at);

  let lead = 'Ikki kun qatnashganingiz uchun rahmat.';
  if (offer && !offer.closed) {
    lead += offer.special_active
      ? ' Maxsus narx faqat siz uchun belgilangan muddatgacha amal qiladi.'
      : ' Maxsus narx muddati tugagan — kursga oddiy narxda yozilishingiz mumkin.';
  }

  return (
    <main className="screen screen--fixed">
      <ArabicDecor text="شكرا" className="decor--ended" />

      <div className="page-scroll">
        <div className="hero">
          <h1 className="hero__title hero__title--lg">Efir yakunlandi</h1>
          <p className="hero__text">{lead}</p>
        </div>

        {showTimer && offer?.deadline_at && (
          <section className="card card--gold deadline-card" aria-label="Maxsus narx tugashigacha qolgan vaqt">
            <div className="deadline-card__label">Maxsus narx tugashiga</div>
            <Countdown target={offer.deadline_at} size="md" onDone={onRefresh} />
            <div className="deadline-card__date">Muddat: {formatDateTime(offer.deadline_at)}</div>
          </section>
        )}

        {offer && (
          <section className="ended-offer" aria-labelledby="ended-offer-title">
            <h2 id="ended-offer-title" className="ended-offer__title">
              {offer.course_title}
            </h2>
            {offer.closed ? (
              <OfferClosedNote />
            ) : (
              <>
                <TariffList offer={offer} selectedId={selectedId} onSelect={setSelectedId} variant="ended" />
                <BonusList offer={offer} selected={selected} />
              </>
            )}
          </section>
        )}
      </div>

      <div className="cta-bar">
        {canBuy ? (
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={() => offerClick(selectedId)}
            disabled={busy !== null}
          >
            {busy === 'offer' ? 'Yuborilmoqda…' : 'Kursga yozilish'}
          </button>
        ) : (
          <button type="button" className="btn btn--outline" onClick={closeApp}>
            Botga qaytish
          </button>
        )}
        <p className="muted-center">Takroriy ko'rish yo'q. Savollar bo'lsa, botda "Savol berish"</p>
      </div>
    </main>
  );
}
