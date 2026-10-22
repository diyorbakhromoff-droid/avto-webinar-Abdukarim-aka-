import { useEffect, useState, type FormEvent } from 'react';
import { api, type StatsFilter } from '../api/admin';
import type { AdSpendRow, LiveResults, PaymentMethod, StatsResponse } from '../api/types';
import { NeedFunnel } from '../components/NeedFunnel';
import { RetentionChart, retentionTakeaway } from '../components/RetentionChart';
import { MoneyInput, NumberInput } from '../components/fields';
import { Card, Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { money, num, pct } from '../lib/format';
import { METHOD_LABEL, options } from '../lib/labels';
import { useManagers } from '../lib/managers';
import { fmtDayKey, pad2, todayKey, tzParts, WEEKDAYS } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

function monthStart(): string {
  const p = tzParts(Date.now());
  return `${p.y}-${pad2(p.m + 1)}-01`;
}

/** live_compare qiymatlari uchun format: shartnomada birlik ko'rsatilmagan — label bo'yicha taxmin. */
function fmtCompare(label: string, v: number | null): string {
  if (v === null) return '—';
  if (/narx|so'm|xarajat/i.test(label)) return money(v);
  if (v <= 1) return pct(v);
  return num(v);
}

function Filters({ f, setF, slots }: { f: StatsFilter; setF: (f: StatsFilter) => void; slots: string[] }) {
  const managers = useManagers();
  return (
    <div className="inline-form">
      <label className="field field-compact" style={{ flex: '1 1 140px' }}>
        <span>Sanadan</span>
        <input className="input" type="date" value={f.date_from ?? ''} max={f.date_to || undefined} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
      </label>
      <label className="field field-compact" style={{ flex: '1 1 140px' }}>
        <span>Sanagacha</span>
        <input className="input" type="date" value={f.date_to ?? ''} min={f.date_from || undefined} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
      </label>
      <label className="field field-compact" style={{ flex: '1 1 140px' }}>
        <span>Manba</span>
        <input className="input" value={f.source ?? ''} onChange={(e) => setF({ ...f, source: e.target.value.trim() })} placeholder="Barchasi" />
      </label>
      <label className="field field-compact" style={{ flex: '1 1 120px' }}>
        <span>Slot</span>
        <select className="select" value={f.slot ?? ''} onChange={(e) => setF({ ...f, slot: e.target.value })}>
          <option value="">Barchasi</option>
          {slots.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="field field-compact" style={{ flex: '1 1 130px' }}>
        <span>Hafta kuni</span>
        <select className="select" value={f.weekday ?? ''} onChange={(e) => setF({ ...f, weekday: e.target.value === '' ? '' : Number(e.target.value) })}>
          <option value="">Barchasi</option>
          {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
        </select>
      </label>
      <label className="field field-compact" style={{ flex: '1 1 130px' }}>
        <span>To'lov usuli</span>
        <select className="select" value={f.method ?? ''} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod | '' })}>
          <option value="">Barchasi</option>
          {options(METHOD_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="field field-compact" style={{ flex: '1 1 130px' }}>
        <span>Menejer</span>
        <select className="select" value={f.manager_id ?? ''} onChange={(e) => setF({ ...f, manager_id: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">Barchasi</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
    </div>
  );
}

function LiveCompare({ fid, s, onSaved }: { fid: number; s: StatsResponse; onSaved: () => void }) {
  const toast = useToast();
  const live = useLoad(() => api.liveResults(fid), [fid]);
  const [v, setV] = useState<LiveResults>({ day1_watch_rate: null, paid_rate: null, cost_per_sale: null });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  useEffect(() => { if (live.data) setV(live.data); }, [live.data]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.saveLiveResults(fid, v);
      live.setData(r);
      setEdit(false);
      toast.success('Jonli webinar natijalari saqlandi');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const pctVal = (x: number | null) => (x === null ? 0 : Math.round(x * 1000) / 10);
  return (
    <Card title="Avtowebinar va jonli webinar" actions={!edit && <button type="button" className="btn btn-sm" onClick={() => setEdit(true)}>Jonli natijalarni kiritish</button>}>
      {s.live_compare.length === 0 ? <div className="muted">Solishtirish uchun ma'lumot yo'q.</div> : (
        <div className="table-wrap flat">
          <table className="table table-compact">
            <thead><tr><th></th><th className="num">Avto</th><th className="num">Jonli (qo'lda)</th></tr></thead>
            <tbody>
              {s.live_compare.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num strong">{fmtCompare(r.label, r.auto)}</td>
                  <td className="num">{r.live === null ? <span className="muted">kiritilmagan</span> : fmtCompare(r.label, r.live)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <div className="stack-sm">
          {live.error && <ErrorBox error={live.error} onRetry={live.reload} />}
          <div className="grid-2">
            <label className="field field-compact"><span>1-kunni ko'rish (jonli)</span><NumberInput value={pctVal(v.day1_watch_rate)} min={0} max={100} step={0.1} suffix="%" onChange={(n) => setV({ ...v, day1_watch_rate: n / 100 })} /></label>
            <label className="field field-compact"><span>To'liq to'lov / ko'rganlar (jonli)</span><NumberInput value={pctVal(v.paid_rate)} min={0} max={100} step={0.1} suffix="%" onChange={(n) => setV({ ...v, paid_rate: n / 100 })} /></label>
            <label className="field field-compact" style={{ gridColumn: '1 / -1' }}><span>Bitta sotuv narxi (jonli)</span><MoneyInput value={v.cost_per_sale} onChange={(n) => setV({ ...v, cost_per_sale: n })} /></label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => { setEdit(false); if (live.data) setV(live.data); }}>Bekor qilish</button>
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void save()}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function AdSpend({ fid, onSaved }: { fid: number; onSaved: () => void }) {
  const toast = useToast();
  const st = useLoad(() => api.adSpend(fid), [fid]);
  const [row, setRow] = useState<{ source: string; date: string; amount: number | null }>({ source: '', date: todayKey(), amount: null });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!row.source.trim() || !row.date || !row.amount) {
      toast.error('Manba, sana va summani kiriting');
      return;
    }
    setBusy(true);
    try {
      const saved: AdSpendRow = await api.addAdSpend(fid, { source: row.source.trim(), date: row.date, amount: row.amount });
      st.setData((l) => [saved ?? { source: row.source.trim(), date: row.date, amount: row.amount! }, ...(l ?? [])]);
      setRow({ ...row, amount: null });
      toast.success('Reklama xarajati qo\'shildi');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const list = [...(st.data ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const total = list.reduce((a, r) => a + r.amount, 0);
  return (
    <Card title="Reklama xarajati" actions={list.length > 0 && <span className="muted small">Jami: <b>{money(total)}</b></span>}>
      <form className="inline-form" onSubmit={submit}>
        <label className="field field-compact"><span>Manba</span><input className="input mono" value={row.source} onChange={(e) => setRow({ ...row, source: e.target.value })} placeholder="ig_reels3" /></label>
        <label className="field field-compact"><span>Sana</span><input className="input" type="date" value={row.date} onChange={(e) => setRow({ ...row, date: e.target.value })} /></label>
        <label className="field field-compact"><span>Summa</span><MoneyInput value={row.amount} onChange={(n) => setRow({ ...row, amount: n })} /></label>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Kuting…' : "Qo'shish"}</button>
      </form>
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : list.length === 0 ? (
        <div className="muted">Hali xarajat kiritilmagan — bitta lid va bitta sotuv narxi hisoblanmaydi.</div>
      ) : (
        <div className="table-wrap flat" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="table table-compact">
            <thead><tr><th>Sana</th><th>Manba</th><th className="num">Summa</th></tr></thead>
            <tbody>{list.map((r, i) => <tr key={r.id ?? i}><td className="nowrap">{fmtDayKey(r.date)}</td><td className="mono">{r.source}</td><td className="num">{money(r.amount)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function StatsBody({ fid }: { fid: number }) {
  const toast = useToast();
  const [f, setF] = useState<StatsFilter>(() => ({ date_from: monthStart(), date_to: todayKey(), source: '', slot: '', weekday: '', method: '', manager_id: '' }));
  const [debounced, setDebounced] = useState(f);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(f), 350);
    return () => clearTimeout(t);
  }, [f]);
  const settings = useLoad(() => api.settings(fid), [fid]);
  const st = useLoad(() => api.stats(fid, debounced), [fid, JSON.stringify(debounced)]);
  const [exporting, setExporting] = useState(false);
  const exp = async () => {
    setExporting(true);
    try {
      await api.exportStats(fid, debounced);
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };
  const reload = () => void st.reload();

  return (
    <>
      <PageHead title="Statistika" actions={<button type="button" className="btn" onClick={() => void exp()} disabled={exporting}>{exporting ? 'Tayyorlanmoqda…' : 'Excel eksport'}</button>} />
      <Filters f={f} setF={setF} slots={settings.data?.slot_times ?? []} />
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : (() => {
        const s = st.data;
        return (
          <div className="stack" style={{ gap: 20, opacity: st.loading ? 0.6 : 1 }}>
            <div className="cols">
              <section className="table-wrap col-3" aria-label="Ko'rsatkichlar">
                <table className="table" style={{ minWidth: 420 }}>
                  <thead><tr><th>Ko'rsatkich</th><th className="num">Soni</th><th className="num">O'tish</th></tr></thead>
                  <tbody>
                    {s.metrics.map((m) => (
                      <tr key={m.key}>
                        <td className="cell-strong" style={{ fontWeight: 600 }}>{m.label}</td>
                        <td className="num strong">{m.display ?? num(m.value)}</td>
                        <td className="num muted">{m.rate === null ? '' : pct(m.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <div className="col-2 stack" style={{ gap: 20 }}>
                {s.retention.length === 0 && <Card title="Tomosha grafigi"><div className="muted">Bu davrda ko'rish ma'lumoti yo'q.</div></Card>}
                {[...s.retention].sort((a, b) => b.day - a.day).map((r) => (
                  <Card key={r.day} title={`Tomosha grafigi · ${r.day}-kun`} actions={<span className="small muted">% qolgan tomoshabin</span>}>
                    <div className="takeaway">{retentionTakeaway(r)}</div>
                    <RetentionChart r={r} />
                  </Card>
                ))}
                <LiveCompare fid={fid} s={s} onSaved={reload} />
              </div>
            </div>

            <Card title="Progrev xabarlari">
              {s.messages.length === 0 ? <Empty title="Xabar statistikasi yo'q" /> : (
                <div className="table-wrap flat">
                  <table className="table">
                    <thead><tr><th>Xabar</th><th className="num">Yuborildi</th><th className="num">Tugma bosildi</th><th className="num">Bosish %</th><th className="num">Keyin bloklagan</th></tr></thead>
                    <tbody>
                      {s.messages.map((m) => (
                        <tr key={m.id}>
                          <td className="cell-strong">{m.title}</td>
                          <td className="num">{num(m.sent)}</td>
                          <td className="num">{num(m.clicks)}</td>
                          <td className="num muted">{m.sent ? pct(m.clicks / m.sent) : '—'}</td>
                          <td className={m.sent && m.blocked_after / m.sent > 0.02 ? 'num text-danger strong' : 'num'}>{num(m.blocked_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="cols">
              <Card className="col-3" title="To'xtab qolgan lidlar">
                {s.steps.length === 0 ? <Empty title="Ma'lumot yo'q" /> : (
                  <div className="table-wrap flat">
                    <table className="table">
                      <thead><tr><th>Qadam</th><th className="num">To'xtadi</th><th className="num">Eslatmadan qaytdi</th><th className="num">Qo'ng'iroqdan qaytdi</th><th className="num">Qaytish %</th></tr></thead>
                      <tbody>
                        {s.steps.map((r) => (
                          <tr key={r.step}>
                            <td className="cell-strong">{r.label}</td>
                            <td className="num">{num(r.stuck)}</td>
                            <td className="num">{num(r.returned_by_bot)}</td>
                            <td className="num">{num(r.returned_by_call)}</td>
                            <td className="num muted">{r.stuck ? pct((r.returned_by_bot + r.returned_by_call) / r.stuck) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <div className="col-2"><AdSpend fid={fid} onSaved={reload} /></div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

export default function Stats() {
  return <NeedFunnel>{(f) => <StatsBody key={f.id} fid={f.id} />}</NeedFunnel>;
}
