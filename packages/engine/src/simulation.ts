import {
  carriesVlan,
  DEFAULT_SWITCHPORT,
  formatIpv4,
  networkAddress,
  normalizeDnsName,
  parseIpv4,
  parsePrefixOrMask,
  prefixToMask,
  unassignableReason,
  validateDocument,
  type Issue,
  type NfgDocument,
} from "@netforge/project";
import type { CommandErrorCode, CommandOutcome, SimCommand } from "./commands.js";
import { BROADCAST_MAC, isGroupMac, multicastMac, vrrpMac, type MacAddress } from "./mac.js";
import { buildNetwork, isPortUp, peerOf, runtimeAddress, type RuntimeDevice, type RuntimeDhcpPool, type RuntimeNetwork, type RuntimePort } from "./network.js";
import { DEFAULT_PARAMETERS, PING_DEFAULTS, type SimulationLimits, type SimulationParameters } from "./parameters.js";
import {
  DHCP_CLIENT_PORT,
  DHCP_SERVER_PORT,
  DNS_SERVER_PORT,
  EPHEMERAL_PORT_MAX,
  EPHEMERAL_PORT_MIN,
  ETHERNET_WIRE_OVERHEAD_BYTES,
  LIMITED_BROADCAST,
  OSPF_ALL_DROUTERS,
  OSPF_ALL_ROUTERS,
  OSPF_BACKBONE,
  OSPF_INITIAL_SEQUENCE,
  OSPF_INTERFACE_MTU,
  OSPF_LS_REFRESH_TIME,
  OSPF_MAX_AGE,
  VRRP_MULTICAST,
  VRRP_TTL,
  RIP_INFINITY,
  RIP_MAX_ENTRIES,
  RIP_MULTICAST,
  RIP_PORT,
  UNSPECIFIED_ADDRESS,
  ZERO_MAC,
  frameBytes,
  isIcmpError,
  type ArpPacket,
  type DhcpMessage,
  type DhcpMessageType,
  type DhcpOptions,
  type DnsMessage,
  type EthernetFrame,
  type IcmpError,
  type Ipv4Packet,
  type Ipv4Payload,
  type OspfDatabaseDescription,
  type OspfHello,
  type OspfLinkStateRequest,
  type OspfLinkStateUpdate,
  type OspfLsa,
  type OspfLsaHeader,
  type OspfPacket,
  type OspfRouterLink,
  type Pdu,
  type RipEntry,
  type RipMessage,
  type UdpDatagram,
  type VrrpAdvertisement,
} from "./pdu.js";
import { compareLsa, compareLsaKeys, compareRouterIds, electDesignatedRouter, lsaHeader, lsaKey, sameLsaContent, shortestPaths, type SpfRoute } from "./ospf.js";
import { Prng } from "./prng.js";
import { EventQueue } from "./queue.js";
import { lookup, routeCidr, routingTable, type Route } from "./routing.js";
import { bridgeIdOf, computeSpanningTree, formatBridgeId, stableState, stpPortKey, type SpanningTree, type StpRole, type StpState } from "./stp.js";
import { MAX_SIM_TIME, fromSeconds, type SimTime } from "./time.js";
import type { Diagnostic, TraceCode, TraceEntry, TraceParams } from "./trace.js";
import type {
  DeviceView,
  DhcpClientPhase,
  DnsLookupStatus,
  DnsLookupView,
  LinkView,
  OspfInterfaceStateView,
  OspfNeighborStateView,
  OspfView,
  PingAttemptView,
  VrrpStateView,
  PingFailure,
  PingStatus,
  PingView,
  RipView,
  SimulationChanges,
  SimulationSnapshot,
} from "./views.js";

// ---------------------------------------------------------------- Événements

type EventValue =
  | { readonly type: "command"; readonly command: SimCommand; readonly sessionId: string | null }
  | {
      readonly type: "frame";
      readonly deviceId: string;
      readonly portId: string;
      readonly linkId: string;
      readonly frame: EthernetFrame;
      readonly exchange: string | null;
    }
  | { readonly type: "loopback"; readonly deviceId: string; readonly packet: Ipv4Packet; readonly exchange: string | null }
  | { readonly type: "mac-aging"; readonly deviceId: string; readonly key: string }
  | { readonly type: "stp-timer"; readonly deviceId: string; readonly portId: string; readonly generation: number }
  | { readonly type: "arp-expiry"; readonly deviceId: string; readonly key: string }
  | { readonly type: "arp-retry"; readonly deviceId: string; readonly key: string }
  | { readonly type: "ping-send"; readonly sessionId: string }
  | { readonly type: "ping-timeout"; readonly sessionId: string; readonly sequence: number }
  | { readonly type: "dhcp-start"; readonly deviceId: string; readonly portId: string }
  | { readonly type: "dhcp-retry"; readonly deviceId: string; readonly portId: string; readonly generation: number }
  | {
      readonly type: "dhcp-lease";
      readonly deviceId: string;
      readonly portId: string;
      readonly stage: "renew" | "rebind" | "expire";
      readonly generation: number;
    }
  | { readonly type: "dhcp-server-expiry"; readonly deviceId: string; readonly address: string; readonly generation: number }
  | { readonly type: "dns-retry"; readonly queryId: string; readonly attempt: number }
  | { readonly type: "rip-start"; readonly deviceId: string }
  | { readonly type: "rip-periodic"; readonly deviceId: string }
  | { readonly type: "rip-triggered"; readonly deviceId: string }
  | { readonly type: "rip-timer"; readonly deviceId: string; readonly key: string; readonly stage: "timeout" | "garbage"; readonly generation: number }
  | { readonly type: "ospf-start"; readonly deviceId: string }
  | { readonly type: "ospf-periodic"; readonly deviceId: string }
  | { readonly type: "ospf-hello"; readonly deviceId: string; readonly portId: string }
  | { readonly type: "ospf-wait"; readonly deviceId: string; readonly portId: string; readonly generation: number }
  | { readonly type: "ospf-dead"; readonly deviceId: string; readonly portId: string; readonly routerId: string; readonly generation: number }
  | { readonly type: "ospf-rxmt"; readonly deviceId: string; readonly portId: string; readonly routerId: string; readonly generation: number }
  | { readonly type: "ospf-spf"; readonly deviceId: string }
  | { readonly type: "vrrp-start"; readonly deviceId: string }
  | { readonly type: "vrrp-advert"; readonly deviceId: string; readonly portId: string; readonly generation: number }
  | { readonly type: "vrrp-down"; readonly deviceId: string; readonly portId: string; readonly generation: number }
  | { readonly type: "ospf-lsa-timer"; readonly deviceId: string; readonly area: string; readonly key: string; readonly stage: "refresh" | "max-age"; readonly generation: number };

interface QueuedEvent {
  readonly value: EventValue;
  readonly parent: number | null;
  /** Temporisation d'expiration : ne compte pas comme un échange en cours. */
  readonly housekeeping: boolean;
}

// ---------------------------------------------------------------- État des équipements

/** Entrée de table MAC, propre à un VLAN (clé « vlan|mac »). */
interface MacEntry {
  readonly vlan: number;
  readonly mac: MacAddress;
  portId: string;
  updatedAt: SimTime;
}

interface ArpEntry {
  readonly ip: string;
  readonly portId: string;
  mac: MacAddress;
  updatedAt: SimTime;
}

type PacketOrigin =
  | { readonly kind: "ping"; readonly sessionId: string; readonly sequence: number }
  | { readonly kind: "local" }
  | { readonly kind: "forwarded" }
  | { readonly kind: "dns"; readonly queryId: string };

interface QueuedPacket {
  readonly packet: Ipv4Packet;
  readonly origin: PacketOrigin;
  readonly exchange: string | null;
}

interface PendingResolution {
  readonly ip: string;
  readonly portId: string;
  attempts: number;
  retrySeq: number;
  readonly queue: QueuedPacket[];
}

const macKey = (vlan: number, mac: MacAddress): string => `${String(vlan)}|${mac}`;

/** État STP courant d'un port de switch participant (generation : annule les temporisations périmées). */
interface StpPortState {
  readonly deviceId: string;
  readonly portId: string;
  role: StpRole;
  state: StpState;
  cost: number;
  generation: number;
}

/** Bail tenu par un serveur DHCP (routeur), indexé par adresse. */
interface ServerLease {
  readonly address: string;
  readonly mac: MacAddress;
  /** Interface (et donc plage) qui a reçu la demande. */
  readonly portId: string;
  /** « offered » : adresse réservée par une offre, en attente de la demande du client. */
  state: "offered" | "bound";
  expiresAt: SimTime | null;
  generation: number;
}

interface DeviceState {
  readonly macTable: Map<string, MacEntry>;
  readonly macTimers: Set<string>;
  readonly arp: Map<string, ArpEntry>;
  readonly arpTimers: Set<string>;
  readonly pending: Map<string, PendingResolution>;
  readonly dhcpLeases: Map<string, ServerLease>;
  nextIdentification: number;
  /** Service DNS : réponses données (avec adresse) et noms inconnus (NXDOMAIN). */
  dnsAnswered: number;
  dnsNameErrors: number;
}

interface DhcpOffer {
  readonly address: string;
  readonly prefixLength: number;
  readonly gateway: string | null;
  readonly server: string;
  readonly leaseSeconds: number;
}

interface DhcpLease extends DhcpOffer {
  readonly obtainedAt: SimTime;
  readonly renewAt: SimTime;
  readonly rebindAt: SimTime;
  readonly expiresAt: SimTime;
}

/** Client DHCP d'un port de PC (generation : invalide les temporisations périmées). */
interface DhcpClient {
  readonly deviceId: string;
  readonly portId: string;
  phase: DhcpClientPhase;
  xid: number;
  attempts: number;
  retrySeq: number;
  generation: number;
  exchange: string | null;
  offer: DhcpOffer | null;
  lease: DhcpLease | null;
}

const NO_DHCP_OPTIONS: DhcpOptions = { serverId: null, requestedIp: null, subnetMask: null, router: null, leaseSeconds: null };
const dhcpClientKey = (deviceId: string, portId: string) => `${deviceId}/${portId}`;

/**
 * Résolution DNS d'un nom par un PC : nslookup (pingSessionId null) ou
 * préalable d'un ping par nom. Identifiant de message et port source sont
 * tirés au démarrage ; la réponse est reconnue par port, identifiant,
 * serveur et question (RFC 1035 §7.3).
 */
interface DnsQuery {
  readonly id: string;
  readonly deviceId: string;
  readonly name: string;
  readonly server: string | null;
  readonly pingSessionId: string | null;
  messageId: number;
  sourcePort: number;
  attempts: number;
  retrySeq: number;
  status: DnsLookupStatus;
  address: string | null;
  ttl: number | null;
}

/** Entrée de la table RIP d'un routeur, indexée par « réseau/préfixe ». */
interface RipRoute {
  readonly destination: number;
  readonly prefixLength: number;
  /** null : réseau d'une interface RIP du routeur lui-même (métrique 1). */
  nextHop: number | null;
  /** Interface de sortie, qui est aussi celle d'apprentissage (horizon partagé). */
  portId: string;
  metric: number;
  /** Drapeau de changement : la route part dans la prochaine mise à jour déclenchée. */
  changed: boolean;
  expiresAt: SimTime | null;
  garbageAt: SimTime | null;
  /** Invalide les temporisations périmées. */
  generation: number;
}

interface RipState {
  readonly routes: Map<string, RipRoute>;
  /** Pas de nouvelle mise à jour déclenchée avant cet instant (RFC 2453 §3.10.1). */
  holdUntil: SimTime;
  triggerPending: boolean;
  nextPeriodicAt: SimTime;
}

/** Voisin OSPF sur une interface (RFC 2328 §10) ; état Down : voisin retiré. */
interface OspfNeighbor {
  readonly routerId: string;
  address: string;
  priority: number;
  /** DR et BDR déclarés dans son dernier Hello. */
  dr: string;
  bdr: string;
  state: OspfNeighborStateView;
  deadAt: SimTime;
  deadGeneration: number;
  /** Échange de base : vrai si ce routeur est le maître ; numéro de séquence courant. */
  master: boolean;
  ddSequence: number;
  /** Dernière description envoyée (renvoyée en cas de doublon ou de retransmission). */
  lastDd: OspfDatabaseDescription | null;
  /** Le maître attend la réponse de l'esclave à lastDd. */
  awaiting: boolean;
  rxmtCount: number;
  rxmtSeq: number;
  /** Invalide les temporisations d'une adjacence abandonnée. */
  adjacency: number;
  /** LSA plus récents que les nôtres, à demander (liste de demandes, RFC 2328 §10). */
  readonly requests: Map<string, OspfLsaHeader>;
}

interface OspfInterfaceState {
  readonly portId: string;
  readonly mode: "active" | "passive";
  readonly cost: number;
  readonly priority: number;
  readonly area: string;
  state: OspfInterfaceStateView;
  /** Adresses d'interface du DR et du BDR élus (0.0.0.0 : aucun). */
  dr: string;
  bdr: string;
  waitGeneration: number;
  helloPending: boolean;
  readonly neighbors: Map<string, OspfNeighbor>;
}

interface StoredLsa {
  readonly lsa: OspfLsa;
  readonly installedAt: SimTime;
  readonly generation: number;
}

/** Route OSPF retenue : intra-zone, ou inter-zones (résumé d'un routeur de bordure). */
interface OspfRoute extends SpfRoute {
  readonly inter: boolean;
  readonly area: string;
  readonly advertisingRouter: string | null;
}

interface OspfState {
  readonly routerId: string;
  readonly interfaces: Map<string, OspfInterfaceState>;
  /** Base d'états des liens de chaque zone configurée. */
  readonly lsdbs: Map<string, Map<string, StoredLsa>>;
  /** Routeur de bordure : relié à plusieurs zones (bit B). */
  abr: boolean;
  routes: OspfRoute[];
  spfPending: boolean;
  nextHelloAt: SimTime;
}

const NO_ROUTER = "0.0.0.0";
/** Voisins avec qui la base est échangée ou synchronisée (RFC 2328 §13 : état Exchange au moins). */
const OSPF_SYNCING: ReadonlySet<OspfNeighborStateView> = new Set(["exchange", "loading", "full"]);
/** Retransmissions d'une description comptées comme échanges en cours ; les suivantes sont des temporisations de fond. */
const OSPF_ACTIVE_RETRANSMISSIONS = 3;

/** Groupe VRRP d'une interface de routeur et son état (RFC 5798 §6.4). */
interface VrrpRuntime {
  readonly vrid: number;
  readonly address: string;
  readonly value: number;
  readonly mac: MacAddress;
  /** Priorité effective : 255 pour le propriétaire de l'adresse virtuelle (RFC 5798 §5.2.4). */
  readonly priority: number;
  readonly owner: boolean;
  readonly preempt: boolean;
  state: VrrpStateView;
  /** Intervalle annoncé par le maître (Master_Adver_Interval). */
  masterAdverInterval: SimTime;
  master: string | null;
  downAt: SimTime | null;
  nextAdvertAt: SimTime | null;
  generation: number;
}

const vrrpKey = (deviceId: string, portId: string) => `${deviceId}/${portId}`;

const ripKey = (destination: number, prefixLength: number) => `${formatIpv4(destination)}/${String(prefixLength)}`;

interface PingAttempt {
  readonly sequence: number;
  status: PingStatus;
  readonly sentAt: SimTime;
  timeoutSeq: number;
  rtt: SimTime | null;
  ttl: number | null;
  from: string | null;
  errorType: IcmpError["type"] | null;
  errorCode: number | null;
  failure: PingFailure | null;
}

interface PingSession {
  readonly id: string;
  readonly deviceId: string;
  /** Adresse IPv4 ou nom canonique demandé. */
  readonly destination: string;
  /** Adresse visée : la destination, ou celle obtenue par DNS (null avant la résolution). */
  address: string | null;
  resolution: DnsLookupStatus | null;
  readonly count: number;
  identifier: number;
  started: boolean;
  done: boolean;
  readonly attempts: PingAttempt[];
}

/** Paquet IP à émettre ; source null : adresse de l'interface de sortie. */
interface PacketDraft {
  readonly source: string | null;
  readonly destination: string;
  readonly ttl: number;
  readonly payload: Ipv4Payload;
}

type NoRouteReason = "no-address" | "interfaces-down" | "no-gateway" | "gateway-unreachable" | "no-match";

interface Where {
  readonly device?: RuntimeDevice | undefined;
  readonly port?: RuntimePort | undefined;
  readonly exchange?: string | null | undefined;
  readonly pdu?: Pdu | null | undefined;
}

export interface RunOptions {
  /** Ne traite pas d'événement postérieur à cet instant ; l'horloge avance jusqu'à lui. */
  readonly until?: SimTime | undefined;
  /** Nombre maximal d'événements traités par appel (découpage en lots). */
  readonly maxEvents: number;
  /** S'arrête dès qu'il ne reste que des temporisations d'expiration. */
  readonly stopWhenIdle?: boolean | undefined;
}

export type RunStop = "horizon" | "budget" | "idle" | "empty" | "interrupted";

export interface RunResult {
  readonly trace: TraceEntry[];
  readonly processed: number;
  readonly stop: RunStop;
}

export interface SimulationOptions {
  /** Graine du générateur pseudo-aléatoire (entier 32 bits non signé). */
  readonly seed?: number | undefined;
  readonly parameters?: Partial<Omit<SimulationParameters, "limits">> & { readonly limits?: Partial<SimulationLimits> };
}

export type CreateSimulationResult = { readonly ok: true; readonly simulation: Simulation } | { readonly ok: false; readonly issues: Issue[] };

export const DEFAULT_SEED = 1;

/**
 * Crée une simulation à partir d'un document. Un document comportant des
 * erreurs de validation est refusé : le moteur ne simule jamais un état
 * incohérent.
 */
export function createSimulation(doc: NfgDocument, options: SimulationOptions = {}): CreateSimulationResult {
  const issues = validateDocument(doc).filter((issue) => issue.severity === "error");
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, simulation: new Simulation(doc, options) };
}

const arpKey = (portId: string, ip: string) => `${portId}|${ip}`;

export class Simulation {
  readonly seed: number;
  readonly parameters: SimulationParameters;
  private readonly network: RuntimeNetwork;
  private readonly prng: Prng;
  private readonly queue = new EventQueue<QueuedEvent>();
  private readonly cancelled = new Set<number>();
  private readonly states = new Map<string, DeviceState>();
  private readonly sessions = new Map<string, PingSession>();
  private readonly log: Array<{ readonly time: SimTime; readonly command: SimCommand }> = [];
  private readonly dirtyDevices = new Set<string>();
  private readonly dirtyPings = new Set<string>();
  private readonly dirtyLinks = new Set<string>();
  private nextSeq = 1;
  private nextSessionNumber = 1;
  /** Événements programmés hors temporisations d'expiration, non encore traités ni annulés. */
  private readonly active = new Set<number>();
  private clock: SimTime = 0;
  private processed = 0;
  private diagnosticValue: Diagnostic | null = null;
  private timeOverflow = false;
  private current: { readonly id: number; readonly parent: number | null } | null = null;
  private out: TraceEntry[] = [];
  /** Spanning Tree courant et état de chaque port participant. */
  private tree: SpanningTree;
  private readonly stpPorts = new Map<string, StpPortState>();
  /** Clients DHCP (ports de PC en adressage automatique). */
  private readonly dhcpClients = new Map<string, DhcpClient>();
  private nextDhcpExchange = 1;
  /** Résolutions DNS (nslookup et pings par nom), par identifiant d'échange « dns-N ». */
  private readonly dnsQueries = new Map<string, DnsQuery>();
  private nextDnsQuery = 1;
  private readonly dirtyLookups = new Set<string>();
  /** RIP : état des routeurs ayant au moins une interface RIP. */
  private readonly rip = new Map<string, RipState>();
  private nextRipExchange = 1;
  /** OSPF : état des routeurs ayant au moins une interface OSPF. */
  private readonly ospf = new Map<string, OspfState>();
  private nextOspfExchange = 1;
  /** VRRP : groupe de chaque interface de routeur qui en a un. */
  private readonly vrrp = new Map<string, VrrpRuntime>();
  private nextVrrpExchange = 1;

  constructor(doc: NfgDocument, options: SimulationOptions = {}) {
    this.seed = options.seed ?? DEFAULT_SEED;
    const { limits, ...rest } = options.parameters ?? {};
    this.parameters = { ...DEFAULT_PARAMETERS, ...rest, limits: { ...DEFAULT_PARAMETERS.limits, ...limits } };
    this.prng = Prng.fromSeed(this.seed);
    this.network = buildNetwork(doc);
    for (const device of this.network.devices.values()) {
      this.states.set(device.id, {
        macTable: new Map(),
        macTimers: new Set(),
        arp: new Map(),
        arpTimers: new Set(),
        pending: new Map(),
        dhcpLeases: new Map(),
        nextIdentification: this.prng.nextInt(0x10000),
        dnsAnswered: 0,
        dnsNameErrors: 0,
      });
    }
    this.tree = computeSpanningTree(this.network, this.isUp);
    this.initStp();
    // Les postes en DHCP demandent une adresse dès le démarrage (sans l'attente aléatoire de 1 à 10 s).
    for (const device of this.network.devices.values()) {
      for (const port of device.ports) {
        if (!port.dhcp) continue;
        this.dhcpClients.set(dhcpClientKey(device.id, port.portId), {
          deviceId: device.id,
          portId: port.portId,
          phase: "init",
          xid: 0,
          attempts: 0,
          retrySeq: -1,
          generation: 0,
          exchange: null,
          offer: null,
          lease: null,
        });
        this.schedule(0, { type: "dhcp-start", deviceId: device.id, portId: port.portId });
      }
    }
    // RIP : table initiale des réseaux locaux, demande de table complète au démarrage, annonces toutes les 30 s.
    for (const device of this.network.devices.values()) {
      if (device.kind !== "router" || device.ripInterfaces.size === 0) continue;
      this.rip.set(device.id, { routes: new Map(), holdUntil: 0, triggerPending: false, nextPeriodicAt: this.parameters.ripUpdateInterval });
      this.syncRipNetworks(device, false);
      this.schedule(0, { type: "rip-start", deviceId: device.id });
      this.schedule(this.parameters.ripUpdateInterval, { type: "rip-periodic", deviceId: device.id }, true);
    }
    // VRRP : groupes des routeurs, démarrage à l'instant 0.
    for (const device of this.network.devices.values()) {
      if (device.kind !== "router" || device.vrrpGroups.size === 0) continue;
      for (const [portId, config] of device.vrrpGroups) {
        const port = device.portById.get(portId);
        const value = parseIpv4(config.address);
        if (!port || value === null) continue;
        const owner = port.ipv4?.value === value;
        this.vrrp.set(vrrpKey(device.id, portId), {
          vrid: config.vrid,
          address: config.address,
          value,
          mac: vrrpMac(config.vrid),
          priority: owner ? 255 : config.priority,
          owner,
          preempt: config.preempt,
          state: "initialize",
          masterAdverInterval: this.parameters.vrrpAdvertisementInterval,
          master: null,
          downAt: null,
          nextAdvertAt: null,
          generation: 0,
        });
      }
      this.schedule(0, { type: "vrrp-start", deviceId: device.id });
    }
    // OSPF : identifiant = plus grande adresse IPv4 du routeur (choix NetForge) ; démarrage à 0, Hello toutes les 10 s.
    for (const device of this.network.devices.values()) {
      if (device.kind !== "router" || device.ospfInterfaces.size === 0) continue;
      const addresses = device.ports.flatMap((port) => (port.ipv4 ? [port.ipv4.value] : []));
      if (addresses.length === 0) continue;
      const interfaces = new Map<string, OspfInterfaceState>();
      for (const [portId, config] of device.ospfInterfaces) {
        interfaces.set(portId, { portId, ...config, state: "down", dr: NO_ROUTER, bdr: NO_ROUTER, waitGeneration: 0, helloPending: false, neighbors: new Map() });
      }
      const lsdbs = new Map([...new Set([...interfaces.values()].map((iface) => iface.area))].sort(compareRouterIds).map((area) => [area, new Map<string, StoredLsa>()] as const));
      this.ospf.set(device.id, { routerId: formatIpv4(Math.max(...addresses)), interfaces, lsdbs, abr: false, routes: [], spfPending: false, nextHelloAt: this.parameters.ospfHelloInterval });
      this.schedule(0, { type: "ospf-start", deviceId: device.id });
      this.schedule(this.parameters.ospfHelloInterval, { type: "ospf-periodic", deviceId: device.id }, true);
    }
  }

  // ---------------------------------------------------------------- API publique

