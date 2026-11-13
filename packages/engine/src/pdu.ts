import type { MacAddress } from "./mac.js";

/**
 * Unités de données réellement modélisées, en unions discriminées qui
 * suivent l'encapsulation : Ethernet transporte ARP ou IPv4 ; IPv4
 * transporte ICMP ou UDP ; UDP transporte DHCP, DNS ou RIP. Seuls ces champs existent ;
 * aucun octet n'est inventé.
 * Les adresses IPv4 sont en notation décimale pointée.
 */

export interface ArpPacket {
  readonly kind: "arp";
  readonly operation: "request" | "reply";
  readonly senderMac: MacAddress;
  readonly senderIp: string;
  /** 00:00:00:00:00:00 dans une requête (adresse cherchée). */
  readonly targetMac: MacAddress;
  readonly targetIp: string;
}

export interface IcmpEcho {
  readonly kind: "icmp";
  readonly type: "echo-request" | "echo-reply";
  readonly identifier: number;
  readonly sequence: number;
  /** Octets de données transportés (contenu non modélisé). */
  readonly dataLength: number;
}

/** En-tête IP et 8 premiers octets du datagramme fautif, recopiés dans l'erreur ICMP. */
export interface QuotedDatagram {
  readonly source: string;
  readonly destination: string;
  readonly ttl: number;
  readonly identification: number;
  readonly echo: Pick<IcmpEcho, "type" | "identifier" | "sequence">;
}

export interface IcmpError {
  readonly kind: "icmp";
  readonly type: "destination-unreachable" | "time-exceeded";
  /** Destination inaccessible : 0 réseau, 1 hôte. Temps dépassé : 0 TTL en transit (RFC 792). */
  readonly code: number;
  readonly original: QuotedDatagram;
}

export type IcmpMessage = IcmpEcho | IcmpError;

/** Type de message DHCP (option 53, RFC 2132 §9.6) : 1 DISCOVER, 2 OFFER, 3 REQUEST, 5 ACK, 6 NAK, 7 RELEASE. */
export type DhcpMessageType = "discover" | "offer" | "request" | "ack" | "nak" | "release";

/**
 * Message DHCP (RFC 2131) : champs fixes utiles (xid, drapeau BROADCAST,
 * ciaddr, yiaddr, chaddr) et options modélisées (RFC 2132). L'opération
 * BOOTP (1 requête du client, 2 réponse du serveur) se déduit du type.
 */
export interface DhcpMessage {
  readonly kind: "dhcp";
  readonly type: DhcpMessageType;
  /** Identifiant de transaction choisi par le client, recopié par le serveur. */
  readonly xid: number;
  /** Drapeau BROADCAST : le client demande des réponses diffusées. */
  readonly broadcast: boolean;
  /** ciaddr : adresse actuelle du client (0.0.0.0 avant le premier bail). */
  readonly clientIp: string;
  /** yiaddr : adresse attribuée au client (0.0.0.0 hors OFFER et ACK). */
  readonly yourIp: string;
  /** chaddr : adresse matérielle du client. */
  readonly clientMac: MacAddress;
  readonly options: DhcpOptions;
}

export interface DhcpOptions {
  /** Option 54 : identifiant du serveur (son adresse sur le réseau du client). */
  readonly serverId: string | null;
  /** Option 50 : adresse demandée (REQUEST après une offre). */
  readonly requestedIp: string | null;
  /** Option 1 : masque de sous-réseau. */
  readonly subnetMask: string | null;
  /** Option 3 : passerelle (Router). */
  readonly router: string | null;
  /** Option 51 : durée du bail, en secondes. */
  readonly leaseSeconds: number | null;
}

/** Code de réponse DNS (RCODE, RFC 1035 §4.1.1) : 0 sans erreur, 3 nom inexistant. */
export type DnsRcode = "no-error" | "name-error";

/** Question d'un message DNS (RFC 1035 §4.1.2) : seul le type A de la classe IN est modélisé. */
export interface DnsQuestion {
  readonly name: string;
  readonly type: "A";
}

/** Enregistrement A d'une réponse (RFC 1035 §4.1.3), classe IN. */
export interface DnsAnswer {
  readonly name: string;
  readonly type: "A";
  /** Durée de conservation annoncée, en secondes. */
  readonly ttl: number;
  readonly address: string;
}

