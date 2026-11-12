/**
 * Spanning Tree 802.1D (format version 5) : constantes partagées par la
 * validation, le moteur, la console et l'interface. Priorité de 0 à 61440
 * par pas de 4096 (RFC 4188, objet dot1dStpPriority, ponts 802.1t/802.1w) ;
 * défaut 32768 (valeur usuelle d'IEEE 802.1D, non consultée directement).
 * Voir docs/protocols/stp.md.
 */
export const STP_DEFAULT_PRIORITY = 32768;
export const STP_PRIORITY_STEP = 4096;
export const STP_PRIORITY_MAX = 61440;

export function isStpPriority(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= STP_PRIORITY_MAX && value % STP_PRIORITY_STEP === 0;
}