  get time(): SimTime {
    return this.clock;
  }

  get diagnostic(): Diagnostic | null {
    return this.diagnosticValue;
  }

  get processedEvents(): number {
    return this.processed;
  }

  get pendingEvents(): number {
    return this.queue.size - this.cancelled.size;
  }

  /** Vrai tant que des échanges restent à calculer (hors temporisations d'expiration). */
  hasActivity(): boolean {
    return this.active.size > 0;
  }

  nextEventTime(): SimTime | null {
    return this.queue.peek()?.time ?? null;
  }

  /** Commandes acceptées, avec leur instant d'application : permet de rejouer une session. */
  get commandLog(): ReadonlyArray<{ readonly time: SimTime; readonly command: SimCommand }> {
    return this.log;
  }

  /** Valide une commande et la programme à l'instant courant. */
  enqueue(command: SimCommand): CommandOutcome {
    if (this.diagnosticValue) return reject("command.interrupted", {});
    if (command.type === "set-link") {
      if (!this.network.links.has(command.linkId)) return reject("command.unknown-link", { linkId: command.linkId });
      const normalized: SimCommand = { type: "set-link", linkId: command.linkId, up: command.up };
      this.schedule(this.clock, { type: "command", command: normalized, sessionId: null });
      this.log.push({ time: this.clock, command: normalized });
      return { ok: true, sessionId: null };
    }

    const device = this.network.devices.get(command.deviceId);
    if (!device) return reject("command.unknown-device", { deviceId: command.deviceId });
    if (command.type === "clear-table") {
      // Un switch n'a qu'une table MAC ; un PC ou un routeur, qu'un cache ARP.
      if ((command.table === "mac") !== (device.kind === "switch")) {
        return reject("command.wrong-table", { deviceId: device.id, deviceName: device.name, table: command.table });
      }
      const normalized: SimCommand = { type: "clear-table", deviceId: device.id, table: command.table };
      this.schedule(this.clock, { type: "command", command: normalized, sessionId: null });
      this.log.push({ time: this.clock, command: normalized });
      return { ok: true, sessionId: null };
    }
    if (command.type === "dhcp") {
      if (device.kind !== "pc") return reject("command.not-a-pc", { deviceId: device.id, deviceName: device.name });
      if (!device.ports.some((port) => port.dhcp)) return reject("command.not-dhcp-client", { deviceId: device.id, deviceName: device.name });
      const normalized: SimCommand = { type: "dhcp", deviceId: device.id, action: command.action };
      this.schedule(this.clock, { type: "command", command: normalized, sessionId: null });
      this.log.push({ time: this.clock, command: normalized });
      return { ok: true, sessionId: null };
    }
    if (device.kind !== "pc") return reject("command.not-a-pc", { deviceId: device.id, deviceName: device.name });
    if (command.type === "nslookup") {
      const name = normalizeDnsName(command.name);
      if (name === null) return reject("command.invalid-name", { name: command.name.trim() });
      const pending = [...this.dnsQueries.values()].filter((query) => query.pingSessionId === null && query.status === "pending").length;
      if (pending >= this.parameters.limits.maxDnsLookups) return reject("command.too-many-lookups", { max: this.parameters.limits.maxDnsLookups });
      const query = this.newQuery(device, name, null);
      const normalized: SimCommand = { type: "nslookup", deviceId: device.id, name };
      this.schedule(this.clock, { type: "command", command: normalized, sessionId: query.id });
      this.log.push({ time: this.clock, command: normalized });
      return { ok: true, sessionId: query.id };
    }
    const typed = command.destination.trim();
    // Une destination qui n'est pas une adresse IPv4 est un nom d'hôte, résolu par DNS avant le premier écho.
    const name = parseIpv4(typed) === null ? normalizeDnsName(typed) : null;
    const invalid = name === null ? this.invalidDestination(device, typed) : null;
    if (invalid) return reject("command.invalid-destination", { destination: typed, reason: invalid });
    const destination = name ?? typed;
    const count = command.count ?? PING_DEFAULTS.count;
    if (!Number.isInteger(count) || count < 1 || count > PING_DEFAULTS.maxCount) {
      return reject("command.invalid-count", { max: PING_DEFAULTS.maxCount });
    }
    const active = [...this.sessions.values()].filter((session) => !session.done).length;
    if (active >= this.parameters.limits.maxPingSessions) {
      return reject("command.too-many-pings", { max: this.parameters.limits.maxPingSessions });
    }
    const sessionId = `ping-${String(this.nextSessionNumber)}`;
    this.nextSessionNumber += 1;
    this.sessions.set(sessionId, {
      id: sessionId,
      deviceId: device.id,
      destination,
      address: name === null ? destination : null,
      resolution: null,
      count,
      identifier: 0,
      started: false,
      done: false,
      attempts: [],
    });
    this.dirtyPings.add(sessionId);
    const normalized: SimCommand = { type: "ping", deviceId: device.id, destination, count };
    this.schedule(this.clock, { type: "command", command: normalized, sessionId });
    this.log.push({ time: this.clock, command: normalized });
    return { ok: true, sessionId };
  }

  /**
   * Traite les événements dans l'ordre (instant, numéro d'ordre) jusqu'à
   * l'horizon, au budget d'événements ou à l'inactivité demandés.
   */
  run(options: RunOptions): RunResult {
    this.out = [];
    let processed = 0;
    let stop: RunStop;
    for (;;) {
      if (this.diagnosticValue) {
        stop = "interrupted";
        break;
      }
      if (options.stopWhenIdle && this.active.size === 0) {
        stop = "idle";
        break;
      }
      const next = this.peekLive();
      if (!next) {
        stop = "empty";
        break;
      }
      if (options.until !== undefined && next.time > options.until) {
        stop = "horizon";
        break;
      }
      if (processed >= options.maxEvents) {
        stop = "budget";
        break;
      }
      this.processNext();
      processed += 1;
    }
    if ((stop === "horizon" || stop === "empty") && options.until !== undefined && options.until > this.clock) {
      this.clock = Math.min(options.until, MAX_SIM_TIME);
    }
    return { trace: this.out, processed, stop };
  }

  /**
   * Pas à pas : traite le prochain événement qui produit au moins une
   * décision observable (les vérifications internes sans effet sont passées).
   */
  step(): RunResult {
    this.out = [];
    let processed = 0;
    while (!this.diagnosticValue && this.peekLive()) {
      this.processNext();
      processed += 1;
      if (this.out.length > 0) break;
    }
    const stop: RunStop = this.diagnosticValue ? "interrupted" : this.peekLive() ? "budget" : "empty";
    return { trace: this.out, processed, stop };
  }

  snapshot(): SimulationSnapshot {
    return {
      time: this.clock,
      status: this.diagnosticValue ? "interrupted" : "ready",
      diagnostic: this.diagnosticValue,
      processedEvents: this.processed,
      pendingEvents: this.pendingEvents,
      activity: this.hasActivity(),
      devices: [...this.network.devices.values()].map((device) => this.deviceView(device)),
      pings: [...this.sessions.values()].map((session) => pingView(session)),
      lookups: [...this.dnsQueries.values()].filter((query) => query.pingSessionId === null).map((query) => lookupView(query)),
      links: [...this.network.links.values()].map((link) => ({ linkId: link.id, up: link.up })),
    };
  }

  /** Éléments modifiés depuis le dernier appel (envoi par lots vers l'interface). */
  takeChanges(): SimulationChanges {
    const devices: DeviceView[] = [];
    for (const id of this.dirtyDevices) {
      const device = this.network.devices.get(id);
      if (device) devices.push(this.deviceView(device));
    }
    const pings: PingView[] = [];
    for (const id of this.dirtyPings) {
      const session = this.sessions.get(id);
      if (session) pings.push(pingView(session));
    }
    const lookups: DnsLookupView[] = [];
    for (const id of this.dirtyLookups) {
      const query = this.dnsQueries.get(id);
      if (query) lookups.push(lookupView(query));
    }
    const links: LinkView[] = [];
    for (const id of this.dirtyLinks) {
      const link = this.network.links.get(id);
      if (link) links.push({ linkId: link.id, up: link.up });
    }
    this.dirtyDevices.clear();
    this.dirtyPings.clear();
    this.dirtyLookups.clear();
    this.dirtyLinks.clear();
    return { devices, pings, lookups, links };
  }

  // ---------------------------------------------------------------- Boucle d'événements

  private peekLive() {
    for (;;) {
      const next = this.queue.peek();
      if (!next || !this.cancelled.has(next.seq)) return next;
      this.queue.pop();
      this.cancelled.delete(next.seq);
    }
  }

  private schedule(time: SimTime, value: EventValue, housekeeping = false): number {
    if (time > MAX_SIM_TIME) {
      this.timeOverflow = true;
      return -1;
    }
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.queue.push({ time, seq, value: { value, parent: this.current?.id ?? null, housekeeping } });
    if (!housekeeping) this.active.add(seq);
    return seq;
  }

  /** Annule un événement non encore traité (réponse arrivée avant l'expiration, etc.). */
  private cancel(seq: number): void {
    // Seul un événement encore en attente peut être annulé.
    if (this.active.delete(seq)) this.cancelled.add(seq);
  }

  private processNext(): void {
    const item = this.peekLive();
    if (!item) return;
    this.queue.pop();
    this.active.delete(item.seq);
    this.clock = item.time;
    this.current = { id: item.seq, parent: item.value.parent };
    this.handle(item.value.value);
    this.processed += 1;
    this.checkLimits();
    this.current = null;
  }

  private checkLimits(): void {
    const { limits } = this.parameters;
    if (this.timeOverflow) this.interrupt("limit.time", MAX_SIM_TIME);
    else if (this.processed >= limits.maxEvents) this.interrupt("limit.events", limits.maxEvents);
    else if (this.pendingEvents > limits.maxPendingEvents) this.interrupt("limit.pending-events", limits.maxPendingEvents);
  }

  /** Interruption propre : l'événement en cours est terminé, les suivants ne sont pas calculés. */
  private interrupt(code: Diagnostic["code"], limit: number): void {
    const diagnostic: Diagnostic = {
      code,
      time: this.clock,
      limit,
      pendingEvents: this.pendingEvents,
      nextEventTime: this.peekLive()?.time ?? null,
    };
    this.diagnosticValue = diagnostic;
    this.emit("sim.interrupted", { code, limit, pendingEvents: diagnostic.pendingEvents });
  }

  private emit(code: TraceCode, params: TraceParams, where: Where = {}): void {
    this.out.push({
      event: this.current?.id ?? 0,
      parent: this.current?.parent ?? null,
      time: this.clock,
      deviceId: where.device?.id ?? where.port?.deviceId ?? null,
      portId: where.port?.portId ?? null,
      exchange: where.exchange ?? null,
      code,
      params,
      pdu: where.pdu ?? null,
    });
  }

  private handle(value: EventValue): void {
    switch (value.type) {
      case "command":
        this.applyCommand(value.command, value.sessionId);
        return;
      case "frame":
        this.onFrame(value.deviceId, value.portId, value.linkId, value.frame, value.exchange);
        return;
      case "loopback": {
        const device = this.network.devices.get(value.deviceId);
        if (device) this.deliverLocal(device, value.packet, value.exchange);
        return;
      }
      case "mac-aging":
        this.onMacAging(value.deviceId, value.key);
        return;
      case "stp-timer":
        this.onStpTimer(value.deviceId, value.portId, value.generation);
        return;
      case "arp-expiry":
        this.onArpExpiry(value.deviceId, value.key);
        return;
      case "arp-retry":
        this.onArpRetry(value.deviceId, value.key);
        return;
      case "ping-send": {
        const session = this.sessions.get(value.sessionId);
        if (session) this.sendEcho(session);
        return;
      }
      case "ping-timeout":
        this.onPingTimeout(value.sessionId, value.sequence);
        return;
      case "dhcp-start": {
        const client = this.dhcpClients.get(dhcpClientKey(value.deviceId, value.portId));
        if (client?.phase === "init") this.startDiscover(client);
        return;
      }
      case "dhcp-retry":
        this.onDhcpRetry(value.deviceId, value.portId, value.generation);
        return;
      case "dhcp-lease":
        this.onDhcpLeaseTimer(value.deviceId, value.portId, value.stage, value.generation);
        return;
      case "dhcp-server-expiry":
        this.onServerLeaseExpiry(value.deviceId, value.address, value.generation);
        return;
      case "dns-retry":
        this.onDnsRetry(value.queryId, value.attempt);
        return;
      case "rip-start":
        this.onRipStart(value.deviceId);
        return;
      case "rip-periodic":
        this.onRipPeriodic(value.deviceId);
        return;
      case "rip-triggered":
        this.onRipTriggered(value.deviceId);
        return;
      case "rip-timer":
        this.onRipTimer(value.deviceId, value.key, value.stage, value.generation);
        return;
      case "ospf-start":
        this.onOspfStart(value.deviceId);
        return;
      case "ospf-periodic":
        this.onOspfPeriodic(value.deviceId);
        return;
      case "ospf-hello":
        this.onOspfHelloTimer(value.deviceId, value.portId);
        return;
      case "ospf-wait":
        this.onOspfWait(value.deviceId, value.portId, value.generation);
        return;
      case "ospf-dead":
        this.onOspfDead(value.deviceId, value.portId, value.routerId, value.generation);
        return;
      case "ospf-rxmt":
        this.onOspfRxmt(value.deviceId, value.portId, value.routerId, value.generation);
        return;
      case "ospf-spf":
        this.onOspfSpf(value.deviceId);
        return;
      case "vrrp-start":
        this.onVrrpStart(value.deviceId);
        return;
      case "vrrp-advert":
        this.onVrrpAdvertTimer(value.deviceId, value.portId, value.generation);
        return;
      case "vrrp-down":
        this.onVrrpDown(value.deviceId, value.portId, value.generation);
        return;
      case "ospf-lsa-timer":
        this.onOspfLsaTimer(value.deviceId, value.area, value.key, value.stage, value.generation);
        return;
    }
  }

  // ---------------------------------------------------------------- Accès

  private device(id: string): RuntimeDevice {
    const device = this.network.devices.get(id);
    if (!device) throw new Error(`équipement inconnu du moteur : ${id}`);
    return device;
  }

  private state(id: string): DeviceState {
    const state = this.states.get(id);
    if (!state) throw new Error(`état absent : ${id}`);
    return state;
  }

  private isUp = (port: RuntimePort): boolean => isPortUp(this.network, port);

  private routes(device: RuntimeDevice): Route[] {
    return routingTable(device, this.isUp, [...this.ospfRoutes(device), ...this.ripRoutes(device)]);
  }

  /** Routes RIP apprises et utilisables (métrique inférieure à 16) ; un réseau local reste une route connectée. */
  private ripRoutes(device: RuntimeDevice): Route[] {
    const state = this.rip.get(device.id);
    if (!state) return [];
    const routes: Route[] = [];
    for (const entry of state.routes.values()) {
      if (entry.nextHop === null || entry.metric >= RIP_INFINITY) continue;
      const port = device.portById.get(entry.portId) ?? null;
      const up = port !== null && this.isUp(port);
      routes.push({
        kind: "rip",
        destination: entry.destination,
        prefixLength: entry.prefixLength,
        nextHop: entry.nextHop,
        port,
        active: up,
        reason: up ? null : "interface-down",
        metric: entry.metric,
      });
    }
    return routes;
  }

  private ownsAddress(device: RuntimeDevice, value: number): boolean {
    return device.ports.some((port) => port.ipv4?.value === value);
  }

  private latency(device: RuntimeDevice): SimTime {
    const { switchLatency, routerLatency, hostLatency } = this.parameters;
    return device.kind === "switch" ? switchLatency : device.kind === "router" ? routerLatency : hostLatency;
  }

  private arpLifetime(device: RuntimeDevice): SimTime {
    return device.kind === "router" ? this.parameters.routerArpLifetime : this.parameters.hostArpLifetime;
  }

  private initialTtl(device: RuntimeDevice): number {
    return device.kind === "router" ? this.parameters.routerInitialTtl : this.parameters.hostInitialTtl;
  }

  private invalidDestination(device: RuntimeDevice, destination: string): string | null {
    const value = parseIpv4(destination);
    if (value === null) return "format";
    if (value >>> 24 === 127) return null;
    const reason = unassignableReason({ address: destination, prefixLength: 32 });
    if (reason) return reason;
    // Adresse de diffusion de son propre réseau : pas d'écho diffusé dans cette version.
    const broadcast = device.ports.some((port) => port.ipv4 && port.ipv4.prefixLength <= 30 && port.ipv4.broadcast === value);
    return broadcast ? "broadcast-address" : null;
  }

  // ---------------------------------------------------------------- Commandes

