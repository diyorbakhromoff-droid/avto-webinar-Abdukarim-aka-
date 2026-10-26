import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import type { FlowEdge, FlowNode, FlowNodeStats, FlowTarget } from '../../api/types';
import {
  INPUT_Y, NODE_LABEL, bounds, canReceive, edgePath, edgeTone, inPoint, layout, nodeSub, outPoint, percent, plain,
  type NodeLayout,
} from '../../lib/flow';

export type Selection = { kind: 'node'; id: number } | { kind: 'edge'; id: number } | null;

export interface CanvasApi {
  /** Ko'rinib turgan maydon markazi (yangi blok shu yerga qo'yiladi). */
  center: () => { x: number; y: number };
  fit: () => void;
}

interface Props {
  nodes: FlowNode[];
  edges: FlowEdge[];
  stats: Record<string, FlowNodeStats>;
  showStats: boolean;
  targets: Map<number, FlowTarget>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onMove: (id: number, x: number, y: number) => void;
  onConnect: (from: number, port: string, to: number, item: number) => void;
  onDeleteEdge: (id: number) => void;
  apiRef: MutableRefObject<CanvasApi | null>;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'node'; id: number; sx: number; sy: number; nx: number; ny: number; cx: number; cy: number; moved: boolean }
  | { kind: 'link'; from: number; port: string; x: number; y: number };

const MIN_K = 0.3;
const MAX_K = 1.6;
const GRID = 10;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const snap = (v: number) => Math.round(v / GRID) * GRID;

