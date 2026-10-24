import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/admin';
import type { ChatRow, ChatSession } from '../api/types';
import { NeedFunnel } from '../components/NeedFunnel';
import { Badge, Empty, ErrorBox, Loading, PageHead, Segmented } from '../components/ui';
import { useUser } from '../lib/auth';
import { num } from '../lib/format';
import { canAccess } from '../lib/roles';
import { dayLabel, fmtDateShort, fmtDateTime, fmtTime, pad2 } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

const POLL_MS = 20_000;
const CHIPS_VISIBLE = 6;

/** Videodagi vaqt: 2052 → "34:12", 4500 → "1:15:00". */
export function fmtVideoSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

const sessionKey = (s: Pick<ChatSession, 'day' | 'at'>) => `${s.day}|${s.at}`;
const sameInstant = (a: string | null, b: string) => !!a && Date.parse(a) === Date.parse(b);

function sessionLabel(s: ChatSession): string {
  const parts = [`${fmtDateShort(s.at)} ${fmtTime(s.at)}`, `${s.day}-kun`, `${num(s.count)} xabar`];
  if (s.unanswered > 0) parts.push(`${num(s.unanswered)} javobsiz`);
  return parts.join(' · ');
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function ChatItem({ row, canOpenLead, onReplied }: { row: ChatRow; canOpenLead: boolean; onReplied: (r: ChatRow) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = `chat-reply-${row.id}`;
  const hintId = `${inputId}-hint`;

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const updated = await api.chatReply(row.id, t);
      toast.success('Javob bot orqali lidga yuborildi');
      setText('');
      onReplied(updated ?? { ...row, answer: t, answered_at: new Date().toISOString(), answered_by: null });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={row.answer === null ? 'card chat-item chat-item-new' : 'card chat-item'}>
      <div className="chat-head">
        <div className="chat-who">
          {canOpenLead ? <Link to={`/leads/${row.lead_id}`} className="chat-name">{row.lead_name}</Link> : <span className="chat-name">{row.lead_name}</span>}
          {row.lead_phone && <a href={telHref(row.lead_phone)} className="chat-phone tnum">{row.lead_phone}</a>}
        </div>
        <div className="chat-meta">
          {row.day && (
            <Badge tone="warn" title="Videoning qaysi joyida yozilgan">
              {row.day}-kun{row.video_sec !== null ? ` · ${fmtVideoSec(row.video_sec)}` : ''}
            </Badge>
          )}
          <time className="small muted tnum" dateTime={row.created_at} title={fmtDateTime(row.created_at)}>{dayLabel(row.created_at)}, {fmtTime(row.created_at)}</time>
        </div>
      </div>
      <div className="q-text">{row.text}</div>
      {row.answer !== null ? (
        <div className="stack-sm" style={{ gap: 4 }}>
          <div className="q-answer">{row.answer}</div>
          <div className="small muted">Javob berdi: {row.answered_by ?? '—'}{row.answered_at ? `, ${fmtDateTime(row.answered_at)}` : ''}</div>
        </div>
      ) : (
        <div className="stack-sm">
          <label className="visually-hidden" htmlFor={inputId}>{row.lead_name}ga javob</label>
          <textarea
            id={inputId}
            className="textarea chat-reply"
            rows={2}
            value={text}
            maxLength={4096}
            placeholder="Javob yozing…"
            aria-describedby={hintId}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(); }}
          />
          <div className="row-between">
            <span id={hintId} className="small muted">Javob lidga bot orqali Telegram'da boradi · Ctrl+Enter — yuborish</span>
            <button type="button" className="btn btn-accent btn-sm" disabled={busy || !text.trim()} onClick={() => void send()}>{busy ? 'Yuborilmoqda…' : 'Javob yuborish'}</button>
          </div>
        </div>
      )}
    </article>
  );
}