  private applyCommand(command: SimCommand, sessionId: string | null): void {
    if (command.type === "set-link") {
      this.setLink(command.linkId, command.up);
      return;
    }
    if (command.type === "clear-table") {
      this.clearTable(command.deviceId, command.table);
      return;
    }
    if (command.type === "dhcp") {
      this.dhcpCommand(command.deviceId, command.action);
      return;
    }
    if (command.type === "nslookup") {
      const query = sessionId ? this.dnsQueries.get(sessionId) : undefined;
      if (!query) return;
      this.emit("command.nslookup", { name: query.name, server: query.server }, { device: this.device(query.deviceId), exchange: query.id });
      this.startQuery(query);
      return;
    }
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) return;
    const device = this.device(session.deviceId);
    session.identifier = this.drawIdentifier(session);
    session.started = true;
    this.emit("command.ping", { destination: session.destination, count: session.count, identifier: session.identifier }, {
      device,
      exchange: session.id,
    });
    if (session.address === null) {
      // Ping par nom : la résolution précède le premier écho.
      this.startQuery(this.newQuery(device, session.destination, session.id));
      return;
    }
    this.sendEcho(session);
  }

  /**
   * Vide une table apprise. Les temporisations déjà programmées restent : à
   * leur échéance, elles ne trouvent plus d'entrée (ou une entrée réapprise
   * plus tard, dont l'échéance est alors recalculée).
   */
  private clearTable(deviceId: string, table: "arp" | "mac"): void {
    const device = this.device(deviceId);
    const state = this.state(deviceId);
    const target = table === "arp" ? state.arp : state.macTable;
    const count = target.size;
    target.clear();
    this.dirtyDevices.add(deviceId);
    this.emit(table === "arp" ? "command.clear-arp" : "command.clear-mac", { count }, { device });
  }

  /** Identifiant ICMP tiré du générateur à graine, unique parmi les pings actifs de l'équipement. */
  private drawIdentifier(session: PingSession): number {
    const taken = new Set(
      [...this.sessions.values()]
        .filter((other) => other.deviceId === session.deviceId && other.started && !other.done)
        .map((other) => other.identifier),
    );
    let identifier = this.prng.nextInt(0x10000);
    while (taken.has(identifier)) identifier = this.prng.nextInt(0x10000);
    return identifier;
  }

  private setLink(linkId: string, up: boolean): void {
    const link = this.network.links.get(linkId);
    if (!link) return;
    const changed = link.up !== up;
    link.up = up;
    this.emit(up ? "command.link-up" : "command.link-down", { linkId, changed });
    if (!changed) return;
    this.dirtyLinks.add(linkId);
    for (const end of link.ends) {
      this.dirtyDevices.add(end.deviceId);
      const device = this.device(end.deviceId);
      // Un switch oublie les adresses apprises sur un port qui tombe.
      if (!up && device.kind === "switch") {
        const state = this.state(device.id);
        let count = 0;
        for (const [key, entry] of state.macTable) {
          if (entry.portId === end.portId) {
            state.macTable.delete(key);
            count += 1;
          }
        }
        this.emit("switch.flush", { count }, { device, port: device.portById.get(end.portId) });
      }
    }
    this.recomputeStp();
    // VRRP : groupe des interfaces concernées (initialisation, ou nouveau démarrage).
    for (const end of link.ends) {
      const device = this.device(end.deviceId);
      for (const port of device.ports) {
        if (port.portId === end.portId || port.parent === end.portId) this.vrrpLinkChange(device, port, up);
      }
    }
    // OSPF : interface tombée (voisins perdus aussitôt) ou rétablie (attente, Hello).
    for (const end of link.ends) {
      const device = this.device(end.deviceId);
      const state = this.ospf.get(device.id);
      if (!state) continue;
      for (const iface of state.interfaces.values()) {
        const port = device.portById.get(iface.portId);
        if (!port || (port.portId !== end.portId && port.parent !== end.portId)) continue;
        if (!up) this.ospfInterfaceDown(device, state, iface, port);
        else if (iface.state === "down") this.ospfInterfaceUp(device, iface, port);
      }
      this.updateOwnLsas(device, state);
    }
    // RIP : réseaux et routes des interfaces concernées ; une interface rétablie redemande la table de ses voisins.
    for (const end of link.ends) {
      const device = this.device(end.deviceId);
      if (!this.rip.has(device.id)) continue;
      if (this.syncRipNetworks(device, true)) this.markRipChanged(device);
      if (up) {
        for (const port of device.ports) {
          if ((port.portId === end.portId || port.parent === end.portId) && this.ripActive(device, port)) this.sendRipRequest(device, port);
        }
      }
    }
  }

  // ---------------------------------------------------------------- Spanning Tree

  private stpForwards(device: RuntimeDevice, port: RuntimePort): boolean {
    const stp = this.stpPorts.get(stpPortKey(device.id, port.portId));
    return !stp || stp.state === "forwarding";
  }

  /** État initial : le réseau démarre convergé (simplification documentée). */
  private initStp(): void {
    for (const [key, port] of this.tree.ports) {
      const [deviceId = "", portId = ""] = key.split("/");
      this.stpPorts.set(key, { deviceId, portId, role: port.role, state: stableState(port.role), cost: port.cost, generation: 0 });
    }
  }

  /**
   * Après un changement de lien : nouvel arbre. Un port appelé à transmettre
   * passe par l'écoute puis l'apprentissage (Forward Delay chacun) ; un port
   * appelé à bloquer bloque aussitôt. Si la racine, un port racine ou un coût
   * change, les switches participants vident leur table MAC (changement de
   * topologie, simplification du vieillissement accéléré de 802.1D).
   */
  private recomputeStp(): void {
    const next = computeSpanningTree(this.network, this.isUp);
    const delay = this.parameters.stpForwardDelay;
    let rolesChanged = false;
    for (const [key, port] of next.ports) {
      const current = this.stpPorts.get(key);
      if (!current) continue;
      const device = this.device(current.deviceId);
      const runtimePort = device.portById.get(current.portId);
      if (current.role !== port.role) rolesChanged = true;
      current.role = port.role;
      current.cost = port.cost;
      const target = stableState(port.role);
      if (target === "forwarding") {
        if (current.state === "blocking" || current.state === "disabled") {
          current.state = "listening";
          current.generation += 1;
          this.schedule(this.clock + delay, { type: "stp-timer", deviceId: current.deviceId, portId: current.portId, generation: current.generation });
          this.emit("stp.port-state", { state: "listening", role: port.role, until: this.clock + delay }, { device, port: runtimePort });
        }
      } else if (current.state !== target) {
        current.state = target;
        current.generation += 1;
        this.emit("stp.port-state", { state: target, role: port.role }, { device, port: runtimePort });
      }
      this.dirtyDevices.add(current.deviceId);
    }
    const bridgesChanged = [...next.bridges].some(([id, bridge]) => {
      const previous = this.tree.bridges.get(id);
      return !previous || previous.rootDeviceId !== bridge.rootDeviceId || previous.rootPort !== bridge.rootPort || previous.rootCost !== bridge.rootCost;
    });
    this.tree = next;
    if (!rolesChanged && !bridgesChanged) return;
    for (const [id, bridge] of next.bridges) {
      const device = this.device(id);
      const state = this.state(id);
      const flushed = state.macTable.size;
      state.macTable.clear();
      this.emit("stp.topology-change", { rootDeviceId: bridge.rootDeviceId, rootCost: bridge.rootCost, rootPort: bridge.rootPort ?? "", flushed }, { device });
    }
  }

  private onStpTimer(deviceId: string, portId: string, generation: number): void {
    const current = this.stpPorts.get(stpPortKey(deviceId, portId));
    if (!current || current.generation !== generation) return;
    const device = this.device(deviceId);
    const port = device.portById.get(portId);
    if (current.state === "listening") {
      current.state = "learning";
      const until = this.clock + this.parameters.stpForwardDelay;
      this.schedule(until, { type: "stp-timer", deviceId, portId, generation });
      this.emit("stp.port-state", { state: "learning", role: current.role, until }, { device, port });
    } else if (current.state === "learning") {
      current.state = "forwarding";
      this.emit("stp.port-state", { state: "forwarding", role: current.role }, { device, port });
    }
    this.dirtyDevices.add(deviceId);
  }

  // ---------------------------------------------------------------- Couche liaison

  /**
   * Étiquette 802.1Q posée à l'émission : sous-interface de routeur → son
   * VLAN ; port de switch en trunk → VLAN de la trame sauf VLAN natif ;
   * sinon aucune (accès, PC, port physique de routeur).
   */
  private tagFor(device: RuntimeDevice, port: RuntimePort, vlan: number | null): number | null {
    if (device.kind !== "switch") return port.vlan;
    const switchport = port.switchport;
    return switchport?.mode === "trunk" && vlan !== null && vlan !== switchport.nativeVlan ? vlan : null;
  }

  /**
   * Émet une trame sur un port : sérialisation à la vitesse du lien puis
   * propagation. Une sous-interface émet sur son port physique. `vlan` : VLAN
   * de la trame dans un switch (étiquette des trunks).
   */
  private transmit(device: RuntimeDevice, logical: RuntimePort, untagged: EthernetFrame, exchange: string | null, vlan: number | null = null): boolean {
    const port = logical.parent === null ? logical : (device.portById.get(logical.parent) ?? logical);
    const tag = this.tagFor(device, logical, vlan);
    const { vlan: _previous, ...bare } = untagged;
    const frame: EthernetFrame = tag === null ? bare : { ...bare, vlan: tag };
    const where = { device, port, exchange, pdu: frame };
    if (port.linkId === null) {
      this.emit("eth.no-link", {}, where);
      return false;
    }
    const link = this.network.links.get(port.linkId);
    if (!link?.up) {
      this.emit("eth.link-down", { linkId: port.linkId }, where);
      return false;
    }
    const peer = peerOf(link, device.id, port.portId);
    const peerPort = this.device(peer.deviceId).portById.get(peer.portId);
    if (!peerPort) return false;
    const bytes = frameBytes(frame);
    const speed = Math.min(port.speedMbps, peerPort.speedMbps);
    const serialization = Math.ceil(((bytes + ETHERNET_WIRE_OVERHEAD_BYTES) * 8 * 1000) / speed);
    const departure = Math.max(this.clock + this.latency(device), port.txFreeAt);
    port.txFreeAt = departure + serialization;
    const arrival = departure + serialization + this.parameters.propagationDelay;
    this.emit(
      "eth.transmit",
      { linkId: link.id, toDeviceId: peer.deviceId, toPortId: peer.portId, bytes, departure, arrival, vlan: tag },
      where,
    );
    this.schedule(arrival, { type: "frame", deviceId: peer.deviceId, portId: peer.portId, linkId: link.id, frame, exchange });
    return true;
  }

  private onFrame(deviceId: string, portId: string, linkId: string, frame: EthernetFrame, exchange: string | null): void {
    const device = this.device(deviceId);
    const port = device.portById.get(portId);
    if (!port) return;
    if (!this.network.links.get(linkId)?.up) {
      this.emit("eth.lost-in-transit", { linkId }, { device, port, exchange, pdu: frame });
      return;
    }
    if (device.kind === "switch") {
      const vlan = this.classify(device, port, frame, exchange);
      if (vlan === null) return;
      // STP : un port qui ne transmet pas écarte la trame (en apprentissage, il retient la source).
      const stp = this.stpPorts.get(stpPortKey(device.id, port.portId));
      if (stp && stp.state !== "forwarding") {
        if (stp.state === "learning") this.learnMac(device, this.state(device.id), port, frame.source, vlan, { device, port, exchange, pdu: frame });
        this.emit("stp.discarded", { state: stp.state, role: stp.role }, { device, port, exchange, pdu: frame });
        return;
      }
      this.switchFrame(device, port, frame, exchange, vlan);
      return;
    }
    // Trame étiquetée : remise à la sous-interface du VLAN (routeur), sinon refusée.
    let logical = port;
    if (frame.vlan !== undefined) {
      const sub = device.kind === "router" ? device.ports.find((item) => item.parent === port.portId && item.vlan === frame.vlan) : undefined;
      if (!sub) {
        this.emit(device.kind === "router" ? "vlan.no-subinterface" : "nic.tagged-dropped", { vlan: frame.vlan }, { device, port, exchange, pdu: frame });
        return;
      }
      logical = sub;
    }
    // Maître VRRP : la MAC virtuelle est aussi la sienne ; un secours écarte ces trames (RFC 5798 §6.4.2, §6.4.3).
    const vrrpMaster = this.vrrpOn(device, logical)?.state === "master" && this.vrrpOn(device, logical)?.mac === frame.destination;
    if (frame.destination !== logical.mac && frame.destination !== BROADCAST_MAC && !vrrpMaster && !this.joinsGroup(device, logical, frame.destination)) {
      this.emit("nic.filtered", { destination: frame.destination, own: logical.mac }, { device, port: logical, exchange, pdu: frame });
      return;
    }
    if (frame.payload.kind === "arp") this.onArp(device, logical, frame.payload, exchange);
    else this.onIpv4(device, logical, frame.payload, exchange);
  }

  /**
   * VLAN d'une trame entrant dans un switch (IEEE 802.1Q) : port d'accès →
   * son VLAN (trame étiquetée refusée) ; trunk → étiquette, ou VLAN natif
   * sans étiquette (VLAN non autorisé refusé). null : trame refusée.
   */
  private classify(device: RuntimeDevice, port: RuntimePort, frame: EthernetFrame, exchange: string | null): number | null {
    const switchport = port.switchport ?? DEFAULT_SWITCHPORT;
    const where = { device, port, exchange, pdu: frame };
    if (switchport.mode === "access") {
      if (frame.vlan === undefined) return switchport.vlan;
      this.emit("vlan.tagged-dropped", { vlan: frame.vlan, accessVlan: switchport.vlan }, where);
      return null;
    }
    const vlan = frame.vlan ?? switchport.nativeVlan;
    if (carriesVlan(switchport, vlan)) return vlan;
    this.emit("vlan.not-allowed", { vlan, tagged: frame.vlan !== undefined }, where);
    return null;
  }

  // ---------------------------------------------------------------- Commutation

  private switchFrame(device: RuntimeDevice, port: RuntimePort, frame: EthernetFrame, exchange: string | null, vlan: number): void {
    const state = this.state(device.id);
    const where = { device, port, exchange, pdu: frame };
    this.learnMac(device, state, port, frame.source, vlan, where);

    if (frame.destination === BROADCAST_MAC) {
      this.flood(device, port, frame, exchange, vlan, "switch.flood-broadcast");
      return;
    }
    // Multidiffusion : sans suivi des groupes (IGMP), la trame est répétée comme une diffusion.
    if (isGroupMac(frame.destination)) {
      this.flood(device, port, frame, exchange, vlan, "switch.flood-multicast");
      return;
    }
    const entry = state.macTable.get(macKey(vlan, frame.destination));
    if (!entry) {
      this.flood(device, port, frame, exchange, vlan, "switch.flood-unknown");
      return;
    }
    if (entry.portId === port.portId) {
      this.emit("switch.filter", { mac: frame.destination, vlan }, where);
      return;
    }
    const out = device.portById.get(entry.portId);
    if (!out) return;
    const outStp = this.stpPorts.get(stpPortKey(device.id, out.portId));
    if (outStp && outStp.state !== "forwarding") {
      this.emit("stp.discarded", { state: outStp.state, role: outStp.role, outPort: out.portId }, where);
      return;
    }
    this.emit("switch.forward", { mac: frame.destination, outPort: entry.portId, vlan }, where);
    this.transmit(device, out, frame, exchange, vlan);
  }

  private learnMac(device: RuntimeDevice, state: DeviceState, port: RuntimePort, mac: MacAddress, vlan: number, where: Where): void {
    const aging = this.parameters.macAgingTime;
    const key = macKey(vlan, mac);
    const entry = state.macTable.get(key);
    if (!entry) {
      state.macTable.set(key, { vlan, mac, portId: port.portId, updatedAt: this.clock });
      this.emit("switch.learn", { mac, expiresAt: this.clock + aging, vlan }, where);
      if (!state.macTimers.has(key)) {
        state.macTimers.add(key);
        this.schedule(this.clock + aging, { type: "mac-aging", deviceId: device.id, key }, true);
      }
    } else if (entry.portId !== port.portId) {
      this.emit("switch.move", { mac, previousPort: entry.portId, vlan }, where);
      entry.portId = port.portId;
      entry.updatedAt = this.clock;
    } else {
      entry.updatedAt = this.clock;
    }
    this.dirtyDevices.add(device.id);
  }

  private flood(
    device: RuntimeDevice,
    ingress: RuntimePort,
    frame: EthernetFrame,
    exchange: string | null,
    vlan: number,
    code: "switch.flood-broadcast" | "switch.flood-multicast" | "switch.flood-unknown",
  ): void {
    // Diffusion limitée au VLAN : ports actifs qui le transportent, sauf le port d'entrée.
    const outPorts = device.ports.filter(
      (port) => port !== ingress && this.isUp(port) && (port.switchport === null || carriesVlan(port.switchport, vlan)) && this.stpForwards(device, port),
    );
    this.emit(code, { mac: frame.destination, outPorts: outPorts.map((port) => port.portId).join(", "), count: outPorts.length, vlan }, {
      device,
      port: ingress,
      exchange,
      pdu: frame,
    });
    for (const port of outPorts) this.transmit(device, port, frame, exchange, vlan);
  }

  private onMacAging(deviceId: string, key: string): void {
    const device = this.device(deviceId);
    const state = this.state(deviceId);
    state.macTimers.delete(key);
    const entry = state.macTable.get(key);
    if (!entry) return;
    const expiresAt = entry.updatedAt + this.parameters.macAgingTime;
    if (expiresAt <= this.clock) {
      state.macTable.delete(key);
      this.dirtyDevices.add(deviceId);
      this.emit("switch.expire", { mac: entry.mac, vlan: entry.vlan }, { device, port: device.portById.get(entry.portId) });
      return;
    }
    // Entrée rafraîchie depuis : la vérification est reportée à sa nouvelle échéance.
    state.macTimers.add(key);
    this.schedule(expiresAt, { type: "mac-aging", deviceId, key }, true);
  }

  // ---------------------------------------------------------------- ARP

  private onArp(device: RuntimeDevice, port: RuntimePort, arp: ArpPacket, exchange: string | null): void {
    const where = { device, port, exchange, pdu: arp };
    const state = this.state(device.id);
    if (!port.ipv4) {
      // Réponse à une requête émise avant la perte de l'adresse (DHCPRELEASE en attente de résolution).
      if (arp.operation === "reply" && arp.targetMac === port.mac && state.pending.has(arpKey(port.portId, arp.senderIp))) {
        this.emit("arp.reply-received", { senderIp: arp.senderIp, senderMac: arp.senderMac }, where);
        this.learnArp(device, state, port, arp.senderIp, arp.senderMac, exchange);
        this.releasePending(device, state, port, arp.senderIp, arp.senderMac);
        return;
      }
      this.emit("arp.no-address", { targetIp: arp.targetIp }, where);
      return;
    }
    // Adresse virtuelle VRRP : seul le maître répond, avec la MAC virtuelle (RFC 5798 §6.4.3, étape 610).
    const group = this.vrrpOn(device, port);
    if (group?.state === "master" && arp.operation === "request" && arp.targetIp === group.address && arp.senderIp !== group.address) {
      this.learnArp(device, state, port, arp.senderIp, arp.senderMac, exchange);
      const reply: EthernetFrame = {
        kind: "ethernet",
        source: group.mac,
        destination: arp.senderMac,
        payload: { kind: "arp", operation: "reply", senderMac: group.mac, senderIp: group.address, targetMac: arp.senderMac, targetIp: arp.senderIp },
      };
      this.emit("vrrp.arp-reply", { vrid: group.vrid, address: group.address, mac: group.mac, to: arp.senderIp }, { ...where, pdu: reply.payload });
      this.transmit(device, port, reply, exchange);
      return;
    }
    if (arp.targetIp !== port.ipv4.address) {
      this.emit("arp.not-target", { targetIp: arp.targetIp, senderIp: arp.senderIp }, where);
      // RFC 826 : une entrée existante est mise à jour même si la requête vise un autre hôte.
      if (state.arp.has(arpKey(port.portId, arp.senderIp))) this.learnArp(device, state, port, arp.senderIp, arp.senderMac, exchange);
      return;
    }
    this.emit(arp.operation === "request" ? "arp.request-received" : "arp.reply-received", {
      senderIp: arp.senderIp,
      senderMac: arp.senderMac,
    }, where);
    this.learnArp(device, state, port, arp.senderIp, arp.senderMac, exchange);
    if (arp.operation === "request") {
      const reply: EthernetFrame = {
        kind: "ethernet",
        source: port.mac,
        destination: arp.senderMac,
        payload: {
          kind: "arp",
          operation: "reply",
          senderMac: port.mac,
          senderIp: port.ipv4.address,
          targetMac: arp.senderMac,
          targetIp: arp.senderIp,
        },
      };
      this.emit("arp.reply-sent", { targetIp: arp.senderIp, targetMac: arp.senderMac }, { ...where, pdu: reply.payload });
      this.transmit(device, port, reply, exchange);
    }
    this.releasePending(device, state, port, arp.senderIp, arp.senderMac);
  }

  private learnArp(device: RuntimeDevice, state: DeviceState, port: RuntimePort, ip: string, mac: MacAddress, exchange: string | null): void {
    const key = arpKey(port.portId, ip);
    const lifetime = this.arpLifetime(device);
    const entry = state.arp.get(key);
    const where = { device, port, exchange };
    if (entry) {
      const previousMac = entry.mac;
      entry.mac = mac;
      entry.updatedAt = this.clock;
      this.emit("arp.entry-updated", { ip, mac, previousMac, expiresAt: this.clock + lifetime }, where);
    } else {
      state.arp.set(key, { ip, portId: port.portId, mac, updatedAt: this.clock });
      this.emit("arp.entry-added", { ip, mac, expiresAt: this.clock + lifetime }, where);
      if (!state.arpTimers.has(key)) {
        state.arpTimers.add(key);
        this.schedule(this.clock + lifetime, { type: "arp-expiry", deviceId: device.id, key }, true);
      }
    }
    this.dirtyDevices.add(device.id);
  }

  private onArpExpiry(deviceId: string, key: string): void {
    const device = this.device(deviceId);
    const state = this.state(deviceId);
    state.arpTimers.delete(key);
    const entry = state.arp.get(key);
    if (!entry) return;
    const expiresAt = entry.updatedAt + this.arpLifetime(device);
    if (expiresAt <= this.clock) {
      state.arp.delete(key);
      this.dirtyDevices.add(deviceId);
      this.emit("arp.entry-expired", { ip: entry.ip, mac: entry.mac }, { device, port: device.portById.get(entry.portId) });
      return;
    }
    state.arpTimers.add(key);
    this.schedule(expiresAt, { type: "arp-expiry", deviceId, key }, true);
  }

  private sendArpRequest(device: RuntimeDevice, port: RuntimePort, targetIp: string, attempt: number, exchange: string | null): void {
    if (!port.ipv4) return;
    const frame: EthernetFrame = {
      kind: "ethernet",
      source: port.mac,
      destination: BROADCAST_MAC,
      payload: { kind: "arp", operation: "request", senderMac: port.mac, senderIp: port.ipv4.address, targetMac: ZERO_MAC, targetIp },
    };
    this.emit("arp.request-sent", { targetIp, attempt, maxAttempts: this.parameters.arpMaxAttempts }, {
      device,
      port,
      exchange,
      pdu: frame.payload,
    });
    this.transmit(device, port, frame, exchange);
  }

  /** Résout l'adresse du prochain saut puis émet, ou met le paquet en attente de la réponse ARP. */
  private resolveAndSend(
    device: RuntimeDevice,
    port: RuntimePort,
    nextHop: number,
    packet: Ipv4Packet,
    origin: PacketOrigin,
    exchange: string | null,
  ): void {
    const state = this.state(device.id);
    const ip = formatIpv4(nextHop);
    const key = arpKey(port.portId, ip);
    const where = { device, port, exchange, pdu: packet };
    const entry = state.arp.get(key);
    if (entry) {
      this.emit("arp.cache-hit", { ip, mac: entry.mac, expiresAt: entry.updatedAt + this.arpLifetime(device) }, where);
      this.sendFrame(device, port, entry.mac, packet, exchange);
      return;
    }
    this.emit("arp.cache-miss", { ip }, where);
    const pending = state.pending.get(key);
    if (pending) {
      if (pending.queue.length >= this.parameters.arpQueueLimit) {
        this.emit("arp.queue-full", { ip, limit: this.parameters.arpQueueLimit }, where);
        this.failOrigin(device, origin, "queue-full", packet, exchange);
        return;
      }
      pending.queue.push({ packet, origin, exchange });
      this.emit("arp.queued", { ip, queued: pending.queue.length }, where);
      this.dirtyDevices.add(device.id);
      return;
    }
    const resolution: PendingResolution = { ip, portId: port.portId, attempts: 1, retrySeq: -1, queue: [{ packet, origin, exchange }] };
    state.pending.set(key, resolution);
    this.dirtyDevices.add(device.id);
    this.sendArpRequest(device, port, ip, 1, exchange);
    resolution.retrySeq = this.schedule(this.clock + this.parameters.arpRetryInterval, { type: "arp-retry", deviceId: device.id, key });
  }

  private onArpRetry(deviceId: string, key: string): void {
    const device = this.device(deviceId);
    const state = this.state(deviceId);
    const pending = state.pending.get(key);
    if (!pending) return;
    const port = device.portById.get(pending.portId);
    if (!port) return;
    const first = pending.queue[0];
    if (pending.attempts < this.parameters.arpMaxAttempts) {
      pending.attempts += 1;
      this.dirtyDevices.add(deviceId);
      this.sendArpRequest(device, port, pending.ip, pending.attempts, first?.exchange ?? null);
      pending.retrySeq = this.schedule(this.clock + this.parameters.arpRetryInterval, { type: "arp-retry", deviceId, key });
      return;
    }
    state.pending.delete(key);
    this.dirtyDevices.add(deviceId);
    this.emit("arp.failed", { ip: pending.ip, attempts: pending.attempts, dropped: pending.queue.length }, {
      device,
      port,
      exchange: first?.exchange ?? null,
    });
    for (const item of pending.queue) this.failOrigin(device, item.origin, "host-unreachable", item.packet, item.exchange);
  }

  private releasePending(device: RuntimeDevice, state: DeviceState, port: RuntimePort, ip: string, mac: MacAddress): void {
    const key = arpKey(port.portId, ip);
    const pending = state.pending.get(key);
    if (!pending) return;
    state.pending.delete(key);
    this.cancel(pending.retrySeq);
    this.dirtyDevices.add(device.id);
    this.emit("arp.resolved", { ip, mac, released: pending.queue.length }, { device, port, exchange: pending.queue[0]?.exchange ?? null });
    for (const item of pending.queue) this.sendFrame(device, port, mac, item.packet, item.exchange);
  }

  private sendFrame(device: RuntimeDevice, port: RuntimePort, mac: MacAddress, packet: Ipv4Packet, exchange: string | null): void {
    this.transmit(device, port, { kind: "ethernet", source: port.mac, destination: mac, payload: packet }, exchange);
  }

  // ---------------------------------------------------------------- IPv4

  private onIpv4(device: RuntimeDevice, port: RuntimePort, packet: Ipv4Packet, exchange: string | null): void {
    const where = { device, port, exchange, pdu: packet };
    const destination = parseIpv4(packet.destination) ?? 0;
    // Diffusion limitée : remise à l'équipement (DHCP), jamais relayée.
    if (packet.destination === LIMITED_BROADCAST) {
      if (packet.payload.kind === "udp") this.onUdp(device, port, packet, packet.payload, exchange);
      else this.emit("ip.broadcast-dropped", { destination: packet.destination }, where);
      return;
    }
    // Groupe 224.0.0.9 (routeurs RIP) : remis localement, jamais relayé (bloc de contrôle du réseau local, RFC 5771 §4).
    if (packet.destination === RIP_MULTICAST || packet.destination === OSPF_ALL_ROUTERS || packet.destination === OSPF_ALL_DROUTERS || packet.destination === VRRP_MULTICAST) {
      if (packet.payload.kind === "udp") this.onUdp(device, port, packet, packet.payload, exchange);
      else if (packet.payload.kind === "ospf") this.onOspf(device, port, packet, packet.payload, exchange);
      else if (packet.payload.kind === "vrrp") this.onVrrp(device, port, packet, packet.payload, exchange);
      else this.emit("ip.broadcast-dropped", { destination: packet.destination }, where);
      return;
    }
    // Adresse virtuelle d'un routeur qui n'en est pas propriétaire : Accept_Mode faux par défaut, paquet refusé (RFC 5798 §6.4.3, étape 650).
    const virtual = device.kind === "router" ? device.ports.map((item) => this.vrrpOn(device, item)).find((group) => group && !group.owner && group.value === destination) : undefined;
    if (virtual) {
      this.emit("vrrp.not-accepted", { vrid: virtual.vrid, address: virtual.address, state: virtual.state }, where);
      return;
    }
    if (this.ownsAddress(device, destination)) {
      this.emit("ip.local", { destination: packet.destination }, where);
      this.deliverLocal(device, packet, exchange, port);
      return;
    }
    if (device.kind !== "router") {
      this.emit("ip.not-for-host", { destination: packet.destination }, where);
      return;
    }
    const directedBroadcast = device.ports.some((item) => item.ipv4 && item.ipv4.prefixLength <= 30 && item.ipv4.broadcast === destination);
    if (destination === 0xffffffff || directedBroadcast) {
      this.emit("ip.broadcast-dropped", { destination: packet.destination }, where);
      return;
    }
    if (packet.ttl <= 1) {
      this.emit("ip.ttl-expired", { ttl: packet.ttl }, where);
      this.sendIcmpError(device, packet, "time-exceeded", 0, exchange);
      return;
    }
    const routes = this.routes(device);
    const route = lookup(routes, destination);
    if (!route?.port) {
      this.emit("ip.no-route", { destination: packet.destination, reason: this.noRouteReason(device, routes) }, where);
      this.sendIcmpError(device, packet, "destination-unreachable", 0, exchange);
      return;
    }
    const forwarded: Ipv4Packet = { ...packet, ttl: packet.ttl - 1 };
    this.emit("ip.forward", { ...routeParams(route, destination), ttl: forwarded.ttl }, { ...where, pdu: forwarded });
    this.resolveAndSend(device, route.port, route.nextHop ?? destination, forwarded, { kind: "forwarded" }, exchange);
  }

  private noRouteReason(device: RuntimeDevice, routes: readonly Route[]): NoRouteReason {
    if (!routes.some((route) => route.kind === "connected" && route.active)) {
      return device.ports.some((port) => port.ipv4) ? "interfaces-down" : "no-address";
    }
    if (device.kind === "pc") return device.gateway ? "gateway-unreachable" : "no-gateway";
    return "no-match";
  }

  /** Émet un paquet produit par l'équipement lui-même (écho, réponse, erreur ICMP). */
  private sendLocal(device: RuntimeDevice, draft: PacketDraft, origin: PacketOrigin, exchange: string | null): void {
    const state = this.state(device.id);
    const destination = parseIpv4(draft.destination) ?? 0;
    const identification = state.nextIdentification;
    state.nextIdentification = (state.nextIdentification + 1) & 0xffff;

    if (destination >>> 24 === 127 || this.ownsAddress(device, destination)) {
      const packet: Ipv4Packet = { kind: "ipv4", ...draft, source: draft.source ?? draft.destination, identification };
      this.emit("ip.loopback", { destination: draft.destination }, { device, exchange, pdu: packet });
      this.schedule(this.clock + this.latency(device), { type: "loopback", deviceId: device.id, packet, exchange });
      return;
    }

    const routes = this.routes(device);
    const route = lookup(routes, destination);
    if (!route?.port?.ipv4) {
      const reason = this.noRouteReason(device, routes);
      this.emit(
        "ip.no-route",
        { destination: draft.destination, reason, gateway: device.gateway?.address ?? null },
        { device, exchange },
      );
      this.failOrigin(device, origin, reason === "no-address" ? "no-address" : "no-route", null, exchange);
      return;
    }
    const packet: Ipv4Packet = { kind: "ipv4", ...draft, source: draft.source ?? route.port.ipv4.address, identification };
    this.emit("ip.route", routeParams(route, destination), { device, port: route.port, exchange, pdu: packet });
    this.resolveAndSend(device, route.port, route.nextHop ?? destination, packet, origin, exchange);
  }

  /** Échec d'un paquet : informe le ping émetteur, ou la source d'un paquet relayé. */
  private failOrigin(
    device: RuntimeDevice,
    origin: PacketOrigin,
    failure: PingFailure,
    packet: Ipv4Packet | null,
    exchange: string | null,
  ): void {
    if (origin.kind === "ping") {
      this.pingFailed(origin.sessionId, origin.sequence, failure);
    } else if (origin.kind === "dns") {
      // Question impossible à émettre : échec immédiat. Une question perdue ensuite (ARP sans réponse) attend la retransmission.
      if (failure === "no-address" || failure === "no-route") this.dnsSendFailed(origin.queryId, failure);
    } else if (origin.kind === "forwarded" && failure === "host-unreachable" && packet) {
      this.sendIcmpError(device, packet, "destination-unreachable", 1, exchange);
    }
  }

  // ---------------------------------------------------------------- ICMP

  private deliverLocal(device: RuntimeDevice, packet: Ipv4Packet, exchange: string | null, port: RuntimePort | null = null): void {
    const message = packet.payload;
    const where = { device, exchange, pdu: packet };
    if (message.kind === "udp") {
      this.onUdp(device, port, packet, message, exchange);
      return;
    }
    if (message.kind === "ospf") {
      if (port) this.onOspf(device, port, packet, message, exchange);
      return;
    }
    if (message.kind === "vrrp") {
      if (port) this.onVrrp(device, port, packet, message, exchange);
      return;
    }
    if (message.type === "echo-request") {
      this.emit("icmp.echo-request", { source: packet.source, identifier: message.identifier, sequence: message.sequence }, where);
      const reply: PacketDraft = {
        source: packet.destination,
        destination: packet.source,
        ttl: this.initialTtl(device),
        payload: { ...message, type: "echo-reply" },
      };
      this.emit("icmp.echo-reply", { destination: packet.source, identifier: message.identifier, sequence: message.sequence }, where);
      this.sendLocal(device, reply, { kind: "local" }, exchange);
      return;
    }
    if (isIcmpError(message)) {
      this.onIcmpError(device, packet, message, exchange);
      return;
    }
    this.onEchoReply(device, packet, message.identifier, message.sequence, exchange);
  }

  private sendIcmpError(
    device: RuntimeDevice,
    offending: Ipv4Packet,
    type: IcmpError["type"],
    code: number,
    exchange: string | null,
  ): void {
    const message = offending.payload;
    // Datagramme UDP : DHCP seulement, jamais relayé (serveur sur le réseau du client) ; rien à signaler.
    if (message.kind === "udp" || message.kind === "ospf" || message.kind === "vrrp") return;
    // RFC 1122 §3.2.2 : jamais d'erreur ICMP en réponse à une erreur ICMP.
    if (isIcmpError(message)) {
      this.emit("icmp.error-suppressed", { type, code }, { device, exchange, pdu: offending });
      return;
    }
    const error: IcmpError = {
      kind: "icmp",
      type,
      code,
      original: {
        source: offending.source,
        destination: offending.destination,
        ttl: offending.ttl,
        identification: offending.identification,
        echo: { type: message.type, identifier: message.identifier, sequence: message.sequence },
      },
    };
    this.emit("icmp.error-sent", { type, code, destination: offending.source }, { device, exchange, pdu: error });
    this.sendLocal(device, { source: null, destination: offending.source, ttl: this.parameters.routerInitialTtl, payload: error }, {
      kind: "local",
    }, exchange);
  }

  private onIcmpError(device: RuntimeDevice, packet: Ipv4Packet, message: IcmpError, exchange: string | null): void {
    this.emit("icmp.error-received", { type: message.type, code: message.code, from: packet.source }, { device, exchange, pdu: packet });
    const quoted = message.original;
    if (quoted.echo.type !== "echo-request") return;
    const session = this.findSession(device.id, quoted.echo.identifier);
    const attempt = session?.attempts[quoted.echo.sequence - 1];
    if (!session || attempt?.status !== "pending") return;
    attempt.status = "error";
    attempt.from = packet.source;
    attempt.errorType = message.type;
    attempt.errorCode = message.code;
    this.cancel(attempt.timeoutSeq);
    this.dirtyPings.add(session.id);
    this.emit("ping.error", { sequence: attempt.sequence, from: packet.source, type: message.type, code: message.code }, {
      device,
      exchange,
    });
    this.checkDone(session);
  }

  // ---------------------------------------------------------------- UDP et DHCP

  /** Remise d'un datagramme UDP au service qui écoute son port (port null : remise locale par bouclage). */
  private onUdp(device: RuntimeDevice, port: RuntimePort | null, packet: Ipv4Packet, datagram: UdpDatagram, exchange: string | null): void {
    const message = datagram.payload;
    if (message.kind === "rip") {
      const mode = port ? device.ripInterfaces.get(port.portId) : undefined;
      if (port && datagram.destinationPort === RIP_PORT && mode === "active") {
        this.onRip(device, port, packet, datagram, message, exchange);
        return;
      }
      if (port && datagram.destinationPort === RIP_PORT && mode === "passive") {
        this.emit("rip.ignored", { reason: "passive", from: packet.source }, { device, port, exchange, pdu: message });
        return;
      }
    } else if (message.kind === "dns") {
      if (!message.response && datagram.destinationPort === DNS_SERVER_PORT && device.dnsRecords) {
        this.onDnsServer(device, packet, datagram, message, exchange);
        return;
      }
      const query = message.response ? this.queryOnPort(device.id, datagram.destinationPort) : undefined;
      if (query) {
        this.onDnsResponse(device, packet, query, message);
        return;
      }
    } else if (port && datagram.destinationPort === DHCP_SERVER_PORT && device.kind === "router") {
      this.onDhcpServer(device, port, message, exchange);
      return;
    } else {
      const client = port && datagram.destinationPort === DHCP_CLIENT_PORT ? this.dhcpClients.get(dhcpClientKey(device.id, port.portId)) : undefined;
      if (port && client) {
        this.onDhcpClient(device, port, client, message, exchange);
        return;
      }
    }
    this.emit("udp.no-service", { destinationPort: datagram.destinationPort }, { device, port: port ?? undefined, exchange, pdu: packet });
  }

  /** Datagramme UDP diffusé (255.255.255.255, MAC de diffusion) sur une interface, sans routage. */
  private broadcastUdp(device: RuntimeDevice, port: RuntimePort, source: string, sourcePort: number, destinationPort: number, message: DhcpMessage, exchange: string | null): void {
    const state = this.state(device.id);
    const identification = state.nextIdentification;
    state.nextIdentification = (state.nextIdentification + 1) & 0xffff;
    const packet: Ipv4Packet = {
      kind: "ipv4",
      source,
      destination: LIMITED_BROADCAST,
      ttl: this.initialTtl(device),
      identification,
      payload: { kind: "udp", sourcePort, destinationPort, payload: message },
    };
    this.transmit(device, port, { kind: "ethernet", source: port.mac, destination: BROADCAST_MAC, payload: packet }, exchange);
  }

  private clientPort(client: DhcpClient): { device: RuntimeDevice; port: RuntimePort } | null {
    const device = this.device(client.deviceId);
    const port = device.portById.get(client.portId);
    return port ? { device, port } : null;
  }

  private newDhcpExchange(): string {
    const exchange = `dhcp-${String(this.nextDhcpExchange)}`;
    this.nextDhcpExchange += 1;
    return exchange;
  }

  /** Nouvelle transaction : DHCPDISCOVER diffusé depuis 0.0.0.0 (RFC 2131 §4.4.1). */
  private startDiscover(client: DhcpClient): void {
    this.cancel(client.retrySeq);
    client.generation += 1;
    client.phase = "selecting";
    client.xid = this.prng.nextInt(0x100000000);
    client.attempts = 0;
    client.offer = null;
    client.exchange = this.newDhcpExchange();
    this.sendDiscover(client);
  }

  private sendDiscover(client: DhcpClient): void {
    const target = this.clientPort(client);
    if (!target) return;
    const { device, port } = target;
    client.attempts += 1;
    this.dirtyDevices.add(device.id);
    const message: DhcpMessage = {
      kind: "dhcp",
      type: "discover",
      xid: client.xid,
      broadcast: true,
      clientIp: UNSPECIFIED_ADDRESS,
      yourIp: UNSPECIFIED_ADDRESS,
      clientMac: port.mac,
      options: NO_DHCP_OPTIONS,
    };
    this.emit("dhcp.discover-sent", { attempt: client.attempts, maxAttempts: this.parameters.dhcpMaxAttempts, xid: client.xid }, {
      device,
      port,
      exchange: client.exchange,
      pdu: message,
    });
    this.broadcastUdp(device, port, UNSPECIFIED_ADDRESS, DHCP_CLIENT_PORT, DHCP_SERVER_PORT, message, client.exchange);
    this.scheduleDhcpRetry(client);
  }

  /** Retransmission : 4 s, puis 8, 16… (doublement, RFC 2131 §4.1). */
  private scheduleDhcpRetry(client: DhcpClient): void {
    const delay = this.parameters.dhcpRetryTimeout * 2 ** (client.attempts - 1);
    client.retrySeq = this.schedule(this.clock + delay, { type: "dhcp-retry", deviceId: client.deviceId, portId: client.portId, generation: client.generation });
  }

  /**
   * DHCPREQUEST : après une offre (diffusé, identifiant du serveur et adresse
   * demandée), au renouvellement T1 (envoyé au serveur, ciaddr renseigné) ou
   * à T2 (diffusé, ciaddr renseigné).
   */
  private sendRequest(client: DhcpClient, mode: "selecting" | "renewing" | "rebinding"): void {
    const target = this.clientPort(client);
    if (!target) return;
    const { device, port } = target;
    client.attempts += 1;
    this.dirtyDevices.add(device.id);
    const where = { device, port, exchange: client.exchange };
    if (mode === "selecting") {
      const offer = client.offer;
      if (!offer) return;
      const message: DhcpMessage = {
        kind: "dhcp",
        type: "request",
        xid: client.xid,
        broadcast: true,
        clientIp: UNSPECIFIED_ADDRESS,
        yourIp: UNSPECIFIED_ADDRESS,
        clientMac: port.mac,
        options: { ...NO_DHCP_OPTIONS, serverId: offer.server, requestedIp: offer.address },
      };
      this.emit("dhcp.request-sent", { mode, address: offer.address, server: offer.server, attempt: client.attempts, maxAttempts: this.parameters.dhcpMaxAttempts }, {
        ...where,
        pdu: message,
      });
      this.broadcastUdp(device, port, UNSPECIFIED_ADDRESS, DHCP_CLIENT_PORT, DHCP_SERVER_PORT, message, client.exchange);
      this.scheduleDhcpRetry(client);
      return;
    }
    const lease = client.lease;
    if (!lease) return;
    const message: DhcpMessage = {
      kind: "dhcp",
      type: "request",
      xid: client.xid,
      broadcast: false,
      clientIp: lease.address,
      yourIp: UNSPECIFIED_ADDRESS,
      clientMac: port.mac,
      options: NO_DHCP_OPTIONS,
    };
    this.emit("dhcp.request-sent", { mode, address: lease.address, server: lease.server, attempt: client.attempts, maxAttempts: 1 }, { ...where, pdu: message });
    const datagram: UdpDatagram = { kind: "udp", sourcePort: DHCP_CLIENT_PORT, destinationPort: DHCP_SERVER_PORT, payload: message };
    if (mode === "renewing") {
      this.sendLocal(device, { source: lease.address, destination: lease.server, ttl: this.initialTtl(device), payload: datagram }, { kind: "local" }, client.exchange);
    } else {
      this.broadcastUdp(device, port, lease.address, DHCP_CLIENT_PORT, DHCP_SERVER_PORT, message, client.exchange);
    }
  }

  private onDhcpRetry(deviceId: string, portId: string, generation: number): void {
    const client = this.dhcpClients.get(dhcpClientKey(deviceId, portId));
    if (client?.generation !== generation) return;
    if (client.phase !== "selecting" && client.phase !== "requesting") return;
    if (client.attempts < this.parameters.dhcpMaxAttempts) {
      if (client.phase === "selecting") this.sendDiscover(client);
      else this.sendRequest(client, "selecting");
      return;
    }
    const target = this.clientPort(client);
    client.phase = "failed";
    this.dirtyDevices.add(deviceId);
    this.emit("dhcp.gave-up", { attempts: client.attempts, stage: client.offer ? "request" : "discover" }, {
      device: target?.device,
      port: target?.port,
      exchange: client.exchange,
    });
  }

  private onDhcpClient(device: RuntimeDevice, port: RuntimePort, client: DhcpClient, message: DhcpMessage, exchange: string | null): void {
    const where = { device, port, exchange, pdu: message };
    if (message.clientMac !== port.mac || message.xid !== client.xid) {
      this.emit("dhcp.ignored", { type: message.type, reason: "other-client" }, where);
      return;
    }
    const waiting = client.phase === "requesting" || client.phase === "renewing" || client.phase === "rebinding";
    if (message.type === "offer" && client.phase === "selecting") {
      const offer = offerOf(message);
      if (!offer) {
        this.emit("dhcp.ignored", { type: message.type, reason: "incomplete" }, where);
        return;
      }
      this.cancel(client.retrySeq);
      client.offer = offer;
      this.emit(
        "dhcp.offer-received",
        { address: offer.address, prefixLength: offer.prefixLength, server: offer.server, gateway: offer.gateway, lease: offer.leaseSeconds },
        where,
      );
      client.phase = "requesting";
      client.attempts = 0;
      this.sendRequest(client, "selecting");
      return;
    }
    if (message.type === "ack" && waiting) {
      const expectedServer = client.offer?.server ?? client.lease?.server;
      if (client.phase !== "rebinding" && message.options.serverId !== expectedServer) {
        this.emit("dhcp.ignored", { type: message.type, reason: "other-server" }, where);
        return;
      }
      const lease = offerOf(message, client.lease);
      if (!lease) {
        this.emit("dhcp.ignored", { type: message.type, reason: "incomplete" }, where);
        return;
      }
      this.cancel(client.retrySeq);
      this.bindDhcp(client, device, port, lease, where);
      return;
    }
    if (message.type === "nak" && waiting) {
      this.cancel(client.retrySeq);
      this.emit("dhcp.nak-received", { server: message.options.serverId }, where);
      this.dropLease(client, device, port);
      this.startDiscover(client);
      return;
    }
    this.emit("dhcp.ignored", { type: message.type, reason: "unexpected", phase: client.phase }, where);
  }

  /** Bail accordé : adresse et passerelle appliquées, temporisations T1, T2 et fin de bail (RFC 2131 §4.4.5). */
  private bindDhcp(client: DhcpClient, device: RuntimeDevice, port: RuntimePort, offer: DhcpOffer, where: Where): void {
    const renewed = client.lease?.address === offer.address;
    const duration = fromSeconds(offer.leaseSeconds);
    const lease: DhcpLease = {
      ...offer,
      obtainedAt: this.clock,
      renewAt: this.clock + Math.round(duration * 0.5),
      rebindAt: this.clock + Math.round(duration * 0.875),
      expiresAt: this.clock + duration,
    };
    client.lease = lease;
    client.offer = null;
    client.phase = "bound";
    client.attempts = 0;
    client.generation += 1;
    port.ipv4 = runtimeAddress(lease.address, lease.prefixLength);
    const gateway = lease.gateway === null ? null : parseIpv4(lease.gateway);
    device.gateway = lease.gateway !== null && gateway !== null ? { address: lease.gateway, value: gateway } : null;
    this.dirtyDevices.add(device.id);
    this.emit(
      "dhcp.bound",
      {
        address: lease.address,
        prefixLength: lease.prefixLength,
        gateway: lease.gateway,
        server: lease.server,
        lease: lease.leaseSeconds,
        renewAt: lease.renewAt,
        expiresAt: lease.expiresAt,
        renewed,
      },
      where,
    );
    this.schedule(lease.renewAt, { type: "dhcp-lease", deviceId: device.id, portId: port.portId, stage: "renew", generation: client.generation }, true);
  }

  private dropLease(client: DhcpClient, device: RuntimeDevice, port: RuntimePort): void {
    if (!client.lease) return;
    client.lease = null;
    port.ipv4 = null;
    device.gateway = null;
    this.dirtyDevices.add(device.id);
  }

  private onDhcpLeaseTimer(deviceId: string, portId: string, stage: "renew" | "rebind" | "expire", generation: number): void {
    const client = this.dhcpClients.get(dhcpClientKey(deviceId, portId));
    const lease = client?.lease;
    if (client?.generation !== generation || !lease) return;
    const target = this.clientPort(client);
    if (!target) return;
    if (stage === "renew") {
      client.phase = "renewing";
      client.xid = this.prng.nextInt(0x100000000);
      client.exchange = this.newDhcpExchange();
      client.attempts = 0;
      this.sendRequest(client, "renewing");
      this.schedule(lease.rebindAt, { type: "dhcp-lease", deviceId, portId, stage: "rebind", generation }, true);
      return;
    }
    if (stage === "rebind") {
      client.phase = "rebinding";
      client.attempts = 0;
      this.sendRequest(client, "rebinding");
      this.schedule(lease.expiresAt, { type: "dhcp-lease", deviceId, portId, stage: "expire", generation }, true);
      return;
    }
    // Fin du bail sans accusé de réception : l'adresse est abandonnée, nouvelle demande (état INIT).
    this.emit("dhcp.expired", { address: lease.address, server: lease.server }, { device: target.device, port: target.port, exchange: client.exchange });
    this.dropLease(client, target.device, target.port);
    this.startDiscover(client);
  }

  /** ipconfig renew / release, à la demande de l'utilisateur. */
  private dhcpCommand(deviceId: string, action: "renew" | "release"): void {
    const client = [...this.dhcpClients.values()].find((item) => item.deviceId === deviceId);
    const target = client ? this.clientPort(client) : null;
    if (!client || !target) return;
    const { device, port } = target;
    const lease = client.lease;
    if (action === "renew") {
      this.emit("command.dhcp-renew", { address: lease?.address ?? null }, { device, port });
      if (lease && (client.phase === "bound" || client.phase === "renewing" || client.phase === "rebinding")) {
        this.cancel(client.retrySeq);
        client.phase = "renewing";
        client.xid = this.prng.nextInt(0x100000000);
        client.exchange = this.newDhcpExchange();
        client.attempts = 0;
        this.sendRequest(client, "renewing");
        return;
      }
      this.startDiscover(client);
      return;
    }
    this.emit("command.dhcp-release", { address: lease?.address ?? null }, { device, port });
    this.cancel(client.retrySeq);
    client.generation += 1;
    client.phase = "released";
    client.offer = null;
    client.attempts = 0;
    this.dirtyDevices.add(device.id);
    if (!lease) return;
    // DHCPRELEASE envoyé au serveur (ciaddr, identifiant du serveur), puis adresse abandonnée.
    client.xid = this.prng.nextInt(0x100000000);
    client.exchange = this.newDhcpExchange();
    const message: DhcpMessage = {
      kind: "dhcp",
      type: "release",
      xid: client.xid,
      broadcast: false,
      clientIp: lease.address,
      yourIp: UNSPECIFIED_ADDRESS,
      clientMac: port.mac,
      options: { ...NO_DHCP_OPTIONS, serverId: lease.server },
    };
    this.emit("dhcp.release-sent", { address: lease.address, server: lease.server }, { device, port, exchange: client.exchange, pdu: message });
    this.sendLocal(
      device,
      { source: lease.address, destination: lease.server, ttl: this.initialTtl(device), payload: { kind: "udp", sourcePort: DHCP_CLIENT_PORT, destinationPort: DHCP_SERVER_PORT, payload: message } },
      { kind: "local" },
      client.exchange,
    );
    this.dropLease(client, device, port);
  }

  // ---------------------------------------------------------------- Serveur DHCP (routeur)

  private onDhcpServer(device: RuntimeDevice, port: RuntimePort, message: DhcpMessage, exchange: string | null): void {
    const where = { device, port, exchange, pdu: message };
    const pool = device.dhcpPools.get(port.portId);
    if (!pool || !port.ipv4) {
      this.emit("dhcp.no-pool", { type: message.type }, where);
      return;
    }
    const state = this.state(device.id);
    if (message.type === "discover") {
      this.offerAddress(device, port, state, pool, message, where);
      return;
    }
    if (message.type === "request") {
      this.answerRequest(device, port, state, pool, message, where);
      return;
    }
    if (message.type === "release") {
      const lease = state.dhcpLeases.get(message.clientIp);
      if (lease?.mac !== message.clientMac) {
        this.emit("dhcp.ignored", { type: message.type, reason: "unknown-lease" }, where);
        return;
      }
      state.dhcpLeases.delete(lease.address);
      this.dirtyDevices.add(device.id);
      this.emit("dhcp.released", { address: lease.address, mac: lease.mac }, where);
      return;
    }
    this.emit("dhcp.ignored", { type: message.type, reason: "unexpected" }, where);
  }

  /** Bail (ou offre) d'un client dans la plage d'une interface. */
  private leaseOf(state: DeviceState, mac: MacAddress, portId: string): ServerLease | undefined {
    for (const lease of state.dhcpLeases.values()) if (lease.mac === mac && lease.portId === portId) return lease;
    return undefined;
  }

  /** Plus petite adresse libre de la plage : ni adresse du routeur, ni offerte, ni attribuée. */
  private freeAddress(device: RuntimeDevice, state: DeviceState, pool: RuntimeDhcpPool): number | null {
    for (let value = pool.start; value <= pool.end; value += 1) {
      if (!this.ownsAddress(device, value) && !state.dhcpLeases.has(formatIpv4(value))) return value;
    }
    return null;
  }

  private offerAddress(device: RuntimeDevice, port: RuntimePort, state: DeviceState, pool: RuntimeDhcpPool, message: DhcpMessage, where: Where): void {
    const existing = this.leaseOf(state, message.clientMac, port.portId);
    let address = existing?.address;
    if (address === undefined) {
      const value = this.freeAddress(device, state, pool);
      if (value === null) {
        this.emit("dhcp.pool-exhausted", { size: pool.end - pool.start + 1, start: formatIpv4(pool.start), end: formatIpv4(pool.end) }, where);
        return;
      }
      address = formatIpv4(value);
      // Une offre sans REQUEST ne doit pas immobiliser une adresse pour toujours.
      const expiresAt = this.clock + fromSeconds(60);
      state.dhcpLeases.set(address, { address, mac: message.clientMac, portId: port.portId, state: "offered", expiresAt, generation: 0 });
      this.schedule(expiresAt, { type: "dhcp-server-expiry", deviceId: device.id, address, generation: 0 }, true);
      this.dirtyDevices.add(device.id);
    }
    this.emit("dhcp.offer-sent", { address, mac: message.clientMac, lease: pool.leaseSeconds, reused: existing !== undefined }, where);
    this.replyDhcp(device, port, pool, message, "offer", address, where.exchange ?? null);
  }

  private answerRequest(device: RuntimeDevice, port: RuntimePort, state: DeviceState, pool: RuntimeDhcpPool, message: DhcpMessage, where: Where): void {
    const own = port.ipv4?.address ?? "";
    const exchange = where.exchange ?? null;
    const serverId = message.options.serverId;
    if (serverId !== null) {
      // Réponse à une offre : le client désigne le serveur retenu (SELECTING).
      const lease = this.leaseOf(state, message.clientMac, port.portId);
      if (serverId !== own) {
        if (lease?.state === "offered") state.dhcpLeases.delete(lease.address);
        this.dirtyDevices.add(device.id);
        this.emit("dhcp.not-selected", { server: serverId }, where);
        return;
      }
      if (!lease || lease.address !== message.options.requestedIp) {
        this.emit("dhcp.nak-sent", { address: message.options.requestedIp, reason: "not-offered" }, where);
        this.replyDhcp(device, port, pool, message, "nak", null, exchange);
        return;
      }
      this.confirmLease(device, lease, pool, where);
      this.replyDhcp(device, port, pool, message, "ack", lease.address, exchange);
      return;
    }
    // Renouvellement (T1, envoyé au serveur) ou nouvelle demande (T2, diffusée) : ciaddr renseigné.
    const lease = state.dhcpLeases.get(message.clientIp);
    if (lease?.mac !== message.clientMac || lease.portId !== port.portId || lease.state !== "bound") {
      this.emit("dhcp.nak-sent", { address: message.clientIp, reason: "unknown-lease" }, where);
      this.replyDhcp(device, port, pool, message, "nak", null, exchange);
      return;
    }
    this.confirmLease(device, lease, pool, where);
    this.replyDhcp(device, port, pool, message, "ack", lease.address, exchange);
  }

  private confirmLease(device: RuntimeDevice, lease: ServerLease, pool: RuntimeDhcpPool, where: Where): void {
    const renewed = lease.state === "bound";
    lease.state = "bound";
    lease.expiresAt = this.clock + fromSeconds(pool.leaseSeconds);
    lease.generation += 1;
    this.dirtyDevices.add(device.id);
    this.emit("dhcp.ack-sent", { address: lease.address, mac: lease.mac, lease: pool.leaseSeconds, expiresAt: lease.expiresAt, renewed }, where);
    this.schedule(lease.expiresAt, { type: "dhcp-server-expiry", deviceId: device.id, address: lease.address, generation: lease.generation }, true);
  }

  /**
   * Réponse du serveur : diffusée tant que le client n'a pas d'adresse
   * (drapeau BROADCAST) et pour un refus, envoyée à ciaddr sinon (RFC 2131 §4.1).
   */
  private replyDhcp(device: RuntimeDevice, port: RuntimePort, pool: RuntimeDhcpPool, request: DhcpMessage, type: DhcpMessageType, address: string | null, exchange: string | null): void {
    const own = port.ipv4;
    if (!own) return;
    const message: DhcpMessage = {
      kind: "dhcp",
      type,
      xid: request.xid,
      broadcast: request.broadcast,
      clientIp: request.clientIp,
      yourIp: address ?? UNSPECIFIED_ADDRESS,
      clientMac: request.clientMac,
      options:
        type === "nak"
          ? { ...NO_DHCP_OPTIONS, serverId: own.address }
          : { serverId: own.address, requestedIp: null, subnetMask: prefixToMask(own.prefixLength), router: pool.gateway, leaseSeconds: pool.leaseSeconds },
    };
    if (type !== "nak" && request.clientIp !== UNSPECIFIED_ADDRESS) {
      const datagram: UdpDatagram = { kind: "udp", sourcePort: DHCP_SERVER_PORT, destinationPort: DHCP_CLIENT_PORT, payload: message };
      this.sendLocal(device, { source: own.address, destination: request.clientIp, ttl: this.initialTtl(device), payload: datagram }, { kind: "local" }, exchange);
      return;
    }
    this.broadcastUdp(device, port, own.address, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, message, exchange);
  }

  private onServerLeaseExpiry(deviceId: string, address: string, generation: number): void {
    const device = this.device(deviceId);
    const state = this.state(deviceId);
    const lease = state.dhcpLeases.get(address);
    // Un ancien bail libéré peut partager l'adresse et la génération d'un nouveau bail.
    if (lease?.generation !== generation || lease.expiresAt !== this.clock) return;
    state.dhcpLeases.delete(address);
    this.dirtyDevices.add(deviceId);
    this.emit("dhcp.lease-expired", { address, mac: lease.mac }, { device, port: device.portById.get(lease.portId) });
  }

  // ---------------------------------------------------------------- DNS : résolveur du poste

  private newQuery(device: RuntimeDevice, name: string, pingSessionId: string | null): DnsQuery {
    const id = `dns-${String(this.nextDnsQuery)}`;
    this.nextDnsQuery += 1;
    const query: DnsQuery = {
      id,
      deviceId: device.id,
      name,
      server: device.dnsServer,
      pingSessionId,
      messageId: 0,
      sourcePort: 0,
      attempts: 0,
      retrySeq: -1,
      status: "pending",
      address: null,
      ttl: null,
    };
    this.dnsQueries.set(id, query);
    this.markQuery(query);
    return query;
  }

  private markQuery(query: DnsQuery): void {
    if (query.pingSessionId === null) this.dirtyLookups.add(query.id);
  }

  private queryOnPort(deviceId: string, port: number): DnsQuery | undefined {
    for (const query of this.dnsQueries.values()) {
      if (query.deviceId === deviceId && query.status === "pending" && query.attempts > 0 && query.sourcePort === port) return query;
    }
    return undefined;
  }

  private startQuery(query: DnsQuery): void {
    const device = this.device(query.deviceId);
    if (query.server === null) {
      this.emit("dns.no-server", { name: query.name }, { device, exchange: query.id });
      this.finishQuery(query, "no-server");
      return;
    }
    query.messageId = this.prng.nextInt(0x10000);
    // Port source éphémère tiré par le générateur à graine, distinct des questions en cours du poste.
    const taken = new Set([...this.dnsQueries.values()].filter((other) => other.deviceId === device.id && other.status === "pending").map((other) => other.sourcePort));
    const span = EPHEMERAL_PORT_MAX - EPHEMERAL_PORT_MIN + 1;
    let port = EPHEMERAL_PORT_MIN + this.prng.nextInt(span);
    while (taken.has(port)) port = EPHEMERAL_PORT_MIN + this.prng.nextInt(span);
    query.sourcePort = port;
    this.sendQuery(query);
  }

  /** Question A vers le serveur du poste (récursion demandée), puis attente : 5 s, doublée à chaque retransmission. */
  private sendQuery(query: DnsQuery): void {
    const server = query.server;
    if (server === null) return;
    const device = this.device(query.deviceId);
    query.attempts += 1;
    this.markQuery(query);
    const message: DnsMessage = {
      kind: "dns",
      id: query.messageId,
      response: false,
      authoritative: false,
      recursionDesired: true,
      recursionAvailable: false,
      rcode: "no-error",
      question: { name: query.name, type: "A" },
      answers: [],
    };
    this.emit(
      "dns.query-sent",
      { name: query.name, server, id: query.messageId, sourcePort: query.sourcePort, attempt: query.attempts, maxAttempts: this.parameters.dnsMaxAttempts },
      { device, exchange: query.id, pdu: message },
    );
    const datagram: UdpDatagram = { kind: "udp", sourcePort: query.sourcePort, destinationPort: DNS_SERVER_PORT, payload: message };
    this.sendLocal(device, { source: null, destination: server, ttl: this.initialTtl(device), payload: datagram }, { kind: "dns", queryId: query.id }, query.id);
    if (query.status !== "pending") return;
    const delay = this.parameters.dnsRetryTimeout * 2 ** (query.attempts - 1);
    query.retrySeq = this.schedule(this.clock + delay, { type: "dns-retry", queryId: query.id, attempt: query.attempts });
  }

  private onDnsRetry(queryId: string, attempt: number): void {
    const query = this.dnsQueries.get(queryId);
    if (query?.status !== "pending" || query.attempts !== attempt) return;
    if (query.attempts < this.parameters.dnsMaxAttempts) {
      this.sendQuery(query);
      return;
    }
    this.emit("dns.gave-up", { name: query.name, server: query.server, attempts: query.attempts }, { device: this.device(query.deviceId), exchange: query.id });
    this.finishQuery(query, "timeout");
  }

  private dnsSendFailed(queryId: string, reason: "no-address" | "no-route"): void {
    const query = this.dnsQueries.get(queryId);
    if (query?.status !== "pending") return;
    this.emit("dns.send-failed", { name: query.name, server: query.server, reason }, { device: this.device(query.deviceId), exchange: query.id });
    this.finishQuery(query, reason);
  }

  /** Réponse reçue sur le port d'une question en cours : identifiant, serveur et question doivent correspondre. */
  private onDnsResponse(device: RuntimeDevice, packet: Ipv4Packet, query: DnsQuery, message: DnsMessage): void {
    const where = { device, exchange: query.id, pdu: message };
    const answer = message.answers.find((item) => item.name === query.name);
    const mismatch =
      message.id !== query.messageId
        ? "unknown-id"
        : packet.source !== query.server
          ? "other-server"
          : message.question.name !== query.name
            ? "other-question"
            : message.rcode === "no-error" && !answer
              ? "no-answer"
              : null;
    if (mismatch !== null) {
      this.emit("dns.ignored", { reason: mismatch, id: message.id, name: message.question.name, from: packet.source }, where);
      return;
    }
    if (message.rcode === "name-error" || !answer) {
      this.emit("dns.name-error", { name: query.name, server: packet.source }, where);
      this.finishQuery(query, "name-error");
      return;
    }
    query.address = answer.address;
    query.ttl = answer.ttl;
    this.emit("dns.resolved", { name: query.name, address: answer.address, server: packet.source, ttl: answer.ttl }, where);
    this.finishQuery(query, "resolved");
  }

  /** Fin d'une résolution : un ping par nom envoie alors son premier écho, ou se termine sans écho. */
  private finishQuery(query: DnsQuery, status: Exclude<DnsLookupStatus, "pending">): void {
    query.status = status;
    this.cancel(query.retrySeq);
    this.markQuery(query);
    const session = query.pingSessionId === null ? undefined : this.sessions.get(query.pingSessionId);
    if (!session) return;
    session.resolution = status;
    this.dirtyPings.add(session.id);
    if (status === "resolved" && query.address !== null) {
      session.address = query.address;
      this.sendEcho(session);
      return;
    }
    session.done = true;
    this.emit("ping.unresolved", { name: query.name, reason: status }, { device: this.device(session.deviceId), exchange: session.id });
  }

  // ---------------------------------------------------------------- DNS : service du routeur

  /**
   * Le routeur répond avec autorité à partir de ses seuls enregistrements :
   * adresse si le nom est connu, NXDOMAIN sinon ; aucune récursion. La
   * réponse part de l'adresse interrogée vers le port source du client.
   */
  private onDnsServer(device: RuntimeDevice, packet: Ipv4Packet, datagram: UdpDatagram, query: DnsMessage, exchange: string | null): void {
    const records = device.dnsRecords;
    if (!records) return;
    const state = this.state(device.id);
    const name = query.question.name;
    const address = records.get(name) ?? null;
    const ttl = this.parameters.dnsAnswerTtl;
    const reply: DnsMessage = {
      ...query,
      response: true,
      authoritative: true,
      recursionAvailable: false,
      rcode: address === null ? "name-error" : "no-error",
      answers: address === null ? [] : [{ name, type: "A", ttl, address }],
    };
    if (address === null) {
      state.dnsNameErrors += 1;
      this.emit("dns.name-error-sent", { name, client: packet.source }, { device, exchange, pdu: reply });
    } else {
      state.dnsAnswered += 1;
      this.emit("dns.answer-sent", { name, address, client: packet.source, ttl }, { device, exchange, pdu: reply });
    }
    this.dirtyDevices.add(device.id);
    const datagramOut: UdpDatagram = { kind: "udp", sourcePort: DNS_SERVER_PORT, destinationPort: datagram.sourcePort, payload: reply };
    this.sendLocal(device, { source: packet.destination, destination: packet.source, ttl: this.initialTtl(device), payload: datagramOut }, { kind: "local" }, exchange);
  }

  // ---------------------------------------------------------------- RIP version 2

  /** L'interface accepte les trames de son groupe : 01:00:5e:00:00:09 sur une interface RIP active. */
  private joinsGroup(device: RuntimeDevice, port: RuntimePort, mac: MacAddress): boolean {
    if (device.kind !== "router") return false;
    // VRRP : groupe 224.0.0.18 écouté par les interfaces ayant un groupe VRRP en service.
    const vrrp = this.vrrpOn(device, port);
    if (vrrp && vrrp.state !== "initialize" && mac === multicastMac(parseIpv4(VRRP_MULTICAST) ?? 0)) return true;
    if (mac === multicastMac(parseIpv4(RIP_MULTICAST) ?? 0) && device.ripInterfaces.get(port.portId) === "active") return true;
    // OSPF : AllSPFRouters sur une interface active ; AllDRouters seulement pour le DR et le BDR (RFC 2328 A.1).
    const iface = this.ospf.get(device.id)?.interfaces.get(port.portId);
    if (iface?.mode !== "active" || iface.state === "down") return false;
    if (mac === multicastMac(parseIpv4(OSPF_ALL_ROUTERS) ?? 0)) return true;
    return mac === multicastMac(parseIpv4(OSPF_ALL_DROUTERS) ?? 0) && (iface.state === "dr" || iface.state === "backup");
  }

  /** Interface qui émet et traite RIP : mode actif, adressée et reliée. */
  private ripActive(device: RuntimeDevice, port: RuntimePort): boolean {
    return device.ripInterfaces.get(port.portId) === "active" && port.ipv4 !== null && this.isUp(port);
  }

  private newRipExchange(): string {
    const exchange = `rip-${String(this.nextRipExchange)}`;
    this.nextRipExchange += 1;
    return exchange;
  }

  /**
   * Réseaux des interfaces RIP adressées (métrique 1, RFC 2453 §3.5) et routes
   * apprises : une interface tombée rend ses réseaux et ses routes
   * inaccessibles, une interface rétablie retrouve son réseau. Vrai si la table change.
   */
  private syncRipNetworks(device: RuntimeDevice, observable: boolean): boolean {
    const state = this.rip.get(device.id);
    if (!state) return false;
    let changed = false;
    for (const port of device.ports) {
      if (!device.ripInterfaces.has(port.portId) || !port.ipv4) continue;
      const key = ripKey(port.ipv4.network, port.ipv4.prefixLength);
      const entry = state.routes.get(key);
      if (this.isUp(port)) {
        if (entry?.nextHop === null && entry.portId === port.portId && entry.metric === 1) continue;
        state.routes.set(key, {
          destination: port.ipv4.network,
          prefixLength: port.ipv4.prefixLength,
          nextHop: null,
          portId: port.portId,
          metric: 1,
          changed: observable,
          expiresAt: null,
          garbageAt: null,
          generation: (entry?.generation ?? 0) + 1,
        });
        if (observable) this.emit("rip.network-up", { route: key }, { device, port });
        changed = true;
      } else if (entry?.nextHop === null && entry.portId === port.portId && entry.metric < RIP_INFINITY) {
        this.startRipDeletion(device, key, entry, "interface-down");
        changed = true;
      }
    }
    for (const [key, entry] of state.routes) {
      const port = device.portById.get(entry.portId);
      if (entry.nextHop === null || entry.metric >= RIP_INFINITY || (port && this.isUp(port))) continue;
      this.startRipDeletion(device, key, entry, "interface-down");
      changed = true;
    }
    if (changed) this.dirtyDevices.add(device.id);
    return changed;
  }

  /** Processus de suppression (RFC 2453 §3.8) : métrique 16, annonce déclenchée, suppression après 120 s. */
  private startRipDeletion(device: RuntimeDevice, key: string, entry: RipRoute, reason: "interface-down" | "metric-infinity" | "timeout"): void {
    entry.metric = RIP_INFINITY;
    entry.changed = true;
    entry.expiresAt = null;
    entry.garbageAt = this.clock + this.parameters.ripGarbageCollection;
    entry.generation += 1;
    this.schedule(entry.garbageAt, { type: "rip-timer", deviceId: device.id, key, stage: "garbage", generation: entry.generation }, true);
    this.dirtyDevices.add(device.id);
    this.emit(
      "rip.route-unreachable",
      { route: key, nextHop: entry.nextHop === null ? null : formatIpv4(entry.nextHop), reason, garbageAt: entry.garbageAt },
      { device, port: device.portById.get(entry.portId) },
    );
  }

  private refreshRipTimeout(device: RuntimeDevice, key: string, entry: RipRoute): void {
    entry.expiresAt = this.clock + this.parameters.ripTimeout;
    entry.garbageAt = null;
    entry.generation += 1;
    this.schedule(entry.expiresAt, { type: "rip-timer", deviceId: device.id, key, stage: "timeout", generation: entry.generation }, true);
  }

  /** Mise à jour déclenchée dès que possible, au plus tôt à la fin de l'attente qui suit la précédente. */
  private markRipChanged(device: RuntimeDevice): void {
    const state = this.rip.get(device.id);
    if (!state || state.triggerPending) return;
    state.triggerPending = true;
    this.schedule(Math.max(this.clock, state.holdUntil), { type: "rip-triggered", deviceId: device.id });
  }

  /** Demande de table complète : une entrée de famille 0 et de métrique 16 (RFC 2453 §3.9.1). */
  private sendRipRequest(device: RuntimeDevice, port: RuntimePort): void {
    const message: RipMessage = {
      kind: "rip",
      command: "request",
      version: 2,
      entries: [{ family: "unspecified", routeTag: 0, address: UNSPECIFIED_ADDRESS, mask: UNSPECIFIED_ADDRESS, nextHop: UNSPECIFIED_ADDRESS, metric: RIP_INFINITY }],
    };
    const exchange = this.newRipExchange();
    this.emit("rip.request-sent", { destination: RIP_MULTICAST }, { device, port, exchange, pdu: message });
    this.multicastRip(device, port, message, exchange);
  }

  /** Datagramme RIP vers 224.0.0.9 sur une interface : TTL 1, MAC de groupe, sans résolution ARP. */
  private multicastRip(device: RuntimeDevice, port: RuntimePort, message: RipMessage, exchange: string): void {
    const own = port.ipv4;
    if (!own) return;
    const state = this.state(device.id);
    const identification = state.nextIdentification;
    state.nextIdentification = (state.nextIdentification + 1) & 0xffff;
    const packet: Ipv4Packet = {
      kind: "ipv4",
      source: own.address,
      destination: RIP_MULTICAST,
      ttl: 1,
      identification,
      payload: { kind: "udp", sourcePort: RIP_PORT, destinationPort: RIP_PORT, payload: message },
    };
    this.transmit(device, port, { kind: "ethernet", source: port.mac, destination: multicastMac(parseIpv4(RIP_MULTICAST) ?? 0), payload: packet }, exchange);
  }

  /**
   * Processus de sortie (RFC 2453 §3.10) : sur chaque interface active, toutes
   * les routes (annonce périodique ou réponse à une demande) ou les seules routes
   * changées (mise à jour déclenchée), sauf celles qui passent par cette
   * interface (horizon partagé simple), par messages de 25 entrées au plus.
   */
  private sendRipResponse(device: RuntimeDevice, reason: "periodic" | "triggered" | "reply", to: { readonly port: RuntimePort; readonly address: string; readonly udpPort: number } | null = null): void {
    const state = this.rip.get(device.id);
    if (!state) return;
    const routes = [...state.routes.entries()];
    for (const port of device.ports) {
      if (!this.ripActive(device, port) || (to && to.port !== port)) continue;
      const own = port.ipv4;
      if (!own) continue;
      const entries: RipEntry[] = routes
        .filter(([, entry]) => (reason !== "triggered" || entry.changed) && entry.portId !== port.portId)
        .map(([, entry]) => ({ family: "inet", routeTag: 0, address: formatIpv4(entry.destination), mask: prefixToMask(entry.prefixLength), nextHop: UNSPECIFIED_ADDRESS, metric: entry.metric }));
      for (let start = 0; start < entries.length; start += RIP_MAX_ENTRIES) {
        const message: RipMessage = { kind: "rip", command: "response", version: 2, entries: entries.slice(start, start + RIP_MAX_ENTRIES) };
        const exchange = this.newRipExchange();
        this.emit("rip.response-sent", { reason, count: message.entries.length, destination: to?.address ?? RIP_MULTICAST }, { device, port, exchange, pdu: message });
        if (to) {
          const datagram: UdpDatagram = { kind: "udp", sourcePort: RIP_PORT, destinationPort: to.udpPort, payload: message };
          this.sendLocal(device, { source: own.address, destination: to.address, ttl: this.initialTtl(device), payload: datagram }, { kind: "local" }, exchange);
        } else {
          this.multicastRip(device, port, message, exchange);
        }
      }
    }
    if (reason !== "reply") for (const entry of state.routes.values()) entry.changed = false;
  }

  private onRipStart(deviceId: string): void {
    const device = this.device(deviceId);
    for (const port of device.ports) if (this.ripActive(device, port)) this.sendRipRequest(device, port);
  }

  private onRipPeriodic(deviceId: string): void {
    const device = this.device(deviceId);
    const state = this.rip.get(deviceId);
    if (!state) return;
    this.sendRipResponse(device, "periodic");
    state.nextPeriodicAt = this.clock + this.parameters.ripUpdateInterval;
    this.dirtyDevices.add(deviceId);
    this.schedule(state.nextPeriodicAt, { type: "rip-periodic", deviceId }, true);
  }

  private onRipTriggered(deviceId: string): void {
    const state = this.rip.get(deviceId);
    if (!state) return;
    state.triggerPending = false;
    this.sendRipResponse(this.device(deviceId), "triggered");
    const { ripTriggeredHoldMin: min, ripTriggeredHoldMax: max } = this.parameters;
    state.holdUntil = this.clock + min + Math.round(((max - min) * this.prng.nextInt(1001)) / 1000);
  }

  private onRipTimer(deviceId: string, key: string, stage: "timeout" | "garbage", generation: number): void {
    const device = this.device(deviceId);
    const entry = this.rip.get(deviceId)?.routes.get(key);
    if (entry?.generation !== generation) return;
    if (stage === "timeout") {
      this.startRipDeletion(device, key, entry, "timeout");
      this.markRipChanged(device);
      return;
    }
    this.rip.get(deviceId)?.routes.delete(key);
    this.dirtyDevices.add(deviceId);
    this.emit("rip.route-removed", { route: key }, { device, port: device.portById.get(entry.portId) });
  }

  /** Message RIP reçu sur une interface active : contrôles d'origine (RFC 2453 §3.9), puis demande ou réponse. */
  private onRip(device: RuntimeDevice, port: RuntimePort, packet: Ipv4Packet, datagram: UdpDatagram, message: RipMessage, exchange: string | null): void {
    const where = { device, port, exchange, pdu: message };
    const own = port.ipv4;
    const source = parseIpv4(packet.source);
    if (!own || source === null) return;
    const ignore = (reason: string) => {
      this.emit("rip.ignored", { reason, from: packet.source }, where);
    };
    if (this.ownsAddress(device, source)) {
      ignore("own-address");
      return;
    }
    if (networkAddress(source, own.prefixLength) !== own.network) {
      ignore("not-neighbor");
      return;
    }
    if (message.command === "request") {
      // Toute demande est traitée comme une demande de table complète (seule forme émise par NetForge).
      this.emit("rip.request-received", { from: packet.source }, where);
      this.sendRipResponse(device, "reply", { port, address: packet.source, udpPort: datagram.sourcePort });
      return;
    }
    if (datagram.sourcePort !== RIP_PORT) {
      ignore("wrong-port");
      return;
    }
    this.emit("rip.response-received", { from: packet.source, count: message.entries.length }, where);
    let changed = false;
    for (const entry of message.entries) if (this.learnRipEntry(device, port, source, entry, where)) changed = true;
    if (changed) this.markRipChanged(device);
  }

  /** Traitement d'une entrée (RFC 2453 §3.9.2) ; vrai si la table change. */
  private learnRipEntry(device: RuntimeDevice, port: RuntimePort, source: number, entry: RipEntry, where: Where): boolean {
    const state = this.rip.get(device.id);
    const destination = parseIpv4(entry.address);
    const prefixLength = parsePrefixOrMask(entry.mask);
    if (!state || entry.family !== "inet" || destination === null || prefixLength === null || entry.metric < 1 || entry.metric > RIP_INFINITY) return false;
    // Réseau d'une interface active du routeur : la route connectée suffit.
    if (device.ports.some((item) => item.ipv4?.network === destination && item.ipv4.prefixLength === prefixLength && this.isUp(item))) return false;
    const key = ripKey(destination, prefixLength);
    const metric = Math.min(entry.metric + 1, RIP_INFINITY);
    const nextHop = formatIpv4(source);
    const existing = state.routes.get(key);
    if (!existing) {
      if (metric >= RIP_INFINITY) return false;
      const route: RipRoute = { destination, prefixLength, nextHop: source, portId: port.portId, metric, changed: true, expiresAt: null, garbageAt: null, generation: 0 };
      state.routes.set(key, route);
      this.refreshRipTimeout(device, key, route);
      this.dirtyDevices.add(device.id);
      this.emit("rip.route-learned", { route: key, nextHop, metric, outPort: port.portId }, where);
      return true;
    }
    if (existing.nextHop === source && existing.portId === port.portId) {
      if (metric < RIP_INFINITY) this.refreshRipTimeout(device, key, existing);
      if (metric === existing.metric) return false;
      if (metric >= RIP_INFINITY) {
        this.startRipDeletion(device, key, existing, "metric-infinity");
        return true;
      }
      const previousMetric = existing.metric;
      existing.metric = metric;
      existing.changed = true;
      this.dirtyDevices.add(device.id);
      this.emit("rip.route-updated", { route: key, nextHop, metric, previousMetric, previousNextHop: nextHop, outPort: port.portId }, where);
      return true;
    }
    if (metric >= existing.metric) return false;
    const previousMetric = existing.metric;
    const previousNextHop = existing.nextHop === null ? null : formatIpv4(existing.nextHop);
    existing.nextHop = source;
    existing.portId = port.portId;
    existing.metric = metric;
    existing.changed = true;
    this.refreshRipTimeout(device, key, existing);
    this.dirtyDevices.add(device.id);
    if (previousMetric >= RIP_INFINITY) this.emit("rip.route-learned", { route: key, nextHop, metric, outPort: port.portId }, where);
    else this.emit("rip.route-updated", { route: key, nextHop, metric, previousMetric, previousNextHop, outPort: port.portId }, where);
    return true;
  }

  private ripView(device: RuntimeDevice): RipView | null {
    const state = this.rip.get(device.id);
    if (!state) return null;
    return {
      interfaces: [...device.ripInterfaces].map(([portId, mode]) => {
        const port = device.portById.get(portId);
        return { portId, mode, up: port !== undefined && port.ipv4 !== null && this.isUp(port) };
      }),
      routes: [...state.routes.values()]
        .map((entry) => ({
          destination: formatIpv4(entry.destination),
          prefixLength: entry.prefixLength,
          nextHop: entry.nextHop === null ? null : formatIpv4(entry.nextHop),
          portId: entry.portId,
          metric: entry.metric,
          state: entry.metric >= RIP_INFINITY ? ("deleting" as const) : entry.nextHop === null ? ("local" as const) : ("valid" as const),
          expiresAt: entry.expiresAt,
          garbageAt: entry.garbageAt,
        }))
        .sort((a, b) => (parseIpv4(a.destination) ?? 0) - (parseIpv4(b.destination) ?? 0) || a.prefixLength - b.prefixLength),
      nextUpdateAt: state.nextPeriodicAt,
    };
  }

  // ---------------------------------------------------------------- VRRP version 3

  private newVrrpExchange(): string {
    const exchange = `vrrp-${String(this.nextVrrpExchange)}`;
    this.nextVrrpExchange += 1;
    return exchange;
  }

  /** Groupe VRRP d'une interface, s'il existe. */
  private vrrpOn(device: RuntimeDevice, port: RuntimePort): VrrpRuntime | undefined {
    return this.vrrp.get(vrrpKey(device.id, port.portId));
  }

  /** Master_Down_Interval = 3 × intervalle + Skew_Time, Skew_Time = (256 − priorité) × intervalle / 256 (RFC 5798 §6.1). */
  private masterDownInterval(group: VrrpRuntime): SimTime {
    return 3 * group.masterAdverInterval + Math.round(((256 - group.priority) * group.masterAdverInterval) / 256);
  }

  private setVrrpState(device: RuntimeDevice, port: RuntimePort, group: VrrpRuntime, to: VrrpStateView, cause: string): void {
    const from = group.state;
    group.state = to;
    this.dirtyDevices.add(device.id);
    if (from !== to) this.emit("vrrp.state", { vrid: group.vrid, from, to, cause, priority: group.priority, address: group.address }, { device, port });
  }

  /**
   * Startup (RFC 5798 §6.4.1) : le propriétaire de l'adresse (priorité 255)
   * devient maître aussitôt ; les autres passent en secours et attendent
   * Master_Down_Interval avant de se proclamer maître. Cette première attente
   * compte comme un échange en cours (convergence calculée).
   */
  private vrrpStartup(device: RuntimeDevice, port: RuntimePort, group: VrrpRuntime): void {
    if (!port.ipv4 || !this.isUp(port)) return;
    group.generation += 1;
    group.masterAdverInterval = this.parameters.vrrpAdvertisementInterval;
    if (group.owner) {
      this.becomeMaster(device, port, group, "owner");
      return;
    }
    group.master = null;
    group.downAt = this.clock + this.masterDownInterval(group);
    group.nextAdvertAt = null;
    this.setVrrpState(device, port, group, "backup", "startup");
    this.schedule(group.downAt, { type: "vrrp-down", deviceId: device.id, portId: port.portId, generation: group.generation });
  }

  /** Passage en maître : annonce, ARP gratuit avec la MAC virtuelle, annonces périodiques (RFC 5798 §6.4.2, étapes 370 à 410). */
  private becomeMaster(device: RuntimeDevice, port: RuntimePort, group: VrrpRuntime, cause: string): void {
    group.generation += 1;
    group.master = port.ipv4?.address ?? null;
    group.downAt = null;
    this.setVrrpState(device, port, group, "master", cause);
    this.sendVrrpAdvertisement(device, port, group);
    this.sendGratuitousArp(device, port, group);
    group.nextAdvertAt = this.clock + group.masterAdverInterval;
    this.schedule(group.nextAdvertAt, { type: "vrrp-advert", deviceId: device.id, portId: port.portId, generation: group.generation }, true);
  }

  private sendVrrpAdvertisement(device: RuntimeDevice, port: RuntimePort, group: VrrpRuntime): void {
    if (!port.ipv4) return;
    const advert: VrrpAdvertisement = {
      kind: "vrrp",
      version: 3,
      type: "advertisement",
      vrid: group.vrid,
      priority: group.priority,
      maxAdverInterval: Math.round(group.masterAdverInterval / 10_000_000),
      addresses: [group.address],
    };
    const state = this.state(device.id);
    const identification = state.nextIdentification;
    state.nextIdentification = (state.nextIdentification + 1) & 0xffff;
    // Source : adresse principale de l'interface, MAC virtuelle (RFC 5798 §5.1.1.1, §7.2).
    const packet: Ipv4Packet = { kind: "ipv4", source: port.ipv4.address, destination: VRRP_MULTICAST, ttl: VRRP_TTL, identification, payload: advert };
    const exchange = this.newVrrpExchange();
    this.emit("vrrp.advert-sent", { vrid: group.vrid, priority: group.priority, destination: VRRP_MULTICAST }, { device, port, exchange, pdu: advert });
    this.transmit(device, port, { kind: "ethernet", source: group.mac, destination: multicastMac(parseIpv4(VRRP_MULTICAST) ?? 0), payload: packet }, exchange);
  }

  /** ARP gratuit : requête diffusée pour l'adresse virtuelle, émetteur = MAC virtuelle (les switches apprennent son nouveau port). */
  private sendGratuitousArp(device: RuntimeDevice, port: RuntimePort, group: VrrpRuntime): void {
    const frame: EthernetFrame = {
      kind: "ethernet",
      source: group.mac,
      destination: BROADCAST_MAC,
      payload: { kind: "arp", operation: "request", senderMac: group.mac, senderIp: group.address, targetMac: ZERO_MAC, targetIp: group.address },
    };
    const exchange = this.newVrrpExchange();
    this.emit("vrrp.gratuitous-arp", { vrid: group.vrid, address: group.address, mac: group.mac }, { device, port, exchange, pdu: frame.payload });
    this.transmit(device, port, frame, exchange);
  }

  private onVrrpStart(deviceId: string): void {
    const device = this.device(deviceId);
    for (const port of device.ports) {
      const group = this.vrrpOn(device, port);
      if (group) this.vrrpStartup(device, port, group);
    }
  }

  private onVrrpAdvertTimer(deviceId: string, portId: string, generation: number): void {
    const device = this.device(deviceId);
    const port = device.portById.get(portId);
    const group = port ? this.vrrpOn(device, port) : undefined;
    if (!port || group?.generation !== generation || group.state !== "master") return;
    this.sendVrrpAdvertisement(device, port, group);
    group.nextAdvertAt = this.clock + group.masterAdverInterval;
    this.dirtyDevices.add(deviceId);
    this.schedule(group.nextAdvertAt, { type: "vrrp-advert", deviceId, portId, generation }, true);
  }

  /** Master_Down_Timer : aucune annonce acceptée depuis Master_Down_Interval, le secours devient maître. */
  private onVrrpDown(deviceId: string, portId: string, generation: number): void {
    const device = this.device(deviceId);
    const port = device.portById.get(portId);
    const group = port ? this.vrrpOn(device, port) : undefined;
    if (!port || group?.generation !== generation || group.state !== "backup") return;
    this.becomeMaster(device, port, group, "master-down");
  }

  /** Annonce reçue (RFC 5798 §6.4.2 et §6.4.3) : TTL 255, même VRID ; secours qui l'accepte ou maître qui cède. */
  private onVrrp(device: RuntimeDevice, port: RuntimePort, packet: Ipv4Packet, advert: VrrpAdvertisement, exchange: string | null): void {
    const where = { device, port, exchange, pdu: advert };
    const group = this.vrrpOn(device, port);
    if (!group || group.vrid !== advert.vrid) {
      this.emit("vrrp.ignored", { reason: group ? "other-vrid" : "no-group", vrid: advert.vrid, from: packet.source }, where);
      return;
    }
    if (packet.ttl !== VRRP_TTL) {
      this.emit("vrrp.ignored", { reason: "ttl", vrid: advert.vrid, from: packet.source, ttl: packet.ttl }, where);
      return;
    }
    if (group.state === "initialize" || !port.ipv4) return;
    this.emit("vrrp.advert-received", { vrid: advert.vrid, priority: advert.priority, from: packet.source }, where);
    const interval = advert.maxAdverInterval * 10_000_000;
    if (group.state === "backup") {
      if (!group.preempt || advert.priority >= group.priority) {
        group.master = packet.source;
        group.masterAdverInterval = interval;
        group.generation += 1;
        group.downAt = this.clock + this.masterDownInterval(group);
        this.dirtyDevices.add(device.id);
        this.schedule(group.downAt, { type: "vrrp-down", deviceId: device.id, portId: port.portId, generation: group.generation }, true);
        return;
      }
      // Préemption : l'annonce d'un maître moins prioritaire est écartée ; le secours prendra la main à l'échéance.
      this.emit("vrrp.advert-discarded", { vrid: advert.vrid, priority: advert.priority, local: group.priority, from: packet.source }, where);
      return;
    }
    const senderWins = advert.priority > group.priority || (advert.priority === group.priority && (parseIpv4(packet.source) ?? 0) > port.ipv4.value);
    if (!senderWins) {
      this.emit("vrrp.advert-discarded", { vrid: advert.vrid, priority: advert.priority, local: group.priority, from: packet.source }, where);
      return;
    }
    group.generation += 1;
    group.master = packet.source;
    group.masterAdverInterval = interval;
    group.nextAdvertAt = null;
    group.downAt = this.clock + this.masterDownInterval(group);
    this.setVrrpState(device, port, group, "backup", "higher-priority");
    this.schedule(group.downAt, { type: "vrrp-down", deviceId: device.id, portId: port.portId, generation: group.generation }, true);
  }

  /** Interface tombée : le groupe revient à l'initialisation ; rétablie : nouveau démarrage. */
  private vrrpLinkChange(device: RuntimeDevice, port: RuntimePort, up: boolean): void {
    const group = this.vrrpOn(device, port);
    if (!group) return;
    if (!up && group.state !== "initialize") {
      group.generation += 1;
      group.downAt = null;
      group.nextAdvertAt = null;
      group.master = null;
      this.setVrrpState(device, port, group, "initialize", "interface-down");
    } else if (up && group.state === "initialize") {
      this.vrrpStartup(device, port, group);
    }
  }

  private vrrpView(device: RuntimeDevice): DeviceView["vrrp"] {
    const groups = device.ports.flatMap((port) => {
      const group = this.vrrpOn(device, port);
      return group
        ? [{ portId: port.portId, vrid: group.vrid, address: group.address, virtualMac: group.mac, priority: group.priority, owner: group.owner, preempt: group.preempt, state: group.state, master: group.master, downAt: group.downAt, nextAdvertAt: group.nextAdvertAt }]
        : [];
    });
    return groups.length > 0 ? groups : null;
  }

  // ---------------------------------------------------------------- OSPF version 2 (zone unique)

  private newOspfExchange(): string {
    const exchange = `ospf-${String(this.nextOspfExchange)}`;
    this.nextOspfExchange += 1;
    return exchange;
  }

  private ospfPacket<T extends OspfPacket>(state: OspfState, area: string, body: Omit<T, "kind" | "version" | "routerId" | "area">): T {
    return { kind: "ospf", version: 2, routerId: state.routerId, area, ...body } as T;
  }

  /** Zone de l'interface OSPF d'un port. */
  private areaOf(state: OspfState, port: RuntimePort): string {
    return state.interfaces.get(port.portId)?.area ?? OSPF_BACKBONE;
  }

  /** Base d'états des liens d'une zone. */
  private lsdbOf(state: OspfState, area: string): Map<string, StoredLsa> {
    let lsdb = state.lsdbs.get(area);
    if (!lsdb) {
      lsdb = new Map();
      state.lsdbs.set(area, lsdb);
    }
    return lsdb;
  }

  /** Paquet OSPF vers un groupe (224.0.0.5 ou 224.0.0.6) : TTL 1, MAC de groupe, sans résolution ARP. */
  private multicastOspf(device: RuntimeDevice, port: RuntimePort, group: string, packet: OspfPacket, exchange: string): void {
    if (!port.ipv4) return;
    const state = this.state(device.id);
    const identification = state.nextIdentification;
    state.nextIdentification = (state.nextIdentification + 1) & 0xffff;
    const ip: Ipv4Packet = { kind: "ipv4", source: port.ipv4.address, destination: group, ttl: 1, identification, payload: packet };
    this.transmit(device, port, { kind: "ethernet", source: port.mac, destination: multicastMac(parseIpv4(group) ?? 0), payload: ip }, exchange);
  }

  /** Paquet OSPF vers l'adresse d'un voisin (échange de base) : TTL 1, résolution ARP habituelle. */
  private unicastOspf(device: RuntimeDevice, port: RuntimePort, destination: string, packet: OspfPacket, exchange: string): void {
    if (!port.ipv4) return;
    this.sendLocal(device, { source: port.ipv4.address, destination, ttl: 1, payload: packet }, { kind: "local" }, exchange);
  }

  /** Interface utilisable : adressée et reliée. */
  private ospfUsable(device: RuntimeDevice, iface: OspfInterfaceState): RuntimePort | null {
    const port = device.portById.get(iface.portId);
    return port?.ipv4 && this.isUp(port) ? port : null;
  }

  /** Identifiant de routeur correspondant à une adresse d'interface du réseau (DR ou BDR annoncé). */
  private ospfRouterOf(state: OspfState, iface: OspfInterfaceState, port: RuntimePort, address: string): string | null {
    if (address === NO_ROUTER) return null;
    if (address === port.ipv4?.address) return state.routerId;
    for (const neighbor of iface.neighbors.values()) if (neighbor.address === address) return neighbor.routerId;
    return address;
  }

  private setOspfInterfaceState(device: RuntimeDevice, state: OspfState, iface: OspfInterfaceState, port: RuntimePort, to: OspfInterfaceStateView, cause: string): void {
    const from = iface.state;
    iface.state = to;
    this.dirtyDevices.add(device.id);
    if (from === to) return;
    this.emit(
      "ospf.interface-state",
      { from, to, cause, dr: this.ospfRouterOf(state, iface, port, iface.dr), bdr: this.ospfRouterOf(state, iface, port, iface.bdr) },
      { device, port },
    );
  }

  private setNeighborState(device: RuntimeDevice, port: RuntimePort, neighbor: OspfNeighbor, to: OspfNeighborStateView | "down", event: string): void {
    const from = neighbor.state;
    if (from === to) return;
    if (to !== "down") neighbor.state = to;
    this.dirtyDevices.add(device.id);
    this.emit("ospf.neighbor-state", { neighbor: neighbor.routerId, address: neighbor.address, from, to, event }, { device, port });
  }

  /**
   * Interface rétablie (RFC 2328 §9.3, InterfaceUp) : attente de 40 s avant
   * l'élection, ou DR Other directement si la priorité est 0 ; Hello aussitôt.
   */
  private ospfInterfaceUp(device: RuntimeDevice, iface: OspfInterfaceState, port: RuntimePort): void {
    const state = this.ospf.get(device.id);
    if (!state || !port.ipv4 || !this.isUp(port)) return;
    if (iface.mode === "passive") {
      this.setOspfInterfaceState(device, state, iface, port, "passive", "interface-up");
      return;
    }
    iface.dr = NO_ROUTER;
    iface.bdr = NO_ROUTER;
    iface.waitGeneration += 1;
    if (iface.priority === 0) {
      this.setOspfInterfaceState(device, state, iface, port, "dr-other", "interface-up");
    } else {
      this.setOspfInterfaceState(device, state, iface, port, "waiting", "interface-up");
      this.schedule(this.clock + this.parameters.ospfDeadInterval, { type: "ospf-wait", deviceId: device.id, portId: iface.portId, generation: iface.waitGeneration });
    }
    this.triggerHello(device, iface);
  }

  /** Interface tombée (InterfaceDown) : tous ses voisins sont perdus, DR et BDR oubliés. */
  private ospfInterfaceDown(device: RuntimeDevice, state: OspfState, iface: OspfInterfaceState, port: RuntimePort): void {
    if (iface.state === "down") return;
    for (const neighbor of [...iface.neighbors.values()]) this.killNeighbor(device, iface, port, neighbor, "interface-down");
    iface.waitGeneration += 1;
    iface.dr = NO_ROUTER;
    iface.bdr = NO_ROUTER;
    this.setOspfInterfaceState(device, state, iface, port, "down", "interface-down");
  }

  private onOspfStart(deviceId: string): void {
    const device = this.device(deviceId);
    const state = this.ospf.get(deviceId);
    if (!state) return;
    for (const iface of state.interfaces.values()) {
      const port = this.ospfUsable(device, iface);
      if (port) this.ospfInterfaceUp(device, iface, port);
    }
    this.updateOwnLsas(device, state);
  }

  /**
   * Hello déclenché : quand ce qu'annonce le routeur change (nouveau voisin,
   * voisin perdu, DR ou BDR élu), il émet un Hello sans attendre l'intervalle
   * de 10 s (choix NetForge : la découverte et l'élection ne dépendent pas des
   * annonces périodiques, ce qui permet de calculer la convergence).
   */
  private triggerHello(device: RuntimeDevice, iface: OspfInterfaceState): void {
    if (iface.mode !== "active" || iface.helloPending) return;
    iface.helloPending = true;
    this.schedule(this.clock, { type: "ospf-hello", deviceId: device.id, portId: iface.portId });
  }

  private onOspfHelloTimer(deviceId: string, portId: string): void {
    const device = this.device(deviceId);
    const iface = this.ospf.get(deviceId)?.interfaces.get(portId);
    if (!iface) return;
    iface.helloPending = false;
    this.sendHello(device, iface, "triggered");
  }

  private onOspfPeriodic(deviceId: string): void {
    const device = this.device(deviceId);
    const state = this.ospf.get(deviceId);
    if (!state) return;
    for (const iface of state.interfaces.values()) this.sendHello(device, iface, "periodic");
    state.nextHelloAt = this.clock + this.parameters.ospfHelloInterval;
    this.dirtyDevices.add(deviceId);
    this.schedule(state.nextHelloAt, { type: "ospf-periodic", deviceId }, true);
  }

  private sendHello(device: RuntimeDevice, iface: OspfInterfaceState, reason: "periodic" | "triggered"): void {
    const state = this.ospf.get(device.id);
    const port = this.ospfUsable(device, iface);
    if (!state || !port?.ipv4 || iface.mode !== "active" || iface.state === "down") return;
    const hello = this.ospfPacket<OspfHello>(state, iface.area, {
      type: "hello",
      networkMask: prefixToMask(port.ipv4.prefixLength),
      helloInterval: this.parameters.ospfHelloInterval / 1e9,
      deadInterval: this.parameters.ospfDeadInterval / 1e9,
      priority: iface.priority,
      designatedRouter: iface.dr,
      backupRouter: iface.bdr,
      neighbors: [...iface.neighbors.keys()].sort(compareRouterIds),
    });
    const exchange = this.newOspfExchange();
    this.emit(
      "ospf.hello-sent",
      { reason, neighbors: hello.neighbors.length, dr: this.ospfRouterOf(state, iface, port, iface.dr), bdr: this.ospfRouterOf(state, iface, port, iface.bdr), destination: OSPF_ALL_ROUTERS },
      { device, port, exchange, pdu: hello },
    );
    this.multicastOspf(device, port, OSPF_ALL_ROUTERS, hello, exchange);
  }

  /** Réception d'un paquet OSPF : interface active, émetteur du même réseau, zone 0 (RFC 2328 §8.2). */
  private onOspf(device: RuntimeDevice, port: RuntimePort, packet: Ipv4Packet, message: OspfPacket, exchange: string | null): void {
    const where = { device, port, exchange, pdu: message };
    const state = this.ospf.get(device.id);
    const iface = state?.interfaces.get(port.portId);
    if (!state || !iface || !port.ipv4) {
      this.emit("ospf.ignored", { reason: "not-enabled", from: packet.source }, where);
      return;
    }
    if (iface.mode === "passive") {
      this.emit("ospf.ignored", { reason: "passive", from: packet.source }, where);
      return;
    }
    if (iface.state === "down" || message.routerId === state.routerId) return;
    const source = parseIpv4(packet.source);
    if (source === null || networkAddress(source, port.ipv4.prefixLength) !== port.ipv4.network) {
      this.emit("ospf.ignored", { reason: "other-network", from: packet.source }, where);
      return;
    }
    if (message.area !== iface.area) {
      this.emit("ospf.ignored", { reason: "area", from: packet.source, area: message.area }, where);
      return;
    }
    if (message.type === "hello") {
      this.onOspfHello(device, state, iface, port, packet.source, message, where);
      return;
    }
    const neighbor = iface.neighbors.get(message.routerId);
    if (!neighbor) {
      this.emit("ospf.ignored", { reason: "unknown-neighbor", from: packet.source }, where);
      return;
    }
    if (message.type === "dd") this.onOspfDd(device, state, port, neighbor, message, where);
    else if (message.type === "lsr") this.onOspfLsr(device, state, port, neighbor, message, where);
    else this.onOspfLsu(device, state, iface, port, neighbor, message, where);
  }

  /** Hello reçu (RFC 2328 §10.5) : paramètres du réseau, voisin, communication bidirectionnelle, BackupSeen. */
  private onOspfHello(device: RuntimeDevice, state: OspfState, iface: OspfInterfaceState, port: RuntimePort, source: string, hello: OspfHello, where: Where): void {
    if (!port.ipv4) return;
    const expected: ReadonlyArray<readonly [string, string | number, string | number]> = [
      ["mask", prefixToMask(port.ipv4.prefixLength), hello.networkMask],
      ["hello-interval", this.parameters.ospfHelloInterval / 1e9, hello.helloInterval],
      ["dead-interval", this.parameters.ospfDeadInterval / 1e9, hello.deadInterval],
    ];
    const mismatch = expected.find(([, own, received]) => own !== received);
    if (mismatch) {
      this.emit("ospf.hello-mismatch", { field: mismatch[0], expected: mismatch[1], received: mismatch[2], from: source }, where);
      return;
    }
    const listed = hello.neighbors.includes(state.routerId);
    this.emit(
      "ospf.hello-received",
      { routerId: hello.routerId, priority: hello.priority, dr: hello.designatedRouter === NO_ROUTER ? null : hello.designatedRouter, bdr: hello.backupRouter === NO_ROUTER ? null : hello.backupRouter, listed },
      where,
    );
    let neighbor = iface.neighbors.get(hello.routerId);
    let changed = false;
    if (!neighbor) {
      neighbor = {
        routerId: hello.routerId,
        address: source,
        priority: hello.priority,
        dr: hello.designatedRouter,
        bdr: hello.backupRouter,
        state: "init",
        deadAt: 0,
        deadGeneration: 0,
        master: false,
        ddSequence: 0,
        lastDd: null,
        awaiting: false,
        rxmtCount: 0,
        rxmtSeq: -1,
        adjacency: 0,
        requests: new Map(),
      };
      iface.neighbors.set(hello.routerId, neighbor);
      this.emit("ospf.neighbor-state", { neighbor: hello.routerId, address: source, from: "down", to: "init", event: "hello-received" }, { device, port });
      this.triggerHello(device, iface);
    } else {
      // Changement de priorité ou de DR/BDR déclaré : NeighborChange (RFC 2328 §10.5).
      const declared = (dr: string, bdr: string, address: string) => `${String(dr === address)}|${String(bdr === address)}`;
      if (neighbor.priority !== hello.priority || declared(neighbor.dr, neighbor.bdr, neighbor.address) !== declared(hello.designatedRouter, hello.backupRouter, source)) changed = true;
      neighbor.address = source;
      neighbor.priority = hello.priority;
      neighbor.dr = hello.designatedRouter;
      neighbor.bdr = hello.backupRouter;
    }
    neighbor.deadGeneration += 1;
    neighbor.deadAt = this.clock + this.parameters.ospfDeadInterval;
    this.schedule(neighbor.deadAt, { type: "ospf-dead", deviceId: device.id, portId: iface.portId, routerId: neighbor.routerId, generation: neighbor.deadGeneration }, true);
    this.dirtyDevices.add(device.id);
    if (listed && neighbor.state === "init") {
      this.setNeighborState(device, port, neighbor, "2-way", "2-way-received");
      changed = true;
    } else if (!listed && neighbor.state !== "init") {
      // 1-WayReceived : le voisin ne nous entend plus ; l'adjacence est abandonnée.
      const wasFull = neighbor.state === "full";
      this.resetAdjacency(neighbor);
      this.setNeighborState(device, port, neighbor, "init", "1-way-received");
      if (wasFull) this.updateOwnLsas(device, state);
      changed = true;
    }
    const backupSeen =
      iface.state === "waiting" &&
      neighbor.state !== "init" &&
      (hello.backupRouter === source || (hello.designatedRouter === source && hello.backupRouter === NO_ROUTER));
    if (backupSeen) this.runElection(device, state, iface, port, "backup-seen");
    else if (changed && iface.state !== "waiting" && iface.state !== "down") this.runElection(device, state, iface, port, "neighbor-change");
  }

  /** Élection (RFC 2328 §9.4), nouvel état de l'interface, adjacences réévaluées et LSA mis à jour. */
  private runElection(device: RuntimeDevice, state: OspfState, iface: OspfInterfaceState, port: RuntimePort, cause: string): void {
    if (!port.ipv4) return;
    const own = port.ipv4.address;
    const self = { routerId: state.routerId, address: own, priority: iface.priority, dr: iface.dr, bdr: iface.bdr };
    const candidates = [...iface.neighbors.values()]
      .filter((neighbor) => neighbor.state !== "init")
      .map((neighbor) => ({ routerId: neighbor.routerId, address: neighbor.address, priority: neighbor.priority, dr: neighbor.dr, bdr: neighbor.bdr }));
    const { dr, bdr } = electDesignatedRouter(self, candidates);
    const changed = dr !== iface.dr || bdr !== iface.bdr;
    iface.dr = dr;
    iface.bdr = bdr;
    const next: OspfInterfaceStateView = dr === own ? "dr" : bdr === own ? "backup" : "dr-other";
    if (changed && next === iface.state) {
      this.emit("ospf.interface-state", { from: iface.state, to: next, cause, dr: this.ospfRouterOf(state, iface, port, dr), bdr: this.ospfRouterOf(state, iface, port, bdr) }, { device, port });
    }
    this.setOspfInterfaceState(device, state, iface, port, next, cause);
    if (changed) this.triggerHello(device, iface);
    for (const neighbor of iface.neighbors.values()) this.evaluateAdjacency(device, state, iface, port, neighbor);
    this.updateOwnLsas(device, state);
  }

  /** Adjacence voulue sur un réseau à diffusion : avec le DR et le BDR, ou avec tous si l'on est DR ou BDR (RFC 2328 §10.4). */
  private evaluateAdjacency(device: RuntimeDevice, state: OspfState, iface: OspfInterfaceState, port: RuntimePort, neighbor: OspfNeighbor): void {
    if (neighbor.state === "init" || !port.ipv4) return;
    const own = port.ipv4.address;
    const wanted =
      iface.state !== "waiting" && iface.state !== "down" && (iface.dr === own || iface.bdr === own || neighbor.address === iface.dr || neighbor.address === iface.bdr);
    if (wanted && neighbor.state === "2-way") {
      this.startExchange(device, state, port, neighbor);
    } else if (!wanted && neighbor.state !== "2-way") {
      const wasFull = neighbor.state === "full";
      this.resetAdjacency(neighbor);
      this.setNeighborState(device, port, neighbor, "2-way", "adjacency-not-needed");
      if (wasFull) this.updateOwnLsas(device, state);
    }
  }

  private resetAdjacency(neighbor: OspfNeighbor): void {
    this.cancel(neighbor.rxmtSeq);
    neighbor.adjacency += 1;
    neighbor.requests.clear();
    neighbor.lastDd = null;
    neighbor.awaiting = false;
    neighbor.rxmtCount = 0;
  }

  /** ExStart (RFC 2328 §10.8) : chaque routeur se déclare maître avec une description vide (bits I, M et MS). */
  private startExchange(device: RuntimeDevice, state: OspfState, port: RuntimePort, neighbor: OspfNeighbor): void {
    this.resetAdjacency(neighbor);
    this.setNeighborState(device, port, neighbor, "exstart", "adjacency-ok");
    neighbor.master = true;
    neighbor.ddSequence = this.prng.nextInt(0x7fffffff) + 1;
    const dd = this.ospfPacket<OspfDatabaseDescription>(state, this.areaOf(state, port), { type: "dd", interfaceMtu: OSPF_INTERFACE_MTU, init: true, more: true, master: true, sequence: neighbor.ddSequence, headers: [] });
    this.sendDd(device, port, neighbor, dd, true);
  }

  private sendDd(device: RuntimeDevice, port: RuntimePort, neighbor: OspfNeighbor, dd: OspfDatabaseDescription, awaitReply: boolean): void {
    neighbor.lastDd = dd;
    const exchange = this.newOspfExchange();
    this.emit(
      "ospf.dd-sent",
      { neighbor: neighbor.routerId, sequence: dd.sequence >>> 0, init: dd.init, more: dd.more, master: dd.master, count: dd.headers.length },
      { device, port, exchange, pdu: dd },
    );
    this.unicastOspf(device, port, neighbor.address, dd, exchange);
    if (!awaitReply) return;
    neighbor.awaiting = true;
    neighbor.rxmtCount = 0;
    this.scheduleRxmt(device, port, neighbor);
  }

  private scheduleRxmt(device: RuntimeDevice, port: RuntimePort, neighbor: OspfNeighbor): void {
    neighbor.rxmtSeq = this.schedule(
      this.clock + this.parameters.ospfRxmtInterval,
      { type: "ospf-rxmt", deviceId: device.id, portId: port.portId, routerId: neighbor.routerId, generation: neighbor.adjacency },
      neighbor.rxmtCount >= OSPF_ACTIVE_RETRANSMISSIONS,
    );
  }

  /** Retransmission (RxmtInterval) d'une description restée sans réponse. */
  private onOspfRxmt(deviceId: string, portId: string, routerId: string, generation: number): void {
    const device = this.device(deviceId);
    const port = device.portById.get(portId);
    const neighbor = this.ospf.get(deviceId)?.interfaces.get(portId)?.neighbors.get(routerId);
    if (!port || neighbor?.adjacency !== generation || !neighbor.awaiting || !neighbor.lastDd) return;
    neighbor.rxmtCount += 1;
    const exchange = this.newOspfExchange();
    const dd = neighbor.lastDd;
    this.emit(
      "ospf.dd-sent",
      { neighbor: neighbor.routerId, sequence: dd.sequence >>> 0, init: dd.init, more: dd.more, master: dd.master, count: dd.headers.length, retransmission: neighbor.rxmtCount },
      { device, port, exchange, pdu: dd },
    );
    this.unicastOspf(device, port, neighbor.address, dd, exchange);
    this.scheduleRxmt(device, port, neighbor);
  }

  /** En-têtes de la base (hors MaxAge), âge courant. */
  private ospfSummary(state: OspfState, area: string): OspfLsaHeader[] {
    return [...this.lsdbOf(state, area).values()]
      .map((stored) => this.currentLsa(stored))
      .filter((lsa) => lsa.age < OSPF_MAX_AGE)
      .map((lsa) => lsaHeader(lsa))
      .sort(compareLsaKeys);
  }

  private collectRequests(state: OspfState, area: string, neighbor: OspfNeighbor, headers: readonly OspfLsaHeader[]): void {
    const lsdb = this.lsdbOf(state, area);
    for (const header of headers) {
      const stored = lsdb.get(lsaKey(header));
      if (!stored || compareLsa(header, this.currentLsa(stored)) > 0) neighbor.requests.set(lsaKey(header), header);
    }
  }

  /**
   * Description reçue (RFC 2328 §10.6, sous-ensemble) : négociation maître/esclave
   * (plus grand identifiant maître), puis une description complète de chaque
   * côté (toute la base tient dans un paquet : MTU non modélisée).
   */
  private onOspfDd(device: RuntimeDevice, state: OspfState, port: RuntimePort, neighbor: OspfNeighbor, dd: OspfDatabaseDescription, where: Where): void {
    if (neighbor.state === "init" || neighbor.state === "2-way") {
      this.emit("ospf.ignored", { reason: "neighbor-state", from: neighbor.address, state: neighbor.state }, where);
      return;
    }
    const neighborIsMaster = compareRouterIds(neighbor.routerId, state.routerId) > 0;
    const area = this.areaOf(state, port);
    const received = { neighbor: neighbor.routerId, sequence: dd.sequence >>> 0, init: dd.init, more: dd.more, master: dd.master, count: dd.headers.length };
    if (neighbor.state === "exstart") {
      if (dd.init && dd.more && dd.master && dd.headers.length === 0 && neighborIsMaster) {
        this.emit("ospf.dd-received", { ...received, role: "slave" }, where);
        neighbor.master = false;
        neighbor.awaiting = false;
        this.cancel(neighbor.rxmtSeq);
        neighbor.ddSequence = dd.sequence;
        this.setNeighborState(device, port, neighbor, "exchange", "negotiation-done");
        this.sendDd(device, port, neighbor, this.ospfPacket<OspfDatabaseDescription>(state, area, { type: "dd", interfaceMtu: OSPF_INTERFACE_MTU, init: false, more: false, master: false, sequence: dd.sequence, headers: this.ospfSummary(state, area) }), false);
        return;
      }
      if (!dd.init && !dd.master && dd.sequence === neighbor.ddSequence && !neighborIsMaster) {
        this.emit("ospf.dd-received", { ...received, role: "master" }, where);
        neighbor.master = true;
        neighbor.awaiting = false;
        this.cancel(neighbor.rxmtSeq);
        this.setNeighborState(device, port, neighbor, "exchange", "negotiation-done");
        this.collectRequests(state, area, neighbor, dd.headers);
        neighbor.ddSequence = (neighbor.ddSequence + 1) | 0;
        this.sendDd(device, port, neighbor, this.ospfPacket<OspfDatabaseDescription>(state, area, { type: "dd", interfaceMtu: OSPF_INTERFACE_MTU, init: false, more: false, master: true, sequence: neighbor.ddSequence, headers: this.ospfSummary(state, area) }), true);
        return;
      }
      // Description d'un voisin d'identifiant plus petit qui se croit maître : la nôtre l'emportera.
      this.emit("ospf.ignored", { reason: "negotiation", from: neighbor.address }, where);
      return;
    }
    if (neighbor.state === "exchange" && !neighbor.master && dd.master && dd.sequence === ((neighbor.ddSequence + 1) | 0)) {
      this.emit("ospf.dd-received", { ...received, role: "slave" }, where);
      neighbor.ddSequence = dd.sequence;
      this.collectRequests(state, area, neighbor, dd.headers);
      this.sendDd(device, port, neighbor, this.ospfPacket<OspfDatabaseDescription>(state, area, { type: "dd", interfaceMtu: OSPF_INTERFACE_MTU, init: false, more: false, master: false, sequence: dd.sequence, headers: [] }), false);
      if (!dd.more) this.exchangeDone(device, state, port, neighbor);
      return;
    }
    if (neighbor.state === "exchange" && neighbor.master && !dd.master && dd.sequence === neighbor.ddSequence) {
      this.emit("ospf.dd-received", { ...received, role: "master" }, where);
      neighbor.awaiting = false;
      this.cancel(neighbor.rxmtSeq);
      this.collectRequests(state, area, neighbor, dd.headers);
      if (!dd.more) this.exchangeDone(device, state, port, neighbor);
      return;
    }
    // Doublon du maître : l'esclave renvoie sa dernière réponse (RFC 2328 §10.8).
    if (!neighbor.master && dd.master && dd.sequence === neighbor.ddSequence && neighbor.lastDd) {
      this.emit("ospf.dd-received", { ...received, role: "slave", duplicate: true }, where);
      this.sendDd(device, port, neighbor, neighbor.lastDd, false);
      return;
    }
    this.emit("ospf.ignored", { reason: "sequence", from: neighbor.address }, where);
  }

  /** ExchangeDone : base à jour (Full) ou demande des LSA manquants (Loading). */
  private exchangeDone(device: RuntimeDevice, state: OspfState, port: RuntimePort, neighbor: OspfNeighbor): void {
    if (neighbor.requests.size === 0) {
      this.setNeighborState(device, port, neighbor, "full", "exchange-done");
      this.updateOwnLsas(device, state);
      return;
    }
    this.setNeighborState(device, port, neighbor, "loading", "exchange-done");
    const lsr = this.ospfPacket<OspfLinkStateRequest>(state, this.areaOf(state, port), {
      type: "lsr",
      requests: [...neighbor.requests.values()].map((header) => ({ lsaType: header.lsaType, lsId: header.lsId, advertisingRouter: header.advertisingRouter })),
    });
    const exchange = this.newOspfExchange();
    this.emit("ospf.lsr-sent", { neighbor: neighbor.routerId, count: lsr.requests.length }, { device, port, exchange, pdu: lsr });
    this.unicastOspf(device, port, neighbor.address, lsr, exchange);
  }

  private onOspfLsr(device: RuntimeDevice, state: OspfState, port: RuntimePort, neighbor: OspfNeighbor, lsr: OspfLinkStateRequest, where: Where): void {
    if (!OSPF_SYNCING.has(neighbor.state)) {
      this.emit("ospf.ignored", { reason: "neighbor-state", from: neighbor.address, state: neighbor.state }, where);
      return;
    }
    this.emit("ospf.lsr-received", { neighbor: neighbor.routerId, count: lsr.requests.length }, where);
    const area = this.areaOf(state, port);
    const lsdb = this.lsdbOf(state, area);
    const lsas = lsr.requests.flatMap((request) => {
      const stored = lsdb.get(lsaKey(request));
      return stored ? [this.currentLsa(stored)] : [];
    });
    if (lsas.length === 0) return;
    const lsu = this.ospfPacket<OspfLinkStateUpdate>(state, area, { type: "lsu", lsas });
    const exchange = this.newOspfExchange();
    this.emit("ospf.lsu-sent", { count: lsas.length, destination: neighbor.address, reason: "request" }, { device, port, exchange, pdu: lsu });
    this.unicastOspf(device, port, neighbor.address, lsu, exchange);
  }

  /** Mise à jour reçue (RFC 2328 §13) : instance plus récente installée et inondée ; doublon ou plus ancienne ignorée. */
  private onOspfLsu(device: RuntimeDevice, state: OspfState, iface: OspfInterfaceState, port: RuntimePort, neighbor: OspfNeighbor, lsu: OspfLinkStateUpdate, where: Where): void {
    if (!OSPF_SYNCING.has(neighbor.state)) {
      this.emit("ospf.ignored", { reason: "neighbor-state", from: neighbor.address, state: neighbor.state }, where);
      return;
    }
    let installed = 0;
    let duplicates = 0;
    let older = 0;
    const accepted: OspfLsa[] = [];
    const lsdb = this.lsdbOf(state, iface.area);
    for (const lsa of lsu.lsas) {
      const key = lsaKey(lsa);
      const stored = lsdb.get(key);
      const current = stored ? this.currentLsa(stored) : null;
      const comparison = current ? compareLsa(lsa, current) : lsa.age >= OSPF_MAX_AGE ? 0 : 1;
      // Une instance de nos propres LSA ne peut venir que de notre inondation : elle n'est jamais plus récente.
      if (comparison > 0 && lsa.advertisingRouter !== state.routerId) {
        installed += 1;
        accepted.push(lsa);
      } else if (comparison === 0) duplicates += 1;
      else older += 1;
      if (comparison >= 0) neighbor.requests.delete(key);
    }
    this.emit("ospf.lsu-received", { neighbor: neighbor.routerId, count: lsu.lsas.length, installed, duplicates, older }, where);
    for (const lsa of accepted) this.installLsa(device, state, lsa, { iface, neighbor });
    if (neighbor.state === "loading" && neighbor.requests.size === 0) {
      this.setNeighborState(device, port, neighbor, "full", "loading-done");
      this.updateOwnLsas(device, state);
    }
  }

  /** Âge courant d'un LSA de la base (s), plafonné à MaxAge. */
  private currentLsa(stored: StoredLsa): OspfLsa {
    const age = Math.min(OSPF_MAX_AGE, stored.lsa.age + Math.floor((this.clock - stored.installedAt) / 1e9));
    return age === stored.lsa.age ? stored.lsa : { ...stored.lsa, age };
  }

  /** Nouvelle instance reçue : inondée dans sa zone, installée (ou retirée si MaxAge), calcul SPF programmé. */
  private installLsa(device: RuntimeDevice, state: OspfState, lsa: OspfLsa, from: { readonly iface: OspfInterfaceState; readonly neighbor: OspfNeighbor }): void {
    const area = from.iface.area;
    const lsdb = this.lsdbOf(state, area);
    const key = lsaKey(lsa);
    const generation = (lsdb.get(key)?.generation ?? 0) + 1;
    const params = { lsaType: lsa.lsaType, lsId: lsa.lsId, advertisingRouter: lsa.advertisingRouter, sequence: lsa.sequence >>> 0, neighbor: from.neighbor.routerId, area };
    this.floodLsa(device, state, area, lsa, from);
    if (lsa.age >= OSPF_MAX_AGE) {
      lsdb.delete(key);
      this.emit("ospf.lsa-flushed", params, { device });
    } else {
      lsdb.set(key, { lsa, installedAt: this.clock, generation });
      this.emit("ospf.lsa-installed", { ...params, age: lsa.age }, { device });
      this.schedule(this.clock + fromSeconds(OSPF_MAX_AGE - lsa.age), { type: "ospf-lsa-timer", deviceId: device.id, area, key, stage: "max-age", generation }, true);
    }
    this.scheduleSpf(device, state);
  }

  /**
   * Inondation (RFC 2328 §13.3), limitée aux interfaces de la zone du LSA :
   * vers les voisins en état Exchange au moins (sauf celui qui l'a envoyé),
   * jamais en retour vers le DR ou le BDR qui l'a transmis, ni par le BDR sur
   * l'interface de réception ; vers AllSPFRouters depuis le DR ou le BDR,
   * AllDRouters sinon. Sans accusé de réception ni retransmission (le
   * simulateur ne perd pas de paquet).
   */
  private floodLsa(device: RuntimeDevice, state: OspfState, area: string, lsa: OspfLsa, from: { readonly iface: OspfInterfaceState; readonly neighbor: OspfNeighbor } | null): void {
    const key = lsaKey(lsa);
    for (const iface of state.interfaces.values()) {
      const port = this.ospfUsable(device, iface);
      if (!port || iface.mode !== "active" || iface.area !== area) continue;
      let eligible = 0;
      for (const neighbor of iface.neighbors.values()) {
        if (!OSPF_SYNCING.has(neighbor.state)) continue;
        const requested = neighbor.requests.get(key);
        if (requested && neighbor.state !== "full") {
          const comparison = compareLsa(lsa, requested);
          if (comparison < 0) continue;
          neighbor.requests.delete(key);
          if (comparison === 0) continue;
        }
        if (from && neighbor === from.neighbor) continue;
        eligible += 1;
      }
      if (eligible === 0) continue;
      if (from && iface === from.iface && (from.neighbor.address === iface.dr || from.neighbor.address === iface.bdr || iface.state === "backup")) continue;
      const destination = iface.state === "dr" || iface.state === "backup" ? OSPF_ALL_ROUTERS : OSPF_ALL_DROUTERS;
      const lsu = this.ospfPacket<OspfLinkStateUpdate>(state, area, { type: "lsu", lsas: [lsa] });
      const exchange = this.newOspfExchange();
      this.emit("ospf.lsu-sent", { count: 1, destination, reason: "flood" }, { device, port, exchange, pdu: lsu });
      this.multicastOspf(device, port, destination, lsu, exchange);
    }
  }

  /** Zones auxquelles le routeur est relié : au moins une interface OSPF en service. */
  private attachedAreas(device: RuntimeDevice, state: OspfState): Set<string> {
    const areas = new Set<string>();
    for (const iface of state.interfaces.values()) if (this.ospfUsable(device, iface)) areas.add(iface.area);
    return areas;
  }

  /**
   * LSA du routeur (RFC 2328 §12.4.1.2 et §12.4.2), un par zone : un lien de
   * transit vers chaque réseau de la zone où il est pleinement adjacent au DR
   * (ou DR avec un voisin plein), un lien terminal sinon (attente, interface
   * passive) ; bit B s'il est relié à plusieurs zones. LSA réseau de chaque
   * réseau dont il est DR avec au moins un voisin plein, retiré dès que ce
   * n'est plus le cas.
   */
  private updateOwnLsas(device: RuntimeDevice, state: OspfState): void {
    const abr = this.attachedAreas(device, state).size > 1;
    for (const area of state.lsdbs.keys()) {
      const links: OspfRouterLink[] = [];
      for (const iface of [...state.interfaces.values()].filter((item) => item.area === area).sort((a, b) => a.portId.localeCompare(b.portId))) {
        const port = this.ospfUsable(device, iface);
        if (!port?.ipv4) continue;
        const stub: OspfRouterLink = { type: "stub", linkId: formatIpv4(port.ipv4.network), linkData: prefixToMask(port.ipv4.prefixLength), metric: iface.cost };
        const full = [...iface.neighbors.values()].filter((neighbor) => neighbor.state === "full");
        const transit = iface.mode === "active" && ((iface.state === "dr" && full.length > 0) || full.some((neighbor) => neighbor.address === iface.dr));
        links.push(transit ? { type: "transit", linkId: iface.dr, linkData: port.ipv4.address, metric: iface.cost } : stub);
      }
      this.originate(device, state, area, { lsaType: "router", age: 0, lsId: state.routerId, advertisingRouter: state.routerId, sequence: 0, abr, links });
    }
    for (const iface of state.interfaces.values()) {
      const port = device.portById.get(iface.portId);
      if (!port?.ipv4) continue;
      const key = lsaKey({ lsaType: "network", lsId: port.ipv4.address, advertisingRouter: state.routerId });
      const full = [...iface.neighbors.values()].filter((neighbor) => neighbor.state === "full").map((neighbor) => neighbor.routerId);
      if (iface.mode === "active" && iface.state === "dr" && full.length > 0 && this.isUp(port)) {
        this.originate(device, state, iface.area, {
          lsaType: "network",
          age: 0,
          lsId: port.ipv4.address,
          advertisingRouter: state.routerId,
          sequence: 0,
          mask: prefixToMask(port.ipv4.prefixLength),
          attachedRouters: [state.routerId, ...full].sort(compareRouterIds),
        });
      } else if (this.lsdbOf(state, iface.area).has(key)) {
        this.flushOwnLsa(device, state, iface.area, key);
      }
    }
  }

  /** Nouvelle instance d'un LSA du routeur dans une zone, seulement si son contenu change (ou rafraîchissement à LSRefreshTime). */
  private originate(device: RuntimeDevice, state: OspfState, area: string, draft: OspfLsa, refresh = false): void {
    const lsdb = this.lsdbOf(state, area);
    const key = lsaKey(draft);
    const stored = lsdb.get(key);
    if (stored && !refresh && sameLsaContent(stored.lsa, draft)) return;
    const lsa: OspfLsa = { ...draft, age: 0, sequence: stored ? (stored.lsa.sequence + 1) | 0 : OSPF_INITIAL_SEQUENCE };
    const generation = (stored?.generation ?? 0) + 1;
    lsdb.set(key, { lsa, installedAt: this.clock, generation });
    const count = lsa.lsaType === "router" ? lsa.links.length : lsa.lsaType === "network" ? lsa.attachedRouters.length : 0;
    const summary = lsa.lsaType === "summary" ? { mask: lsa.mask, metric: lsa.metric } : {};
    this.emit("ospf.lsa-originated", { lsaType: lsa.lsaType, lsId: lsa.lsId, sequence: lsa.sequence >>> 0, count, refresh, area, ...summary }, { device });
    this.schedule(this.clock + fromSeconds(OSPF_LS_REFRESH_TIME), { type: "ospf-lsa-timer", deviceId: device.id, area, key, stage: "refresh", generation }, true);
    this.floodLsa(device, state, area, lsa, null);
    this.scheduleSpf(device, state);
  }

  /** Retrait d'un LSA du routeur (vieillissement prématuré, RFC 2328 §14.1) : inondé dans sa zone avec l'âge MaxAge. */
  private flushOwnLsa(device: RuntimeDevice, state: OspfState, area: string, key: string): void {
    const lsdb = this.lsdbOf(state, area);
    const stored = lsdb.get(key);
    if (!stored) return;
    const lsa: OspfLsa = { ...stored.lsa, age: OSPF_MAX_AGE };
    lsdb.delete(key);
    this.emit("ospf.lsa-flushed", { lsaType: lsa.lsaType, lsId: lsa.lsId, advertisingRouter: lsa.advertisingRouter, sequence: lsa.sequence >>> 0, neighbor: null, area }, { device });
    this.floodLsa(device, state, area, lsa, null);
    this.scheduleSpf(device, state);
  }

  private onOspfLsaTimer(deviceId: string, area: string, key: string, stage: "refresh" | "max-age", generation: number): void {
    const device = this.device(deviceId);
    const state = this.ospf.get(deviceId);
    const lsdb = state?.lsdbs.get(area);
    const stored = lsdb?.get(key);
    if (!state || !lsdb || stored?.generation !== generation) return;
    if (stage === "refresh") {
      this.originate(device, state, area, stored.lsa, true);
      return;
    }
    // Instance d'un autre routeur jamais rafraîchie : retirée à MaxAge et exclue du calcul.
    lsdb.delete(key);
    this.emit("ospf.lsa-expired", { lsaType: stored.lsa.lsaType, lsId: stored.lsa.lsId, advertisingRouter: stored.lsa.advertisingRouter, area }, { device });
    this.scheduleSpf(device, state);
  }

  private killNeighbor(device: RuntimeDevice, iface: OspfInterfaceState, port: RuntimePort, neighbor: OspfNeighbor, event: "inactivity" | "interface-down"): void {
    this.resetAdjacency(neighbor);
    neighbor.deadGeneration += 1;
    this.setNeighborState(device, port, neighbor, "down", event);
    iface.neighbors.delete(neighbor.routerId);
    if (event === "inactivity") this.triggerHello(device, iface);
  }

  /** Aucun Hello depuis 40 s (InactivityTimer) : voisin perdu, nouvelle élection. */
  private onOspfDead(deviceId: string, portId: string, routerId: string, generation: number): void {
    const device = this.device(deviceId);
    const state = this.ospf.get(deviceId);
    const iface = state?.interfaces.get(portId);
    const port = device.portById.get(portId);
    const neighbor = iface?.neighbors.get(routerId);
    if (!state || !iface || !port || neighbor?.deadGeneration !== generation) return;
    this.killNeighbor(device, iface, port, neighbor, "inactivity");
    if (iface.state !== "waiting" && iface.state !== "down") this.runElection(device, state, iface, port, "neighbor-change");
    else this.updateOwnLsas(device, state);
  }

  /** WaitTimer : fin de l'attente, élection. */
  private onOspfWait(deviceId: string, portId: string, generation: number): void {
    const device = this.device(deviceId);
    const state = this.ospf.get(deviceId);
    const iface = state?.interfaces.get(portId);
    const port = device.portById.get(portId);
    if (!state || !iface || !port || iface.waitGeneration !== generation || iface.state !== "waiting") return;
    this.runElection(device, state, iface, port, "wait-timer");
  }

  /** Calcul SPF regroupé : une fois par instant, après les changements de la base. */
  private scheduleSpf(device: RuntimeDevice, state: OspfState): void {
    this.dirtyDevices.add(device.id);
    if (state.spfPending) return;
    state.spfPending = true;
    this.schedule(this.clock, { type: "ospf-spf", deviceId: device.id });
  }

  /**
   * Calcul des routes (RFC 2328 §16) : plus courts chemins de chaque zone
   * (routes intra-zone), puis routes inter-zones d'après les résumés (§16.2 :
   * ceux de la dorsale pour un routeur de bordure, de sa zone sinon ; la route
   * intra-zone l'emporte toujours), enfin résumés d'un routeur de bordure.
   */
  private onOspfSpf(deviceId: string): void {
    const device = this.device(deviceId);
    const state = this.ospf.get(deviceId);
    if (!state) return;
    state.spfPending = false;
    const key = (route: { readonly destination: number; readonly prefixLength: number }) => `${formatIpv4(route.destination)}/${String(route.prefixLength)}`;
    const attached = this.attachedAreas(device, state);
    state.abr = attached.size > 1;
    const own = new Map<string, { readonly destination: number; readonly prefixLength: number; readonly cost: number; readonly area: string }>();
    for (const iface of state.interfaces.values()) {
      const port = this.ospfUsable(device, iface);
      if (port?.ipv4) own.set(key({ destination: port.ipv4.network, prefixLength: port.ipv4.prefixLength }), { destination: port.ipv4.network, prefixLength: port.ipv4.prefixLength, cost: iface.cost, area: iface.area });
    }
    const paths = new Map<string, ReturnType<typeof shortestPaths>>();
    const intra = new Map<string, OspfRoute>();
    let lsaCount = 0;
    for (const [area, lsdb] of state.lsdbs) {
      const lsas = [...lsdb.values()].map((stored) => this.currentLsa(stored));
      lsaCount += lsas.length;
      const result = shortestPaths(state.routerId, lsas);
      paths.set(area, result);
      for (const route of result.routes) {
        const current = intra.get(key(route));
        if (!current || route.cost < current.cost) intra.set(key(route), { ...route, inter: false, area, advertisingRouter: null });
      }
    }
    const inter = new Map<string, OspfRoute>();
    const summaryAreas = state.abr ? [OSPF_BACKBONE].filter((area) => attached.has(area)) : [...attached];
    for (const area of summaryAreas) {
      const routers = paths.get(area)?.routers;
      for (const stored of this.lsdbOf(state, area).values()) {
        const lsa = this.currentLsa(stored);
        if (lsa.lsaType !== "summary" || lsa.age >= OSPF_MAX_AGE || lsa.advertisingRouter === state.routerId) continue;
        const border = routers?.get(lsa.advertisingRouter);
        const prefixLength = parsePrefixOrMask(lsa.mask);
        const address = parseIpv4(lsa.lsId);
        if (!border || border.nextHop === null || prefixLength === null || address === null) continue;
        const route: OspfRoute = { destination: networkAddress(address, prefixLength), prefixLength, cost: border.cost + lsa.metric, nextHop: border.nextHop, via: border.via, inter: true, area, advertisingRouter: lsa.advertisingRouter };
        if (intra.has(key(route)) || own.has(key(route))) continue;
        const current = inter.get(key(route));
        if (!current || route.cost < current.cost) inter.set(key(route), route);
      }
    }
    const routes = [...intra.values(), ...inter.values()].sort((a, b) => a.destination - b.destination || a.prefixLength - b.prefixLength);
    const previous = new Map(state.routes.map((route) => [key(route), route]));
    const portOf = (route: SpfRoute) => device.ports.find((port) => port.ipv4?.address === route.via)?.portId ?? null;
    let changes = 0;
    for (const route of routes) {
      const before = previous.get(key(route));
      previous.delete(key(route));
      const params = {
        route: key(route),
        cost: route.cost,
        nextHop: route.nextHop === null ? null : formatIpv4(route.nextHop),
        outPort: portOf(route),
        inter: route.inter,
        advertisingRouter: route.advertisingRouter,
      };
      if (!before) {
        changes += 1;
        this.emit("ospf.route-added", params, { device });
      } else if (before.cost !== route.cost || before.nextHop !== route.nextHop || before.via !== route.via || before.inter !== route.inter) {
        changes += 1;
        this.emit("ospf.route-changed", { ...params, previousCost: before.cost, previousNextHop: before.nextHop === null ? null : formatIpv4(before.nextHop) }, { device });
      }
    }
    for (const [route, before] of previous) {
      changes += 1;
      this.emit("ospf.route-removed", { route, cost: before.cost, inter: before.inter }, { device });
    }
    state.routes = routes;
    this.dirtyDevices.add(deviceId);
    this.emit("ospf.spf", { lsas: lsaCount, routes: routes.length, changes, areas: state.lsdbs.size }, { device });
    this.updateSummaries(device, state, attached, own, intra, inter);
  }

  /**
   * Résumés d'un routeur de bordure (RFC 2328 §12.4.3) : dans chaque zone
   * reliée, un LSA de résumé par réseau des autres zones (routes intra-zone,
   * réseaux du routeur compris), plus, hors de la dorsale, les routes
   * inter-zones apprises de la dorsale ; jamais une route dans sa propre zone ;
   * coût = coût de la route. Un résumé devenu inutile est retiré.
   */
  private updateSummaries(
    device: RuntimeDevice,
    state: OspfState,
    attached: ReadonlySet<string>,
    own: ReadonlyMap<string, { readonly destination: number; readonly prefixLength: number; readonly cost: number; readonly area: string }>,
    intra: ReadonlyMap<string, OspfRoute>,
    inter: ReadonlyMap<string, OspfRoute>,
  ): void {
    for (const [area, lsdb] of state.lsdbs) {
      const desired = new Map<string, { readonly lsId: string; readonly mask: string; readonly metric: number }>();
      if (state.abr && attached.has(area)) {
        const add = (destination: number, prefixLength: number, cost: number) => {
          const id = formatIpv4(destination);
          const current = desired.get(id);
          if (!current || cost < current.metric) desired.set(id, { lsId: id, mask: prefixToMask(prefixLength), metric: cost });
        };
        const inThisArea = new Set([...own.entries(), ...intra.entries()].filter(([, item]) => item.area === area).map(([id]) => id));
        for (const [id, item] of own) if (item.area !== area && !inThisArea.has(id)) add(item.destination, item.prefixLength, item.cost);
        for (const [id, route] of intra) if (route.area !== area && !inThisArea.has(id)) add(route.destination, route.prefixLength, route.cost);
        if (area !== OSPF_BACKBONE) for (const [id, route] of inter) if (!inThisArea.has(id)) add(route.destination, route.prefixLength, route.cost);
      }
      for (const stored of [...lsdb.values()]) {
        if (stored.lsa.lsaType === "summary" && stored.lsa.advertisingRouter === state.routerId && !desired.has(stored.lsa.lsId)) this.flushOwnLsa(device, state, area, lsaKey(stored.lsa));
      }
      for (const item of desired.values()) {
        this.originate(device, state, area, { lsaType: "summary", age: 0, lsId: item.lsId, advertisingRouter: state.routerId, sequence: 0, mask: item.mask, metric: item.metric });
      }
    }
  }

  /** Routes OSPF calculées, dans la table de routage (préférence entre statique et RIP). */
  private ospfRoutes(device: RuntimeDevice): Route[] {
    const state = this.ospf.get(device.id);
    if (!state) return [];
    return state.routes.map((route) => {
      const port = device.ports.find((item) => item.ipv4?.address === route.via) ?? null;
      const up = port !== null && this.isUp(port);
      return {
        kind: route.inter ? "ospf-inter" : "ospf",
        destination: route.destination,
        prefixLength: route.prefixLength,
        nextHop: route.nextHop,
        port,
        active: up,
        reason: up ? null : "interface-down",
        metric: route.cost,
      };
    });
  }

  private ospfView(device: RuntimeDevice): OspfView | null {
    const state = this.ospf.get(device.id);
    if (!state) return null;
    return {
      routerId: state.routerId,
      abr: state.abr,
      areas: [...state.lsdbs.keys()],
      nextHelloAt: state.nextHelloAt,
      interfaces: [...state.interfaces.values()].map((iface) => {
        const port = device.portById.get(iface.portId);
        const routerOf = (address: string) => (port ? this.ospfRouterOf(state, iface, port, address) : null);
        return {
          portId: iface.portId,
          mode: iface.mode,
          cost: iface.cost,
          priority: iface.priority,
          area: iface.area,
          state: iface.state,
          dr: routerOf(iface.dr),
          bdr: routerOf(iface.bdr),
          neighbors: [...iface.neighbors.values()]
            .sort((a, b) => compareRouterIds(a.routerId, b.routerId))
            .map((neighbor) => ({
              routerId: neighbor.routerId,
              address: neighbor.address,
              priority: neighbor.priority,
              state: neighbor.state,
              role: neighbor.address === iface.dr ? ("dr" as const) : neighbor.address === iface.bdr ? ("bdr" as const) : ("other" as const),
              deadAt: neighbor.deadAt,
              requests: neighbor.requests.size,
            })),
        };
      }),
      lsdb: [...state.lsdbs.entries()].flatMap(([area, lsdb]) =>
        [...lsdb.values()]
          .map((stored) => this.currentLsa(stored))
          .sort(compareLsaKeys)
          .map((lsa) => ({
            area,
            lsaType: lsa.lsaType,
            lsId: lsa.lsId,
            advertisingRouter: lsa.advertisingRouter,
            sequence: lsa.sequence >>> 0,
            age: lsa.age,
            abr: lsa.lsaType === "router" ? lsa.abr : false,
            links: lsa.lsaType === "router" ? lsa.links : [],
            mask: lsa.lsaType === "router" ? null : lsa.mask,
            metric: lsa.lsaType === "summary" ? lsa.metric : null,
            attachedRouters: lsa.lsaType === "network" ? lsa.attachedRouters : [],
          })),
      ),
    };
  }

  // ---------------------------------------------------------------- Application ping

  private findSession(deviceId: string, identifier: number): PingSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.deviceId === deviceId && session.started && !session.done && session.identifier === identifier) return session;
    }
    return undefined;
  }

  private sendEcho(session: PingSession): void {
    const device = this.device(session.deviceId);
    const sequence = session.attempts.length + 1;
    const exchange = `${session.id}#${String(sequence)}`;
    const attempt: PingAttempt = {
      sequence,
      status: "pending",
      sentAt: this.clock,
      timeoutSeq: -1,
      rtt: null,
      ttl: null,
      from: null,
      errorType: null,
      errorCode: null,
      failure: null,
    };
    session.attempts.push(attempt);
    this.dirtyPings.add(session.id);
    this.emit("ping.send", { sequence, identifier: session.identifier, destination: session.destination }, { device, exchange });
    if (sequence < session.count) this.schedule(this.clock + PING_DEFAULTS.interval, { type: "ping-send", sessionId: session.id });
    const draft: PacketDraft = {
      source: null,
      destination: session.address ?? session.destination,
      ttl: this.initialTtl(device),
      payload: { kind: "icmp", type: "echo-request", identifier: session.identifier, sequence, dataLength: PING_DEFAULTS.dataLength },
    };
    this.sendLocal(device, draft, { kind: "ping", sessionId: session.id, sequence }, exchange);
    if (attempt.status === "pending") {
      attempt.timeoutSeq = this.schedule(this.clock + PING_DEFAULTS.timeout, { type: "ping-timeout", sessionId: session.id, sequence });
    }
  }

  private onEchoReply(device: RuntimeDevice, packet: Ipv4Packet, identifier: number, sequence: number, exchange: string | null): void {
    const session = this.findSession(device.id, identifier);
    const attempt = session?.attempts[sequence - 1];
    if (!session || !attempt) {
      this.emit("icmp.unmatched-reply", { identifier, sequence, from: packet.source }, { device, exchange, pdu: packet });
      return;
    }
    if (attempt.status !== "pending") {
      this.emit("ping.late-reply", { sequence, from: packet.source }, { device, exchange, pdu: packet });
      return;
    }
    attempt.status = "reply";
    attempt.rtt = this.clock - attempt.sentAt;
    attempt.ttl = packet.ttl;
    attempt.from = packet.source;
    this.cancel(attempt.timeoutSeq);
    this.dirtyPings.add(session.id);
    this.emit("ping.reply", { sequence, from: packet.source, ttl: packet.ttl, rtt: attempt.rtt }, { device, exchange, pdu: packet });
    this.checkDone(session);
  }

  private pingFailed(sessionId: string, sequence: number, failure: PingFailure): void {
    const session = this.sessions.get(sessionId);
    const attempt = session?.attempts[sequence - 1];
    if (!session || attempt?.status !== "pending") return;
    attempt.status = "failed";
    attempt.failure = failure;
    this.cancel(attempt.timeoutSeq);
    this.dirtyPings.add(session.id);
    this.emit("ping.failed", { sequence, reason: failure }, { device: this.device(session.deviceId), exchange: `${session.id}#${String(sequence)}` });
    this.checkDone(session);
  }

  private onPingTimeout(sessionId: string, sequence: number): void {
    const session = this.sessions.get(sessionId);
    const attempt = session?.attempts[sequence - 1];
    if (!session || attempt?.status !== "pending") return;
    attempt.status = "timeout";
    this.dirtyPings.add(session.id);
    this.emit("ping.timeout", { sequence, waited: PING_DEFAULTS.timeout }, {
      device: this.device(session.deviceId),
      exchange: `${session.id}#${String(sequence)}`,
    });
    this.checkDone(session);
  }

  private checkDone(session: PingSession): void {
    if (session.done || session.attempts.length < session.count) return;
    if (session.attempts.some((attempt) => attempt.status === "pending")) return;
    session.done = true;
    this.dirtyPings.add(session.id);
    const rtts = session.attempts.flatMap((attempt) => (attempt.rtt === null ? [] : [attempt.rtt]));
    const received = rtts.length;
    this.emit(
      "ping.done",
      {
        destination: session.destination,
        sent: session.count,
        received,
        lost: session.count - received,
        minRtt: received ? Math.min(...rtts) : null,
        maxRtt: received ? Math.max(...rtts) : null,
        avgRtt: received ? Math.round(rtts.reduce((sum, value) => sum + value, 0) / received) : null,
      },
      { device: this.device(session.deviceId), exchange: session.id },
    );
  }

  // ---------------------------------------------------------------- Vues

  private stpView(device: RuntimeDevice): DeviceView["stp"] {
    if (device.kind !== "switch" || !device.stp) return null;
    const own = bridgeIdOf({ ...device, stp: { ...device.stp, enabled: true } });
    const bridge = this.tree.bridges.get(device.id);
    return {
      enabled: device.stp.enabled,
      bridgeId: own ? formatBridgeId(own) : "",
      rootBridgeId: bridge ? formatBridgeId(bridge.root) : null,
      rootDeviceId: bridge?.rootDeviceId ?? null,
      rootCost: bridge?.rootCost ?? 0,
      rootPort: bridge?.rootPort ?? null,
      ports: device.ports.flatMap((port) => {
        const stp = this.stpPorts.get(stpPortKey(device.id, port.portId));
        return stp ? [{ portId: port.portId, role: stp.role, state: stp.state, cost: stp.cost }] : [];
      }),
    };
  }

  private dhcpClientView(device: RuntimeDevice): DeviceView["dhcpClient"] {
    const client = [...this.dhcpClients.values()].find((item) => item.deviceId === device.id);
    if (!client) return null;
    const lease = client.lease;
    return {
      portId: client.portId,
      phase: client.phase,
      attempts: client.attempts,
      lease: lease && {
        address: lease.address,
        prefixLength: lease.prefixLength,
        gateway: lease.gateway,
        server: lease.server,
        leaseSeconds: lease.leaseSeconds,
        obtainedAt: lease.obtainedAt,
        renewAt: lease.renewAt,
        rebindAt: lease.rebindAt,
        expiresAt: lease.expiresAt,
      },
    };
  }

  private dhcpServerView(device: RuntimeDevice, state: DeviceState): DeviceView["dhcpServer"] {
    if (device.dhcpPools.size === 0) return null;
    const leases = [...state.dhcpLeases.values()];
    return {
      pools: [...device.dhcpPools.entries()].map(([portId, pool]) => ({
        portId,
        start: formatIpv4(pool.start),
        end: formatIpv4(pool.end),
        gateway: pool.gateway,
        leaseSeconds: pool.leaseSeconds,
        size: pool.end - pool.start + 1,
        used: leases.filter((lease) => lease.portId === portId).length,
      })),
      leases: leases
        .map((lease) => ({ address: lease.address, mac: lease.mac, portId: lease.portId, state: lease.state, expiresAt: lease.expiresAt }))
        .sort((a, b) => (parseIpv4(a.address) ?? 0) - (parseIpv4(b.address) ?? 0)),
    };
  }

  private deviceView(device: RuntimeDevice): DeviceView {
    const state = this.state(device.id);
    const aging = this.parameters.macAgingTime;
    const lifetime = this.arpLifetime(device);
    return {
      deviceId: device.id,
      name: device.name,
      kind: device.kind,
      interfaces: device.ports.map((port) => ({
        portId: port.portId,
        mac: port.mac,
        ipv4: port.ipv4 ? `${port.ipv4.address}/${String(port.ipv4.prefixLength)}` : null,
        linkId: port.linkId,
        up: this.isUp(port),
        vlan: port.vlan,
        dhcp: port.dhcp,
      })),
      macTable: [...state.macTable.values()]
        .map((entry) => ({ vlan: entry.vlan, mac: entry.mac, portId: entry.portId, updatedAt: entry.updatedAt, expiresAt: entry.updatedAt + aging }))
        .sort((a, b) => a.vlan - b.vlan || (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0)),
      arpCache: [...state.arp.values()]
        .map((entry) => ({ ip: entry.ip, mac: entry.mac, portId: entry.portId, expiresAt: entry.updatedAt + lifetime }))
        .sort((a, b) => a.portId.localeCompare(b.portId) || (parseIpv4(a.ip) ?? 0) - (parseIpv4(b.ip) ?? 0)),
      pendingArp: [...state.pending.values()].map((pending) => ({
        ip: pending.ip,
        portId: pending.portId,
        attempts: pending.attempts,
        queued: pending.queue.length,
      })),
      stp: this.stpView(device),
      dhcpClient: this.dhcpClientView(device),
      dhcpServer: this.dhcpServerView(device, state),
      dnsServer: device.dnsRecords
        ? {
            records: [...device.dnsRecords.entries()]
              .map(([name, address]) => ({ name, address }))
              .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
            answered: state.dnsAnswered,
            nameErrors: state.dnsNameErrors,
          }
        : null,
      rip: this.ripView(device),
      ospf: this.ospfView(device),
      vrrp: this.vrrpView(device),
      routes:
        device.kind === "switch"
          ? []
          : this.routes(device).map((route) => ({
              kind: route.kind,
              destination: formatIpv4(route.destination),
              prefixLength: route.prefixLength,
              nextHop: route.nextHop === null ? null : formatIpv4(route.nextHop),
              portId: route.port?.portId ?? null,
              active: route.active,
              reason: route.reason,
              metric: route.metric,
            })),
    };
  }
}

