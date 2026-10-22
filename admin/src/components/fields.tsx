import { useEffect, useState } from 'react';
import { parseTimecode, timecode } from '../lib/format';

/** Timecode kiritish: "mm:ss" yoki faqat daqiqa. Qiymat soniyada. */
export function TimecodeInput({ id, value, onChange, required, placeholder = 'mm:ss', ariaLabel }: {
  id?: string;
  value: number | null;
  onChange: (sec: number | null) => void;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value === null ? '' : timecode(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    const parsed = parseTimecode(text);
    if (parsed !== value) setText(value === null ? '' : timecode(value));
    // faqat tashqi qiymat o'zgarganda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className={bad ? 'input input-bad' : 'input'}
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      required={required}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) {
          setBad(!!required);
          onChange(null);
          return;
        }
        const p = parseTimecode(e.target.value);
        setBad(p === null);
        if (p !== null) onChange(p);
      }}
      onBlur={() => {
        const p = parseTimecode(text);
        if (p !== null) setText(timecode(p));
      }}
    />
  );
}

/** Satrlar ro'yxati muharriri (xulosa, bonuslar). */
export function StringListEditor({ value, onChange, placeholder, addLabel = "+ Qator qo'shish", label }: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  label: string;
}) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="list-editor">
      {value.map((v, i) => (
        <div key={i} className="list-editor-row">
          <span className="list-editor-n" aria-hidden="true">{i + 1}.</span>
          <input
            className="input grow"
            value={v}
            placeholder={placeholder}
            aria-label={`${label}: ${i + 1}-qator`}
            onChange={(e) => onChange(value.map((x, k) => (k === i ? e.target.value : x)))}
          />
          <button type="button" className="icon-btn" aria-label="Yuqoriga" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="icon-btn" aria-label="Pastga" disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="icon-btn" aria-label="O'chirish" onClick={() => onChange(value.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...value, ''])}>{addLabel}</button>
    </div>
  );
}

/** Butun son kiritish (bo'sh qoldirilsa oldingi qiymat saqlanadi). */
export function NumberInput({ id, value, onChange, min, max, step, ariaLabel, suffix }: {
  id?: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const input = (
    <input
      id={id}
      className="input"
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
  if (!suffix) return input;
  return <div className="input-suffix">{input}<span>{suffix}</span></div>;
}

/** Pul kiritish: "1 990 000" ko'rinishida guruhlab ko'rsatadi. */
export function MoneyInput({ id, value, onChange, ariaLabel, placeholder = '0' }: {
  id?: string;
  value: number | null;
  onChange: (n: number | null) => void;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const fmt = (n: number | null) => (n === null ? '' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
  return (
    <div className="input-suffix">
      <input
        id={id}
        className="input"
        inputMode="numeric"
        value={fmt(value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          const d = e.target.value.replace(/[^\d]/g, '');
          onChange(d ? Number(d) : null);
        }}
      />
      <span>so'm</span>
    </div>
  );
}
