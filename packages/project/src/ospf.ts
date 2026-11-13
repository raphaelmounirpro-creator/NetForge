import { formatIpv4, parseIpv4 } from "./ipv4.js";

/**
 * OSPF version 2 (format version 9, zones depuis la version 11) : participation par
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
  /** Zone de l'interface, en notation pointée (« 0.0.0.0 » : dorsale). */
  readonly area: string;
}

/** Dorsale (zone 0), à laquelle tout routeur de bordure doit être relié (pas de liens virtuels). */
export const OSPF_BACKBONE_AREA = "0.0.0.0";

/**
 * Zone saisie : nombre décimal de 0 à 4294967295 (« 1 ») ou notation
 * pointée (« 0.0.0.1 ») ; renvoie la notation pointée, ou null.
 */
export function parseOspfArea(text: string): string | null {
  const value = text.trim();
  if (/^\d{1,10}$/.test(value)) {
    const number = Number(value);
    return number <= 0xffffffff ? formatIpv4(number) : null;
  }
  const dotted = parseIpv4(value);
  return dotted === null ? null : formatIpv4(dotted);
}

/** Vrai pour la dorsale (0.0.0.0). */
export function isBackboneArea(area: string): boolean {
  return area === OSPF_BACKBONE_AREA;
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
