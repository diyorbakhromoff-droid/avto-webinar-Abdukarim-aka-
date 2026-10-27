import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api/admin';
import type { LeadCard, PaymentKind, PaymentMethod } from '../api/types';
import { ContactForm } from '../components/ContactForm';
import { MessageModal } from '../components/MessageModal';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/fields';
import { FunnelPath } from '../components/pipeline/FunnelPath';
import { StageSelect } from '../components/pipeline/Stage';
import { Badge, Card, Empty, ErrorBox, Loading, type Tone } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { useFunnel } from '../lib/funnel';
import { money } from '../lib/format';
import {
  METHOD_LABEL, PAYMENT_KIND_LABEL, PAYMENT_STATUS_LONG, STEP_LABEL, options,
} from '../lib/labels';
import { useManagers } from '../lib/managers';
import { fmtDateShort, fmtDateTime, fmtDateTimeLong, fromLocalInput, toLocalInput } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

const DOT: Record<'g' | 'a' | 'r' | 'n' | 'm', string> = { g: '#23703F', a: '#B8892A', r: '#B3261E', n: '#C9C3B5', m: '#1C1B18' };

/** Voqea turini rangga moslaydi (shartnomada type ro'yxati berilmagan — kalit so'zlar bo'yicha). */
function dotFor(type: string): string {
  const t = type.toLowerCase();
  if (/(manager|contact|note|call|izoh)/.test(t)) return DOT.m;
  if (/(reject|missed|left|block|unsub|refund|cold|fail|expire)/.test(t)) return DOT.r;
  if (/(paid|approve|phone|session|watched|complete|registered|full|deposit|invite)/.test(t)) return DOT.g;
  if (/(enter|join|click|receipt|offer|reschedul|deadline)/.test(t)) return DOT.a;
  return DOT.n;
}

const PAY_TONE: Record<string, Tone> = { pending: 'warn', approved: 'success', rejected: 'danger' };
const PAY_STATUS: Record<string, string> = { pending: 'kutilmoqda', approved: 'tasdiqlangan', rejected: 'rad etilgan' };

