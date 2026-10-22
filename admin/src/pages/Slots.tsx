import { useMemo, useState } from 'react';
import type { FunnelSettings } from '../api/types';
import { NeedFunnel } from '../components/NeedFunnel';
import { SaveBar } from '../components/SaveBar';
import { NumberInput } from '../components/fields';
import { Card, ErrorBox, Loading, PageHead, Warnings } from '../components/ui';
import { slotButtonLabel, slotOptions } from '../lib/slots';
import { fmtDayKey, pad2, todayKey, tzParts, tzToUtc, WEEKDAYS } from '../lib/time';
import { useSettingsForm } from '../lib/useSettings';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SAMPLES: [number, number][] = [[9, 30], [12, 0], [18, 0], [23, 40]];

function SlotTimes({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [t, setT] = useState('');
  const add = () => {
    if (!TIME_RE.test(t) || value.includes(t)) return;
    onChange([...value, t].sort());
    setT('');
  };
  return (
    <div className="stack-sm">
      <div className="chips" aria-label="Slot vaqtlari">
        {value.length === 0 && <span className="muted">Slot yo'q — lidlarga vaqt taklif qilinmaydi.</span>}
        {value.map((s) => (
          <span key={s} className="chip chip-on">
            <span className="tnum">{s}</span>
            <button type="button" className="chip-x" aria-label={`${s} ni o'chirish`} onClick={() => onChange(value.filter((x) => x !== s))}>×</button>
          </span>
        ))}
      </div>
      <div className="inline-form">
        <label className="field" style={{ flex: '0 1 160px' }}>
          <span>Yangi vaqt</span>
          <input className="input" type="time" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        </label>
        <button type="button" className="btn" onClick={add} disabled={!TIME_RE.test(t) || value.includes(t)}>+ Qo'shish</button>
      </div>
    </div>
  );
}

function ExcludedDates({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [d, setD] = useState('');
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || value.includes(d)) return;
    onChange([...value, d].sort());
    setD('');
  };
  const today = todayKey();
  return (
    <div className="stack-sm">
      <div className="chips">
        {value.length === 0 && <span className="muted">Istisno sana yo'q.</span>}
        {value.map((s) => (
          <span key={s} className={s < today ? 'chip' : 'chip chip-on'} title={s < today ? "O'tib ketgan sana" : undefined}>
            {fmtDayKey(s)}
            <button type="button" className="chip-x" aria-label={`${s} ni o'chirish`} onClick={() => onChange(value.filter((x) => x !== s))}>×</button>
          </span>
        ))}
      </div>
      <div className="inline-form">
        <label className="field" style={{ flex: '0 1 200px' }}>
          <span>Sana (bayram va h.k.)</span>
          <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </label>
        <button type="button" className="btn" onClick={add} disabled={!d || value.includes(d)}>+ Qo'shish</button>
      </div>
    </div>
  );
}

function Preview({ s }: { s: FunnelSettings }) {
  const rows = useMemo(() => {
    const p = tzParts(Date.now());
    return SAMPLES.map(([hh, mm]) => {
      const at = tzToUtc(p.y, p.m, p.d, hh, mm);
      const opts = slotOptions(at, s);
      return { at, label: `${WEEKDAYS[tzParts(at).wd]} ${pad2(hh)}:${pad2(mm)}`, opts: opts.map((o) => slotButtonLabel(o, at)) };
    });
  }, [s]);
  return (
    <Card title="Oldindan ko'rish: lid qaysi vaqtlarni ko'radi">
      <div className="muted small">Bugungi sana bo'yicha hisoblangan (N = {s.min_hours_before}, K = {s.options_count}); 2-kun — aniq 24 soatdan keyin. Yakuniy hisobni backend qiladi.</div>
      <div className="table-wrap">
        <table className="table preview-table">
          <thead><tr><th>Lid kirgan vaqt</th><th>1-kun uchun taklif</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.at}>
                <td className="cell-strong">{r.label}</td>
                <td>{r.opts.length ? r.opts.join(', ') : <span className="text-danger">mos vaqt yo'q</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SlotsBody({ fid }: { fid: number }) {
  const form = useSettingsForm(fid);
  const d = form.draft;
  if (form.state.error && !d) return <ErrorBox error={form.state.error} onRetry={form.state.reload} />;
  if (!d) return <Loading />;
  const set = <K extends keyof FunnelSettings>(k: K) => (v: FunnelSettings[K]) => form.patch({ [k]: v } as Partial<FunnelSettings>);

  const toggleDay = (i: number) => set('weekdays')(d.weekdays.includes(i) ? d.weekdays.filter((x) => x !== i) : [...d.weekdays, i].sort());

  const local: string[] = [];
  if (!d.slot_times.length) local.push("Kamida bitta slot vaqti kerak.");
  if (!d.weekdays.length) local.push('Kamida bitta hafta kuni tanlang.');
  const lonely = d.weekdays.filter((w) => !d.weekdays.includes((w + 1) % 7));
  if (lonely.length && d.weekdays.length < 7) {
    local.push(`${lonely.map((w) => WEEKDAYS[w]).join(', ')}: keyingi kuni efir yo'q — bu kunlarda 1-kun taklif qilinmaydi (2-kun 24 soatdan keyin bo'lishi kerak).`);
  }
  if (d.day1_duration_sec > 0 && d.late_entry_minutes * 60 > d.day1_duration_sec * 0.25) {
    local.push(`L = ${d.late_entry_minutes} daq 1-kun videosining 25% idan oshadi — kech kirgan lid 75% ga yeta olmaydi.`);
  }
  if (!TIME_RE.test(d.quiet_start) || !TIME_RE.test(d.quiet_end)) local.push('Tungi tinchlik vaqtlarini HH:MM formatida kiriting.');

  return (
    <>
      <div className="cols">
        <div className="col-3 stack">
          <Card title="Efir vaqtlari (Asia/Tashkent)">
            <SlotTimes value={d.slot_times} onChange={set('slot_times')} />
          </Card>
          <Card title="Hafta kunlari">
            <div className="weekday-grid">
              {WEEKDAYS.map((w, i) => (
                <label key={w} className="check">
                  <input type="checkbox" checked={d.weekdays.includes(i)} onChange={() => toggleDay(i)} />
                  {w}
                </label>
              ))}
            </div>
          </Card>
          <Card title="Istisno sanalar">
            <ExcludedDates value={d.excluded_dates} onChange={set('excluded_dates')} />
          </Card>
        </div>
        <div className="col-2 stack">
          <Card title="Qoidalar">
            <div className="grid-2">
              <label className="field"><span>N — kamida necha soat oldin</span><NumberInput value={d.min_hours_before} min={0} max={168} onChange={set('min_hours_before')} suffix="soat" /></label>
              <label className="field"><span>K — variantlar soni</span><NumberInput value={d.options_count} min={1} max={6} onChange={set('options_count')} /></label>
              <label className="field"><span>L — kech kirish</span><NumberInput value={d.late_entry_minutes} min={0} max={120} onChange={set('late_entry_minutes')} suffix="daq" /></label>
              <label className="field"><span>Qayta tanlash limiti</span><NumberInput value={d.reschedule_limit} min={0} max={10} onChange={set('reschedule_limit')} suffix="har kun" /></label>
              <label className="field">
                <span>1-kun «ko'rdi» chegarasi</span>
                <NumberInput value={Math.round(d.day1_watch_threshold * 100)} min={1} max={100} onChange={(n) => set('day1_watch_threshold')(Math.min(100, Math.max(1, n)) / 100)} suffix="%" />
              </label>
            </div>
          </Card>
          <Card title="Tungi tinchlik">
            <div className="muted small">Shu oraliqqa tushgan xabarlar tugash vaqtiga suriladi.</div>
            <div className="grid-2">
              <label className="field"><span>Boshlanishi</span><input className="input" type="time" value={d.quiet_start} onChange={(e) => set('quiet_start')(e.target.value)} /></label>
              <label className="field"><span>Tugashi</span><input className="input" type="time" value={d.quiet_end} onChange={(e) => set('quiet_end')(e.target.value)} /></label>
            </div>
          </Card>
          <Card title="To'xtab qolish chegaralari">
            <div className="muted small">Shu vaqtdan keyin lid «to'xtagan» hisoblanadi: bot eslatma yuboradi, keyin lid qo'ng'iroq ro'yxatiga tushadi.</div>
            <div className="grid-2">
              <label className="field"><span>Telefon bermadi</span><NumberInput value={d.stuck_no_phone_min} min={1} onChange={set('stuck_no_phone_min')} suffix="daq" /></label>
              <label className="field"><span>Sessiya tanlamadi</span><NumberInput value={d.stuck_no_session_min} min={1} onChange={set('stuck_no_session_min')} suffix="daq" /></label>
              <label className="field"><span>Tugma bosdi, chek yo'q</span><NumberInput value={d.stuck_no_receipt_min} min={1} onChange={set('stuck_no_receipt_min')} suffix="daq" /></label>
            </div>
          </Card>
        </div>
      </div>
      <Preview s={d} />
      {/* Tahrir paytida — mahalliy tekshiruv; saqlangandan keyin — server ogohlantirishlari */}
      <Warnings items={form.dirty || !form.warnings.length ? local : []} />
      <Warnings items={form.dirty ? [] : form.warnings} />
      <SaveBar dirty={form.dirty} saving={form.saving} onReset={form.reset} onSave={() => void form.save()} disabled={!d.slot_times.length || !d.weekdays.length} />
    </>
  );
}

export default function Slots() {
  return (
    <>
      <PageHead title="Slotlar" sub="Lid faqat 1-kun vaqtini tanlaydi; 2-kun har doim aniq 24 soatdan keyin." />
      <NeedFunnel>{(f) => <SlotsBody key={f.id} fid={f.id} />}</NeedFunnel>
    </>
  );
}
