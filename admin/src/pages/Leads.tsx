import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, type LeadsFilter } from '../api/admin';
import type { CallListKey, LeadRow, LeadStep } from '../api/types';
import { MessageModal } from '../components/MessageModal';
import { Modal } from '../components/Modal';
import { NeedFunnel } from '../components/NeedFunnel';
import { Badge, Empty, ErrorBox, Loading, PageHead, Pagination, type Tone } from '../components/ui';
import { useUser } from '../lib/auth';
import { sinceLabel } from '../lib/format';
import { PAYMENT_STATUS_LABEL, RECEIPT_LABEL, STEP_LABEL, options } from '../lib/labels';
import { useManagers } from '../lib/managers';
import { fmtDateTime } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

const PAGE_SIZE = 50;
const BEFORE_DAY1: LeadStep[] = ['started', 'phone', 'session'];
const BEFORE_DAY2: LeadStep[] = [...BEFORE_DAY1, 'day1_missed', 'day1_watched', 'cold'];

const PAY_TONE: Record<LeadRow['payment_status'], Tone> = { none: 'neutral', deposit: 'warn', full: 'success' };
const RECEIPT_TONE: Record<LeadRow['receipt'], Tone> = { none: 'neutral', pending: 'warn', approved: 'success', rejected: 'danger' };

function dayCell(min: number | null, step: LeadStep, before: LeadStep[]) {
  if (min !== null) return <span className="tnum">{min} daq</span>;
  if (before.includes(step)) return <span className="muted">—</span>;
  return <span className="muted">ko'rmadi</span>;
}

function useFilters(): [LeadsFilter & { page: number }, (p: Partial<LeadsFilter>) => void] {
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => ({
    list: (sp.get('list') ?? '') as CallListKey | '',
    step: (sp.get('step') ?? '') as LeadStep | '',
    source: sp.get('source') ?? '',
    manager_id: sp.get('manager_id') ? Number(sp.get('manager_id')) : ('' as const),
    q: sp.get('q') ?? '',
    date_from: sp.get('date_from') ?? '',
    date_to: sp.get('date_to') ?? '',
    page: Math.max(1, Number(sp.get('page') ?? 1) || 1),
  }), [sp]);
  const update = (p: Partial<LeadsFilter>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(p)) {
      if (v === '' || v === undefined || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in p)) next.delete('page');
    setSp(next, { replace: true });
  };
  return [f, update];
}

