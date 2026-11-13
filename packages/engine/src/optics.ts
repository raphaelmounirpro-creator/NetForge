import {
  findPort,
  getModel,
  ponTechnologyOf,
  type Device,
  type Fault,
  type FaultKind,
  type Fiber,
  type FiberConnector,
  type NfgDocument,
  type OpticalProfileId,
  type PonTechnology,
} from "@netforge/project";

/**
 * Bilan optique d'un réseau PON (phase 4 ; XGS-PON en phase 9).
 *
 * Calcul statique, sans événement : pour chaque chemin OLT → ONT, liste des
 * éléments réellement traversés (connexions, fibres, épissures, coupleurs),
 * puis bilan par sens avec la contribution de chaque élément. Les valeurs
 * sont des maximums normatifs vérifiés (docs/protocols/ftth-bilan-optique.md) ;
 * aucune valeur « typique » n'est inventée. Précision interne complète :
 * l'arrondi n'a lieu qu'à l'affichage.
 */

export type Direction = "downstream" | "upstream";

export interface TransceiverProfile {
  readonly id: OpticalProfileId;
  readonly technology: PonTechnology;
  /** Longueur d'onde nominale d'émission, utilisée pour l'affaiblissement de la fibre. */
  readonly txWavelengthNm: number;
  /** Bande d'émission autorisée par la recommandation. */
  readonly txBandNm: readonly [number, number];
  readonly txMinDbm: number;
  readonly txMaxDbm: number;
  readonly rxWavelengthNm: number;
  readonly rxSensitivityDbm: number;
  readonly rxOverloadDbm: number;
  /** Pénalité de trajet optique admise par ce récepteur. */
  readonly rxPathPenaltyDb: number;
  /** Pénalité au-delà de 20 km de fibre (catégorie DD40), ou null si la recommandation n'en distingue pas. */
  readonly rxPathPenaltyLongReachDb: number | null;
}

/**
 * GPON classe B+ : UIT-T G.984.2 (08/2019), §8.2.5 et annexe A, tableau A.1.
 * XGS-PON classe N1 : UIT-T G.9807.1 (02/2023), tableaux B.9.3 (sens
 * descendant : OLT, puis récepteur de l'ONU) et B.9.4 (sens montant).
 */
export const TRANSCEIVER_PROFILES: Readonly<Record<OpticalProfileId, TransceiverProfile>> = {
  "gpon-b+-olt": { id: "gpon-b+-olt", technology: "gpon", txWavelengthNm: 1490, txBandNm: [1480, 1500], txMinDbm: 1.5, txMaxDbm: 5, rxWavelengthNm: 1310, rxSensitivityDbm: -28, rxOverloadDbm: -8, rxPathPenaltyDb: 0.5, rxPathPenaltyLongReachDb: null },
  "gpon-b+-ont": { id: "gpon-b+-ont", technology: "gpon", txWavelengthNm: 1310, txBandNm: [1260, 1360], txMinDbm: 0.5, txMaxDbm: 5, rxWavelengthNm: 1490, rxSensitivityDbm: -27, rxOverloadDbm: -8, rxPathPenaltyDb: 0.5, rxPathPenaltyLongReachDb: null },
  "xgs-pon-n1-olt": { id: "xgs-pon-n1-olt", technology: "xgs-pon", txWavelengthNm: 1577, txBandNm: [1575, 1580], txMinDbm: 2, txMaxDbm: 5, rxWavelengthNm: 1270, rxSensitivityDbm: -26, rxOverloadDbm: -5, rxPathPenaltyDb: 1, rxPathPenaltyLongReachDb: 1 },
  "xgs-pon-n1-ont": { id: "xgs-pon-n1-ont", technology: "xgs-pon", txWavelengthNm: 1270, txBandNm: [1260, 1280], txMinDbm: 4, txMaxDbm: 9, rxWavelengthNm: 1577, rxSensitivityDbm: -28, rxOverloadDbm: -9, rxPathPenaltyDb: 1, rxPathPenaltyLongReachDb: 2 },
};

