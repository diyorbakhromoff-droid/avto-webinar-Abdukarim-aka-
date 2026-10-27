import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/admin';
import type { QueueRow, TimingMessage, TimingPage, TriggerType } from '../api/types';
import { Modal } from '../components/Modal';
import { NeedFunnel } from '../components/NeedFunnel';
import { NumberInput } from '../components/fields';
import { Badge, Card, Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { offsetWords } from '../lib/chain';
import { UNIT_LABEL, UNIT_MIN, splitOffset, type OffsetUnit } from '../lib/format';
import { KIND_SHORT } from '../lib/labels';
import { useConfirm } from '../lib/confirm';
import { WEEKDAYS, fmtDate, fmtDateTime, fmtDateTimeLong, fmtTime, fromLocalInput, toLocalInput, tzParts } from '../lib/time';
import {
  BEFORE, DAY_TRIGGERS, EVENT_TRIGGERS, PRESETS, WHEN_OPTIONS, gapLabel, inQuiet, previewAt, previousReg, type WhenMode,
} from '../lib/timing';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

const dayTitle = (t: number) => `${WEEKDAYS[tzParts(t).wd]}, ${fmtDate(t)}`;

// ───────────── vaqtni sozlash oynasi ─────────────

function TimingEditor({ m, page, onClose, onSaved }: { m: TimingMessage; page: TimingPage; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const event = EVENT_TRIGGERS.has(m.trigger_type);
  const prev = previousReg(page.messages, m);
  const [mode, setMode] = useState<WhenMode>(m.trigger_type);
  const [day, setDay] = useState<1 | 2>(m.trigger_day ?? 1);
  // prev rejimida — oldingi xabardan oraliq; qolganlarida — langardan (ro'yxat, efir, deadline) masofa
  const [offset, setOffset] = useState(m.offset_minutes);
  const [fixed, setFixed] = useState(toLocalInput(m.fixed_at ?? Date.now() + 86_400_000));
  const [custom, setCustom] = useState(false);
  const [unit, setUnit] = useState<OffsetUnit>(splitOffset(m.offset_minutes).unit);
  const [shift, setShift] = useState(false);
  const [busy, setBusy] = useState(false);

  const trigger: TriggerType = mode === 'prev' ? 'after_registration' : mode;
  const absOffset = mode === 'prev' ? (prev?.offset_minutes ?? 0) + offset : offset;
  const fixedIso = mode === 'at_datetime' ? fromLocalInput(fixed) : null;
  const dayOf: 1 | 2 | null = DAY_TRIGGERS.has(trigger) || trigger === 'left_live' ? day : null;
  const at = previewAt(trigger, dayOf, absOffset, fixedIso, page.sample);
  const sameGroup = trigger === m.trigger_type && (dayOf ?? null) === (m.trigger_day ?? null) && trigger !== 'at_datetime';
  const delta = absOffset - m.offset_minutes;
  const others = page.messages.filter((x) => x.id !== m.id && x.status === 'active' && x.planned_at)
    .map((x) => ({ x, t: Date.parse(x.planned_at!) })).sort((a, b) => a.t - b.t);
  const before = at !== null ? others.filter((o) => o.t <= at).pop() : undefined;
  const after = at !== null ? others.find((o) => o.t > at) : undefined;
  const past = mode === 'at_datetime' && fixedIso !== null && Date.parse(fixedIso) < Date.now();
  const quiet = at !== null && mode !== 'at_datetime' && inQuiet(at, page.quiet.start, page.quiet.end);
  const invalid = (mode === 'at_datetime' && (!fixedIso || past)) || absOffset < 0 || absOffset > 60 * 1440;

  const pickMode = (v: WhenMode) => {
    setMode(v);
    setCustom(false);
    if (v === 'prev') setOffset(prev ? Math.max(0, m.offset_minutes - prev.offset_minutes) || 15 : 15);
    else if (v === m.trigger_type) setOffset(m.offset_minutes);
    else if (v === 'at_day_start' || v === 'after_day_end') setOffset(0);
    else if (v !== 'at_datetime') setOffset(v === 'after_registration' ? 15 : 60);
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.setTiming(m.id, {
        trigger_type: trigger, trigger_day: dayOf, offset_minutes: trigger === 'at_datetime' ? 0 : absOffset,
        fixed_at: fixedIso, shift_following: shift && sameGroup && delta !== 0,
      });
      toast.success(`Saqlandi: ${r.rule}${r.shifted ? ` · yana ${r.shifted} ta xabar surildi` : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const intervalLabel = mode === 'prev' ? 'Oldingi xabardan qancha keyin'
    : BEFORE.has(mode) ? 'Qancha oldin' : event ? 'Hodisadan qancha keyin' : 'Qancha keyin';
  const showZero = !BEFORE.has(mode) && mode !== 'prev';

  return (
    <Modal open onClose={onClose} size="md" title="⏰ Yuborish vaqtini sozlash"
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Bekor qilish</button>
          <button type="button" className="btn btn-accent" disabled={busy || invalid} onClick={() => void save()}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
        </>
      )}>
      <div className="tile"><span>Xabar: <b>«{m.title}»</b></span><span className="small muted">{KIND_SHORT[m.kind]} · {m.segment_label}</span></div>

      {event ? (
        <div className="small muted">Bu xabar lidning harakatiga bog'liq: <b>{m.rule}</b>. Bu yerda faqat kechikishni o'zgartirasiz.</div>
      ) : (
        <label className="field field-compact">
          <span>Qachon yuboriladi</span>
          <select className="select" value={mode} onChange={(e) => pickMode(e.target.value as WhenMode)}>
            {WHEN_OPTIONS.filter((o) => o.value !== 'prev' || prev).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {mode === 'prev' && prev && <div className="small muted">Oldingi xabar: «{prev.title}» — {offsetWords(prev.offset_minutes) || '0'} ro'yxatdan keyin.</div>}
      {(DAY_TRIGGERS.has(mode) || m.trigger_type === 'left_live') && (
        <div className="segmented" role="group" aria-label="Qaysi kun efiri">
          {([1, 2] as const).map((d) => <button key={d} type="button" className={day === d ? 'seg seg-on' : 'seg'} aria-pressed={day === d} onClick={() => setDay(d)}>{d}-kun efiri</button>)}
        </div>
      )}

      {mode === 'at_datetime' ? (
        <label className="field field-compact">
          <span>Sana va vaqt (Toshkent vaqti)</span>
          <input className="input" type="datetime-local" value={fixed} onChange={(e) => setFixed(e.target.value)} />
          {fixedIso && <span className={past ? 'small text-danger strong' : 'small'}>{past ? "Bu vaqt o'tib ketgan — kelajakdagi vaqtni tanlang." : `${fmtDateTimeLong(fixedIso)} · ${WEEKDAYS[tzParts(fixedIso).wd]}`}</span>}
        </label>
      ) : (
        <div className="field">
          <span>{intervalLabel}</span>
          <div className="chips">
            {showZero && <button type="button" className={!custom && offset === 0 ? 'chip chip-on' : 'chip'} onClick={() => { setCustom(false); setOffset(0); }}>Darhol</button>}
            {PRESETS.map((p) => (
              <button key={p.min} type="button" className={!custom && offset === p.min ? 'chip chip-on' : 'chip'} onClick={() => { setCustom(false); setOffset(p.min); }}>{p.label}</button>
            ))}
            <button type="button" className={custom || (offset !== 0 && !PRESETS.some((p) => p.min === offset)) ? 'chip chip-on' : 'chip'} onClick={() => { setCustom(true); setUnit(splitOffset(offset).unit); }}>✍️ Boshqa vaqt</button>
          </div>
          {(custom || (offset !== 0 && !PRESETS.some((p) => p.min === offset))) && (
            <div className="offset-input">
              <NumberInput value={Number((offset / UNIT_MIN[unit]).toFixed(2))} min={0} ariaLabel="Boshqa vaqt — son"
                onChange={(n) => setOffset(Math.max(0, Math.round(n * UNIT_MIN[unit])))} />
              <select className="select" value={unit} aria-label="Boshqa vaqt — birlik" onChange={(e) => setUnit(e.target.value as OffsetUnit)}>
                {(Object.keys(UNIT_LABEL) as OffsetUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="box box-info box-col small">
        {at !== null ? (
          <>
            <div>Namuna lid uchun: <b>{dayTitle(at)}, soat {fmtTime(at)}</b>{quiet ? ` — tungi tinchlikka (${page.quiet.start}–${page.quiet.end}) tushadi, ${page.quiet.end} ga suriladi` : ''}</div>
            <div className="muted">Har bir lid uchun o'zining ro'yxat va efir vaqtidan hisoblanadi.</div>
            {before && <div>Oldingi xabar: «{before.x.title}» — {gapLabel(at - before.t)} oldin</div>}
            {after ? <div>Keyingi xabar: «{after.x.title}» — <b>{gapLabel(after.t - at)}</b> dan keyin</div> : <div className="muted">Bundan keyin boshqa xabar yo'q.</div>}
          </>
        ) : (
          <div>Lid {m.rule.replace(/\s*\(.*\)$/, '')} holatiga tushgach <b>{offsetWords(offset) || 'darhol'}</b>{offset ? ' keyin' : ''} yuboriladi.</div>
        )}
      </div>

      {sameGroup && delta !== 0 && !event && (
        <label className="check">
          <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
          <span>Shu guruhdagi keyingi xabarlar ham {offsetWords(Math.abs(delta))} {(delta > 0) !== BEFORE.has(trigger) ? 'kechroq' : 'ertaroq'} yuborilsin (oraliqlar saqlanadi)</span>
        </label>
      )}
      <div className="small muted">Saqlangach, navbatda kutayotgan lidlarning vaqti qayta hisoblanadi; yuborilganlari qayta yuborilmaydi.</div>
    </Modal>
  );
}

// ───────────── navbat ─────────────

function QueueModal({ m, onClose, onChanged }: { m: TimingMessage; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const st = useLoad(() => api.chainQueue(m.id), [m.id]);
  const cancel = async (row: QueueRow) => {
    try {
      await api.cancelScheduled(row.id);
      st.setData((d) => d && { total: d.total - 1, items: d.items.filter((x) => x.id !== row.id) });
      toast.success(`${row.lead_name} uchun bekor qilindi`);
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal open onClose={onClose} size="md" title={`Navbatda: «${m.title}»`}>
      {st.error && !st.data ? <ErrorBox error={st.error} onRetry={st.reload} /> : !st.data ? <Loading /> : st.data.items.length === 0 ? (
        <Empty title="Navbatda hech kim yo'q" />
      ) : (
        <>
          <div className="small muted">{st.data.total} ta lid kutmoqda{st.data.total > st.data.items.length ? ` (eng yaqin ${st.data.items.length} tasi)` : ''}. Bekor qilish faqat shu lidga ta'sir qiladi.</div>
          <div className="table-wrap flat">
            <table className="table table-compact">
              <thead><tr><th>Lid</th><th>Yuboriladi</th><th /></tr></thead>
              <tbody>
                {st.data.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.lead_name}</td>
                    <td className="nowrap tnum">{fmtDateTime(r.send_at)}</td>
                    <td className="num"><button type="button" className="btn btn-sm btn-ghost btn-danger-ghost" onClick={() => void cancel(r)}>Bekor qilish</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

// ───────────── sahifa ─────────────

function Row({ m, at, onEdit, onQueue }: { m: TimingMessage; at: number | null; onEdit: () => void; onQueue: () => void }) {
  const note = m.plan_status === 'quiet_shifted' || m.plan_status === 'compressed' ? m.plan_reason : null;
  return (
    <div className="tm-row">
      <div className="tm-time tnum">{at !== null ? fmtTime(at) : '—'}</div>
      <div className="tm-body">
        <div className="tm-title">«{m.title}» <span className="small muted">{KIND_SHORT[m.kind]}</span>{m.required && <> <Badge tone="ink">majburiy</Badge></>}</div>
        <div className="small muted">{m.rule} · {m.segment_label}{note ? ` · ${note}` : ''}</div>
        {m.pending > 0 && <button type="button" className="link-btn small" onClick={onQueue}>navbatda {m.pending} ta lid · eng yaqini {fmtDateTime(m.next_at)}</button>}
      </div>
      <button type="button" className="btn btn-sm" onClick={onEdit}>Vaqtni o'zgartirish</button>
    </div>
  );
}

function BroadcastRow({ b, onChanged }: { b: TimingPage['broadcasts'][number]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(toLocalInput(b.send_at));
  const save = async () => {
    try {
      await api.rescheduleBroadcast(b.id, fromLocalInput(val));
      toast.success('Vaqt o\'zgartirildi');
      setEdit(false);
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  const cancel = async () => {
    if (!(await confirm({ title: 'Ommaviy xabarni bekor qilish', message: 'Bu xabar hech kimga yuborilmaydi.', confirmText: 'Bekor qilish', danger: true }))) return;
    try {
      await api.cancelBroadcast(b.id);
      toast.success('Bekor qilindi');
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="tm-row">
      <div className="tm-time tnum">{b.send_at ? fmtTime(b.send_at) : 'darhol'}</div>
      <div className="tm-body">
        <div className="tm-title clamp-2">{b.text.replace(/<[^>]+>/g, '') || '(media)'}</div>
        <div className="small muted">{b.send_at ? `${dayTitle(Date.parse(b.send_at))} · ` : ''}ommaviy xabar</div>
        {edit && (
          <div className="inline-form">
            <input className="input" type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Yangi vaqt" />
            <button type="button" className="btn btn-sm btn-accent" onClick={() => void save()}>Saqlash</button>
          </div>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => setEdit((x) => !x)}>Vaqtni o'zgartirish</button>
        <button type="button" className="btn btn-sm btn-ghost btn-danger-ghost" onClick={() => void cancel()}>Bekor qilish</button>
      </div>
    </div>
  );
}

function TimingBody({ fid }: { fid: number }) {
  const [reg, setReg] = useState('');
  const [day1, setDay1] = useState('');
  const regIso = reg ? fromLocalInput(reg) ?? undefined : undefined;
  const st = useLoad(() => api.timing(fid, { registered_at: regIso, day1_at: day1 || undefined }), [fid, regIso, day1]);
  const [editing, setEditing] = useState<TimingMessage | null>(null);
  const [queue, setQueue] = useState<TimingMessage | null>(null);
  useEffect(() => { if (st.data && !reg) setReg(toLocalInput(st.data.sample.registered_at)); }, [st.data, reg]);

  const groups = useMemo(() => {
    const msgs = st.data?.messages ?? [];
    const timed = msgs.filter((m) => m.status === 'active' && m.planned_at)
      .map((m) => ({ m, t: Date.parse(m.planned_at!) })).sort((a, b) => a.t - b.t || a.m.sort - b.m.sort);
    return {
      timed,
      skipped: msgs.filter((m) => m.status === 'active' && m.plan_status === 'skipped'),
      events: msgs.filter((m) => m.status === 'active' && m.plan_status === 'event'),
      drafts: msgs.filter((m) => m.status !== 'active'),
    };
  }, [st.data]);

  if (st.error && !st.data) return <ErrorBox error={st.error} onRetry={st.reload} />;
  if (!st.data) return <Loading />;
  const p = st.data;
  let lastDay = '';

  return (
    <>
      <Card title="Namuna lid">
        <div className="small muted">
          Har bir lidning jadvali o'zi ro'yxatdan o'tgan va tanlagan efir vaqtidan hisoblanadi — bir lidning vaqti boshqasiga ta'sir qilmaydi.
          Pastda shu namuna lid uchun aniq kun va soatlar. Barcha vaqtlar — Toshkent vaqti (UTC+5).
          Tungi tinchlik {p.quiet.start}–{p.quiet.end}: shu oraliqqa tushgan xabarlar ertalabga suriladi.
        </div>
        <div className="inline-form">
          <label className="field field-compact" style={{ flex: '1 1 200px' }}>
            <span>Ro'yxatdan o'tdi</span>
            <input className="input" type="datetime-local" value={reg} onChange={(e) => { setReg(e.target.value); setDay1(''); }} />
          </label>
          <label className="field field-compact" style={{ flex: '1 1 220px' }}>
            <span>Tanlagan 1-kun efiri</span>
            <select className="select" value={day1 || p.sample.day1_at} onChange={(e) => setDay1(e.target.value)}>
              {(p.sample.day1_options.includes(p.sample.day1_at) ? p.sample.day1_options : [p.sample.day1_at, ...p.sample.day1_options]).map((o) => (
                <option key={o} value={o}>{dayTitle(Date.parse(o))}, {fmtTime(o)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="small">2-kun: <b>{dayTitle(Date.parse(p.sample.day2_at))}, {fmtTime(p.sample.day2_at)}</b> · deadline: <b>{fmtDateTime(p.sample.deadline_at)}</b></div>
      </Card>

      <Card title="Jadval">
        {groups.timed.length === 0 ? <Empty title="Faol xabar yo'q">Xabarlarni <Link to="/chain">Progrev zanjiri</Link>da qo'shing.</Empty> : (
          <div className="tm">
            {groups.timed.map(({ m, t }, i) => {
              const d = dayTitle(t);
              const head = d !== lastDay;
              lastDay = d;
              const next = groups.timed[i + 1];
              return (
                <div key={m.id}>
                  {head && <div className="tm-day">{d}</div>}
                  <Row m={m} at={t} onEdit={() => setEditing(m)} onQueue={() => setQueue(m)} />
                  {next && <div className="tm-gap">↓ {next.t === t ? 'keyingisi shu vaqtning o\'zida' : `keyingisi ${gapLabel(next.t - t)} dan keyin`}</div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {groups.events.length > 0 && (
        <Card title="Lidning harakatiga qarab">
          <div className="small muted">Bu xabarlar lid biror ish qilganda (yoki qilmaganda) shundan keyin hisoblanadi.</div>
          <div className="tm">{groups.events.map((m) => <Row key={m.id} m={m} at={null} onEdit={() => setEditing(m)} onQueue={() => setQueue(m)} />)}</div>
        </Card>
      )}

      {groups.skipped.length > 0 && (
        <Card title="Bu namunada yuborilmaydi">
          <div className="tm">
            {groups.skipped.map((m) => (
              <div key={m.id} className="tm-row">
                <div className="tm-time">—</div>
                <div className="tm-body"><div className="tm-title">«{m.title}»</div><div className="small muted">{m.rule} · {m.plan_reason}</div></div>
                <button type="button" className="btn btn-sm" onClick={() => setEditing(m)}>Vaqtni o'zgartirish</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Ommaviy xabarlar (aniq vaqtda)">
        {p.broadcasts.length === 0 ? <div className="small muted">Rejadagi ommaviy xabar yo'q. <Link to="/broadcasts">Ommaviy xabar</Link> bo'limida aniq sana va vaqtga qo'yish mumkin.</div> : (
          <div className="tm">{p.broadcasts.map((b) => <BroadcastRow key={b.id} b={b} onChanged={() => void st.reload()} />)}</div>
        )}
      </Card>

      {groups.drafts.length > 0 && (
        <Card title={`Qoralamalar · ${groups.drafts.length}`}>
          <div className="small muted">Yuborilmaydi. Faollashtirish — <Link to="/chain?view=days">Progrev zanjiri</Link>da.</div>
          <div className="tm">{groups.drafts.map((m) => <Row key={m.id} m={m} at={null} onEdit={() => setEditing(m)} onQueue={() => setQueue(m)} />)}</div>
        </Card>
      )}

      {editing && <TimingEditor m={editing} page={p} onClose={() => setEditing(null)} onSaved={() => void st.reload()} />}
      {queue && <QueueModal m={queue} onClose={() => setQueue(null)} onChanged={() => void st.reload()} />}
    </>
  );
}

export default function Timing() {
  return (
    <>
      <PageHead title="⏰ Xabarlar vaqti" sub="Progrev xabarlari qachon ketadi, oraliqlar, aniq sana va navbatdagi lidlar" />
      <NeedFunnel>{(f) => <TimingBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
