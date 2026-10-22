import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/admin';
import type {
  ChainHistoryEntry, ChainKind, ChainMessage, ChainMessageInput, MediaInfo, Segment, SimulationRow, StuckStep, TriggerType,
} from '../api/types';
import { ButtonsEditor, cleanButtons, validateButtons } from '../components/ButtonsEditor';
import { MediaPicker } from '../components/MediaPicker';
import { Modal } from '../components/Modal';
import { NeedFunnel } from '../components/NeedFunnel';
import { TelegramPreview } from '../components/TelegramPreview';
import { TextEditor } from '../components/TextEditor';
import { NumberInput } from '../components/fields';
import { Badge, Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import {
  OFFSET_LABEL, PHASES, defaultsForPhase, metaLabel, needsDay, normalize, phaseOf, sortChain, textLimit, toInput, whenLabel,
  type PhaseKey,
} from '../lib/chain';
import { useConfirm } from '../lib/confirm';
import { num, splitOffset, UNIT_LABEL, UNIT_MIN, type OffsetUnit } from '../lib/format';
import { honestyHits } from '../lib/honesty';
import { KIND_LABEL, SEGMENT_LABEL, STUCK_LABEL, TRIGGER_LABEL, options } from '../lib/labels';
import { slotOptions } from '../lib/slots';
import { visibleLength } from '../lib/telegramHtml';
import { dayLabel, fmtDateTime, fmtTime, fromLocalInput, toLocalInput } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

type Selected = { id: number } | { id: 'new' } | null;

function OffsetInput({ minutes, onChange, label }: { minutes: number; onChange: (m: number) => void; label: string }) {
  const init = splitOffset(minutes);
  const [unit, setUnit] = useState<OffsetUnit>(init.unit);
  useEffect(() => {
    // Tashqaridan o'zgarsa (boshqa xabar tanlansa) birlikni qayta hisoblaymiz
    if (minutes % UNIT_MIN[unit] !== 0) setUnit(splitOffset(minutes).unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);
  const value = minutes / UNIT_MIN[unit];
  return (
    <div className="field">
      <span>{label}</span>
      <div className="offset-input">
        <NumberInput value={Number.isInteger(value) ? value : Number(value.toFixed(2))} min={0} onChange={(n) => onChange(Math.max(0, Math.round(n * UNIT_MIN[unit])))} ariaLabel={`${label} — qiymat`} />
        <select className="select" value={unit} aria-label={`${label} — birlik`} onChange={(e) => setUnit(e.target.value as OffsetUnit)}>
          {(Object.keys(UNIT_LABEL) as OffsetUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </select>
      </div>
    </div>
  );
}

function validate(m: ChainMessageInput): string[] {
  const errs: string[] = [];
  if (!m.title.trim()) errs.push('Ichki nomini kiriting.');
  if (m.kind === 'text' && !m.text.trim()) errs.push("Matn bo'sh bo'lmasin.");
  if (m.kind !== 'video_note' && visibleLength(m.text) > textLimit(m.kind)) errs.push(`Matn ${textLimit(m.kind)} belgidan oshmasin.`);
  if (m.kind !== 'text' && m.status === 'active' && m.media_ids.length === 0) errs.push('Faol xabar uchun media yuklang.');
  if (m.kind === 'album' && m.media_ids.length > 0 && (m.media_ids.length < 2 || m.media_ids.length > 10)) errs.push('Albomda 2–10 ta media bo\'lishi kerak.');
  if (m.kind === 'album' && m.buttons.length > 0) errs.push("Albomga tugma qo'shib bo'lmaydi (Telegram cheklovi).");
  if (m.trigger_type === 'on_button' && !(m.button_key ?? '').trim()) errs.push('Tugma kalitini kiriting.');
  if (m.offset_minutes < 0) errs.push("Vaqt manfiy bo'lmasin.");
  const b = validateButtons(m.buttons);
  if (b) errs.push(b);
  return errs;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Nomi', kind: 'Turi', text: 'Matn', media_ids: 'Media', buttons: 'Tugmalar', trigger_type: 'Trigger', trigger_day: 'Kun',
  offset_minutes: 'Vaqt (daq)', stuck_step: 'Qadam', button_key: 'Tugma kaliti', segment: 'Segment', required: 'Majburiy', status: 'Holat', sort: 'Tartib',
};

function HistoryDrawer({ open, messageId, onClose }: { open: boolean; messageId: number | null; onClose: () => void }) {
  const st = useLoad<ChainHistoryEntry[]>(open && messageId ? () => api.chainHistory(messageId) : null, [open, messageId]);
  return (
    <Modal open={open} title="O'zgarishlar tarixi" onClose={onClose} drawer>
      {st.error ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : st.data.length === 0 ? (
        <Empty title="Tarix bo'sh" />
      ) : (
        [...st.data].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((h, i) => (
          <div key={i} className="history-item">
            <div className="row-between"><b>{h.user}</b><span className="muted small">{fmtDateTime(h.at)}</span></div>
            {Object.entries(h.changes).map(([k, [a, b]]) => (
              <div key={k} className="history-change">
                <span className="muted">{FIELD_LABEL[k] ?? k}</span>
                <span><span className="history-old">{fmtVal(a)}</span> → <span className="history-new">{fmtVal(b)}</span></span>
              </div>
            ))}
          </div>
        ))
      )}
    </Modal>
  );
}

const SIM_TONE: Record<SimulationRow['status'], 'neutral' | 'success' | 'warn' | 'danger' | 'info'> = {
  scheduled: 'success', compressed: 'warn', skipped: 'danger', quiet_shifted: 'info', event: 'neutral',
};
const SIM_LABEL: Record<SimulationRow['status'], string> = {
  scheduled: 'rejada', compressed: 'siqildi', skipped: "o'tkazib yuboriladi", quiet_shifted: 'surildi', event: 'voqeaga bog\'liq',
};

function SimulateModal({ open, fid, onClose, onResult }: { open: boolean; fid: number; onClose: () => void; onResult: (r: { registered_at: string; day1_at: string; rows: SimulationRow[] }) => void }) {
  const toast = useToast();
  const settings = useLoad(open ? () => api.settings(fid) : null, [open, fid]);
  const [reg, setReg] = useState('');
  const [day1, setDay1] = useState('');
  const [rows, setRows] = useState<SimulationRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const now = Math.ceil(Date.now() / 600000) * 600000;
    setReg(toLocalInput(now));
    setRows(null);
  }, [open]);
  useEffect(() => {
    const regIso = fromLocalInput(reg);
    if (!regIso) return;
    const s = settings.data;
    const opt = s ? slotOptions(Date.parse(regIso), s)[0] : undefined;
    setDay1(toLocalInput(opt ?? Date.parse(regIso) + 6 * 3600_000));
  }, [reg, settings.data]);

  const run = async () => {
    const r = fromLocalInput(reg), d = fromLocalInput(day1);
    if (!r || !d) return;
    if (Date.parse(d) <= Date.parse(r)) {
      toast.error("1-kun ro'yxatdan keyin bo'lishi kerak");
      return;
    }
    setBusy(true);
    try {
      const res = await api.simulate(fid, { registered_at: r, day1_at: d });
      setRows(res);
      onResult({ registered_at: r, day1_at: d, rows: res });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Lid sifatida sinash" size="xl">
      <div className="muted">Ro'yxat vaqti va 1-kun sessiyasini tanlang — qaysi xabar qachon borishi va siqish qoidasi qanday ishlashi ko'rinadi. 2-kun = 1-kun + 24 soat.</div>
      <div className="inline-form">
        <label className="field"><span>Ro'yxatdan o'tgan vaqt</span><input className="input" type="datetime-local" value={reg} onChange={(e) => setReg(e.target.value)} /></label>
        <label className="field"><span>1-kun efiri</span><input className="input" type="datetime-local" value={day1} onChange={(e) => setDay1(e.target.value)} /></label>
        <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy || !reg || !day1}>{busy ? 'Hisoblanmoqda…' : 'Sinash'}</button>
      </div>
      {rows && (rows.length === 0 ? <Empty title="Zanjirda faol xabar yo'q" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Yuborish vaqti</th><th>Xabar</th><th>Trigger</th><th>Holat</th><th>Sabab</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.message_id}-${i}`} className={r.status === 'skipped' ? 'sim-skipped' : r.status === 'compressed' ? 'sim-compressed' : undefined}>
                  <td className="tnum nowrap">{r.send_at ? `${dayLabel(r.send_at, Date.parse(fromLocalInput(reg) ?? ''))} ${fmtTime(r.send_at)}` : '—'}</td>
                  <td className="cell-strong">{r.title}</td>
                  <td className="muted">{r.trigger}</td>
                  <td><Badge tone={SIM_TONE[r.status]}>{SIM_LABEL[r.status]}</Badge></td>
                  <td>{r.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Modal>
  );
}

function SimSummary({ sim }: { sim: { registered_at: string; day1_at: string; rows: SimulationRow[] } }) {
  return (
    <div className="sim-summary">
      <div className="sim-summary-title">Sinov: ro'yxat {fmtTime(sim.registered_at)}, sessiya {dayLabel(sim.day1_at, sim.registered_at).toLowerCase()} {fmtTime(sim.day1_at)}</div>
      {sim.rows.slice(0, 10).map((r, i) => (
        r.status === 'skipped' ? (
          <div key={i} style={{ color: 'var(--danger-ink)' }}>«{r.title}» — o'tkazib yuboriladi{r.reason ? `: ${r.reason}` : ''}</div>
        ) : (
          <div key={i}>{r.send_at ? fmtTime(r.send_at) : '—'} — «{r.title}»{r.status === 'compressed' ? ' (siqildi)' : ''}{r.status === 'quiet_shifted' ? ' (surildi)' : ''}</div>
        )
      ))}
      {sim.rows.length > 10 && <div className="muted">… yana {sim.rows.length - 10} ta</div>}
    </div>
  );
}

function ChainBody({ fid }: { fid: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const chain = useLoad(() => api.chain(fid), [fid]);
  const [sel, setSel] = useState<Selected>(null);
  const [form, setForm] = useState<ChainMessageInput | null>(null);
  const [base, setBase] = useState<string>('');
  const [media, setMedia] = useState<Record<number, MediaInfo>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showSim, setShowSim] = useState(false);
  const [sim, setSim] = useState<{ registered_at: string; day1_at: string; rows: SimulationRow[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const editorRef = useRef<HTMLElement>(null);

  const list = chain.data ?? [];
  const current = sel && sel.id !== 'new' ? list.find((m) => m.id === sel.id) ?? null : null;
  const dirty = !!form && JSON.stringify(form) !== base;

  const byPhase = useMemo(() => {
    const map: Record<PhaseKey, ChainMessage[]> = { reg: [], day1: [], between: [], day2: [], after: [], other: [] };
    for (const m of sortChain(list)) map[phaseOf(m)].push(m);
    return map;
  }, [list]);

  // Birinchi yuklanishda birinchi xabarni tanlaymiz
  useEffect(() => {
    if (sel || !chain.data?.length) return;
    const first = sortChain(chain.data)[0];
    setSel({ id: first.id });
    const f = toInput(first);
    setForm(f);
    setBase(JSON.stringify(f));
  }, [chain.data, sel]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const guard = async () => !dirty || confirm({ title: "Saqlanmagan o'zgarishlar", message: "Joriy xabardagi o'zgarishlar saqlanmagan. Ularni tashlab ketasizmi?", confirmText: 'Tashlab ketish', danger: true });

  const scrollToEditor = () => {
    if (window.matchMedia('(max-width: 899px)').matches) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const select = async (m: ChainMessage) => {
    if (sel && sel.id === m.id) return;
    if (!(await guard())) return;
    const f = toInput(m);
    setSel({ id: m.id });
    setForm(f);
    setBase(JSON.stringify(f));
    scrollToEditor();
  };

  const createNew = async (phase: PhaseKey) => {
    if (!(await guard())) return;
    const maxSort = list.reduce((a, m) => Math.max(a, m.sort), 0);
    const f = defaultsForPhase(phase, maxSort + 1);
    setSel({ id: 'new' });
    setForm(f);
    setBase('');
    scrollToEditor();
  };

  const patch = (p: Partial<ChainMessageInput>) => setForm((f) => (f ? { ...f, ...p } : f));

  const replaceInList = (m: ChainMessage) => chain.setData((l) => {
    const arr = l ?? [];
    return arr.some((x) => x.id === m.id) ? arr.map((x) => (x.id === m.id ? m : x)) : [...arr, m];
  });

  const save = async (override?: Partial<ChainMessageInput>) => {
    if (!form) return;
    const body = normalize({ ...form, ...override, buttons: cleanButtons(form.buttons) });
    const errs = validate(body);
    if (errs.length) {
      toast.error(errs[0]);
      return;
    }
    if (body.status === 'active' && honestyHits(body.text).length > 0) {
      const ok = await confirm({ title: 'Halollik ogohlantirishi', message: `Matnda ${honestyHits(body.text).map((h) => `«${h}»`).join(', ')} bor. Yozuvni jonli deb ko'rsatish ishonchni yo'qotadi. Baribir faol qilasizmi?`, confirmText: 'Baribir saqlash', danger: true });
      if (!ok) return;
    }
    setBusy('save');
    try {
      const saved = sel && sel.id !== 'new' ? await api.updateChain(sel.id, body) : await api.createChain(fid, body);
      replaceInList(saved);
      const f = toInput(saved);
      setSel({ id: saved.id });
      setForm(f);
      setBase(JSON.stringify(f));
      toast.success(saved.warnings?.length ? 'Saqlandi — ogohlantirishlarni ko\'ring' : 'Saqlandi');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const toggleStatus = () => {
    if (!form) return;
    const next = form.status === 'active' ? 'draft' : 'active';
    void save({ status: next });
  };

  const test = async () => {
    if (!current) return;
    if (dirty) {
      toast.info('Avval saqlang — test oxirgi saqlangan variantni yuboradi');
      return;
    }
    setBusy('test');
    try {
      await api.testChain(current.id);
      toast.success("Test xabar Telegramingizga yuborildi");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async () => {
    if (!current || !(await guard())) return;
    setBusy('dup');
    try {
      const copy = await api.duplicateChain(current.id);
      replaceInList(copy);
      const f = toInput(copy);
      setSel({ id: copy.id });
      setForm(f);
      setBase(JSON.stringify(f));
      toast.success('Nusxa yaratildi (qoralama)');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!sel) return;
    if (sel.id === 'new') {
      setSel(null);
      setForm(null);
      return;
    }
    const id = sel.id;
    const ok = await confirm({ title: "Xabarni o'chirish", message: `«${current?.title}» o'chiriladi. Hali yuborilmagan rejalar bekor qilinadi.`, confirmText: "O'chirish", danger: true });
    if (!ok) return;
    setBusy('del');
    try {
      await api.deleteChain(id);
      chain.setData((l) => (l ?? []).filter((m) => m.id !== id));
      setSel(null);
      setForm(null);
      toast.success("O'chirildi");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  if (chain.error && !chain.data) return <ErrorBox error={chain.error} onRetry={chain.reload} />;

  const active = list.filter((m) => m.status === 'active').length;
  const last = list.reduce<ChainMessage | null>((a, m) => (!a || Date.parse(m.updated_at) > Date.parse(a.updated_at) ? m : a), null);
  const sub = chain.data
    ? `${list.length} xabar · ${active} faol, ${list.length - active} qoralama${last ? ` · oxirgi o'zgarish: ${last.updated_by ?? '—'}, ${dayLabel(last.updated_at).toLowerCase()} ${fmtTime(last.updated_at)}` : ''}`
    : 'Yuklanmoqda…';

  const kind = form?.kind ?? 'text';
  const limit = textLimit(kind);
  const errs = form ? validate(normalize(form)) : [];

  return (
    <>
      <PageHead
        title="Progrev zanjiri"
        sub={sub}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setShowSim(true)}>Lid sifatida sinash</button>
            <button type="button" className="btn btn-primary" onClick={() => void createNew('reg')}>+ Xabar qo'shish</button>
          </>
        }
      />

      {!chain.data ? <Loading /> : (
        <div className="timeline-wrap">
          <div className="timeline">
            {PHASES.map((ph) => (
              <div key={ph.key} className="phase">
                <div className="phase-head">
                  <div className="phase-title">{ph.title}</div>
                  <div className="phase-count">{byPhase[ph.key].length}</div>
                </div>
                {byPhase[ph.key].map((m) => {
                  const selected = sel?.id === m.id;
                  const cls = selected ? 'msg-card msg-selected' : m.status === 'draft' ? 'msg-card msg-draft' : 'msg-card';
                  const flagged = honestyHits(m.text).length > 0 || (m.warnings?.length ?? 0) > 0;
                  return (
                    <button key={m.id} type="button" className={cls} aria-pressed={selected} onClick={() => void select(m)}>
                      <span className="msg-when">{whenLabel(m)}</span>
                      <span className="msg-title">{m.title}{flagged && <span className="msg-flag" title="Ogohlantirish bor"> !</span>}</span>
                      <span className="msg-meta">{metaLabel(m)}</span>
                    </button>
                  );
                })}
                {sel?.id === 'new' && form && phaseOf(form) === ph.key && (
                  <div className="msg-card msg-selected" aria-current="true">
                    <span className="msg-when">{whenLabel(form)}</span>
                    <span className="msg-title">{form.title || 'Yangi xabar'}</span>
                    <span className="msg-meta">saqlanmagan</span>
                  </div>
                )}
                <button type="button" className="phase-add" onClick={() => void createNew(ph.key)} aria-label={`${ph.title} bosqichiga xabar qo'shish`}>+ qo'shish</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {chain.data && !form && (
        <Empty title={list.length ? 'Tahrirlash uchun xabarni tanlang' : "Zanjir bo'sh"}>
          {list.length ? "Yuqoridagi vaqt chizig'idan xabar kartasini bosing." : "«+ Xabar qo'shish» tugmasi bilan birinchi xabarni yarating."}
        </Empty>
      )}

      {form && (
        <div className="cols">
          <section ref={editorRef} className="card col-3" aria-label="Xabar muharriri" style={{ gap: 16, scrollMarginTop: 72 }}>
            <div className="row-between">
              <h2 className="card-title" style={{ fontSize: 18 }}>Xabar: «{form.title || 'Yangi xabar'}»</h2>
              <span className={form.status === 'active' ? 'status-pill status-active' : 'status-pill status-draft'}>{form.status === 'active' ? 'Faol' : 'Qoralama'}</span>
            </div>

            <label className="field">
              <span>Ichki nomi</span>
              <input className="input" value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Efirgacha 2 soat" />
            </label>

            <div className="grid-form">
              <label className="field">
                <span>Turi</span>
                <select className="select" value={form.kind} onChange={(e) => {
                  const k = e.target.value as ChainKind;
                  patch({ kind: k, media_ids: k === 'album' || form.kind === 'album' ? [] : form.media_ids });
                }}>
                  {options(KIND_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Trigger</span>
                <select className="select" value={form.trigger_type} onChange={(e) => {
                  const t = e.target.value as TriggerType;
                  patch({
                    trigger_type: t,
                    trigger_day: needsDay(t) ? form.trigger_day ?? 1 : null,
                    stuck_step: t === 'stuck' ? form.stuck_step ?? 'no_session' : null,
                    button_key: t === 'on_button' ? form.button_key ?? '' : null,
                  });
                }}>
                  {options(TRIGGER_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {needsDay(form.trigger_type) && (
                <label className="field">
                  <span>Kun</span>
                  <select className="select" value={form.trigger_day ?? 1} onChange={(e) => patch({ trigger_day: Number(e.target.value) as 1 | 2 })}>
                    <option value={1}>1-kun</option>
                    <option value={2}>2-kun</option>
                  </select>
                </label>
              )}
              <OffsetInput minutes={form.offset_minutes} onChange={(m) => patch({ offset_minutes: m })} label={OFFSET_LABEL[form.trigger_type]} />
              {form.trigger_type === 'stuck' && (
                <label className="field">
                  <span>Qaysi qadamda</span>
                  <select className="select" value={form.stuck_step ?? 'no_session'} onChange={(e) => patch({ stuck_step: e.target.value as StuckStep })}>
                    {options(STUCK_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
              {form.trigger_type === 'on_button' && (
                <label className="field">
                  <span>Tugma kaliti</span>
                  <input className="input mono" value={form.button_key ?? ''} onChange={(e) => patch({ button_key: e.target.value.replace(/[^\w-]/g, '') })} placeholder="homework" />
                </label>
              )}
              <label className="field">
                <span>Segment</span>
                <select className="select" value={form.segment} onChange={(e) => patch({ segment: e.target.value as Segment })}>
                  {options(SEGMENT_LABEL).filter((o) => o.value !== 'cold').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Tartib raqami</span>
                <NumberInput value={form.sort} min={0} onChange={(n) => patch({ sort: Math.round(n) })} />
              </label>
            </div>

            <label className="check">
              <input type="checkbox" checked={form.required} onChange={(e) => patch({ required: e.target.checked })} />
              Majburiy — vaqt yetmasa ham siqib yuboriladi
            </label>

            {kind === 'video_note' ? (
              <div className="box box-info">Video-doiraga matn qo'shib bo'lmaydi. Matn kerak bo'lsa, alohida xabar yarating.</div>
            ) : (
              <TextEditor
                id="chain-text"
                label={kind === 'text' ? 'Matn' : 'Izoh (caption)'}
                value={form.text}
                onChange={(v) => patch({ text: v })}
                limit={limit}
                limitHint={kind === 'text' ? undefined : 'media izohi'}
                rows={7}
                serverWarnings={current && !dirty ? current.warnings : undefined}
              />
            )}

            {kind !== 'text' && (
              <MediaPicker
                kind={kind}
                mediaIds={form.media_ids}
                onChange={(ids) => patch({ media_ids: ids })}
                known={media}
                onUploaded={(m) => setMedia((x) => ({ ...x, [m.id]: m }))}
              />
            )}

            {kind !== 'album' && (
              <div className="stack-sm">
                <div className="field"><span>Tugmalar</span></div>
                <ButtonsEditor value={form.buttons} onChange={(b) => patch({ buttons: b })} idPrefix="chain-btn" />
              </div>
            )}

            {current?.stats && (
              <div className="msg-stats">
                <span>Yuborildi: <b>{num(current.stats.sent)}</b></span>
                <span>Tugma bosildi: <b>{num(current.stats.clicks)}</b></span>
                <span>Keyin bloklagan: <b>{num(current.stats.blocked_after)}</b></span>
                {current.updated_by && <span>O'zgartirdi: {current.updated_by}, {fmtDateTime(current.updated_at)}</span>}
              </div>
            )}

            {errs.length > 0 && dirty && (
              <div className="box box-danger" role="alert"><ul className="plain-list">{errs.map((e) => <li key={e}>{e}</li>)}</ul></div>
            )}

            <div className="row-between">
              <div className="row">
                {current && <button type="button" className="btn btn-ghost" onClick={() => setShowHistory(true)}>Tarix</button>}
                {current && <button type="button" className="btn btn-ghost" onClick={() => void duplicate()} disabled={!!busy}>Nusxalash</button>}
                <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => void remove()} disabled={!!busy}>{sel?.id === 'new' ? 'Bekor qilish' : "O'chirish"}</button>
              </div>
              <div className="row-end">
                {current && <button type="button" className="btn" onClick={() => void test()} disabled={!!busy}>{busy === 'test' ? 'Yuborilmoqda…' : 'Menga test yuborish'}</button>}
                <button type="button" className="btn" onClick={toggleStatus} disabled={!!busy}>{form.status === 'active' ? 'Qoralama qilish' : 'Faollashtirish'}</button>
                <button type="button" className="btn btn-accent" onClick={() => void save()} disabled={!!busy || (!dirty && sel?.id !== 'new')}>{busy === 'save' ? 'Saqlanmoqda…' : 'Saqlash'}</button>
              </div>
            </div>
          </section>

          <section className="col-2 stack-sm" style={{ position: 'sticky', top: 16 }}>
            <div className="field"><span>Telegram'dagi ko'rinishi</span></div>
            <TelegramPreview kind={kind} text={form.text} buttons={kind === 'album' ? [] : form.buttons} media={form.media_ids.map((id) => media[id])} mediaCount={form.media_ids.length} />
            <div className="muted small">Namuna qiymatlar: {'{ism}'} = Madina, {'{efir_sanasi}'} = 23-oktabr, {'{efir_vaqti}'} = 20:00.</div>
            {sim && <SimSummary sim={sim} />}
          </section>
        </div>
      )}

      <SimulateModal open={showSim} fid={fid} onClose={() => setShowSim(false)} onResult={setSim} />
      <HistoryDrawer open={showHistory} messageId={current?.id ?? null} onClose={() => setShowHistory(false)} />
    </>
  );
}

export default function Chain() {
  return <NeedFunnel>{(f) => <ChainBody key={f.id} fid={f.id} />}</NeedFunnel>;
}