function ChatBody({ fid }: { fid: number }) {
  const user = useUser();
  const canOpenLead = canAccess(user.role, 'leads');
  const [day, setDay] = useState<0 | 1 | 2>(0);
  const [onlyNew, setOnlyNew] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [allChips, setAllChips] = useState(false);

  const sessions = useLoad(() => api.chatSessions(fid), [fid]);
  const selSession = sessions.data?.find((s) => sessionKey(s) === sessionId) ?? null;
  const chat = useLoad(
    () => api.chat(fid, {
      day: selSession ? selSession.day : day || '',
      // bitta efir tanlansa — server shu efirning barcha xabarlarini qaytaradi (yarim tundan keyingilari ham)
      session_at: selSession ? selSession.at : undefined,
      status: onlyNew ? 'unanswered' : 'all',
    }),
    [fid, day, onlyNew, sessionId, !!selSession],
  );

  // Har 20 soniyada jim yangilash (sahifa ko'rinib turganda)
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      void chat.reload();
      void sessions.reload();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [chat.reload, sessions.reload]);

  const chips = useMemo(() => {
    const l = [...(sessions.data ?? [])].filter((s) => !day || s.day === day).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return l;
  }, [sessions.data, day]);
  const shownChips = allChips ? chips : chips.slice(0, CHIPS_VISIBLE);
  const unansweredTotal = (sessions.data ?? []).filter((s) => !day || s.day === day).reduce((a, s) => a + s.unanswered, 0);

  const rows = useMemo(() => {
    let l = chat.data ?? [];
    if (selSession) l = l.filter((r) => sameInstant(r.session_at, selSession.at) && r.day === selSession.day);
    return [...l].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [chat.data, selSession]);

  const changeDay = (d: 0 | 1 | 2) => {
    setDay(d);
    if (selSession && d && selSession.day !== d) setSessionId(null);
  };

  const onReplied = (r: ChatRow) => {
    chat.setData((l) => (onlyNew ? (l ?? []).filter((x) => x.id !== r.id) : (l ?? []).map((x) => (x.id === r.id ? r : x))));
    sessions.setData((l) => (l ?? []).map((s) => (s.day === r.day && r.session_at && sameInstant(r.session_at, s.at) ? { ...s, unanswered: Math.max(0, s.unanswered - 1) } : s)));
  };

  return (
    <>
      <div className="chat-filters">
        <div className="row">
          <Segmented label="Kun" value={day} onChange={changeDay} options={[{ value: 0, label: 'Hammasi' }, { value: 1, label: '1-kun' }, { value: 2, label: '2-kun' }]} />
          <button type="button" className={onlyNew ? 'chip chip-on' : 'chip'} aria-pressed={onlyNew} onClick={() => setOnlyNew((v) => !v)}>
            Faqat javobsizlar{unansweredTotal > 0 && <span className="chip-n"> · {num(unansweredTotal)}</span>}
          </button>
        </div>
        {sessions.error && !sessions.data ? <ErrorBox error={sessions.error} onRetry={() => void sessions.reload()} /> : chips.length > 0 && (
          <div className="chips" role="group" aria-label="Efirlar">
            <button type="button" className={!selSession ? 'chip chip-on' : 'chip'} aria-pressed={!selSession} onClick={() => setSessionId(null)}>Barcha efirlar</button>
            {shownChips.map((s) => {
              const on = sessionKey(s) === sessionId;
              return (
                <button key={sessionKey(s)} type="button" className={on ? 'chip chip-on' : s.unanswered > 0 ? 'chip chip-warn' : 'chip'} aria-pressed={on} onClick={() => setSessionId(on ? null : sessionKey(s))}>
                  {sessionLabel(s)}
                </button>
              );
            })}
            {chips.length > CHIPS_VISIBLE && (
              <button type="button" className="chip chip-more" onClick={() => setAllChips((v) => !v)}>
                {allChips ? 'Kamroq' : `Yana ${chips.length - CHIPS_VISIBLE} ta efir`}
              </button>
            )}
          </div>
        )}
      </div>

      {chat.error && !chat.data ? <ErrorBox error={chat.error} onRetry={() => void chat.reload()} /> : !chat.data ? <Loading /> : rows.length === 0 ? (
        <Empty title={onlyNew ? "Javobsiz xabar yo'q" : "Hali xabar yo'q"}>
          {onlyNew ? 'Barcha xabarlarga javob berilgan.' : "Efir davomida Mini App'dagi chatga yozilgan xabarlar shu yerda paydo bo'ladi."}
        </Empty>
      ) : (
        <div className="stack chat-list">
          {rows.map((r) => <ChatItem key={r.id} row={r} canOpenLead={canOpenLead} onReplied={onReplied} />)}
        </div>
      )}
    </>
  );
}

export default function Chat() {
  return (
    <>
      <PageHead title="Efir chati" sub="Efir davomida Mini App'da yozilgan fikr va savollar — yangilari tepada. Ro'yxat har 20 soniyada yangilanadi." />
      <NeedFunnel>{(f) => <ChatBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
