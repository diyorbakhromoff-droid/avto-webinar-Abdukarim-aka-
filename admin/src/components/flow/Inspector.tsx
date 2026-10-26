import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/admin';
import type {
  FlowAction, FlowAnchor, FlowCheck, FlowConfig, FlowEdge, FlowMessage, FlowNode, FlowNodeStats, FlowStartEvent,
  FlowTarget, FlowWaitEvent, FunnelSettings, WatchBranch, WatchStats,
} from '../../api/types';
import { useConfirm } from '../../lib/confirm';
import {
  ACTION_LABEL, ANCHOR_LABEL, CHECK_LABEL, DAY_EVENTS, NODE_HINT, NODE_LABEL, START_EVENT_LABEL, WAIT_EVENT_LABEL,
  canReceive, edgeFrom, layout, percent, portLabel,
} from '../../lib/flow';
import { UNIT_LABEL, UNIT_MIN, num, splitOffset, type OffsetUnit } from '../../lib/format';
import { options } from '../../lib/labels';
import { useToast } from '../../lib/toast';
import { cleanButtons } from '../ButtonsEditor';
import { ChainItems } from './ChainItems';
import { MessageFields, contentError, type MessageContent } from './MessageFields';

interface Props {
  fid: number;
  node: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  stats?: FlowNodeStats;
  targets: FlowTarget[];
  settings?: FunnelSettings;
  onSaved: () => void;
  onConnect: (from: number, port: string, to: number, item: number) => void;
  onDeleteEdge: (id: number) => void;
  onDelete: (n: FlowNode) => void;
  onDuplicate: (n: FlowNode) => void;
  onClose: () => void;
}

const newId = () => Math.random().toString(16).slice(2, 8);

function Minutes({ value, onChange, label }: { value: number; onChange: (m: number) => void; label: string }) {
  const [unit, setUnit] = useState<OffsetUnit>(() => splitOffset(value).unit);
  const n = Math.round(value / UNIT_MIN[unit]);
  return (
    <span className="row" style={{ gap: 6 }}>
      <input className="input" style={{ width: 76 }} type="number" min={0} inputMode="numeric" aria-label={label} value={n}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0) * UNIT_MIN[unit])} />
      <select className="select" style={{ width: 'auto' }} aria-label={`${label}: birlik`} value={unit} onChange={(e) => {
        const u = e.target.value as OffsetUnit;
        setUnit(u);
        onChange(n * UNIT_MIN[u]);
      }}>
        {(Object.keys(UNIT_LABEL) as OffsetUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
      </select>
    </span>
  );
}

function DaySelect({ value, onChange }: { value: 1 | 2 | undefined; onChange: (d: 1 | 2) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Qaysi kun">
      {([1, 2] as const).map((d) => (
        <button key={d} type="button" className={(value ?? 1) === d ? 'seg seg-on' : 'seg'} aria-pressed={(value ?? 1) === d} onClick={() => onChange(d)}>{d}-kun</button>
      ))}
    </div>
  );
}

/** Videoning 5 daqiqalik grafigi va shoxchalar chegaralari. */
function WatchMini({ fid, day, branches }: { fid: number; day: 1 | 2; branches: WatchBranch[] }) {
  const [ws, setWs] = useState<WatchStats | null>(null);
  useEffect(() => {
    let alive = true;
    api.watchStats(fid, { day, step: 5 }).then((r) => alive && setWs(r)).catch(() => alive && setWs(null));
    return () => { alive = false; };
  }, [fid, day]);
  if (!ws || !ws.buckets.length) return <div className="muted small">Grafik efir ma'lumotlari yig'ilgach chiqadi.</div>;
  const dur = Math.max(ws.duration_min, 1);
  const cuts = [...new Set(branches.filter((b) => b.kind === 'range' && (b.from_min ?? 0) > 0).map((b) => b.from_min!))];
  return (
    <div className="fi-chart" aria-label={`Har 5 daqiqada efirda qolganlar: ${ws.joined} kirgan`}>
      <div className="fi-chart-head"><span>Har 5 daqiqada efirda qolganlar</span><span>{num(ws.joined)} kirgan</span></div>
      <div className="fi-chart-bars">
        {ws.buckets.map((b) => (
          <span key={b.minute} className="fi-bar" style={{ height: `${Math.max(3, b.share * 100)}%` }} title={`${b.minute}-daqiqa: ${b.viewers} kishi`} />
        ))}
        {cuts.map((m) => (
          <span key={m} className="fi-cut" style={{ left: `${Math.min(100, (m / dur) * 100)}%` }}><span>{m}-daq</span></span>
        ))}
      </div>
      <div className="fi-chart-axis"><span>0</span><span>{Math.round(dur / 2)}</span><span>{dur} daq</span></div>
    </div>
  );
}

