import { IconLock, IconWifiOff } from '../components/Icons';

interface Props {
  /** HTTP status; 0 = tarmoq xatosi */
  status: number;
  onRetry(): void;
}

export function ErrorScreen({ status, onRetry }: Props) {
  const auth = status === 401 || status === 403;
  return (
    <main className="screen screen--page">
      <div className="center-block">
        <div className="round-icon">{auth ? <IconLock size={30} /> : <IconWifiOff size={30} />}</div>
        {auth ? (
          <>
            <h1 className="hero__title">Sahifani bot ichidan oching</h1>
            <p className="hero__text">
              Efir sahifasi faqat Telegram bot orqali ochiladi. Botga qaytib, "Efirga kirish" tugmasini bosing.
            </p>
          </>
        ) : (
          <>
            <h1 className="hero__title">Sahifa yuklanmadi</h1>
            <p className="hero__text">Internet aloqasini tekshirib, qayta urinib ko'ring.</p>
          </>
        )}
      </div>
      {!auth && (
        <div className="bottom-actions">
          <button type="button" className="btn btn--primary btn--lg" onClick={onRetry}>
            Qayta urinish
          </button>
        </div>
      )}
    </main>
  );
}

export function LoadingScreen() {
  return (
    <main className="screen screen--page" aria-busy="true">
      <span className="sr-only" role="status">
        Yuklanmoqda…
      </span>
      <div className="skeleton-row" aria-hidden="true">
        <div className="skeleton skeleton--logo" />
        <div className="skeleton-col">
          <div className="skeleton skeleton--line skeleton--w40" />
          <div className="skeleton skeleton--line skeleton--w60" />
        </div>
      </div>
      <div className="skeleton-stack" aria-hidden="true">
        <div className="skeleton skeleton--line skeleton--w30" />
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--title skeleton--w70" />
      </div>
      <div className="skeleton skeleton--card" aria-hidden="true" />
      <div className="skeleton-grid" aria-hidden="true">
        <div className="skeleton skeleton--tile" />
        <div className="skeleton skeleton--tile" />
      </div>
      <div className="skeleton skeleton--speaker" aria-hidden="true" />
    </main>
  );
}
