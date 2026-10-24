import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, useUser } from '../lib/auth';
import { useFunnel } from '../lib/funnel';
import { ROLE_LABEL } from '../lib/labels';
import { SECTIONS, canAccess } from '../lib/roles';
import { IS_MOCK } from '../api/client';
import { BrandMark } from './BrandMark';

function Logo({ sub }: { sub: string }) {
  return (
    <div className="brand">
      <BrandMark />
      <div className="brand-text">
        <div className="brand-name">Avtowebinar</div>
        <div className="brand-sub">{sub}</div>
      </div>
    </div>
  );
}

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const { funnels, funnel, setFunnelId } = useFunnel();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const items = SECTIONS.filter((s) => canAccess(user.role, s.key));
  const funnelName = funnel?.name ?? 'Voronka tanlanmagan';

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Menyuni ochish" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <Logo sub={funnelName} />
      </header>

      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <nav id="sidebar" className={open ? 'sidebar sidebar-open' : 'sidebar'} aria-label="Bo'limlar">
        <div className="sidebar-top">
          <Logo sub={funnelName} />
          <button type="button" className="icon-btn sidebar-close" aria-label="Menyuni yopish" onClick={() => setOpen(false)}>×</button>
        </div>
        {funnels.length > 0 && (
          <label className="field field-compact funnel-select">
            <span>Voronka</span>
            <select className="select" value={funnel?.id ?? ''} onChange={(e) => setFunnelId(Number(e.target.value))}>
              {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        )}
        <div className="nav-list">
          {items.map((s) => (
            <NavLink key={s.key} to={s.path} end={s.path === '/'} className={({ isActive }) => (isActive ? 'nav-link nav-active' : 'nav-link')}>
              {s.label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-user">
          <div className="sidebar-user-text">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{ROLE_LABEL[user.role]}{IS_MOCK ? ' · demo' : ''}</div>
          </div>
          <button type="button" className="btn btn-sm" onClick={logout}>Chiqish</button>
        </div>
      </nav>

      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
