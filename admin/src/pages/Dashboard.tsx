import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/admin';
import type { DashboardPeriod, DashboardResponse } from '../api/types';
import { NeedFunnel } from '../components/NeedFunnel';
import { Async, Card, Empty, PageHead, Segmented } from '../components/ui';
import { useUser } from '../lib/auth';
import { money, num, pct } from '../lib/format';
import { canAccess, type SectionKey } from '../lib/roles';
import { dayLabel, fmtTime, untilLabel } from '../lib/time';
import { useLoad } from '../lib/useLoad';

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: 'today', label: 'Bugun' },
  { value: '7d', label: '7 kun' },
  { value: '30d', label: '30 kun' },
];
const PERIOD_KEY = 'aw_admin_dash_period';

function readPeriod(): DashboardPeriod {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    if (v === 'today' || v === '7d' || v === '30d') return v;
  } catch { /* ignore */ }
  return 'today';
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function Kpis({ d }: { d: DashboardResponse }) {
  const k = d.kpis;
  const day1Row = d.funnel.find((r) => /1-kun/i.test(r.label));
  const sessionRow = d.funnel.find((r) => /sessiya/i.test(r.label));
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="kpi-label">Start</div>
        <div className="kpi-value">{num(k.start)}</div>
        <div className="kpi-sub">reklamadan /start</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Telefon berdi</div>
        <div className="kpi-value">{num(k.phone)}</div>
        <div className="kpi-sub">{pct(ratio(k.phone, k.start))} startdan</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">1-kunni ko'rdi (≥75%)</div>
        <div className="kpi-value">{num(k.day1_watched)}</div>
        <div className="kpi-sub">
          {sessionRow ? `${pct(ratio(k.day1_watched, sessionRow.n))} sessiya tanlaganlardan` : day1Row?.rate != null ? `${pct(day1Row.rate)} oldingi bosqichdan` : '—'}
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-label">To'liq to'lov</div>
        <div className="kpi-value">{num(k.full_paid)}</div>
        <div className="kpi-sub">+ {num(k.deposit_paid)} boshlang'ich</div>
      </div>
      <div className="kpi kpi-dark">
        <div className="kpi-label">Bitta sotuv narxi</div>
        <div className="kpi-value">{k.cost_per_sale === null ? '—' : money(k.cost_per_sale)}</div>
        <div className="kpi-sub">{k.cost_per_sale === null ? "reklama xarajati kiritilmagan yoki sotuv yo'q" : "reklama ÷ to'liq to'lovlar"}</div>
      </div>
    </div>
  );
}

function FunnelBars({ d }: { d: DashboardResponse }) {
  const max = Math.max(1, ...d.funnel.map((r) => r.n));
  return (
    <Card title="Voronka bosqichlari" actions={<span className="muted small">o'tish % — oldingi bosqichdan</span>}>
      {d.funnel.length === 0 ? (
        <Empty title="Bu davrda ma'lumot yo'q" />
      ) : (
        <div className="stack-sm" role="list">
          {d.funnel.map((r) => (
            <div key={r.label} className="funnel-row" role="listitem">
              <div className="funnel-label">{r.label}</div>
              <div className="funnel-track" aria-hidden="true">
                <div className="funnel-bar" style={{ width: `${Math.max(2, Math.round((r.n / max) * 100))}%` }} />
              </div>
              <div className="funnel-n">{num(r.n)}</div>
              <div className="funnel-rate">{r.rate === null ? '' : pct(r.rate)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Upcoming({ d, now }: { d: DashboardResponse; now: number }) {
  return (
    <Card title="Yaqin sessiyalar">
      {d.upcoming.length === 0 ? (
        <div className="muted">Yaqin sessiya yo'q — slotlarni tekshiring.</div>
      ) : (
        d.upcoming.map((u, i) => (
          <div key={u.at} className="tile">
            <div className="stack-sm" style={{ gap: 2 }}>
              <div className="tile-title">{dayLabel(u.at, now)} {fmtTime(u.at)}</div>
              <div className="tile-sub">1-kun: {num(u.day1_count)} lid · 2-kun: {num(u.day2_count)} lid</div>
            </div>
            <div className={i === 0 ? 'tile-n text-accent' : 'tile-n muted'} style={{ fontWeight: i === 0 ? 700 : 600, fontSize: 13 }}>
              {untilLabel(u.at, now)}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

function Attention({ d }: { d: DashboardResponse }) {
  const user = useUser();
  const items: { label: string; n: number; to: string; key: SectionKey; warn: boolean }[] = [
    { label: 'Tasdiq kutayotgan cheklar', n: d.pending_receipts, to: '/payments', key: 'payments', warn: d.pending_receipts > 0 },
    { label: 'Javobsiz savollar', n: d.unanswered_questions, to: '/questions', key: 'questions', warn: d.unanswered_questions > 0 },
    { label: 'Yuborilmagan xabarlar', n: d.failed_messages, to: '/settings#failed', key: 'settings', warn: d.failed_messages > 0 },
  ];
  return (
    <Card title="Diqqat talab">
      {items.map((it) => {
        const inner = (
          <>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{it.label}</span>
            <span className={it.warn ? 'tile-n text-accent' : 'tile-n'}>{num(it.n)}</span>
          </>
        );
        return canAccess(user.role, it.key) ? (
          <Link key={it.label} to={it.to} className={it.warn ? 'tile tile-warn' : 'tile'}>{inner}</Link>
        ) : (
          <div key={it.label} className={it.warn ? 'tile tile-warn' : 'tile'}>{inner}</div>
        );
      })}
    </Card>
  );
}

function DashboardBody({ fid }: { fid: number }) {
  const [period, setPeriod] = useState<DashboardPeriod>(readPeriod);
  const [now, setNow] = useState(Date.now());
  const state = useLoad(() => api.dashboard(fid, period), [fid, period]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const change = (p: DashboardPeriod) => {
    setPeriod(p);
    try { localStorage.setItem(PERIOD_KEY, p); } catch { /* ignore */ }
  };

  return (
    <>
      <PageHead title="Dashboard" actions={<Segmented label="Davr" value={period} options={PERIODS} onChange={change} />} />
      <Async state={state}>
        {(d) => (
          <>
            <Kpis d={d} />
            <div className="cols">
              <div className="col-3"><FunnelBars d={d} /></div>
              <div className="col-2 stack" style={{ gap: 20 }}>
                <Upcoming d={d} now={now} />
                <Attention d={d} />
              </div>
            </div>
          </>
        )}
      </Async>
    </>
  );
}

export default function Dashboard() {
  return <NeedFunnel>{(f) => <DashboardBody fid={f.id} />}</NeedFunnel>;
}