/** Fibre au-delà de laquelle s'applique la pénalité DD40 (G.9807.1, tableau B.9.3, note 9). */
export const LONG_REACH_THRESHOLD_M = 20_000;

export interface OdnClass {
  readonly id: "B+" | "N1";
  readonly minLossDb: number;
  readonly maxLossDb: number;
}

/**
 * Plage d'affaiblissement du réseau de distribution : classe B+ (G.984.2
 * annexe A, tableau A.2) et classe N1 (G.9807.1, tableau B.6.1).
 */
export const ODN_CLASSES: Readonly<Record<PonTechnology, OdnClass>> = {
  gpon: { id: "B+", minLossDb: 13, maxLossDb: 28 },
  "xgs-pon": { id: "N1", minLossDb: 14, maxLossDb: 29 },
};
export const ODN_CLASS_B_PLUS = ODN_CLASSES.gpon;

/**
 * Pertes nominales. Maximums : G.652 (08/2024) tableau 2 (câble, 1 310–1 625 nm ;
 * G.657.A2 de catégorie A, entièrement conforme à G.652.D), G.671 (11/2025)
 * §6.6 (coupleurs PON 1×N, portée normale), §6.7 (connecteur) et §6.14
 * (épissure par fusion). Les minimums non spécifiés valent 0 dB, ce qui est
 * prudent pour la vérification de surcharge.
 */
export const OPTICAL_LOSSES = {
  /** Câble de transport ou de distribution : maximum du tableau 2 de G.652 (1 310 à 1 625 nm). */
  fiberDistributionDbPerKm: 0.4,
  /** Même tableau, maximum de 1 530 à 1 565 nm (fenêtre de mesure de l'OTDR à 1 550 nm). */
  fiberDistribution1550DbPerKm: 0.3,
  /**
   * Note 2 du tableau 2 de G.652 : la plage s'étend jusqu'à 1 260 nm en
   * ajoutant 0,07 dB/km (diffusion de Rayleigh) à la valeur de 1 310 nm.
   * Appliqué sous 1 310 nm (XGS-PON montant, 1 270 nm), aussi aux câbles
   * courts par analogie (choix NetForge).
   */
  below1310ExtraDbPerKm: 0.07,
  /**
   * Câble court (jarretière, intérieur, raccordement) : la note 1 du tableau 2
   * de G.652 exclut ces câbles du tableau et cite 1,0 dB/km pour un câble
   * intérieur (CEI 60794-2) ; valeur retenue pour tous les câbles courts (choix pédagogique).
   */
  fiberShortDbPerKm: 1.0,
  connectionMaxDb: 0.5,
  spliceMaxDb: 0.3,
  coupler: {
    2: { minDb: 2.8, maxDb: 3.9 },
    4: { minDb: 5.4, maxDb: 7.4 },
    8: { minDb: 8.2, maxDb: 10.6 },
    16: { minDb: 10.8, maxDb: 14.1 },
    32: { minDb: 13.3, maxDb: 17.5 },
    64: { minDb: 16.1, maxDb: 20.9 },
  } as Readonly<Record<number, { readonly minDb: number; readonly maxDb: number }>>,
} as const;

/** Réserve d'ingénierie conseillée (choix pédagogique, non normatif) : marge en dessous de laquelle un chemin est signalé. */
export const ENGINEERING_RESERVE_DB = 3;

/** Écart (dB) en dessous duquel une mesure est jugée conforme au bilan prévisionnel. */
export const CONFORMITY_TOLERANCE_DB = 0.05;

/** Plafond de chemins et de points explorés (protection contre les topologies démesurées). */
export const MAX_OPTICAL_PATHS = 4096;

const EPSILON = 1e-9;

export interface OpticalPortRef {
  readonly deviceId: string;
  readonly portId: string;
}

export type OpticalElement =
  | { readonly kind: "connection"; readonly deviceId: string; readonly portId: string; readonly connector: FiberConnector }
  | { readonly kind: "fiber"; readonly linkId: string; readonly fiber: Fiber }
  | { readonly kind: "splice"; readonly deviceId: string; readonly portId: string }
  | { readonly kind: "coupler"; readonly deviceId: string; readonly ratio: number };

