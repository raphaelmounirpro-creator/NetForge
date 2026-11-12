import { CATALOG_VERSION, findPort, getModel, type DeviceModelId } from "./catalog.js";
import { error, type Issue } from "./issues.js";
import { isIpv4Address, parseIpv4, parsePrefixOrMask, type Ipv4Interface } from "./ipv4.js";
import {
  CURRENT_SCHEMA_VERSION,
  DEVICE_NAME_PATTERN,
  LIMITS,
  NFG_FORMAT,
  type Device,
  type DeviceConfig,
  type LinkEndpoint,
  type NfgDocument,
  type Position,
  type Annotation,
  type Fault,
  type FaultKind,
  type FaultTarget,
  type Fiber,
  type StaticRoute,
} from "./schema.js";
import { validateDocument } from "./validation.js";
import { DEFAULT_VLAN, VLAN_MAX, VLAN_MIN, isVlanId, normalizeVlans, parseSubinterface, type Switchport } from "./vlan.js";

/**
 * Commandes d'édition : fonctions pures, partagées par les formulaires et la
 * future CLI. Chaque commande renvoie un nouveau document (l'ancien n'est
 * jamais modifié) ou des erreurs, ainsi que les nouveaux avertissements.
 */
export type CommandResult =
  | { ok: true; document: NfgDocument; warnings: Issue[] }
  | { ok: false; errors: Issue[] };

function fail(...errors: Issue[]): CommandResult {
  return { ok: false, errors };
}

const issueKey = (issue: Issue): string => `${issue.code}|${JSON.stringify(issue.params)}`;

/**
 * Valide le document produit. Seuls les problèmes absents du document de
 * départ sont attribués à la commande : une erreur nouvelle la refuse.
 */
function commit(before: NfgDocument, after: NfgDocument): CommandResult {
  const previous = new Set(validateDocument(before).map(issueKey));
  const introduced = validateDocument(after).filter((issue) => !previous.has(issueKey(issue)));
  const errors = introduced.filter((issue) => issue.severity === "error");
  if (errors.length > 0) return fail(...errors);
  return { ok: true, document: after, warnings: introduced };
}

function emptyConfig(): DeviceConfig {
  return { interfaces: {}, defaultGateway: null, staticRoutes: [], switchports: {} };
}

function findDevice(doc: NfgDocument, deviceId: string): Device | undefined {
  return doc.topology.devices.find((device) => device.id === deviceId);
}

function deviceNotFound(deviceId: string): CommandResult {
  return fail(error("device.not-found", { deviceId }));
}

function normalizeProjectName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= LIMITS.maxProjectNameLength ? trimmed : null;
}

// ---------------------------------------------------------------- Projet

export function createProject(params: { id: string; name: string; now: string }): CommandResult {
  const name = normalizeProjectName(params.name);
  if (name === null) return fail(error("project.invalid-name", { max: LIMITS.maxProjectNameLength }));
  return {
    ok: true,
    warnings: [],
    document: {
      format: NFG_FORMAT,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      models: { catalog: CATALOG_VERSION },
      metadata: { id: params.id, name, description: "", createdAt: params.now, updatedAt: params.now },
      topology: { devices: [], links: [] },
      configurations: {},
      faults: [],
      layout: { devices: {}, annotations: [] },
    },
  };
}

export function renameProject(doc: NfgDocument, params: { name: string }): CommandResult {
  const name = normalizeProjectName(params.name);
  if (name === null) return fail(error("project.invalid-name", { max: LIMITS.maxProjectNameLength }));
  return commit(doc, { ...doc, metadata: { ...doc.metadata, name } });
}

// ---------------------------------------------------------------- Équipements

/** Plus petit nom libre de la forme préfixe + numéro (PC1, PC2…), insensible à la casse. */
export function nextDeviceName(doc: NfgDocument, prefix: string): string {
  const used = new Set(doc.topology.devices.map((device) => device.name.toLowerCase()));
  let index = 1;
  while (used.has(`${prefix}${String(index)}`.toLowerCase())) index += 1;
  return `${prefix}${String(index)}`;
}

