// Small stroke icons used across the app (inherit currentColor).
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24", "aria-hidden": true };

export const ScanIcon = () => (
  <svg {...base}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M8 9v6M11 9v6M14 9v6M17 9v6" /></svg>
);
export const CheckIcon = () => (
  <svg {...base} strokeWidth={2.5}><circle cx="12" cy="12" r="10" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>
);
export const AlertIcon = () => (
  <svg {...base} strokeWidth={2.5}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17.5v.01" /></svg>
);
export const StopIcon = () => (
  <svg {...base} strokeWidth={2.5}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></svg>
);
export const ClockIcon = () => (
  <svg {...base} strokeWidth={2.5}><circle cx="12" cy="12" r="10" /><path d="M12 7v5l3 2" /></svg>
);
export const BagIcon = () => (
  <svg {...base}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
);
export const LockIcon = () => (
  <svg {...base}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

export function Brand({ label = "ScanExit", sub }: { label?: string; sub?: string | null }) {
  return (
    <span className="brand">
      <span className="brand-mark"><ScanIcon /></span>
      <span className="brand-text">{label}{sub && <small>{sub}</small>}</span>
    </span>
  );
}

/** Full-screen loading screen: logo, app name and (when known) the store's name. */
export function Splash({ store }: { store?: string | null }) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-card">
        <div className="splash-mark"><ScanIcon /></div>
        <div className="splash-name">ScanExit</div>
        {store && <div className="splash-store">{store}</div>}
        <div className="splash-bar" aria-hidden><span /></div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
