import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/admin';
import type { QuestionRow } from '../api/types';
import { NeedFunnel } from '../components/NeedFunnel';
import { Badge, Card, Empty, ErrorBox, Loading, PageHead, Segmented } from '../components/ui';
import { agoLabel, fmtDateTime } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

function QuestionCard({ q, onAnswered }: { q: QuestionRow; onAnswered: (id: number, text: string) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.answer(q.id, text.trim());
      toast.success('Javob bot orqali yuborildi');
      onAnswered(q.id, text.trim());
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="q-card">
      <div className="row-between">
        <div className="row">
          <Link to={`/leads/${q.lead_id}`} className="strong">{q.lead_name}</Link>
          <Badge tone={q.source === 'miniapp' ? 'warn' : 'neutral'}>{q.source === 'miniapp' ? 'efirdan' : 'botdan'}</Badge>
        </div>
        <span className="small muted" title={fmtDateTime(q.created_at)}>{agoLabel(q.created_at)}</span>
      </div>
      <div className="q-text">{q.text}</div>
      {q.answer !== null ? (
        <div className="stack-sm">
          <div className="q-answer">{q.answer}</div>
          {q.answered_at && <div className="small muted">Javob berildi: {fmtDateTime(q.answered_at)}</div>}
        </div>
      ) : (
        <div className="stack-sm">
          <label className="field" htmlFor={`ans-${q.id}`}><span>Javob (bot orqali lidga yuboriladi)</span></label>
          <textarea id={`ans-${q.id}`} className="textarea" rows={3} style={{ minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} maxLength={4096}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(); }} />
          <div className="row-between">
            <span className="small muted">Ctrl+Enter — yuborish</span>
            <button type="button" className="btn btn-accent" disabled={busy || !text.trim()} onClick={() => void send()}>{busy ? 'Yuborilmoqda…' : 'Javob yuborish'}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function QuestionsBody({ fid }: { fid: number }) {
  const [answered, setAnswered] = useState(false);
  const st = useLoad(() => api.questions(fid, answered), [fid, answered]);
  const list = [...(st.data ?? [])].sort((a, b) => (answered ? Date.parse(b.created_at) - Date.parse(a.created_at) : Date.parse(a.created_at) - Date.parse(b.created_at)));
  const onAnswered = (id: number) => st.setData((l) => (l ?? []).filter((q) => q.id !== id));
  return (
    <>
      <Segmented label="Savollar" value={answered ? 'yes' : 'no'} onChange={(v) => setAnswered(v === 'yes')}
        options={[{ value: 'no', label: `Javobsiz${!answered && st.data ? ` · ${st.data.length}` : ''}` }, { value: 'yes', label: 'Javob berilgan' }]} />
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : list.length === 0 ? (
        <Empty title={answered ? 'Javob berilgan savol yo\'q' : 'Javobsiz savol yo\'q'}>{answered ? undefined : 'Efir yoki botdan kelgan savollar shu yerda paydo bo\'ladi.'}</Empty>
      ) : (
        <div className="stack" style={{ maxWidth: 860 }}>
          {list.map((q) => <QuestionCard key={q.id} q={q} onAnswered={onAnswered} />)}
        </div>
      )}
    </>
  );
}

export default function Questions() {
  return (
    <>
      <PageHead title="Savollar" sub="Efirdagi va botdagi savollar. Javob bot orqali lidga boradi." />
      <NeedFunnel>{(f) => <QuestionsBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