function AssignModal({ open, ids, onClose, onDone }: { open: boolean; ids: number[]; onClose: () => void; onDone: () => void }) {
  const managers = useManagers();
  const toast = useToast();
  const [mid, setMid] = useState<string>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setMid(managers[0] ? String(managers[0].id) : ''); }, [open, managers]);
  const submit = async () => {
    setBusy(true);
    const manager = mid === 'none' ? null : Number(mid);
    const results = await Promise.allSettled(ids.map((id) => api.assign(id, manager)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBusy(false);
    if (failed) toast.error(`${failed} ta lidni biriktirib bo'lmadi`);
    else toast.success(`${ids.length} ta lid biriktirildi`);
    onDone();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Menejerga biriktirish · ${ids.length} ta lid`}
      footer={<><button type="button" className="btn" onClick={onClose}>Bekor qilish</button><button type="button" className="btn btn-accent" disabled={busy || !mid} onClick={() => void submit()}>{busy ? 'Kuting…' : 'Biriktirish'}</button></>}>
      <label className="field">
        <span>Menejer</span>
        <select className="select" value={mid} onChange={(e) => setMid(e.target.value)}>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="none">— Biriktirishni olib tashlash</option>
        </select>
      </label>
    </Modal>
  );
}

function LeadsBody({ fid }: { fid: number }) {
  const me = useUser();
  const toast = useToast();
  const location = useLocation();
  const managers = useManagers();
  const [f, update] = useFilters();
  const [q, setQ] = useState(f.q ?? '');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msgOpen, setMsgOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const lists = useLoad(() => api.callLists(fid), [fid]);
  const key = JSON.stringify(f);
  const leads = useLoad(() => api.leads(fid, { ...f, page_size: PAGE_SIZE }), [fid, key]);

  useEffect(() => setSelected(new Set()), [fid, key]);
  useEffect(() => setQ(f.q ?? ''), [f.q]);
  useEffect(() => {
    if (q === (f.q ?? '')) return;
    const t = setTimeout(() => update({ q: q.trim() }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const items = leads.data?.items ?? [];
  const allOn = items.length > 0 && items.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(items.map((l) => l.id)));
  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const sources = useMemo(() => [...new Set(items.map((l) => l.source).filter(Boolean))].sort(), [items]);
  const hasFilters = !!(f.list || f.step || f.source || f.manager_id || f.q || f.date_from || f.date_to);

  const doExport = async () => {
    setExporting(true);
    try {
      const { page: _p, ...rest } = f;
      void _p;
      await api.exportLeads(fid, rest);
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHead
        title="Lidlar"
        sub={leads.data ? `${leads.data.total} ta lid${hasFilters ? ' (filtr bo\'yicha)' : ''}` : undefined}
        actions={<button type="button" className="btn" onClick={() => void doExport()} disabled={exporting}>{exporting ? 'Tayyorlanmoqda…' : 'Excel eksport'}</button>}
      />

      <div className="stack-sm">
        <div className="small strong muted">Qo'ng'iroq ro'yxatlari</div>
        {lists.error ? <ErrorBox error={lists.error} onRetry={lists.reload} /> : (
          <div className="chips">
            <button type="button" className={!f.list ? 'chip chip-on' : 'chip'} aria-pressed={!f.list} onClick={() => update({ list: '' })}>Barchasi</button>
            {(lists.data ?? []).map((l) => (
              <button key={l.key} type="button" className={f.list === l.key ? 'chip chip-on' : 'chip'} aria-pressed={f.list === l.key} onClick={() => update({ list: f.list === l.key ? '' : l.key })}>
                {l.label} <span className="chip-n">{l.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="inline-form">
        <label className="field field-compact" style={{ flex: '2 1 240px' }}>
          <span>Qidiruv</span>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, telefon yoki username" />
        </label>
        <label className="field field-compact">
          <span>Qadam</span>
          <select className="select" value={f.step} onChange={(e) => update({ step: e.target.value as LeadStep | '' })}>
            <option value="">Barchasi</option>
            {options(STEP_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="field field-compact">
          <span>Manba</span>
          <input className="input" list="lead-sources" value={f.source ?? ''} onChange={(e) => update({ source: e.target.value.trim() })} placeholder="Barchasi" />
          <datalist id="lead-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field field-compact">
          <span>Menejer</span>
          <select className="select" value={f.manager_id === '' ? '' : String(f.manager_id)} onChange={(e) => update({ manager_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Barchasi</option>
            <option value={me.id}>Menga biriktirilgan</option>
            {managers.filter((m) => m.id !== me.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field field-compact" style={{ flex: '1 1 140px' }}>
          <span>Sanadan</span>
          <input className="input" type="date" value={f.date_from} max={f.date_to || undefined} onChange={(e) => update({ date_from: e.target.value })} />
        </label>
        <label className="field field-compact" style={{ flex: '1 1 140px' }}>
          <span>Sanagacha</span>
          <input className="input" type="date" value={f.date_to} min={f.date_from || undefined} onChange={(e) => update({ date_to: e.target.value })} />
        </label>
        {hasFilters && <button type="button" className="btn btn-ghost" onClick={() => { setQ(''); update({ list: '', step: '', source: '', manager_id: '', q: '', date_from: '', date_to: '' }); }}>Tozalash</button>}
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Tanlangan lidlar">
          <div className="bulk-bar-title">{selected.size} ta lid tanlandi</div>
          <button type="button" className="btn btn-sm btn-gold" onClick={() => setMsgOpen(true)}>Bot orqali xabar</button>
          <button type="button" className="btn btn-sm btn-on-dark" onClick={() => setAssignOpen(true)}>Menejerga biriktirish</button>
          <button type="button" className="btn btn-sm btn-on-dark" style={{ marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>Bekor qilish</button>
        </div>
      )}

      {leads.error && !leads.data ? <ErrorBox error={leads.error} onRetry={leads.reload} /> : !leads.data ? <Loading /> : items.length === 0 ? (
        <Empty title="Lid topilmadi">{hasFilters ? "Filtrlarni o'zgartirib ko'ring." : "Reklama deep link'idan kelgan lidlar shu yerda ko'rinadi."}</Empty>
      ) : (
        <div className="table-wrap" style={{ opacity: leads.loading ? 0.6 : 1 }}>
          <table className="table" style={{ minWidth: 1280 }}>
            <thead>
              <tr>
                <th className="td-check"><input type="checkbox" aria-label="Hammasini tanlash" checked={allOn} onChange={toggleAll} /></th>
                <th>Ism</th>
                <th>Telefon</th>
                <th>Manba</th>
                <th>1-kun</th>
                <th>2-kun</th>
                <th>Oferta</th>
                <th>Tugma</th>
                <th>Chek</th>
                <th>To'lov</th>
                <th>Oxirgi qadam</th>
                <th>Qancha vaqtdan beri</th>
                <th>Menejer</th>
                <th>Oxirgi aloqa</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} className={selected.has(l.id) ? 'row-selected' : undefined}>
                  <td className="td-check"><input type="checkbox" aria-label={`${l.name} ni tanlash`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                  <td>
                    <Link to={`/leads/${l.id}`} state={{ back: location.search }} className="cell-link">{l.name}</Link>
                    {l.blocked && <> <Badge tone="danger">bloklagan</Badge></>}
                    {l.unsubscribed && <> <Badge tone="neutral" title="«Xabarlarni to'xtatish» bosgan">to'xtatgan</Badge></>}
                  </td>
                  <td className="tnum nowrap">{l.phone ? <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}>{l.phone}</a> : <span className="muted">—</span>}</td>
                  <td className="muted">{l.source || '—'}</td>
                  <td>{dayCell(l.day1_minutes, l.step, BEFORE_DAY1)}</td>
                  <td>{dayCell(l.day2_minutes, l.step, BEFORE_DAY2)}</td>
                  <td>{l.reached_offer ? 'ha' : <span className="muted">yo'q</span>}</td>
                  <td>{l.clicked_buy ? 'ha' : <span className="muted">yo'q</span>}</td>
                  <td>{l.receipt === 'none' ? <span className="muted">—</span> : <Badge tone={RECEIPT_TONE[l.receipt]}>{RECEIPT_LABEL[l.receipt]}</Badge>}</td>
                  <td><Badge tone={PAY_TONE[l.payment_status]}>{PAYMENT_STATUS_LABEL[l.payment_status]}</Badge></td>
                  <td>{l.step_label || STEP_LABEL[l.step]}</td>
                  <td className="muted nowrap" title={fmtDateTime(l.step_since)}>{sinceLabel(l.step_since)}</td>
                  <td className="muted">{l.manager?.name ?? '—'}</td>
                  <td className="muted nowrap">{l.last_contact_at ? fmtDateTime(l.last_contact_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {leads.data && <Pagination page={f.page} pageSize={PAGE_SIZE} total={leads.data.total} onChange={(p) => update({ page: p })} />}

      <MessageModal open={msgOpen} leadIds={[...selected]} onClose={() => setMsgOpen(false)} onSent={() => setSelected(new Set())} />
      <AssignModal open={assignOpen} ids={[...selected]} onClose={() => setAssignOpen(false)} onDone={() => { setSelected(new Set()); void leads.reload(); }} />
    </>
  );
}

export default function Leads() {
  return <NeedFunnel>{(f) => <LeadsBody key={f.id} fid={f.id} />}</NeedFunnel>;
}
