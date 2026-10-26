import { useState } from 'react';
import type { ChainButton, ChainKind, MediaInfo } from '../../api/types';
import { textLimit } from '../../lib/chain';
import { KIND_LABEL, options } from '../../lib/labels';
import { visibleLength } from '../../lib/telegramHtml';
import { ButtonsEditor, validateButtons } from '../ButtonsEditor';
import { MediaPicker } from '../MediaPicker';
import { TelegramPreview } from '../TelegramPreview';
import { TextEditor } from '../TextEditor';

export interface MessageContent { kind: ChainKind; text: string; media_ids: number[]; buttons: ChainButton[][] }

/** Xabar mazmunini tekshiradi; xato bo'lmasa — null. */
export function contentError(c: MessageContent): string | null {
  if (c.kind === 'text' && !c.text.trim()) return 'Xabar matnini yozing';
  if (c.kind !== 'text' && !c.media_ids.length) return 'Media faylni yuklang';
  if (c.kind === 'album' && (c.media_ids.length < 2 || c.media_ids.length > 10)) return 'Albomda 2–10 ta media bo\'lsin';
  if (visibleLength(c.text) > textLimit(c.kind)) return `Matn ${textLimit(c.kind)} belgidan oshmasin`;
  if (c.kind === 'album' && c.buttons.length) return "Albomga tugma qo'shib bo'lmaydi";
  return validateButtons(c.buttons);
}

/** Sxema inspektori uchun ixcham xabar muharriri: turi, matn, media, tugmalar va Telegram ko'rinishi. */
export function MessageFields({ id, value, onChange, allowNext, serverWarnings }: {
  id: string;
  value: MessageContent;
  onChange: (patch: Partial<MessageContent>) => void;
  allowNext?: boolean;
  serverWarnings?: string[];
}) {
  const [media, setMedia] = useState<Record<number, MediaInfo>>({});
  const kind = value.kind;
  return (
    <div className="stack-sm">
      <label className="field field-compact">
        <span>Xabar turi</span>
        <select className="select" value={kind} onChange={(e) => {
          const k = e.target.value as ChainKind;
          onChange({ kind: k, media_ids: k === 'album' || kind === 'album' ? [] : value.media_ids });
        }}>
          {options(KIND_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {kind !== 'video_note' && (
        <TextEditor
          id={`${id}-text`}
          label={kind === 'text' ? 'Matn' : 'Izoh (caption)'}
          value={value.text}
          onChange={(v) => onChange({ text: v })}
          limit={textLimit(kind)}
          limitHint={kind === 'text' ? undefined : 'media izohi'}
          rows={5}
          serverWarnings={serverWarnings}
        />
      )}
      {kind !== 'text' && (
        <MediaPicker
          id={`${id}-media`}
          kind={kind}
          mediaIds={value.media_ids}
          onChange={(ids) => onChange({ media_ids: ids })}
          known={media}
          onUploaded={(m) => setMedia((x) => ({ ...x, [m.id]: m }))}
        />
      )}
      {kind !== 'album' && (
        <div className="stack-sm">
          <div className="field"><span>Tugmalar</span></div>
          <ButtonsEditor value={value.buttons} onChange={(b) => onChange({ buttons: b })} idPrefix={`${id}-btn`} allowNext={allowNext} />
        </div>
      )}
      <details className="fi-preview">
        <summary>Telegram'dagi ko'rinishi</summary>
        <TelegramPreview kind={kind} text={value.text} buttons={kind === 'album' ? [] : value.buttons} media={value.media_ids.map((m) => media[m])} mediaCount={value.media_ids.length} />
      </details>
    </div>
  );
}
