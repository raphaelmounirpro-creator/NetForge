/**
 * Outils IPv4 purs : analyse stricte, masques, réseaux.
 * Une adresse est manipulée comme un entier non signé 32 bits.
 */

export interface Ipv4Interface {
  /** Adresse en notation décimale pointée, ex. « 192.168.1.10 ». */
  address: string;
  /** Longueur de préfixe, de 0 à 32 (masque 255.255.255.0 = 24). */
  prefixLength: number;
}

const OCTET = /^(0|[1-9]\d{0,2})$/;

/**
 * Analyse une adresse en notation décimale pointée stricte.
 * Les zéros non significatifs (« 010 ») sont refusés : certains outils les
 * lisent en octal, ce qui serait source de confusion.
 */
export function parseIpv4(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function isIpv4Address(text: string): boolean {
  return parseIpv4(text) !== null;
}

export function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => String((value >>> shift) & 0xff)).join(".");
}

/** Masque sous forme d'entier pour une longueur de préfixe. */
export function prefixToMaskValue(prefixLength: number): number {
  return prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
}

export function prefixToMask(prefixLength: number): string {
  return formatIpv4(prefixToMaskValue(prefixLength));
}

/**
 * Accepte « 24 », « /24 » ou « 255.255.255.0 ».
 * Refuse un masque décimal non contigu (ex. 255.0.255.0).
 */
export function parsePrefixOrMask(text: string): number | null {
  const trimmed = text.trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(trimmed)) {
    const prefix = Number(trimmed);
    return prefix <= 32 ? prefix : null;
  }
  const mask = parseIpv4(trimmed);
  if (mask === null) return null;
  for (let prefix = 0; prefix <= 32; prefix += 1) {
    if (prefixToMaskValue(prefix) === mask) return prefix;
  }
  return null;
}

export function networkAddress(address: number, prefixLength: number): number {
  return (address & prefixToMaskValue(prefixLength)) >>> 0;
}

export function broadcastAddress(address: number, prefixLength: number): number {
  return (networkAddress(address, prefixLength) | (~prefixToMaskValue(prefixLength) >>> 0)) >>> 0;
}

/** Notation CIDR du réseau, ex. « 192.168.1.0/24 ». */
export function networkCidr(config: Ipv4Interface): string {
  const address = parseIpv4(config.address) ?? 0;
  return `${formatIpv4(networkAddress(address, config.prefixLength))}/${String(config.prefixLength)}`;
}

export function inSameSubnet(a: number, b: number, prefixLength: number): boolean {
  return networkAddress(a, prefixLength) === networkAddress(b, prefixLength);
}

/** Deux réseaux se chevauchent si l'un contient l'autre. */
export function subnetsOverlap(a: Ipv4Interface, b: Ipv4Interface): boolean {
  const addressA = parseIpv4(a.address);
  const addressB = parseIpv4(b.address);
  if (addressA === null || addressB === null) return false;
  const shortest = Math.min(a.prefixLength, b.prefixLength);
  return inSameSubnet(addressA, addressB, shortest);
}

export type UnassignableReason =
  | "this-network"
  | "loopback"
  | "multicast"
  | "reserved"
  | "network-address"
  | "broadcast-address";

/**
 * Raison pour laquelle une adresse ne peut pas être attribuée à une interface,
 * ou null si elle est attribuable. Plages : RFC 1122 (0/8, 127/8),
 * RFC 5771 (224/4), RFC 1112 (240/4). /31 (RFC 3021) et /32 n'ont pas
 * d'adresse de réseau ni de diffusion.
 */
export function unassignableReason(config: Ipv4Interface): UnassignableReason | null {
  const address = parseIpv4(config.address);
  if (address === null) return "reserved";
  const firstOctet = address >>> 24;
  if (firstOctet === 0) return "this-network";
  if (firstOctet === 127) return "loopback";
  if (firstOctet >= 224 && firstOctet <= 239) return "multicast";
  if (firstOctet >= 240) return "reserved";
  if (config.prefixLength <= 30) {
    if (address === networkAddress(address, config.prefixLength)) return "network-address";
    if (address === broadcastAddress(address, config.prefixLength)) return "broadcast-address";
  }
  return null;
}
