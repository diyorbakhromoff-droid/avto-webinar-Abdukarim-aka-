import { useState } from 'react';
import { api } from '../api/admin';
import type { ContactResult, LeadCard } from '../api/types';
import { CONTACT_LABEL, options } from '../lib/labels';
import { fmtDateTime, fromLocalInput } from '../lib/time';
import { useToast } from '../lib/toast';

/** Aloqa natijasi (qo'ng'iroq natijasi + izoh) va aloqalar tarixi. Natija lidni doskada surib qo'yadi. */
export function ContactForm({ lead, onSaved }: { lead: Pick<LeadCard, 'id' | 'contacts'>; onSaved: () => void }) {
  const toast = useToast();
  const [result, setResult] = useState<ContactResult | null>(null);
  const [callback, setCallback] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canSave = !!result && (result !== 'callback' || !!fromLocalInput(callback)) && !busy;
  const save = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await api.contact(lead.id, { result, callback_at: result === 'callback' ? fromLocalInput(callback) : null, note: note.trim() });
      toast.success('Aloqa natijasi saqlandi');
      setResult(null);
      setCallback('');
      setNote('');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="chips" role="radiogroup" aria-label="Natija">
        {options(CONTACT_LABEL).map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={result === o.value} className={result === o.value ? 'chip chip-on' : 'chip'} onClick={() => setResult(o.value)}>{o.label}</button>
        ))}
      </div>
      <div className="inline-form">
        {result === 'callback' && (
          <label className="field field-compact" style={{ flex: '1 1 180px' }}>
            <span>Qayta qo'ng'iroq vaqti</span>
            <input className="input" type="datetime-local" value={callback} onChange={(e) => setCallback(e.target.value)} />
          </label>
        )}
        <label className="field field-compact" style={{ flex: '2 1 240px' }}>
          <span>Izoh</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Izoh: ertaga kechqurun qulay ekan" />
        </label>
        <button type="button" className="btn btn-accent" disabled={!canSave} onClick={() => void save()}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
      </div>
      {lead.contacts.length > 0 && (
        <div className="stack-sm">
          {[...lead.contacts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((c, i) => (
            <div key={i} className="tile" style={{ alignItems: 'flex-start' }}>
              <div className="stack-sm" style={{ gap: 2 }}>
                <div className="strong">{CONTACT_LABEL[c.result]}{c.callback_at && <span className="muted"> · {fmtDateTime(c.callback_at)} ga</span>}</div>
                {c.note && <div className="small">{c.note}</div>}
              </div>
              <div className="small muted nowrap">{c.manager} · {fmtDateTime(c.at)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
