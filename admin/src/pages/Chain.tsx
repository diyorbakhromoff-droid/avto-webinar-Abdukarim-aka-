import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/admin';
import { ApiError } from '../api/errors';
import type {
  ChainHistoryEntry, ChainKind, ChainMessage, ChainMessageInput, FunnelSettings, MediaInfo, Segment, SimulationRow, StuckStep, TriggerType,
} from '../api/types';
import { ButtonsEditor, cleanButtons, validateButtons } from '../components/ButtonsEditor';
import { MediaPicker } from '../components/MediaPicker';
import { Modal } from '../components/Modal';
import { NeedFunnel } from '../components/NeedFunnel';
import { TelegramPreview } from '../components/TelegramPreview';
import { TextEditor } from '../components/TextEditor';
import { WatchStatsPanel } from '../components/WatchStatsPanel';
import { NumberInput } from '../components/fields';
import { Badge, Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import {
  DEFAULT_OFFSET, MAIN_TRIGGERS, PHASES, SPECIAL_TRIGGERS, defaultsForPhase, isSpecialTrigger, leftBeforeDraft, metaLabel,
  needsDay, normalize, phaseOf, ruleSentence, segmentDayOf, sortChain, textLimit, toInput, whenLabel, type PhaseKey,
} from '../lib/chain';
import { useConfirm } from '../lib/confirm';
import { num, splitOffset, UNIT_LABEL, UNIT_MIN, type OffsetUnit } from '../lib/format';
import { honestyHits } from '../lib/honesty';
import {
  KIND_LABEL, SEGMENT_GROUPS, SEGMENT_LABEL, STUCK_LABEL, TRIGGER_LABEL, isMinuteSegment, isWatchSegment, options,
} from '../lib/labels';
import { slotOptions } from '../lib/slots';
import { visibleLength } from '../lib/telegramHtml';
import { dayLabel, fmtDateTime, fmtTime, fromLocalInput, toLocalInput } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

type Selected = { id: number } | { id: 'new' } | null;
type Patch = (p: Partial<ChainMessageInput>) => void;

// ───────────── kichik maydonlar ─────────────

/** Son + birlik (daqiqa/soat/kun) → daqiqa. `after` — keyingi so'z ("oldin"/"keyin"). */
function OffsetInput({ minutes, onChange, ariaLabel, after }: { minutes: number; onChange: (m: number) => void; ariaLabel: string; after?: string }) {
  const [unit, setUnit] = useState<OffsetUnit>(() => splitOffset(minutes).unit);
  const internal = useRef(false);
  useEffect(() => {
    // Tashqaridan o'zgarsa (boshqa xabar yoki trigger tanlansa) birlikni qayta tanlaymiz
    if (internal.current) {
      internal.current = false;
      if (minutes % UNIT_MIN[unit] === 0) return;
    }
    setUnit(splitOffset(minutes).unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);
  const value = minutes / UNIT_MIN[unit];
  return (
    <div className="offset-input">
      <NumberInput
        value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
        min={0}
        onChange={(n) => { internal.current = true; onChange(Math.max(0, Math.round(n * UNIT_MIN[unit]))); }}
        ariaLabel={`${ariaLabel} — son`}
      />
      <select className="select" value={unit} aria-label={`${ariaLabel} — birlik`} onChange={(e) => setUnit(e.target.value as OffsetUnit)}>
        {(Object.keys(UNIT_LABEL) as OffsetUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
      </select>
      {after && <span className="offset-after">{after}</span>}
    </div>
  );
}

function DayToggle({ value, onChange, label }: { value: 1 | 2; onChange: (d: 1 | 2) => void; label: string }) {
  return (
    <div className="segmented day-toggle" role="group" aria-label={label}>
      {([1, 2] as const).map((d) => (
        <button key={d} type="button" className={value === d ? 'seg seg-on' : 'seg'} aria-pressed={value === d} onClick={() => onChange(d)}>{d}-kun</button>
      ))}
    </div>
  );
}

/** Videoning daqiqasi: bo'sh bo'lishi mumkin (null). */
function MinuteInput({ value, onChange, max }: { value: number | null; onChange: (n: number | null) => void; max?: number }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    const cur = text === '' ? null : parseInt(text, 10);
    if (cur !== value) setText(value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="input-suffix minute-input">
      <input
        className={value === null ? 'input input-bad' : 'input'}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={text}
        placeholder="40"
        aria-label="Videoning daqiqasi"
        onChange={(e) => {
          setText(e.target.value);
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n > 0 ? n : null);
        }}
      />
      <span>-daqiqa</span>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s', flex: '0 0 auto' }}>
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ───────────── yordamchilar ─────────────

/** Video segmenti trigger kuniga "ergashib" turgan bo'lsa, trigger kuni bilan birga o'zgaradi. */
function followSegDay(f: ChainMessageInput, newTriggerDay: 1 | 2 | null): 1 | 2 | null {
  if (!isWatchSegment(f.segment)) return f.segment_day;
  const following = f.segment_day === null || f.segment_day === f.trigger_day;
  if (!following) return f.segment_day;
  return newTriggerDay ?? f.segment_day ?? f.trigger_day ?? null;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const segOptionLabel = (s: Segment) => SEGMENT_LABEL[s].replace('X', '__');

function videoMinutes(s: FunnelSettings | undefined, day: 1 | 2): number | null {
  if (!s) return null;
  return Math.round((day === 2 ? s.day2_duration_sec : s.day1_duration_sec) / 60) || null;
}

function validate(m: ChainMessageInput, settings?: FunnelSettings): string[] {
  const errs: string[] = [];
  if (!m.title.trim()) errs.push('Ichki nomini kiriting.');
  if (m.kind === 'text' && !m.text.trim()) errs.push("Matn bo'sh bo'lmasin.");
  if (m.kind !== 'video_note' && visibleLength(m.text) > textLimit(m.kind)) errs.push(`Matn ${textLimit(m.kind)} belgidan oshmasin.`);
  if (m.kind !== 'text' && m.status === 'active' && m.media_ids.length === 0) errs.push('Faol xabar uchun media yuklang.');
  if (m.kind === 'album' && m.media_ids.length > 0 && (m.media_ids.length < 2 || m.media_ids.length > 10)) errs.push('Albomda 2–10 ta media bo\'lishi kerak.');
  if (m.kind === 'album' && m.buttons.length > 0) errs.push("Albomga tugma qo'shib bo'lmaydi (Telegram cheklovi).");
  if (m.trigger_type === 'on_button' && !(m.button_key ?? '').trim()) errs.push('Tugma kalitini kiriting.');
  if (m.offset_minutes < 0) errs.push("Vaqt manfiy bo'lmasin.");
  if (isMinuteSegment(m.segment)) {
    const d = segmentDayOf(m);
    const dur = videoMinutes(settings, d);
    if (!m.segment_minute || m.segment_minute <= 0) errs.push('«Kimga yuboriladi?»: videoning daqiqasini kiriting.');
    else if (dur && m.segment_minute > dur) errs.push(`${d}-kun videosi ${dur} daqiqa — daqiqa shundan oshmasin.`);
  }
  const b = validateButtons(m.buttons);
  if (b) errs.push(b);
  return errs;
}

// ───────────── "Qachon yuboriladi?" ─────────────

function WhenPicker({ form, patch, settings, onOpenAdvanced }: { form: ChainMessageInput; patch: Patch; settings?: FunnelSettings; onOpenAdvanced: () => void }) {
  const t = form.trigger_type;
  const special = isSpecialTrigger(t);
  const main = MAIN_TRIGGERS.find((x) => x.value === t);

  const setTrigger = (next: TriggerType) => {
    const day = needsDay(next) ? (form.trigger_day ?? 1) : null;
    patch({
      trigger_type: next,
      trigger_day: day,
      stuck_step: null,
      button_key: null,
      offset_minutes: next === t ? form.offset_minutes : DEFAULT_OFFSET[next],
      segment_day: followSegDay(form, day),
    });
  };
  const setDay = (d: 1 | 2) => patch({ trigger_day: d, segment_day: followSegDay(form, d) });

  let hint: string | null = null;
  if (t === 'left_live') hint = "Lid efirni yopib chiqib ketgandan keyin yuboriladi. Shu vaqt ichida efirga qaytib kirsa — xabar bekor bo'ladi.";
  if (t === 'before_deadline') hint = `Deadline — 2-kun efiri tugagach ${settings?.deadline_hours ?? 'D'} soat (lid kartasida uzaytirilsa, xabar ham suriladi).`;
  if (t === 'at_day_start') hint = '0 — efir boshlanishi bilan.';
  if (t === 'after_registration') hint = "0 — ro'yxatdan o'tishi bilan darhol.";

  return (
    <fieldset className="picker">
      <legend className="picker-title"><span className="picker-n" aria-hidden="true">1</span>Qachon yuboriladi?</legend>
      <div className="picker-row">
        <select className="select picker-select" aria-label="Qachon yuboriladi" value={special ? 'special' : t} onChange={(e) => {
          if (e.target.value !== 'special') setTrigger(e.target.value as TriggerType);
        }}>
          {MAIN_TRIGGERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {special && <option value="special">{TRIGGER_LABEL[t]} (qo'shimcha sozlamalarda)</option>}
        </select>
        {!special && main && <OffsetInput minutes={form.offset_minutes} onChange={(m) => patch({ offset_minutes: m })} ariaLabel="Qancha vaqt" after={main.after} />}
        {!special && needsDay(t) && <DayToggle value={form.trigger_day ?? 1} onChange={setDay} label="Qaysi kun efiri" />}
      </div>
      {special ? (
        <div className="field-hint">
          Bu xabar maxsus holatda yuboriladi — <button type="button" className="link-btn" onClick={onOpenAdvanced}>«Qo'shimcha sozlamalar»da o'zgartirish</button>.
          Oddiy vaqtga o'tkazish uchun yuqoridan tanlang.
        </div>
      ) : hint ? <div className="field-hint">{hint}</div> : null}
    </fieldset>
  );
}

// ───────────── "Kimga yuboriladi?" ─────────────

function AudiencePicker({ form, patch, settings }: { form: ChainMessageInput; patch: Patch; settings?: FunnelSettings }) {
  const seg = form.segment;
  const watch = isWatchSegment(seg);
  const minute = isMinuteSegment(seg);
  const d = segmentDayOf(form);
  const dur = videoMinutes(settings, d);

  const setSegment = (s: Segment) => patch({
    segment: s,
    segment_day: isWatchSegment(s) ? (form.segment_day ?? form.trigger_day ?? 1) : null,
    segment_minute: isMinuteSegment(s) ? form.segment_minute : null,
  });

  return (
    <fieldset className="picker">
      <legend className="picker-title"><span className="picker-n" aria-hidden="true">2</span>Kimga yuboriladi?</legend>
      <div className="picker-row">
        <select className="select picker-select" aria-label="Kimga yuboriladi" value={seg} onChange={(e) => setSegment(e.target.value as Segment)}>
          {SEGMENT_GROUPS.map((g) => (g.label ? (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((s) => <option key={s} value={s}>{segOptionLabel(s)}</option>)}
            </optgroup>
          ) : g.items.map((s) => <option key={s} value={s}>{segOptionLabel(s)}</option>)))}
        </select>
        {watch && <DayToggle value={d} onChange={(x) => patch({ segment_day: x })} label="Qaysi kun videosi" />}
        {minute && <MinuteInput value={form.segment_minute} onChange={(n) => patch({ segment_minute: n })} max={dur ?? undefined} />}
      </div>
      {watch && (
        <div className="field-hint">
          {d}-kun videosi bo'yicha{dur ? ` (video ${dur} daqiqa)` : ''}.
          {seg === 'watched_full' || seg === 'not_full' ? ' «Oxirigacha» — videoning 95% qismini ko\'rgan.' : ''}
          {needsDay(form.trigger_type) && form.trigger_day !== d ? ` Diqqat: xabar ${form.trigger_day}-kunga bog'langan, auditoriya esa ${d}-kun videosi bo'yicha.` : ''}
        </div>
      )}
    </fieldset>
  );
}

// ───────────── Qo'shimcha sozlamalar ─────────────

function AdvancedSection({ open, onToggle, form, patch }: { open: boolean; onToggle: () => void; form: ChainMessageInput; patch: Patch }) {
  const special = isSpecialTrigger(form.trigger_type);
  const summary = [
    form.required ? 'majburiy' : null,
    form.status === 'active' ? 'faol' : 'qoralama',
    `tartib ${form.sort}`,
    special ? TRIGGER_LABEL[form.trigger_type].toLowerCase() : null,
  ].filter(Boolean).join(' · ');

  const setSpecial = (v: TriggerType | '') => {
    if (!v) {
      patch({ trigger_type: 'after_registration', trigger_day: null, stuck_step: null, button_key: null, offset_minutes: DEFAULT_OFFSET.after_registration, segment_day: followSegDay(form, null) });
      return;
    }
    patch({
      trigger_type: v, trigger_day: null,
      stuck_step: v === 'stuck' ? form.stuck_step ?? 'no_session' : null,
      button_key: v === 'on_button' ? form.button_key ?? '' : null,
      offset_minutes: v === form.trigger_type ? form.offset_minutes : DEFAULT_OFFSET[v],
      segment_day: followSegDay(form, null),
    });
  };

  return (
    <div className={open ? 'adv adv-open' : 'adv'}>
      <button type="button" className="adv-toggle" aria-expanded={open} aria-controls="chain-adv" onClick={onToggle}>
        <Chevron open={open} />
        <span className="adv-title">Qo'shimcha sozlamalar</span>
        <span className="adv-summary">{summary}</span>
      </button>
      {open && (
        <div id="chain-adv" className="adv-body">
          <div className="stack-sm" style={{ gap: 2 }}>
            <label className="check">
              <input type="checkbox" checked={form.required} onChange={(e) => patch({ required: e.target.checked })} />
              Majburiy (siqish)
            </label>
            <div className="field-hint">Lid efirga yaqin qolib ro'yxatdan o'tsa, oddiy xabar o'tkazib yuboriladi, majburiy xabar esa qolgan vaqtga siqib yuboriladi.</div>
          </div>

          <div className="adv-grid">
            <div className="field">
              <span>Holat</span>
              <div className="segmented" role="group" aria-label="Holat">
                {(['active', 'draft'] as const).map((s) => (
                  <button key={s} type="button" className={form.status === s ? 'seg seg-on' : 'seg'} aria-pressed={form.status === s} onClick={() => patch({ status: s })}>
                    {s === 'active' ? 'Faol' : 'Qoralama'}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Tartib raqami</span>
              <NumberInput value={form.sort} min={0} onChange={(n) => patch({ sort: Math.round(n) })} />
              <span className="field-hint">Bir vaqtga tushgan xabarlar shu tartibda ketadi.</span>
            </label>
          </div>

          <label className="field">
            <span>Maxsus holatda yuborish</span>
            <select className="select" value={special ? form.trigger_type : ''} onChange={(e) => setSpecial(e.target.value as TriggerType | '')}>
              <option value="">Yo'q — «Qachon yuboriladi?» bo'yicha</option>
              {SPECIAL_TRIGGERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {form.trigger_type === 'stuck' && (
            <div className="picker-row">
              <label className="field" style={{ flex: '1 1 220px' }}>
                <span>Qaysi holatda</span>
                <select className="select" value={form.stuck_step ?? 'no_session'} onChange={(e) => patch({ stuck_step: e.target.value as StuckStep })}>
                  {options(STUCK_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <div className="field" style={{ flex: '1 1 240px' }}>
                <span>Qancha vaqt to'xtab qolsa</span>
                <OffsetInput minutes={form.offset_minutes} onChange={(m) => patch({ offset_minutes: m })} ariaLabel="To'xtab qolish vaqti" />
              </div>
            </div>
          )}
          {form.trigger_type === 'on_button' && (
            <div className="picker-row">
              <label className="field" style={{ flex: '1 1 200px' }}>
                <span>Tugma kaliti</span>
                <input className="input mono" value={form.button_key ?? ''} onChange={(e) => patch({ button_key: e.target.value.replace(/[^\w-]/g, '') })} placeholder="homework" />
              </label>
              <div className="field" style={{ flex: '1 1 240px' }}>
                <span>Bosilgandan keyin</span>
                <OffsetInput minutes={form.offset_minutes} onChange={(m) => patch({ offset_minutes: m })} ariaLabel="Tugma bosilgandan keyin" after="keyin" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────── tarix va sinov ─────────────

const FIELD_LABEL: Record<string, string> = {
  title: 'Nomi', kind: 'Turi', text: 'Matn', media_ids: 'Media', buttons: 'Tugmalar', trigger_type: 'Qachon', trigger_day: 'Kun',
  offset_minutes: 'Vaqt (daq)', stuck_step: 'Qadam', button_key: 'Tugma kaliti', segment: 'Kimga', segment_day: 'Video kuni',
  segment_minute: 'Video daqiqasi', required: 'Majburiy', status: 'Holat', sort: 'Tartib',
};

function fmtVal(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'trigger_type' && typeof v === 'string') return TRIGGER_LABEL[v as TriggerType] ?? v;
  if (key === 'segment' && typeof v === 'string') return SEGMENT_LABEL[v as Segment] ?? v;
  if (key === 'status') return v === 'active' ? 'faol' : 'qoralama';
  if (typeof v === 'boolean') return v ? 'ha' : "yo'q";
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

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
                <span><span className="history-old">{fmtVal(k, a)}</span> → <span className="history-new">{fmtVal(k, b)}</span></span>
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

// ───────────── sahifa ─────────────

/** /chain?new=left_before_min&day=1&minute=40 — Statistika sahifasidan kelgan tayyor qoralama. */
function draftFromParams(p: URLSearchParams, sort: number): ChainMessageInput | null {
  if (p.get('new') !== 'left_before_min') return null;
  const minute = parseInt(p.get('minute') ?? '', 10);
  const day = p.get('day') === '2' ? 2 : 1;
  if (!Number.isFinite(minute) || minute <= 0) return null;
  return leftBeforeDraft(minute, day, sort);
}

function ChainBody({ fid }: { fid: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const chain = useLoad(() => api.chain(fid), [fid]);
  const settings = useLoad(() => api.settings(fid), [fid]);
  const [sel, setSel] = useState<Selected>(null);
  const [form, setForm] = useState<ChainMessageInput | null>(null);
  const [base, setBase] = useState<string>('');
  const [media, setMedia] = useState<Record<number, MediaInfo>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showSim, setShowSim] = useState(false);
  const [sim, setSim] = useState<{ registered_at: string; day1_at: string; rows: SimulationRow[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [serverErrs, setServerErrs] = useState<string[]>([]);
  const editorRef = useRef<HTMLElement>(null);

  const list = chain.data ?? [];
  const current = sel && sel.id !== 'new' ? list.find((m) => m.id === sel.id) ?? null : null;
  const dirty = !!form && JSON.stringify(form) !== base;
  const deadlineMin = (settings.data?.deadline_hours ?? 24) * 60;
  const maxSort = list.reduce((a, m) => Math.max(a, m.sort), 0);

  const byPhase = useMemo(() => {
    const map: Record<PhaseKey, ChainMessage[]> = { reg: [], day1: [], between: [], day2: [], after: [], other: [] };
    for (const m of sortChain(list, deadlineMin)) map[phaseOf(m)].push(m);
    return map;
  }, [list, deadlineMin]);

  const open = (f: ChainMessageInput, id: Selected, saved: boolean) => {
    setSel(id);
    setForm(f);
    setBase(saved ? JSON.stringify(f) : '');
    setServerErrs([]);
    setAdvOpen(isSpecialTrigger(f.trigger_type));
  };

  // Birinchi yuklanishda: URL dagi tayyor qoralama yoki birinchi xabar
  useEffect(() => {
    if (sel || !chain.data) return;
    const draft = draftFromParams(params, chain.data.reduce((a, m) => Math.max(a, m.sort), 0) + 1);
    if (draft) {
      open(draft, { id: 'new' }, false);
      setParams({}, { replace: true });
      setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      return;
    }
    if (!chain.data.length) return;
    const first = sortChain(chain.data)[0];
    open(toInput(first), { id: first.id }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.data, sel]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const guard = async () => !dirty || confirm({ title: "Saqlanmagan o'zgarishlar", message: "Joriy xabardagi o'zgarishlar saqlanmagan. Ularni tashlab ketasizmi?", confirmText: 'Tashlab ketish', danger: true });

  const scrollToEditor = (always = false) => {
    if (always || window.matchMedia('(max-width: 899px)').matches) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const select = async (m: ChainMessage) => {
    if (sel && sel.id === m.id) return;
    if (!(await guard())) return;
    open(toInput(m), { id: m.id }, true);
    scrollToEditor();
  };

  const createNew = async (phase: PhaseKey) => {
    if (!(await guard())) return;
    open(defaultsForPhase(phase, maxSort + 1), { id: 'new' }, false);
    scrollToEditor();
  };

  /** Tomosha statistikasidan: shu daqiqagacha chiqib ketganlarga xabar. */
  const createLeftBefore = async (minute: number, day: 1 | 2) => {
    if (!(await guard())) return;
    open(leftBeforeDraft(minute, day, maxSort + 1), { id: 'new' }, false);
    scrollToEditor(true);
  };

  const patch: Patch = (p) => {
    setForm((f) => (f ? { ...f, ...p } : f));
    setServerErrs((e) => (e.length ? [] : e));
  };

  const replaceInList = (m: ChainMessage) => chain.setData((l) => {
    const arr = l ?? [];
    return arr.some((x) => x.id === m.id) ? arr.map((x) => (x.id === m.id ? m : x)) : [...arr, m];
  });

  const save = async (override?: Partial<ChainMessageInput>) => {
    if (!form) return;
    const body = normalize({ ...form, ...override, buttons: cleanButtons(form.buttons) });
    const errs = validate(body, settings.data);
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
      setServerErrs([]);
      toast.success(saved.warnings?.length ? 'Saqlandi — ogohlantirishlarni ko\'ring' : 'Saqlandi');
    } catch (e) {
      // Backend validatsiyasi: detail = "xato1; xato2"
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.detail) setServerErrs(e.detail.split(/;\s*/).filter(Boolean));
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
      open(toInput(copy), { id: copy.id }, true);
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
      setServerErrs([]);
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
  const errs = form ? validate(normalize(form), settings.data) : [];
  const paidOnly = form?.segment === 'deposit_paid' || form?.segment === 'full_paid';

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

      <WatchStatsPanel fid={fid} collapsible compact onMessage={(m, d) => void createLeftBefore(m, d)} />

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
          <section ref={editorRef} className="card col-3 chain-editor" aria-label="Xabar muharriri" style={{ scrollMarginTop: 72 }}>
            <div className="row-between">
              <h2 className="card-title" style={{ fontSize: 18 }}>{sel?.id === 'new' ? 'Yangi xabar' : 'Xabar'}: «{form.title || 'Yangi xabar'}»</h2>
              <span className={form.status === 'active' ? 'status-pill status-active' : 'status-pill status-draft'}>{form.status === 'active' ? 'Faol' : 'Qoralama'}</span>
            </div>

            <label className="field">
              <span>Ichki nomi</span>
              <input className="input" value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Efirgacha 2 soat" />
            </label>

            <WhenPicker form={form} patch={patch} settings={settings.data} onOpenAdvanced={() => setAdvOpen(true)} />
            <AudiencePicker form={form} patch={patch} settings={settings.data} />

            <div className="rule-sentence" aria-live="polite">
              <span className="rule-label">Qoida</span>
              <span className="rule-text">{capitalize(ruleSentence(form))}</span>
              {!paidOnly && <span className="rule-note">To'lov qilgan, botni bloklagan va sovuq lidlarga zanjir xabari bormaydi.</span>}
            </div>

            <div className="picker">
              <div className="picker-title"><span className="picker-n" aria-hidden="true">3</span>Xabar</div>
              <label className="field" style={{ maxWidth: 340 }}>
                <span>Turi</span>
                <select className="select" value={form.kind} onChange={(e) => {
                  const k = e.target.value as ChainKind;
                  patch({ kind: k, media_ids: k === 'album' || form.kind === 'album' ? [] : form.media_ids });
                }}>
                  {options(KIND_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
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
            </div>

            <AdvancedSection open={advOpen} onToggle={() => setAdvOpen((o) => !o)} form={form} patch={patch} />

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
            {serverErrs.length > 0 && (
              <div className="box box-danger" role="alert">
                <div className="stack-sm" style={{ gap: 4 }}>
                  <b>Server saqlamadi:</b>
                  <ul className="plain-list">{serverErrs.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              </div>
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

          <section className="col-2 stack-sm chain-preview">
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
