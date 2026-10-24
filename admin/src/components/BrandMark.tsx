/** Logotip belgisi: mikrofon (notiqlik kursi). Chiziqli SVG, rangi — currentColor. */
export function MicIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 10.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17v4" />
      <path d="M8.5 21h7" />
    </svg>
  );
}

export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <MicIcon />
    </div>
  );
}
