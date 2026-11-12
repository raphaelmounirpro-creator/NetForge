/**
 * VLAN IEEE 802.1Q (format version 5) : constantes et fonctions partagées
 * par la validation, le moteur, la console et l'interface.
 *
 * - Un port de switch absent de `switchports` est en accès dans le VLAN 1.
 * - Une sous-interface de routeur se nomme « <port>.<vlan> » (ge0.10) : son
 *   numéro est le VLAN qu'elle encapsule (simplification documentée dans
 *   docs/protocols/vlan.md ; les équipements réels séparent les deux).
 */
export const VLAN_MIN = 1;
export const VLAN_MAX = 4094;
export const DEFAULT_VLAN = 1;

export type Switchport =
  | { readonly mode: "access"; readonly vlan: number }
  | { readonly mode: "trunk"; readonly nativeVlan: number; readonly allowedVlans: "all" | readonly number[] };

export const DEFAULT_SWITCHPORT: Switchport = { mode: "access", vlan: DEFAULT_VLAN };

export function isVlanId(value: number): boolean {
  return Number.isInteger(value) && value >= VLAN_MIN && value <= VLAN_MAX;
}

const SUBINTERFACE = /^([a-z]{1,8}\d{0,3})\.(\d{1,4})$/;

/** Sous-interface « ge0.10 » : port parent et VLAN ; null pour un port physique ou un nom invalide. */
export function parseSubinterface(id: string): { readonly parent: string; readonly vlan: number } | null {
  const match = SUBINTERFACE.exec(id);
  if (!match?.[1] || !match[2]) return null;
  const vlan = Number(match[2]);
  return isVlanId(vlan) && String(vlan) === match[2] ? { parent: match[1], vlan } : null;
}

export function subinterfaceId(parent: string, vlan: number): string {
  return `${parent}.${String(vlan)}`;
}

/** Configuration effective d'un port de switch (accès VLAN 1 par défaut). */
export function switchportOf(switchports: Readonly<Record<string, Switchport>> | undefined, portId: string): Switchport {
  return switchports?.[portId] ?? DEFAULT_SWITCHPORT;
}

/** Le port transporte-t-il ce VLAN ? (accès : son VLAN ; trunk : natif ou autorisé). */
export function carriesVlan(port: Switchport, vlan: number): boolean {
  if (port.mode === "access") return port.vlan === vlan;
  return port.allowedVlans === "all" || port.allowedVlans.includes(vlan) || port.nativeVlan === vlan;
}

/** Liste de VLAN triée et sans doublon. */
export function normalizeVlans(vlans: readonly number[]): number[] {
  return [...new Set(vlans)].sort((a, b) => a - b);
}

/** « 10,20,30-35 » : liste lisible, plages consécutives regroupées. */
export function formatVlanList(vlans: "all" | readonly number[]): string {
  if (vlans === "all") return "all";
  const sorted = normalizeVlans(vlans);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index] ?? 0;
    let end = start;
    while (sorted[index + 1] === end + 1) {
      end += 1;
      index += 1;
    }
    parts.push(end > start + 1 ? `${String(start)}-${String(end)}` : end === start + 1 ? `${String(start)},${String(end)}` : String(start));
  }
  return parts.join(",");
}

/** Lit « all » ou une liste « 10,20,30-35 » ; null si un élément est invalide. */
export function parseVlanList(text: string): "all" | number[] | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "all") return "all";
  if (trimmed === "") return null;
  const vlans: number[] = [];
  for (const part of trimmed.split(",")) {
    const range = /^\s*(\d{1,4})\s*(?:-\s*(\d{1,4})\s*)?$/.exec(part);
    if (!range?.[1]) return null;
    const start = Number(range[1]);
    const end = range[2] === undefined ? start : Number(range[2]);
    if (!isVlanId(start) || !isVlanId(end) || end < start) return null;
    for (let vlan = start; vlan <= end; vlan += 1) vlans.push(vlan);
  }
  return normalizeVlans(vlans);
}
