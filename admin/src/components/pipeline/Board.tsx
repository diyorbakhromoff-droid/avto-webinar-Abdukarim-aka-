import { useEffect, useRef, useState } from 'react';
import { api, type LeadsFilter } from '../../api/admin';
import type { PipelineCard, PipelineColumn, PipelineStage, StageInput } from '../../api/types';
import { money, sinceLabel } from '../../lib/format';
import { STAGE_COLOR, initials, stepTone } from '../../lib/pipeline';
import { fmtDateTime } from '../../lib/time';
import { useToast } from '../../lib/toast';
import { useLoad } from '../../lib/useLoad';
import { Badge, ErrorBox, Loading } from '../ui';
import { StageModal, needsDetails } from './Stage';

const REFRESH_MS = 60_000;

function LeadTile({ card, dragging, onOpen, onDragStart, onDragEnd }: {
  card: PipelineCard;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const late = !!card.callback_at && Date.parse(card.callback_at) < Date.now();
  return (
    <div
      className={dragging ? 'pl-card pl-card-drag' : 'pl-card'}
      draggable
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(card.id)); onDragStart(); }}
      onDragEnd={onDragEnd}
    >
      <div className="pl-card-top">
        <span className="pl-name">{card.name || 'Ismsiz'}</span>
        <span className="pl-since" title={`Bosqichda: ${fmtDateTime(card.stage_at)}`}>{sinceLabel(card.stage_at)}</span>
      </div>
      {card.phone && <div className="pl-phone tnum">{card.phone}</div>}
      <div className="row" style={{ gap: 4 }}>
        <Badge tone={stepTone(card.step)} title="Avtovoronkadagi qadam">{card.step_label}</Badge>
        {card.blocked && <Badge tone="danger">bloklagan</Badge>}
      </div>
      {card.callback_at && (
        <div className={late ? 'pl-call pl-call-late' : 'pl-call'}>Qo'ng'iroq: {fmtDateTime(card.callback_at)}{late ? " · o'tib ketdi" : ''}</div>
      )}
      {card.paid > 0 && <div className="pl-paid">{money(card.paid)}</div>}
      {card.note && <div className="pl-note">{card.note}</div>}
      {card.manager && (
        <div className="pl-mgr"><span className="pl-ava" aria-hidden="true">{initials(card.manager.name)}</span>{card.manager.name}</div>
      )}
    </div>
  );
}

/** amoCRM kabi doska: ustunlar — sotuv bosqichlari, karta — lid. Kartani surib bosqichni o'zgartiriladi. */
export function Board({ fid, filter, refreshKey, onOpen }: {
  fid: number;
  filter: LeadsFilter;
  refreshKey: number;
  onOpen: (id: number) => void;
}) {
  const toast = useToast();
  const key = JSON.stringify(filter);
  const st = useLoad(() => api.pipeline(fid, filter), [fid, key]);
  const [drag, setDrag] = useState<PipelineCard | null>(null);
  const [over, setOver] = useState<PipelineStage | null>(null);
  const [ask, setAsk] = useState<{ card: PipelineCard; to: PipelineStage } | null>(null);
  const [loadingMore, setLoadingMore] = useState<PipelineStage | null>(null);
  const busy = useRef(false);
  busy.current = !!drag || !!ask;

  useEffect(() => {
    if (refreshKey) void st.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy.current) void st.reload();
    }, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fid, key]);

  const patch = (fn: (c: PipelineColumn) => PipelineColumn) => st.setData((d) => d && { stages: d.stages.map(fn) });

  const move = async (card: PipelineCard, to: PipelineStage, extra: Omit<StageInput, 'stage'> = {}) => {
    const from = card.stage;
    patch((c) => {
      if (c.key === from) return { ...c, count: c.count - 1, sum: c.sum - (from === 'won' ? card.paid : 0), items: c.items.filter((x) => x.id !== card.id) };
      if (c.key === to) return { ...c, count: c.count + 1, sum: c.sum + (to === 'won' ? card.paid : 0), items: [{ ...card, stage: to, stage_at: new Date().toISOString(), callback_at: extra.callback_at ?? null, note: extra.note || card.note }, ...c.items] };
      return c;
    });
    setAsk(null);
    try {
      await api.setStage(card.id, { stage: to, ...extra });
    } catch (e) {
      toast.error(e);
    } finally {
      void st.reload();
    }
  };

  const drop = (to: PipelineStage) => {
    const card = drag;
    setDrag(null);
    setOver(null);
    if (!card || card.stage === to) return;
    if (needsDetails(to)) setAsk({ card, to });
    else void move(card, to);
  };

  const loadMore = async (col: PipelineColumn) => {
    setLoadingMore(col.key);
    try {
      const r = await api.pipelineMore(fid, filter, col.key, col.items.length);
      patch((c) => c.key === col.key ? { ...c, items: [...c.items, ...r.items.filter((x) => !c.items.some((y) => y.id === x.id))] } : c);
    } catch (e) {
      toast.error(e);
    } finally {
      setLoadingMore(null);
    }
  };

  if (st.error && !st.data) return <ErrorBox error={st.error} onRetry={st.reload} />;
  if (!st.data) return <Loading />;
  return (
    <>
      <div className="pl" style={{ opacity: st.loading ? 0.6 : 1 }}>
        {st.data.stages.map((col) => (
          <section
            key={col.key}
            className={over === col.key && drag?.stage !== col.key ? 'pl-col pl-col-over' : 'pl-col'}
            aria-label={col.label}
            onDragOver={(e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== col.key) setOver(col.key); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); drop(col.key); }}
          >
            <header className="pl-head" style={{ borderBottomColor: STAGE_COLOR[col.key] }}>
              <div className="pl-title">{col.label}</div>
              <div className="pl-meta">{col.count} ta lid{col.key === 'won' && col.sum > 0 ? ` · ${money(col.sum)}` : ''}</div>
            </header>
            <div className="pl-list">
              {col.items.map((card) => (
                <LeadTile key={card.id} card={card} dragging={drag?.id === card.id} onOpen={() => onOpen(card.id)}
                  onDragStart={() => setDrag(card)} onDragEnd={() => { setDrag(null); setOver(null); }} />
              ))}
              {col.count === 0 && <div className="pl-empty">Bo'sh</div>}
              {col.items.length < col.count && (
                <button type="button" className="btn btn-sm btn-ghost" disabled={loadingMore === col.key} onClick={() => void loadMore(col)}>
                  {loadingMore === col.key ? 'Yuklanmoqda…' : `Yana ko'rsatish (${col.count - col.items.length})`}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      <StageModal ask={ask && { name: ask.card.name, to: ask.to }} onClose={() => setAsk(null)}
        onSubmit={async (extra) => { if (ask) await move(ask.card, ask.to, extra); }} />
    </>
  );
}
