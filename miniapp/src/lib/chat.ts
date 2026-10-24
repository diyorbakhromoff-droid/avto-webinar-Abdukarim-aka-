import { useCallback, useMemo, useRef, useState } from 'react';
import { sendQuestion } from '../api/client';
import type { MyMessage } from '../api/types';

/** "Mening chatim" ro'yxatidagi bitta xabar (serverdan yoki shu sahifada yuborilgan). */
export interface ChatItem {
  key: string;
  /** Videoning qaysi soniyasida yozilgan */
  t: number;
  text: string;
  answer: string | null;
  /** Hali serverga yetib bormagan (optimistik qo'shilgan) */
  sending: boolean;
}

interface LocalMsg {
  key: number;
  t: number;
  text: string;
  /** Yuborilgan paytdagi eng katta server id — shundan kattasi bilan solishtiriladi */
  afterId: number;
  sending: boolean;
}

const norm = (s: string) => s.trim();

/**
 * Efir chati: server ro'yxati (live.my_messages) + shu sahifada yuborilganlar.
 * POST /api/app/question id qaytarmaydi, shuning uchun mahalliy xabar keyingi holat so'rovida
 * kelgan, yuborilgandan keyin paydo bo'lgan (id > afterId) va matni bir xil server xabari bilan
 * almashtiriladi — bir xil matnni ikki marta yuborsa ham har biri alohida server xabariga bog'lanadi.
 */
export function useLiveChat(server: MyMessage[] | undefined) {
  const list = useMemo(() => [...(server ?? [])].sort((a, b) => a.id - b.id), [server]);
  const [local, setLocal] = useState<LocalMsg[]>([]);
  const seq = useRef(0);
  const maxIdRef = useRef(0);
  maxIdRef.current = list.reduce((m, x) => Math.max(m, x.id), 0);

  const items = useMemo<ChatItem[]>(() => {
    const used = new Set<number>();
    const pending: ChatItem[] = [];
    for (const m of local) {
      const match = list.find((s) => !used.has(s.id) && s.id > m.afterId && norm(s.text) === norm(m.text));
      if (match) used.add(match.id);
      else pending.push({ key: `l${m.key}`, t: m.t, text: m.text, answer: null, sending: m.sending });
    }
    const fromServer = list.map<ChatItem>((s) => ({
      key: `s${s.id}`,
      t: s.t,
      text: s.text,
      answer: s.answer && s.answer.trim() ? s.answer : null,
      sending: false,
    }));
    return [...fromServer, ...pending];
  }, [list, local]);

  /** Optimistik qo'shadi va yuboradi; xatoda mahalliy xabar olib tashlanadi. */
  const send = useCallback(async (text: string, t: number): Promise<boolean> => {
    const key = ++seq.current;
    setLocal((l) => [...l, { key, t, text, afterId: maxIdRef.current, sending: true }]);
    try {
      await sendQuestion(text);
      setLocal((l) => l.map((m) => (m.key === key ? { ...m, sending: false } : m)));
      return true;
    } catch {
      setLocal((l) => l.filter((m) => m.key !== key));
      return false;
    }
  }, []);

  return { items, send };
}
