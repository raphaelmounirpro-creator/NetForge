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
import { LIMITS, type Device, type FaultKind, type Link, type NfgDocument, type StaticRoute } from "./schema.js";
import { parseSubinterface, switchportOf } from "./vlan.js";

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
  return [...checkIntegrity(doc), ...checkAddressing(doc), ...checkRoutes(doc), ...checkSwitchLoops(doc), ...checkVlans(doc), ...checkFaults(doc)];
}

/**
 * Incohérences VLAN fréquentes, signalées sans bloquer (cas d'étude) : modes
 * différents ou VLAN natifs différents aux deux extrémités d'un lien entre
 * switches, sous-interfaces de routeur reliées à un port d'accès.
 */
function checkVlans(doc: NfgDocument): Issue[] {
  const devices = new Map(doc.topology.devices.map((device) => [device.id, device]));
  const issues: Issue[] = [];
  const kindOf = (id: string) => {
    const device = devices.get(id);
    return device ? getModel(device.model).kind : null;
  };
  for (const link of doc.topology.links) {
    const [a, b] = link.endpoints;
    const deviceA = devices.get(a.deviceId);
    const deviceB = devices.get(b.deviceId);
    if (!deviceA || !deviceB) continue;
    if (kindOf(a.deviceId) === "switch" && kindOf(b.deviceId) === "switch") {
      const portA = switchportOf(doc.configurations[a.deviceId]?.switchports, a.portId);
      const portB = switchportOf(doc.configurations[b.deviceId]?.switchports, b.portId);
      const params = { linkId: link.id, deviceId: deviceA.id, deviceName: deviceA.name, portId: a.portId, otherDeviceId: deviceB.id, otherDeviceName: deviceB.name, otherPortId: b.portId };
      if (portA.mode !== portB.mode) issues.push(warning("vlan.mode-mismatch", params));
      else if (portA.mode === "trunk" && portB.mode === "trunk" && portA.nativeVlan !== portB.nativeVlan) {
        issues.push(warning("vlan.native-mismatch", { ...params, vlan: portA.nativeVlan, otherVlan: portB.nativeVlan }));
      }
      continue;
    }
    for (const [router, sw] of [
      [a, b],
      [b, a],
    ] as const) {
      if (kindOf(router.deviceId) !== "router" || kindOf(sw.deviceId) !== "switch") continue;
      const interfaces = doc.configurations[router.deviceId]?.interfaces ?? {};
      const hasSubinterfaces = Object.keys(interfaces).some((id) => parseSubinterface(id)?.parent === router.portId);
      const switchDevice = devices.get(sw.deviceId);
      const routerDevice = devices.get(router.deviceId);
      if (hasSubinterfaces && switchDevice && routerDevice && switchportOf(doc.configurations[sw.deviceId]?.switchports, sw.portId).mode === "access") {
        issues.push(warning("vlan.subinterfaces-on-access-port", { deviceId: routerDevice.id, deviceName: routerDevice.name, portId: router.portId, otherDeviceId: switchDevice.id, otherDeviceName: switchDevice.name, otherPortId: sw.portId }));
      }
    }
  }
  return issues;
}

/**
 * Compatibilité des connectiques : un câble relie deux ports de même support
 * (cuivre ou fibre) ; un lien fibre porte ses propriétés, un câble cuivre n'en a pas.
 */
function checkMedia(link: Link, devices: ReadonlyMap<string, Device>): Issue[] {
  const ends = link.endpoints.map((end) => {
    const device = devices.get(end.deviceId);
    return device ? { device, port: findPort(device.model, end.portId) } : null;
  });
  const [a, b] = ends;
  if (!a?.port || !b?.port) return [];
  if (a.port.medium !== b.port.medium) {
    return [
      error("link.incompatible-media", {
        linkId: link.id,
        deviceId: a.device.id,
        deviceName: a.device.name,
        portId: a.port.id,
        otherDeviceName: b.device.name,
        otherPortId: b.port.id,
      }),
    ];
  }
  if (a.port.medium === "fiber" && link.fiber === null) return [error("link.fiber-missing", { linkId: link.id })];
  if (a.port.medium !== "fiber" && link.fiber !== null) return [error("link.fiber-unexpected", { linkId: link.id })];
  return [];
}

/** Ports d'un équipement où une épissure interne existe (cible possible d'une épissure défectueuse). */
export function splicePorts(device: Device): Set<string> {
  const ports = new Set<string>();
  for (const channel of getModel(device.model).channels ?? []) {
    for (const element of channel.elements) if (element.kind === "splice") ports.add(element.port);
  }
  return ports;
}

const LOSS_FAULTS: ReadonlySet<FaultKind> = new Set<FaultKind>(["bend", "dirty-connector", "bad-splice"]);

