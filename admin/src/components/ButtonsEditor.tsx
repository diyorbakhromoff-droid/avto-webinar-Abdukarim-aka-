import type { ButtonType, ChainButton } from '../api/types';
import { BUTTON_DEFAULT_TEXT, BUTTON_TYPE_LABEL, options } from '../lib/labels';

const MAX_ROWS = 3;
const MAX_PER_ROW = 3;

/** Tugmalarni tekshiradi; xato bo'lsa matn qaytaradi. */
export function validateButtons(rows: ChainButton[][]): string | null {
  if (rows.length > MAX_ROWS) return `Tugmalar ${MAX_ROWS} qatordan oshmasin`;
  for (const row of rows) {
    for (const b of row) {
      if (!b.text.trim()) return "Tugma matni bo'sh bo'lmasin";
      if (b.text.length > 64) return 'Tugma matni 64 belgidan oshmasin';
      if (b.type === 'url' && !/^https?:\/\/\S+$/i.test(b.url ?? '')) return `«${b.text}» tugmasi uchun to'g'ri havola kiriting (https://…)`;
    }
  }
  return null;
}

/** Bo'sh qatorlarni olib tashlaydi. */
export function cleanButtons(rows: ChainButton[][]): ChainButton[][] {
  return rows
    .map((r) => r.map((b): ChainButton => {
      if (b.type === 'url') return { type: b.type, text: b.text.trim(), url: (b.url ?? '').trim() };
      // «keyingi blok» tugmasining id si saqlanadi — sxemadagi chiziq unga ulangan
      if (b.type === 'next') return b.id ? { type: b.type, text: b.text.trim(), id: b.id } : { type: b.type, text: b.text.trim() };
      return { type: b.type, text: b.text.trim() };
    }))
    .filter((r) => r.length > 0);
}

/** allowNext — sxemadagi «Xabar» bloki: «Sxemada keyingi blok» turi ham tanlanadi. */
export function ButtonsEditor({ value, onChange, idPrefix = 'btn', allowNext = false }: { value: ChainButton[][]; onChange: (v: ChainButton[][]) => void; idPrefix?: string; allowNext?: boolean }) {
  const typeOptions = options(BUTTON_TYPE_LABEL).filter((o) => allowNext || o.value !== 'next');
  const update = (ri: number, bi: number, patch: Partial<ChainButton>) => {
    onChange(value.map((row, r) => (r !== ri ? row : row.map((b, i) => (i !== bi ? b : { ...b, ...patch })))));
  };
  const changeType = (ri: number, bi: number, type: ButtonType) => {
    const cur = value[ri][bi];
    const wasDefault = !cur.text || Object.values(BUTTON_DEFAULT_TEXT).includes(cur.text);
    update(ri, bi, { type, text: wasDefault ? BUTTON_DEFAULT_TEXT[type] : cur.text, url: type === 'url' ? cur.url ?? '' : undefined, id: type === 'next' ? cur.id : undefined });
  };
  const remove = (ri: number, bi: number) => {
    onChange(value.map((row, r) => (r !== ri ? row : row.filter((_, i) => i !== bi))).filter((r) => r.length > 0));
  };
  const addToRow = (ri: number) => {
    onChange(value.map((row, r) => (r !== ri ? row : [...row, allowNext ? { type: 'next', text: '' } : { type: 'url', text: '', url: '' }])));
  };
  const addRow = () => onChange([...value, [allowNext ? { type: 'next', text: BUTTON_DEFAULT_TEXT.next } : { type: 'webapp', text: BUTTON_DEFAULT_TEXT.webapp }]]);

  return (
    <div className="buttons-editor">
      {value.length === 0 && <div className="muted small">Tugma yo'q.</div>}
      {value.map((row, ri) => (
        <fieldset key={ri} className="btn-row">
          <legend className="small muted">{ri + 1}-qator</legend>
          {row.map((b, bi) => {
            const id = `${idPrefix}-${ri}-${bi}`;
            return (
              <div key={bi} className="btn-item">
                <label className="field field-compact">
                  <span>Turi</span>
                  <select id={`${id}-type`} className="select" value={b.type} onChange={(e) => changeType(ri, bi, e.target.value as ButtonType)}>
                    {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field field-compact grow">
                  <span>Matn</span>
                  <input className="input" value={b.text} maxLength={64} onChange={(e) => update(ri, bi, { text: e.target.value })} placeholder="Tugma matni" />
                </label>
                {b.type === 'url' && (
                  <label className="field field-compact grow">
                    <span>Havola</span>
                    <input className="input" type="url" inputMode="url" value={b.url ?? ''} onChange={(e) => update(ri, bi, { url: e.target.value })} placeholder="https://" />
                  </label>
                )}
                <button type="button" className="icon-btn btn-item-x" aria-label="Tugmani o'chirish" onClick={() => remove(ri, bi)}>×</button>
              </div>
            );
          })}
          {row.length < MAX_PER_ROW && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => addToRow(ri)}>+ Shu qatorga tugma</button>
          )}
        </fieldset>
      ))}
      {value.length < MAX_ROWS && (
        <button type="button" className="btn btn-sm" onClick={addRow}>+ Tugmalar qatori</button>
      )}
      <div className="muted small">
        «Efirga kirish», «Vaqtni o'zgartirish» va «To'lov» tugmalarining havolasini bot o'zi qo'yadi.
        {allowNext && " «Sxemada keyingi blok» tugmasidan sxemada alohida chiziq chiqadi — uni kerakli blokka ulang."}
      </div>
    </div>
  );
}
