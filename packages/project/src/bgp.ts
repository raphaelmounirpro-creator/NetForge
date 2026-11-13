/**
 * BGP-4 simplifié (format version 12) : un système autonome (AS) par routeur,
 * voisins externes directement connectés et réseaux annoncés. Numéro d'AS
 * sur 2 octets, comme le champ « My Autonomous System » de l'OPEN
 * (RFC 4271 §4.2). Voir docs/protocols/bgp.md.
 */
export const BGP_AS_MIN = 1;
export const BGP_AS_MAX = 65535;
/** Voisins et réseaux annoncés par routeur (bornes NetForge). */
export const BGP_MAX_NEIGHBORS = 16;
export const BGP_MAX_NETWORKS = 32;

export interface BgpNeighbor {
  readonly address: string;
  readonly remoteAs: number;
}

export interface BgpNetwork {
  /** Adresse du réseau (bits d'hôte à zéro) et longueur du préfixe. */
  readonly address: string;
  readonly prefixLength: number;
}

export interface BgpConfig {
  readonly as: number;
  readonly neighbors: readonly BgpNeighbor[];
  readonly networks: readonly BgpNetwork[];
}

export function isBgpAs(value: number): boolean {
  return Number.isInteger(value) && value >= BGP_AS_MIN && value <= BGP_AS_MAX;
}
