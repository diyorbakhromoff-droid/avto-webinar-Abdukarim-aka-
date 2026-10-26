import { useState } from 'react';
import { api } from '../../api/admin';
import type { ChainMessage, ChainMessageInput, FlowNode, Segment, TriggerType } from '../../api/types';
import { normalize, toInput } from '../../lib/chain';
import { useConfirm } from '../../lib/confirm';
import { chainItemWhen } from '../../lib/flow';
import { UNIT_LABEL, UNIT_MIN, splitOffset, type OffsetUnit } from '../../lib/format';
import { SEGMENT_GROUPS, SEGMENT_LABEL, isMinuteSegment, isWatchSegment } from '../../lib/labels';
import { useToast } from '../../lib/toast';
import { cleanButtons } from '../ButtonsEditor';
import { MessageFields, contentError } from './MessageFields';

/** Zanjir xabarining vaqti — "ro'yxatdan keyin" zanjirda "zanjirga kirgach" bo'ladi. */
const WHEN: { value: TriggerType; label: string; after: string }[] = [
  { value: 'after_registration', label: 'Zanjirga kirgach …', after: 'keyin' },
  { value: 'before_day', label: 'Efirdan … oldin', after: 'oldin' },
  { value: 'at_day_start', label: 'Efir boshlangach …', after: 'keyin' },
  { value: 'after_day_end', label: 'Efir tugagach …', after: 'keyin' },
  { value: 'before_deadline', label: 'Deadline tugashidan … oldin', after: 'oldin' },
];
const DAY_TRIGGERS = new Set<TriggerType>(['before_day', 'at_day_start', 'after_day_end']);

function blank(sort: number): ChainMessageInput {
  return {
    title: 'Yangi xabar', kind: 'text', text: '', media_ids: [], buttons: [],
    trigger_type: 'after_registration', trigger_day: null, offset_minutes: 60,
    stuck_step: null, button_key: null, segment: 'all', segment_day: null, segment_minute: null,
    required: false, status: 'active', sort,
  };
}

function OffsetField({ minutes, onChange, after }: { minutes: number; onChange: (m: number) => void; after: string }) {
  const [unit, setUnit] = useState<OffsetUnit>(() => splitOffset(minutes).unit);
  const value = Math.round(minutes / UNIT_MIN[unit]);
  return (
    <div className="row" style={{ gap: 6 }}>
      <input className="input" style={{ width: 80 }} type="number" min={0} inputMode="numeric" aria-label="Miqdor"
        value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0) * UNIT_MIN[unit])} />
      <select className="select" style={{ width: 'auto' }} aria-label="Birlik" value={unit} onChange={(e) => {
        const u = e.target.value as OffsetUnit;
        setUnit(u);
        onChange(value * UNIT_MIN[u]);
      }}>
        {(Object.keys(UNIT_LABEL) as OffsetUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
      </select>
      <span className="muted small">{after}</span>
    </div>
  );
}