/**
 * Message DNS (RFC 1035 §4.1) : en-tête (identifiant, QR, AA, RD, RA,
 * RCODE), une question et les réponses. Les sections d'autorité et
 * additionnelles, toujours vides ici, ne sont pas modélisées.
 */
export interface DnsMessage {
  readonly kind: "dns";
  /** Identifiant choisi par le client, recopié dans la réponse. */
  readonly id: number;
  /** QR : faux pour une question, vrai pour une réponse. */
  readonly response: boolean;
  /** AA : réponse faisant autorité. */
  readonly authoritative: boolean;
  /** RD : récursion demandée par le client. */
  readonly recursionDesired: boolean;
  /** RA : récursion proposée par le serveur. */
  readonly recursionAvailable: boolean;
  readonly rcode: DnsRcode;
  readonly question: DnsQuestion;
  readonly answers: readonly DnsAnswer[];
}

/**
 * Entrée de route RIP version 2 (RFC 2453 §4) : famille d'adresses (« inet »
 * = 2, « unspecified » = 0 pour la demande de table complète), étiquette,
 * réseau, masque, prochain saut (0.0.0.0 : l'émetteur) et métrique (1 à 16).
 */
export interface RipEntry {
  readonly family: "inet" | "unspecified";
  readonly routeTag: number;
  readonly address: string;
  readonly mask: string;
  readonly nextHop: string;
  readonly metric: number;
}

/** Message RIP version 2 (RFC 2453 §3.6 et §4) : commande 1 (demande) ou 2 (réponse), 1 à 25 entrées. */
export interface RipMessage {
  readonly kind: "rip";
  readonly command: "request" | "response";
  readonly version: 2;
  readonly entries: readonly RipEntry[];
}

export interface UdpDatagram {
  readonly kind: "udp";
  readonly sourcePort: number;
  readonly destinationPort: number;
  readonly payload: DhcpMessage | DnsMessage | RipMessage;
}

/** Port UDP de RIP (RFC 2453 §3.6) et groupe des routeurs RIP version 2 (§4.5). */
export const RIP_PORT = 520;
export const RIP_MULTICAST = "224.0.0.9";
/** Entrées par message RIP (RFC 2453 §3.6). */
export const RIP_MAX_ENTRIES = 25;
/** Métrique « infinie » : réseau inaccessible (RFC 2453 §3.6). */
export const RIP_INFINITY = 16;

/** Port UDP du serveur DNS (RFC 1035 §4.2.1). */
export const DNS_SERVER_PORT = 53;
/** Plage des ports dynamiques (éphémères) de l'IANA, d'où le client tire son port source. */
export const EPHEMERAL_PORT_MIN = 49152;
export const EPHEMERAL_PORT_MAX = 65535;

/** Ports UDP de DHCP (RFC 2131 §4.1) : 67 serveur, 68 client. */
export const DHCP_SERVER_PORT = 67;
export const DHCP_CLIENT_PORT = 68;
/** Diffusion limitée (255.255.255.255) : reçue par tout le segment, jamais relayée par un routeur. */
export const LIMITED_BROADCAST = "255.255.255.255";
export const UNSPECIFIED_ADDRESS = "0.0.0.0";

/** Type de LSA modélisé (RFC 2328 §12.1.3) : 1 routeur, 2 réseau. */
export type OspfLsaType = "router" | "network";

/** En-tête de LSA (RFC 2328 §12.1, A.4.1 : 20 octets) ; options, somme de contrôle et longueur non modélisées. */
export interface OspfLsaHeader {
  readonly lsaType: OspfLsaType;
  /** Âge en secondes (0 à l'origine, MaxAge = 3600 : instance à retirer). */
  readonly age: number;
  /** Identifiant d'état de lien : identifiant du routeur (type 1) ou adresse d'interface du DR (type 2). */
  readonly lsId: string;
  readonly advertisingRouter: string;
  /** Numéro de séquence signé sur 32 bits (0x80000001 = InitialSequenceNumber). */
  readonly sequence: number;
}

