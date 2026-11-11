import { findPort, getModel, splicePorts, type FaultKind, type FaultTarget, type NfgDocument, type RepairAction } from "@netforge/project";
import { compareNames, fill, messages } from "../../i18n";
import { deviceName } from "./format";

const t = messages.optics;

export interface TargetOption {
  readonly value: string;
  readonly label: string;
  readonly target: FaultTarget;
}

export const targetValue = (target: FaultTarget): string => (target.kind === "link" ? `link:${target.linkId}` : `port:${target.deviceId}/${target.portId}`);

export function targetLabel(doc: NfgDocument, target: FaultTarget): string {
  if (target.kind === "port") return fill(t.targetPort, { device: deviceName(doc, target.deviceId), port: target.portId });
  const link = doc.topology.links.find((item) => item.id === target.linkId);
  if (!link) return target.linkId;
  const [a, b] = link.endpoints;
  return fill(t.targetLink, { a: `${deviceName(doc, a.deviceId)} ${a.portId}`, b: `${deviceName(doc, b.deviceId)} ${b.portId}` });
}

const byLabel = (a: TargetOption, b: TargetOption) => compareNames(a.label, b.label);

function linkedPorts(doc: NfgDocument): Set<string> {
  return new Set(doc.topology.links.flatMap((link) => link.endpoints.map((end) => `${end.deviceId}/${end.portId}`)));
}

/** Fibres du projet (coupure, courbure, remplacement). */
export function fiberTargets(doc: NfgDocument): TargetOption[] {
  return doc.topology.links
    .filter((link) => link.fiber !== null)
    .map((link) => {
      const target: FaultTarget = { kind: "link", linkId: link.id };
      return { value: targetValue(target), label: targetLabel(doc, target), target };
    })
    .sort(byLabel);
}

/** Ports à connecteur raccordés (connecteur sale, polissage, nettoyage, jarretière). */
export function connectorTargets(doc: NfgDocument): TargetOption[] {
  const linked = linkedPorts(doc);
  return doc.topology.devices
    .flatMap((device) =>
      getModel(device.model)
        .ports.filter((port) => port.connector !== null && linked.has(`${device.id}/${port.id}`))
        .map((port) => {
          const target: FaultTarget = { kind: "port", deviceId: device.id, portId: port.id };
          return { value: targetValue(target), label: targetLabel(doc, target), target };
        }),
    )
    .sort(byLabel);
}

/** Épissures en service : ports épissurés raccordés. */
export function spliceTargets(doc: NfgDocument): TargetOption[] {
  const linked = linkedPorts(doc);
  return doc.topology.devices
    .flatMap((device) =>
      [...splicePorts(device)]
        .filter((portId) => linked.has(`${device.id}/${portId}`) && findPort(device.model, portId))
        .map((portId) => {
          const target: FaultTarget = { kind: "port", deviceId: device.id, portId };
          return { value: targetValue(target), label: targetLabel(doc, target), target };
        }),
    )
    .sort(byLabel);
}

export function faultTargets(doc: NfgDocument, kind: FaultKind): TargetOption[] {
  if (kind === "cut" || kind === "bend") return fiberTargets(doc);
  if (kind === "bad-splice") return spliceTargets(doc);
  return connectorTargets(doc);
}

export function repairTargets(doc: NfgDocument, action: RepairAction): TargetOption[] {
  if (action === "replace-fiber") return fiberTargets(doc);
  if (action === "resplice") return spliceTargets(doc);
  return connectorTargets(doc);
}
