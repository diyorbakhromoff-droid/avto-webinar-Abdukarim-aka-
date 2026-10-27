import { useEffect, useState } from 'react';
import { api } from '../api/admin';
import { errorText } from '../api/errors';
import type { LeadRow, TestRequest, TestResult, TestTarget } from '../api/types';
import { useUser } from '../lib/auth';
import { useFunnel } from '../lib/funnel';
import { canAccess } from '../lib/roles';
import { useLoad } from '../lib/useLoad';
import { Modal } from './Modal';

const VAR_LABEL: Record<string, string> = { ism: 'Ism', efir_sanasi: 'Efir sanasi', efir_vaqti: 'Efir vaqti', deadline: 'Deadline' };

/**
 * «🧪 Test xabarini yuborish»: xabar faqat adminning o'ziga yoki test chatiga boradi — lidlarga emas.
 * send — xabar turiga qarab (zanjir xabari / ommaviy xabar) tegishli endpointni chaqiradi.
 */
export function TestSendModal({ open, title, onClose, send }: {
  open: boolean;
  title: string;
  onClose: () => void;
  send: (req: TestRequest) => Promise<TestResult>;
}) {
  const me = useUser();
  const { funnel } = useFunnel();
  const targets = useLoad(open ? () => api.testTargets() : null, [open]);
  const [target, setTarget] = useState<TestTarget>('me');
  const [mode, setMode] = useState<'sample' | 'lead'>('sample');
  const [name, setName] = useState('Madina');
  const [q, setQ] = useState('');
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: TestResult } | { error: string } | null>(null);
  const canLeads = canAccess(me.role, 'leads');
  const found = useLoad(open && mode === 'lead' && funnel && q.trim().length >= 2
    ? () => api.leads(funnel.id, { q: q.trim(), page_size: 6 }) : null, [open, mode, q, funnel?.id]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setBusy(false);
  }, [open]);
  useEffect(() => {
    // o'zingizda Telegram ID yo'q, test chati bor bo'lsa — darhol test chatini tanlaymiz
    if (targets.data && !targets.data.me.ready && targets.data.chat.ready) setTarget('chat');
  }, [targets.data]);

  const ready = targets.data ? targets.data[target].ready : false;
  const canSend = ready && !busy && (mode === 'sample' || !!lead);
  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await send({ target, sample_name: name.trim(), lead_id: mode === 'lead' ? lead?.id ?? null : null });
      setResult({ ok: r });
    } catch (e) {
      setResult({ error: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="🧪 Test xabarini yuborish" size="md"
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Yopish</button>
          <button type="button" className="btn btn-accent" disabled={!canSend} onClick={() => void submit()}>
            {busy ? 'Yuborilmoqda…' : result ? 'Yana yuborish' : 'Test yuborish'}
          </button>
        </>
      )}>
      <div className="box box-info small">
        <div>«{title}» faqat siz tanlagan joyga boradi — <b>lidlarga yuborilmaydi</b> va navbatga qo'shilmaydi.
          Lidlarga odatdagi tartibda (zanjir yoki ommaviy xabar) ketadi.</div>
      </div>

      <div className="field">
        <span>Qayerga</span>
        <div className="chips" role="radiogroup" aria-label="Qayerga">
          <button type="button" role="radio" aria-checked={target === 'me'} className={target === 'me' ? 'chip chip-on' : 'chip'}
            disabled={targets.data && !targets.data.me.ready} onClick={() => setTarget('me')}>Mening Telegramim</button>
          <button type="button" role="radio" aria-checked={target === 'chat'} className={target === 'chat' ? 'chip chip-on' : 'chip'}
            disabled={targets.data && !targets.data.chat.ready} onClick={() => setTarget('chat')}>
            Test chati{targets.data?.chat.title ? `: ${targets.data.chat.title}` : ''}
          </button>
        </div>
        {targets.data && !targets.data.me.ready && <span className="small muted">Telegram ID ingiz kiritilmagan — super admin Sozlamalar → Foydalanuvchilarda kiritadi.</span>}
        {targets.data && !targets.data.chat.ready && <span className="small muted">Test chati ulanmagan — Sozlamalar → «Test chati».</span>}
      </div>

      <div className="field">
        <span>{'{ism}, {efir_vaqti}'} kabi o'zgaruvchilar uchun ma'lumot</span>
        <div className="chips" role="radiogroup" aria-label="Ma'lumot">
          <button type="button" role="radio" aria-checked={mode === 'sample'} className={mode === 'sample' ? 'chip chip-on' : 'chip'} onClick={() => setMode('sample')}>Namunaviy lid</button>
          {canLeads && <button type="button" role="radio" aria-checked={mode === 'lead'} className={mode === 'lead' ? 'chip chip-on' : 'chip'} onClick={() => setMode('lead')}>Haqiqiy lid ma'lumoti</button>}
        </div>
      </div>
      {mode === 'sample' ? (
        <label className="field field-compact">
          <span>Namunaviy ism (efir vaqti — eng yaqin slot)</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
      ) : (
        <div className="stack-sm">
          <label className="field field-compact">
            <span>Lidni qidiring</span>
            <input className="input" type="search" value={q} onChange={(e) => { setQ(e.target.value); setLead(null); }} placeholder="Ism yoki telefon" />
          </label>
          {lead ? (
            <div className="tile"><span><b>{lead.name}</b> <span className="muted">{lead.phone ?? ''}</span></span><button type="button" className="link-btn" onClick={() => setLead(null)}>boshqasi</button></div>
          ) : (found.data?.items ?? []).map((l) => (
            <button key={l.id} type="button" className="tile tile-btn" onClick={() => setLead(l)}>
              <span><b>{l.name}</b> <span className="muted">{l.phone ?? ''}</span></span><span className="small muted">{l.step_label}</span>
            </button>
          ))}
          <span className="small muted">Xabar shu lidga emas, sizga boradi — faqat uning ismi va efir vaqti qo'yiladi.</span>
        </div>
      )}

      {result && 'ok' in result && (
        <div className="box box-success box-col" role="status">
          <div><b>✅ Yuborildi</b> — {result.ok.target}, {result.ok.sent_at_label}. Telegramni oching va matn, media, tugmalar va havolalarni tekshiring.</div>
          <div className="small">Ma'lumot: {result.ok.data_source}</div>
          <div className="small test-vars">
            {Object.entries(result.ok.variables).map(([k, v]) => (
              <span key={k}>{VAR_LABEL[k] ?? k}: <b>{v || '—'}</b></span>
            ))}
          </div>
          {result.ok.notes.map((n) => <div key={n} className="small strong" style={{ color: 'var(--accent-ink)' }}>⚠ {n}</div>)}
          <div className="small muted">Test xabaridagi tugmalar bosilganda lid uchun hech narsa o'zgarmaydi — faqat izoh chiqadi.</div>
        </div>
      )}
      {result && 'error' in result && (
        <div className="box box-danger" role="alert"><span><b>❌ Yuborilmadi.</b> {result.error}</span></div>
      )}
    </Modal>
  );
}