/**
 * Lien d'un LSA routeur (RFC 2328 §12.4.1, A.4.2) : « transit » (type 2,
 * identifiant = adresse du DR, donnée = adresse de l'interface du routeur) ou
 * « stub » (type 3, identifiant = réseau, donnée = masque).
 */
export interface OspfRouterLink {
  readonly type: "transit" | "stub";
  readonly linkId: string;
  readonly linkData: string;
  readonly metric: number;
}

export interface OspfRouterLsa extends OspfLsaHeader {
  readonly lsaType: "router";
  readonly links: readonly OspfRouterLink[];
}

/** LSA réseau (RFC 2328 §12.4.2, A.4.3) : émis par le DR, masque et routeurs pleinement adjacents (DR compris). */
export interface OspfNetworkLsa extends OspfLsaHeader {
  readonly lsaType: "network";
  readonly mask: string;
  readonly attachedRouters: readonly string[];
}

export type OspfLsa = OspfRouterLsa | OspfNetworkLsa;

/** En-tête commun des paquets OSPF version 2 (RFC 2328 A.3.1) : identifiant du routeur émetteur et zone. */
interface OspfHeader {
  readonly kind: "ospf";
  readonly version: 2;
  readonly routerId: string;
  /** Zone : toujours la dorsale 0.0.0.0 (zone unique). */
  readonly area: string;
}

/** Hello (type 1, RFC 2328 A.3.2) : paramètres du réseau, priorité, DR et BDR annoncés, voisins entendus. */
export interface OspfHello extends OspfHeader {
  readonly type: "hello";
  readonly networkMask: string;
  readonly helloInterval: number;
  readonly deadInterval: number;
  readonly priority: number;
  /** Adresses d'interface du DR et du BDR (0.0.0.0 : aucun). */
  readonly designatedRouter: string;
  readonly backupRouter: string;
  /** Identifiants des routeurs dont un Hello a été reçu récemment sur ce réseau. */
  readonly neighbors: readonly string[];
}

/** Description de base (type 2, RFC 2328 A.3.3) : bits I, M et MS, numéro de séquence, en-têtes de LSA. */
export interface OspfDatabaseDescription extends OspfHeader {
  readonly type: "dd";
  readonly interfaceMtu: number;
  readonly init: boolean;
  readonly more: boolean;
  readonly master: boolean;
  readonly sequence: number;
  readonly headers: readonly OspfLsaHeader[];
}

/** LSA demandé (RFC 2328 A.3.4) : type, identifiant et routeur annonceur. */
export interface OspfLsaRequest {
  readonly lsaType: OspfLsaType;
  readonly lsId: string;
  readonly advertisingRouter: string;
}

/** Demande d'états des liens (type 3). */
export interface OspfLinkStateRequest extends OspfHeader {
  readonly type: "lsr";
  readonly requests: readonly OspfLsaRequest[];
}

/** Mise à jour d'états des liens (type 4, RFC 2328 A.3.5) : LSA complets. */
export interface OspfLinkStateUpdate extends OspfHeader {
  readonly type: "lsu";
  readonly lsas: readonly OspfLsa[];
}

export type OspfPacket = OspfHello | OspfDatabaseDescription | OspfLinkStateRequest | OspfLinkStateUpdate;

/** OSPF sur IPv4 (RFC 2328 §4.3, A.1) : protocole 89, groupes AllSPFRouters et AllDRouters, TTL 1. */
export const OSPF_PROTOCOL = 89;
export const OSPF_ALL_ROUTERS = "224.0.0.5";
export const OSPF_ALL_DROUTERS = "224.0.0.6";
export const OSPF_BACKBONE = "0.0.0.0";
/** Constantes de RFC 2328 annexe B : InitialSequenceNumber (0x80000001 signé), MaxAge, LSRefreshTime, MaxAgeDiff (s). */
export const OSPF_INITIAL_SEQUENCE = 0x80000001 | 0;
export const OSPF_MAX_AGE = 3600;
export const OSPF_LS_REFRESH_TIME = 1800;
export const OSPF_MAX_AGE_DIFF = 900;
/** MTU annoncée dans la description de base : Ethernet, 1500 octets. */
export const OSPF_INTERFACE_MTU = 1500;

