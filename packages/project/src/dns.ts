import { error, type Issue } from "./issues.js";
import { isIpv4Address, unassignableReason } from "./ipv4.js";

/**
 * Sous-ensemble DNS de NetForge (docs/protocols/dns.md) : noms d'hôtes ASCII
 * et enregistrements A tenus par un routeur, résolus par les postes.
 */
export const DNS_MAX_RECORDS = 100;
/** Nom complet : 253 caractères au plus en notation texte (255 octets encodés, RFC 1035 §2.3.4). */
export const DNS_NAME_MAX_LENGTH = 253;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Forme canonique d'un nom d'hôte, ou null s'il est invalide. Casse ignorée,
 * point final accepté. Labels de 1 à 63 caractères (lettres, chiffres, trait
 * d'union, ni en tête ni en fin ; premier caractère chiffre admis, RFC 1123 §2.1).
 * Le dernier label contient une lettre : un nom ne prend jamais la forme d'une adresse.
 */
export function normalizeDnsName(value: string): string | null {
  const name = value.trim().replace(/\.$/, "").toLowerCase();
  if (name.length === 0 || name.length > DNS_NAME_MAX_LENGTH || RESERVED_KEYS.has(name)) return null;
  const labels = name.split(".");
  if (!labels.every((label) => LABEL.test(label))) return null;
  return /[a-z]/.test(labels.at(-1) ?? "") ? name : null;
}

/** Adresse publiable ou utilisable comme serveur : adresse d'hôte IPv4 attribuable. */
export function isDnsAddress(value: string): boolean {
  return isIpv4Address(value) && unassignableReason({ address: value, prefixLength: 32 }) === null;
}

/** Enregistrements triés par nom (affichage, configuration rejouable). */
export function sortedDnsRecords(records: Readonly<Record<string, string>>): Array<{ name: string; address: string }> {
  return Object.entries(records)
    .map(([name, address]) => ({ name, address }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export type DnsRecordInput = { ok: true; name: string; address: string } | { ok: false; errors: Issue[] };

/** Saisie d'un enregistrement (formulaire ou console) : chaque valeur invalide est signalée. */
export function parseDnsRecordInput(name: string, address: string): DnsRecordInput {
  const errors: Issue[] = [];
  const normalized = normalizeDnsName(name);
  if (normalized === null) errors.push(error("dns.invalid-name", { value: name.trim() }));
  const trimmed = address.trim();
  if (!isDnsAddress(trimmed)) errors.push(error("dns.invalid-address", { value: trimmed }));
  return errors.length > 0 || normalized === null ? { ok: false, errors } : { ok: true, name: normalized, address: trimmed };
}
