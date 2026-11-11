import {
  BROADCAST_MAC,
  NANOSECONDS_PER_MICROSECOND,
  NANOSECONDS_PER_MILLISECOND,
  NANOSECONDS_PER_SECOND,
  type DeviceView,
  type HostErrorCode,
  type PingAttemptView,
  type PingView,
  type TraceCode,
  type TraceEntry,
  type TraceParams,
} from "@netforge/engine";
import { fill, messages } from "./index";

/**
 * Textes de la simulation produits à partir des faits du moteur (codes
 * stables + paramètres). Aucune décision réseau n'est prise ici : on met en
 * forme ce que le moteur a décidé.
 */
const t = messages.simulation;

// Formateurs créés une fois : toLocaleString avec options en recrée un à chaque appel.
const formatters = new Map<number, Intl.NumberFormat>();
const decimal = (value: number, digits: number) => {
  let formatter = formatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(digits, formatter);
  }
  return formatter.format(value);
};

/** Instant simulé, en secondes à la microseconde : « 1,000012 s ». */
export function formatSimTime(ns: number): string {
  return `${decimal(ns / NANOSECONDS_PER_SECOND, 6)} s`;
}

/** Durée simulée dans l'unité la plus lisible : « 29,136 µs », « 4,000 s ». */
export function formatDuration(ns: number): string {
  if (ns < NANOSECONDS_PER_MICROSECOND) return `${String(ns)} ns`;
  if (ns < NANOSECONDS_PER_MILLISECOND) return `${decimal(ns / NANOSECONDS_PER_MICROSECOND, 3)} µs`;
  if (ns < NANOSECONDS_PER_SECOND) return `${decimal(ns / NANOSECONDS_PER_MILLISECOND, 3)} ms`;
  return `${decimal(ns / NANOSECONDS_PER_SECOND, 3)} s`;
}

export interface NameIndex {
  device(id: string): string;
  /** Adresse MAC suivie de son propriétaire, ex. « 02:1a:… (PC2 eth0) ». */
  mac(mac: string): string;
  /** Câble désigné par ses extrémités, ex. « PC1 eth0 ↔ SW1 ge1 ». */
  link(id: string): string;
}

export function buildNameIndex(devices: readonly DeviceView[]): NameIndex {
  const names = new Map<string, string>();
  const owners = new Map<string, string>();
  const ends = new Map<string, string[]>();
  for (const device of devices) {
    names.set(device.deviceId, device.name);
    for (const item of device.interfaces) {
      const label = `${device.name} ${item.portId}`;
      owners.set(item.mac, label);
      if (item.linkId) ends.set(item.linkId, [...(ends.get(item.linkId) ?? []), label]);
    }
  }
  return {
    device: (id) => names.get(id) ?? id,
    mac: (mac) => {
      if (mac === BROADCAST_MAC) return `${mac} (${messages.traceLabels.broadcast})`;
      const owner = owners.get(mac);
      return owner ? `${mac} (${owner})` : mac;
    },
    link: (id) => ends.get(id)?.join(" ↔ ") ?? id,
  };
}

export type TraceCategory = "link" | "switch" | "arp" | "ip" | "icmp" | "system";
export const TRACE_CATEGORIES: readonly TraceCategory[] = ["link", "switch", "arp", "ip", "icmp", "system"];

export function traceCategory(code: TraceCode): TraceCategory {
  const family = code.slice(0, code.indexOf("."));
  switch (family) {
    case "eth":
    case "nic":
      return "link";
    case "switch":
      return "switch";
    case "arp":
      return "arp";
    case "ip":
      return "ip";
    case "icmp":
    case "ping":
      return "icmp";
    default:
      return "system";
  }
}

export function icmpText(type: string | null, code: number | null): string {
  const key = `${type ?? ""}-${String(code ?? "")}`;
  return key in t.icmp ? t.icmp[key as keyof typeof t.icmp] : fill(t.icmp.other, { type: type ?? "?", code: code ?? "?" });
}

function failureText(reason: unknown): string {
  return typeof reason === "string" && reason in t.failures ? t.failures[reason as keyof typeof t.failures] : String(reason);
}

const MAC_PATTERN = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const TIME_PARAMS = new Set(["expiresAt", "arrival", "departure"]);
const DURATION_PARAMS = new Set(["rtt", "waited", "minRtt", "maxRtt", "avgRtt"]);

function templateKey(entry: TraceEntry): keyof typeof messages.trace {
  const params = entry.params;
  switch (entry.code) {
    case "command.link-down":
    case "command.link-up":
      return params["changed"] === false ? `${entry.code}.unchanged` : entry.code;
    case "ip.route":
    case "ip.forward":
      return `${entry.code}.${params["nextHop"] === null ? "direct" : "via"}`;
    case "ip.no-route": {
      const key = `ip.no-route.${String(params["reason"])}`;
      return key in messages.trace ? (key as keyof typeof messages.trace) : "ip.no-route.no-match";
    }
    default:
      return entry.code;
  }
}

