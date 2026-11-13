import type { NfgDocument } from "@netforge/project";
import { analyzeOptics, elementLoss, fiberDbPerKm, type Direction, type OpticalElement, type OpticalPath, type OpticalPortRef, type PathElement } from "./optics.js";

/**
 * Réflectomètre (OTDR) pédagogique (phase 9).
 *
 * Trace approximative, calculée et non simulée : depuis un port à connecteur,
 * on suit le chemin optique vers les abonnés (une branche choisie) ou vers
 * l'OLT. On place chaque événement à sa distance (somme des longueurs de
 * fibre) avec sa perte : perte nominale maximale, plus la perte de panne. La
 * courbe donne le niveau relatif en aller simple ; la fibre descend selon
 * son affaiblissement maximal. Ni rétrodiffusion bruitée, ni réflectance
 * chiffrée, ni zone morte, ni dynamique limitée : voir
 * docs/protocols/otdr.md. Au-delà d'un coupleur, une vraie trace superpose
 * toutes les branches ; NetForge n'en suit qu'une.
 */

export const OTDR_WAVELENGTHS = [1310, 1550] as const;
export type OtdrWavelength = (typeof OTDR_WAVELENGTHS)[number];

/** Écart (dB) au-delà duquel une perte d'événement est signalée comme anormale. */
export const OTDR_ANOMALY_TOLERANCE_DB = 0.05;

export type OtdrEventKind =
  /** Connexion appariée (réfléchissante). */
  | "connection"
  | "splice"
  | "coupler"
  /** Perte localisée sur une fibre (courbure). */
  | "fiber-loss"
  /** Fin de fibre inattendue : plus aucun signal au-delà. */
  | "break"
  /** Connexion dont la lecture n'est pas représentative (polissages différents) : la trace s'arrête. */
  | "unmeasurable"
  /** Fin de la trace : connecteur de l'équipement terminal (ONT ou OLT). */
  | "end";

export interface OtdrEvent {
  readonly kind: OtdrEventKind;
  /** Distance depuis le point de lancement (m) ; null si la position de la panne n'est pas renseignée. */
  readonly distanceM: number | null;
  /** Section de fibre où se trouve l'événement quand sa distance exacte est inconnue. */
  readonly section: { readonly startM: number; readonly endM: number } | null;
  readonly element: OpticalElement;
  /** Perte lue (nominale maximale + panne) ; null pour une fin de fibre ou une lecture non représentative. */
  readonly lossDb: number | null;
  /** Perte nominale maximale attendue pour cet élément (référence de l'anomalie). */
  readonly expectedMaxDb: number | null;
  /** Perte supérieure au maximum attendu. */
  readonly anomaly: boolean;
  readonly reflective: boolean;
  /** Perte cumulée depuis le lancement, après l'événement. */
  readonly cumulativeDb: number | null;
}

export type OtdrOutcome = "complete" | "break" | "unmeasurable" | "no-path" | "not-a-connector";

export interface OtdrTrace {
  readonly launch: OpticalPortRef;
  readonly direction: Direction;
  readonly wavelengthNm: OtdrWavelength;
  /** Extrémité visée (ONT de la branche suivie, ou OLT). */
  readonly towards: OpticalPortRef | null;
  readonly outcome: OtdrOutcome;
  /** Distance atteinte par la trace (m). */
  readonly lengthM: number;
  readonly events: readonly OtdrEvent[];
  /** Niveau relatif (dB, négatif) en fonction de la distance, en aller simple. */
  readonly points: readonly { readonly distanceM: number; readonly levelDb: number }[];
  /** Section où se trouve une coupure ou une courbure sans position renseignée. */
  readonly uncertain: { readonly startM: number; readonly endM: number } | null;
  /** La trace descend à travers au moins un coupleur : une seule branche est montrée. */
  readonly throughSplitter: boolean;
}

export interface OtdrRequest {
  readonly point: OpticalPortRef;
  readonly direction: Direction;
  /** Branche suivie vers les abonnés (sinon : premier ONT dans l'ordre des chemins). */
  readonly ontId?: string;
  readonly wavelengthNm: OtdrWavelength;
}

const isConnectionAt = (item: PathElement, point: OpticalPortRef) =>
  item.element.kind === "connection" && item.element.deviceId === point.deviceId && item.element.portId === point.portId;

const extra = (item: PathElement) => item.faults.reduce((sum, fault) => sum + (fault.kind === "cut" || fault.kind === "polish-mismatch" ? 0 : (fault.extraLoss ?? 0)), 0);

/** Chemin optique qui passe par le point de lancement (branche demandée vers les abonnés). */
function pathThrough(paths: readonly OpticalPath[], request: OtdrRequest): OpticalPath | undefined {
  const through = paths.filter((path) => path.elements.some((item) => isConnectionAt(item, request.point)));
  if (request.direction === "downstream" && request.ontId !== undefined) return through.find((path) => path.ont.deviceId === request.ontId);
  return through[0];
}

