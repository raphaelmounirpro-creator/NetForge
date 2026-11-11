import type { MacAddress } from "./mac.js";

/**
 * Unités de données réellement modélisées, en unions discriminées qui
 * suivent l'encapsulation : Ethernet transporte ARP ou IPv4 ; IPv4
 * transporte ICMP. Seuls ces champs existent ; aucun octet n'est inventé.
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

export interface Ipv4Packet {
  readonly kind: "ipv4";
  readonly source: string;
  readonly destination: string;
  readonly ttl: number;
  readonly identification: number;
  readonly payload: IcmpMessage;
}

export interface EthernetFrame {
  readonly kind: "ethernet";
  readonly source: MacAddress;
  readonly destination: MacAddress;
  readonly payload: ArpPacket | Ipv4Packet;
}

export type Pdu = EthernetFrame | ArpPacket | Ipv4Packet | IcmpMessage;

export const ZERO_MAC: MacAddress = "00:00:00:00:00:00";

/** EtherType du contenu (IEEE 802.3) : 0x0806 ARP, 0x0800 IPv4. */
export function etherType(frame: EthernetFrame): number {
  return frame.payload.kind === "arp" ? 0x0806 : 0x0800;
}

const ETHERNET_HEADER_BYTES = 14;
const ETHERNET_FCS_BYTES = 4;
const ETHERNET_MIN_FRAME_BYTES = 64;
/** Préambule (7), délimiteur (1) et intervalle minimal entre trames (12). */
export const ETHERNET_WIRE_OVERHEAD_BYTES = 20;
const ARP_BYTES = 28;
const IPV4_HEADER_BYTES = 20;
const ICMP_HEADER_BYTES = 8;

export function icmpBytes(message: IcmpMessage): number {
  // Une erreur ICMP recopie l'en-tête IP (20 octets) et 8 octets du datagramme fautif.
  return message.type === "echo-request" || message.type === "echo-reply"
    ? ICMP_HEADER_BYTES + message.dataLength
    : ICMP_HEADER_BYTES + IPV4_HEADER_BYTES + 8;
}

export function ipv4Bytes(packet: Ipv4Packet): number {
  return IPV4_HEADER_BYTES + icmpBytes(packet.payload);
}

/** Taille de la trame, en-tête et FCS compris, complétée au minimum Ethernet de 64 octets. */
export function frameBytes(frame: EthernetFrame): number {
  const payload = frame.payload.kind === "arp" ? ARP_BYTES : ipv4Bytes(frame.payload);
  return Math.max(ETHERNET_MIN_FRAME_BYTES, ETHERNET_HEADER_BYTES + payload + ETHERNET_FCS_BYTES);
}

export function isIcmpError(message: IcmpMessage): message is IcmpError {
  return message.type === "destination-unreachable" || message.type === "time-exceeded";
}
