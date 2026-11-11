import { getModel, isOptical, type NfgDocument } from "@netforge/project";

/** Sérialisation à clés triées : deux objets égaux donnent toujours le même texte. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Empreinte de la partie simulée d'un projet : équipements Ethernet/IP, câbles
 * cuivre et configurations. La disposition, les métadonnées et le réseau
 * optique (analysé à part, sans simulation) en sont exclus : déplacer un
 * symbole, renommer le projet, régler une fibre ou injecter une panne optique
 * n'impose pas de réinitialiser la simulation (D-022, D-036).
 */
export function networkFingerprint(doc: NfgDocument): string {
  const devices = doc.topology.devices.filter((device) => !isOptical(getModel(device.model).kind));
  const ids = new Set(devices.map((device) => device.id));
  return canonical({
    devices,
    links: doc.topology.links.filter((link) => link.fiber === null),
    configurations: Object.fromEntries(Object.entries(doc.configurations).filter(([id]) => ids.has(id))),
  });
}
