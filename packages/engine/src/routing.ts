import { formatIpv4, networkAddress } from "@netforge/project";
import type { RuntimeDevice, RuntimePort } from "./network.js";

/**
 * Table de routage d'un équipement IP, recalculée à partir de sa
 * configuration et de l'état de ses ports.
 *
 * - « connected » : réseau d'une interface adressée et active ;
 * - « static » : route statique d'un routeur ;
 * - « gateway » : route par défaut d'un PC vers sa passerelle ;
 * - « rip » : route apprise par RIP (état d'exécution, fournie par le moteur).
 *
 * Simplification documentée (docs/protocols/ipv4-routage.md) : le prochain
 * saut d'une route doit appartenir à un réseau directement connecté.
 */
export type RouteKind = "connected" | "static" | "gateway" | "rip";
export type InactiveReason = "interface-down" | "next-hop-unreachable";

export interface Route {
  readonly kind: RouteKind;
  readonly destination: number;
  readonly prefixLength: number;
  /** null : destination directement joignable sur le port. */
  readonly nextHop: number | null;
  readonly port: RuntimePort | null;
  readonly active: boolean;
  readonly reason: InactiveReason | null;
  /** Métrique du protocole de routage dynamique (null : route connectée ou configurée). */
  readonly metric: number | null;
}

/**
 * Préférence en cas de préfixes de même longueur (distance administrative,
 * choix NetForge) : connecté, puis configuré, puis appris par RIP.
 */
const PREFERENCE: Record<RouteKind, number> = { connected: 0, static: 1, gateway: 1, rip: 120 };

function contains(route: Pick<Route, "destination" | "prefixLength">, address: number): boolean {
  return networkAddress(address, route.prefixLength) === route.destination;
}

/** Plus long préfixe parmi les routes actives ; à égalité, la route connectée l'emporte. */
export function lookup(routes: readonly Route[], address: number): Route | null {
  let best: Route | null = null;
  for (const route of routes) {
    if (!route.active || !contains(route, address)) continue;
    if (
      !best ||
      route.prefixLength > best.prefixLength ||
      (route.prefixLength === best.prefixLength && PREFERENCE[route.kind] < PREFERENCE[best.kind])
    ) {
      best = route;
    }
  }
  return best;
}

export function routingTable(device: RuntimeDevice, isUp: (port: RuntimePort) => boolean, learned: readonly Route[] = []): Route[] {
  const connected: Route[] = [];
  for (const port of device.ports) {
    if (!port.ipv4) continue;
    const up = isUp(port);
    connected.push({
      kind: "connected",
      destination: port.ipv4.network,
      prefixLength: port.ipv4.prefixLength,
      nextHop: null,
      port,
      active: up,
      reason: up ? null : "interface-down",
      metric: null,
    });
  }

  const viaNextHop = (kind: RouteKind, destination: number, prefixLength: number, nextHop: number): Route => {
    const exit = lookup(connected, nextHop);
    return {
      kind,
      destination,
      prefixLength,
      nextHop,
      port: exit?.port ?? null,
      active: exit !== null,
      reason: exit ? null : "next-hop-unreachable",
      metric: null,
    };
  };

  const others: Route[] = [];
  if (device.kind === "router") {
    for (const route of device.staticRoutes) {
      others.push(viaNextHop("static", route.destinationValue, route.prefixLength, route.nextHopValue));
    }
  }
  if (device.kind === "pc" && device.gateway) {
    others.push(viaNextHop("gateway", 0, 0, device.gateway.value));
  }
  return [...connected, ...others, ...learned];
}

export function routeCidr(route: Pick<Route, "destination" | "prefixLength">): string {
  return `${formatIpv4(route.destination)}/${String(route.prefixLength)}`;
}
