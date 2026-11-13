/**
 * Catalogue des modèles d'équipements génériques NetForge.
 *
 * Les ports sont définis par le modèle : le document de projet ne stocke que
 * l'identifiant du modèle. Toute modification des ports d'un modèle existant
 * impose d'incrémenter CATALOG_VERSION et d'écrire une migration.
 * Version 2 : ajout des équipements FTTH (aucun modèle existant modifié).
 * Version 3 : ajout de l'OLT et de l'ONT XGS-PON (aucun modèle existant modifié).
 */
export const CATALOG_VERSION = 3;

export type DeviceKind = "pc" | "switch" | "router" | "olt" | "ont" | "odf" | "splitter" | "pbo" | "pto" | "splice-box";

/** Connectique physique : un câble ne relie que deux ports de même support. */
export type PortMedium = "rj45" | "fiber";

/** Connecteur optique : format (SC, LC) et polissage (APC angle, UPC droit). */
export type FiberConnector = "SC/APC" | "SC/UPC" | "LC/APC" | "LC/UPC";

export interface PortSpec {
  id: string;
  medium: PortMedium;
  /** Débit d'un port cuivre (Mb/s) ; 0 pour un port fibre (non simulé en Ethernet). */
  speedMbps: number;
  /**
   * Port fibre à connecteur (une jarretière s'y branche : connexion appariée),
   * ou null pour une entrée de câble, dont la fibre est épissurée à l'intérieur.
   */
  connector: FiberConnector | null;
}

/** Élément optique traversé à l'intérieur d'un équipement passif. */
export type OpticalElementSpec = { readonly kind: "splice"; readonly port: string } | { readonly kind: "coupler"; readonly ratio: number };

/** Chemin interne entre deux ports d'un équipement passif, avec ses éléments (dans le sens from → to). */
export interface ChannelSpec {
  readonly from: string;
  readonly to: string;
  readonly elements: readonly OpticalElementSpec[];
}

/** Profils d'émetteur-récepteur : GPON classe B+ (UIT-T G.984.2) et XGS-PON classe N1 (UIT-T G.9807.1). */
export type OpticalProfileId = "gpon-b+-olt" | "gpon-b+-ont" | "xgs-pon-n1-olt" | "xgs-pon-n1-ont";

export interface DeviceModelSpec {
  kind: DeviceKind;
  /** Préfixe des noms attribués automatiquement (PC1, SW1, R1…). */
  namePrefix: string;
  /** Vrai si les ports portent une configuration IPv4. */
  ipCapable: boolean;
  ports: readonly PortSpec[];
  /** Équipements passifs : chemins internes entre ports. */
  channels?: readonly ChannelSpec[];
  /** Émetteur-récepteur optique (OLT, ONT). */
  optical?: OpticalProfileId;
}

function rj45Ports(prefix: string, from: number, to: number): PortSpec[] {
  const ports: PortSpec[] = [];
  for (let index = from; index <= to; index += 1) {
    ports.push({ id: `${prefix}${String(index)}`, medium: "rj45", speedMbps: 1000, connector: null });
  }
  return ports;
}

