import { findPort, getModel } from "./catalog.js";
import { isDnsAddress } from "./dns.js";
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
  return [...checkIntegrity(doc), ...checkAddressing(doc), ...checkRoutes(doc), ...checkSwitchLoops(doc), ...checkVlans(doc), ...checkDhcp(doc), ...checkVrrp(doc), ...checkOspfAreas(doc), ...checkBgp(doc), ...checkFaults(doc)];
}

/**
 * BGP (v12) : routeurs seulement ; voisins externes (AS différent), uniques ;
 * réseaux annoncés en adresse de réseau, uniques (erreurs). Voisin hors des
 * réseaux directement connectés : avertissement (session impossible, eBGP à
 * un saut).
 */
function checkBgp(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const interfaces = configuredInterfaces(doc);
  for (const device of doc.topology.devices) {
    const bgp = doc.configurations[device.id]?.bgp;
    if (!bgp) continue;
    const base = { deviceId: device.id, deviceName: device.name };
    if (getModel(device.model).kind !== "router") {
      issues.push(error("bgp.not-supported", base));
      continue;
    }
    const own = interfaces.filter((item) => item.device.id === device.id);
    const neighbors = new Set<string>();
    for (const neighbor of bgp.neighbors) {
      if (neighbors.has(neighbor.address)) issues.push(error("bgp.duplicate-neighbor", { ...base, address: neighbor.address }));
      neighbors.add(neighbor.address);
      if (neighbor.remoteAs === bgp.as) issues.push(error("bgp.internal-neighbor", { ...base, address: neighbor.address, as: bgp.as }));
      const value = parseIpv4(neighbor.address) ?? 0;
      if (!own.some((item) => inSameSubnet(value, parseIpv4(item.ipv4.address) ?? 0, item.ipv4.prefixLength) && item.ipv4.address !== neighbor.address)) {
        issues.push(warning("bgp.neighbor-not-connected", { ...base, address: neighbor.address }));
      }
    }
    const networks = new Set<string>();
    for (const network of bgp.networks) {
      const cidr = `${network.address}/${String(network.prefixLength)}`;
      if (networks.has(cidr)) issues.push(error("bgp.duplicate-network", { ...base, network: cidr }));
      networks.add(cidr);
      const value = parseIpv4(network.address) ?? 0;
      if (networkAddress(value, network.prefixLength) !== value) issues.push(error("bgp.not-network-address", { ...base, network: cidr, expected: formatIpv4(networkAddress(value, network.prefixLength)) }));
    }
  }
  return issues;
}

/**
 * Zones OSPF (v11), avertissements : un routeur relié à plusieurs zones sans
 * la dorsale (pas de liens virtuels, ses résumés ne servent à personne) ;
 * deux routeurs d'un même réseau placés dans des zones différentes (leurs
 * Hello seront rejetés, aucun voisinage).
 */
function checkOspfAreas(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, { deviceName: string; portId: string; area: string }>();
  for (const device of doc.topology.devices) {
    const config = doc.configurations[device.id];
    if (!config || getModel(device.model).kind !== "router") continue;
    const areas = new Set(Object.values(config.ospfInterfaces).map((item) => item.area));
    if (areas.size > 1 && !areas.has("0.0.0.0")) {
      issues.push(warning("ospf.abr-without-backbone", { deviceId: device.id, deviceName: device.name, areas: [...areas].sort().join(", ") }));
    }
    for (const [portId, item] of Object.entries(config.ospfInterfaces)) {
      const ipv4 = config.interfaces[portId]?.ipv4;
      if (!ipv4 || item.mode !== "active") continue;
      const network = networkCidr(ipv4);
      const first = seen.get(network);
      if (!first) seen.set(network, { deviceName: device.name, portId, area: item.area });
      else if (first.area !== item.area) {
        issues.push(
          warning("ospf.area-mismatch", { deviceId: device.id, deviceName: device.name, portId, area: item.area, network, otherDeviceName: first.deviceName, otherPortId: first.portId, otherArea: first.area }),
        );
      }
    }
  }
  return issues;
}

