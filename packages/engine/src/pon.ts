import { getModel, isDownstreamOnly, PON_SERVICES, ponTechnologyOf, type NfgDocument, type PonRate, type PonService, type PonTechnology } from "@netforge/project";
import { analyzeOptics, type Direction, type OpticalPath, type OpticalPortRef, type OpticalReport, type OpticalStatus } from "./optics.js";

/**
 * Activation des ONT sur un réseau PON (phase 9).
 *
 * Calcul statique, comme le bilan optique : pour chaque ONT, on déduit jusqu'où
 * va son activation d'après le chemin optique qui le relie à un OLT et la
 * configuration de cet OLT. Un chemin optique conforme ne suffit pas : l'OLT
 * doit aussi reconnaître le numéro de série. Phases et états d'après UIT-T
 * G.984.3 (01/2014) §10 (GPON : O1 à O5) et G.9807.1 (02/2023) §C.12
 * (XGS-PON : O1, O2-3, O4, O5). Aucun message PLOAM n'est simulé dans le
 * moteur à événements : les étapes sont déduites, pas chronométrées.
 */

/** Étapes de l'activation, dans l'ordre (codes stables, texte dans l'interface). */
export const ACTIVATION_STEPS = ["sync", "parameters", "serial", "onu-id", "ranging"] as const;
export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

export type StepOutcome = "done" | "failed" | "pending";

/** Cause d'une activation interrompue. */
export type ActivationBlock =
  /** Aucun OLT n'atteint l'ONT (fibre absente ou chemin interrompu par un port libre). */
  | "no-path"
  /** OLT et ONT de technologies différentes : longueur d'onde descendante hors de la bande du récepteur. */
  | "technology-mismatch"
  /** Le signal descendant n'est pas exploitable (coupure, raccordement incompatible, sensibilité, surcharge). */
  | "no-downstream"
  /** L'ONT répond, mais l'OLT ne reçoit pas ses salves montantes. */
  | "upstream-not-received"
  /** ONT sans numéro de série dans le projet. */
  | "missing-serial"
  /** Numéro de série découvert par l'OLT mais absent de ses autorisations sur ce port. */
  | "not-authorized"
  /** Plusieurs ONT du même port annoncent le même numéro de série : l'OLT n'attribue pas d'identifiant. */
  | "duplicate-serial";

/** État de l'ONT, avec les noms de chaque recommandation. */
export type OntState = "O1" | "O3" | "O2-3" | "O5";

export interface OntActivation {
  readonly ontId: string;
  readonly technology: PonTechnology;
  readonly serial: string | null;
  /** Port d'OLT qui éclaire l'ONT (premier dans l'ordre des identifiants s'il y en a plusieurs), ou null. */
  readonly olt: OpticalPortRef | null;
  readonly pathId: string | null;
  readonly state: OntState;
  readonly onuId: number | null;
  readonly block: ActivationBlock | null;
  /** État optique de chaque sens du chemin (null sans chemin). */
  readonly downstream: OpticalStatus | null;
  readonly upstream: OpticalStatus | null;
  readonly steps: readonly { readonly step: ActivationStep; readonly outcome: StepOutcome }[];
}

export interface PonAuthorizationStatus {
  readonly serial: string;
  readonly onuId: number;
  /** ONT de ce port qui porte ce numéro de série, s'il y en a un. */
  readonly ontId: string | null;
  /** État de cet ONT, ou null s'il n'est pas raccordé au port. */
  readonly state: OntState | null;
}

export interface PonPortReport {
  readonly oltId: string;
  readonly portId: string;
  readonly technology: PonTechnology;
  readonly authorizations: readonly PonAuthorizationStatus[];
  /** Numéros de série découverts sans enregistrement possible (non autorisés ou en double). */
  readonly discovered: readonly { readonly serial: string; readonly ontId: string; readonly block: ActivationBlock }[];
  /** ONT éclairés par ce port. */
  readonly onts: readonly string[];
}

export interface PonReport {
  readonly onts: readonly OntActivation[];
  /** Ports d'OLT raccordés à au moins un ONT ou portant au moins une autorisation. */
  readonly ports: readonly PonPortReport[];
}

const RECEIVING: ReadonlySet<OpticalStatus> = new Set<OpticalStatus>(["ok", "low-margin"]);

const portKey = (ref: OpticalPortRef) => `${ref.deviceId}/${ref.portId}`;