export function FlowCanvas({ nodes, edges, stats, showStats, targets, selection, onSelect, onMove, onConnect, onDeleteEdge, apiRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const [moving, setMoving] = useState<{ id: number; x: number; y: number } | null>(null);
  const [link, setLink] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const placed = useMemo(() => nodes.map((n) => (moving && moving.id === n.id ? { ...n, x: moving.x, y: moving.y } : n)), [nodes, moving]);
  const layouts = useMemo(() => new Map<number, NodeLayout>(placed.map((n) => [n.id, layout(n)])), [placed]);
  const byId = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);

  const toWorld = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const fit = () => {
    const el = wrapRef.current;
    const b = bounds(nodes);
    if (!el || !b) return;
    const pad = 48;
    const k = clampK(Math.min((el.clientWidth - pad * 2) / b.w, (el.clientHeight - pad * 2) / b.h, 1));
    setView({ k, x: (el.clientWidth - b.w * k) / 2 - b.x * k, y: Math.max(pad, (el.clientHeight - b.h * k) / 2) - b.y * k });
  };

  apiRef.current = {
    center: () => {
      const el = wrapRef.current;
      if (!el) return { x: 0, y: 0 };
      const v = viewRef.current;
      return { x: snap((el.clientWidth / 2 - v.x) / v.k - 120), y: snap((el.clientHeight / 2 - v.y) / v.k - 40) };
    },
    fit,
  };

  // birinchi ochilganda — hammasini ko'rsatish
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (!fitted.current && nodes.length) {
      fitted.current = true;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  // g'ildirak: Ctrl/⌘ bilan — masshtab, aks holda — surish (sichqoncha va trekpad)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const k = clampK(v.k * Math.exp(-e.deltaY * 0.01));
        const px = e.clientX - r.left, py = e.clientY - r.top;
        setView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k });
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (f: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const v = viewRef.current;
    const k = clampK(v.k * f);
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    setView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k });
  };

  const capture = (e: RPointerEvent) => {
    try {
      wrapRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ba'zi brauzerlarda kerak emas */
    }
  };

  const onBgDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    capture(e);
  };

  const onNodeDown = (e: RPointerEvent, n: FlowNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y, cx: n.x, cy: n.y, moved: false };
    capture(e);
  };

  const onPortDown = (e: RPointerEvent, n: FlowNode, port: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = outPoint(n, layouts.get(n.id)!, port);
    if (!p) return;
    drag.current = { kind: 'link', from: n.id, port, x: p.x, y: p.y };
    setLink({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    capture(e);
  };

  const onMoveEvt = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    } else if (d.kind === 'node') {
      const k = viewRef.current.k;
      const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) {
        d.cx = snap(d.nx + dx);
        d.cy = snap(d.ny + dy);
        setMoving({ id: d.id, x: d.cx, y: d.cy });
      }
    } else {
      const w = toWorld(e.clientX, e.clientY);
      setLink({ x1: d.x, y1: d.y, x2: w.x, y2: w.y });
    }
  };

  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan') {
      if (!d.moved) onSelect(null);
    } else if (d.kind === 'node') {
      if (d.moved) onMove(d.id, d.cx, d.cy);
      else onSelect({ kind: 'node', id: d.id });
      setMoving(null);
    } else {
      setLink(null);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest<HTMLElement>('[data-node-id]');
      if (!target) return;
      const to = Number(target.dataset.nodeId);
      const itemEl = el?.closest<HTMLElement>('[data-item]');
      const toNode = byId.get(to);
      if (!toNode || to === d.from || !canReceive(toNode.type)) return;
      onConnect(d.from, d.port, to, itemEl ? Number(itemEl.dataset.item) : 0);
    }
  };

  const selectedEdge = selection?.kind === 'edge' ? edges.find((x) => x.id === selection.id) : undefined;

  const edgeGeom = (e: FlowEdge) => {
    const a = byId.get(e.from_node_id), b = byId.get(e.to_node_id);
    if (!a || !b) return null;
    const p1 = outPoint(a, layouts.get(a.id)!, e.from_port);
    if (!p1) return null;
    const p2 = inPoint(b, layouts.get(b.id)!, e.to_item);
    return { p1, p2, d: edgePath(p1, { x: p2.x - 6, y: p2.y }) };
  };

  return (
    <div
      ref={wrapRef}
      className="fc-wrap"
      onPointerDown={onBgDown}
      onPointerMove={onMoveEvt}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${22 * view.k}px ${22 * view.k}px` }}
    >
      <div className="fc-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="fc-edges" width="1" height="1" aria-hidden="true">
          <defs>
            {(['plain', 'branch', 'timeout', 'sel'] as const).map((t) => (
              <marker key={t} id={`fc-arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={`fc-arrow fc-arrow-${t}`} />
              </marker>
            ))}
          </defs>
          {edges.map((e) => {
            const g = edgeGeom(e);
            if (!g) return null;
            const tone = edgeTone(e.from_port);
            const sel = selectedEdge?.id === e.id;
            return (
              <g key={e.id}>
                <path className={`fc-edge fc-edge-${tone}${sel ? ' is-sel' : ''}`} d={g.d} markerEnd={`url(#fc-arrow-${sel ? 'sel' : tone})`} />
                <path
                  className="fc-edge-hit"
                  d={g.d}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => onSelect({ kind: 'edge', id: e.id })}
                />
              </g>
            );
          })}
          {link && <path className="fc-edge fc-edge-temp" d={edgePath({ x: link.x1, y: link.y1 }, { x: link.x2, y: link.y2 })} />}
        </svg>

        {placed.map((n) => {
          const l = layouts.get(n.id)!;
          const st = stats[String(n.id)];
          const sel = selection?.kind === 'node' && selection.id === n.id;
          const m = n.type === 'message' ? n.messages[0] : undefined;
          const draft = n.type === 'message' && m?.status === 'draft';
          return (
            <div
              key={n.id}
              data-node-id={n.id}
              className={`fn fn-${n.type}${sel ? ' is-sel' : ''}${draft ? ' is-draft' : ''}`}
              style={{ left: n.x, top: n.y, width: l.w, height: l.h }}
              onPointerDown={(e) => onNodeDown(e, n)}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              aria-label={`${NODE_LABEL[n.type]}: ${n.title}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect({ kind: 'node', id: n.id });
                }
              }}
            >
              <div className="fn-label">
                <span>{NODE_LABEL[n.type].toUpperCase()}{showStats && st?.entered ? ` · ${st.entered}` : ''}</span>
                {n.warnings.length > 0 && <span className="fn-warn" title={n.warnings.join('\n')}>!</span>}
              </div>
              {n.type === 'note' ? (
                <div className="fn-note-text">{n.config.text || 'Izoh yozing…'}</div>
              ) : (
                <>
                  <div className="fn-title" title={n.title}>{n.title}</div>
                  {n.type === 'message' ? (
                    <div className="fn-preview">{m && (m.text || m.media_ids.length) ? plain(m.text) || `[${m.kind}]` : 'Matn yozilmagan'}</div>
                  ) : (
                    <div className="fn-sub" title={nodeSub(n, targets)}>{nodeSub(n, targets)}</div>
                  )}
                </>
              )}

              {l.rows.map((r, i) => {
                const pct = showStats && r.port ? percent(st, r.port) : null;
                return (
                  <div
                    key={i}
                    className={`fn-row fn-row-${r.tone}`}
                    style={{ top: r.y, height: r.h }}
                    {...(r.item !== undefined ? { 'data-item': r.item } : {})}
                  >
                    <span className="fn-row-label">{r.label}</span>
                    {pct ? <span className="fn-row-right">{pct}</span> : r.right ? <span className="fn-row-right">{r.right}</span> : null}
                  </div>
                );
              })}

              {showStats && st && st.here > 0 && <div className="fn-here" title="Hozir shu blokda kutayotganlar">Hozir: {st.here}</div>}

              {l.hasInput && <span className="fn-in" style={{ top: INPUT_Y - 5 }} aria-hidden="true" />}
              {l.inputs.map((i) => <span key={i.item} className="fn-in fn-in-item" style={{ top: i.y - 5 }} aria-hidden="true" />)}

              {[...(l.single ? [{ port: l.single, y: l.h / 2 }] : []), ...l.rows.filter((r) => r.port).map((r) => ({ port: r.port!, y: r.y + r.h / 2 }))].map((p) => (
                <span
                  key={p.port}
                  className={`fn-out fn-out-${edgeTone(p.port)}${edges.some((e) => e.from_node_id === n.id && e.from_port === p.port) ? ' is-linked' : ''}`}
                  style={{ top: p.y - 7 }}
                  title="Tortib, boshqa blokka ulang"
                  onPointerDown={(e) => onPortDown(e, n, p.port)}
                />
              ))}
            </div>
          );
        })}

        {selectedEdge && (() => {
          const g = edgeGeom(selectedEdge);
          if (!g) return null;
          return (
            <button
              type="button"
              className="fc-edge-del"
              style={{ left: (g.p1.x + g.p2.x) / 2 - 14, top: (g.p1.y + g.p2.y) / 2 - 14 }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onDeleteEdge(selectedEdge.id)}
              aria-label="Chiziqni o'chirish"
              title="Chiziqni o'chirish (Delete)"
            >×</button>
          );
        })()}
      </div>

      <div className="fc-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn" aria-label="Kichraytirish" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <span className="fc-zoom-val tnum">{Math.round(view.k * 100)}%</span>
        <button type="button" className="icon-btn" aria-label="Kattalashtirish" onClick={() => zoomBy(1.2)}>+</button>
        <button type="button" className="btn btn-sm" onClick={fit}>Hammasi</button>
      </div>
      {!nodes.length && <div className="fc-empty">Chapdagi paneldan blok qo'shing</div>}
    </div>
  );
}
