import { useRef } from 'react';
import { honestyHits } from '../lib/honesty';
import { VARIABLES, visibleLength } from '../lib/telegramHtml';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Belgi chegarasi: 4096 matn, 1024 media izohi. */
  limit?: number;
  limitHint?: string;
  rows?: number;
  placeholder?: string;
  showHonestyOk?: boolean;
  serverWarnings?: string[];
}

export function TextEditor({ id, label, value, onChange, limit = 4096, limitHint, rows = 6, placeholder, showHonestyOk = true, serverWarnings }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const edit = (build: (sel: string) => { text: string; selStart: number; selEnd: number }) => {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    const r = build(value.slice(s, e));
    onChange(value.slice(0, s) + r.text + value.slice(e));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(s + r.selStart, s + r.selEnd);
    });
  };
  /** Belgilangan matnni teg bilan o'raydi. */
  const wrap = (before: string, after: string, fallback = '') =>
    edit((sel) => {
      const inner = sel || fallback;
      return { text: before + inner + after, selStart: before.length, selEnd: before.length + inner.length };
    });
  /** Kursor joyiga (yoki belgilangan matn o'rniga) qo'yadi. */
  const insert = (t: string) => edit(() => ({ text: t, selStart: t.length, selEnd: t.length }));

  const len = visibleLength(value);
  const over = len > limit;
  const hits = honestyHits(value);

  return (
    <div className="text-editor">
      <label className="field" htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="te-toolbar" role="toolbar" aria-label="Formatlash">
        <button type="button" className="te-btn" onClick={() => wrap('<b>', '</b>')} aria-label="Qalin"><b>B</b></button>
        <button type="button" className="te-btn" onClick={() => wrap('<i>', '</i>')} aria-label="Kursiv"><i>I</i></button>
        <button type="button" className="te-btn" onClick={() => wrap('<a href="https://">', '</a>', 'havola')} aria-label="Havola">🔗</button>
        <button type="button" className="te-btn" onClick={() => wrap('<tg-spoiler>', '</tg-spoiler>')} aria-label="Spoyler">▒</button>
      </div>
      <textarea
        id={id}
        ref={ref}
        className="textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={over || undefined}
        aria-describedby={`${id}-count`}
      />
      <div className="te-chips">
        {VARIABLES.map((v) => (
          <button key={v} type="button" className="var-chip" onClick={() => insert(v)} title="Kursor turgan joyga qo'shish">{v}</button>
        ))}
        <span id={`${id}-count`} className={over ? 'te-count te-over' : 'te-count'}>
          {len} / {limit} belgi{limitHint ? ` (${limitHint})` : ''}
        </span>
      </div>
      {hits.length > 0 ? (
        <div className="box box-danger" role="alert">
          Halollik tekshiruvi: matnda {hits.map((h) => `«${h}»`).join(', ')} bor. Yozuvni jonli deb ko'rsatmang — «efir», «webinar» deb yozing.
        </div>
      ) : showHonestyOk ? (
        <div className="box box-warn">Halollik tekshiruvi: matnda «jonli», «live», «hozir efirda» yo'q.</div>
      ) : null}
      {serverWarnings && serverWarnings.length > 0 && (
        <div className="box box-warn" role="alert">
          <ul className="plain-list">{serverWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
