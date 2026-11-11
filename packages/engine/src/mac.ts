/**
 * Adresses MAC simulées.
 *
 * Le projet ne stocke pas d'adresse MAC : chaque port reçoit une adresse
 * « administrée localement » (premier octet 02 : bit U/L à 1, bit de groupe
 * à 0 ; voir docs/protocols/ethernet-commutation.md) dérivée de
 * l'identifiant de l'équipement et du port. Elle reste donc identique
 * d'une session et d'une simulation à l'autre pour le même projet.
 */
export type MacAddress = string;

export const BROADCAST_MAC: MacAddress = "ff:ff:ff:ff:ff:ff";

/** FNV-1a 32 bits : hachage simple et stable, sans dépendance. */
function fnv1a(text: string, offset = 0x811c9dc5): number {
  let hash = offset >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const hex = (value: number) => value.toString(16).padStart(2, "0");

/** 02:xx suivi de 32 bits de hachage : 40 bits dérivés de la clé et du numéro d'essai. */
function candidate(key: string, attempt: number): MacAddress {
  const text = `${key}#${String(attempt)}`;
  const high = fnv1a(text, 0x050c5d1f) & 0xff;
  const low = fnv1a(text);
  return ["02", hex(high), hex(low >>> 24), hex((low >>> 16) & 0xff), hex((low >>> 8) & 0xff), hex(low & 0xff)].join(":");
}

/**
 * Attribue une adresse unique à chaque clé « équipement/port ». Les clés sont
 * traitées dans l'ordre lexicographique : une collision (très improbable)
 * se résout toujours de la même façon, quel que soit l'ordre du document.
 */
export function assignMacs(keys: readonly string[]): Map<string, MacAddress> {
  const result = new Map<string, MacAddress>();
  const used = new Set<MacAddress>([BROADCAST_MAC]);
  for (const key of [...keys].sort()) {
    let attempt = 0;
    let mac = candidate(key, attempt);
    while (used.has(mac)) {
      attempt += 1;
      mac = candidate(key, attempt);
    }
    used.add(mac);
    result.set(key, mac);
  }
  return result;
}
