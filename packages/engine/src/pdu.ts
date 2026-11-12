import type { MacAddress } from "./mac.js";

/**
 * Unités de données réellement modélisées, en unions discriminées qui
 * suivent l'encapsulation : Ethernet transporte ARP ou IPv4 ; IPv4
 * transporte ICMP ou UDP ; UDP transporte DHCP ou DNS. Seuls ces champs existent ;
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

export interface UdpDatagram {
  readonly kind: "udp";
  readonly sourcePort: number;
  readonly destinationPort: number;
  readonly payload: DhcpMessage | DnsMessage;
}

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

export type Ipv4Payload = IcmpMessage | UdpDatagram;

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

export type Pdu = EthernetFrame | ArpPacket | Ipv4Packet | IcmpMessage | UdpDatagram | DhcpMessage | DnsMessage;

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

export function udpBytes(datagram: UdpDatagram): number {
  return UDP_HEADER_BYTES + (datagram.payload.kind === "dns" ? dnsBytes(datagram.payload) : dhcpBytes(datagram.payload));
}

export function icmpBytes(message: IcmpMessage): number {
  // Une erreur ICMP recopie l'en-tête IP (20 octets) et 8 octets du datagramme fautif.
  return message.type === "echo-request" || message.type === "echo-reply"
    ? ICMP_HEADER_BYTES + message.dataLength
    : ICMP_HEADER_BYTES + IPV4_HEADER_BYTES + 8;
}

export function ipv4Bytes(packet: Ipv4Packet): number {
  return IPV4_HEADER_BYTES + (packet.payload.kind === "udp" ? udpBytes(packet.payload) : icmpBytes(packet.payload));
}

/** Numéro de protocole IPv4 (IANA) : 1 ICMP, 17 UDP. */
export function ipProtocol(packet: Ipv4Packet): number {
  return packet.payload.kind === "udp" ? 17 : 1;
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
