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
  "switch.flood-unknown",
  "switch.filter",
  "switch.expire",
  "switch.flush",
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
