import type { ChainButton, ChainKind, MediaInfo } from '../api/types';
import { renderTelegramHtml } from '../lib/telegramHtml';
import { KIND_SHORT } from '../lib/labels';

interface Props {
  kind: ChainKind;
  text: string;
  buttons: ChainButton[][];
  media?: (MediaInfo | undefined)[];
  mediaCount?: number;
}

function MediaBox({ kind, media }: { kind: ChainKind; media?: MediaInfo }) {
  if (kind === 'photo' && media?.url) return <img className="tg-media-img" src={media.url} alt="" />;
  if (kind === 'video_note') return <div className="tg-note" aria-hidden="true">video-doira</div>;
  if (kind === 'voice' || kind === 'audio') {
    return (
      <div className="tg-audio">
        <span className="tg-play" aria-hidden="true">▶</span>
        <span className="tg-wave" aria-hidden="true" />
        <span className="tg-audio-name">{media?.filename ?? (kind === 'voice' ? 'ovozli xabar' : 'audio')}</span>
      </div>
    );
  }
  if (kind === 'document') {
    return (
      <div className="tg-doc">
        <span className="tg-doc-icon" aria-hidden="true">📄</span>
        <span>{media?.filename ?? 'fayl.pdf'}</span>
      </div>
    );
  }
  return <div className="tg-media-ph">{KIND_SHORT[kind]}</div>;
}

export function TelegramPreview({ kind, text, buttons, media = [], mediaCount }: Props) {
  const html = renderTelegramHtml(text);
  const hasText = text.trim().length > 0;
  const isNote = kind === 'video_note';
  const count = Math.max(mediaCount ?? media.length, kind === 'album' ? 2 : 1);
  return (
    <div className="tg-chat" aria-label="Telegram'dagi ko'rinishi">
      <div className={buttons.length ? 'tg-bubble tg-bubble-btns' : 'tg-bubble'} style={isNote ? { background: 'transparent' } : undefined}>
        {kind !== 'text' && kind !== 'album' && <MediaBox kind={kind} media={media[0]} />}
        {kind === 'album' && (
          <div className="tg-album">
            {Array.from({ length: Math.min(count, 4) }).map((_, i) =>
              media[i]?.kind === 'photo' && media[i]?.url
                ? <img key={i} className="tg-album-cell" src={media[i]!.url} alt="" />
                : <div key={i} className="tg-album-cell">{i === 3 && count > 4 ? `+${count - 3}` : 'media'}</div>,
            )}
          </div>
        )}
        {hasText && !isNote && <div className="tg-text" dangerouslySetInnerHTML={{ __html: html }} />}
        {!hasText && kind === 'text' && <div className="tg-text tg-muted">Matn yozing…</div>}
      </div>
      {buttons.map((row, ri) => (
        <div key={ri} className="tg-btn-row">
          {row.map((b, bi) => (
            <div key={bi} className="tg-btn">
              {b.text || '…'}
              {b.type === 'url' && <span className="tg-btn-arrow" aria-hidden="true">↗</span>}
            </div>
          ))}
        </div>
      ))}
      {isNote && hasText && <div className="small" style={{ color: '#B8C6D3', marginTop: 6 }}>Video-doiraga izoh qo'shib bo'lmaydi — matn yuborilmaydi.</div>}
    </div>
  );
}
