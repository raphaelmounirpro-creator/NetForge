import type { OpticalPortRef, OpticalReport } from "./optics.js";

/**
 * Arbre d'un réseau PON (phase 9) : pour chaque port d'OLT, les équipements
 * traversés jusqu'aux ONT (tiroir, coupleurs, PBO, PTO), regroupés par
 * équipement. Construit à partir des chemins du bilan optique : aucune
 * connexion n'est déduite ailleurs.
 */
export interface OpticalTreeNode {
  readonly deviceId: string;
  /** Ports par lesquels la lumière de l'OLT entre dans l'équipement. */
  readonly entryPorts: readonly string[];
  readonly children: readonly OpticalTreeNode[];
  /** ONT desservis par ce nœud (lui-même s'il s'agit d'un ONT). */
  readonly onts: readonly string[];
}

export interface OpticalTree {
  readonly olt: OpticalPortRef;
  readonly children: readonly OpticalTreeNode[];
  readonly onts: readonly string[];
}

interface MutableNode {
  deviceId: string;
  entryPorts: string[];
  children: MutableNode[];
  onts: string[];
}

const addOnce = <T>(list: T[], value: T) => {
  if (!list.includes(value)) list.push(value);
};

export function opticalTree(report: OpticalReport): OpticalTree[] {
  const roots = new Map<string, { olt: OpticalPortRef; children: MutableNode[]; onts: string[] }>();
  for (const path of report.paths) {
    const key = `${path.olt.deviceId}/${path.olt.portId}`;
    const root = roots.get(key) ?? { olt: path.olt, children: [], onts: [] };
    roots.set(key, root);
    addOnce(root.onts, path.ont.deviceId);
    // Équipements traversés après l'OLT, avec le premier port rencontré dans chacun.
    const sequence: { deviceId: string; port: string | null }[] = [];
    for (const { element } of path.elements) {
      if (element.kind === "fiber" || element.deviceId === path.olt.deviceId) continue;
      const port = element.kind === "coupler" ? null : element.portId;
      const last = sequence.at(-1);
      if (last?.deviceId === element.deviceId) {
        last.port ??= port;
        continue;
      }
      sequence.push({ deviceId: element.deviceId, port });
    }
    let level = root.children;
    for (const { deviceId, port } of sequence) {
      let node = level.find((item) => item.deviceId === deviceId);
      if (!node) {
        node = { deviceId, entryPorts: [], children: [], onts: [] };
        level.push(node);
      }
      if (port !== null) addOnce(node.entryPorts, port);
      addOnce(node.onts, path.ont.deviceId);
      level = node.children;
    }
  }
  return [...roots.values()];
}