export interface AppliedFault {
  readonly id: string;
  readonly kind: FaultKind;
  readonly extraLoss: number | null;
  /** Coupure ou courbure : distance depuis la première extrémité du lien (m), ou null. */
  readonly positionM: number | null;
}

export interface PathElement {
  readonly element: OpticalElement;
  /** Pannes portées par cet élément (connues du formateur ; masquées en exercice). */
  readonly faults: readonly AppliedFault[];
}

/** « technology-mismatch » : OLT et ONT de technologies PON différentes (longueurs d'onde et débits incompatibles). */
export type OpticalStatus = "ok" | "low-margin" | "overload" | "below-sensitivity" | "incompatible" | "technology-mismatch" | "cut";

const SEVERITY: Readonly<Record<OpticalStatus, number>> = { ok: 0, "low-margin": 1, overload: 2, "below-sensitivity": 3, incompatible: 4, "technology-mismatch": 5, cut: 6 };

export function worstStatus(statuses: readonly OpticalStatus[]): OpticalStatus {
  return statuses.reduce<OpticalStatus>((worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst), "ok");
}

export interface Contribution {
  /** Indice dans PathElement[] (ordre descendant). */
  readonly index: number;
  readonly minDb: number;
  readonly maxDb: number;
  /** Perte de panne, distincte de la perte nominale. */
  readonly faultDb: number;
}

export interface BudgetFigures {
  readonly lossMinDb: number;
  readonly lossMaxDb: number;
  /** Émetteur au minimum, pertes maximales (pire cas). */
  readonly receivedMinDbm: number;
  /** Émetteur au maximum, pertes minimales (surcharge). */
  readonly receivedMaxDbm: number;
  /** receivedMin − (sensibilité + pénalité de trajet). */
  readonly marginDb: number;
  /** surcharge − receivedMax. */
  readonly overloadMarginDb: number;
  readonly status: OpticalStatus;
}

export interface DirectionBudget {
  readonly direction: Direction;
  readonly wavelengthNm: number;
  /** Profils de l'émetteur et du récepteur de ce sens. */
  readonly transmitterProfile: OpticalProfileId;
  readonly receiverProfile: OpticalProfileId;
  /** Classe d'affaiblissement du réseau de distribution, d'après la technologie de l'OLT. */
  readonly odnClass: OdnClass;
  readonly transmitter: OpticalPortRef;
  readonly receiver: OpticalPortRef;
  readonly txMinDbm: number;
  readonly txMaxDbm: number;
  readonly sensitivityDbm: number;
  readonly overloadDbm: number;
  readonly penaltyDb: number;
  /** Budget disponible : émission minimale − sensibilité − pénalité. */
  readonly availableDb: number;
  /** Contributions dans l'ordre de traversée de ce sens. */
  readonly contributions: readonly Contribution[];
  /** Bilan de conception (sans panne). */
  readonly nominal: BudgetFigures;
  /** Bilan avec les pannes présentes. */
  readonly actual: BudgetFigures;
}

export interface OpticalPath {
  readonly id: string;
  readonly olt: OpticalPortRef;
  readonly ont: OpticalPortRef;
  readonly oltTechnology: PonTechnology;
  readonly ontTechnology: PonTechnology;
  /** Longueur totale de fibre traversée (m). */
  readonly fiberLengthM: number;
  readonly elements: readonly PathElement[];
  readonly downstream: DirectionBudget;
  readonly upstream: DirectionBudget;
  readonly status: OpticalStatus;
  readonly nominalStatus: OpticalStatus;
}

export interface OpticalReport {
  readonly paths: readonly OpticalPath[];
  /** ONT qu'aucun OLT n'atteint (fibre absente, chemin interrompu par un port libre…). */
  readonly unreachedOnts: readonly string[];
  /** Boucles optiques rencontrées (une fibre revient sur un port déjà traversé). */
  readonly loops: number;
  readonly truncated: boolean;
  readonly reserveDb: number;
}

