import { useServerNow, useOnReached } from '../lib/hooks';
import { formatHms, pad2, remaining, toMs } from '../lib/time';

interface Props {
  /** ISO vaqt (UTC) */
  target: string;
  /** Nolga yetganda (holatni qayta so'rash uchun) */
  onDone?: () => void;
  variant?: 'tiles' | 'inline';
  size?: 'lg' | 'md';
  className?: string;
}

function spoken(h: number, m: number, s: number): string {
  const parts: string[] = [];
  if (h) parts.push(`${h} soat`);
  if (m || h) parts.push(`${m} daqiqa`);
  parts.push(`${s} soniya`);
  return `${parts.join(' ')} qoldi`;
}

export function Countdown({ target, onDone, variant = 'tiles', size = 'lg', className }: Props) {
  const now = useServerNow();
  const targetMs = toMs(target);
  useOnReached(targetMs, now, onDone);
  const r = remaining(targetMs, now);
  const label = spoken(r.hours, r.minutes, r.seconds);

  if (variant === 'inline') {
    return (
      <span className={`countdown-inline ${className ?? ''}`} role="timer" aria-label={label}>
        {formatHms(r)}
      </span>
    );
  }

  const tiles: [string, string][] = [
    [pad2(r.hours), 'soat'],
    [pad2(r.minutes), 'daqiqa'],
    [pad2(r.seconds), 'soniya'],
  ];
  return (
    <div className={`tiles tiles--${size} ${className ?? ''}`} role="timer" aria-label={label}>
      {tiles.map(([value, unit]) => (
        <div className="tile" key={unit} aria-hidden="true">
          <div className="tile__value">{value}</div>
          <div className="tile__unit">{unit}</div>
        </div>
      ))}
    </div>
  );
}
