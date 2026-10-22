import { useEffect, useState } from 'react';
import type { Offer, Tariff } from '../api/types';
import { formatMoney } from '../lib/money';
import { Countdown } from './Countdown';
import { isLongPast } from '../lib/time';
import { IconCheck } from './Icons';

/** Tanlangan tarif: standart — birinchisi. */
export function useSelectedTariff(offer: Offer | null) {
  const ids = offer?.tariffs.map((t) => t.id).join(',') ?? '';
  const [selected, setSelected] = useState<number | null>(offer?.tariffs[0]?.id ?? null);
  useEffect(() => {
    if (!offer) return;
    if (selected === null || !offer.tariffs.some((t) => t.id === selected)) {
      setSelected(offer.tariffs[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  return [selected, setSelected] as const;
}

function showRegular(offer: Offer, t: Tariff): boolean {
  return offer.special_active && t.regular_price > t.price_now;
}

function bonusText(b: string): string {
  return /^bonus\b/i.test(b.trim()) ? b : `Bonus: ${b}`;
}

interface TariffListProps {
  offer: Offer;
  selectedId: number | null;
  onSelect(id: number): void;
  variant: 'live' | 'ended';
}

export function TariffList({ offer, selectedId, onSelect, variant }: TariffListProps) {
  if (offer.tariffs.length === 0) return null;
  return (
    <fieldset className={`tariffs tariffs--${variant}`}>
      <legend className="sr-only">Tarifni tanlang</legend>
      {offer.tariffs.map((t) => {
        const checked = t.id === selectedId;
        const regular = showRegular(offer, t) ? (
          <s className="tariff__regular">
            <span className="sr-only">Oddiy narx: </span>
            {formatMoney(t.regular_price)}
          </s>
        ) : null;
        const now = (
          <span className="tariff__price">
            {showRegular(offer, t) && <span className="sr-only">Maxsus narx: </span>}
            {formatMoney(t.price_now)}
          </span>
        );
        return (
          <label key={t.id} className={`tariff${checked ? ' tariff--checked' : ''}`}>
            <input
              type="radio"
              className="sr-only"
              name="tariff"
              value={t.id}
              checked={checked}
              onChange={() => onSelect(t.id)}
            />
            <span className="tariff__info">
              <span className="tariff__name">{t.name}</span>
              {variant === 'live' && t.description && <span className="tariff__desc">{t.description}</span>}
            </span>
            {variant === 'live' ? (
              <span className="tariff__prices tariff__prices--stack">
                {now}
                {regular}
              </span>
            ) : (
              <span className="tariff__prices tariff__prices--row">
                {regular}
                {now}
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}

export function BonusList({ offer, selected }: { offer: Offer; selected: Tariff | undefined }) {
  const items = offer.bonuses.map(bonusText);
  if (selected?.deposit_amount) {
    items.push(`Boshlang'ich to'lov: ${formatMoney(selected.deposit_amount)}, qolganini keyin`);
  }
  if (items.length === 0) return null;
  return (
    <ul className="bonuses">
      {items.map((b, i) => (
        <li key={i} className="bonus">
          <IconCheck className="bonus__icon" />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

interface OfferBlockProps {
  offer: Offer;
  selectedId: number | null;
  onSelect(id: number): void;
  onDeadline(): void;
}

/** 2-kun sotuv bloki (efir paytida, oferta timecode'dan keyin). */
export function OfferBlock({ offer, selectedId, onSelect, onDeadline }: OfferBlockProps) {
  const selected = offer.tariffs.find((t) => t.id === selectedId);
  return (
    <section className="offer" aria-labelledby="offer-title">
      <div className="offer__head">
        <div className="eyebrow">Webinar qatnashchilari uchun</div>
        <h2 id="offer-title" className="offer__title">
          {offer.course_title}
        </h2>
      </div>
      {offer.closed ? (
        <OfferClosedNote />
      ) : (
        <>
          <TariffList offer={offer} selectedId={selectedId} onSelect={onSelect} variant="live" />
          <BonusList offer={offer} selected={selected} />
          {offer.deadline_at && offer.special_active && !isLongPast(offer.deadline_at) && (
            <div className="offer__deadline">
              <span>Maxsus narx sizga amal qiladi</span>
              <Countdown target={offer.deadline_at} variant="inline" onDone={onDeadline} className="offer__timer" />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function OfferClosedNote() {
  return (
    <p className="offer-closed">
      Taklif muddati tugagan. Savollaringiz bo'lsa, botda "Savol berish" orqali yozing.
    </p>
  );
}

interface SoftProps {
  offer: Offer;
  busy: boolean;
  onClick(): void;
}

/** 1-kundagi yumshoq taklif — ixcham banner. */
export function SoftOfferBanner({ offer, busy, onClick }: SoftProps) {
  if (offer.closed || offer.tariffs.length === 0) return null;
  const min = Math.min(...offer.tariffs.map((t) => t.price_now));
  const priceLabel = offer.tariffs.length > 1 ? `${formatMoney(min)}dan` : formatMoney(min);
  const bonus = offer.bonuses[0];
  return (
    <section className="soft-offer" aria-labelledby="soft-offer-title">
      <div className="eyebrow eyebrow--sm">Webinar qatnashchilari uchun</div>
      <div className="soft-offer__row">
        <div className="soft-offer__text">
          <h2 id="soft-offer-title" className="soft-offer__title">
            {offer.course_title}
          </h2>
          <div className="soft-offer__price">{priceLabel}</div>
          {bonus && <div className="soft-offer__bonus">{bonusText(bonus)}</div>}
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={onClick} disabled={busy}>
          {busy ? 'Yuborilmoqda…' : 'Kursga yozilish'}
        </button>
      </div>
    </section>
  );
}
