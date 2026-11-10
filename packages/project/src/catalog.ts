/**
 * Catalogue des modèles d'équipements génériques NetForge.
 *
 * Les ports sont définis par le modèle : le document de projet ne stocke que
 * l'identifiant du modèle. Toute modification des ports d'un modèle existant
 * impose d'incrémenter CATALOG_VERSION et d'écrire une migration.
 */
export const CATALOG_VERSION = 1;

export type DeviceKind = "pc" | "switch" | "router";

/**
 * Connectique physique d'un port. Phase 1 : cuivre RJ45 uniquement, donc
 * tout port libre peut être relié à tout autre. La règle de compatibilité
 * des connectiques arrivera avec le second type (fibre, phase 4).
 */
export type PortMedium = "rj45";

export interface PortSpec {
  id: string;
  medium: PortMedium;
  speedMbps: number;
}

export interface DeviceModelSpec {
  kind: DeviceKind;
  /** Préfixe des noms attribués automatiquement (PC1, SW1, R1…). */
  namePrefix: string;
  /** Vrai si les ports portent une configuration IPv4. */
  ipCapable: boolean;
  ports: readonly PortSpec[];
}

function rj45Ports(prefix: string, from: number, to: number): PortSpec[] {
  const ports: PortSpec[] = [];
  for (let index = from; index <= to; index += 1) {
    ports.push({ id: `${prefix}${String(index)}`, medium: "rj45", speedMbps: 1000 });
  }
  return ports;
}

export const DEVICE_MODELS = {
  PC: { kind: "pc", namePrefix: "PC", ipCapable: true, ports: rj45Ports("eth", 0, 0) },
  "S-24": { kind: "switch", namePrefix: "SW", ipCapable: false, ports: rj45Ports("ge", 1, 24) },
  "R-200": { kind: "router", namePrefix: "R", ipCapable: true, ports: rj45Ports("ge", 0, 3) },
} as const satisfies Record<string, DeviceModelSpec>;

export type DeviceModelId = keyof typeof DEVICE_MODELS;

export const DEVICE_MODEL_IDS = Object.keys(DEVICE_MODELS) as [DeviceModelId, ...DeviceModelId[]];

export function getModel(modelId: DeviceModelId): DeviceModelSpec {
  return DEVICE_MODELS[modelId];
}

export function findPort(modelId: DeviceModelId, portId: string): PortSpec | undefined {
  return getModel(modelId).ports.find((port) => port.id === portId);
}