// ---------------------------------------------------------------- Exploration

interface Graph {
  readonly devices: ReadonlyMap<string, Device>;
  readonly linkByPort: ReadonlyMap<string, { readonly id: string; readonly fiber: Fiber; readonly peer: OpticalPortRef }>;
  readonly faultsByPort: ReadonlyMap<string, readonly Fault[]>;
  readonly faultsByLink: ReadonlyMap<string, readonly Fault[]>;
}

/** Point de mesure atteint par la lumière descendante d'un port d'OLT. */
interface ReachPoint {
  readonly olt: OpticalPortRef;
  readonly point: OpticalPortRef;
  readonly elements: readonly PathElement[];
}

interface Exploration {
  readonly paths: { olt: OpticalPortRef; ont: OpticalPortRef; elements: readonly PathElement[] }[];
  readonly reach: ReachPoint[];
  loops: number;
  truncated: boolean;
}

const key = (deviceId: string, portId: string) => `${deviceId}/${portId}`;

function buildGraph(doc: NfgDocument): Graph {
  const devices = new Map(doc.topology.devices.map((device) => [device.id, device]));
  const linkByPort = new Map<string, { id: string; fiber: Fiber; peer: OpticalPortRef }>();
  for (const link of doc.topology.links) {
    if (link.fiber === null) continue;
    const [a, b] = link.endpoints;
    linkByPort.set(key(a.deviceId, a.portId), { id: link.id, fiber: link.fiber, peer: b });
    linkByPort.set(key(b.deviceId, b.portId), { id: link.id, fiber: link.fiber, peer: a });
  }
  const faultsByPort = new Map<string, Fault[]>();
  const faultsByLink = new Map<string, Fault[]>();
  for (const fault of doc.faults) {
    const target = fault.target;
    const map = target.kind === "link" ? faultsByLink : faultsByPort;
    const id = target.kind === "link" ? target.linkId : key(target.deviceId, target.portId);
    map.set(id, [...(map.get(id) ?? []), fault]);
  }
  return { devices, linkByPort, faultsByPort, faultsByLink };
}

const applied = (faults: readonly Fault[] | undefined, kinds: readonly FaultKind[]): AppliedFault[] =>
  (faults ?? []).filter((fault) => kinds.includes(fault.kind)).map((fault) => ({ id: fault.id, kind: fault.kind, extraLoss: fault.extraLoss, positionM: fault.positionM }));

function connection(graph: Graph, device: Device, portId: string): PathElement | null {
  const connector = findPort(device.model, portId)?.connector ?? null;
  if (connector === null) return null;
  return {
    element: { kind: "connection", deviceId: device.id, portId, connector },
    faults: applied(graph.faultsByPort.get(key(device.id, portId)), ["dirty-connector", "polish-mismatch"]),
  };
}

/**
 * Parcours en profondeur depuis chaque port d'OLT raccordé. On sort d'un
 * équipement par un port, on traverse la fibre, on entre dans l'équipement
 * suivant, puis on suit ses chemins internes. Une connexion appariée est
 * comptée une fois par extrémité de câble sur un port à connecteur ; une
 * épissure appartient au chemin interne de l'équipement qui l'abrite.
 */
