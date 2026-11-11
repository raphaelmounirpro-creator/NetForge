import {
  broadcastAddress,
  getModel,
  isOptical,
  networkAddress,
  parseIpv4,
  type DeviceKind,
  type NfgDocument,
} from "@netforge/project";
import { assignMacs, type MacAddress } from "./mac.js";
import type { SimTime } from "./time.js";

/**
 * Réseau d'exécution construit à partir d'un document validé. La
 * configuration y est figée : modifier le projet impose de réinitialiser
 * la simulation (docs/DECISIONS.md, D-022). Seuls l'état des liens et la
 * disponibilité des émetteurs évoluent pendant l'exécution.
 */
export interface RuntimeAddress {
  readonly address: string;
  readonly value: number;
  readonly prefixLength: number;
  readonly network: number;
  readonly broadcast: number;
}

export interface RuntimePort {
  readonly deviceId: string;
  readonly portId: string;
  readonly mac: MacAddress;
  readonly speedMbps: number;
  readonly ipv4: RuntimeAddress | null;
  readonly linkId: string | null;
  /** Instant où l'émetteur du port redevient libre : les trames partent une à une. */
  txFreeAt: SimTime;
}

export interface PortRef {
  readonly deviceId: string;
  readonly portId: string;
}

export interface RuntimeLink {
  readonly id: string;
  readonly ends: readonly [PortRef, PortRef];
  /** Faux après une coupure injectée pendant la simulation. */
  up: boolean;
}

export interface RuntimeStaticRoute {
  readonly destination: string;
  readonly destinationValue: number;
  readonly prefixLength: number;
  readonly nextHop: string;
  readonly nextHopValue: number;
}

export interface RuntimeDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly ports: readonly RuntimePort[];
  readonly portById: ReadonlyMap<string, RuntimePort>;
  readonly gateway: { readonly address: string; readonly value: number } | null;
  readonly staticRoutes: readonly RuntimeStaticRoute[];
}

export interface RuntimeNetwork {
  /** Équipements dans l'ordre de leur identifiant (ordre stable, indépendant du document). */
  readonly devices: ReadonlyMap<string, RuntimeDevice>;
  readonly links: ReadonlyMap<string, RuntimeLink>;
}

function runtimeAddress(address: string, prefixLength: number): RuntimeAddress | null {
  const value = parseIpv4(address);
  if (value === null) return null;
  return {
    address,
    value,
    prefixLength,
    network: networkAddress(value, prefixLength),
    broadcast: broadcastAddress(value, prefixLength),
  };
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildNetwork(doc: NfgDocument): RuntimeNetwork {
  // Le réseau optique (OLT, coupleurs, ONT…) ne transporte pas de trames simulées :
  // il est analysé par le bilan optique (optics.ts). Les câbles fibre ne relient
  // que des ports fibre (validation), les deux réseaux sont donc disjoints.
  const ethernetDevices = doc.topology.devices.filter((device) => !isOptical(getModel(device.model).kind));
  const ethernetIds = new Set(ethernetDevices.map((device) => device.id));
  const linkOfPort = new Map<string, string>();
  const links = new Map<string, RuntimeLink>();
  for (const link of [...doc.topology.links].filter((item) => item.endpoints.every((end) => ethernetIds.has(end.deviceId))).sort(byId)) {
    const [a, b] = link.endpoints;
    links.set(link.id, { id: link.id, ends: [{ ...a }, { ...b }], up: true });
    linkOfPort.set(`${a.deviceId}/${a.portId}`, link.id);
    linkOfPort.set(`${b.deviceId}/${b.portId}`, link.id);
  }

  const sortedDevices = [...ethernetDevices].sort(byId);
  const macs = assignMacs(
    sortedDevices.flatMap((device) => getModel(device.model).ports.map((port) => `${device.id}/${port.id}`)),
  );

  const devices = new Map<string, RuntimeDevice>();
  for (const device of sortedDevices) {
    const model = getModel(device.model);
    const config = doc.configurations[device.id];
    const ports: RuntimePort[] = model.ports.map((spec) => {
      const key = `${device.id}/${spec.id}`;
      const ipv4 = config?.interfaces[spec.id]?.ipv4;
      return {
        deviceId: device.id,
        portId: spec.id,
        mac: macs.get(key) ?? "",
        speedMbps: spec.speedMbps,
        ipv4: ipv4 ? runtimeAddress(ipv4.address, ipv4.prefixLength) : null,
        linkId: linkOfPort.get(key) ?? null,
        txFreeAt: 0,
      };
    });
    const gatewayValue = config?.defaultGateway ? parseIpv4(config.defaultGateway) : null;
    const staticRoutes: RuntimeStaticRoute[] = [];
    for (const route of config?.staticRoutes ?? []) {
      const destinationValue = parseIpv4(route.destination);
      const nextHopValue = parseIpv4(route.nextHop);
      if (destinationValue === null || nextHopValue === null) continue;
      staticRoutes.push({ ...route, destinationValue, nextHopValue });
    }
    devices.set(device.id, {
      id: device.id,
      name: device.name,
      kind: model.kind,
      ports,
      portById: new Map(ports.map((port) => [port.portId, port])),
      gateway: config?.defaultGateway && gatewayValue !== null ? { address: config.defaultGateway, value: gatewayValue } : null,
      staticRoutes,
    });
  }
  return { devices, links };
}

/** Un port est actif s'il est câblé et que son lien n'est pas coupé. */
export function isPortUp(network: RuntimeNetwork, port: RuntimePort): boolean {
  if (port.linkId === null) return false;
  return network.links.get(port.linkId)?.up ?? false;
}

export function peerOf(link: RuntimeLink, deviceId: string, portId: string): PortRef {
  const [a, b] = link.ends;
  return a.deviceId === deviceId && a.portId === portId ? b : a;
}
