import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/admin';
import { errorText } from '../api/errors';
import { REJECT_REASONS, type PaymentRow, type PaymentsStatusFilter } from '../api/types';
import { Modal } from '../components/Modal';
import { NeedFunnel } from '../components/NeedFunnel';
import { Badge, Empty, ErrorBox, Loading, PageHead, Segmented } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { money } from '../lib/format';
import { METHOD_LABEL, METHOD_SHORT, PAYMENT_KIND_LABEL } from '../lib/labels';
import { agoLabel, fmtDateTime, fmtTime } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

const POLL_MS = 20_000;

function useReceiptUrl(p: PaymentRow | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!p?.file_url) return;
    let alive = true;
    let obj: string | null = null;
    setLoading(true);
    api.receiptBlob(p.file_url)
      .then((b) => {
        if (!alive) return;
        obj = URL.createObjectURL(b);
        setUrl(obj);
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [p?.id, p?.file_url]);
  return { url, error, loading };
}

function ReceiptView({ p }: { p: PaymentRow }) {
  const { url, error, loading } = useReceiptUrl(p);
  const [zoom, setZoom] = useState(false);
  const isPdf = /pdf/i.test(p.file_mime);
  if (loading) return <div className="receipt-box" style={{ cursor: 'default' }}><Loading text="Chek yuklanmoqda…" /></div>;
  if (error || !url) return <div className="receipt-box" style={{ cursor: 'default' }}>{error ?? 'Chek fayli yo\'q'}</div>;
  if (isPdf) {
    return (
      <div className="receipt-box" style={{ cursor: 'default', flexDirection: 'column', gap: 10 }}>
        <span className="strong">PDF chek</span>
        <div className="row">
          <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">Ochish</a>
          <a className="btn btn-sm" href={url} download={`chek-${p.id}.pdf`}>Yuklab olish</a>
        </div>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="receipt-box" onClick={() => setZoom(true)} aria-label="Chekni kattalashtirish">
        <img src={url} alt={`Chek #${p.id}`} />
      </button>
      <Modal open={zoom} onClose={() => setZoom(false)} title={`Chek #${p.id}`} size="xl">
        <img src={url} alt={`Chek #${p.id}`} className="receipt-full" />
        <div className="row-end"><a className="btn btn-sm" href={url} download={`chek-${p.id}`}>Yuklab olish</a></div>
      </Modal>
    </>
  );
}

const AFTER_TEXT: Record<PaymentRow['kind'], string> = {
  deposit: "Tasdiqlangach lid «boshlang'ich to'lagan» segmentiga o'tadi, sotuv xabarlari to'xtaydi, biriktirilgan menejerga Telegram xabari boradi. Kanal havolasi faqat to'liq to'lovda avtomatik yuboriladi.",
  full: "Tasdiqlangach lid «to'liq to'lagan» segmentiga o'tadi, sotuv xabarlari to'xtaydi va yopiq kurs kanaliga bir martalik havola yuboriladi.",
  remaining: "Qolgan to'lov tasdiqlangach lid «to'liq to'lagan» bo'ladi va yopiq kurs kanaliga havola yuboriladi.",
};

function Detail({ p, onChanged, onSelect, known }: { p: PaymentRow; onChanged: (p: PaymentRow) => void; onSelect: (id: number) => void; known: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setReason(REJECT_REASONS[0]); setOther(''); }, [p.id]);
  const isOther = reason === REJECT_REASONS[REJECT_REASONS.length - 1];
  const finalReason = isOther ? other.trim() || reason : reason;

  const act = async (k: string, fn: () => Promise<PaymentRow>, ok: string) => {
    setBusy(k);
    try {
      const r = await fn();
      onChanged(r);
      toast.success(ok);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const approve = async () => {
    if (p.duplicate_of || !p.within_deadline) {
      const ok = await confirm({
        title: 'Tasdiqlashni tekshiring',
        message: p.duplicate_of ? `Bu fayl avval #${p.duplicate_of} chekda yuborilgan. Haqiqatan ham yangi to'lovmi?` : "Chek deadline'dan keyin yuborilgan — maxsus narx saqlanmaydi. Summani tekshirdingizmi?",
        confirmText: 'Tasdiqlash',
      });
      if (!ok) return;
    }
    void act('approve', () => api.approvePayment(p.id), 'Chek tasdiqlandi');
  };
  const reject = () => void act('reject', () => api.rejectPayment(p.id, finalReason), 'Chek rad etildi — sabab lidga yuborildi');
  const refund = async () => {
    const ok = await confirm({ title: 'Qaytarildi deb belgilash', message: `#${p.id} to'lov qaytarilgan deb belgilanadi (${money(p.amount)}).`, confirmText: 'Belgilash', danger: true });
    if (ok) void act('refund', () => api.refundPayment(p.id), 'Qaytarish belgilandi');
  };

  return (
    <section className="card" style={{ gap: 16 }} aria-label={`Chek #${p.id}`}>
      <div className="row-between">
        <h2 className="card-title" style={{ fontSize: 18 }}>Chek #{p.id}</h2>
        <div className="small muted">keldi {fmtTime(p.submitted_at)} · {agoLabel(p.submitted_at)}</div>
      </div>
      {p.duplicate_of && (
        <div className="box box-danger" role="alert">
          <span><b>Takroriy fayl!</b> Shu chek fayli avval #{p.duplicate_of} da yuborilgan.</span>
          {known && <button type="button" className="btn btn-sm" onClick={() => onSelect(p.duplicate_of!)}>#{p.duplicate_of} ni ko'rish</button>}
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        <ReceiptView p={p} />
        <div className="grid-2" style={{ flex: '1 1 220px', alignContent: 'start' }}>
          <div className="kv"><span className="kv-k">Lid</span><Link to={`/leads/${p.lead_id}`} className="kv-v">{p.lead_name}</Link></div>
          <div className="kv"><span className="kv-k">Telefon</span>{p.lead_phone ? <a href={`tel:${p.lead_phone.replace(/[^\d+]/g, '')}`} className="kv-v">{p.lead_phone}</a> : <span className="kv-v">—</span>}</div>
          <div className="kv"><span className="kv-k">Tarif</span><span className="kv-v">{p.tariff}</span></div>
          <div className="kv"><span className="kv-k">Usul</span><span className="kv-v">{METHOD_LABEL[p.method]}</span></div>
          <div className="kv"><span className="kv-k">Turi</span><span className="kv-v">{PAYMENT_KIND_LABEL[p.kind]}</span></div>
          <div className="kv"><span className="kv-k">Kutilgan summa</span><span className="kv-v strong">{money(p.amount)}</span></div>
          <div style={{ gridColumn: '1 / -1' }} className={p.within_deadline ? 'box box-success' : 'box box-warn'}>
            {p.within_deadline ? 'Deadline ichida yuborilgan — maxsus narx saqlanadi' : "Deadline'dan keyin yuborilgan — maxsus narx amal qilmaydi"}
          </div>
        </div>
      </div>

      {p.status === 'pending' ? (
        <>
          <label className="field">
            <span>Rad etish sababi (rad etilsa)</span>
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {isOther && (
            <label className="field"><span>Sabab matni (lidga yuboriladi)</span><input className="input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Masalan: chekda sana ko'rinmayapti" /></label>
          )}
          <div className="row">
            <button type="button" className="btn btn-lg btn-success" style={{ flex: '1 1 160px' }} disabled={!!busy} onClick={() => void approve()}>{busy === 'approve' ? 'Kuting…' : 'Tasdiqlash'}</button>
            <button type="button" className="btn btn-lg btn-danger-ghost" style={{ flex: '1 1 160px' }} disabled={!!busy} onClick={reject}>{busy === 'reject' ? 'Kuting…' : 'Rad etish'}</button>
          </div>
          <div className="small muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{AFTER_TEXT[p.kind]}</div>
        </>
      ) : (
        <div className="stack-sm">
          <div className={p.status === 'approved' ? 'box box-success' : 'box box-danger'}>
            <span>
              {p.status === 'approved' ? 'Tasdiqlangan' : `Rad etilgan: ${p.reject_reason ?? '—'}`}
              {p.decided_by && ` · ${p.decided_by}`}{p.decided_at && `, ${fmtDateTime(p.decided_at)}`}
            </span>
          </div>
          {p.status === 'approved' && (p.refunded ? <Badge tone="danger">Qaytarilgan</Badge> : (
            <div className="row-end"><button type="button" className="btn btn-sm btn-danger-ghost" disabled={!!busy} onClick={() => void refund()}>Qaytarildi deb belgilash</button></div>
          ))}
        </div>
      )}
    </section>
  );
}

function QueueItem({ p, on, onClick }: { p: PaymentRow; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={on ? 'queue-item queue-item-on' : 'queue-item'} aria-pressed={on} onClick={onClick}>
      <span className="queue-main">
        <span className="queue-title">#{p.id} · {p.lead_name}</span>
        <span className="queue-meta">
          {p.tariff} · {METHOD_SHORT[p.method]} · {PAYMENT_KIND_LABEL[p.kind].toLowerCase()}
          {p.duplicate_of && <span className="text-danger strong"> · takroriy fayl!</span>}
          {p.status !== 'pending' && <> · <span className={p.status === 'approved' ? 'text-success' : 'text-danger'}>{p.status === 'approved' ? 'tasdiqlangan' : 'rad etilgan'}</span></>}
          {p.refunded && <span className="text-danger"> · qaytarilgan</span>}
        </span>
      </span>
      <span className="queue-side">
        <span className="queue-sum">{money(p.amount)}</span>
        <span className="small muted">{agoLabel(p.submitted_at).replace(' oldin', '')}</span>
      </span>
    </button>
  );
}

function PaymentsBody({ fid }: { fid: number }) {
  const [sp, setSp] = useSearchParams();
  const initialId = sp.get('id') ? Number(sp.get('id')) : null;
  const [tab, setTab] = useState<PaymentsStatusFilter>(initialId ? 'all' : 'pending');
  const [pending, setPending] = useState<PaymentRow[] | null>(null);
  const [pendingErr, setPendingErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<number | null>(initialId);
  const detailRef = useRef<HTMLDivElement>(null);
  const other = useLoad(tab !== 'pending' ? () => api.payments(fid, tab) : null, [fid, tab]);

  const loadPending = useCallback(async () => {
    try {
      const l = await api.payments(fid, 'pending');
      setPending(l);
      setPendingErr(null);
    } catch (e) {
      setPendingErr(errorText(e));
    }
  }, [fid]);

  useEffect(() => {
    void loadPending();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void loadPending();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [loadPending]);

  const list = tab === 'pending' ? pending : other.data ?? null;
  const sorted = list ? [...list].sort((a, b) => (tab === 'pending' ? Date.parse(a.submitted_at) - Date.parse(b.submitted_at) : Date.parse(b.submitted_at) - Date.parse(a.submitted_at))) : null;
  const selected = sorted?.find((p) => p.id === selId) ?? null;

  useEffect(() => {
    if (!sorted) return;
    if (selId === null || !sorted.some((p) => p.id === selId)) setSelId(sorted[0]?.id ?? null);
  }, [sorted, selId]);

  useEffect(() => {
    if (initialId) {
      sp.delete('id');
      setSp(sp, { replace: true });
    }
    // faqat birinchi ochilishda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (id: number) => {
    setSelId(id);
    if (window.matchMedia('(max-width: 899px)').matches) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const onChanged = (p: PaymentRow) => {
    if (tab === 'pending') {
      const idx = sorted?.findIndex((x) => x.id === p.id) ?? -1;
      const rest = (pending ?? []).filter((x) => x.id !== p.id);
      setPending(rest);
      const next = sorted?.filter((x) => x.id !== p.id)[Math.max(0, idx)] ?? null;
      setSelId(next?.id ?? null);
    } else {
      other.setData((l) => (l ?? []).map((x) => (x.id === p.id ? p : x)));
      void loadPending();
    }
  };

  const tabs: { value: PaymentsStatusFilter; label: string }[] = [
    { value: 'pending', label: `Tasdiq kutilmoqda${pending ? ` · ${pending.length}` : ''}` },
    { value: 'approved', label: 'Tasdiqlangan' },
    { value: 'rejected', label: 'Rad etilgan' },
    { value: 'all', label: "Barcha to'lovlar" },
  ];
  const err = tab === 'pending' ? (pending === null ? pendingErr : null) : other.error;

  return (
    <>
      <PageHead title="To'lovlar" sub={tab === 'pending' ? `Navbat har ${POLL_MS / 1000} soniyada yangilanadi. Cheklarni Telegram guruhida ham tasdiqlash mumkin.` : undefined} />
      <Segmented label="To'lov holati" value={tab} options={tabs} onChange={(t) => { setTab(t); setSelId(null); }} />
      {err ? <ErrorBox error={err} onRetry={() => (tab === 'pending' ? void loadPending() : void other.reload())} /> : !sorted ? <Loading /> : sorted.length === 0 ? (
        <Empty title={tab === 'pending' ? 'Tasdiq kutayotgan chek yo\'q' : "To'lov yo'q"}>{tab === 'pending' ? 'Yangi chek kelganda shu yerda paydo bo\'ladi.' : undefined}</Empty>
      ) : (
        <div className="cols">
          <section className="queue" style={{ flex: '2 1 360px' }} aria-label="Cheklar ro'yxati">
            {sorted.map((p) => <QueueItem key={p.id} p={p} on={p.id === selId} onClick={() => select(p.id)} />)}
          </section>
          <div ref={detailRef} style={{ flex: '3 1 440px', minWidth: 0, scrollMarginTop: 72 }}>
            {selected ? <Detail p={selected} onChanged={onChanged} onSelect={select} known={!!sorted.some((x) => x.id === selected.duplicate_of)} /> : <Empty title="Chekni tanlang" />}
          </div>
        </div>
      )}
    </>
  );
}

export default function Payments() {
  return <NeedFunnel>{(f) => <PaymentsBody key={f.id} fid={f.id} />}</NeedFunnel>;
}