/** Trace OTDR depuis un port à connecteur. */
export function runOtdr(doc: NfgDocument, request: OtdrRequest): OtdrTrace {
  const base = { launch: request.point, direction: request.direction, wavelengthNm: request.wavelengthNm, uncertain: null, throughSplitter: false };
  const empty = (outcome: OtdrOutcome): OtdrTrace => ({ ...base, towards: null, outcome, lengthM: 0, events: [], points: [] });
  const path = pathThrough(analyzeOptics(doc).paths, request);
  if (!path) {
    const device = doc.topology.devices.find((item) => item.id === request.point.deviceId);
    return empty(device ? "no-path" : "not-a-connector");
  }
  const index = path.elements.findIndex((item) => isConnectionAt(item, request.point));
  const sequence = request.direction === "downstream" ? path.elements.slice(index) : path.elements.slice(0, index + 1).reverse();
  const links = new Map(doc.topology.links.map((link) => [link.id, link]));
  const lambda = request.wavelengthNm;

  const events: OtdrEvent[] = [];
  const points: { distanceM: number; levelDb: number }[] = [{ distanceM: 0, levelDb: 0 }];
  let distance = 0;
  let level = 0;
  let lastDevice = request.point.deviceId;
  let uncertain: OtdrTrace["uncertain"] = null;
  let throughSplitter = false;

  const step = (loss: number) => {
    level -= loss;
    points.push({ distanceM: distance, levelDb: level });
  };
  const finish = (outcome: OtdrOutcome, towards: OpticalPortRef | null): OtdrTrace => ({ ...base, towards, outcome, lengthM: distance, events, points, uncertain, throughSplitter });

  for (const [position, item] of sequence.entries()) {
    const element = item.element;
    if (element.kind === "fiber") {
      const link = links.get(element.linkId);
      const forward = link?.endpoints[0].deviceId === lastDevice;
      const length = element.fiber.length;
      const slope = fiberDbPerKm(element.fiber.cable, lambda) / 1000;
      const start = distance;
      // Pannes de la fibre, ramenées au sens de la trace et rangées par distance.
      const located = item.faults
        .filter((fault) => fault.positionM !== null)
        .map((fault) => ({ fault, at: forward ? (fault.positionM ?? 0) : length - (fault.positionM ?? 0) }))
        .sort((a, b) => a.at - b.at);
      const unlocated = item.faults.filter((fault) => fault.positionM === null);
      for (const { fault, at } of located) {
        distance = start + at;
        points.push({ distanceM: distance, levelDb: level - slope * (distance - (points.at(-1)?.distanceM ?? start)) });
        level = points.at(-1)?.levelDb ?? level;
        if (fault.kind === "cut") {
          events.push({ kind: "break", distanceM: distance, section: null, element, lossDb: null, expectedMaxDb: null, anomaly: true, reflective: true, cumulativeDb: -level });
          return finish("break", null);
        }
        const loss = fault.extraLoss ?? 0;
        step(loss);
        events.push({ kind: "fiber-loss", distanceM: distance, section: null, element, lossDb: loss, expectedMaxDb: 0, anomaly: true, reflective: false, cumulativeDb: -level });
      }
      const section = { startM: start, endM: start + length };
      if (unlocated.some((fault) => fault.kind === "cut")) {
        // Coupure sans position : la trace s'arrête au début de la section, dont la fin est incertaine.
        distance = start;
        uncertain = section;
        events.push({ kind: "break", distanceM: null, section, element, lossDb: null, expectedMaxDb: null, anomaly: true, reflective: true, cumulativeDb: -level });
        return finish("break", null);
      }
      distance = start + length;
      points.push({ distanceM: distance, levelDb: level - slope * (distance - (points.at(-1)?.distanceM ?? start)) });
      level = points.at(-1)?.levelDb ?? level;
      const bendLoss = unlocated.reduce((sum, fault) => sum + (fault.extraLoss ?? 0), 0);
      if (bendLoss > 0) {
        // Courbure sans position : sa perte est reportée en fin de section, signalée comme incertaine.
        uncertain = section;
        step(bendLoss);
        events.push({ kind: "fiber-loss", distanceM: null, section, element, lossDb: bendLoss, expectedMaxDb: 0, anomaly: true, reflective: false, cumulativeDb: -level });
      }
      continue;
    }
    lastDevice = element.deviceId;
    const expected = elementLoss(element, lambda).maxDb;
    const last = position === sequence.length - 1;
    if (element.kind === "connection" && item.faults.some((fault) => fault.kind === "polish-mismatch")) {
      events.push({ kind: "unmeasurable", distanceM: distance, section: null, element, lossDb: null, expectedMaxDb: expected, anomaly: true, reflective: true, cumulativeDb: null });
      return finish("unmeasurable", null);
    }
    if (element.kind === "connection" && last) {
      events.push({ kind: "end", distanceM: distance, section: null, element, lossDb: null, expectedMaxDb: null, anomaly: false, reflective: true, cumulativeDb: -level });
      return finish("complete", { deviceId: element.deviceId, portId: element.portId });
    }
    if (element.kind === "coupler" && request.direction === "downstream") throughSplitter = true;
    const loss = expected + extra(item);
    step(loss);
    const kind: OtdrEventKind = element.kind === "connection" ? "connection" : element.kind === "splice" ? "splice" : "coupler";
    events.push({ kind, distanceM: distance, section: null, element, lossDb: loss, expectedMaxDb: expected, anomaly: loss > expected + OTDR_ANOMALY_TOLERANCE_DB, reflective: kind === "connection", cumulativeDb: -level });
  }
  return finish("complete", null);
}