function steps(reached: number, failed: boolean): OntActivation["steps"] {
  return ACTIVATION_STEPS.map((step, index) => ({ step, outcome: index < reached ? "done" : index === reached && failed ? "failed" : "pending" }));
}

/** État après les étapes franchies : avant la synchronisation O1, en attente d'identifiant O3 (GPON) ou O2-3 (XGS-PON), O5 en fonctionnement. */
function stateAfter(technology: PonTechnology, reached: number): OntState {
  if (reached === 0) return "O1";
  if (reached >= ACTIVATION_STEPS.length) return "O5";
  return technology === "gpon" ? "O3" : "O2-3";
}

/** Analyse de l'activation de tous les ONT d'un projet (document validé). */
export function analyzePon(doc: NfgDocument, report: OpticalReport = analyzeOptics(doc)): PonReport {
  const pathByOnt = new Map<string, OpticalPath>();
  const ontsByPort = new Map<string, string[]>();
  for (const path of report.paths) {
    if (!pathByOnt.has(path.ont.deviceId)) pathByOnt.set(path.ont.deviceId, path);
    const list = ontsByPort.get(portKey(path.olt)) ?? [];
    if (!list.includes(path.ont.deviceId)) ontsByPort.set(portKey(path.olt), [...list, path.ont.deviceId]);
  }
  const serialOf = (ontId: string) => doc.configurations[ontId]?.serialNumber ?? null;

  // Numéros de série annoncés sur chaque port par les ONT dont la salve montante arrive à l'OLT.
  const heard = new Map<string, Map<string, string[]>>();
  for (const path of pathByOnt.values()) {
    if (path.oltTechnology !== path.ontTechnology || !RECEIVING.has(path.downstream.actual.status) || !RECEIVING.has(path.upstream.actual.status)) continue;
    const serial = serialOf(path.ont.deviceId);
    if (serial === null) continue;
    const port = heard.get(portKey(path.olt)) ?? new Map<string, string[]>();
    port.set(serial, [...(port.get(serial) ?? []), path.ont.deviceId]);
    heard.set(portKey(path.olt), port);
  }

  const onts: OntActivation[] = [];
  for (const device of [...doc.topology.devices].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (getModel(device.model).kind !== "ont") continue;
    const technology = ponTechnologyOf(device.model) ?? "gpon";
    const serial = serialOf(device.id);
    const path = pathByOnt.get(device.id);
    const base = { ontId: device.id, technology, serial, olt: path?.olt ?? null, pathId: path?.id ?? null, downstream: path?.downstream.actual.status ?? null, upstream: path?.upstream.actual.status ?? null };
    const stop = (reached: number, block: ActivationBlock): OntActivation => ({ ...base, state: stateAfter(technology, reached), onuId: null, block, steps: steps(reached, true) });
    if (!path) {
      onts.push(stop(0, "no-path"));
      continue;
    }
    if (path.oltTechnology !== path.ontTechnology) {
      onts.push(stop(0, "technology-mismatch"));
      continue;
    }
    if (!RECEIVING.has(path.downstream.actual.status)) {
      onts.push(stop(0, "no-downstream"));
      continue;
    }
    // Synchronisation et paramètres d'émission reçus : l'ONT répond aux demandes de numéro de série.
    if (serial === null) {
      onts.push(stop(2, "missing-serial"));
      continue;
    }
    if (!RECEIVING.has(path.upstream.actual.status)) {
      onts.push(stop(2, "upstream-not-received"));
      continue;
    }
    if ((heard.get(portKey(path.olt))?.get(serial)?.length ?? 0) > 1) {
      onts.push(stop(3, "duplicate-serial"));
      continue;
    }
    const authorization = doc.configurations[path.olt.deviceId]?.ponAuthorizations[path.olt.portId]?.find((entry) => entry.serial === serial);
    if (!authorization) {
      onts.push(stop(3, "not-authorized"));
      continue;
    }
    // Identifiant attribué (Assign_ONU-ID), puis mesure de distance (Ranging_Time) : fonctionnement.
    onts.push({ ...base, state: "O5", onuId: authorization.onuId, block: null, steps: steps(ACTIVATION_STEPS.length, false) });
  }

  const byId = new Map(onts.map((ont) => [ont.ontId, ont]));
  const ports: PonPortReport[] = [];
  for (const device of [...doc.topology.devices].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const technology = ponTechnologyOf(device.model);
    if (getModel(device.model).kind !== "olt" || technology === null) continue;
    for (const port of getModel(device.model).ports) {
      const ref = { deviceId: device.id, portId: port.id };
      const reached = ontsByPort.get(portKey(ref)) ?? [];
      const entries = doc.configurations[device.id]?.ponAuthorizations[port.id] ?? [];
      if (reached.length === 0 && entries.length === 0) continue;
      // Un ONT n'est rattaché qu'au port qui l'éclaire en premier (voir OntActivation.olt).
      const own = reached.filter((ontId) => {
        const olt = byId.get(ontId)?.olt;
        return olt ? portKey(olt) === portKey(ref) : false;
      });
      const authorizations = entries.map((entry): PonAuthorizationStatus => {
        const ontId = own.find((id) => serialOf(id) === entry.serial) ?? null;
        return { serial: entry.serial, onuId: entry.onuId, ontId, state: ontId === null ? null : (byId.get(ontId)?.state ?? null) };
      });
      const discovered = own.flatMap((ontId) => {
        const ont = byId.get(ontId);
        return ont?.serial && (ont.block === "not-authorized" || ont.block === "duplicate-serial") ? [{ serial: ont.serial, ontId, block: ont.block }] : [];
      });
      ports.push({ oltId: device.id, portId: port.id, technology, authorizations, discovered, onts: own });
    }
  }
  return { onts, ports };
}