function clampPosition(position: Position): Position {
  const clamp = (value: number) =>
    Math.round(Math.min(LIMITS.maxCoordinate, Math.max(-LIMITS.maxCoordinate, Number.isFinite(value) ? value : 0)));
  return { x: clamp(position.x), y: clamp(position.y) };
}

export function addDevice(
  doc: NfgDocument,
  params: { id: string; model: DeviceModelId; position: Position; name?: string },
): CommandResult {
  if (doc.topology.devices.length >= LIMITS.maxDevices) {
    return fail(error("project.too-many-devices", { max: LIMITS.maxDevices }));
  }
  const name = params.name ?? nextDeviceName(doc, getModel(params.model).namePrefix);
  if (!DEVICE_NAME_PATTERN.test(name)) return fail(error("device.invalid-name", { name }));
  const device: Device = { id: params.id, model: params.model, name };
  return commit(doc, {
    ...doc,
    topology: { ...doc.topology, devices: [...doc.topology.devices, device] },
    configurations: { ...doc.configurations, [device.id]: emptyConfig() },
    layout: { ...doc.layout, devices: { ...doc.layout.devices, [device.id]: clampPosition(params.position) } },
  });
}

export function renameDevice(doc: NfgDocument, params: { deviceId: string; name: string }): CommandResult {
  const device = findDevice(doc, params.deviceId);
  if (!device) return deviceNotFound(params.deviceId);
  const name = params.name.trim();
  if (!DEVICE_NAME_PATTERN.test(name)) return fail(error("device.invalid-name", { name }));
  return commit(doc, {
    ...doc,
    topology: {
      ...doc.topology,
      devices: doc.topology.devices.map((item) => (item.id === device.id ? { ...item, name } : item)),
    },
  });
}

/** Déplacement : modifie la disposition uniquement, jamais le réseau. */
export function moveDevice(doc: NfgDocument, params: { deviceId: string; position: Position }): CommandResult {
  if (!findDevice(doc, params.deviceId)) return deviceNotFound(params.deviceId);
  return commit(doc, {
    ...doc,
    layout: { ...doc.layout, devices: { ...doc.layout.devices, [params.deviceId]: clampPosition(params.position) } },
  });
}

/** Supprime l'équipement, ses liens, sa configuration et sa position. */
export function removeDevice(doc: NfgDocument, params: { deviceId: string }): CommandResult {
  if (!findDevice(doc, params.deviceId)) return deviceNotFound(params.deviceId);
  const { [params.deviceId]: _removedConfig, ...configurations } = doc.configurations;
  const { [params.deviceId]: _removedPosition, ...positions } = doc.layout.devices;
  const links = doc.topology.links.filter((link) => link.endpoints.every((end) => end.deviceId !== params.deviceId));
  return commit(doc, {
    ...doc,
    topology: { devices: doc.topology.devices.filter((device) => device.id !== params.deviceId), links },
    configurations,
    layout: { ...doc.layout, devices: positions },
    // Les pannes de l'équipement et de ses câbles disparaissent avec eux.
    faults: doc.faults.filter(({ target }) =>
      target.kind === "port" ? target.deviceId !== params.deviceId : links.some((link) => link.id === target.linkId),
    ),
  });
}

// ---------------------------------------------------------------- Liens

/** Ports d'un équipement non encore reliés, dans l'ordre du modèle. */
export function freePorts(doc: NfgDocument, deviceId: string): string[] {
  const device = findDevice(doc, deviceId);
  if (!device) return [];
  const used = new Set(
    doc.topology.links.flatMap((link) =>
      link.endpoints.filter((end) => end.deviceId === deviceId).map((end) => end.portId),
    ),
  );
  return getModel(device.model)
    .ports.filter((port) => !used.has(port.id))
    .map((port) => port.id);
}