function WatchBars({ lead }: { lead: LeadCard }) {
  const session = lead.sessions.find((s) => s.status === 'active') ?? lead.sessions[lead.sessions.length - 1];
  return (
    <Card title="Efirni ko'rish">
      {[1, 2].map((day) => {
        const w = lead.watch.find((x) => x.day === day);
        const at = session ? (day === 1 ? session.day1_at : session.day2_at) : null;
        const title = `${day}-kun${at ? ` · ${fmtDateTime(at)}` : ''}`;
        if (!w) {
          const future = at ? Date.parse(at) > Date.now() : true;
          return (
            <div key={day} className="watch">
              <div className="watch-head"><span className="strong">{title}</span><span className="muted">{session ? (future ? 'hali boshlanmagan' : "ko'rmadi") : 'sessiya tanlanmagan'}</span></div>
              <div className="watch-track" aria-hidden="true" />
            </div>
          );
        }
        const share = w.duration_min > 0 ? Math.min(1, w.minutes / w.duration_min) : 0;
        const good = day === 1 ? share >= 0.75 : w.reached_offer;
        const offerPos = w.offer_min !== null && w.duration_min > 0 ? Math.min(100, (w.offer_min / w.duration_min) * 100) : null;
        return (
          <div key={day} className="watch">
            <div className="watch-head">
              <span className="strong">{title}</span>
              <span className="tnum">{w.minutes} / {w.duration_min} daq · {w.offer_min !== null && day === 2 ? `oferta ${w.offer_min}-daqiqada` : `${Math.round(share * 100)}%`}</span>
            </div>
            <div className="watch-track" role="img" aria-label={`${day}-kun: ${w.minutes} daqiqa ko'rgan, ${Math.round(share * 100)}%`}>
              <div className="watch-bar" style={{ width: `${Math.max(1, share * 100)}%`, background: good ? 'var(--success)' : 'var(--bar)' }} />
              {offerPos !== null && <div className="watch-marker" style={{ left: `${offerPos}%` }} title={`Oferta: ${w.offer_min}-daqiqa`} />}
            </div>
            {day === 2 && w.offer_min !== null && (w.reached_offer
              ? <div className="small text-success strong">Oferta momentiga yetdi</div>
              : <div className="small strong" style={{ color: 'var(--danger-ink)' }}>Ofertagacha chiqib ketgan</div>)}
            {day === 1 && !good && <div className="small muted">75% dan kam — «ko'rmagan» hisoblanadi</div>}
          </div>
        );
      })}
    </Card>
  );
}

function ReceiptModal({ open, lead, onClose, onDone }: { open: boolean; lead: LeadCard; onClose: () => void; onDone: () => void }) {
  const { funnel } = useFunnel();
  const toast = useToast();
  const tariffs = useLoad(open && funnel ? () => api.tariffs(funnel.id) : null, [open, funnel?.id]);
  const [file, setFile] = useState<File | null>(null);
  const [tariffId, setTariffId] = useState<number | null>(null);
  const [kind, setKind] = useState<PaymentKind>('deposit');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setKind(lead.payment_status === 'deposit' ? 'remaining' : 'deposit');
    }
  }, [open, lead.payment_status]);
  useEffect(() => {
    if (tariffs.data?.length && tariffId === null) setTariffId(tariffs.data[0].id);
  }, [tariffs.data, tariffId]);
  useEffect(() => {
    const t = tariffs.data?.find((x) => x.id === tariffId);
    if (!t) return;
    if (kind === 'deposit') setAmount(t.deposit_enabled ? t.deposit_amount : null);
    else if (kind === 'full') setAmount(t.special_price);
    else setAmount(lead.remaining_amount);
  }, [kind, tariffId, tariffs.data, lead.remaining_amount]);

  const submit = async () => {
    if (!file || tariffId === null || !amount) return;
    setBusy(true);
    try {
      await api.uploadReceipt(lead.id, { file, tariff_id: tariffId, kind, method, amount });
      toast.success("Chek tasdiq navbatiga qo'shildi");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Chek yuklash"
      footer={<><button type="button" className="btn" onClick={onClose}>Bekor qilish</button><button type="button" className="btn btn-accent" disabled={busy || !file || !tariffId || !amount} onClick={() => void submit()}>{busy ? 'Yuklanmoqda…' : 'Yuklash'}</button></>}>
      <div className="muted small">Lid chekni to'g'ridan-to'g'ri menejerga bergan bo'lsa — shu yerga yuklang. U bot cheklari bilan bir xil navbatga tushadi.</div>
      <label className="btn file-btn" htmlFor="receipt-file">
        {file ? file.name : 'Rasm yoki PDF tanlash'}
        <input id="receipt-file" type="file" accept="image/*,application/pdf" className="visually-hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {tariffs.error ? <ErrorBox error={tariffs.error} /> : (
        <div className="grid-2">
          <label className="field">
            <span>Tarif</span>
            <select className="select" value={tariffId ?? ''} onChange={(e) => setTariffId(Number(e.target.value))}>
              {(tariffs.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Turi</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
              {options(PAYMENT_KIND_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>To'lov usuli</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {options(METHOD_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Summa</span><MoneyInput value={amount} onChange={setAmount} /></label>
        </div>
      )}
    </Modal>
  );
}

function PaymentBlock({ lead, reload }: { lead: LeadCard; reload: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [deadline, setDeadline] = useState(toLocalInput(lead.deadline_at));
  const [remaining, setRemaining] = useState<number | null>(lead.remaining_amount);
  const [due, setDue] = useState(lead.remaining_due_date?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    setDeadline(toLocalInput(lead.deadline_at));
    setRemaining(lead.remaining_amount);
    setDue(lead.remaining_due_date?.slice(0, 10) ?? '');
  }, [lead.deadline_at, lead.remaining_amount, lead.remaining_due_date]);

  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k);
    try {
      await fn();
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const extend = () => {
    const iso = fromLocalInput(deadline);
    if (!iso) return;
    void run('deadline', () => api.setDeadline(lead.id, iso), 'Deadline yangilandi');
  };
  const planDirty = remaining !== lead.remaining_amount || due !== (lead.remaining_due_date?.slice(0, 10) ?? '');
  const savePlan = () => void run('plan', () => api.paymentPlan(lead.id, { remaining_amount: remaining, remaining_due_date: due || null }), "To'lov rejasi saqlandi");
  const invite = async () => {
    const ok = await confirm({ title: 'Kanalga havola yuborish', message: `${lead.name} ga yopiq kurs kanaliga bir kishilik havola yuboriladi.`, confirmText: 'Yuborish' });
    if (ok) void run('invite', () => api.sendInvite(lead.id), 'Havola yuborildi');
  };

  const deadlinePassed = lead.deadline_at ? Date.parse(lead.deadline_at) < Date.now() : false;

  return (
    <Card title="To'lov va deadline">
      <div className="grid-2">
        <div className="kv"><span className="kv-k">Holat</span><span className="kv-v">{PAYMENT_STATUS_LONG[lead.payment_status]}</span></div>
        <div className="kv">
          <span className="kv-k">Shaxsiy deadline</span>
          <span className="kv-v">{lead.deadline_at ? fmtDateTime(lead.deadline_at) : '—'}{deadlinePassed && <> <Badge tone="danger">tugagan</Badge></>}</span>
        </div>
        <label className="field field-compact"><span>Qolgan summa</span><MoneyInput value={remaining} onChange={setRemaining} /></label>
        <label className="field field-compact"><span>To'lov sanasi</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      {planDirty && <div className="row-end"><button type="button" className="btn btn-sm btn-accent" disabled={busy === 'plan'} onClick={savePlan}>{busy === 'plan' ? 'Saqlanmoqda…' : "To'lov rejasini saqlash"}</button></div>}
      <div className="inline-form">
        <label className="field field-compact"><span>Deadline'ni uzaytirish</span><input className="input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        <button type="button" className="btn btn-sm" disabled={!deadline || deadline === toLocalInput(lead.deadline_at) || busy === 'deadline'} onClick={extend}>Deadline uzaytirish</button>
      </div>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => setReceiptOpen(true)}>Chek yuklash</button>
        <button type="button" className="btn btn-sm" disabled={busy === 'invite' || lead.blocked} onClick={() => void invite()}>Kanalga havola yuborish</button>
      </div>
      {lead.payments.length > 0 && (
        <div className="table-wrap flat">
          <table className="table table-compact">
            <thead><tr><th>Sana</th><th>Tarif</th><th>Turi</th><th className="num">Summa</th><th>Holat</th></tr></thead>
            <tbody>
              {lead.payments.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap"><Link to={`/payments?id=${p.id}`}>{fmtDateShort(p.submitted_at)}</Link></td>
                  <td>{p.tariff}</td>
                  <td>{PAYMENT_KIND_LABEL[p.kind]}</td>
                  <td className="num">{money(p.amount)}</td>
                  <td><Badge tone={PAY_TONE[p.status]}>{PAY_STATUS[p.status]}</Badge>{p.refunded && <> <Badge tone="danger">qaytarilgan</Badge></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReceiptModal open={receiptOpen} lead={lead} onClose={() => setReceiptOpen(false)} onDone={reload} />
    </Card>
  );
}

function ContactBlock({ lead, reload }: { lead: LeadCard; reload: () => void }) {
  return (
    <Card title="Aloqa natijasi">
      <ContactForm lead={lead} onSaved={reload} />
    </Card>
  );
}

function ManagerBlock({ lead, reload }: { lead: LeadCard; reload: () => void }) {
  const managers = useManagers();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const opts = lead.manager && !managers.some((m) => m.id === lead.manager!.id) ? [lead.manager, ...managers] : managers;
  const change = async (v: string) => {
    setBusy(true);
    try {
      await api.assign(lead.id, v ? Number(v) : null);
      toast.success(v ? 'Menejer biriktirildi' : 'Biriktirish olib tashlandi');
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Menejer va bosqich">
      <StageSelect key={`${lead.id}:${lead.stage}`} leadId={lead.id} stage={lead.stage} onChanged={reload} />
      <label className="field">
        <span>Biriktirilgan menejer</span>
        <select className="select" value={lead.manager?.id ?? ''} disabled={busy} onChange={(e) => void change(e.target.value)}>
          <option value="">— Biriktirilmagan</option>
          {opts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      {lead.sessions.length > 0 && (
        <div className="stack-sm">
          <div className="small strong muted">Sessiyalar</div>
          {lead.sessions.map((s) => (
            <div key={s.id} className="row-between small">
              <span>1-kun: {fmtDateTime(s.day1_at)} · 2-kun: {fmtDateTime(s.day2_at)}</span>
              <Badge tone={s.status === 'active' ? 'success' : s.status === 'completed' ? 'neutral' : 'warn'}>{s.status === 'active' ? 'faol' : s.status === 'completed' ? 'tugagan' : 'almashtirilgan'}</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Events({ lead }: { lead: LeadCard }) {
  const events = [...lead.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <Card title="Voqealar lentasi">
      {events.length === 0 ? <div className="muted">Voqealar yo'q.</div> : (
        <div className="events">
          {events.map((e, i) => (
            <div key={i} className="event">
              <div className="event-t">{fmtDateTime(e.at)}</div>
              <div className="event-rail"><div className="event-dot" style={{ background: dotFor(e.type) }} /><div className="event-line" /></div>
              <div className="event-body"><div className="event-title">{e.title}</div>{e.details && <div className="event-sub">{e.details}</div>}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: 'kutmoqda', tone: 'warn' }, active: { label: 'yurmoqda', tone: 'warn' },
  done: { label: 'tugadi', tone: 'success' }, stopped: { label: "to'xtadi", tone: 'neutral' },
};
const WAITING_FOR: Record<string, string> = { button: 'tugma bosishini', time: 'vaqtni', event: 'harakatini', chain: 'zanjir xabarlarini' };

/** Progrev sxemasida lid qayerda (bo'limlar bo'yicha). */
function FlowRuns({ lead }: { lead: LeadCard }) {
  const runs = lead.flow_runs ?? [];
  const tags = lead.tags ?? [];
  if (!runs.length && !tags.length) return null;
  return (
    <Card title="Progrev sxemasida">
      {tags.length > 0 && <div className="row">{tags.map((t) => <Badge key={t} tone="info">#{t}</Badge>)}</div>}
      {runs.length > 0 && (
        <ul className="plain-list" style={{ listStyle: 'none', padding: 0 }}>
          {runs.map((r) => {
            const s = RUN_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone };
            return (
              <li key={r.id} className="stack-sm" style={{ gap: 2, padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
                <div className="row-between">
                  <Link to={`/chain?bolim=${r.flow_id}`}><b>{r.flow_name}</b></Link>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                <div className="small">
                  {r.node_title ?? '—'}
                  {r.status === 'waiting' && r.waiting_for ? ` · ${WAITING_FOR[r.waiting_for] ?? ''} kutyapti` : ''}
                  {r.status === 'waiting' && r.wait_until ? ` (${fmtDateTime(r.wait_until)} gacha)` : ''}
                </div>
                <div className="small muted">boshlandi {fmtDateTime(r.started_at)}{r.reason && r.status !== 'waiting' ? ` · ${r.reason}` : ''}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Messages({ lead, reload }: { lead: LeadCard; reload: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  if (!lead.messages.length) return null;
  const list = [...lead.messages].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const cancel = async (id: number, title: string) => {
    if (!(await confirm({ title: 'Xabarni bekor qilish', message: `«${title}» ${lead.name} ga yuborilmaydi. Boshqa lidlarga ta'sir qilmaydi.`, confirmText: 'Bekor qilish', danger: true }))) return;
    try {
      await api.cancelScheduled(id);
      toast.success('Bekor qilindi');
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card title={`Yuborilgan xabarlar · ${list.length}`}>
      <div className="table-wrap flat">
        <table className="table table-compact">
          <thead><tr><th>Vaqt</th><th>Xabar</th><th>Holat</th><th /></tr></thead>
          <tbody>
            {list.map((m, i) => (
              <tr key={i}>
                <td className="nowrap tnum muted">{fmtDateTime(m.at)}</td>
                <td>{m.title}</td>
                <td><Badge tone={/fail|xato|block|error/i.test(m.status) ? 'danger' : /deliver|yetkaz|sent|yubor/i.test(m.status) ? 'success' : 'neutral'}>{m.status}</Badge></td>
                <td className="num">{m.cancellable && m.id !== undefined && <button type="button" className="btn btn-sm btn-ghost btn-danger-ghost" onClick={() => void cancel(m.id!, m.title)}>Bekor qilish</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function LeadCardPage() {
  const { id } = useParams();
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back ?? '';
  const leadId = Number(id);
  const st = useLoad(() => api.lead(leadId), [leadId]);
  const [msgOpen, setMsgOpen] = useState(false);
  const reload = () => void st.reload();

  if (!Number.isFinite(leadId)) return <Empty title="Lid topilmadi" />;
  return (
    <>
      <Link to={`/leads${back}`} className="back-link">← Lidlar</Link>
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : (() => {
        const l = st.data;
        const tel = l.phone?.replace(/[^\d+]/g, '');
        return (
          <>
            <div className="page-head">
              <div className="page-head-text">
                <h1>
                  {l.name}{' '}
                  {l.blocked && <Badge tone="danger">botni bloklagan</Badge>}{' '}
                  {l.unsubscribed && <Badge tone="neutral">xabarlarni to'xtatgan</Badge>}
                </h1>
                <div className="page-sub">
                  {[l.username ? `@${l.username}` : null, `manba ${l.source || '—'}`, `ro'yxat ${fmtDateTimeLong(l.registered_at)}`].filter(Boolean).join(' · ')}
                </div>
                <div className="row"><Badge tone="warn">{l.step_label || STEP_LABEL[l.step]}</Badge></div>
              </div>
              <div className="page-actions">
                {tel ? <a href={`tel:${tel}`} className="btn btn-primary">Qo'ng'iroq: {l.phone}</a> : <span className="muted">Telefon yo'q</span>}
                <button type="button" className="btn" disabled={l.blocked || l.unsubscribed} onClick={() => setMsgOpen(true)} title={l.blocked ? 'Lid botni bloklagan' : undefined}>Bot orqali xabar</button>
              </div>
            </div>
            <div className="cols">
              <div className="stack" style={{ flex: '2 1 380px', gap: 20 }}>
                <WatchBars lead={l} />
                <PaymentBlock lead={l} reload={reload} />
                <ContactBlock lead={l} reload={reload} />
                <ManagerBlock lead={l} reload={reload} />
                <FlowRuns lead={l} />
              </div>
              <div className="stack" style={{ flex: '3 1 420px', gap: 20 }}>
                <Card title="Avtovoronka yo'li"><FunnelPath lead={l} /></Card>
                <Events lead={l} />
                <Messages lead={l} reload={reload} />
              </div>
            </div>
            <MessageModal open={msgOpen} leadIds={[l.id]} onClose={() => setMsgOpen(false)} onSent={reload} />
          </>
        );
      })()}
    </>
  );
}