// ---------------------------------------------------------------- Services et partage de bande passante

/**
 * Débits nominaux de ligne (kbit/s) : GPON classe B+, 2 488,32 Mbit/s
 * descendant et 1 244,16 Mbit/s montant (G.984.2 §8.2.1 et annexe A) ;
 * XGS-PON, 9 953,28 Mbit/s dans les deux sens (G.9807.1, tableaux B.9.3 et
 * B.9.4). C'est un majorant du débit utile : en-têtes de trame, correction
 * d'erreurs et allocation dynamique ne sont pas déduits (aucun rendement inventé).
 */
export const PON_LINE_RATES_KBPS: Readonly<Record<PonTechnology, Readonly<Record<Direction, number>>>> = {
  gpon: { downstream: 2_488_320, upstream: 1_244_160 },
  "xgs-pon": { downstream: 9_953_280, upstream: 9_953_280 },
};

export interface ServiceFlow {
  readonly service: PonService;
  readonly vlan: number;
  /** ONT du flux ; null pour la diffusion IPTV, une seule fois pour tout le port. */
  readonly ontId: string | null;
  readonly serial: string | null;
  /** ONT abonnés servis par ce flux (un seul, sauf pour la diffusion IPTV). */
  readonly subscribers: readonly string[];
  readonly guaranteedKbps: number;
  readonly maxKbps: number;
  /** Débit obtenu à l'heure de pointe, quand tous les flux demandent leur maximum. */
  readonly peakKbps: number;
}

export interface DirectionShare {
  readonly direction: Direction;
  readonly capacityKbps: number;
  /** Somme des débits garantis. */
  readonly guaranteedKbps: number;
  /** Somme des débits maximaux (demande à l'heure de pointe). */
  readonly demandKbps: number;
  /** Demande rapportée à la capacité (taux de contention). */
  readonly contention: number;
  /** Les garanties dépassent la capacité : chacune est réduite au prorata. */
  readonly guaranteesExceeded: boolean;
  readonly flows: readonly ServiceFlow[];
}

export interface PortBandwidth {
  readonly oltId: string;
  readonly portId: string;
  readonly technology: PonTechnology;
  readonly downstream: DirectionShare;
  readonly upstream: DirectionShare;
  /** ONT autorisés avec une offre mais pas en fonctionnement : aucun débit. */
  readonly idle: readonly { readonly serial: string; readonly ontId: string | null; readonly services: readonly PonService[] }[];
}

/**
 * Partage à l'heure de pointe : chaque flux reçoit d'abord sa garantie, puis
 * le reste de la capacité est réparti équitablement (max-min) entre les flux
 * qui demandent davantage, sans dépasser leur maximum. Si les garanties
 * dépassent la capacité, chacune est réduite au prorata (configuration
 * surréservée, signalée). Simplification pédagogique de l'allocation
 * dynamique de bande : aucune trame n'est simulée.
 */
