import { carriesVlan, DEFAULT_SWITCHPORT, formatIpv4, parseIpv4, unassignableReason, validateDocument, type Issue, type NfgDocument } from "@netforge/project";
import type { CommandErrorCode, CommandOutcome, SimCommand } from "./commands.js";
import { BROADCAST_MAC, type MacAddress } from "./mac.js";
import { buildNetwork, isPortUp, peerOf, type RuntimeDevice, type RuntimeNetwork, type RuntimePort } from "./network.js";
import { DEFAULT_PARAMETERS, PING_DEFAULTS, type SimulationLimits, type SimulationParameters } from "./parameters.js";
import {
  ETHERNET_WIRE_OVERHEAD_BYTES,
  ZERO_MAC,
  frameBytes,
  isIcmpError,
  type ArpPacket,
  type EthernetFrame,
  type IcmpError,
  type IcmpMessage,
  type Ipv4Packet,
  type Pdu,
} from "./pdu.js";
import { Prng } from "./prng.js";
import { EventQueue } from "./queue.js";
import { lookup, routeCidr, routingTable, type Route } from "./routing.js";
import { MAX_SIM_TIME, type SimTime } from "./time.js";
import type { Diagnostic, TraceCode, TraceEntry, TraceParams } from "./trace.js";
import type {
  DeviceView,
  LinkView,
  PingAttemptView,
  PingFailure,
  PingStatus,
  PingView,
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
  | { readonly type: "arp-expiry"; readonly deviceId: string; readonly key: string }
  | { readonly type: "arp-retry"; readonly deviceId: string; readonly key: string }
  | { readonly type: "ping-send"; readonly sessionId: string }
  | { readonly type: "ping-timeout"; readonly sessionId: string; readonly sequence: number };

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
  | { readonly kind: "forwarded" };

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

interface DeviceState {
  readonly macTable: Map<string, MacEntry>;
  readonly macTimers: Set<string>;
  readonly arp: Map<string, ArpEntry>;
  readonly arpTimers: Set<string>;
  readonly pending: Map<string, PendingResolution>;
  nextIdentification: number;
}

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
  readonly destination: string;
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
  readonly payload: IcmpMessage;
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
        nextIdentification: this.prng.nextInt(0x10000),
      });
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
    if (device.kind !== "pc") return reject("command.not-a-pc", { deviceId: device.id, deviceName: device.name });
    const destination = command.destination.trim();
    const invalid = this.invalidDestination(device, destination);
    if (invalid) return reject("command.invalid-destination", { destination, reason: invalid });
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
    const links: LinkView[] = [];
    for (const id of this.dirtyLinks) {
      const link = this.network.links.get(id);
      if (link) links.push({ linkId: link.id, up: link.up });
    }
    this.dirtyDevices.clear();
    this.dirtyPings.clear();
    this.dirtyLinks.clear();
    return { devices, pings, links };
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
    return routingTable(device, this.isUp);
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
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) return;
    const device = this.device(session.deviceId);
    session.identifier = this.drawIdentifier(session);
    session.started = true;
    this.emit("command.ping", { destination: session.destination, count: session.count, identifier: session.identifier }, {
      device,
      exchange: session.id,
    });
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
      if (vlan !== null) this.switchFrame(device, port, frame, exchange, vlan);
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
    if (frame.destination !== logical.mac && frame.destination !== BROADCAST_MAC) {
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
    code: "switch.flood-broadcast" | "switch.flood-unknown",
  ): void {
    // Diffusion limitée au VLAN : ports actifs qui le transportent, sauf le port d'entrée.
    const outPorts = device.ports.filter((port) => port !== ingress && this.isUp(port) && (port.switchport === null || carriesVlan(port.switchport, vlan)));
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
    if (!port.ipv4) {
      this.emit("arp.no-address", { targetIp: arp.targetIp }, where);
      return;
    }
    const state = this.state(device.id);
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
    if (this.ownsAddress(device, destination)) {
      this.emit("ip.local", { destination: packet.destination }, where);
      this.deliverLocal(device, packet, exchange);
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
    } else if (origin.kind === "forwarded" && failure === "host-unreachable" && packet) {
      this.sendIcmpError(device, packet, "destination-unreachable", 1, exchange);
    }
  }

  // ---------------------------------------------------------------- ICMP

  private deliverLocal(device: RuntimeDevice, packet: Ipv4Packet, exchange: string | null): void {
    const message = packet.payload;
    const where = { device, exchange, pdu: packet };
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
      destination: session.destination,
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
            })),
    };
  }
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
