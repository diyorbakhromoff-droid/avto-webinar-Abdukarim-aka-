import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { LiveComment } from '../api/types';
import type { ChatItem } from '../lib/chat';
import { formatVideoTime } from '../lib/time';
import { Comments } from './Comments';
import { IconLock } from './Icons';

export type FeedTab = 'comments' | 'mine';

const TABS: FeedTab[] = ['comments', 'mine'];

interface Props {
  comments: LiveComment[];
  positionSec: number;
  chat: ChatItem[];
  tab: FeedTab;
  onTab(tab: FeedTab): void;
  /** 'fill' — qolgan balandlikni egallaydi; 'boxed' — cheklangan balandlikdagi blok (sotuv bloki bilan) */
  variant: 'fill' | 'boxed';
}

/** Pleyer ostidagi lenta: "Efir izohlari" (asl efir) | "Mening chatim" (lidning o'z xabarlari). */
export function LiveFeed({ comments, positionSec, chat, tab, onTab, variant }: Props) {
  const tabRefs = useRef<Record<FeedTab, HTMLButtonElement | null>>({ comments: null, mine: null });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    let next: FeedTab | null = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    onTab(next);
    tabRefs.current[next]?.focus();
  };

  const tabProps = (id: FeedTab) => ({
    ref: (el: HTMLButtonElement | null) => {
      tabRefs.current[id] = el;
    },
    type: 'button' as const,
    role: 'tab',
    id: `feed-tab-${id}`,
    // Faqat faol panel DOM da bor (nofaol panel unmount qilinadi)
    'aria-controls': tab === id ? `feed-panel-${id}` : undefined,
    'aria-selected': tab === id,
    tabIndex: tab === id ? 0 : -1,
    className: 'seg__tab',
    onClick: () => onTab(id),
  });

  return (
    <div className={`feed feed--${variant}`}>
      <div className="seg" role="tablist" aria-label="Efir lentasi" onKeyDown={onKeyDown}>
        <button {...tabProps('comments')}>Efir izohlari</button>
        <button {...tabProps('mine')}>
          Mening chatim <span className="seg__count">({chat.length})</span>
        </button>
      </div>
      <div
        className="feed__panel"
        role="tabpanel"
        id={`feed-panel-${tab}`}
        aria-labelledby={`feed-tab-${tab}`}
      >
        {tab === 'comments' ? (
          <Comments comments={comments} positionSec={positionSec} />
        ) : (
          <MyChat items={chat} />
        )}
      </div>
    </div>
  );
}

/** Lidning shu efirdagi o'z xabarlari va jamoa javoblari — faqat o'ziga ko'rinadi. */
function MyChat({ items }: { items: ChatItem[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const answered = items.reduce((n, m) => n + (m.answer ? 1 : 0), 0);
  const signature = `${items.length}:${answered}`;

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [signature]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <section className="mychat" aria-label="Mening chatim">
      <p className="mychat__privacy">
        <IconLock size={13} />
        Bu xabarlarni faqat siz va spiker jamoasi ko'radi
      </p>
      <div className="mychat__list" ref={listRef} onScroll={onScroll}>
        {items.length === 0 ? (
          <p className="mychat__empty">
            Hali xabar yozmadingiz. Savolingiz bo'lsa — yozing, spiker jamoasi javob beradi.
          </p>
        ) : (
          items.map((m) => (
            <article key={m.key} className={`mymsg${m.sending ? ' mymsg--sending' : ''}`}>
              <div className="mymsg__meta">
                <span className="mymsg__me">Siz</span> · {formatVideoTime(m.t)}
                {m.sending && <> · yuborilmoqda…</>}
              </div>
              <p className="mymsg__bubble">{m.text}</p>
              {m.answer && (
                <div className="mymsg__answer">
                  <p className="mymsg__answer-text">
                    <span className="mymsg__answer-label">Javob:</span> {m.answer}
                  </p>
                  <span className="mymsg__answer-note">Javob botga ham keladi</span>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
