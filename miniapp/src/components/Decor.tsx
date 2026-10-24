/**
 * Notiqlik mavzusidagi bezaklar — inline stroke SVG, barchasi aria-hidden.
 * Rang — currentColor (CSS da var(--primary)), shaffoflik CSS da past qilib beriladi.
 */

const svgBase = {
  'aria-hidden': true,
  focusable: false,
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Mikrofon — logotip o'rnida (dumaloq burchakli kvadrat ichida). */
export function MicMark({ size = 22 }: { size?: number }) {
  return (
    <svg {...svgBase} width={size} height={size} viewBox="0 0 24 24" strokeWidth={1.8}>
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M9 6.5h1.6M9 9.5h1.6" strokeWidth={1.4} />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
      <path d="M8.5 21h7" />
    </svg>
  );
}

/* ── Yumshoq tovush to'lqinlari (kutish ekrani) ── */

const WAVE_W = 360;
const WAVE_H = 170;

function wavePath(amp: number, cycles: number, phase: number): string {
  const n = 90;
  const mid = WAVE_H / 2;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    // Ovoz to'lqini: o'rtada balandroq, chetlarda pasayadi
    const env = 0.3 + 0.7 * Math.sin(Math.PI * u);
    const y = mid + amp * env * Math.sin(2 * Math.PI * cycles * u + phase);
    d += `${i === 0 ? 'M' : 'L'}${(u * WAVE_W).toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

const WAVES = [
  { d: wavePath(46, 1.6, 2.4), o: 0.5, w: 1.4 },
  { d: wavePath(34, 2.2, 0), o: 1, w: 1.6 },
  { d: wavePath(22, 3.1, 1.3), o: 0.7, w: 1.4 },
];

export function WaveLines({ className = '' }: { className?: string }) {
  return (
    <svg
      {...svgBase}
      className={`decor decor--waves ${className}`}
      viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
      preserveAspectRatio="none"
    >
      {WAVES.map((w, i) => (
        <path key={i} d={w.d} strokeWidth={w.w} opacity={w.o} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/* ── Ekvalayzer chiziqlari (kunlar orasida) ── */

const BAR_HEIGHTS = [16, 30, 52, 76, 60, 94, 110, 82, 58, 90, 68, 42, 56, 28, 14];

export function EqualizerBars({ className = '' }: { className?: string }) {
  return (
    <svg {...svgBase} className={`decor decor--bars ${className}`} viewBox="0 0 220 120" strokeWidth={7}>
      {BAR_HEIGHTS.map((h, i) => {
        const x = 9 + i * 14.4;
        return <line key={i} x1={x} x2={x} y1={60 - h / 2} y2={60 + h / 2} />;
      })}
    </svg>
  );
}

/* ── Burchakdan tarqaluvchi tovush yoylari (tugagan ekran) ── */

const ARC_RADII = [44, 78, 112, 146, 180];

export function SoundArcs({ className = '' }: { className?: string }) {
  return (
    <svg {...svgBase} className={`decor decor--arcs ${className}`} viewBox="0 0 210 210" strokeWidth={2}>
      {ARC_RADII.map((r, i) => (
        <path key={r} d={`M${210 - r} 0A${r} ${r} 0 0 0 210 ${r}`} opacity={1 - i * 0.16} />
      ))}
    </svg>
  );
}

/** Qo'shtirnoq (to'rtburchak boshli, "iqtibos" belgisi) — kunlar orasidagi xulosa kartochkasida. */
export function QuoteMark({ className = '' }: { className?: string }) {
  return (
    <svg {...svgBase} className={className} width={44} height={44} viewBox="0 0 24 24" strokeWidth={1.4}>
      <rect x="3" y="4" width="7.5" height="7" rx="1.5" />
      <path d="M10.5 9v3c0 4-2.2 6.6-6.2 7.8" />
      <rect x="13.5" y="4" width="7.5" height="7" rx="1.5" />
      <path d="M21 9v3c0 4-2.2 6.6-6.2 7.8" />
    </svg>
  );
}