function explore(doc: NfgDocument, graph: Graph): Exploration {
  const result: Exploration = { paths: [], reach: [], loops: 0, truncated: false };
  const sorted = [...doc.topology.devices].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const record = (point: ReachPoint) => {
    if (result.reach.length >= MAX_OPTICAL_PATHS * 8) {
      result.truncated = true;
      return;
    }
    result.reach.push(point);
  };

  const leave = (olt: OpticalPortRef, device: Device, portId: string, elements: readonly PathElement[], visited: ReadonlySet<string>) => {
    if (result.paths.length >= MAX_OPTICAL_PATHS) {
      result.truncated = true;
      return;
    }
    const exit = connection(graph, device, portId);
    let current = exit ? [...elements, exit] : [...elements];
    if (exit) record({ olt, point: { deviceId: device.id, portId }, elements: current });
    const link = graph.linkByPort.get(key(device.id, portId));
    if (!link) return;
    current = [...current, { element: { kind: "fiber", linkId: link.id, fiber: link.fiber }, faults: applied(graph.faultsByLink.get(link.id), ["cut", "bend"]) }];
    const next = graph.devices.get(link.peer.deviceId);
    if (!next) return;
    const nextKey = key(next.id, link.peer.portId);
    if (visited.has(nextKey)) {
      result.loops += 1;
      return;
    }
    const entry = connection(graph, next, link.peer.portId);
    if (entry) {
      current = [...current, entry];
      record({ olt, point: link.peer, elements: current });
    }
    const model = getModel(next.model);
    if (model.kind === "ont") {
      result.paths.push({ olt, ont: { ...link.peer }, elements: current });
      return;
    }
    if (model.optical !== undefined) return; // OLT relié à un OLT : pas un chemin de service.
    const inside = new Set(visited).add(nextKey);
    for (const channel of model.channels ?? []) {
      const forward = channel.from === link.peer.portId;
      if (!forward && channel.to !== link.peer.portId) continue;
      const out = forward ? channel.to : channel.from;
      if (inside.has(key(next.id, out))) {
        result.loops += 1;
        continue;
      }
      const specs = forward ? channel.elements : [...channel.elements].reverse();
      const crossed: PathElement[] = specs.map((spec) =>
        spec.kind === "splice"
          ? { element: { kind: "splice", deviceId: next.id, portId: spec.port }, faults: applied(graph.faultsByPort.get(key(next.id, spec.port)), ["bad-splice"]) }
          : { element: { kind: "coupler", deviceId: next.id, ratio: spec.ratio }, faults: [] },
      );
      leave(olt, next, out, [...current, ...crossed], new Set(inside).add(key(next.id, out)));
    }
  };

  for (const device of sorted) {
    const model = getModel(device.model);
    if (model.kind !== "olt") continue;
    for (const port of model.ports) {
      const olt = { deviceId: device.id, portId: port.id };
      leave(olt, device, port.id, [], new Set([key(device.id, port.id)]));
    }
  }
  return result;
}

// ---------------------------------------------------------------- Bilan

/** Affaiblissement maximal d'une fibre (dB/km) à une longueur d'onde nominale. */
export function fiberDbPerKm(cable: Fiber["cable"], wavelengthNm: number): number {
  if (cable === "distribution" && wavelengthNm >= 1530 && wavelengthNm <= 1565) return OPTICAL_LOSSES.fiberDistribution1550DbPerKm;
  const base = cable === "short" ? OPTICAL_LOSSES.fiberShortDbPerKm : OPTICAL_LOSSES.fiberDistributionDbPerKm;
  return wavelengthNm < 1310 ? base + OPTICAL_LOSSES.below1310ExtraDbPerKm : base;
}

/**
 * Perte nominale d'un élément à une longueur d'onde. Connecteurs, épissures
 * et coupleurs : mêmes maximums de 1 260 à 1 360 nm et de 1 480 à 1 580 nm
 * (G.671, plages de fonctionnement) ; fibre : voir fiberDbPerKm.
 */
export function elementLoss(element: OpticalElement, wavelengthNm: number): { minDb: number; maxDb: number } {
  switch (element.kind) {
    case "connection":
      return { minDb: 0, maxDb: OPTICAL_LOSSES.connectionMaxDb };
    case "splice":
      return { minDb: 0, maxDb: OPTICAL_LOSSES.spliceMaxDb };
    case "coupler": {
      const loss = OPTICAL_LOSSES.coupler[element.ratio];
      if (!loss) throw new Error(`coupleur 1:${String(element.ratio)} sans valeur de référence`);
      return loss;
    }
    case "fiber": {
      return { minDb: 0, maxDb: (element.fiber.length / 1000) * fiberDbPerKm(element.fiber.cable, wavelengthNm) };
    }
  }
}