export function connectPorts(
  doc: NfgDocument,
  params: { linkId: string; a: LinkEndpoint; b: LinkEndpoint },
): CommandResult {
  if (doc.topology.links.length >= LIMITS.maxLinks) {
    return fail(error("project.too-many-links", { max: LIMITS.maxLinks }));
  }
  const devices = [params.a, params.b].map((end) => findDevice(doc, end.deviceId));
  const [deviceA, deviceB] = devices;
  if (!deviceA) return deviceNotFound(params.a.deviceId);
  if (!deviceB) return deviceNotFound(params.b.deviceId);
  // Une fibre reçoit des propriétés par défaut (jarretière intérieure de 2 m), modifiables ensuite.
  const fiberLink = findPort(deviceA.model, params.a.portId)?.medium === "fiber" && findPort(deviceB.model, params.b.portId)?.medium === "fiber";
  return commit(doc, {
    ...doc,
    topology: {
      ...doc.topology,
      links: [...doc.topology.links, { id: params.linkId, endpoints: [params.a, params.b], fiber: fiberLink ? { ...DEFAULT_FIBER } : null }],
    },
  });
}

/** Fibre par défaut d'un nouveau lien optique : jarretière intérieure G.657.A2 de 2 m. */
export const DEFAULT_FIBER: Fiber = { length: 2, type: "G.657.A2", cable: "short" };

/**
 * Relie deux équipements par leurs premiers ports libres.
 * Le choix est visible ensuite dans les propriétés et modifiable.
 */
export function connectDevices(
  doc: NfgDocument,
  params: { linkId: string; aDeviceId: string; bDeviceId: string },
): CommandResult {
  const deviceA = findDevice(doc, params.aDeviceId);
  const deviceB = findDevice(doc, params.bDeviceId);
  if (!deviceA) return deviceNotFound(params.aDeviceId);
  if (!deviceB) return deviceNotFound(params.bDeviceId);
  if (deviceA.id === deviceB.id) return fail(error("link.same-device", { deviceId: deviceA.id, deviceName: deviceA.name }));

  const freeA = freePorts(doc, deviceA.id);
  const freeB = freePorts(doc, deviceB.id);
  if (freeA.length === 0 || freeB.length === 0) {
    const saturated = freeA.length === 0 ? deviceA : deviceB;
    return fail(error("link.no-free-port", { deviceId: saturated.id, deviceName: saturated.name }));
  }
  const pair = bestPortPair(doc, deviceA, freeA, deviceB, freeB);
  if (!pair) {
    return fail(
      error("link.incompatible-media", {
        linkId: params.linkId,
        deviceId: deviceA.id,
        deviceName: deviceA.name,
        portId: freeA[0] ?? "",
        otherDeviceName: deviceB.name,
        otherPortId: freeB[0] ?? "",
      }),
    );
  }
  return connectPorts(doc, {
    linkId: params.linkId,
    a: { deviceId: deviceA.id, portId: pair[0] },
    b: { deviceId: deviceB.id, portId: pair[1] },
  });
}

/**
 * Choix des ports d'un raccordement automatique : même support obligatoire ;
 * on préfère, sur un équipement passif, le port qui prolonge un chemin déjà
 * raccordé (sortie d'un coupleur dont l'entrée est câblée…), puis deux ports
 * de même nature (connecteur ↔ connecteur, entrée de câble ↔ entrée de câble).
 * À score égal, l'ordre des ports du modèle décide (comportement inchangé en cuivre).
 */
function bestPortPair(doc: NfgDocument, deviceA: Device, freeA: readonly string[], deviceB: Device, freeB: readonly string[]): [string, string] | null {
  const continues = (device: Device, portId: string) => {
    const connected = new Set(doc.topology.links.flatMap((link) => link.endpoints.filter((end) => end.deviceId === device.id).map((end) => end.portId)));
    return (getModel(device.model).channels ?? []).some(
      (channel) => (channel.from === portId && connected.has(channel.to)) || (channel.to === portId && connected.has(channel.from)),
    );
  };
  const continuesA = new Map(freeA.map((port) => [port, continues(deviceA, port)]));
  const continuesB = new Map(freeB.map((port) => [port, continues(deviceB, port)]));
  let best: { pair: [string, string]; score: number } | null = null;
  for (const portA of freeA) {
    const specA = findPort(deviceA.model, portA);
    for (const portB of freeB) {
      const specB = findPort(deviceB.model, portB);
      if (!specA || !specB || specA.medium !== specB.medium) continue;
      const score =
        (continuesA.get(portA) === true ? 2 : 0) + (continuesB.get(portB) === true ? 2 : 0) + ((specA.connector === null) === (specB.connector === null) ? 1 : 0);
      if (!best || score > best.score) best = { pair: [portA, portB], score };
    }
  }
  return best?.pair ?? null;
}

