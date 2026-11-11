import { findPort, getModel } from "./catalog.js";
import { error, warning, type Issue } from "./issues.js";
import {
  broadcastAddress,
  formatIpv4,
  inSameSubnet,
  networkAddress,
  networkCidr,
  parseIpv4,
  subnetsOverlap,
  unassignableReason,
  type Ipv4Interface,
  type UnassignableReason,
} from "./ipv4.js";
import type { Device, NfgDocument, StaticRoute } from "./schema.js";

/**
 * Validation sémantique d'un document déjà conforme au schéma.
 *
 * Erreurs : le document est incohérent (références, unicité, adresses non
 * attribuables) et ne peut pas être accepté.
 * Avertissements : configuration suspecte mais possible. Ils sont signalés
 * sans bloquer, car un laboratoire de dépannage doit pouvoir contenir une
 * passerelle erronée ou une adresse en double.
 */
export function validateDocument(doc: NfgDocument): Issue[] {
  return [...checkIntegrity(doc), ...checkAddressing(doc), ...checkRoutes(doc), ...checkSwitchLoops(doc)];
}

function checkIntegrity(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const devices = new Map<string, Device>();
  const names = new Set<string>();

  for (const device of doc.topology.devices) {
    if (devices.has(device.id)) {
      issues.push(error("device.duplicate-id", { deviceId: device.id }));
    }
    devices.set(device.id, device);
    const key = device.name.toLowerCase();
    if (names.has(key)) {
      issues.push(error("device.duplicate-name", { deviceId: device.id, name: device.name }));
    }
    names.add(key);
  }

  const linkIds = new Set<string>();
  const usedPorts = new Set<string>();
  for (const link of doc.topology.links) {
    if (linkIds.has(link.id)) issues.push(error("link.duplicate-id", { linkId: link.id }));
    linkIds.add(link.id);

    for (const endpoint of link.endpoints) {
      const device = devices.get(endpoint.deviceId);
      if (!device) {
        issues.push(error("link.unknown-device", { linkId: link.id, deviceId: endpoint.deviceId }));
        continue;
      }
      const port = findPort(device.model, endpoint.portId);
      if (!port) {
        issues.push(error("link.unknown-port", { deviceId: device.id, deviceName: device.name, portId: endpoint.portId }));
        continue;
      }
      const portKey = `${device.id}/${port.id}`;
      if (usedPorts.has(portKey)) {
        issues.push(error("link.port-in-use", { deviceId: device.id, deviceName: device.name, portId: port.id }));
      }
      usedPorts.add(portKey);
    }

    const [a, b] = link.endpoints;
    if (a.deviceId === b.deviceId) {
      const name = devices.get(a.deviceId)?.name ?? a.deviceId;
      issues.push(error("link.same-device", { deviceId: a.deviceId, deviceName: name }));
    }
  }

  for (const device of devices.values()) {
    const config = doc.configurations[device.id];
    if (!config) {
      issues.push(error("config.missing", { deviceId: device.id, deviceName: device.name }));
    } else {
      const model = getModel(device.model);
      for (const [portId, portConfig] of Object.entries(config.interfaces)) {
        if (!findPort(device.model, portId)) {
          issues.push(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId }));
        } else if (portConfig.ipv4 !== null && !model.ipCapable) {
          issues.push(error("config.not-ip-capable", { deviceId: device.id, deviceName: device.name }));
        }
      }
      if (config.defaultGateway !== null && model.kind !== "pc") {
        issues.push(error("config.gateway-not-supported", { deviceId: device.id, deviceName: device.name }));
      }
      if (config.staticRoutes.length > 0 && model.kind !== "router") {
        issues.push(error("config.routes-not-supported", { deviceId: device.id, deviceName: device.name }));
      }
    }
    if (!(device.id in doc.layout.devices)) {
      issues.push(error("layout.missing", { deviceId: device.id, deviceName: device.name }));
    }
  }
  for (const deviceId of Object.keys(doc.configurations)) {
    if (!devices.has(deviceId)) issues.push(error("config.unknown-device", { deviceId }));
  }
  for (const deviceId of Object.keys(doc.layout.devices)) {
    if (!devices.has(deviceId)) issues.push(error("layout.unknown-device", { deviceId }));
  }
  return issues;
}