const faultLoss = (item: PathElement) => item.faults.reduce((sum, fault) => sum + (fault.extraLoss ?? 0), 0);
const isCut = (item: PathElement) => item.faults.some((fault) => fault.kind === "cut");
const isIncompatible = (item: PathElement) => item.faults.some((fault) => fault.kind === "polish-mismatch");

function figures(
  tx: { min: number; max: number },
  rx: { sensitivity: number; overload: number },
  penalty: number,
  loss: { min: number; max: number },
  blocked: "cut" | "incompatible" | "technology-mismatch" | null,
  reserve: number,
): BudgetFigures {
  const receivedMinDbm = tx.min - loss.max;
  const receivedMaxDbm = tx.max - loss.min;
  const marginDb = receivedMinDbm - (rx.sensitivity + penalty);
  const overloadMarginDb = rx.overload - receivedMaxDbm;
  const status: OpticalStatus =
    blocked ?? (marginDb < -EPSILON ? "below-sensitivity" : overloadMarginDb < -EPSILON ? "overload" : marginDb < reserve - EPSILON ? "low-margin" : "ok");
  return { lossMinDb: loss.min, lossMaxDb: loss.max, receivedMinDbm, receivedMaxDbm, marginDb, overloadMarginDb, status };
}

interface PathEnds {
  readonly olt: OpticalPortRef;
  readonly ont: OpticalPortRef;
  readonly oltProfile: TransceiverProfile;
  readonly ontProfile: TransceiverProfile;
  readonly fiberLengthM: number;
}

function budget(direction: Direction, elements: readonly PathElement[], ends: PathEnds, reserve: number): DirectionBudget {
  const { olt, ont } = ends;
  const transmitterProfile = direction === "downstream" ? ends.oltProfile : ends.ontProfile;
  const receiverProfile = direction === "downstream" ? ends.ontProfile : ends.oltProfile;
  const wavelengthNm = transmitterProfile.txWavelengthNm;
  const order = elements.map((_, index) => index);
  if (direction === "upstream") order.reverse();
  const contributions = order.map((index) => {
    const item = elements[index] as PathElement;
    return { index, ...elementLoss(item.element, wavelengthNm), faultDb: faultLoss(item) };
  });
  const nominalLoss = { min: 0, max: 0 };
  for (const item of contributions) {
    nominalLoss.min += item.minDb;
    nominalLoss.max += item.maxDb;
  }
  const extra = contributions.reduce((sum, item) => sum + item.faultDb, 0);
  // Technologies différentes : le récepteur ne fonctionne pas à la longueur d'onde reçue (défaut de conception, pas une panne).
  const mismatch = transmitterProfile.technology !== receiverProfile.technology ? "technology-mismatch" : null;
  const blocked = elements.some(isCut) ? "cut" : (mismatch ?? (elements.some(isIncompatible) ? "incompatible" : null));
  const tx = { min: transmitterProfile.txMinDbm, max: transmitterProfile.txMaxDbm };
  const rx = { sensitivity: receiverProfile.rxSensitivityDbm, overload: receiverProfile.rxOverloadDbm };
  const longReach = ends.fiberLengthM > LONG_REACH_THRESHOLD_M ? receiverProfile.rxPathPenaltyLongReachDb : null;
  const penaltyDb = longReach ?? receiverProfile.rxPathPenaltyDb;
  return {
    direction,
    wavelengthNm,
    transmitterProfile: transmitterProfile.id,
    receiverProfile: receiverProfile.id,
    odnClass: ODN_CLASSES[ends.oltProfile.technology],
    transmitter: direction === "downstream" ? olt : ont,
    receiver: direction === "downstream" ? ont : olt,
    txMinDbm: tx.min,
    txMaxDbm: tx.max,
    sensitivityDbm: rx.sensitivity,
    overloadDbm: rx.overload,
    penaltyDb,
    availableDb: tx.min - rx.sensitivity - penaltyDb,
    contributions,
    nominal: figures(tx, rx, penaltyDb, nominalLoss, mismatch, reserve),
    actual: figures(tx, rx, penaltyDb, { min: nominalLoss.min + extra, max: nominalLoss.max + extra }, blocked, reserve),
  };
}

