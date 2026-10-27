import { useState, type ReactNode } from 'react';
import { api } from '../../api/admin';
import type { PipelineStage, StageInput } from '../../api/types';
import { STAGES, STAGE_COLOR } from '../../lib/pipeline';
import { fromLocalInput, toLocalInput, tzParts, tzToUtc } from '../../lib/time';
import { useToast } from '../../lib/toast';
import { Modal } from '../Modal';

/** Qayta qo'ng'iroqqa vaqt, rad etishga sabab so'raladi. */
export const needsDetails = (s: PipelineStage) => s === 'callback' || s === 'lost';

function tomorrowAt10(): string {
  const p = tzParts(Date.now() + 24 * 3600 * 1000);
  return toLocalInput(tzToUtc(p.y, p.m, p.d, 10, 0));
}

/** Qayta qo'ng'iroq vaqti yoki rad etish sababi. */
export function StageDetails({ stage, onSubmit, onCancel }: {
  stage: PipelineStage;
  onSubmit: (extra: Omit<StageInput, 'stage'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [at, setAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const callback = stage === 'callback';
  const ok = !busy && (!callback || !!fromLocalInput(at));
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({ callback_at: callback ? fromLocalInput(at) : null, note: note.trim() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-sm">
      {callback && (
        <>
          <label className="field field-compact">
            <span>Qachon qo'ng'iroq qilinadi</span>
            <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} autoFocus />
          </label>
          <div className="chips">
            <button type="button" className="chip" onClick={() => setAt(toLocalInput(Date.now() + 3600 * 1000))}>1 soatdan keyin</button>
            <button type="button" className="chip" onClick={() => setAt(tomorrowAt10())}>Ertaga 10:00</button>
          </div>
        </>
      )}
      <label className="field field-compact">
        <span>{callback ? 'Izoh' : 'Sababi'}</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoFocus={!callback}
          placeholder={callback ? 'Masalan: ishdan keyin qulay' : 'Masalan: hozir qimmat, keyingi oqimga'} />
      </label>
      <div className="row-end">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Bekor qilish</button>
        <button type="button" className="btn btn-sm btn-accent" disabled={!ok} onClick={() => void submit()}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
      </div>
    </div>
  );
}

/** Doskada kartani «Qayta qo'ng'iroq» yoki «Rad etdi» ustuniga tashlaganda. */
export function StageModal({ ask, onClose, onSubmit }: {
  ask: { name: string; to: PipelineStage } | null;
  onClose: () => void;
  onSubmit: (extra: Omit<StageInput, 'stage'>) => Promise<void>;
}) {
  return (
    <Modal open={!!ask} size="sm" onClose={onClose}
      title={ask ? `${ask.name} → ${STAGES.find((s) => s.key === ask.to)?.label}` : ''}>
      {ask && <StageDetails stage={ask.to} onCancel={onClose} onSubmit={onSubmit} />}
    </Modal>
  );
}

/**
 * Lid kartasidagi bosqich tanlovi (telefonda kartani surib bo'lmaydi — shu orqali o'zgartiriladi).
 * children — yonidagi ikkinchi maydon (masalan menejer); vaqt/sabab so'rovi ikkalasining ostida to'liq kenglikda.
 */
export function StageSelect({ leadId, stage, onChanged, children }: {
  leadId: number;
  stage: PipelineStage;
  onChanged: () => void;
  children?: ReactNode;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<PipelineStage | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (to: PipelineStage, extra: Omit<StageInput, 'stage'> = {}) => {
    setBusy(true);
    try {
      await api.setStage(leadId, { stage: to, ...extra });
      setPending(null);
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const shown = pending ?? stage;
  return (
    <div className={children ? 'grid-2' : 'stack-sm'}>
      <label className="field field-compact">
        <span>Sotuv bosqichi</span>
        <span className="pl-select">
          <span className="pl-dot" style={{ background: STAGE_COLOR[shown] }} aria-hidden="true" />
          <select className="select" value={shown} disabled={busy} onChange={(e) => {
            const to = e.target.value as PipelineStage;
            if (to === stage) setPending(null);
            else if (needsDetails(to)) setPending(to);
            else void save(to);
          }}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </span>
      </label>
      {children}
      {pending && <div className="pl-details" style={{ gridColumn: '1 / -1' }}><StageDetails stage={pending} onCancel={() => setPending(null)} onSubmit={(x) => save(pending, x)} /></div>}
    </div>
  );
}
