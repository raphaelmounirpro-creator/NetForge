/**
 * Signe NetForge original : deux nœuds reliés par une liaison courbe (fibre),
 * avec un point de signal au centre. Décoratif : le nom est toujours écrit à côté.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" className="fill-surface-raised" />
      <path d="M8 23.5C8 15 24 17 24 8.5" className="stroke-accent" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="8" cy="23.5" r="3.25" className="fill-text" />
      <circle cx="24" cy="8.5" r="3.25" className="fill-text" />
      <circle cx="16" cy="16" r="1.75" className="fill-signal" />
    </svg>
  );
}
