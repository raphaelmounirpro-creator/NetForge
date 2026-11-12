import { error, type Issue } from "./issues.js";
import { parseIpv4 } from "./ipv4.js";

/**
 * DHCP (format version 6) : plages d'un serveur sur routeur et adressage
 * automatique des postes. Constantes et analyse des saisies partagées par la
 * validation, les commandes, la console et l'interface. Voir
 * docs/protocols/dhcp.md.
 */

/** Durée de bail : de 1 minute à 7 jours (bornes de NetForge) ; 1 jour par défaut. */
export const DHCP_LEASE_MIN = 60;
export const DHCP_LEASE_MAX = 7 * 24 * 60 * 60;
export const DHCP_LEASE_DEFAULT = 24 * 60 * 60;

export interface DhcpPool {
  /** Première et dernière adresse distribuées (incluses). */
  readonly start: string;
  readonly end: string;
  /** Passerelle annoncée aux postes (option 3, Router). */
  readonly gateway: string;
  /** Durée du bail en secondes (option 51). */
  readonly leaseSeconds: number;
}

export function isDhcpLease(value: number): boolean {
  return Number.isInteger(value) && value >= DHCP_LEASE_MIN && value <= DHCP_LEASE_MAX;
}

const UNITS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400, j: 86400 };

/**
 * Durée saisie : nombre de secondes (« 3600 ») ou nombre suivi d'une unité
 * (« 90s », « 30m », « 12h », « 1d » ou « 1j »). null si la saisie est invalide.
 */
export function parseLeaseDuration(text: string): number | null {
  const match = /^(\d{1,7})\s*([smhdj]?)$/i.exec(text.trim());
  if (!match) return null;
  const unit = UNITS[(match[2] ?? "").toLowerCase() || "s"] ?? 1;
  const value = Number(match[1]) * unit;
  return Number.isSafeInteger(value) ? value : null;
}

/** Durée dans la plus grande unité exacte : « 1d », « 12h », « 30m » ou « 90s ». */
export function formatLeaseDuration(seconds: number): string {
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60]] as const) {
    if (seconds % size === 0) return `${String(seconds / size)}${unit}`;
  }
  return `${String(seconds)}s`;
}

/** Nombre d'adresses de la plage (0 si elle est inversée ou invalide). */
export function poolSize(pool: Pick<DhcpPool, "start" | "end">): number {
  const start = parseIpv4(pool.start);
  const end = parseIpv4(pool.end);
  return start === null || end === null || end < start ? 0 : end - start + 1;
}

export function inPool(pool: Pick<DhcpPool, "start" | "end">, address: number): boolean {
  const start = parseIpv4(pool.start);
  const end = parseIpv4(pool.end);
  return start !== null && end !== null && address >= start && address <= end;
}

/**
 * Analyse une saisie de plage (formulaire et console) : adresses de début et
 * de fin, passerelle et durée de bail. La cohérence avec l'interface du
 * routeur (réseau, adresses attribuables) est vérifiée par la validation.
 */
export function parseDhcpPoolInput(input: {
  start: string;
  end: string;
  gateway: string;
  lease: string;
}): { ok: true; pool: DhcpPool } | { ok: false; errors: Issue[] } {
  const errors: Issue[] = [];
  const start = input.start.trim();
  const end = input.end.trim();
  const gateway = input.gateway.trim();
  for (const value of [start, end, gateway]) {
    if (parseIpv4(value) === null) errors.push(error("ipv4.invalid-address", { value }));
  }
  const leaseSeconds = parseLeaseDuration(input.lease);
  if (leaseSeconds === null || !isDhcpLease(leaseSeconds)) {
    errors.push(error("dhcp.invalid-lease", { value: input.lease.trim(), min: DHCP_LEASE_MIN, max: DHCP_LEASE_MAX }));
  }
  if (errors.length > 0 || leaseSeconds === null) return { ok: false, errors };
  return { ok: true, pool: { start, end, gateway, leaseSeconds } };
}
