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
import { BROADCAST_MAC, isGroupMac, multicastMac, type MacAddress } from "./mac.js";
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
  type Pdu,
  type RipEntry,
  type RipMessage,
  type UdpDatagram,
} from "./pdu.js";
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
  PingAttemptView,
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
  | { readonly type: "rip-timer"; readonly deviceId: string; readonly key: string; readonly stage: "timeout" | "garbage"; readonly generation: number };

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
    return routingTable(device, this.isUp, this.ripRoutes(device));
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
    if (frame.destination !== logical.mac && frame.destination !== BROADCAST_MAC && !this.joinsGroup(device, logical, frame.destination)) {
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
    if (packet.destination === RIP_MULTICAST) {
      if (packet.payload.kind === "udp") this.onUdp(device, port, packet, packet.payload, exchange);
      else this.emit("ip.broadcast-dropped", { destination: packet.destination }, where);
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
    if (message.kind === "udp") return;
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
    return device.kind === "router" && mac === multicastMac(parseIpv4(RIP_MULTICAST) ?? 0) && device.ripInterfaces.get(port.portId) === "active";
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