const OSPF_HEADER_BYTES = 24;
const LSA_HEADER_BYTES = 20;

/** Taille d'un LSA : en-tête (20), puis 4 octets fixes et 12 par lien (routeur) ou masque et 4 octets par routeur (réseau). */
export function ospfLsaBytes(lsa: OspfLsa): number {
  return LSA_HEADER_BYTES + (lsa.lsaType === "router" ? 4 + 12 * lsa.links.length : 4 + 4 * lsa.attachedRouters.length);
}

/** Taille d'un paquet OSPF : en-tête de 24 octets et corps (RFC 2328 A.3). */
export function ospfBytes(packet: OspfPacket): number {
  switch (packet.type) {
    case "hello":
      return OSPF_HEADER_BYTES + 20 + 4 * packet.neighbors.length;
    case "dd":
      return OSPF_HEADER_BYTES + 8 + LSA_HEADER_BYTES * packet.headers.length;
    case "lsr":
      return OSPF_HEADER_BYTES + 12 * packet.requests.length;
    case "lsu":
      return OSPF_HEADER_BYTES + 4 + packet.lsas.reduce((sum, lsa) => sum + ospfLsaBytes(lsa), 0);
  }
}

/**
 * Annonce VRRP version 3 (RFC 5798 §5.1, type 1) : VRID, priorité, intervalle
 * maximal entre annonces (centisecondes) et adresses virtuelles. La somme de
 * contrôle n'est pas modélisée.
 */
export interface VrrpAdvertisement {
  readonly kind: "vrrp";
  readonly version: 3;
  readonly type: "advertisement";
  readonly vrid: number;
  readonly priority: number;
  readonly maxAdverInterval: number;
  readonly addresses: readonly string[];
}

/** VRRP sur IPv4 (RFC 5798 §5.1.1) : protocole 112, groupe 224.0.0.18, TTL 255 obligatoire. */
export const VRRP_PROTOCOL = 112;
export const VRRP_MULTICAST = "224.0.0.18";
export const VRRP_TTL = 255;

/** Annonce VRRP : 8 octets fixes et 4 par adresse IPv4. */
export function vrrpBytes(packet: VrrpAdvertisement): number {
  return 8 + 4 * packet.addresses.length;
}

export type Ipv4Payload = IcmpMessage | UdpDatagram | OspfPacket | VrrpAdvertisement;

export interface Ipv4Packet {
  readonly kind: "ipv4";
  readonly source: string;
  readonly destination: string;
  readonly ttl: number;
  readonly identification: number;
  readonly payload: Ipv4Payload;
}

export interface EthernetFrame {
  readonly kind: "ethernet";
  readonly source: MacAddress;
  readonly destination: MacAddress;
  /**
   * Étiquette IEEE 802.1Q telle que présente sur le câble : numéro de VLAN
   * (VID) d'une trame étiquetée, absente sinon. Seul le VID est modélisé
   * (priorité et DEI ne le sont pas).
   */
  readonly vlan?: number | undefined;
  readonly payload: ArpPacket | Ipv4Packet;
}

export type Pdu = EthernetFrame | ArpPacket | Ipv4Packet | IcmpMessage | UdpDatagram | DhcpMessage | DnsMessage | RipMessage | OspfPacket | VrrpAdvertisement;

export const ZERO_MAC: MacAddress = "00:00:00:00:00:00";

/** EtherType du contenu (IEEE 802.3) : 0x0806 ARP, 0x0800 IPv4. */
export function etherType(frame: EthernetFrame): number {
  return frame.payload.kind === "arp" ? 0x0806 : 0x0800;
}

const ETHERNET_HEADER_BYTES = 14;
/** Étiquette 802.1Q : TPID 0x8100 (2 octets) et TCI (2 octets). */
export const DOT1Q_TAG_BYTES = 4;
const ETHERNET_FCS_BYTES = 4;
const ETHERNET_MIN_FRAME_BYTES = 64;
/** Préambule (7), délimiteur (1) et intervalle minimal entre trames (12). */
export const ETHERNET_WIRE_OVERHEAD_BYTES = 20;
const ARP_BYTES = 28;
const IPV4_HEADER_BYTES = 20;
const ICMP_HEADER_BYTES = 8;
const UDP_HEADER_BYTES = 8;
/** Champs fixes de DHCP, de « op » à « file » (236 octets, RFC 2131 tableau 1), puis le « magic cookie » (4). */
const DHCP_FIXED_BYTES = 236 + 4;
/** Option de type de message (3 octets) et option de fin (1). */
const DHCP_TYPE_AND_END_BYTES = 3 + 1;
/** Options de 4 octets de données : code, longueur et valeur (6 octets chacune). */
const DHCP_ADDRESS_OPTION_BYTES = 6;

