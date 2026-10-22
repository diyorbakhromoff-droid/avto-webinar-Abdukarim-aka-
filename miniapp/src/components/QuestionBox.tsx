import { useEffect, useRef, useState, type FormEvent } from 'react';
import { sendQuestion } from '../api/client';
import { haptic } from '../lib/telegram';
import { IconSend } from './Icons';

const MAX_LEN = 1000;

/** Savol maydoni: savol admin panelga tushadi, javob botda keladi. */
export function QuestionBox() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || status === 'sending') return;
    setStatus('sending');
    try {
      await sendQuestion(value.slice(0, MAX_LEN));
      setText('');
      setStatus('sent');
      haptic('success');
    } catch {
      setStatus('error');
      haptic('error');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus('idle'), 6000);
  };

  const hint =
    status === 'sent'
      ? 'Savolingiz yuborildi — javob botda keladi'
      : status === 'error'
        ? "Savol yuborilmadi. Qayta urinib ko'ring"
        : 'Savolingiz spikerning jamoasiga boradi, javob botda keladi';

  return (
    <form className="question" onSubmit={submit}>
      <label htmlFor="question-input" className={`question__hint question__hint--${status}`}>
        <span role="status" aria-live="polite">
          {hint}
        </span>
      </label>
      <div className="question__row">
        <input
          id="question-input"
          className="question__input"
          type="text"
          inputMode="text"
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Savol yozing…"
          maxLength={MAX_LEN}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="question__send"
          aria-label="Yuborish"
          disabled={!text.trim() || status === 'sending'}
        >
          {status === 'sending' ? <span className="spinner spinner--dark" aria-hidden="true" /> : <IconSend size={20} />}
        </button>
      </div>
    </form>
  );
}