export function ChainItems({ fid, node, onSaved }: { fid: number; node: FlowNode; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<{ id: number | 'new'; form: ChainMessageInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const items = node.messages as ChainMessage[];

  const patch = (p: Partial<ChainMessageInput>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));

  const save = async () => {
    if (!edit) return;
    const body = normalize({ ...edit.form, buttons: cleanButtons(edit.form.buttons) });
    const err = !body.title ? 'Xabar nomini kiriting' : contentError(body)
      ?? (isMinuteSegment(body.segment) && !body.segment_minute ? 'Videoning daqiqasini kiriting' : null);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      if (edit.id === 'new') await api.createChainItem(fid, node.id, body);
      else await api.updateChain(edit.id, body);
      toast.success('Saqlandi');
      setEdit(null);
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const a = items[i], b = items[i + dir];
    if (!a || !b) return;
    setBusy(true);
    try {
      // tartib raqamlarini qayta beramiz — teng "sort" bo'lsa ham to'g'ri almashadi
      const order = items.map((m) => m.id);
      [order[i], order[i + dir]] = [order[i + dir], order[i]];
      await Promise.all(items.map((m) => {
        const sort = order.indexOf(m.id);
        return sort === m.sort ? null : api.updateChain(m.id, { ...toInput(m), sort });
      }));
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: ChainMessage) => {
    if (!(await confirm({ title: "Xabarni o'chirish", message: `«${m.title}» zanjirdan o'chiriladi. Hali yuborilmagan rejalar bekor qilinadi.`, confirmText: "O'chirish", danger: true }))) return;
    try {
      await api.deleteChain(m.id);
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };

  if (edit) {
    const f = edit.form;
    const when = WHEN.find((w) => w.value === f.trigger_type) ?? WHEN[0];
    return (
      <div className="stack-sm fi-sub">
        <div className="row-between">
          <b>{edit.id === 'new' ? 'Yangi xabar' : 'Xabarni tahrirlash'}</b>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>← Ro'yxatga</button>
        </div>
        <label className="field field-compact">
          <span>Nomi</span>
          <input className="input" value={f.title} onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <label className="field field-compact">
          <span>Qachon yuboriladi</span>
          <select className="select" value={f.trigger_type} onChange={(e) => {
            const t = e.target.value as TriggerType;
            patch({ trigger_type: t, trigger_day: DAY_TRIGGERS.has(t) ? (f.trigger_day ?? 1) : null });
          }}>
            {WHEN.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </label>
        <div className="row">
          {DAY_TRIGGERS.has(f.trigger_type) && (
            <select className="select" style={{ width: 'auto' }} aria-label="Qaysi kun" value={f.trigger_day ?? 1} onChange={(e) => patch({ trigger_day: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>1-kun</option>
              <option value={2}>2-kun</option>
            </select>
          )}
          <OffsetField minutes={f.offset_minutes} onChange={(m) => patch({ offset_minutes: m })} after={when.after} />
        </div>
        <div className="muted small">Lid zanjirga kirganida bu vaqt o'tib ketgan bo'lsa — xabar yuborilmaydi.</div>
        <label className="field field-compact">
          <span>Kimga (yuborish paytida tekshiriladi)</span>
          <select className="select" value={f.segment} onChange={(e) => patch({ segment: e.target.value as Segment })}>
            {SEGMENT_GROUPS.map((g) => (
              <optgroup key={g.label ?? 'all'} label={g.label ?? 'Hammaga'}>
                {g.items.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s].replace('X', '__')}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {isWatchSegment(f.segment) && (
          <div className="row">
            <select className="select" style={{ width: 'auto' }} aria-label="Qaysi kun videosi" value={f.segment_day ?? 1} onChange={(e) => patch({ segment_day: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>1-kun videosi</option>
              <option value={2}>2-kun videosi</option>
            </select>
            {isMinuteSegment(f.segment) && (
              <input className="input" style={{ width: 110 }} type="number" min={1} aria-label="Videoning daqiqasi" placeholder="daqiqa"
                value={f.segment_minute ?? ''} onChange={(e) => patch({ segment_minute: e.target.value ? Number(e.target.value) : null })} />
            )}
          </div>
        )}
        <label className="check"><input type="checkbox" checked={f.required} onChange={(e) => patch({ required: e.target.checked })} /> Majburiy (vaqt qisqa bo'lsa ham tashlab ketilmaydi)</label>
        <MessageFields id={`chain-${node.id}`} value={f} onChange={patch} />
        <div className="row-between">
          <label className="check"><input type="checkbox" checked={f.status === 'active'} onChange={(e) => patch({ status: e.target.checked ? 'active' : 'draft' })} /> Faol</label>
          <div className="row">
            <button type="button" className="btn" onClick={() => setEdit(null)} disabled={busy}>Bekor qilish</button>
            <button type="button" className="btn btn-accent" onClick={() => void save()} disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <div className="field"><span>Zanjir xabarlari</span></div>
      {!items.length && <div className="muted small">Hali xabar yo'q. Har bir xabar o'z vaqtida (efirga yoki zanjirga kirgan paytga nisbatan) yuboriladi.</div>}
      <ol className="fi-items">
        {items.map((m, i) => (
          <li key={m.id} className={m.status === 'draft' ? 'fi-item is-draft' : 'fi-item'}>
            <button type="button" className="fi-item-main" onClick={() => setEdit({ id: m.id, form: toInput(m) })}>
              <span className="fi-item-n">{i + 1}</span>
              <span className="fi-item-text">
                <b>{m.title}</b>
                <span className="muted small">{chainItemWhen(m)}{m.segment !== 'all' ? ` · ${SEGMENT_LABEL[m.segment].replace('X', String(m.segment_minute ?? 'X'))}` : ''}{m.status === 'draft' ? ' · qoralama' : ''}</span>
              </span>
            </button>
            <span className="fi-item-acts">
              <button type="button" className="icon-btn" aria-label="Yuqoriga" disabled={busy || i === 0} onClick={() => void move(i, -1)}>↑</button>
              <button type="button" className="icon-btn" aria-label="Pastga" disabled={busy || i === items.length - 1} onClick={() => void move(i, 1)}>↓</button>
              <button type="button" className="icon-btn" aria-label="O'chirish" onClick={() => void remove(m)}>×</button>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-sm" onClick={() => setEdit({ id: 'new', form: blank(items.reduce((a, m) => Math.max(a, m.sort + 1), 0)) })}>+ Xabar qo'shish</button>
      <div className="muted small">Boshqa bloklardan zanjirning istalgan xabariga chiziq ulash mumkin — lid shu xabardan boshlab oladi, oldingilari yuborilmaydi.</div>
    </div>
  );
}
