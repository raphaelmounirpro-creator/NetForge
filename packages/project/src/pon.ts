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

/**
 * Services d'un réseau d'accès (format version 14) : chacun circule dans son
 * VLAN entre l'OLT et le réseau de l'opérateur. L'IPTV est une diffusion
 * descendante (multicast) : aucun flux montant.
 */
export const PON_SERVICES = ["internet", "voip", "iptv"] as const;
export type PonService = (typeof PON_SERVICES)[number];

/** Débit garanti ou maximal d'un service, en kbit/s (borne NetForge : 10 Gbit/s). */
export const PON_RATE_MAX_KBPS = 10_000_000;

export interface PonRate {
  readonly guaranteedKbps: number;
  readonly maxKbps: number;
}

export interface PonServiceProfile {
  readonly vlan: number;
  readonly downstream: PonRate;
  /** null pour l'IPTV, service seulement descendant. */
  readonly upstream: PonRate | null;
}

export interface PonAuthorization {
  readonly serial: string;
  readonly onuId: number;
  /** Services souscrits par l'abonné (offre), dans l'ordre de PON_SERVICES. */
  readonly services: readonly PonService[];
}

export const isDownstreamOnly = (service: PonService): boolean => service === "iptv";

export function isPonService(value: string): value is PonService {
  return (PON_SERVICES as readonly string[]).includes(value);
}

/** Liste de services sans doublon, dans l'ordre canonique. */
export function normalizeServices(services: Iterable<PonService>): PonService[] {
  const set = new Set(services);
  return PON_SERVICES.filter((service) => set.has(service));
}

/** « internet,voip » ou « none » ; null si un nom est inconnu. */
export function parseServiceList(text: string): PonService[] | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "none") return [];
  const names = trimmed.split(",").map((name) => name.trim());
  if (names.some((name) => !isPonService(name))) return null;
  return normalizeServices(names as PonService[]);
}

/** Débit saisi en Mbit/s (« 100 », « 0,2 », « 0.2 » ; trois décimales au plus) converti en kbit/s, ou null. */
export function parseMbps(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(value)) return null;
  const kbps = Math.round(Number(value) * 1000);
  return kbps <= PON_RATE_MAX_KBPS ? kbps : null;
}

/** « garanti/max » en Mbit/s, garanti ≤ max et max > 0 ; null sinon. */
export function parseRateInput(text: string): PonRate | null {
  const [guaranteed = "", max = "", ...rest] = text.split("/");
  if (rest.length > 0) return null;
  const guaranteedKbps = parseMbps(guaranteed);
  const maxKbps = parseMbps(max);
  if (guaranteedKbps === null || maxKbps === null || maxKbps === 0 || guaranteedKbps > maxKbps) return null;
  return { guaranteedKbps, maxKbps };
}

/** Débit en Mbit/s pour la console (« 0.2 », « 100 »). */
export function formatMbpsInput(kbps: number): string {
  return String(kbps / 1000);
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
export function lowestFreeOnuId(technology: PonTechnology, authorizations: readonly { readonly onuId: number }[]): number | null {
  const used = new Set(authorizations.map((item) => item.onuId));
  for (let id = 0; id <= ONU_ID_MAX[technology]; id += 1) if (!used.has(id)) return id;
  return null;
}
