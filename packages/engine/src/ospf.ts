import { networkAddress, parseIpv4, parsePrefixOrMask } from "@netforge/project";
import { OSPF_MAX_AGE, OSPF_MAX_AGE_DIFF, type OspfLsa, type OspfLsaHeader, type OspfLsaType } from "./pdu.js";

/**
 * OSPF version 2 en zone unique : fonctions pures du protocole, sans état
 * de simulation (RFC 2328). Voir docs/protocols/ospf.md.
 */

export const lsaKey = (lsa: Pick<OspfLsaHeader, "lsaType" | "lsId" | "advertisingRouter">): string => `${lsa.lsaType}|${lsa.lsId}|${lsa.advertisingRouter}`;

/** Code numérique du type de LSA (RFC 2328 §12.1.3). */
export function lsaTypeNumber(type: OspfLsaType): number {
  return type === "router" ? 1 : type === "network" ? 2 : 3;
}

/**
 * Instance la plus récente (RFC 2328 §13.1) : > 0 si a est plus récente, < 0
 * si b l'est, 0 si ce sont les mêmes. Numéro de séquence (signé), puis âge
 * MaxAge, puis écart d'âge supérieur à MaxAgeDiff. La somme de contrôle n'est
 * pas modélisée.
 */
export function compareLsa(a: Pick<OspfLsaHeader, "sequence" | "age">, b: Pick<OspfLsaHeader, "sequence" | "age">): number {
  if (a.sequence !== b.sequence) return (a.sequence | 0) > (b.sequence | 0) ? 1 : -1;
  const aMax = a.age >= OSPF_MAX_AGE;
  const bMax = b.age >= OSPF_MAX_AGE;
  if (aMax !== bMax) return aMax ? 1 : -1;
  if (Math.abs(a.age - b.age) > OSPF_MAX_AGE_DIFF) return a.age < b.age ? 1 : -1;
  return 0;
}

/** Même contenu (hors en-tête variable : âge et séquence) : une nouvelle instance serait inutile (RFC 2328 §12.4). */
export function sameLsaContent(a: OspfLsa, b: OspfLsa): boolean {
  if (a.lsaType === "router" && b.lsaType === "router") return a.abr === b.abr && JSON.stringify(a.links) === JSON.stringify(b.links);
  if (a.lsaType === "summary" && b.lsaType === "summary") return a.mask === b.mask && a.metric === b.metric;
  if (a.lsaType === "network" && b.lsaType === "network") return a.mask === b.mask && a.attachedRouters.join() === b.attachedRouters.join();
  return false;
}

export function lsaHeader(lsa: OspfLsa, age = lsa.age): OspfLsaHeader {
  return { lsaType: lsa.lsaType, age, lsId: lsa.lsId, advertisingRouter: lsa.advertisingRouter, sequence: lsa.sequence };
}

/** Comparaison d'identifiants de routeur (adresses IPv4, « le plus grand »). */
export function compareRouterIds(a: string, b: string): number {
  return (parseIpv4(a) ?? 0) - (parseIpv4(b) ?? 0);
}

/** Candidat à l'élection : routeur lui-même ou voisin en état 2-Way au moins (RFC 2328 §9.4). */
export interface ElectionCandidate {
  readonly routerId: string;
  readonly address: string;
  readonly priority: number;
  /** DR et BDR déclarés dans son Hello (adresses d'interface, 0.0.0.0 : aucun). */
  readonly dr: string;
  readonly bdr: string;
}

const NONE = "0.0.0.0";

function best(candidates: readonly ElectionCandidate[]): ElectionCandidate | null {
  let chosen: ElectionCandidate | null = null;
  for (const candidate of candidates) {
    if (!chosen || candidate.priority > chosen.priority || (candidate.priority === chosen.priority && compareRouterIds(candidate.routerId, chosen.routerId) > 0)) chosen = candidate;
  }
  return chosen;
}

/**
 * Élection du DR et du BDR (RFC 2328 §9.4, étapes 1 à 4) : le BDR parmi ceux
 * qui ne se déclarent pas DR (de préférence ceux qui se déclarent BDR), le DR
 * parmi ceux qui se déclarent DR (sinon le nouveau BDR) ; plus haute priorité,
 * puis plus grand identifiant ; priorité 0 inéligible. Si le routeur lui-même
 * devient ou cesse d'être DR ou BDR, les étapes 2 et 3 sont refaites.
 */
