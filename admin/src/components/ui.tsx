import type { ReactNode } from 'react';

export function Loading({ text = 'Yuklanmoqda…' }: { text?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <div className="state-title">{title}</div>
      {children && <div className="state-sub">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="box box-danger" role="alert">
      <span>{error}</span>
      {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Qayta urinish</button>}
    </div>
  );
}

/** Yuklash/xato/bo'sh holatlarni bir joyda boshqaradi. */
export function Async<T>({ state, children, empty }: {
  state: { data: T | undefined; loading: boolean; error: string | null; reload: () => void };
  children: (data: T) => ReactNode;
  empty?: (data: T) => ReactNode | null;
}) {
  if (state.error && state.data === undefined) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return <Loading />;
  const e = empty?.(state.data);
  if (e) return <>{e}</>;
  return <>{children(state.data)}</>;
}

export type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'ink' | 'info';
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'seg seg-on' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Sahifalar">
      <span className="muted">{from}–{to} / {total}</span>
      <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Oldingi</button>
      <span className="pagination-n">{page} / {pages}</span>
      <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Keyingi →</button>
    </nav>
  );
}

export function Warnings({ items, tone = 'warn' }: { items: string[] | undefined | null; tone?: 'warn' | 'danger' }) {
  if (!items?.length) return null;
  return (
    <div className={`box box-${tone}`} role="alert">
      <ul className="plain-list">
        {items.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    </div>
  );
}