/** Taille du message DHCP : champs fixes et options présentes, sans octets de bourrage. */
export function dhcpBytes(message: DhcpMessage): number {
  const options = Object.values(message.options).filter((value) => value !== null).length;
  return DHCP_FIXED_BYTES + DHCP_TYPE_AND_END_BYTES + options * DHCP_ADDRESS_OPTION_BYTES;
}

const DNS_HEADER_BYTES = 12;
/** Type et classe d'une question (2 + 2 octets). */
const DNS_QUESTION_FIXED_BYTES = 4;
/** Réponse A : pointeur de compression vers le nom de la question (2), type, classe, TTL, longueur (10) et adresse (4). */
const DNS_A_ANSWER_BYTES = 2 + 10 + 4;

/** Nom encodé : un octet de longueur par label, les caractères, puis le label racine vide. */
export function dnsNameBytes(name: string): number {
  return name.length + 2;
}

/** Taille du message DNS : en-tête, question et réponses A (nom compressé, RFC 1035 §4.1.4). */
export function dnsBytes(message: DnsMessage): number {
  return DNS_HEADER_BYTES + dnsNameBytes(message.question.name) + DNS_QUESTION_FIXED_BYTES + message.answers.length * DNS_A_ANSWER_BYTES;
}

/** Message RIP : en-tête de 4 octets (commande, version, zéro) et 20 octets par entrée. */
export function ripBytes(message: RipMessage): number {
  return 4 + 20 * message.entries.length;
}

export function udpBytes(datagram: UdpDatagram): number {
  const payload = datagram.payload;
  return UDP_HEADER_BYTES + (payload.kind === "dns" ? dnsBytes(payload) : payload.kind === "rip" ? ripBytes(payload) : dhcpBytes(payload));
}

export function icmpBytes(message: IcmpMessage): number {
  // Une erreur ICMP recopie l'en-tête IP (20 octets) et 8 octets du datagramme fautif.
  return message.type === "echo-request" || message.type === "echo-reply"
    ? ICMP_HEADER_BYTES + message.dataLength
    : ICMP_HEADER_BYTES + IPV4_HEADER_BYTES + 8;
}

export function ipv4Bytes(packet: Ipv4Packet): number {
  const payload = packet.payload;
  if (payload.kind === "vrrp") return IPV4_HEADER_BYTES + vrrpBytes(payload);
  return IPV4_HEADER_BYTES + (payload.kind === "udp" ? udpBytes(payload) : payload.kind === "ospf" ? ospfBytes(payload) : icmpBytes(payload));
}

/** Numéro de protocole IPv4 (IANA) : 1 ICMP, 17 UDP, 89 OSPF, 112 VRRP. */
export function ipProtocol(packet: Ipv4Packet): number {
  const kind = packet.payload.kind;
  return kind === "udp" ? 17 : kind === "ospf" ? OSPF_PROTOCOL : kind === "vrrp" ? VRRP_PROTOCOL : 1;
}

/** Taille de la trame, en-tête et FCS compris, complétée au minimum Ethernet de 64 octets. */
export function frameBytes(frame: EthernetFrame): number {
  const payload = frame.payload.kind === "arp" ? ARP_BYTES : ipv4Bytes(frame.payload);
  const tag = frame.vlan === undefined ? 0 : DOT1Q_TAG_BYTES;
  return Math.max(ETHERNET_MIN_FRAME_BYTES, ETHERNET_HEADER_BYTES + tag + payload + ETHERNET_FCS_BYTES);
}

export function isIcmpError(message: IcmpMessage): message is IcmpError {
  return message.type === "destination-unreachable" || message.type === "time-exceeded";
}
