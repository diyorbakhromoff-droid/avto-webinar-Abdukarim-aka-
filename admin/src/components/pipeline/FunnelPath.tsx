import type { LeadCard } from '../../api/types';
import { stepTone } from '../../lib/pipeline';
import { agoLabel, fmtDateTime } from '../../lib/time';
import { Badge } from '../ui';

const MARK = { done: '✓', missed: '✕', wait: '' } as const;

/** Avtovoronka yo'li: lid botda nima qildi, nimani o'tkazib yubordi, nima hali oldinda. */
export function FunnelPath({ lead }: { lead: Pick<LeadCard, 'path' | 'step' | 'step_label' | 'step_since' | 'flow_runs'> }) {
  const live = (lead.flow_runs ?? []).filter((r) => r.status === 'waiting' || r.status === 'active');
  return (
    <div className="stack-sm">
      <div className="row small">
        <span className="muted">Hozir:</span>
        <Badge tone={stepTone(lead.step)}>{lead.step_label}</Badge>
        <span className="muted" title={fmtDateTime(lead.step_since)}>{agoLabel(lead.step_since)}</span>
      </div>
      <ol className="fp">
        {lead.path.map((p) => (
          <li key={p.key} className={`fp-item fp-${p.state}`}>
            <span className="fp-mark" aria-hidden="true">{MARK[p.state]}</span>
            <span className="fp-body">
              <span className="fp-label">{p.label}</span>
              {p.detail && <span className="fp-detail">{p.detail}</span>}
            </span>
            <span className="fp-at tnum">{p.at ? fmtDateTime(p.at) : ''}</span>
            <span className="visually-hidden">{p.state === 'done' ? 'bajardi' : p.state === 'missed' ? "o'tkazib yubordi" : 'hali yo\'q'}</span>
          </li>
        ))}
      </ol>
      {live.map((r) => (
        <div key={r.id} className="small muted">Progrev sxemasi: <b>{r.flow_name}</b>{r.node_title ? ` → ${r.node_title}` : ''}</div>
      ))}
    </div>
  );
}