export function sharePeak(capacityKbps: number, flows: readonly PonRate[]): number[] {
  const guaranteed = flows.reduce((sum, flow) => sum + flow.guaranteedKbps, 0);
  if (guaranteed > capacityKbps) return flows.map((flow) => (flow.guaranteedKbps * capacityKbps) / guaranteed);
  const peak = flows.map((flow) => flow.guaranteedKbps);
  let rest = capacityKbps - guaranteed;
  const order = flows
    .map((_, index) => index)
    .filter((index) => (flows[index]?.maxKbps ?? 0) > (flows[index]?.guaranteedKbps ?? 0))
    .sort((a, b) => {
      const extra = (index: number) => (flows[index]?.maxKbps ?? 0) - (flows[index]?.guaranteedKbps ?? 0);
      return extra(a) - extra(b) || a - b;
    });
  let left = order.length;
  for (const index of order) {
    const flow = flows[index];
    if (!flow) continue;
    const extra = Math.min(flow.maxKbps - flow.guaranteedKbps, rest / left);
    peak[index] = (peak[index] ?? 0) + extra;
    rest -= extra;
    left -= 1;
  }
  return peak;
}

function directionShare(direction: Direction, capacityKbps: number, flows: readonly Omit<ServiceFlow, "peakKbps">[]): DirectionShare {
  const rates = flows.map((flow) => ({ guaranteedKbps: flow.guaranteedKbps, maxKbps: flow.maxKbps }));
  const peaks = sharePeak(capacityKbps, rates);
  const guaranteedKbps = rates.reduce((sum, flow) => sum + flow.guaranteedKbps, 0);
  const demandKbps = rates.reduce((sum, flow) => sum + flow.maxKbps, 0);
  return {
    direction,
    capacityKbps,
    guaranteedKbps,
    demandKbps,
    contention: demandKbps / capacityKbps,
    guaranteesExceeded: guaranteedKbps > capacityKbps,
    flows: flows.map((flow, index) => ({ ...flow, peakKbps: peaks[index] ?? 0 })),
  };
}

/**
 * Débits de chaque port d'OLT dont au moins un ONT autorisé a une offre.
 * Seuls les ONT en fonctionnement (O5) consomment du débit ; la diffusion
 * IPTV n'est comptée qu'une fois par port, quel que soit le nombre d'abonnés.
 */
export function analyzePonBandwidth(doc: NfgDocument, pon: PonReport = analyzePon(doc)): PortBandwidth[] {
  const states = new Map(pon.onts.map((ont) => [ont.ontId, ont]));
  const result: PortBandwidth[] = [];
  for (const port of pon.ports) {
    const config = doc.configurations[port.oltId];
    const entries = config?.ponAuthorizations[port.portId] ?? [];
    if (!config || entries.every((entry) => entry.services.length === 0)) continue;
    const down: Omit<ServiceFlow, "peakKbps">[] = [];
    const up: Omit<ServiceFlow, "peakKbps">[] = [];
    const iptv: string[] = [];
    const idle: { serial: string; ontId: string | null; services: PonService[] }[] = [];
    for (const entry of entries) {
      if (entry.services.length === 0) continue;
      const status = port.authorizations.find((item) => item.serial === entry.serial);
      const ontId = status?.ontId ?? null;
      if (ontId === null || states.get(ontId)?.state !== "O5") {
        idle.push({ serial: entry.serial, ontId, services: entry.services });
        continue;
      }
      for (const service of entry.services) {
        const profile = config.ponServices[service];
        if (!profile) continue;
        if (isDownstreamOnly(service)) {
          iptv.push(ontId);
          continue;
        }
        const base = { service, vlan: profile.vlan, ontId, serial: entry.serial, subscribers: [ontId] };
        down.push({ ...base, ...profile.downstream });
        if (profile.upstream) up.push({ ...base, ...profile.upstream });
      }
    }
    for (const service of PON_SERVICES.filter(isDownstreamOnly)) {
      const profile = config.ponServices[service];
      if (profile && iptv.length > 0) down.push({ service, vlan: profile.vlan, ontId: null, serial: null, subscribers: iptv, ...profile.downstream });
    }
    const rates = PON_LINE_RATES_KBPS[port.technology];
    result.push({
      oltId: port.oltId,
      portId: port.portId,
      technology: port.technology,
      downstream: directionShare("downstream", rates.downstream, down),
      upstream: directionShare("upstream", rates.upstream, up),
      idle,
    });
  }
  return result;
}
