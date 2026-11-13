import type { Pdu } from "./pdu.js";
import type { SimTime } from "./time.js";

/**
 * Codes de décision stables. Le texte français est produit par l'interface
 * (apps/web/src/i18n) à partir du code et des paramètres : aucun texte
 * n'est rédigé ici, ce qui garde la trace traduisible et testable.
 */
export const TRACE_CODES = [
  // Actions appliquées par le moteur
  "command.ping",
  "command.link-down",
  "command.link-up",
  "command.clear-arp",
  "command.clear-mac",
  "command.dhcp-renew",
  "command.dhcp-release",
  "command.nslookup",
  // Couche liaison
  "eth.transmit",
  "eth.no-link",
  "eth.link-down",
  "eth.lost-in-transit",
  "nic.filtered",
  // Commutation
  "switch.learn",
  "switch.move",
  "switch.forward",
  "switch.flood-broadcast",
  "switch.flood-multicast",
  "switch.flood-unknown",
  "switch.filter",
  "switch.expire",
  "switch.flush",
  // VLAN 802.1Q
  "vlan.tagged-dropped",
  "vlan.not-allowed",
  "vlan.no-subinterface",
  "nic.tagged-dropped",
  // Spanning Tree 802.1D
  "stp.discarded",
  "stp.port-state",
  "stp.topology-change",
  // UDP et DHCP
  "udp.no-service",
  "dhcp.discover-sent",
  "dhcp.offer-received",
  "dhcp.request-sent",
  "dhcp.bound",
  "dhcp.nak-received",
  "dhcp.gave-up",
  "dhcp.expired",
  "dhcp.release-sent",
  "dhcp.ignored",
  "dhcp.no-pool",
  "dhcp.offer-sent",
  "dhcp.pool-exhausted",
  "dhcp.ack-sent",
  "dhcp.nak-sent",
  "dhcp.not-selected",
  "dhcp.released",
  "dhcp.lease-expired",
  // DNS
  "dns.no-server",
  "dns.query-sent",
  "dns.send-failed",
  "dns.answer-sent",
  "dns.name-error-sent",
  "dns.resolved",
  "dns.name-error",
  "dns.ignored",
  "dns.gave-up",
  // RIP version 2
  "rip.request-sent",
  "rip.request-received",
  "rip.response-sent",
  "rip.response-received",
  "rip.route-learned",
  "rip.route-updated",
  "rip.route-unreachable",
  "rip.route-removed",
  "rip.network-up",
  "rip.ignored",
  // OSPF version 2
  "ospf.hello-sent",
  "ospf.hello-received",
  "ospf.hello-mismatch",
  "ospf.neighbor-state",
  "ospf.interface-state",
  "ospf.dd-sent",
  "ospf.dd-received",
  "ospf.lsr-sent",
  "ospf.lsr-received",
  "ospf.lsu-sent",
  "ospf.lsu-received",
  "ospf.lsa-originated",
  "ospf.lsa-installed",
  "ospf.lsa-flushed",
  "ospf.lsa-expired",
  "ospf.spf",
  "ospf.route-added",
  "ospf.route-changed",
  "ospf.route-removed",
  "ospf.ignored",
  // ARP
  "arp.cache-hit",
  "arp.cache-miss",
  "arp.request-sent",
  "arp.request-received",
  "arp.reply-sent",
  "arp.reply-received",
  "arp.not-target",
  "arp.no-address",
  "arp.entry-added",
  "arp.entry-updated",
  "arp.entry-expired",
  "arp.queued",
  "arp.queue-full",
  "arp.resolved",
  "arp.failed",
  // IPv4
  "ip.route",
  "ip.forward",
  "ip.no-route",
  "ip.local",
  "ip.loopback",
  "ip.not-for-host",
  "ip.ttl-expired",
  "ip.broadcast-dropped",
  // ICMP
  "icmp.echo-request",
  "icmp.echo-reply",
  "icmp.error-sent",
  "icmp.error-suppressed",
  "icmp.error-received",
  "icmp.unmatched-reply",
  // Application ping
  "ping.send",
  "ping.reply",
  "ping.error",
  "ping.failed",
  "ping.timeout",
  "ping.late-reply",
  "ping.done",
  "ping.unresolved",
  // Limites
  "sim.interrupted",
] as const;

export type TraceCode = (typeof TRACE_CODES)[number];
export type TraceValue = string | number | boolean | null;
export type TraceParams = Readonly<Record<string, TraceValue>>;

/** Une décision du moteur, avec tout ce qu'il faut pour l'expliquer. */
export interface TraceEntry {
  /** Numéro de l'événement traité ; plusieurs décisions peuvent le partager. */
  readonly event: number;
  /** Événement qui a programmé celui-ci (null : action de l'utilisateur). */
  readonly parent: number | null;
  readonly time: SimTime;
  readonly deviceId: string | null;
  readonly portId: string | null;
  /** Échange auquel la décision se rattache (ex. « ping-1#2 » : 2e écho du ping 1). */
  readonly exchange: string | null;
  readonly code: TraceCode;
  readonly params: TraceParams;
  /** Unité de données concernée, telle que modélisée. */
  readonly pdu: Pdu | null;
}

/** Cause d'une interruption pour dépassement de limite. */
export interface Diagnostic {
  readonly code: "limit.pending-events" | "limit.events" | "limit.time";
  readonly time: SimTime;
  readonly limit: number;
  readonly pendingEvents: number;
  readonly nextEventTime: SimTime | null;
}