export function disconnect(doc: NfgDocument, params: { linkId: string }): CommandResult {
  if (!doc.topology.links.some((link) => link.id === params.linkId)) {
    return fail(error("link.not-found", { linkId: params.linkId }));
  }
  return commit(doc, {
    ...doc,
    topology: { ...doc.topology, links: doc.topology.links.filter((link) => link.id !== params.linkId) },
    faults: doc.faults.filter((fault) => fault.target.kind !== "link" || fault.target.linkId !== params.linkId),
  });
}

/** Modifie les propriétés d'une fibre : longueur (m), type et usage du câble. */
export function setFiber(doc: NfgDocument, params: { linkId: string; fiber: Fiber }): CommandResult {
  const link = doc.topology.links.find((item) => item.id === params.linkId);
  if (!link) return fail(error("link.not-found", { linkId: params.linkId }));
  if (link.fiber === null) return fail(error("link.fiber-unexpected", { linkId: link.id }));
  const { length } = params.fiber;
  if (!Number.isFinite(length) || length < LIMITS.minFiberLength || length > LIMITS.maxFiberLength) {
    return fail(error("link.invalid-fiber", { min: LIMITS.minFiberLength, max: LIMITS.maxFiberLength }));
  }
  return commit(doc, {
    ...doc,
    topology: { ...doc.topology, links: doc.topology.links.map((item) => (item.id === link.id ? { ...item, fiber: { ...params.fiber } } : item)) },
  });
}

// ---------------------------------------------------------------- IPv4

/**
 * Analyse une saisie adresse + masque (préfixe « 24 », « /24 » ou masque
 * « 255.255.255.0 »). Partagée par les formulaires et la future CLI.
 */
export function parseIpv4Input(
  addressText: string,
  maskText: string,
): { ok: true; ipv4: Ipv4Interface } | { ok: false; errors: Issue[] } {
  const errors: Issue[] = [];
  const address = addressText.trim();
  if (parseIpv4(address) === null) errors.push(error("ipv4.invalid-address", { value: address }));
  const prefixLength = parsePrefixOrMask(maskText);
  if (prefixLength === null) errors.push(error("ipv4.invalid-mask", { value: maskText.trim() }));
  if (errors.length > 0 || prefixLength === null) return { ok: false, errors };
  return { ok: true, ipv4: { address, prefixLength } };
}

export function setInterfaceIpv4(
  doc: NfgDocument,
  params: { deviceId: string; portId: string; ipv4: Ipv4Interface | null },
): CommandResult {
  const device = findDevice(doc, params.deviceId);
  if (!device) return deviceNotFound(params.deviceId);
  if (params.portId.includes(".")) {
    // Sous-interface 802.1Q « port.vlan » (routeurs) : la validation du document vérifie le reste.
    const sub = parseSubinterface(params.portId);
    if (!sub) return fail(error("config.invalid-subinterface", { deviceId: device.id, deviceName: device.name, portId: params.portId }));
    if (getModel(device.model).kind !== "router") {
      return fail(error("config.subinterface-not-supported", { deviceId: device.id, deviceName: device.name, portId: params.portId }));
    }
    if (!findPort(device.model, sub.parent)) return fail(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId: sub.parent }));
  } else if (!findPort(device.model, params.portId)) {
    return fail(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId: params.portId }));
  }
  if (!getModel(device.model).ipCapable) {
    return fail(error("config.not-ip-capable", { deviceId: device.id, deviceName: device.name }));
  }
  if (params.ipv4 && !isIpv4Address(params.ipv4.address)) {
    return fail(error("ipv4.invalid-address", { value: params.ipv4.address }));
  }
  const config = doc.configurations[device.id] ?? emptyConfig();
  const { [params.portId]: _previous, ...otherInterfaces } = config.interfaces;
  const interfaces = params.ipv4 ? { ...otherInterfaces, [params.portId]: { ipv4: params.ipv4 } } : otherInterfaces;
  return commit(doc, { ...doc, configurations: { ...doc.configurations, [device.id]: { ...config, interfaces } } });
}

