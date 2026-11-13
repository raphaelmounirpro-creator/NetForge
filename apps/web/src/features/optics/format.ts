import type { ConnectorInspection, OntActivation, OpticalElement, OpticalPath, OpticalPortRef, OpticalStatus, PowerMeasurement } from "@netforge/engine";
import type { NfgDocument } from "@netforge/project";
import { fill, messages } from "../../i18n";

const t = messages.optics;

/** Formateurs partagés (en créer un par appel coûte cher). signDisplay « negative » : jamais « −0,00 ». */
const decibel = new Intl.NumberFormat("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "negative" });
const fine = new Intl.NumberFormat("fr", { minimumFractionDigits: 3, maximumFractionDigits: 3, signDisplay: "negative" });
const kilometres = new Intl.NumberFormat("fr", { maximumFractionDigits: 3 });
const metres = new Intl.NumberFormat("fr", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr");

/** Valeur en dB ou dBm à deux décimales (la précision interne est conservée). */
export const formatDb = (value: number): string => decibel.format(value);
/** Contribution d'un élément, à trois décimales (une jarretière de 2 m vaut 0,002 dB). */
export const formatFineDb = (value: number): string => fine.format(value);

/** Longueur d'onde en nm, à la française (« 1 490 »). */
export const formatWavelength = (nanometres: number): string => integer.format(nanometres);

export function formatLength(lengthMetres: number): string {
  return lengthMetres >= 1000 ? `${kilometres.format(lengthMetres / 1000)} km` : `${metres.format(lengthMetres)} m`;
}

export function deviceName(doc: NfgDocument, deviceId: string): string {
  return doc.topology.devices.find((device) => device.id === deviceId)?.name ?? deviceId;
}

export function pointLabel(doc: NfgDocument, point: OpticalPortRef): string {
  return fill(t.point, { device: deviceName(doc, point.deviceId), port: point.portId });
}

export function pathLabel(doc: NfgDocument, path: OpticalPath): string {
  return fill(t.pathLabel, { olt: deviceName(doc, path.olt.deviceId), oltPort: path.olt.portId, ont: deviceName(doc, path.ont.deviceId) });
}

/** État d'un chemin : diagnostic complet (formateur) ou symptôme seul (exercice). */
export function statusText(status: OpticalStatus, exercise: boolean): string {
  return `${t.symbol[status]} ${exercise ? t.symptom[status] : t.status[status]}`;
}

/** État d'activation d'un ONT : symbole et texte, jamais la couleur seule. */
export function ontStateText(state: OntActivation["state"]): string {
  return `${t.pon.stateSymbol[state]} ${t.pon.state[state]}`;
}

/** Cause d'arrêt de l'activation ; en exercice, l'état optique est donné comme symptôme. */
export function blockText(ont: OntActivation, exercise: boolean): string {
  if (!ont.block) return "";
  const status = ont.block === "upstream-not-received" ? ont.upstream : ont.downstream;
  return fill(t.pon.blocks[ont.block], { status: status ? statusText(status, exercise) : "" });
}

export function elementLabel(doc: NfgDocument, element: OpticalElement): string {
  switch (element.kind) {
    case "connection":
      return fill(t.element.connection, { device: deviceName(doc, element.deviceId), port: element.portId, connector: element.connector });
    case "splice":
      return fill(t.element.splice, { device: deviceName(doc, element.deviceId), port: element.portId });
    case "coupler":
      return fill(t.element.coupler, { device: deviceName(doc, element.deviceId), ratio: element.ratio });
    case "fiber":
      return fill(t.element.fiber, { length: formatLength(element.fiber.length), type: element.fiber.type, cable: t.cable[element.fiber.cable] });
  }
}

export function measurementText(doc: NfgDocument, measurement: PowerMeasurement): string {
  const params = {
    point: pointLabel(doc, measurement.point),
    wavelength: formatWavelength(measurement.wavelengthNm),
    power: measurement.powerDbm === null ? "" : formatDb(measurement.powerDbm),
    expected: measurement.expectedDbm === null ? "" : formatDb(measurement.expectedDbm),
    deviation: measurement.deviationDb === null ? "" : formatDb(measurement.deviationDb),
  };
  return fill(t.result[measurement.outcome], params);
}

export function inspectionText(doc: NfgDocument, inspection: ConnectorInspection): string {
  const point = pointLabel(doc, inspection.point);
  if (inspection.outcome !== "inspected") return fill(t.inspection[inspection.outcome], { point });
  return fill(t.inspection.result, {
    point,
    connector: inspection.connector ?? "",
    endface: inspection.endface ? t.inspection.endface[inspection.endface] : "",
    mating: inspection.mating ? t.inspection.mating[inspection.mating] : "",
  });
}