/**
 * Groupes VRRP d'un même VRID sur un même réseau : ils doivent annoncer la
 * même adresse virtuelle (avertissement, possible dans un exercice de dépannage).
 */
function checkVrrp(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, { deviceName: string; portId: string; address: string }>();
  for (const device of doc.topology.devices) {
    const config = doc.configurations[device.id];
    if (!config || getModel(device.model).kind !== "router") continue;
    for (const [portId, group] of Object.entries(config.vrrpGroups)) {
      const ipv4 = config.interfaces[portId]?.ipv4;
      if (!ipv4) continue;
      const key = `${networkCidr(ipv4)}|${String(group.vrid)}`;
      const first = seen.get(key);
      if (!first) {
        seen.set(key, { deviceName: device.name, portId, address: group.address });
      } else if (first.address !== group.address) {
        issues.push(
          warning("vrrp.address-mismatch", { deviceId: device.id, deviceName: device.name, portId, vrid: group.vrid, address: group.address, otherDeviceName: first.deviceName, otherPortId: first.portId, otherAddress: first.address }),
        );
      }
    }
  }
  return issues;
}

/**
 * Plages DHCP d'un routeur : interface adressée, plage croissante faite
 * d'adresses attribuables du réseau de l'interface (erreurs). Passerelle hors
 * de ce réseau et adresse manuelle d'un autre équipement dans la plage
 * (risque de conflit) : avertissements, possibles dans un exercice de dépannage.
 */