/** Phrase française expliquant une décision du moteur. */
export function formatTrace(entry: TraceEntry, names: NameIndex): string {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(entry.params)) {
    if (value === null) continue;
    if (typeof value === "string" && MAC_PATTERN.test(value)) values[key] = names.mac(value);
    else if (typeof value === "number" && TIME_PARAMS.has(key)) values[key] = formatSimTime(value);
    else if (typeof value === "number" && DURATION_PARAMS.has(key)) values[key] = formatDuration(value);
    else values[key] = typeof value === "boolean" ? String(value) : value;
  }
  values["device"] = entry.deviceId ? names.device(entry.deviceId) : "";
  values["port"] = entry.portId ?? "";
  const params = entry.params;
  if (typeof params["toDeviceId"] === "string") values["toDevice"] = names.device(params["toDeviceId"]);
  if (typeof params["linkId"] === "string") values["link"] = names.link(params["linkId"]);
  if (params["outPorts"] === "") values["outPorts"] = messages.traceLabels.nobody;
  if (typeof params["type"] === "string") values["icmp"] = icmpText(params["type"], typeof params["code"] === "number" ? params["code"] : null);
  if (entry.code === "ping.failed") values["failure"] = failureText(params["reason"]);
  if (typeof params["routeKind"] === "string" && params["routeKind"] in messages.traceLabels.routeKinds) {
    values["routeKind"] = messages.traceLabels.routeKinds[params["routeKind"] as keyof typeof messages.traceLabels.routeKinds];
  }
  if (entry.code === "sim.interrupted") {
    values["limit"] = limitText(params);
    if (typeof params["pendingEvents"] === "number") values["pendingEvents"] = params["pendingEvents"].toLocaleString("fr-FR");
  }
  const template: string = messages.trace[templateKey(entry)];
  return fill(template, values);
}

function limitText(params: TraceParams): string {
  const code = params["code"];
  const limit = typeof params["limit"] === "number" ? params["limit"].toLocaleString("fr-FR") : "";
  return typeof code === "string" && code in t.limits ? fill(t.limits[code as keyof typeof t.limits], { limit }) : String(code);
}

export function diagnosticText(diagnostic: { code: string; limit: number }): string {
  return limitText({ code: diagnostic.code, limit: diagnostic.limit });
}

/** Message d'erreur d'une commande refusée par le moteur. */
export function formatCommandError(code: HostErrorCode, params: TraceParams): string {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) if (typeof value === "string" || typeof value === "number") values[key] = value;
  if (code === "command.invalid-destination") {
    const reason = params["reason"];
    values["reasonText"] =
      reason === "format"
        ? messages.commandErrors.format
        : typeof reason === "string" && reason in messages.ipv4Reasons
          ? messages.ipv4Reasons[reason as keyof typeof messages.ipv4Reasons]
          : String(reason);
  }
  return fill(messages.commandErrors[code], values);
}

/** Ligne de résultat d'un écho, à la manière de l'outil ping. */
export function pingAttemptText(attempt: PingAttemptView): string {
  const sequence = attempt.sequence;
  switch (attempt.status) {
    case "pending":
      return fill(t.pingPending, { sequence });
    case "reply":
      return fill(t.pingReply, { sequence, from: attempt.from ?? "", ttl: attempt.ttl ?? "", rtt: formatDuration(attempt.rtt ?? 0) });
    case "timeout":
      return fill(t.pingTimeout, { sequence });
    case "error":
      return fill(t.pingError, { sequence, from: attempt.from ?? "", icmp: icmpText(attempt.errorType, attempt.errorCode) });
    case "failed":
      return fill(t.pingFailed, { sequence, failure: failureText(attempt.failure) });
  }
}

/** Bilan d'un ping terminé (null tant qu'il est en cours). */
export function pingSummary(view: PingView): { summary: string; rtt: string | null } | null {
  if (!view.done) return null;
  const rtts = view.attempts.flatMap((attempt) => (attempt.rtt === null ? [] : [attempt.rtt]));
  const sent = view.attempts.length;
  const received = rtts.length;
  const lost = sent - received;
  const summary = fill(t.pingSummary, { sent, received, lost, loss: sent === 0 ? 0 : Math.round((lost / sent) * 100) });
  if (received === 0) return { summary, rtt: null };
  const avg = Math.round(rtts.reduce((sum, value) => sum + value, 0) / received);
  return {
    summary,
    rtt: fill(t.pingRtt, { min: formatDuration(Math.min(...rtts)), avg: formatDuration(avg), max: formatDuration(Math.max(...rtts)) }),
  };
}
