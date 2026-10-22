import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { LiveComment } from '../api/types';
import { formatVideoTime } from '../lib/time';
import { IconChat } from './Icons';

interface Props {
  comments: LiveComment[];
  positionSec: number;
  /** 'fill' — qolgan balandlikni egallaydi; 'boxed' — cheklangan balandlikdagi blok */
  variant?: 'fill' | 'boxed';
}

const MAX_RENDERED = 120;

/** t <= pozitsiya bo'lgan izohlar soni (ikkilik qidiruv; ro'yxat t bo'yicha saralangan). */
function visibleCount(sorted: LiveComment[], pos: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].t <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** "Asl efir ishtirokchilarining izohlari" — videoga sinxron, yozish imkoni yo'q. */
export function Comments({ comments, positionSec, variant = 'fill' }: Props) {
  const sorted = useMemo(() => [...comments].sort((a, b) => a.t - b.t), [comments]);
  const count = visibleCount(sorted, positionSec);
  const shown = sorted.slice(Math.max(0, count - MAX_RENDERED), count);

  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Yangi izoh qo'shilganda pastga aylantirish (agar foydalanuvchi yuqoriga ketmagan bo'lsa)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <section className={`comments comments--${variant}`} aria-labelledby="comments-title">
      <div className="comments__head">
        <h2 id="comments-title" className="comments__title">
          Asl efir ishtirokchilarining izohlari
        </h2>
        <IconChat className="comments__icon" />
      </div>
      <div className="comments__list" ref={listRef} onScroll={onScroll}>
        {shown.length === 0 ? (
          <p className="comments__empty">Izohlar video davomida shu yerda paydo bo'ladi</p>
        ) : (
          shown.map((c, i) => (
            <div className="comment" key={`${c.t}-${i}-${c.author}`}>
              <div className="comment__avatar" aria-hidden="true">
                {(c.author.trim()[0] ?? '?').toUpperCase()}
              </div>
              <div className="comment__body">
                <div className="comment__meta">
                  <span className="comment__author">{c.author}</span> · {formatVideoTime(c.t)}
                </div>
                <div className="comment__text">{c.text}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