function checkDhcp(doc: NfgDocument): Issue[] {
  const issues: Issue[] = [];
  const statics = configuredInterfaces(doc);
  for (const device of doc.topology.devices) {
    const config = doc.configurations[device.id];
    if (!config || getModel(device.model).kind !== "router") continue;
    for (const [portId, pool] of Object.entries(config.dhcpPools)) {
      const base = { deviceId: device.id, deviceName: device.name, portId };
      const ipv4 = config.interfaces[portId]?.ipv4;
      if (!ipv4) {
        issues.push(error("dhcp.interface-not-addressed", base));
        continue;
      }
      const start = parseIpv4(pool.start) ?? 0;
      const end = parseIpv4(pool.end) ?? 0;
      if (start > end) {
        issues.push(error("dhcp.invalid-range", { ...base, start: pool.start, end: pool.end }));
        continue;
      }
      const own = parseIpv4(ipv4.address) ?? 0;
      const usable = (value: number) =>
        inSameSubnet(value, own, ipv4.prefixLength) && unassignableReason({ address: formatIpv4(value), prefixLength: ipv4.prefixLength }) === null;
      if (!usable(start) || !usable(end)) {
        issues.push(error("dhcp.range-outside-subnet", { ...base, start: pool.start, end: pool.end, network: networkCidr(ipv4) }));
        continue;
      }
      if (!inSameSubnet(parseIpv4(pool.gateway) ?? 0, own, ipv4.prefixLength)) {
        issues.push(warning("dhcp.gateway-outside-subnet", { ...base, gateway: pool.gateway, network: networkCidr(ipv4) }));
      }
      for (const other of statics) {
        const value = parseIpv4(other.ipv4.address) ?? 0;
        if (other.device.id === device.id || value < start || value > end) continue;
        issues.push(
          warning("dhcp.range-contains-static", { ...base, address: other.ipv4.address, otherDeviceId: other.device.id, otherDeviceName: other.device.name, otherPortId: other.portId }),
        );
      }
    }
  }
  return issues;
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
      // RIP (v8) : routeurs seulement, interfaces existantes ; une interface sans adresse ne participe pas (avertissement).
      for (const portId of Object.keys(config.ripInterfaces)) {
        const base = { deviceId: device.id, deviceName: device.name, portId };
        const sub = parseSubinterface(portId);
        if (model.kind !== "router") issues.push(error("rip.not-supported", base));
        else if ((portId.includes(".") && !sub) || !findPort(device.model, sub ? sub.parent : portId)) issues.push(error("config.unknown-port", base));
        else if (!config.interfaces[portId]?.ipv4) issues.push(warning("rip.interface-not-addressed", base));
      }
      // OSPF (v9) : mêmes règles que RIP.
      for (const portId of Object.keys(config.ospfInterfaces)) {
        const base = { deviceId: device.id, deviceName: device.name, portId };
        const sub = parseSubinterface(portId);
        if (model.kind !== "router") issues.push(error("ospf.not-supported", base));
        else if ((portId.includes(".") && !sub) || !findPort(device.model, sub ? sub.parent : portId)) issues.push(error("config.unknown-port", base));
        else if (!config.interfaces[portId]?.ipv4) issues.push(warning("ospf.interface-not-addressed", base));
      }
      // VRRP (v10) : routeurs seulement, interface existante et adressée, adresse virtuelle attribuable dans son réseau.
      for (const [portId, group] of Object.entries(config.vrrpGroups)) {
        const base = { deviceId: device.id, deviceName: device.name, portId };
        const sub = parseSubinterface(portId);
        const ipv4 = config.interfaces[portId]?.ipv4;
        if (model.kind !== "router") issues.push(error("vrrp.not-supported", base));
        else if ((portId.includes(".") && !sub) || !findPort(device.model, sub ? sub.parent : portId)) issues.push(error("config.unknown-port", base));
        else if (!ipv4) issues.push(warning("vrrp.interface-not-addressed", base));
        else {
          const value = parseIpv4(group.address) ?? 0;
          const own = parseIpv4(ipv4.address) ?? 0;
          if (!inSameSubnet(value, own, ipv4.prefixLength) || unassignableReason({ address: group.address, prefixLength: ipv4.prefixLength }) !== null) {
            issues.push(error("vrrp.address-outside-subnet", { ...base, address: group.address, network: networkCidr(ipv4) }));
          }
        }
      }
      // DNS (v7) : résolveur sur un PC, service sur un routeur, adresses d'hôte attribuables.
      if (config.dnsServer !== null) {
        if (model.kind !== "pc") issues.push(error("dns.client-not-supported", { deviceId: device.id, deviceName: device.name }));
        if (!isDnsAddress(config.dnsServer)) issues.push(error("dns.invalid-address", { value: config.dnsServer }));
      }
      if (config.dnsRecords !== null) {
        if (model.kind !== "router") issues.push(error("dns.server-not-supported", { deviceId: device.id, deviceName: device.name }));
        for (const address of Object.values(config.dnsRecords)) {
          if (!isDnsAddress(address)) issues.push(error("dns.invalid-address", { value: address }));
        }
      }
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
        if (portConfig.dhcp) {
          // Adressage automatique : PC seulement, sans adresse ni passerelle manuelles.
          const params = { deviceId: device.id, deviceName: device.name, portId };
          if (model.kind !== "pc") issues.push(error("config.dhcp-client-not-supported", params));
          else if (portConfig.ipv4 !== null) issues.push(error("config.dhcp-with-address", params));
          else if (config.defaultGateway !== null) issues.push(error("config.dhcp-with-gateway", { ...params, gateway: config.defaultGateway }));
        }
      }
      const poolIds = Object.keys(config.dhcpPools);
      if (poolIds.length > 0 && model.kind !== "router") {
        issues.push(error("config.dhcp-server-not-supported", { deviceId: device.id, deviceName: device.name }));
      }
      for (const portId of poolIds) {
        const sub = parseSubinterface(portId);
        if ((portId.includes(".") && !sub) || !findPort(device.model, sub ? sub.parent : portId)) {
          issues.push(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId }));
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