/** Profil d'émetteur-récepteur d'un OLT ou d'un ONT du graphe. */
function profileOf(graph: Graph, deviceId: string): TransceiverProfile {
  const device = graph.devices.get(deviceId);
  const optical = device ? getModel(device.model).optical : undefined;
  if (!optical) throw new Error(`équipement sans émetteur optique : ${deviceId}`);
  return TRANSCEIVER_PROFILES[optical];
}

const fiberLength = (elements: readonly PathElement[]) => elements.reduce((sum, item) => sum + (item.element.kind === "fiber" ? item.element.fiber.length : 0), 0);

/** Technologie PON d'un équipement du projet (OLT ou ONT), ou null. */
export function deviceTechnology(doc: NfgDocument, deviceId: string): PonTechnology | null {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  return device ? ponTechnologyOf(device.model) : null;
}

/** Analyse optique complète d'un projet (document validé). */
export function analyzeOptics(doc: NfgDocument, options: { reserveDb?: number } = {}): OpticalReport {
  const reserveDb = options.reserveDb ?? ENGINEERING_RESERVE_DB;
  const graph = buildGraph(doc);
  const exploration = explore(doc, graph);
  const paths = exploration.paths.map(({ olt, ont, elements }): OpticalPath => {
    const ends: PathEnds = { olt, ont, oltProfile: profileOf(graph, olt.deviceId), ontProfile: profileOf(graph, ont.deviceId), fiberLengthM: fiberLength(elements) };
    const downstream = budget("downstream", elements, ends, reserveDb);
    const upstream = budget("upstream", elements, ends, reserveDb);
    return {
      id: `${key(olt.deviceId, olt.portId)}>${key(ont.deviceId, ont.portId)}`,
      olt,
      ont,
      oltTechnology: ends.oltProfile.technology,
      ontTechnology: ends.ontProfile.technology,
      fiberLengthM: ends.fiberLengthM,
      elements,
      downstream,
      upstream,
      status: worstStatus([downstream.actual.status, upstream.actual.status]),
      nominalStatus: worstStatus([downstream.nominal.status, upstream.nominal.status]),
    };
  });
  const reached = new Set(paths.map((path) => path.ont.deviceId));
  const unreachedOnts = doc.topology.devices
    .filter((device) => getModel(device.model).kind === "ont" && !reached.has(device.id))
    .map((device) => device.id)
    .sort();
  return { paths, unreachedOnts, loops: exploration.loops, truncated: exploration.truncated, reserveDb };
}

// ---------------------------------------------------------------- Mesures de terrain

export type MeasurementOutcome = "light" | "no-light" | "unstable" | "not-measurable" | "no-source";

export interface PowerMeasurement {
  readonly point: OpticalPortRef;
  readonly direction: Direction;
  readonly wavelengthNm: number;
  /** Émetteur mesuré (port d'OLT en descendant, ONT choisi en montant). */
  readonly source: OpticalPortRef | null;
  readonly outcome: MeasurementOutcome;
  /** Puissance mesurée (pire cas, pannes comprises) ; null sans lumière exploitable. */
  readonly powerDbm: number | null;
  /** Puissance attendue d'après le bilan de conception (pire cas, sans panne). */
  readonly expectedDbm: number | null;
  /** Écart attendu − mesuré (≥ 0). */
  readonly deviationDb: number | null;
}

export type MeasurementRequest =
  | { readonly direction: "downstream"; readonly point: OpticalPortRef }
  | { readonly direction: "upstream"; readonly point: OpticalPortRef; readonly ontId: string };