export function electDesignatedRouter(self: ElectionCandidate, neighbors: readonly ElectionCandidate[]): { readonly dr: string; readonly bdr: string } {
  const calculate = (me: ElectionCandidate) => {
    const eligible = [me, ...neighbors].filter((candidate) => candidate.priority > 0);
    const notDr = eligible.filter((candidate) => candidate.dr !== candidate.address);
    const declaredBdr = notDr.filter((candidate) => candidate.bdr === candidate.address);
    const bdr = best(declaredBdr.length > 0 ? declaredBdr : notDr);
    const declaredDr = eligible.filter((candidate) => candidate.dr === candidate.address);
    const dr = declaredDr.length > 0 ? best(declaredDr) : bdr;
    return { dr: dr?.address ?? NONE, bdr: bdr?.address ?? NONE };
  };
  const first = calculate(self);
  const was = { dr: self.dr === self.address, bdr: self.bdr === self.address };
  const now = { dr: first.dr === self.address, bdr: first.bdr === self.address };
  if (was.dr === now.dr && was.bdr === now.bdr) return first;
  return calculate({ ...self, dr: first.dr, bdr: first.bdr });
}

/** Chemin vers un routeur de la zone (routeur de bordure compris) : coût et premier saut. */
export interface SpfRouterPath {
  readonly cost: number;
  readonly nextHop: number | null;
  readonly via: string;
}

/** Route calculée : réseau, coût total, prochain saut (null : réseau du routeur) et adresse de l'interface de sortie. */
export interface SpfRoute {
  readonly destination: number;
  readonly prefixLength: number;
  readonly cost: number;
  readonly nextHop: number | null;
  /** Adresse de l'interface du routeur racine par laquelle sortir. */
  readonly via: string;
}

interface Hop {
  readonly nextHop: number | null;
  readonly via: string;
}

interface Vertex {
  readonly id: string;
  readonly lsa: OspfLsa;
  readonly cost: number;
  readonly hop: Hop | null;
  /** Le parent est la racine (réseau) ou un réseau relié à la racine (routeur) : prochain saut calculé, sinon hérité. */
  readonly parentId: string | null;
}

const vertexId = (lsa: OspfLsa) => (lsa.lsaType === "router" ? `R:${lsa.lsId}` : `N:${lsa.lsId}`);

/**
 * Plus court chemin (RFC 2328 §16.1) depuis le routeur racine : étape 1 sur
 * les routeurs et les réseaux de transit (liens vérifiés dans les deux sens,
 * réseau avant routeur à coût égal), prochains sauts selon §16.1.1 ; étape 2
 * sur les réseaux terminaux. Un seul chemin par destination (pas de partage
 * de charge) : à coût égal, le premier trouvé est gardé. LSA d'âge MaxAge exclus.
 */
export function computeOspfRoutes(rootRouterId: string, lsas: Iterable<OspfLsa>): SpfRoute[] {
  return shortestPaths(rootRouterId, lsas).routes;
}

/**
 * Plus courts chemins d'une zone (RFC 2328 §16.1) : routes intra-zone et
 * chemin vers chaque routeur atteint (sert au calcul inter-zones, §16.2).
 */