/** Cohérence des pannes : cible existante et adaptée au type de panne, perte indiquée si nécessaire. */
function checkFaults(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const fault of doc.faults) {
    const base = { faultId: fault.id, kind: fault.kind };
    const target = fault.target;
    const key = `${fault.kind}|${target.kind === "link" ? target.linkId : `${target.deviceId}/${target.portId}`}`;
    if (seen.has(key)) issues.push(error("fault.duplicate", base));
    seen.add(key);
    if (LOSS_FAULTS.has(fault.kind) !== (fault.extraLoss !== null)) issues.push(error("fault.invalid-loss", { ...base, min: LIMITS.minFaultLoss, max: LIMITS.maxFaultLoss }));

    if (target.kind === "link") {
      const link = doc.topology.links.find((item) => item.id === target.linkId);
      if (!link) issues.push(error("fault.unknown-target", base));
      else if (link.fiber === null || (fault.kind !== "cut" && fault.kind !== "bend")) issues.push(error("fault.invalid-target", base));
      continue;
    }
    const device = doc.topology.devices.find((item) => item.id === target.deviceId);
    const port = device ? findPort(device.model, target.portId) : undefined;
    if (!device || !port) {
      issues.push(error("fault.unknown-target", base));
      continue;
    }
    const valid =
      fault.kind === "bad-splice" ? splicePorts(device).has(port.id) : (fault.kind === "dirty-connector" || fault.kind === "polish-mismatch") && port.connector !== null;
    if (!valid) issues.push(error("fault.invalid-target", base));
  }
  return issues;
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
    issues.push(...checkMedia(link, devices));
  }

  for (const device of devices.values()) {
    const config = doc.configurations[device.id];
    if (!config) {
      issues.push(error("config.missing", { deviceId: device.id, deviceName: device.name }));
    } else {
      const model = getModel(device.model);
      for (const [portId, portConfig] of Object.entries(config.interfaces)) {
        if (portId.includes(".")) {
          // Sous-interface 802.1Q (v5) : routeur seulement, port parent existant, VLAN 1 à 4094.
          const sub = parseSubinterface(portId);
          if (!sub) issues.push(error("config.invalid-subinterface", { deviceId: device.id, deviceName: device.name, portId }));
          else if (model.kind !== "router") issues.push(error("config.subinterface-not-supported", { deviceId: device.id, deviceName: device.name, portId }));
          else if (!findPort(device.model, sub.parent)) issues.push(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId: sub.parent }));
        } else if (!findPort(device.model, portId)) {
          issues.push(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId }));
        } else if (portConfig.ipv4 !== null && !model.ipCapable) {
          issues.push(error("config.not-ip-capable", { deviceId: device.id, deviceName: device.name }));
        }
      }
      if (config.stp !== null && model.kind !== "switch") issues.push(error("config.stp-not-supported", { deviceId: device.id, deviceName: device.name }));
      const switchportIds = Object.keys(config.switchports);
      if (switchportIds.length > 0 && model.kind !== "switch") {
        issues.push(error("config.switchports-not-supported", { deviceId: device.id, deviceName: device.name }));
      }
      for (const portId of switchportIds) {
        if (!findPort(device.model, portId)) issues.push(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId }));
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
  const annotationIds = new Set<string>();
  for (const annotation of doc.layout.annotations) {
    if (annotationIds.has(annotation.id)) issues.push(error("annotation.duplicate-id", { annotationId: annotation.id }));
    annotationIds.add(annotation.id);
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
      // Sous-interfaces du port, par VLAN croissant.
      const subinterfaces = Object.entries(config.interfaces)
        .flatMap(([id, value]) => {
          const sub = parseSubinterface(id);
          return sub?.parent === port.id && value.ipv4 ? [{ id, vlan: sub.vlan, ipv4: value.ipv4 }] : [];
        })
        .sort((a, b) => a.vlan - b.vlan);
      for (const sub of subinterfaces) result.push({ device, portId: sub.id, ipv4: sub.ipv4 });
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
 * parallèles compris), dont au moins un switch n'a pas STP activé : une
 * trame diffusée peut y tourner indéfiniment. Une boucle entre switches qui
 * ont tous STP activé est normale (redondance). Avertissement seulement.
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
  const loops: { link: Link; deviceA: Device; deviceB: Device }[] = [];
  for (const link of doc.topology.links) {
    const [a, b] = link.endpoints;
    const deviceA = switches.get(a.deviceId);
    const deviceB = switches.get(b.deviceId);
    if (!deviceA || !deviceB || deviceA.id === deviceB.id) continue;
    const rootA = root(deviceA.id);
    const rootB = root(deviceB.id);
    if (rootA === rootB) loops.push({ link, deviceA, deviceB });
    else parent.set(rootA, rootB);
  }
  // Composantes protégées : tous leurs switches ont STP activé.
  const unprotected = new Set([...switches.keys()].filter((id) => doc.configurations[id]?.stp?.enabled !== true).map(root));
  return loops
    .filter(({ deviceA }) => unprotected.has(root(deviceA.id)))
    .map(({ link, deviceA, deviceB }) =>
      warning("topology.switch-loop", { linkId: link.id, deviceId: deviceA.id, deviceName: deviceA.name, otherDeviceId: deviceB.id, otherDeviceName: deviceB.name }),
    );
}