/** Offre ou accusé de réception complet (adresse, masque, serveur, bail) ; le bail en cours complète un ACK partiel. */
function offerOf(message: DhcpMessage, current: DhcpOffer | null = null): DhcpOffer | null {
  const { subnetMask, serverId, leaseSeconds, router } = message.options;
  const prefixLength = subnetMask === null ? (current?.prefixLength ?? null) : parsePrefixOrMask(subnetMask);
  const server = serverId ?? current?.server ?? null;
  const seconds = leaseSeconds ?? current?.leaseSeconds ?? null;
  if (message.yourIp === UNSPECIFIED_ADDRESS || prefixLength === null || server === null || seconds === null) return null;
  return { address: message.yourIp, prefixLength, gateway: router ?? (subnetMask === null ? (current?.gateway ?? null) : null), server, leaseSeconds: seconds };
}

function reject(code: CommandErrorCode, params: TraceParams): CommandOutcome {
  return { ok: false, code, params };
}

function routeParams(route: Route, destination: number): TraceParams {
  return {
    destination: formatIpv4(destination),
    route: routeCidr(route),
    routeKind: route.kind,
    nextHop: route.nextHop === null ? null : formatIpv4(route.nextHop),
    outPort: route.port?.portId ?? null,
  };
}

function pingView(session: PingSession): PingView {
  return {
    id: session.id,
    deviceId: session.deviceId,
    destination: session.destination,
    address: session.address,
    resolution: session.resolution,
    count: session.count,
    identifier: session.identifier,
    done: session.done,
    attempts: session.attempts.map(
      (attempt): PingAttemptView => ({
        sequence: attempt.sequence,
        status: attempt.status,
        sentAt: attempt.sentAt,
        rtt: attempt.rtt,
        ttl: attempt.ttl,
        from: attempt.from,
        errorType: attempt.errorType,
        errorCode: attempt.errorCode,
        failure: attempt.failure,
      }),
    ),
  };
}

function lookupView(query: DnsQuery): DnsLookupView {
  return {
    id: query.id,
    deviceId: query.deviceId,
    name: query.name,
    server: query.server,
    status: query.status,
    address: query.address,
    ttl: query.ttl,
    attempts: query.attempts,
  };
}
