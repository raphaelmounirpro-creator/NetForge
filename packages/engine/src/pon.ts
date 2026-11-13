import { getModel, ponTechnologyOf, type NfgDocument, type PonTechnology } from "@netforge/project";
import { analyzeOptics, type OpticalPath, type OpticalPortRef, type OpticalReport, type OpticalStatus } from "./optics.js";

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
