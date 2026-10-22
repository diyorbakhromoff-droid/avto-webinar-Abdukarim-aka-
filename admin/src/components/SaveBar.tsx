import type { ReactNode } from 'react';

export function SaveBar({ dirty, saving, onSave, onReset, disabled, extra, saveText = 'Saqlash' }: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset?: () => void;
  disabled?: boolean;
  extra?: ReactNode;
  saveText?: string;
}) {
  return (
    <div className="sticky-actions">
      {extra}
      {dirty && <span className="muted small">Saqlanmagan o'zgarishlar bor</span>}
      {dirty && onReset && <button type="button" className="btn" onClick={onReset} disabled={saving}>Bekor qilish</button>}
      <button type="button" className="btn btn-accent" onClick={onSave} disabled={!dirty || saving || disabled}>
        {saving ? 'Saqlanmoqda…' : saveText}
      </button>
    </div>
  );
}
