import type { MacAddress } from "./mac.js";
import type { RuntimeDevice, RuntimeNetwork, RuntimePort } from "./network.js";

/**
 * Spanning Tree IEEE 802.1D, sous-ensemble pédagogique (docs/protocols/stp.md).
 *
 * L'arbre est calculé à partir de la topologie (comparaisons de 802.1D),
 * sans simuler l'échange des BPDU trame par trame : même résultat que des
 * BPDU échangés jusqu'à stabilité, explicable à partir des mêmes faits.
 * Seuls les switches dont STP est activé participent ; un port relié à un
 * autre équipement (poste, routeur, switch sans STP) est désigné.
 */
export type StpRole = "root" | "designated" | "alternate" | "disabled";
export type StpState = "blocking" | "listening" | "learning" | "forwarding" | "disabled";

export interface BridgeId {
  readonly priority: number;
  readonly mac: MacAddress;
}

export interface StpBridge {
  readonly bridge: BridgeId;
  readonly root: BridgeId;
  readonly rootDeviceId: string;
  readonly rootCost: number;
  /** Port racine (null pour le pont racine). */
  readonly rootPort: string | null;
}

export interface StpPort {
  readonly role: StpRole;
  /** Coût du port (vitesse du lien, table courte 802.1D-1998). */
  readonly cost: number;
}

export interface SpanningTree {
  readonly bridges: ReadonlyMap<string, StpBridge>;
  /** Clé « équipement/port » ; ports des switches participants seulement. */
  readonly ports: ReadonlyMap<string, StpPort>;
}

export const stpPortKey = (deviceId: string, portId: string): string => `${deviceId}/${portId}`;

/** Coût de chemin par vitesse (table « courte » de 802.1D-1998, encore enseignée). */
export function stpPortCost(speedMbps: number): number {
  if (speedMbps >= 10_000) return 2;
  if (speedMbps >= 1_000) return 4;
  if (speedMbps >= 100) return 19;
  return 100;
}

export function compareBridges(a: BridgeId, b: BridgeId): number {
  return a.priority - b.priority || (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0);
}

export function formatBridgeId(bridge: BridgeId): string {
  return `${String(bridge.priority)}.${bridge.mac}`;
}

/** Identifiant de pont : priorité configurée et plus petite adresse MAC des ports du switch. */
export function bridgeIdOf(device: RuntimeDevice): BridgeId | null {
  if (!device.stp?.enabled) return null;
  const mac = device.ports.map((port) => port.mac).sort()[0] ?? "";
  return { priority: device.stp.priority, mac };
}

interface Vector {
  readonly cost: number;
  readonly sender: BridgeId;
  readonly senderPort: number;
  readonly ownPort: number;
  readonly port: string;
}

function compareVectors(a: Vector, b: Vector): number {
  return a.cost - b.cost || compareBridges(a.sender, b.sender) || a.senderPort - b.senderPort || a.ownPort - b.ownPort;
}

interface Edge {
  readonly a: { readonly device: RuntimeDevice; readonly port: RuntimePort; readonly index: number };
  readonly b: { readonly device: RuntimeDevice; readonly port: RuntimePort; readonly index: number };
}

