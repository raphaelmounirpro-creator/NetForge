import { getModel, type DeviceModelId } from "./catalog.js";

/**
 * Réseau d'accès PON (format version 13) : technologie d'un OLT ou d'un ONT,
 * numéro de série des ONT et ONT autorisés par port d'OLT. Voir
 * docs/protocols/pon.md.
 */
export const PON_TECHNOLOGIES = ["gpon", "xgs-pon"] as const;
export type PonTechnology = (typeof PON_TECHNOLOGIES)[number];

/**
 * Plus grand identifiant d'ONU attribuable : 0 à 253 en GPON (UIT-T G.984.3
 * §9.1.1), 0 à 1 020 en XGS-PON (UIT-T G.9807.1 §C.11.2.1).
 */
export const ONU_ID_MAX: Readonly<Record<PonTechnology, number>> = { gpon: 253, "xgs-pon": 1020 };

/** ONT autorisés par port d'OLT (borne NetForge). */
export const PON_MAX_AUTHORIZATIONS = 128;

/**
 * Code fabricant des ONT créés dans NetForge : fictif, non tiré du registre
 * ATIS-0300220 qui attribue les vrais codes.
 */
export const NETFORGE_VENDOR_ID = "NFGE";

/**
 * Numéro de série : Vendor_ID (quatre lettres majuscules) suivi du numéro
 * propre au fabricant, quatre octets écrits en huit chiffres hexadécimaux
 * (G.984.3 §9.2.4.1, G.9807.1 §C.11.2.6).
 */
export const PON_SERIAL_PATTERN = /^[A-Z]{4}[0-9A-F]{8}$/;

export interface PonAuthorization {
  readonly serial: string;
  readonly onuId: number;
}

/** Numéro de série saisi (espaces et casse tolérés), ou null s'il est mal formé. */
export function normalizePonSerial(text: string): string | null {
  const serial = text.trim().toUpperCase();
  return PON_SERIAL_PATTERN.test(serial) ? serial : null;
}

/** Numéro de série NetForge d'ordre n (1 → NFGE00000001). */
export function formatPonSerial(index: number): string {
  return `${NETFORGE_VENDOR_ID}${index.toString(16).toUpperCase().padStart(8, "0")}`;
}

/** Plus petit numéro de série NetForge absent de la liste. */
export function nextPonSerial(used: Iterable<string>): string {
  const taken = new Set(used);
  let index = 1;
  while (taken.has(formatPonSerial(index))) index += 1;
  return formatPonSerial(index);
}

/** Technologie PON d'un modèle d'OLT ou d'ONT ; null pour les autres équipements. */
export function ponTechnologyOf(modelId: DeviceModelId): PonTechnology | null {
  const optical = getModel(modelId).optical;
  if (optical === undefined) return null;
  return optical.startsWith("xgs-pon") ? "xgs-pon" : "gpon";
}

export function isOnuId(technology: PonTechnology, value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= ONU_ID_MAX[technology];
}

/** Plus petit identifiant d'ONU libre d'un port, ou null si tous sont pris. */
export function lowestFreeOnuId(technology: PonTechnology, authorizations: readonly PonAuthorization[]): number | null {
  const used = new Set(authorizations.map((item) => item.onuId));
  for (let id = 0; id <= ONU_ID_MAX[technology]; id += 1) if (!used.has(id)) return id;
  return null;
}