function fiberPorts(prefix: string, count: number, connector: FiberConnector | null): PortSpec[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(index + 1)}`, medium: "fiber" as const, speedMbps: 0, connector }));
}

/** Chemins « une entrée → une sortie », avec une épissure côté entrée. */
function spliceChannels(fromPrefix: string, toPrefix: string, count: number): ChannelSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    from: `${fromPrefix}${String(index + 1)}`,
    to: `${toPrefix}${String(index + 1)}`,
    elements: [{ kind: "splice" as const, port: `${fromPrefix}${String(index + 1)}` }],
  }));
}

/**
 * Coupleur 1:N : la fibre d'entrée et chaque fibre de sortie sont épissurées
 * aux amorces du coupleur ; chaque chemin entrée → sortie traverse donc une
 * épissure, le coupleur, puis une seconde épissure.
 */
function splitter(ratio: number): DeviceModelSpec {
  const outputs = fiberPorts("o", ratio, null);
  return {
    kind: "splitter",
    namePrefix: "CPL",
    ipCapable: false,
    ports: [{ id: "com", medium: "fiber", speedMbps: 0, connector: null }, ...outputs],
    channels: outputs.map((output) => ({
      from: "com",
      to: output.id,
      elements: [{ kind: "splice", port: "com" }, { kind: "coupler", ratio }, { kind: "splice", port: output.id }],
    })),
  };
}

export const DEVICE_MODELS = {
  PC: { kind: "pc", namePrefix: "PC", ipCapable: true, ports: rj45Ports("eth", 0, 0) },
  "S-24": { kind: "switch", namePrefix: "SW", ipCapable: false, ports: rj45Ports("ge", 1, 24) },
  "R-200": { kind: "router", namePrefix: "R", ipCapable: true, ports: rj45Ports("ge", 0, 3) },
  "OLT-16": { kind: "olt", namePrefix: "OLT", ipCapable: false, ports: fiberPorts("pon", 16, "SC/UPC"), optical: "gpon-b+-olt" },
  "OLT-XGS-8": { kind: "olt", namePrefix: "OLT", ipCapable: false, ports: fiberPorts("pon", 8, "SC/UPC"), optical: "xgs-pon-n1-olt" },
  "ONT-1G": { kind: "ont", namePrefix: "ONT", ipCapable: false, ports: [{ id: "pon", medium: "fiber", speedMbps: 0, connector: "SC/APC" }], optical: "gpon-b+-ont" },
  "ONT-10G": { kind: "ont", namePrefix: "ONT", ipCapable: false, ports: [{ id: "pon", medium: "fiber", speedMbps: 0, connector: "SC/APC" }], optical: "xgs-pon-n1-ont" },
  "ODF-12": {
    kind: "odf",
    namePrefix: "ODF",
    ipCapable: false,
    // Arrière : entrées de câble épissurées ; avant : connecteurs pour les jarretières.
    ports: [...fiberPorts("r", 12, null), ...fiberPorts("f", 12, "SC/APC")],
    channels: spliceChannels("r", "f", 12),
  },
  "SPL-2": splitter(2),
  "SPL-4": splitter(4),
  "SPL-8": splitter(8),
  "SPL-16": splitter(16),
  "SPL-32": splitter(32),
  "SPL-64": splitter(64),
  "PBO-8": {
    kind: "pbo",
    namePrefix: "PBO",
    ipCapable: false,
    ports: [...fiberPorts("in", 8, null), ...fiberPorts("out", 8, null)],
    channels: spliceChannels("in", "out", 8),
  },
  PTO: {
    kind: "pto",
    namePrefix: "PTO",
    ipCapable: false,
    // Câble de raccordement épissuré à l'arrière, prise à connecteur côté client.
    ports: [
      { id: "in", medium: "fiber", speedMbps: 0, connector: null },
      { id: "out", medium: "fiber", speedMbps: 0, connector: "SC/APC" },
    ],
    channels: [{ from: "in", to: "out", elements: [{ kind: "splice", port: "in" }] }],
  },
  "BPE-12": {
    kind: "splice-box",
    namePrefix: "BPE",
    ipCapable: false,
    ports: [...fiberPorts("a", 12, null), ...fiberPorts("b", 12, null)],
    channels: spliceChannels("a", "b", 12),
  },
} as const satisfies Record<string, DeviceModelSpec>;

export type DeviceModelId = keyof typeof DEVICE_MODELS;

export const DEVICE_MODEL_IDS = Object.keys(DEVICE_MODELS) as [DeviceModelId, ...DeviceModelId[]];

export function getModel(modelId: DeviceModelId): DeviceModelSpec {
  return DEVICE_MODELS[modelId];
}

export function findPort(modelId: DeviceModelId, portId: string): PortSpec | undefined {
  return getModel(modelId).ports.find((port) => port.id === portId);
}

/** Vrai pour les équipements du réseau optique (aucun trafic Ethernet simulé). */
export function isOptical(kind: DeviceKind): boolean {
  return kind !== "pc" && kind !== "switch" && kind !== "router";
}
