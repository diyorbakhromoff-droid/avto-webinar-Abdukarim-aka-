import type { StatsResponse } from '../api/types';

type Retention = StatsResponse['retention'][number];

const X0 = 40, X1 = 390, Y0 = 20, Y1 = 170;

/** minute bo'yicha chiziqli interpolyatsiya. */
export function shareAt(points: Retention['points'], minute: number): number | null {
  if (!points.length) return null;
  const p = [...points].sort((a, b) => a.minute - b.minute);
  if (minute <= p[0].minute) return p[0].share;
  for (let i = 1; i < p.length; i++) {
    if (minute <= p[i].minute) {
      const a = p[i - 1], b = p[i];
      const k = b.minute === a.minute ? 0 : (minute - a.minute) / (b.minute - a.minute);
      return a.share + (b.share - a.share) * k;
    }
  }
  return p[p.length - 1].share;
}

/** Bir qatorli xulosa: "Oferta (58-daqiqa) gacha 68% qoladi; eng katta chiqish 20–30-daqiqalarda." */
export function retentionTakeaway(r: Retention): string {
  if (r.points.length < 2) return "Ma'lumot yetarli emas.";
  const step = r.duration_min > 60 ? 10 : 5;
  let worst = { from: 0, drop: -1 };
  for (let m = 0; m + step <= Math.max(step, r.duration_min); m += step) {
    const a = shareAt(r.points, m), b = shareAt(r.points, m + step);
    if (a !== null && b !== null && a - b > worst.drop) worst = { from: m, drop: a - b };
  }
  const drop = worst.drop > 0 ? `eng katta chiqish ${worst.from}–${worst.from + step}-daqiqalarda` : 'sezilarli chiqish yo\'q';
  if (r.offer_min !== null) {
    const s = shareAt(r.points, r.offer_min);
    return `Oferta (${r.offer_min}-daqiqa) gacha ${Math.round((s ?? 0) * 100)}% qoladi; ${drop}.`;
  }
  const end = shareAt(r.points, r.duration_min);
  return `Video oxirigacha ${Math.round((end ?? 0) * 100)}% qoladi; ${drop}.`;
}

export function RetentionChart({ r }: { r: Retention }) {
  const pts = [...r.points].sort((a, b) => a.minute - b.minute);
  const dur = Math.max(1, r.duration_min, pts.length ? pts[pts.length - 1].minute : 1);
  const minShare = pts.reduce((m, p) => Math.min(m, p.share), 1);
  const yMin = Math.max(0, Math.min(0.75, Math.floor(minShare * 4) / 4));
  const x = (m: number) => X0 + ((X1 - X0) * m) / dur;
  const y = (s: number) => Y1 - ((Y1 - Y0) * (s - yMin)) / (1 - yMin || 1);
  const grid: number[] = [];
  for (let s = 1; s >= yMin - 1e-9; s -= 0.25) grid.push(Math.round(s * 100) / 100);
  const ticks: number[] = [];
  const tickStep = dur > 60 ? 30 : dur > 30 ? 15 : 10;
  for (let m = 0; m < dur - tickStep / 3; m += tickStep) ticks.push(m);
  const offerShare = r.offer_min !== null ? shareAt(pts, r.offer_min) : null;
  const endShare = shareAt(pts, dur);
  const label = `${r.day}-kun videosi bo'yicha qolgan tomoshabinlar ulushi: ` +
    [0, Math.round(dur / 2), dur].map((m) => `${m}-daqiqada ${Math.round((shareAt(pts, m) ?? 0) * 100)}%`).join(', ') +
    (r.offer_min !== null && offerShare !== null ? `; oferta ${r.offer_min}-daqiqada ${Math.round(offerShare * 100)}%` : '');

  return (
    <svg role="img" aria-label={label} viewBox="0 0 400 210" className="chart">
      <g stroke="#EFECE4" strokeWidth="1">
        {grid.map((s) => <line key={s} x1={X0} y1={y(s)} x2={X1} y2={y(s)} />)}
      </g>
      <g fontFamily="Manrope, sans-serif" fontSize="11" fill="#6B665C">
        {grid.map((s) => <text key={s} x={X0 - 6} y={y(s) + 4} textAnchor="end">{Math.round(s * 100)}%</text>)}
        {ticks.map((m) => <text key={m} x={x(m)} y="196" textAnchor={m === 0 ? 'start' : 'middle'}>{m}</text>)}
        <text x={X1} y="196" textAnchor="end">{Math.round(dur)} daq</text>
      </g>
      {r.offer_min !== null && (
        <>
          <line x1={x(r.offer_min)} y1="14" x2={x(r.offer_min)} y2="176" stroke="#1C1B18" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={x(r.offer_min) + (x(r.offer_min) > 330 ? -4 : 4)} y="30" textAnchor={x(r.offer_min) > 330 ? 'end' : 'start'} fontFamily="Manrope, sans-serif" fontSize="11" fontWeight="700" fill="#1C1B18">oferta</text>
        </>
      )}
      {pts.length > 1 && (
        <polyline fill="none" stroke="#B8892A" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"
          points={pts.map((p) => `${x(p.minute).toFixed(1)},${y(Math.max(yMin, p.share)).toFixed(1)}`).join(' ')} />
      )}
      {r.offer_min !== null && offerShare !== null && (
        <>
          <circle cx={x(r.offer_min)} cy={y(offerShare)} r="4.5" fill="#B8892A" />
          <text x={x(r.offer_min) - 8} y={y(offerShare) - 6} textAnchor="end" fontFamily="Manrope, sans-serif" fontSize="12" fontWeight="800" fill="#1C1B18">{Math.round(offerShare * 100)}%</text>
        </>
      )}
      {r.offer_min === null && endShare !== null && pts.length > 1 && (
        <>
          <circle cx={x(dur)} cy={y(Math.max(yMin, endShare))} r="4.5" fill="#B8892A" />
          <text x={x(dur) - 8} y={y(Math.max(yMin, endShare)) - 8} textAnchor="end" fontFamily="Manrope, sans-serif" fontSize="12" fontWeight="800" fill="#1C1B18">{Math.round(endShare * 100)}%</text>
        </>
      )}
    </svg>
  );
}