function reading(request: MeasurementRequest, source: OpticalPortRef, profile: TransceiverProfile, elements: readonly PathElement[]): PowerMeasurement {
  const nominal = elements.reduce((sum, item) => sum + elementLoss(item.element, profile.txWavelengthNm).maxDb, 0);
  const extra = elements.reduce((sum, item) => sum + faultLoss(item), 0);
  const expectedDbm = profile.txMinDbm - nominal;
  const base = { point: request.point, direction: request.direction, wavelengthNm: profile.txWavelengthNm, source, expectedDbm };
  if (elements.some(isCut)) return { ...base, outcome: "no-light", powerDbm: null, deviationDb: null };
  // Raccordement APC/UPC : aucune pénalité chiffrée n'est inventée ; la lecture est déclarée non représentative.
  if (elements.some(isIncompatible)) return { ...base, outcome: "unstable", powerDbm: null, deviationDb: null };
  return { ...base, outcome: "light", powerDbm: expectedDbm - extra, deviationDb: extra };
}

/**
 * Photomètre simulé : le port est déconnecté et le photomètre y est raccordé
 * (même connexion appariée). La valeur affichée est le pire cas : émetteur au
 * minimum garanti et pertes maximales, pannes comprises — la comparer au
 * bilan de conception révèle l'écart introduit par une panne.
 */
export function measurePower(doc: NfgDocument, request: MeasurementRequest): PowerMeasurement {
  const empty = { point: request.point, direction: request.direction, source: null, powerDbm: null, expectedDbm: null, deviationDb: null };
  const wavelengthNm = request.direction === "downstream" ? 1490 : 1310;
  const device = doc.topology.devices.find((item) => item.id === request.point.deviceId);
  const port = device ? findPort(device.model, request.point.portId) : undefined;
  if (!device || port?.medium !== "fiber" || port.connector === null) return { ...empty, wavelengthNm, outcome: "not-measurable" };

  const graph = buildGraph(doc);
  const exploration = explore(doc, graph);
  const at = (item: PathElement) => item.element.kind === "connection" && item.element.deviceId === request.point.deviceId && item.element.portId === request.point.portId;
  if (request.direction === "downstream") {
    const hit = exploration.reach.find((point) => point.point.deviceId === request.point.deviceId && point.point.portId === request.point.portId);
    return hit ? reading(request, hit.olt, profileOf(graph, hit.olt.deviceId), hit.elements) : { ...empty, wavelengthNm, outcome: "no-source" };
  }
  const path = exploration.paths.find((item) => item.ont.deviceId === request.ontId && item.elements.some(at));
  if (!path) return { ...empty, wavelengthNm, outcome: "no-source" };
  const index = path.elements.findIndex(at);
  return reading(request, path.ont, profileOf(graph, path.ont.deviceId), path.elements.slice(index).reverse());
}

export type InspectionOutcome = "inspected" | "not-a-connector" | "unknown-port";

export interface ConnectorInspection {
  readonly point: OpticalPortRef;
  readonly outcome: InspectionOutcome;
  readonly connector: FiberConnector | null;
  /** Face du connecteur observée au microscope. */
  readonly endface: "clean" | "dirty" | null;
  /** Jarretière raccordée : polissage conforme au port, ou non. */
  readonly mating: "matched" | "mismatch" | "not-connected" | null;
}

/** Inspection d'un connecteur (microscope de terrain et contrôle du polissage de la jarretière). */
export function inspectConnector(doc: NfgDocument, point: OpticalPortRef): ConnectorInspection {
  const device = doc.topology.devices.find((item) => item.id === point.deviceId);
  const port = device ? findPort(device.model, point.portId) : undefined;
  const none = { point, connector: null, endface: null, mating: null };
  if (!device || !port) return { ...none, outcome: "unknown-port" };
  if (port.connector === null) return { ...none, outcome: "not-a-connector" };
  const here = doc.faults.filter((fault) => fault.target.kind === "port" && fault.target.deviceId === point.deviceId && fault.target.portId === point.portId);
  const linked = doc.topology.links.some((link) => link.endpoints.some((end) => end.deviceId === point.deviceId && end.portId === point.portId));
  return {
    point,
    outcome: "inspected",
    connector: port.connector,
    endface: here.some((fault) => fault.kind === "dirty-connector") ? "dirty" : "clean",
    mating: !linked ? "not-connected" : here.some((fault) => fault.kind === "polish-mismatch") ? "mismatch" : "matched",
  };
}
