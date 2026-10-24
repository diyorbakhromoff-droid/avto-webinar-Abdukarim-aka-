import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconSend } from './Icons';

const MAX_LEN = 1000;

interface Props {
  /** Xabarni yuboradi (optimistik qo'shish va toast — ota komponentda). true = yuborildi */
  onSend(text: string): Promise<boolean>;
}

/**
 * Efir chati maydoni: xabar videoning shu soniyasi bilan admin paneldagi "Efir chati" ga tushadi,
 * javob shu yerda ("Mening chatim") va botda keladi.
 */
export function QuestionBox({ onSend }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim().slice(0, MAX_LEN);
    if (!value || status === 'sending') return;
    window.clearTimeout(timer.current);
    setStatus('sending');
    setText('');
    const ok = await onSend(value);
    if (ok) {
      setStatus('idle');
      return;
    }
    // Yuborilmadi — matnni qaytaramiz (agar lid yangisini yozishni boshlamagan bo'lsa)
    setText((cur) => (cur ? cur : value));
    setStatus('error');
    timer.current = window.setTimeout(() => setStatus('idle'), 6000);
  };

  return (
    <form className="question" onSubmit={submit}>
      <label htmlFor="question-input" className="question__hint">
        <b>Efir chati</b> — fikr va savollaringiz spiker jamoasiga boradi
      </label>
      <div className="question__row">
        <input
          id="question-input"
          className="question__input"
          type="text"
          inputMode="text"
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Fikr yoki savol yozing…"
          maxLength={MAX_LEN}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="question__send"
          aria-label="Xabarni yuborish"
          disabled={!text.trim() || status === 'sending'}
        >
          {status === 'sending' ? <span className="spinner spinner--dark" aria-hidden="true" /> : <IconSend size={20} />}
        </button>
      </div>
      <div className="question__status" role="status" aria-live="polite">
        {status === 'error' && "Xabar yuborilmadi. Internetni tekshirib, qayta urinib ko'ring"}
      </div>
    </form>
  );
}