/**
 * Port de switch (VLAN) : accès dans un VLAN, trunk (VLAN natif, VLAN
 * autorisés), ou null pour revenir au défaut (accès VLAN 1).
 */
export function setSwitchport(doc: NfgDocument, params: { deviceId: string; portId: string; switchport: Switchport | null }): CommandResult {
  const device = findDevice(doc, params.deviceId);
  if (!device) return deviceNotFound(params.deviceId);
  if (getModel(device.model).kind !== "switch") return fail(error("config.switchports-not-supported", { deviceId: device.id, deviceName: device.name }));
  if (!findPort(device.model, params.portId)) {
    return fail(error("config.unknown-port", { deviceId: device.id, deviceName: device.name, portId: params.portId }));
  }
  const port = params.switchport;
  if (port) {
    const vlans = port.mode === "access" ? [port.vlan] : [port.nativeVlan, ...(port.allowedVlans === "all" ? [] : port.allowedVlans)];
    const invalid = vlans.find((vlan) => !isVlanId(vlan));
    if (invalid !== undefined) return fail(error("vlan.invalid-id", { value: String(invalid), min: VLAN_MIN, max: VLAN_MAX }));
    if (port.mode === "trunk" && port.allowedVlans !== "all" && port.allowedVlans.length === 0) return fail(error("vlan.invalid-id", { value: "", min: VLAN_MIN, max: VLAN_MAX }));
  }
  const config = doc.configurations[device.id] ?? emptyConfig();
  const { [params.portId]: _previous, ...others } = config.switchports;
  const stored: DeviceConfig["switchports"][string] | null =
    port === null || (port.mode === "access" && port.vlan === DEFAULT_VLAN)
      ? null
      : port.mode === "access"
        ? { mode: "access", vlan: port.vlan }
        : { mode: "trunk", nativeVlan: port.nativeVlan, allowedVlans: port.allowedVlans === "all" ? "all" : normalizeVlans(port.allowedVlans) };
  const switchports = stored ? { ...others, [params.portId]: stored } : others;
  return commit(doc, { ...doc, configurations: { ...doc.configurations, [device.id]: { ...config, switchports } } });
}

export function setDefaultGateway(
  doc: NfgDocument,
  params: { deviceId: string; gateway: string | null },
): CommandResult {
  const device = findDevice(doc, params.deviceId);
  if (!device) return deviceNotFound(params.deviceId);
  if (getModel(device.model).kind !== "pc") {
    return fail(error("config.gateway-not-supported", { deviceId: device.id, deviceName: device.name }));
  }
  // Chaîne vide ou null : la passerelle est retirée.
  const gateway = params.gateway?.trim() || null;
  if (gateway !== null && !isIpv4Address(gateway)) return fail(error("ipv4.invalid-address", { value: gateway }));
  const config = doc.configurations[device.id] ?? emptyConfig();
  return commit(doc, {
    ...doc,
    configurations: { ...doc.configurations, [device.id]: { ...config, defaultGateway: gateway } },
  });
}

// ---------------------------------------------------------------- Routes statiques

/**
 * Analyse une saisie de route : réseau de destination, masque (préfixe ou
 * notation décimale) et prochain saut. Partagée par les formulaires et la future CLI.
 */
