/**
 * VRRP version 3 pour IPv4 (format version 10) : un groupe par interface de
 * routeur, identifié par son VRID et son adresse virtuelle (passerelle des
 * postes). Voir docs/protocols/vrrp.md et RFC 5798.
 */
export const VRID_MIN = 1;
export const VRID_MAX = 255;
/** Priorité d'un routeur de secours : 1 à 254, 100 par défaut (RFC 5798 §5.2.4) ; 255 est réservée au propriétaire de l'adresse. */
export const VRRP_PRIORITY_MIN = 1;
export const VRRP_PRIORITY_MAX = 254;
export const VRRP_DEFAULT_PRIORITY = 100;
export const VRRP_OWNER_PRIORITY = 255;

export interface VrrpGroup {
  readonly vrid: number;
  /** Adresse IPv4 virtuelle, dans le réseau de l'interface. */
  readonly address: string;
  /** Priorité configurée (1 à 254) ; le propriétaire de l'adresse utilise 255. */
  readonly priority: number;
  /** Préemption : un routeur de priorité plus haute reprend le rôle de maître (vrai par défaut, RFC 5798 §6.1). */
  readonly preempt: boolean;
}

export function isVrid(value: number): boolean {
  return Number.isInteger(value) && value >= VRID_MIN && value <= VRID_MAX;
}

export function isVrrpPriority(value: number): boolean {
  return Number.isInteger(value) && value >= VRRP_PRIORITY_MIN && value <= VRRP_PRIORITY_MAX;
}
