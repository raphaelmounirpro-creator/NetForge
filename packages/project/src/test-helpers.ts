import { addDevice, createProject, type CommandResult } from "./commands.js";
import type { DeviceModelId } from "./catalog.js";
import type { NfgDocument } from "./schema.js";

/** Extrait le document d'un résultat réussi ou fait échouer le test. */
export function expectOk(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(`Commande refusée : ${JSON.stringify(result.errors)}`);
  return result.document;
}

export const NOW = "2026-11-10T12:00:00.000Z";

export function emptyProject(name = "LAN de base"): NfgDocument {
  return expectOk(createProject({ id: "projet-1", name, now: NOW }));
}

/** Projet contenant les équipements demandés, identifiants = noms en minuscules. */
export function projectWith(...devices: Array<[id: string, model: DeviceModelId]>): NfgDocument {
  let doc = emptyProject();
  devices.forEach(([id, model], index) => {
    doc = expectOk(addDevice(doc, { id, model, position: { x: index * 100, y: 0 } }));
  });
  return doc;
}