export function parseRouteInput(
  destinationText: string,
  maskText: string,
  nextHopText: string,
): { ok: true; route: StaticRoute } | { ok: false; errors: Issue[] } {
  const errors: Issue[] = [];
  const destination = destinationText.trim();
  const nextHop = nextHopText.trim();
  if (parseIpv4(destination) === null) errors.push(error("ipv4.invalid-address", { value: destination }));
  const prefixLength = parsePrefixOrMask(maskText);
  if (prefixLength === null) errors.push(error("ipv4.invalid-mask", { value: maskText.trim() }));
  if (parseIpv4(nextHop) === null) errors.push(error("ipv4.invalid-address", { value: nextHop }));
  if (errors.length > 0 || prefixLength === null) return { ok: false, errors };
  return { ok: true, route: { destination, prefixLength, nextHop } };
}

function routesNotSupported(device: Device): CommandResult {
  return fail(error("config.routes-not-supported", { deviceId: device.id, deviceName: device.name }));
}

/** Ajoute une route statique à un routeur (doublons et incohérences refusés par la validation). */
export function addStaticRoute(doc: NfgDocument, params: { deviceId: string; route: StaticRoute }): CommandResult {
  const device = findDevice(doc, params.deviceId);
  if (!device) return deviceNotFound(params.deviceId);
  if (getModel(device.model).kind !== "router") return routesNotSupported(device);
  for (const value of [params.route.destination, params.route.nextHop]) {
    if (!isIpv4Address(value)) return fail(error("ipv4.invalid-address", { value }));
  }
  const config = doc.configurations[device.id] ?? emptyConfig();
  if (config.staticRoutes.length >= LIMITS.maxStaticRoutes) {
    return fail(error("route.too-many", { deviceId: device.id, deviceName: device.name, max: LIMITS.maxStaticRoutes }));
  }
  const staticRoutes = [...config.staticRoutes, { ...params.route }];
  return commit(doc, { ...doc, configurations: { ...doc.configurations, [device.id]: { ...config, staticRoutes } } });
}

/** Retire la route identifiée par sa destination et sa longueur de préfixe. */
export function removeStaticRoute(
  doc: NfgDocument,
  params: { deviceId: string; destination: string; prefixLength: number },
): CommandResult {
  const device = findDevice(doc, params.deviceId);
  if (!device) return deviceNotFound(params.deviceId);
  const config = doc.configurations[device.id] ?? emptyConfig();
  const matches = (route: StaticRoute) => route.destination === params.destination && route.prefixLength === params.prefixLength;
  if (!config.staticRoutes.some(matches)) {
    return fail(
      error("route.not-found", {
        deviceId: device.id,
        deviceName: device.name,
        destination: params.destination,
        prefixLength: params.prefixLength,
      }),
    );
  }
  const staticRoutes = config.staticRoutes.filter((route) => !matches(route));
  return commit(doc, { ...doc, configurations: { ...doc.configurations, [device.id]: { ...config, staticRoutes } } });
}

// ---------------------------------------------------------------- Annotations

function normalizeAnnotationText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= LIMITS.maxAnnotationLength ? trimmed : null;
}

function annotationNotFound(annotationId: string): CommandResult {
  return fail(error("annotation.not-found", { annotationId }));
}

function withAnnotations(doc: NfgDocument, annotations: Annotation[]): NfgDocument {
  return { ...doc, layout: { ...doc.layout, annotations } };
}

/** Ajoute une annotation libre : texte affiché sur le canevas, sans effet sur le réseau simulé. */
export function addAnnotation(doc: NfgDocument, params: { id: string; text: string; position: Position }): CommandResult {
  if (doc.layout.annotations.length >= LIMITS.maxAnnotations) return fail(error("annotation.too-many", { max: LIMITS.maxAnnotations }));
  const text = normalizeAnnotationText(params.text);
  if (text === null) return fail(error("annotation.invalid-text", { max: LIMITS.maxAnnotationLength }));
  const position = clampPosition(params.position);
  return commit(doc, withAnnotations(doc, [...doc.layout.annotations, { id: params.id, text, x: position.x, y: position.y }]));
}

