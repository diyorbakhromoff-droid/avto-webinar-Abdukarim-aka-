import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/admin';
import { useManagers } from '../../lib/managers';
import { useToast } from '../../lib/toast';
import { useLoad } from '../../lib/useLoad';
import { ContactForm } from '../ContactForm';
import { MessageModal } from '../MessageModal';
import { Modal } from '../Modal';
import { Badge, ErrorBox, Loading } from '../ui';
import { FunnelPath } from './FunnelPath';
import { StageSelect } from './Stage';

/** Doskada kartani bosganda o'ngdan chiqadigan lid kartasi: bosqich, menejer, aloqa va avtovoronka yo'li. */
export function LeadDrawer({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const managers = useManagers();
  const st = useLoad(id ? () => api.lead(id) : null, [id]);
  const [msgOpen, setMsgOpen] = useState(false);
  const l = st.data && st.data.id === id ? st.data : undefined;
  const changed = () => {
    void st.reload();
    onChanged();
  };
  const assign = async (v: string) => {
    if (!l) return;
    try {
      await api.assign(l.id, v ? Number(v) : null);
      changed();
    } catch (e) {
      toast.error(e);
    }
  };
  const tel = l?.phone?.replace(/[^\d+]/g, '');
  const opts = l?.manager && !managers.some((m) => m.id === l.manager!.id) ? [l.manager, ...managers] : managers;

  return (
    <Modal open={id !== null} drawer onClose={onClose} title={l ? l.name || 'Ismsiz' : 'Lid'}
      footer={l && (
        <>
          <button type="button" className="btn" disabled={l.blocked || l.unsubscribed} onClick={() => setMsgOpen(true)}>Bot orqali xabar</button>
          <Link to={`/leads/${l.id}`} className="btn">To'liq karta</Link>
        </>
      )}>
      {st.error && !l ? <ErrorBox error={st.error} onRetry={st.reload} /> : !l ? <Loading /> : (
        <>
          <div className="row">
            {tel ? <a href={`tel:${tel}`} className="btn btn-primary">Qo'ng'iroq: {l.phone}</a> : <span className="muted">Telefon yo'q</span>}
            {l.username && <a href={`https://t.me/${l.username}`} target="_blank" rel="noreferrer" className="btn btn-ghost">@{l.username}</a>}
          </div>
          {(l.blocked || l.unsubscribed) && (
            <div className="row">
              {l.blocked && <Badge tone="danger">botni bloklagan</Badge>}
              {l.unsubscribed && <Badge tone="neutral">xabarlarni to'xtatgan</Badge>}
            </div>
          )}
          <StageSelect key={`${l.id}:${l.stage}`} leadId={l.id} stage={l.stage} onChanged={changed}>
            <label className="field field-compact">
              <span>Menejer</span>
              <select className="select" value={l.manager?.id ?? ''} onChange={(e) => void assign(e.target.value)}>
                <option value="">— Biriktirilmagan</option>
                {opts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </StageSelect>

          <section className="pl-sec">
            <h3 className="pl-sec-title">Avtovoronka yo'li</h3>
            <FunnelPath lead={l} />
          </section>

          <section className="pl-sec">
            <h3 className="pl-sec-title">Aloqa natijasi</h3>
            <ContactForm lead={l} onSaved={changed} />
          </section>
          <MessageModal open={msgOpen} leadIds={[l.id]} onClose={() => setMsgOpen(false)} onSent={changed} />
        </>
      )}
    </Modal>
  );
}
