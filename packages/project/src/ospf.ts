/**
 * OSPF version 2 en zone unique (format version 9) : participation par
 * interface de routeur. « active » : l'interface émet et traite les paquets
 * OSPF (Hello, échange de base, inondation) ; « passive » : son réseau est
 * décrit dans la base d'état des liens, mais aucun paquet OSPF n'y est émis
 * ni traité (réseau de postes). Voir docs/protocols/ospf.md.
 */
export const OSPF_MODES = ["active", "passive"] as const;
export type OspfMode = (typeof OSPF_MODES)[number];

/** Coût d'interface : supérieur à 0 (RFC 2328, annexe C.3), sur 16 bits ; 10 par défaut (choix NetForge, la RFC n'en donne pas). */
export const OSPF_COST_MIN = 1;
export const OSPF_COST_MAX = 65535;
export const OSPF_DEFAULT_COST = 10;

/** Priorité de routeur : 0 (jamais DR) à 255 ; 1 par défaut (choix NetForge, la RFC n'en donne pas). */
export const OSPF_PRIORITY_MAX = 255;
export const OSPF_DEFAULT_PRIORITY = 1;

export interface OspfInterface {
  readonly mode: OspfMode;
  readonly cost: number;
  readonly priority: number;
}

export function isOspfMode(value: string): value is OspfMode {
  return (OSPF_MODES as readonly string[]).includes(value);
}

export function isOspfCost(value: number): boolean {
  return Number.isInteger(value) && value >= OSPF_COST_MIN && value <= OSPF_COST_MAX;
}

export function isOspfPriority(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= OSPF_PRIORITY_MAX;
}