export function editAnnotation(doc: NfgDocument, params: { id: string; text: string }): CommandResult {
  if (!doc.layout.annotations.some((item) => item.id === params.id)) return annotationNotFound(params.id);
  const text = normalizeAnnotationText(params.text);
  if (text === null) return fail(error("annotation.invalid-text", { max: LIMITS.maxAnnotationLength }));
  return commit(doc, withAnnotations(doc, doc.layout.annotations.map((item) => (item.id === params.id ? { ...item, text } : item))));
}

export function moveAnnotation(doc: NfgDocument, params: { id: string; position: Position }): CommandResult {
  if (!doc.layout.annotations.some((item) => item.id === params.id)) return annotationNotFound(params.id);
  const position = clampPosition(params.position);
  return commit(
    doc,
    withAnnotations(doc, doc.layout.annotations.map((item) => (item.id === params.id ? { ...item, x: position.x, y: position.y } : item))),
  );
}

export function removeAnnotation(doc: NfgDocument, params: { id: string }): CommandResult {
  if (!doc.layout.annotations.some((item) => item.id === params.id)) return annotationNotFound(params.id);
  return commit(doc, withAnnotations(doc, doc.layout.annotations.filter((item) => item.id !== params.id)));
}

// ---------------------------------------------------------------- Pannes optiques

/** Ajoute une panne (formateur). Les cibles et pertes sont vérifiées par la validation. */
export function addFault(doc: NfgDocument, params: { id: string; kind: FaultKind; target: FaultTarget; extraLoss: number | null }): CommandResult {
  if (doc.faults.length >= LIMITS.maxFaults) return fail(error("fault.too-many", { max: LIMITS.maxFaults }));
  if (params.extraLoss !== null && (!Number.isFinite(params.extraLoss) || params.extraLoss < LIMITS.minFaultLoss || params.extraLoss > LIMITS.maxFaultLoss)) {
    return fail(error("fault.invalid-loss", { min: LIMITS.minFaultLoss, max: LIMITS.maxFaultLoss }));
  }
  const fault: Fault = { id: params.id, kind: params.kind, target: { ...params.target }, extraLoss: params.extraLoss };
  return commit(doc, { ...doc, faults: [...doc.faults, fault] });
}

export function removeFault(doc: NfgDocument, params: { id: string }): CommandResult {
  if (!doc.faults.some((fault) => fault.id === params.id)) return fail(error("fault.not-found", { faultId: params.id }));
  return commit(doc, { ...doc, faults: doc.faults.filter((fault) => fault.id !== params.id) });
}

export const REPAIR_ACTIONS = ["clean", "reconnect", "resplice", "replace-fiber"] as const;
export type RepairAction = (typeof REPAIR_ACTIONS)[number];

/** Pannes supprimées par chaque intervention de terrain. */
const REPAIRS: Readonly<Record<RepairAction, readonly FaultKind[]>> = {
  clean: ["dirty-connector"],
  reconnect: ["polish-mismatch"],
  resplice: ["bad-splice"],
  "replace-fiber": ["cut", "bend"],
};

const sameTarget = (a: FaultTarget, b: FaultTarget) =>
  a.kind === "link" ? b.kind === "link" && a.linkId === b.linkId : b.kind === "port" && a.deviceId === b.deviceId && a.portId === b.portId;

/**
 * Intervention de réparation sur un composant (nettoyer un connecteur,
 * refaire une épissure, remplacer une fibre…) : supprime les pannes qu'elle
 * corrige à cet endroit. Sans panne correspondante, l'intervention est refusée
 * avec une explication (elle n'aurait rien changé).
 */
export function repair(doc: NfgDocument, params: { action: RepairAction; target: FaultTarget }): CommandResult {
  const fixed = REPAIRS[params.action];
  const remaining = doc.faults.filter((fault) => !(fixed.includes(fault.kind) && sameTarget(fault.target, params.target)));
  if (remaining.length === doc.faults.length) return fail(error("repair.nothing-found", { action: params.action }));
  return commit(doc, { ...doc, faults: remaining });
}
