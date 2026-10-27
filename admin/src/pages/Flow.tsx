import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/admin';
import type { FlowEdge, FlowGraph, FlowImportPhase, FlowNode, FlowNodeType, FlowSection } from '../api/types';
import { FlowCanvas, type CanvasApi, type Selection } from '../components/flow/FlowCanvas';
import { Inspector } from '../components/flow/Inspector';
import { Modal } from '../components/Modal';
import { TestSendModal } from '../components/TestSendModal';
import { Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { NODE_HINT, NODE_LABEL, PALETTE } from '../lib/flow';
import { num } from '../lib/format';
import { fmtDateTime } from '../lib/time';
import { useToast } from '../lib/toast';
import { useLoad } from '../lib/useLoad';

const PHASES: { key: FlowImportPhase; title: string }[] = [
  { key: 'reg', title: "Ro'yxat" },
  { key: 'day1', title: '1-kun' },
  { key: 'between', title: 'Kunlar orasi' },
  { key: 'day2', title: '2-kun' },
  { key: 'after', title: '2-kundan keyin' },
];

type NewKind = 'empty' | 'example' | 'import';

function NewSectionForm({ fid, onCreated, onCancel, inline }: { fid: number; onCreated: (f: FlowSection) => void; onCancel?: () => void; inline?: boolean }) {
  const toast = useToast();
  const [kind, setKind] = useState<NewKind>('example');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<FlowImportPhase>('day2');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      if (kind === 'empty') {
        if (!name.trim()) {
          toast.error("Bo'lim nomini kiriting");
          return;
        }
        onCreated(await api.createFlow(fid, name.trim()));
      } else if (kind === 'example') {
        onCreated(await api.createExampleFlow(fid));
        toast.success("Namuna qoralama holida qo'shildi — matnlarni o'zgartirib, faollashtiring");
      } else {
        const r = await api.importFlow(fid, phase);
        toast.success(`${r.moved_messages} ta xabar ko'chirildi${r.moved_leads ? `, ${r.moved_leads} ta lid shu zanjirda davom etadi` : ''}`);
        onCreated(r);
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="fnew" role="radiogroup" aria-label="Yangi bo'lim turi">
        <label className={kind === 'example' ? 'fnew-opt is-on' : 'fnew-opt'}>
          <input type="radio" name="fnew" checked={kind === 'example'} onChange={() => setKind('example')} />
          <span><b>Namuna: «1-kundan keyin»</b><span className="muted small">Videoni ko'rmaganlar, yarmigacha va ko'proq ko'rganlar uchun alohida yo'llar, tugmalar va «bosmasa». Qoralama bo'lib qo'shiladi.</span></span>
        </label>
        <label className={kind === 'import' ? 'fnew-opt is-on' : 'fnew-opt'}>
          <input type="radio" name="fnew" checked={kind === 'import'} onChange={() => setKind('import')} />
          <span><b>«Kunlar bo'yicha» ustunini ko'chirish</b><span className="muted small">Ustundagi xabarlar sxemaga «Zanjir» bo'lib o'tadi — keyin istalgan xabaridan ulash mumkin. Yuborilgan va rejalashtirilgan xabarlar takrorlanmaydi.</span></span>
        </label>
        {kind === 'import' && (
          <div className="segmented" role="group" aria-label="Qaysi ustun">
            {PHASES.map((p) => <button key={p.key} type="button" className={phase === p.key ? 'seg seg-on' : 'seg'} aria-pressed={phase === p.key} onClick={() => setPhase(p.key)}>{p.title}</button>)}
          </div>
        )}
        <label className={kind === 'empty' ? 'fnew-opt is-on' : 'fnew-opt'}>
          <input type="radio" name="fnew" checked={kind === 'empty'} onChange={() => setKind('empty')} />
          <span><b>Bo'sh bo'lim</b><span className="muted small">Faqat «Boshlanish» bloki bilan.</span></span>
        </label>
        {kind === 'empty' && <input className="input" aria-label="Bo'lim nomi" placeholder="Masalan: Chek yubormaganlar" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />}
      </div>
      <div className={inline ? 'row' : 'row-end'}>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Bekor qilish</button>}
        <button type="button" className="btn btn-accent" onClick={() => void create()} disabled={busy}>{busy ? 'Yaratilmoqda…' : "Bo'lim yaratish"}</button>
      </div>
    </div>
  );
}

