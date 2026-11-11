import type { NfgDocument } from "@netforge/project";

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
 * Empreinte de la partie simulée d'un projet : topologie et configurations.
 * La disposition et les métadonnées en sont exclues : déplacer un symbole ou
 * renommer le projet n'impose pas de réinitialiser la simulation (D-022).
 */
export function networkFingerprint(doc: NfgDocument): string {
  return canonical({ topology: doc.topology, configurations: doc.configurations });
}