interface ConfiguredInterface {
  device: Device;
  portId: string;
  ipv4: Ipv4Interface;
}

/** Interfaces portant une adresse IPv4, dans l'ordre du document. */
export function configuredInterfaces(doc: NfgDocument): ConfiguredInterface[] {
  const result: ConfiguredInterface[] = [];
  for (const device of doc.topology.devices) {
    const config = doc.configurations[device.id];
    if (!config) continue;
    for (const port of getModel(device.model).ports) {
      const ipv4 = config.interfaces[port.id]?.ipv4;
      if (ipv4) result.push({ device, portId: port.id, ipv4 });
    }
  }
  return result;
}

function checkAddressing(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const interfaces = configuredInterfaces(doc);

  for (const item of interfaces) {
    const reason = unassignableReason(item.ipv4);
    if (reason) {
      issues.push(
        error("ipv4.unassignable", {
          deviceId: item.device.id,
          deviceName: item.device.name,
          portId: item.portId,
          address: item.ipv4.address,
          reason,
        }),
      );
    }
  }

  // Un même équipement ne peut pas avoir deux interfaces dans des réseaux qui se chevauchent.
  for (let i = 0; i < interfaces.length; i += 1) {
    for (let j = i + 1; j < interfaces.length; j += 1) {
      const a = interfaces[i];
      const b = interfaces[j];
      if (!a || !b) continue;
      if (a.device.id === b.device.id && subnetsOverlap(a.ipv4, b.ipv4)) {
        issues.push(
          error("ipv4.overlap", {
            deviceId: b.device.id,
            deviceName: b.device.name,
            portId: b.portId,
            otherPortId: a.portId,
            network: networkCidr(a.ipv4),
          }),
        );
      }
      if (a.ipv4.address === b.ipv4.address && a.device.id !== b.device.id) {
        issues.push(
          warning("ipv4.duplicate-address", {
            deviceId: b.device.id,
            deviceName: b.device.name,
            portId: b.portId,
            address: b.ipv4.address,
            otherDeviceId: a.device.id,
            otherDeviceName: a.device.name,
            otherPortId: a.portId,
          }),
        );
      }
    }
  }

  for (const device of doc.topology.devices) {
    const gateway = doc.configurations[device.id]?.defaultGateway;
    if (!gateway) continue;
    issues.push(...checkGateway(doc, device, gateway));
  }
  return issues;
}

function checkGateway(doc: NfgDocument, device: Device, gateway: string): Issue[] {
  const base = { deviceId: device.id, deviceName: device.name, gateway };
  const gatewayValue = parseIpv4(gateway);
  if (gatewayValue === null) return [];
  const reason = unassignableReason({ address: gateway, prefixLength: 32 });
  if (reason) return [error("gateway.unassignable", { ...base, reason })];

  const own = configuredInterfaces(doc).filter((item) => item.device.id === device.id);
  if (own.length === 0) return [warning("gateway.without-address", base)];
  if (own.some((item) => item.ipv4.address === gateway)) return [warning("gateway.is-own-address", base)];
  const reachable = own.some((item) => {
    const address = parseIpv4(item.ipv4.address);
    return address !== null && inSameSubnet(address, gatewayValue, item.ipv4.prefixLength);
  });
  const first = own[0];
  return reachable || !first ? [] : [warning("gateway.outside-subnet", { ...base, network: networkCidr(first.ipv4) })];
}

/** Raison pour laquelle un prochain saut n'est pas une adresse d'hôte joignable. */
function nextHopReason(nextHop: number, own: readonly ConfiguredInterface[]): UnassignableReason | null {
  const generic = unassignableReason({ address: formatIpv4(nextHop), prefixLength: 32 });
  if (generic) return generic;
  for (const item of own) {
    const address = parseIpv4(item.ipv4.address);
    if (address === null || item.ipv4.prefixLength > 30 || !inSameSubnet(address, nextHop, item.ipv4.prefixLength)) continue;
    if (nextHop === networkAddress(address, item.ipv4.prefixLength)) return "network-address";
    if (nextHop === broadcastAddress(address, item.ipv4.prefixLength)) return "broadcast-address";
  }
  return null;
}