function RenameModal({ open, flow, onClose, onSaved }: { open: boolean; flow: FlowSection | undefined; onClose: () => void; onSaved: (f: FlowSection) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  useEffect(() => setName(flow?.name ?? ''), [flow, open]);
  const save = async () => {
    if (!flow || !name.trim()) return;
    try {
      onSaved(await api.updateFlow(flow.id, { name: name.trim() }));
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Bo'lim nomi" size="sm" footer={<>
      <button type="button" className="btn" onClick={onClose}>Bekor qilish</button>
      <button type="button" className="btn btn-accent" onClick={() => void save()} disabled={!name.trim()}>Saqlash</button>
    </>}>
      <input className="input" aria-label="Bo'lim nomi" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
    </Modal>
  );
}

export function FlowBody({ fid }: { fid: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const flows = useLoad(() => api.flows(fid), [fid]);
  const settings = useLoad(() => api.settings(fid), [fid]);
  const [days, setDays] = useState(7);
  const [showStats, setShowStats] = useState(true);
  const [sel, setSel] = useState<Selection>(null);
  const [ver, setVer] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const apiRef = useRef<CanvasApi | null>(null);

  const list = flows.data ?? [];
  const wanted = Number(params.get('bolim')) || null;
  const current = list.find((f) => f.id === wanted) ?? list[0];
  const graph = useLoad<FlowGraph>(current ? () => api.flowGraph(current.id, days) : null, [current?.id, days]);
  const targets = useLoad(() => api.flowTargets(fid), [fid, ver]);
  const targetMap = useMemo(() => new Map((targets.data ?? []).map((t) => [t.id, t])), [targets.data]);

  const g = graph.data && graph.data.flow.id === current?.id ? graph.data : undefined;
  const selected = sel?.kind === 'node' ? g?.nodes.find((n) => n.id === sel.id) : undefined;

  const refresh = useCallback(async () => {
    await Promise.all([graph.reload(), flows.reload()]);
    setVer((v) => v + 1);
  }, [graph, flows]);

  const patchGraph = (fn: (g: FlowGraph) => FlowGraph) => graph.setData((x) => (x ? fn(x) : x));

  const openSection = (id: number) => {
    setSel(null);
    setParams({ bolim: String(id) });
  };

  const addNode = async (type: FlowNodeType) => {
    if (!current) return;
    const c = apiRef.current?.center() ?? { x: 100, y: 100 };
    try {
      const n = await api.createNode(current.id, { type, x: c.x, y: c.y });
      patchGraph((x) => ({ ...x, nodes: [...x.nodes, n] }));
      setSel({ kind: 'node', id: n.id });
      setVer((v) => v + 1);
    } catch (e) {
      toast.error(e);
    }
  };

  const moveNode = (id: number, x: number, y: number) => {
    patchGraph((gr) => ({ ...gr, nodes: gr.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
    api.updateNode(id, { x, y }).catch((e) => {
      toast.error(e);
      void graph.reload();
    });
  };

  const connect = async (from: number, port: string, to: number, item: number) => {
    if (!current) return;
    try {
      const e = await api.createEdge(current.id, { from_node_id: from, from_port: port, to_node_id: to, to_item: item });
      patchGraph((x) => ({ ...x, edges: [...x.edges.filter((o) => !(o.from_node_id === from && o.from_port === port)), e] }));
    } catch (err) {
      toast.error(err);
    }
  };

  const deleteEdge = async (id: number) => {
    try {
      await api.deleteEdge(id);
      patchGraph((x) => ({ ...x, edges: x.edges.filter((e: FlowEdge) => e.id !== id) }));
      setSel((s) => (s?.kind === 'edge' && s.id === id ? null : s));
    } catch (e) {
      toast.error(e);
    }
  };

  const deleteNode = async (n: FlowNode) => {
    const here = g?.stats[String(n.id)]?.here ?? 0;
    const ok = await confirm({
      title: "Blokni o'chirish",
      message: `«${n.title}» va unga ulangan chiziqlar o'chiriladi.${here ? ` Hozir shu blokda turgan ${here} ta lidning yo'li to'xtaydi.` : ''}`,
      confirmText: "O'chirish", danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteNode(n.id);
      setSel(null);
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const duplicateNode = async (n: FlowNode) => {
    try {
      const copy = await api.duplicateNode(n.id);
      patchGraph((x) => ({ ...x, nodes: [...x.nodes, copy] }));
      setSel({ kind: 'node', id: copy.id });
      setVer((v) => v + 1);
    } catch (e) {
      toast.error(e);
    }
  };

  const toggleStatus = async () => {
    if (!current) return;
    const next = current.status === 'active' ? 'draft' : 'active';
    if (next === 'draft' && current.active_leads > 0 && !(await confirm({
      title: "Bo'limni qoralamaga o'tkazish",
      message: `Hozir bu bo'limda ${current.active_leads} ta lid yuribdi — ularning yo'li to'xtaydi va rejalashtirilgan xabarlari bekor qilinadi.`,
      confirmText: "Qoralamaga o'tkazish", danger: true,
    }))) return;
    try {
      await api.updateFlow(current.id, { status: next });
      toast.success(next === 'active' ? "Bo'lim faol — yangi lidlar shu sxema bo'yicha yuradi" : "Bo'lim qoralamada");
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const deleteFlow = async () => {
    if (!current) return;
    const ok = await confirm({
      title: "Bo'limni o'chirish",
      message: `«${current.name}» bo'limi, undagi barcha bloklar va xabarlar o'chiriladi.${current.active_leads ? ` ${current.active_leads} ta lidning yo'li to'xtaydi.` : ''} Buni qaytarib bo'lmaydi.`,
      confirmText: "O'chirish", danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteFlow(current.id);
      setSel(null);
      setParams({});
      await flows.reload();
      setVer((v) => v + 1);
    } catch (e) {
      toast.error(e);
    }
  };

  const created = async (f: FlowSection) => {
    setNewOpen(false);
    await flows.reload();
    setVer((v) => v + 1);
    openSection(f.id);
  };

  // Delete — tanlangan chiziq yoki blokni o'chirish; Escape — tanlovni bekor qilish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('.modal'))) return;
      if (e.key === 'Escape') setSel(null);
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (sel?.kind === 'edge') void deleteEdge(sel.id);
      else if (selected && !t?.closest('.fi')) void deleteNode(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (flows.error && !flows.data) return <ErrorBox error={flows.error} onRetry={flows.reload} />;
  if (!flows.data) return <Loading />;

  if (!list.length) {
    return (
      <>
        <PageHead title="Progrev sxemasi" sub="Bloklar va chiziqlar: kimga, qachon va qaysi xabar boradi" />
        <div className="card stack" style={{ maxWidth: 760 }}>
          <div className="stack-sm">
            <h2 className="card-title">Birinchi bo'limni yarating</h2>
            <div className="muted">
              Sxemada har bir bo'lim alohida varaq: «Boshlanish» (masalan, 1-kun tugadi) → shart (videoni qancha ko'rdi) → xabarlar va tugmalar.
              Har bir tugmadan, «bosmasa» holatidan va shart javobidan alohida chiziq chiqadi. «Kunlar bo'yicha» zanjiri esa avvalgidek ishlashda davom etadi.
            </div>
          </div>
          <NewSectionForm fid={fid} onCreated={(f) => void created(f)} inline />
        </div>
      </>
    );
  }

  const st = (n: number) => g?.stats[String(n)];

  return (
    <>
      <PageHead
        title="Progrev sxemasi"
        sub={current ? `${current.name} · ${current.status === 'active' ? 'faol' : 'qoralama'}${current.updated_by ? ` · oxirgi o'zgarish: ${current.updated_by}, ${fmtDateTime(current.updated_at)}` : ''}` : ''}
        actions={current && (
          <>
            <button type="button" className="btn" onClick={() => setTestOpen(true)} title="Bo'limdagi barcha xabarlar chiziqlar tartibida test chatiga yoki o'zingizga">🧪 Bo'limni testga yuborish</button>
            <button type="button" className="btn btn-ghost" onClick={() => setRenameOpen(true)}>Nomini o'zgartirish</button>
            <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => void deleteFlow()}>O'chirish</button>
            <button type="button" className={current.status === 'active' ? 'btn' : 'btn btn-primary'} onClick={() => void toggleStatus()}>
              {current.status === 'active' ? "Qoralamaga o'tkazish" : 'Faollashtirish'}
            </button>
          </>
        )}
      />

      <div className="fsec">
        <div className="fsec-list" role="tablist" aria-label="Bo'limlar">
          {list.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={f.id === current?.id} className={f.id === current?.id ? 'chip chip-on' : 'chip'} onClick={() => openSection(f.id)}>
              <span className={f.status === 'active' ? 'fsec-dot is-on' : 'fsec-dot'} aria-hidden="true" />
              {f.name}
              {f.active_leads > 0 && <span className="chip-n" title="Hozir shu bo'limda yurgan lidlar">{num(f.active_leads)}</span>}
            </button>
          ))}
          <button type="button" className="chip chip-more" onClick={() => setNewOpen(true)}>+ Bo'lim</button>
        </div>
        <div className="row">
          <label className="check small"><input type="checkbox" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} /> Statistika</label>
          <select className="select" style={{ width: 'auto' }} aria-label="Statistika davri" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={!showStats}>
            <option value={1}>Bugun</option>
            <option value={7}>Oxirgi 7 kun</option>
            <option value={30}>Oxirgi 30 kun</option>
            <option value={365}>Hammasi</option>
          </select>
        </div>
      </div>

      {current?.status === 'draft' && (
        <div className="box box-warn small">Bu bo'lim qoralamada — lidlar unga hali kirmaydi. Sxemani tekshirib, «Faollashtirish»ni bosing.</div>
      )}

      <div className={selected ? 'fe has-inspector' : 'fe'}>
        <nav className="fe-tools" aria-label="Blok qo'shish">
          <span className="fe-tools-title">QO'SHISH</span>
          {PALETTE.map((t) => (
            <button key={t} type="button" className="fe-tool" title={NODE_HINT[t]} onClick={() => void addNode(t)} disabled={!current}>
              <span className={`fe-tool-ico fn-ico-${t}`} aria-hidden="true" />
              {NODE_LABEL[t]}
            </button>
          ))}
        </nav>
        <div className="fe-canvas">
          {graph.error && !g ? <ErrorBox error={graph.error} onRetry={graph.reload} /> : !g ? <Loading /> : (
            <FlowCanvas
              key={g.flow.id}
              nodes={g.nodes}
              edges={g.edges}
              stats={g.stats}
              showStats={showStats}
              targets={targetMap}
              selection={sel}
              onSelect={setSel}
              onMove={moveNode}
              onConnect={(a, p, b, i) => void connect(a, p, b, i)}
              onDeleteEdge={(id) => void deleteEdge(id)}
              apiRef={apiRef}
            />
          )}
        </div>
        {selected && g && current && (
          <Inspector
            key={selected.id}
            fid={fid}
            node={selected}
            nodes={g.nodes}
            edges={g.edges}
            stats={st(selected.id)}
            targets={targets.data ?? []}
            settings={settings.data}
            onSaved={() => void refresh()}
            onConnect={(a, p, b, i) => void connect(a, p, b, i)}
            onDeleteEdge={(id) => void deleteEdge(id)}
            onDelete={(n) => void deleteNode(n)}
            onDuplicate={(n) => void duplicateNode(n)}
            onClose={() => setSel(null)}
          />
        )}
      </div>
      <div className="muted small">
        Blokni bosing — sozlamasi o'ngda ochiladi. Blokning o'ng chetidagi nuqtadan tortib boshqa blokka ulang (zanjirda — kerakli xabar qatoriga).
        Ctrl + g'ildirak — kattalashtirish, sichqonchani bosib turib — surish, Delete — tanlangan chiziq yoki blokni o'chirish.
      </div>
      {g && !g.nodes.length && <Empty title="Bo'lim bo'sh">Chapdagi paneldan «Boshlanish» blokini qo'shing.</Empty>}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Yangi bo'lim" size="md">
        <NewSectionForm fid={fid} onCreated={(f) => void created(f)} onCancel={() => setNewOpen(false)} />
      </Modal>
      <RenameModal open={renameOpen} flow={current} onClose={() => setRenameOpen(false)} onSaved={() => void flows.reload()} />
      {current && <TestSendModal open={testOpen} many title={`Sxema: ${current.name}`} onClose={() => setTestOpen(false)}
        send={(r) => api.testProgrev(fid, { ...r, flow_id: current.id })} />}
    </>
  );
}