function Branches({ value, onChange, maxMin }: { value: WatchBranch[]; onChange: (b: WatchBranch[]) => void; maxMin: number }) {
  const set = (i: number, p: Partial<WatchBranch>) => onChange(value.map((b, j) => (j === i ? { ...b, ...p } : b)));
  return (
    <div className="stack-sm">
      {value.map((b, i) => (
        <div key={b.id} className="fi-branch">
          <input className="input" aria-label={`${i + 1}-shoxcha nomi`} value={b.label} onChange={(e) => set(i, { label: e.target.value })} />
          <div className="row" style={{ gap: 6 }}>
            <select className="select" style={{ width: 'auto' }} aria-label="Shart" value={b.kind} onChange={(e) => set(i, e.target.value === 'not_joined' ? { kind: 'not_joined' } : { kind: 'range', from_min: 0, to_min: null })}>
              <option value="not_joined">Efirga kirmagan</option>
              <option value="range">Ko'rgan daqiqasi</option>
            </select>
            {b.kind === 'range' && (
              <>
                <input className="input" style={{ width: 72 }} type="number" min={0} max={maxMin} aria-label="Daqiqadan" value={b.from_min ?? 0} onChange={(e) => set(i, { from_min: Number(e.target.value) || 0 })} />
                <span className="muted small">dan</span>
                <input className="input" style={{ width: 72 }} type="number" min={1} max={maxMin} aria-label="Daqiqagacha" placeholder="oxiri" value={b.to_min ?? ''} onChange={(e) => set(i, { to_min: e.target.value ? Number(e.target.value) : null })} />
                <span className="muted small">gacha</span>
              </>
            )}
            <button type="button" className="icon-btn" aria-label="Shoxchani o'chirish" disabled={value.length < 2} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
          </div>
        </div>
      ))}
      {value.length < 8 && <button type="button" className="btn btn-sm" onClick={() => onChange([...value, { id: newId(), label: 'Yangi shoxcha', kind: 'range', from_min: 0, to_min: null }])}>+ Shoxcha</button>}
      <div className="muted small">Birinchi mos kelgan shoxcha tanlanadi. Hech biri mos kelmasa — «Boshqa holat».</div>
    </div>
  );
}