export function computeSpanningTree(network: RuntimeNetwork, isUp: (port: RuntimePort) => boolean): SpanningTree {
  const bridges = new Map<string, BridgeId>();
  for (const device of network.devices.values()) {
    const id = device.kind === "switch" ? bridgeIdOf(device) : null;
    if (id) bridges.set(device.id, id);
  }
  // Liens actifs entre deux switches participants.
  const edges: Edge[] = [];
  for (const link of network.links.values()) {
    if (!link.up) continue;
    const [first, second] = link.ends;
    const deviceA = network.devices.get(first.deviceId);
    const deviceB = network.devices.get(second.deviceId);
    if (!deviceA || !deviceB || !bridges.has(deviceA.id) || !bridges.has(deviceB.id)) continue;
    const indexA = deviceA.ports.findIndex((port) => port.portId === first.portId);
    const indexB = deviceB.ports.findIndex((port) => port.portId === second.portId);
    const portA = deviceA.ports[indexA];
    const portB = deviceB.ports[indexB];
    if (!portA || !portB) continue;
    edges.push({ a: { device: deviceA, port: portA, index: indexA }, b: { device: deviceB, port: portB, index: indexB } });
  }

  // Composantes connexes : chacune élit sa racine (plus petit identifiant de pont).
  const component = new Map<string, string>();
  for (const id of [...bridges.keys()].sort()) {
    if (component.has(id)) continue;
    const members = [id];
    component.set(id, id);
    for (let index = 0; index < members.length; index += 1) {
      const current = members[index];
      for (const edge of edges) {
        const next = edge.a.device.id === current ? edge.b.device.id : edge.b.device.id === current ? edge.a.device.id : null;
        if (next && !component.has(next)) {
          component.set(next, id);
          members.push(next);
        }
      }
    }
  }
  const rootOf = new Map<string, string>();
  for (const [id, group] of component) {
    const current = rootOf.get(group);
    const bridge = bridges.get(id);
    const best = current ? bridges.get(current) : undefined;
    if (bridge && (!best || compareBridges(bridge, best) < 0)) rootOf.set(group, id);
  }

  // Meilleur vecteur vers la racine (coût, pont émetteur, port émetteur, port récepteur),
  // relâché jusqu'à stabilité comme le feraient des BPDU échangés de proche en proche.
  const roots = new Set(rootOf.values());
  const costOf = new Map<string, number>([...roots].map((id) => [id, 0]));
  const best = new Map<string, Vector>();
  for (let round = 0; round <= bridges.size; round += 1) {
    let changed = false;
    for (const edge of edges) {
      for (const [from, to] of [
        [edge.a, edge.b],
        [edge.b, edge.a],
      ] as const) {
        const fromCost = costOf.get(from.device.id);
        const sender = bridges.get(from.device.id);
        if (fromCost === undefined || !sender || roots.has(to.device.id)) continue;
        const candidate: Vector = { cost: fromCost + stpPortCost(to.port.speedMbps), sender, senderPort: from.index, ownPort: to.index, port: to.port.portId };
        const current = best.get(to.device.id);
        if (!current || compareVectors(candidate, current) < 0) {
          best.set(to.device.id, candidate);
          costOf.set(to.device.id, candidate.cost);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const result = new Map<string, StpBridge>();
  for (const [id, bridge] of bridges) {
    const rootId = rootOf.get(component.get(id) ?? "") ?? id;
    const vector = best.get(id) ?? null;
    result.set(id, { bridge, root: bridges.get(rootId) ?? bridge, rootDeviceId: rootId, rootCost: costOf.get(id) ?? 0, rootPort: vector?.port ?? null });
  }

  // Rôles : un port désigné par segment (meilleur coût vers la racine, puis pont, puis port).
  const ports = new Map<string, StpPort>();
  for (const id of bridges.keys()) {
    const device = network.devices.get(id);
    if (!device) continue;
    for (const port of device.ports) {
      if (port.parent !== null) continue;
      const cost = stpPortCost(port.speedMbps);
      ports.set(stpPortKey(id, port.portId), { role: port.linkId !== null && isUp(port) ? "designated" : "disabled", cost });
    }
  }
  for (const edge of edges) {
    const offer = (end: Edge["a"]) => ({ cost: costOf.get(end.device.id) ?? 0, bridge: bridges.get(end.device.id), index: end.index });
    const left = offer(edge.a);
    const right = offer(edge.b);
    if (!left.bridge || !right.bridge) continue;
    const leftWins = left.cost - right.cost || compareBridges(left.bridge, right.bridge) || left.index - right.index;
    const loser = leftWins < 0 ? edge.b : edge.a;
    const loserBridge = result.get(loser.device.id);
    ports.set(stpPortKey(loser.device.id, loser.port.portId), {
      role: loserBridge?.rootPort === loser.port.portId ? "root" : "alternate",
      cost: stpPortCost(loser.port.speedMbps),
    });
  }
  return { bridges: result, ports };
}

/** État stable d'un rôle : racine et désigné transmettent, alternatif bloque. */
export function stableState(role: StpRole): StpState {
  return role === "alternate" ? "blocking" : role === "disabled" ? "disabled" : "forwarding";
}
