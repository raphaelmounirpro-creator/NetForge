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
  /** Métrique RIP ou coût OSPF (null : route connectée ou configurée). */
  readonly metric: number | null;
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

/** Service DNS d'un routeur : enregistrements publiés et réponses données depuis le chargement. */
export interface DnsServerView {
  /** Enregistrements A triés par nom. */
  readonly records: ReadonlyArray<{ readonly name: string; readonly address: string }>;
  readonly answered: number;
  readonly nameErrors: number;
}

/**
 * Issue d'une résolution DNS : « pending » en attente de réponse ;
 * « resolved » adresse obtenue ; « name-error » nom inexistant (NXDOMAIN) ;
 * « timeout » aucune réponse après les retransmissions ; « no-server »
 * aucun serveur DNS configuré ; « no-address » et « no-route » question
 * impossible à émettre.
 */
export type DnsLookupStatus = "pending" | "resolved" | "name-error" | "timeout" | "no-server" | "no-address" | "no-route";

/** Résolution demandée par nslookup. */
export interface DnsLookupView {
  readonly id: string;
  readonly deviceId: string;
  readonly name: string;
  /** Serveur interrogé (null sans serveur configuré). */
  readonly server: string | null;
  readonly status: DnsLookupStatus;
  readonly address: string | null;
  readonly ttl: number | null;
  /** Questions émises. */
  readonly attempts: number;
}

/** Entrée de la table RIP : réseau local (annoncé), route apprise valide, ou en cours de suppression. */
export interface RipRouteView {
  readonly destination: string;
  readonly prefixLength: number;
  readonly nextHop: string | null;
  readonly portId: string;
  readonly metric: number;
  readonly state: "local" | "valid" | "deleting";
  /** Expiration sans nouvelle annonce (route apprise valide). */
  readonly expiresAt: SimTime | null;
  /** Suppression définitive (route inaccessible, métrique 16). */
  readonly garbageAt: SimTime | null;
}

/** RIP d'un routeur : interfaces participantes, table RIP et prochaine annonce périodique. */
export interface RipView {
  readonly interfaces: ReadonlyArray<{ readonly portId: string; readonly mode: "active" | "passive"; readonly up: boolean }>;
  readonly routes: readonly RipRouteView[];
  readonly nextUpdateAt: SimTime;
}

/** États d'une interface OSPF (RFC 2328 §9.1) ; « passive » : réseau décrit, sans paquet OSPF. */
export type OspfInterfaceStateView = "down" | "passive" | "waiting" | "dr-other" | "backup" | "dr";
/** États d'un voisin OSPF (RFC 2328 §10.1), état Down exclu (voisin retiré). */
export type OspfNeighborStateView = "init" | "2-way" | "exstart" | "exchange" | "loading" | "full";

export interface OspfNeighborView {
  readonly routerId: string;
  readonly address: string;
  readonly priority: number;
  readonly state: OspfNeighborStateView;
  /** Rôle déclaré sur ce réseau d'après l'élection du routeur. */
  readonly role: "dr" | "bdr" | "other";
  /** Voisin perdu sans nouveau Hello avant cet instant. */
  readonly deadAt: SimTime;
  /** LSA encore demandés (état Loading). */
  readonly requests: number;
}

export interface OspfInterfaceView {
  readonly portId: string;
  readonly mode: "active" | "passive";
  readonly cost: number;
  readonly priority: number;
  /** Zone de l'interface (« 0.0.0.0 » : dorsale). */
  readonly area: string;
  readonly state: OspfInterfaceStateView;
  /** DR et BDR élus : identifiant de routeur (null : aucun). */
  readonly dr: string | null;
  readonly bdr: string | null;
  readonly neighbors: readonly OspfNeighborView[];
}

export interface OspfLsaView {
  /** Zone de la base qui contient ce LSA. */
  readonly area: string;
  readonly lsaType: "router" | "network" | "summary";
  readonly lsId: string;
  readonly advertisingRouter: string;
  /** Numéro de séquence non signé (0x80000001 pour la première instance). */
  readonly sequence: number;
  readonly age: number;
  /** LSA routeur : liens décrits ; vide pour un LSA réseau. */
  readonly links: ReadonlyArray<{ readonly type: "transit" | "stub"; readonly linkId: string; readonly linkData: string; readonly metric: number }>;
  /** LSA routeur : bit B (routeur de bordure). */
  readonly abr: boolean;
  /** LSA réseau ou résumé : masque ; null pour un LSA routeur. */
  readonly mask: string | null;
  /** LSA de résumé : coût annoncé ; null sinon. */
  readonly metric: number | null;
  readonly attachedRouters: readonly string[];
}

/** OSPF d'un routeur : identifiant, interfaces et voisins, bases d'états des liens par zone (triées par type, identifiant, annonceur). */
export interface OspfView {
  readonly routerId: string;
  /** Routeur de bordure : relié à plusieurs zones. */
  readonly abr: boolean;
  /** Zones configurées sur ses interfaces, dans l'ordre. */
  readonly areas: readonly string[];
  readonly interfaces: readonly OspfInterfaceView[];
  readonly lsdb: readonly OspfLsaView[];
  readonly nextHelloAt: SimTime;
}

/** États d'un routeur VRRP (RFC 5798 §6.4) : initialisation (interface hors service), secours, maître. */
export type VrrpStateView = "initialize" | "backup" | "master";

export interface VrrpGroupView {
  readonly portId: string;
  readonly vrid: number;
  readonly address: string;
  readonly virtualMac: MacAddress;
  /** Priorité effective : 255 pour le propriétaire de l'adresse virtuelle. */
  readonly priority: number;
  readonly owner: boolean;
  readonly preempt: boolean;
  readonly state: VrrpStateView;
  /** Adresse principale du maître connu (lui-même s'il est maître) ; null avant la première annonce. */
  readonly master: string | null;
  /** Secours : bascule si aucune annonce n'arrive avant cet instant. */
  readonly downAt: SimTime | null;
  /** Maître : prochaine annonce. */
  readonly nextAdvertAt: SimTime | null;
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
  /** Service DNS (routeur dont le service est activé). */
  readonly dnsServer: DnsServerView | null;
  /** RIP (routeur ayant au moins une interface RIP). */
  readonly rip: RipView | null;
  /** OSPF (routeur ayant au moins une interface OSPF adressée). */
  readonly ospf: OspfView | null;
  /** VRRP (routeur ayant au moins un groupe). */
  readonly vrrp: readonly VrrpGroupView[] | null;
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
  /** Destination demandée : adresse IPv4 ou nom d'hôte (forme canonique). */
  readonly destination: string;
  /** Adresse visée : la destination, ou l'adresse obtenue par DNS (null avant la résolution). */
  readonly address: string | null;
  /** Résolution du nom (null quand la destination est une adresse). */
  readonly resolution: DnsLookupStatus | null;
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
  readonly lookups: readonly DnsLookupView[];
  readonly links: readonly LinkView[];
}

/** Changements depuis le dernier relevé : seuls les éléments modifiés sont transmis. */
export interface SimulationChanges {
  readonly devices: readonly DeviceView[];
  readonly pings: readonly PingView[];
  readonly lookups: readonly DnsLookupView[];
  readonly links: readonly LinkView[];
}
