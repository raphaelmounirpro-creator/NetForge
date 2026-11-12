import type { DeviceKind } from "@netforge/project";
import type { MacAddress } from "./mac.js";
import type { IcmpError } from "./pdu.js";
import type { InactiveReason, RouteKind } from "./routing.js";
import type { Diagnostic } from "./trace.js";
import type { SimTime } from "./time.js";

/**
 * Projections observables de l'état d'exécution. L'interface les affiche
 * telles quelles : elle n'en déduit jamais un résultat réseau.
 */
export interface InterfaceView {
  readonly portId: string;
  readonly mac: MacAddress;
  /** Notation CIDR (« 192.168.1.10/24 ») ou null. */
  readonly ipv4: string | null;
  readonly linkId: string | null;
  readonly up: boolean;
  /** Sous-interface 802.1Q : VLAN encapsulé (null pour un port physique). */
  readonly vlan: number | null;
  /** Adressage automatique : l'adresse affichée vient d'un bail DHCP. */
  readonly dhcp: boolean;
}

export interface MacEntryView {
  /** VLAN de l'entrée : un switch tient une table par VLAN. */
  readonly vlan: number;
  readonly mac: MacAddress;
  readonly portId: string;
  readonly updatedAt: SimTime;
  readonly expiresAt: SimTime;
}

export interface ArpEntryView {
  readonly ip: string;
  readonly mac: MacAddress;
  readonly portId: string;
  readonly expiresAt: SimTime;
}

export interface PendingArpView {
  readonly ip: string;
  readonly portId: string;
  readonly attempts: number;
  readonly queued: number;
}

export interface RouteView {
  readonly kind: RouteKind;
  readonly destination: string;
  readonly prefixLength: number;
  readonly nextHop: string | null;
  readonly portId: string | null;
  readonly active: boolean;
  readonly reason: InactiveReason | null;
}

export interface StpPortView {
  readonly portId: string;
  readonly role: "root" | "designated" | "alternate" | "disabled";
  readonly state: "blocking" | "listening" | "learning" | "forwarding" | "disabled";
  readonly cost: number;
}

/** Spanning Tree d'un switch : son pont, la racine élue, son port racine et l'état de chaque port. */
export interface StpView {
  readonly enabled: boolean;
  /** « priorité.MAC » (identifiant de pont 802.1D). */
  readonly bridgeId: string;
  readonly rootBridgeId: string | null;
  readonly rootDeviceId: string | null;
  readonly rootCost: number;
  readonly rootPort: string | null;
  readonly ports: readonly StpPortView[];
}

/**
 * États du client DHCP (RFC 2131 §4.4) : « selecting » attend une offre,
 * « requesting » l'accusé de réception ; « bound » : bail en cours ;
 * « renewing » (T1) et « rebinding » (T2) : prolongation demandée ;
 * « released » : bail libéré par l'utilisateur ; « failed » : abandon faute de réponse.
 */
export type DhcpClientPhase = "init" | "selecting" | "requesting" | "bound" | "renewing" | "rebinding" | "released" | "failed";

export interface DhcpClientView {
  readonly portId: string;
  readonly phase: DhcpClientPhase;
  /** Émissions du message en cours (DISCOVER ou REQUEST). */
  readonly attempts: number;
  /** Bail obtenu (null sans bail). */
  readonly lease: {
    readonly address: string;
    readonly prefixLength: number;
    readonly gateway: string | null;
    readonly server: string;
    readonly leaseSeconds: number;
    readonly obtainedAt: SimTime;
    /** T1 (renouvellement), T2 (nouvelle demande diffusée) et fin du bail. */
    readonly renewAt: SimTime;
    readonly rebindAt: SimTime;
    readonly expiresAt: SimTime;
  } | null;
}

export interface DhcpPoolView {
  readonly portId: string;
  readonly start: string;
  readonly end: string;
  readonly gateway: string;
  readonly leaseSeconds: number;
  readonly size: number;
  /** Adresses offertes ou attribuées. */
  readonly used: number;
}

export interface DhcpLeaseView {
  readonly address: string;
  readonly mac: MacAddress;
  readonly portId: string;
  /** « offered » : réservée par une offre en attente de la demande du client. */
  readonly state: "offered" | "bound";
  readonly expiresAt: SimTime | null;
}

export interface DhcpServerView {
  readonly pools: readonly DhcpPoolView[];
  /** Baux triés par adresse. */
  readonly leases: readonly DhcpLeaseView[];
}

export interface DeviceView {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly interfaces: readonly InterfaceView[];
  /** Table MAC (switch uniquement), triée par VLAN puis adresse. */
  readonly macTable: readonly MacEntryView[];
  /** Cache ARP (PC et routeur), trié par port puis adresse. */
  readonly arpCache: readonly ArpEntryView[];
  readonly pendingArp: readonly PendingArpView[];
  /** Table de routage (PC et routeur), routes inactives comprises. */
  readonly routes: readonly RouteView[];
  /** Spanning Tree (switch uniquement). */
  readonly stp: StpView | null;
  /** Client DHCP (PC en adressage automatique). */
  readonly dhcpClient: DhcpClientView | null;
  /** Serveur DHCP (routeur ayant au moins une plage). */
  readonly dhcpServer: DhcpServerView | null;
}

export type PingFailure = "no-address" | "no-route" | "host-unreachable" | "queue-full";
export type PingStatus = "pending" | "reply" | "timeout" | "error" | "failed";

export interface PingAttemptView {
  readonly sequence: number;
  readonly status: PingStatus;
  readonly sentAt: SimTime;
  /** Aller-retour mesuré en temps simulé (réponse reçue uniquement). */
  readonly rtt: SimTime | null;
  readonly ttl: number | null;
  /** Adresse qui a répondu ou signalé l'erreur. */
  readonly from: string | null;
  readonly errorType: IcmpError["type"] | null;
  readonly errorCode: number | null;
  readonly failure: PingFailure | null;
}

export interface PingView {
  readonly id: string;
  readonly deviceId: string;
  readonly destination: string;
  readonly count: number;
  readonly identifier: number;
  readonly done: boolean;
  readonly attempts: readonly PingAttemptView[];
}

export interface LinkView {
  readonly linkId: string;
  readonly up: boolean;
}

export type SimulationStatus = "ready" | "interrupted";

export interface SimulationSnapshot {
  readonly time: SimTime;
  readonly status: SimulationStatus;
  readonly diagnostic: Diagnostic | null;
  readonly processedEvents: number;
  readonly pendingEvents: number;
  /** Vrai tant que des échanges restent à calculer (hors simples temporisations d'expiration). */
  readonly activity: boolean;
  readonly devices: readonly DeviceView[];
  readonly pings: readonly PingView[];
  readonly links: readonly LinkView[];
}

/** Changements depuis le dernier relevé : seuls les éléments modifiés sont transmis. */
export interface SimulationChanges {
  readonly devices: readonly DeviceView[];
  readonly pings: readonly PingView[];
  readonly links: readonly LinkView[];
}
