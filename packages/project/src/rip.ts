/**
 * RIP version 2 (format version 8) : activation par interface de routeur.
 * « active » : l'interface émet et traite les messages RIP et son réseau est
 * annoncé ; « passive » : son réseau est annoncé, mais aucun message RIP n'y
 * est émis ni traité (réseau de postes). Voir docs/protocols/rip.md.
 */
export const RIP_MODES = ["active", "passive"] as const;
export type RipMode = (typeof RIP_MODES)[number];

export function isRipMode(value: string): value is RipMode {
  return (RIP_MODES as readonly string[]).includes(value);
}