export function shortestPaths(rootRouterId: string, lsas: Iterable<OspfLsa>): { readonly routes: SpfRoute[]; readonly routers: ReadonlyMap<string, SpfRouterPath> } {
  const routers = new Map<string, Extract<OspfLsa, { lsaType: "router" }>>();
  const networks = new Map<string, Extract<OspfLsa, { lsaType: "network" }>>();
  for (const lsa of lsas) {
    if (lsa.age >= OSPF_MAX_AGE) continue;
    if (lsa.lsaType === "router") routers.set(lsa.advertisingRouter, lsa);
    else if (lsa.lsaType === "network") networks.set(lsa.lsId, lsa);
  }
  const root = routers.get(rootRouterId);
  if (!root) return { routes: [], routers: new Map() };
  const tree = new Map<string, Vertex>();
  const candidates = new Map<string, Vertex>([[vertexId(root), { id: vertexId(root), lsa: root, cost: 0, hop: null, parentId: null }]]);
  const consider = (lsa: OspfLsa, cost: number, hop: Hop | null, parentId: string) => {
    const id = vertexId(lsa);
    if (tree.has(id)) return;
    const current = candidates.get(id);
    if (!current || cost < current.cost) candidates.set(id, { id, lsa, cost, hop, parentId });
  };
  while (candidates.size > 0) {
    // Plus petit coût ; à égalité, réseau avant routeur (RFC 2328 §16.1), puis identifiant (ordre stable).
    const next = [...candidates.values()].sort(
      (a, b) => a.cost - b.cost || (a.lsa.lsaType === b.lsa.lsaType ? 0 : a.lsa.lsaType === "network" ? -1 : 1) || compareRouterIds(a.lsa.lsId, b.lsa.lsId),
    )[0];
    if (!next) break;
    candidates.delete(next.id);
    tree.set(next.id, next);
    if (next.lsa.lsaType === "router") {
      for (const link of next.lsa.links) {
        if (link.type !== "transit") continue;
        const network = networks.get(link.linkId);
        if (!network?.attachedRouters.includes(next.lsa.advertisingRouter)) continue;
        // Réseau relié à la racine : sortie directe par l'interface décrite (adresse du routeur racine).
        const hop = next.parentId === null ? { nextHop: null, via: link.linkData } : next.hop;
        consider(network, next.cost + link.metric, hop, next.id);
      }
    } else if (next.lsa.lsaType === "network") {
      const parentIsRoot = next.parentId === vertexId(root);
      for (const routerId of next.lsa.attachedRouters) {
        const router = routers.get(routerId);
        const back = router?.links.find((link) => link.type === "transit" && link.linkId === next.lsa.lsId);
        if (!router || !back) continue;
        // Routeur sur un réseau de la racine : son adresse sur ce réseau est le prochain saut (§16.1.1).
        const hop = parentIsRoot && next.hop ? { nextHop: parseIpv4(back.linkData), via: next.hop.via } : next.hop;
        consider(router, next.cost, hop, next.id);
      }
    }
  }

  const routes = new Map<string, SpfRoute>();
  const offer = (destination: number, prefixLength: number, cost: number, hop: Hop | null) => {
    // Réseau du routeur lui-même : déjà une route connectée.
    if (!hop || hop.nextHop === null) return;
    const key = `${String(destination)}/${String(prefixLength)}`;
    const current = routes.get(key);
    if (!current || cost < current.cost) routes.set(key, { destination, prefixLength, cost, nextHop: hop.nextHop, via: hop.via });
  };
  // Réseaux de transit.
  for (const vertex of tree.values()) {
    if (vertex.lsa.lsaType !== "network") continue;
    const prefixLength = parsePrefixOrMask(vertex.lsa.mask);
    const address = parseIpv4(vertex.lsa.lsId);
    if (prefixLength === null || address === null) continue;
    offer(networkAddress(address, prefixLength), prefixLength, vertex.cost, vertex.hop);
  }
  // Étape 2 : réseaux terminaux des routeurs atteints.
  for (const vertex of tree.values()) {
    if (vertex.lsa.lsaType !== "router" || vertex.parentId === null) continue;
    for (const link of vertex.lsa.links) {
      if (link.type !== "stub") continue;
      const prefixLength = parsePrefixOrMask(link.linkData);
      const address = parseIpv4(link.linkId);
      if (prefixLength === null || address === null) continue;
      offer(networkAddress(address, prefixLength), prefixLength, vertex.cost + link.metric, vertex.hop);
    }
  }
  const reached = new Map<string, SpfRouterPath>();
  for (const vertex of tree.values()) {
    if (vertex.lsa.lsaType === "router" && vertex.parentId !== null && vertex.hop) reached.set(vertex.lsa.advertisingRouter, { cost: vertex.cost, nextHop: vertex.hop.nextHop, via: vertex.hop.via });
  }
  return { routes: [...routes.values()].sort((a, b) => a.destination - b.destination || a.prefixLength - b.prefixLength), routers: reached };
}

/** Ordre stable de la base : LSA routeur puis réseau, identifiant puis routeur annonceur croissants. */
export function compareLsaKeys(a: Pick<OspfLsaHeader, "lsaType" | "lsId" | "advertisingRouter">, b: Pick<OspfLsaHeader, "lsaType" | "lsId" | "advertisingRouter">): number {
  return lsaTypeNumber(a.lsaType) - lsaTypeNumber(b.lsaType) || compareRouterIds(a.lsId, b.lsId) || compareRouterIds(a.advertisingRouter, b.advertisingRouter);
}