/** Har bir chiqish qayerga ulangan — tortib ulamasdan ham tanlash mumkin (telefonda qulay). */
function PortLinks({ node, nodes, edges, onConnect, onDeleteEdge }: Pick<Props, 'node' | 'nodes' | 'edges' | 'onConnect' | 'onDeleteEdge'>) {
  const l = layout(node);
  const ports = [...(l.single ? [l.single] : []), ...l.rows.filter((r) => r.port).map((r) => r.port!)];
  if (!ports.length) return null;
  const choices = nodes.filter((n) => n.id !== node.id && canReceive(n.type));
  return (
    <div className="stack-sm">
      <div className="field"><span>Chiqishlar — qaysi blokka o'tadi</span></div>
      {ports.map((p) => {
        const e = edgeFrom(edges, node.id, p);
        const to = e ? nodes.find((n) => n.id === e.to_node_id) : undefined;
        return (
          <div key={p} className="fi-port">
            <span className="fi-port-name">{portLabel(node, p)}</span>
            <select className="select" aria-label={`«${portLabel(node, p)}» chiqishi`} value={e ? `${e.to_node_id}:${e.to_item}` : ''} onChange={(ev) => {
              if (!ev.target.value) {
                if (e) onDeleteEdge(e.id);
                return;
              }
              const [to2, item] = ev.target.value.split(':').map(Number);
              onConnect(node.id, p, to2, item);
            }}>
              <option value="">— hech qayerga (yo'l tugaydi)</option>
              {choices.map((n) => n.type === 'chain' && n.messages.length
                ? n.messages.map((m, i) => <option key={`${n.id}:${i}`} value={`${n.id}:${i}`}>{n.title} → {i + 1}-xabardan ({m.title})</option>)
                : <option key={n.id} value={`${n.id}:0`}>{NODE_LABEL[n.type]}: {n.title}</option>)}
            </select>
            {to === undefined && e && <span className="small text-danger">blok topilmadi</span>}
          </div>
        );
      })}
    </div>
  );
}

export function Inspector(props: Props) {
  const { fid, node, stats, targets, settings, onSaved, onClose } = props;
  const toast = useToast();
  const confirm = useConfirm();
  const msg = node.type === 'message' ? node.messages[0] as FlowMessage | undefined : undefined;
  const [title, setTitle] = useState(node.title);
  const [cfg, setCfg] = useState<FlowConfig>(node.config);
  const [content, setContent] = useState<MessageContent | null>(msg ? { kind: msg.kind, text: msg.text, media_ids: [...msg.media_ids], buttons: msg.buttons.map((r) => r.map((b) => ({ ...b }))) } : null);
  const [busy, setBusy] = useState(false);

  const base = useMemo(() => JSON.stringify([node.title, node.config, msg ? [msg.kind, msg.text, msg.media_ids, msg.buttons] : null]), [node, msg]);
  // server saqlagan (va me'yorlagan) qiymatlar kelganda — formani yangilaymiz
  useEffect(() => {
    setTitle(node.title);
    setCfg(node.config);
    setContent(msg ? { kind: msg.kind, text: msg.text, media_ids: [...msg.media_ids], buttons: msg.buttons.map((r) => r.map((b) => ({ ...b }))) } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  const dirty = JSON.stringify([title, cfg, content ? [content.kind, content.text, content.media_ids, content.buttons] : null]) !== base;
  const set = (p: Partial<FlowConfig>) => setCfg((c) => ({ ...c, ...p }));
  const d1 = Math.round((settings?.day1_duration_sec ?? 0) / 60);
  const d2 = Math.round((settings?.day2_duration_sec ?? 0) / 60);

  const save = async () => {
    if (content) {
      const err = contentError(content);
      if (err) {
        toast.error(err);
        return;
      }
    }
    setBusy(true);
    try {
      if (msg && content) {
        await api.updateFlowMessage(msg.id, {
          title: title.trim() || 'Xabar', kind: content.kind, text: content.text, media_ids: content.media_ids,
          buttons: cleanButtons(content.buttons), trigger_type: 'flow', trigger_day: null, offset_minutes: 0,
          stuck_step: null, button_key: null, segment: 'all', segment_day: null, segment_minute: null,
          required: false, status: 'active', sort: 0,
        });
      }
      await api.updateNode(node.id, { title: title.trim(), config: cfg });
      toast.success('Saqlandi');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (dirty && !(await confirm({ title: "Saqlanmagan o'zgarishlar", message: 'Blokdagi o\'zgarishlar saqlanmagan. Tashlab ketasizmi?', confirmText: 'Tashlab ketish', danger: true }))) return;
    onClose();
  };

  const test = async () => {
    if (!msg) return;
    if (dirty) {
      toast.info('Avval saqlang — test oxirgi saqlangan variantni yuboradi');
      return;
    }
    try {
      await api.testChain(msg.id);
      toast.success('Test xabar Telegramingizga yuborildi');
    } catch (e) {
      toast.error(e);
    }
  };

  const target = targets.find((t) => t.id === cfg.target_node_id);

  return (
    <aside className="fi" aria-label={`${NODE_LABEL[node.type]} bloki sozlamasi`}>
      <div className="fi-head">
        <div className="row-between">
          <span className={`fi-chip fi-chip-${node.type}`}>{NODE_LABEL[node.type].toUpperCase()}</span>
          <button type="button" className="icon-btn" aria-label="Yopish" onClick={() => void close()}>×</button>
        </div>
        {node.type !== 'note' && (
          <input className="input fi-title" aria-label="Blok nomi" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        )}
        <div className="muted small">{NODE_HINT[node.type]}{stats?.entered ? ` · ${num(stats.entered)} lid o'tdi` : ''}{stats?.here ? ` · hozir ${num(stats.here)}` : ''}</div>
        {node.warnings.length > 0 && <div className="box box-warn small">{node.warnings.join('. ')}</div>}
      </div>

      <div className="fi-body stack">
        {node.type === 'start' && (
          <div className="stack-sm">
            <label className="field field-compact">
              <span>Lid qachon shu bo'limga kiradi</span>
              <select className="select" value={cfg.event ?? ''} onChange={(e) => set({ event: e.target.value as FlowStartEvent, day: DAY_EVENTS.has(e.target.value) ? (cfg.day ?? 1) : undefined })}>
                {options(START_EVENT_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {cfg.event && DAY_EVENTS.has(cfg.event) && <DaySelect value={cfg.day} onChange={(d) => set({ day: d })} />}
            <div className="muted small">Shu bo'limda lid allaqachon yurgan bo'lsa — yo'li qaytadan boshlanadi. Bir bo'limda bir nechta «Boshlanish» bo'lishi mumkin.</div>
          </div>
        )}

        {node.type === 'message' && content && (
          <>
            <MessageFields id={`msg-${node.id}`} value={content} onChange={(p) => setContent((c) => (c ? { ...c, ...p } : c))} allowNext serverWarnings={!dirty ? msg?.warnings : undefined} />
            <div className="fi-box stack-sm">
              <label className="check">
                <input type="checkbox" checked={!!cfg.timeout_minutes} onChange={(e) => set({ timeout_minutes: e.target.checked ? 180 : null })} />
                Hech qaysi tugmani bosmasa — alohida yo'l
              </label>
              {!!cfg.timeout_minutes && (
                <div className="row"><Minutes value={cfg.timeout_minutes} onChange={(m) => set({ timeout_minutes: Math.max(1, m) })} label="Bosmasa — qancha kutadi" /><span className="muted small">dan keyin «Bosmasa» chiqishi</span></div>
              )}
              <div className="muted small">«Bosmasa» faqat «Sxemada keyingi blok» tugmasi bor xabarda ishlaydi.</div>
              <label className="check"><input type="checkbox" checked={!!cfg.paid_ok} onChange={(e) => set({ paid_ok: e.target.checked })} /> To'lov qilganlarga ham yuborilsin</label>
            </div>
            {msg?.stats && (
              <div className="msg-stats">
                <span>Yuborildi: <b>{num(msg.stats.sent)}</b></span>
                <span>Tugma bosildi: <b>{num(msg.stats.clicks)}</b></span>
                <span>Keyin bloklagan: <b>{num(msg.stats.blocked_after)}</b></span>
              </div>
            )}
          </>
        )}

        {node.type === 'wait' && (
          <div className="stack-sm">
            <div className="field"><span>Qancha kutadi</span></div>
            {([
              ['duration', "Ma'lum vaqt"], ['anchor', "Webinar vaqtiga bog'lab"], ['clock', 'Aniq soatgacha'], ['event', 'Biror ish qilguncha'],
            ] as const).map(([mode, label]) => (
              <div key={mode} className={cfg.mode === mode ? 'fi-radio is-on' : 'fi-radio'}>
                <label className="check"><input type="radio" name={`wait-${node.id}`} checked={cfg.mode === mode} onChange={() => set({
                  mode, minutes: mode === 'duration' ? (cfg.minutes || 60) : mode === 'anchor' ? (cfg.minutes ?? 15) : cfg.minutes,
                  anchor: mode === 'anchor' ? (cfg.anchor ?? 'day2_start') : cfg.anchor, direction: mode === 'anchor' ? (cfg.direction ?? 'before') : cfg.direction,
                  clock: mode === 'clock' ? (cfg.clock ?? '10:00') : cfg.clock,
                  event: mode === 'event' ? ((cfg.event as FlowWaitEvent | undefined) ?? 'joined') : cfg.event, max_minutes: mode === 'event' ? (cfg.max_minutes ?? 1440) : cfg.max_minutes,
                })} /> {label}</label>
                {cfg.mode === mode && mode === 'duration' && <Minutes value={cfg.minutes ?? 60} onChange={(m) => set({ minutes: Math.max(1, m) })} label="Kutish" />}
                {cfg.mode === mode && mode === 'anchor' && (
                  <div className="row">
                    <Minutes value={cfg.minutes ?? 0} onChange={(m) => set({ minutes: m })} label="Farq" />
                    <select className="select" style={{ width: 'auto' }} aria-label="Oldin yoki keyin" value={cfg.direction ?? 'before'} onChange={(e) => set({ direction: e.target.value as 'before' | 'after' })}>
                      <option value="before">oldin</option>
                      <option value="after">keyin</option>
                    </select>
                    <select className="select" style={{ width: 'auto' }} aria-label="Qaysi vaqtga" value={cfg.anchor ?? 'day2_start'} onChange={(e) => set({ anchor: e.target.value as FlowAnchor })}>
                      {options(ANCHOR_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <div className="muted small">Har bir lidning o'zi tanlagan efir vaqti bo'yicha. Vaqtni o'zgartirsa — qayta hisoblanadi.</div>
                  </div>
                )}
                {cfg.mode === mode && mode === 'clock' && (
                  <div className="row"><input className="input" style={{ width: 120 }} type="time" aria-label="Soat" value={cfg.clock ?? '10:00'} onChange={(e) => set({ clock: e.target.value })} /><span className="muted small">bugun o'tgan bo'lsa — ertaga</span></div>
                )}
                {cfg.mode === mode && mode === 'event' && (
                  <div className="row">
                    <select className="select" style={{ width: 'auto' }} aria-label="Qaysi ish" value={(cfg.event as string) ?? 'joined'} onChange={(e) => set({ event: e.target.value as FlowWaitEvent })}>
                      {options(WAIT_EVENT_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <span className="muted small">ko'pi bilan</span>
                    <Minutes value={cfg.max_minutes ?? 1440} onChange={(m) => set({ max_minutes: Math.max(1, m) })} label="Eng ko'p kutish" />
                    <div className="muted small">Blokdan ikki chiziq chiqadi: «Bo'ldi» va «Vaqt tugadi».</div>
                  </div>
                )}
              </div>
            ))}
            {cfg.mode !== 'event' && (
              <>
                <label className="check"><input type="checkbox" checked={cfg.quiet !== false} onChange={(e) => set({ quiet: e.target.checked })} /> Tungi tinchlikka (23:00–08:00) tushsa — ertalabgacha kutadi</label>
                <label className="field field-compact">
                  <span>Vaqti allaqachon o'tib ketgan bo'lsa</span>
                  <select className="select" value={cfg.late ?? 'skip'} onChange={(e) => set({ late: e.target.value as 'skip' | 'send' })}>
                    <option value="skip">Keyingi xabarni tashlab o'tish</option>
                    <option value="send">Darhol davom etish</option>
                  </select>
                </label>
              </>
            )}
          </div>
        )}

        {node.type === 'condition' && (
          <div className="stack-sm">
            <div className="field"><span>Nimani tekshiramiz</span></div>
            <div className="chips" role="group" aria-label="Tekshiruv turi">
              {(Object.keys(CHECK_LABEL) as FlowCheck[]).map((c) => (
                <button key={c} type="button" className={cfg.check === c ? 'chip chip-on' : 'chip'} aria-pressed={cfg.check === c} onClick={() => set({
                  check: c, day: c === 'watch' || c === 'joined' ? (cfg.day ?? 1) : undefined,
                  branches: c === 'watch' ? (cfg.branches?.length ? cfg.branches : [
                    { id: newId(), label: 'Umuman kirmadi', kind: 'not_joined' },
                    { id: newId(), label: "Yarmigacha ko'rdi", kind: 'range', from_min: 0, to_min: Math.max(1, Math.round(d1 / 2)) },
                    { id: newId(), label: "Yarmidan ko'p", kind: 'range', from_min: Math.max(1, Math.round(d1 / 2)), to_min: null },
                  ]) : undefined,
                  minutes: c === 'wrote_admin' ? (cfg.minutes ?? 120) : undefined,
                })}>{CHECK_LABEL[c]}</button>
              ))}
            </div>
            {(cfg.check === 'watch' || cfg.check === 'joined') && <DaySelect value={cfg.day} onChange={(d) => set({ day: d })} />}
            {cfg.check === 'watch' && (
              <>
                <WatchMini fid={fid} day={cfg.day ?? 1} branches={cfg.branches ?? []} />
                <Branches value={cfg.branches ?? []} onChange={(b) => set({ branches: b })} maxMin={(cfg.day === 2 ? d2 : d1) || 600} />
              </>
            )}
            {cfg.check === 'wrote_admin' && (
              <div className="row"><span className="muted small">Oxirgi</span><Minutes value={cfg.minutes ?? 120} onChange={(m) => set({ minutes: Math.max(1, m) })} label="Oxirgi qancha vaqt" /><span className="muted small">ichida savol yozganmi (bot yoki efir chati)</span></div>
            )}
            {(cfg.check === 'tag' || cfg.check === 'source') && (
              <label className="field field-compact">
                <span>{cfg.check === 'tag' ? 'Teg' : 'Manba (deeplink dagi nom, masalan instagram)'}</span>
                <input className="input" value={cfg.value ?? ''} onChange={(e) => set({ value: e.target.value })} />
              </label>
            )}
            {cfg.check === 'payment' && <div className="muted small">Uchta chiqish: to'lamagan, boshlang'ich to'lagan, to'liq to'lagan.</div>}
            {cfg.check && cfg.check !== 'watch' && cfg.check !== 'payment' && <div className="muted small">Ikki chiqish: «Ha» va «Yo'q».</div>}
          </div>
        )}

        {node.type === 'action' && (
          <div className="stack-sm">
            <label className="field field-compact">
              <span>Nima qilinadi</span>
              <select className="select" value={cfg.action ?? 'reschedule'} onChange={(e) => set({ action: e.target.value as FlowAction })}>
                {options(ACTION_LABEL).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {(cfg.action === 'tag_add' || cfg.action === 'tag_remove') && (
              <label className="field field-compact"><span>Teg</span><input className="input" value={cfg.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="qiziqmaydi" /></label>
            )}
            {cfg.action === 'manager_task' && (
              <label className="field field-compact"><span>Vazifa matni</span><input className="input" value={cfg.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="Qo'ng'iroq qilib, savoliga javob bering" /></label>
            )}
            <div className="muted small">
              {cfg.action === 'reschedule' && "Lidga bo'sh efir vaqtlari yuboriladi (1-kun yoki 2-kun — bot o'zi aniqlaydi). Vaqt tanlasa, «Efir vaqtini tanladi» bilan boshlanadigan bo'limlar ishga tushadi."}
              {cfg.action === 'ask' && "Lidga «Savolingizni yozing» yuboriladi; 24 soat ichida yozgan matni savol bo'lib tushadi."}
              {cfg.action === 'cold' && "Lid sovuq segmentga o'tadi — unga faqat ommaviy xabarlar boradi."}
              {cfg.action === 'manager_task' && "Lidga biriktirilgan menejerga Telegram'da eslatma boradi va lid kartasida vazifa paydo bo'ladi."}
            </div>
          </div>
        )}

        {node.type === 'goto' && (
          <div className="stack-sm">
            <label className="field field-compact">
              <span>Qayerga o'tadi</span>
              <select className="select" value={cfg.target_node_id ?? ''} onChange={(e) => set({ target_node_id: e.target.value ? Number(e.target.value) : null, item: 0 })}>
                <option value="">— tanlang</option>
                {[...new Set(targets.map((t) => t.flow_name))].map((fname) => (
                  <optgroup key={fname} label={fname}>
                    {targets.filter((t) => t.flow_name === fname && t.id !== node.id).map((t) => (
                      <option key={t.id} value={t.id}>{NODE_LABEL[t.type]}: {t.title}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {target?.type === 'chain' && (
              <label className="field field-compact">
                <span>Zanjirning qaysi xabaridan boshlaydi</span>
                <select className="select" value={cfg.item ?? 0} onChange={(e) => set({ item: Number(e.target.value) })}>
                  {target.items.map((t, i) => <option key={i} value={i}>{i + 1} · {t}</option>)}
                </select>
              </label>
            )}
            <div className="muted small">Lid o'sha bo'limda avval yurgan bo'lsa — eski yo'li to'xtaydi. Zanjirning oldingi xabarlari yuborilmaydi.</div>
          </div>
        )}

        {node.type === 'chain' && <ChainItems fid={fid} node={node} onSaved={onSaved} />}

        {node.type === 'stop' && (
          <label className="field field-compact">
            <span>Lidga teg qo'yish (ixtiyoriy)</span>
            <input className="input" value={cfg.tag ?? ''} onChange={(e) => set({ tag: e.target.value })} placeholder="qiziqmaydi" />
          </label>
        )}

        {node.type === 'note' && (
          <label className="field">
            <span>Izoh</span>
            <textarea className="textarea" rows={5} value={cfg.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
          </label>
        )}

        <PortLinks {...props} />

        {stats && stats.entered > 0 && layout(node).rows.some((r) => r.port) && (
          <div className="fi-box">
            <div className="field"><span>Qaysi yo'ldan ketdi</span></div>
            <ul className="plain-list small">
              {layout(node).rows.filter((r) => r.port).map((r) => (
                <li key={r.port}>{r.label}: <b>{num(stats.ports[r.port!] ?? 0)}</b> ({percent(stats, r.port!)})</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="fi-foot">
        <div className="row">
          <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => props.onDelete(node)} disabled={busy}>O'chirish</button>
          <button type="button" className="btn btn-ghost" onClick={() => props.onDuplicate(node)} disabled={busy}>Nusxa</button>
          {msg && <button type="button" className="btn btn-ghost" onClick={() => void test()} disabled={busy}>Menga test</button>}
        </div>
        {node.type !== 'chain' || dirty ? (
          <button type="button" className="btn btn-accent" onClick={() => void save()} disabled={busy || !dirty}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
        ) : null}
      </div>
    </aside>
  );
}