function checkRoute(device: Device, route: StaticRoute, own: readonly ConfiguredInterface[]): Issue[] {
  const base = { deviceId: device.id, deviceName: device.name, destination: route.destination, prefixLength: route.prefixLength };
  const destination = parseIpv4(route.destination);
  const nextHop = parseIpv4(route.nextHop);
  if (destination === null || nextHop === null) return [];
  const issues: Issue[] = [];

  // Comme sur un routeur réel, la destination doit être l'adresse du réseau
  // (ex. 10.0.2.0/24 et non 10.0.2.7/24) : sinon la saisie est ambiguë.
  const network = networkAddress(destination, route.prefixLength);
  if (network !== destination) {
    issues.push(error("route.not-network-address", { ...base, network: formatIpv4(network) }));
  }

  const reason = nextHopReason(nextHop, own);
  if (reason) {
    issues.push(error("route.invalid-next-hop", { ...base, nextHop: route.nextHop, reason }));
  } else if (own.some((item) => item.ipv4.address === route.nextHop)) {
    issues.push(error("route.next-hop-is-own-address", { ...base, nextHop: route.nextHop }));
  } else {
    // Simplification documentée : le prochain saut doit appartenir à un réseau
    // directement connecté (pas de résolution récursive). La route est
    // acceptée mais restera inactive tant que ce n'est pas le cas.
    const connected = own.some((item) => {
      const address = parseIpv4(item.ipv4.address);
      return address !== null && inSameSubnet(address, nextHop, item.ipv4.prefixLength);
    });
    if (!connected) issues.push(warning("route.next-hop-not-connected", { ...base, nextHop: route.nextHop }));
  }
  return issues;
}

function checkRoutes(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const interfaces = configuredInterfaces(doc);
  for (const device of doc.topology.devices) {
    const routes = doc.configurations[device.id]?.staticRoutes ?? [];
    if (routes.length === 0 || getModel(device.model).kind !== "router") continue;
    const own = interfaces.filter((item) => item.device.id === device.id);
    const seen = new Set<string>();
    for (const route of routes) {
      const key = `${route.destination}/${String(route.prefixLength)}`;
      if (seen.has(key)) {
        issues.push(
          error("route.duplicate", {
            deviceId: device.id,
            deviceName: device.name,
            destination: route.destination,
            prefixLength: route.prefixLength,
          }),
        );
        continue;
      }
      seen.add(key);
      issues.push(...checkRoute(device, route, own));
    }
  }
  return issues;
}

/**
 * Boucle de commutation : un cycle formé uniquement de switches (câbles
 * parallèles compris). Sans STP, non modélisé à ce stade, une trame diffusée
 * y tourne indéfiniment. Avertissement seulement : c'est un cas d'étude.
 */
function checkSwitchLoops(doc: NfgDocument): Issue[] {
  const switches = new Map(
    doc.topology.devices.filter((device) => getModel(device.model).kind === "switch").map((device) => [device.id, device]),
  );
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    let current = id;
    for (let next = parent.get(current); next !== undefined && next !== current; next = parent.get(current)) current = next;
    return current;
  };
  const issues: Issue[] = [];
  for (const link of doc.topology.links) {
    const [a, b] = link.endpoints;
    const deviceA = switches.get(a.deviceId);
    const deviceB = switches.get(b.deviceId);
    if (!deviceA || !deviceB || deviceA.id === deviceB.id) continue;
    const rootA = root(deviceA.id);
    const rootB = root(deviceB.id);
    if (rootA === rootB) {
      issues.push(
        warning("topology.switch-loop", {
          linkId: link.id,
          deviceId: deviceA.id,
          deviceName: deviceA.name,
          otherDeviceId: deviceB.id,
          otherDeviceName: deviceB.name,
        }),
      );
    } else {
      parent.set(rootA, rootB);
    }
  }
  return issues;
}
