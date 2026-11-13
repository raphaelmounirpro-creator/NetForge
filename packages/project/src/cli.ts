import { getModel, type DeviceKind } from "./catalog.js";
import {
  addStaticRoute,
  parseIpv4Input,
  parseRouteInput,
  removeStaticRoute,
  renameDevice,
  setDefaultGateway,
  setDhcpPool,
  setDnsEnabled,
  setDnsRecord,
  setDnsServer,
  setInterfaceDhcp,
  setInterfaceIpv4,
  setOspfInterface,
  setRipInterface,
  setVrrpGroup,
  setStp,
  setSwitchport,
  type CommandResult,
} from "./commands.js";
import { DHCP_LEASE_DEFAULT, formatLeaseDuration, parseDhcpPoolInput } from "./dhcp.js";
import { isDnsAddress, normalizeDnsName, parseDnsRecordInput, sortedDnsRecords } from "./dns.js";
import { error, type Issue } from "./issues.js";
import { VRID_MAX, VRID_MIN, VRRP_DEFAULT_PRIORITY, VRRP_PRIORITY_MAX, VRRP_PRIORITY_MIN, isVrid, isVrrpPriority } from "./vrrp.js";
import {
  OSPF_BACKBONE_AREA,
  OSPF_COST_MAX,
  OSPF_COST_MIN,
  OSPF_DEFAULT_COST,
  OSPF_DEFAULT_PRIORITY,
  OSPF_PRIORITY_MAX,
  isOspfCost,
  isOspfPriority,
  parseOspfArea,
  type OspfInterface,
  type OspfMode,
} from "./ospf.js";
import { isIpv4Address, prefixToMask } from "./ipv4.js";
import type { Device, NfgDocument } from "./schema.js";
import { STP_DEFAULT_PRIORITY, STP_PRIORITY_MAX, STP_PRIORITY_STEP, isStpPriority } from "./stp.js";
import { DEFAULT_VLAN, VLAN_MAX, VLAN_MIN, formatVlanList, isVlanId, parseSubinterface, parseVlanList, subinterfaceId } from "./vlan.js";

/**
 * Console des équipements (CLI originale de NetForge).
 *
 * L'interpréteur est pur : il analyse une ligne et renvoie l'intention
 * correspondante. Les modifications de configuration sont exprimées avec
 * les MÊMES commandes métier que les formulaires (setInterfaceIpv4,
 * addStaticRoute…), appliquées ensuite par l'interface ; les demandes
 * d'exécution (ping, affichage des tables) sont transmises au moteur.
 * Aucun texte n'est produit ici : codes stables + paramètres, mis en forme
 * par l'interface (apps/web/src/i18n).
 */

export type CliMode = { readonly kind: "operation" } | { readonly kind: "config" } | { readonly kind: "interface"; readonly portId: string };

export const OPERATION_MODE: CliMode = { kind: "operation" };

export type CliRequest =
  | { readonly kind: "show-interfaces" }
  | { readonly kind: "show-routes" }
  | { readonly kind: "show-arp" }
  | { readonly kind: "show-mac" }
  | { readonly kind: "show-config" }
  | { readonly kind: "show-vlans" }
  | { readonly kind: "show-stp" }
  | { readonly kind: "show-dhcp" }
  | { readonly kind: "show-dns" }
  | { readonly kind: "show-rip" }
  | { readonly kind: "show-ospf" }
  | { readonly kind: "show-ospf-database" }
  | { readonly kind: "show-vrrp" }
  | { readonly kind: "ipconfig" }
  /** Client DHCP d'un PC : renouveler ou libérer le bail (demande d'exécution). */
  | { readonly kind: "dhcp"; readonly action: "renew" | "release" }
  /** Destination : adresse IPv4 ou nom d'hôte (résolu par le moteur). */
  | { readonly kind: "ping"; readonly destination: string; readonly count: number }
  /** Résolution d'un nom par le serveur DNS du poste (demande d'exécution). */
  | { readonly kind: "nslookup"; readonly name: string }
  | { readonly kind: "clear-table"; readonly table: "arp" | "mac" }
  | { readonly kind: "help"; readonly entries: readonly CliHelpEntry[] }
  | { readonly kind: "clear-screen" };

export const CLI_ERROR_CODES = [
  "cli.unknown-command",
  "cli.ambiguous",
  "cli.incomplete",
  "cli.wrong-mode",
  "cli.missing-argument",
  "cli.unexpected-argument",
  "cli.unknown-port",
  "cli.invalid-count",
] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];

export interface CliError {
  readonly code: CliErrorCode;
  readonly params: Readonly<Record<string, string | number>>;
}

export type CliResult =
  | {
      readonly ok: true;
      readonly mode: CliMode;
      /** Modification du projet (mêmes commandes que les formulaires), à appliquer par l'interface. */
      readonly edit: ((doc: NfgDocument) => CommandResult) | null;
      readonly request: CliRequest | null;
    }
  | { readonly ok: false; readonly mode: CliMode; readonly error: CliError | null; readonly issues: readonly Issue[] };

export interface CliHelpEntry {
  /** Identifiant stable de la commande (texte d'aide dans l'interface). */
  readonly id: string;
  /** Syntaxe, ex. « route add <réseau>/<préfixe> via <prochain-saut> ». */
  readonly usage: string;
}

export const DEFAULT_PING_COUNT = 4;
const MAX_PING_COUNT = 20;

type ModeKind = CliMode["kind"];

interface Invocation {
  readonly doc: NfgDocument;
  readonly device: Device;
  readonly mode: CliMode;
  readonly args: readonly string[];
}

interface CommandSpec {
  readonly id: string;
  readonly words: readonly string[];
  /** Arguments décrits dans la syntaxe (aide) ; « [x] » = facultatif. */
  readonly syntax: string;
  readonly modes: readonly ModeKind[];
  readonly devices: readonly DeviceKind[];
  /** Nombre minimal d'arguments ; le premier manquant est nommé dans l'erreur. */
  readonly required: readonly string[];
  readonly maxArgs: number;
  readonly run: (invocation: Invocation) => CliResult;
}

const ALL_MODES: readonly ModeKind[] = ["operation", "config", "interface"];
const NETWORK_DEVICES: readonly DeviceKind[] = ["router", "switch"];

const ok = (mode: CliMode, extra: { edit?: (doc: NfgDocument) => CommandResult; request?: CliRequest } = {}): CliResult => ({
  ok: true,
  mode,
  edit: extra.edit ?? null,
  request: extra.request ?? null,
});

const fail = (mode: CliMode, code: CliErrorCode, params: Record<string, string | number> = {}): CliResult => ({
  ok: false,
  mode,
  error: { code, params },
  issues: [],
});

const invalid = (mode: CliMode, issues: readonly Issue[]): CliResult => ({ ok: false, mode, error: null, issues });

/** « 10.0.1.0/24 » ou « 10.0.1.0 255.255.255.0 » : sépare adresse et masque. */
function splitCidr(args: readonly string[]): { address: string; mask: string; rest: readonly string[] } {
  const [first = "", ...rest] = args;
  const slash = first.indexOf("/");
  if (slash >= 0) return { address: first.slice(0, slash), mask: first.slice(slash + 1), rest };
  const [mask = "", ...after] = rest;
  return { address: first, mask, rest: after };
}

/** Enchaîne deux commandes en une seule modification (atomique pour l'historique). */
function chain(first: CommandResult, next: (doc: NfgDocument) => CommandResult): CommandResult {
  if (!first.ok) return first;
  const second = next(first.document);
  return second.ok ? { ...second, warnings: [...first.warnings, ...second.warnings] } : second;
}

/** Numéro de VLAN écrit en décimal sans zéro initial, de 1 à 4094 ; null sinon. */
function vlanNumber(text: string): number | null {
  if (!/^[1-9]\d{0,3}$/.test(text)) return null;
  const vlan = Number(text);
  return isVlanId(vlan) ? vlan : null;
}

/** Configuration STP d'un switch (défaut : activé, priorité 32768). */
function stpOf(doc: NfgDocument, device: Device): { enabled: boolean; priority: number } {
  return doc.configurations[device.id]?.stp ?? { enabled: true, priority: STP_DEFAULT_PRIORITY };
}

/** Configuration OSPF d'une interface avec un nouveau mode ; coût et priorité conservés, sinon valeurs par défaut. */
function ospfWith(doc: NfgDocument, device: Device, interfaceId: string, change: { mode: OspfMode }): OspfInterface {
  const current = doc.configurations[device.id]?.ospfInterfaces[interfaceId];
  return { mode: change.mode, cost: current?.cost ?? OSPF_DEFAULT_COST, priority: current?.priority ?? OSPF_DEFAULT_PRIORITY, area: current?.area ?? OSPF_BACKBONE_AREA };
}

function pcPort(device: Device): string {
  return getModel(device.model).ports[0]?.id ?? "eth0";
}

const COMMANDS: readonly CommandSpec[] = [
  // ------------------------------------------------ Commun
  {
    id: "help",
    words: ["help"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["pc", "router", "switch"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => ok(mode, { request: { kind: "help", entries: helpEntries(device, mode) } }),
  },
  {
    id: "cls",
    words: ["cls"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["pc", "router", "switch"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "clear-screen" } }),
  },
  // ------------------------------------------------ Outils PC
  {
    id: "ipconfig",
    words: ["ipconfig"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "ipconfig" } }),
  },
  {
    id: "ipconfig-set",
    words: ["ipconfig", "set"],
    syntax: "<adresse> <masque> [passerelle]",
    modes: ["operation"],
    devices: ["pc"],
    required: ["adresse"],
    maxArgs: 3,
    run: ({ device, mode, args }) => {
      const { address, mask, rest } = splitCidr(args);
      if (mask === "") return fail(mode, "cli.missing-argument", { argument: "masque" });
      const parsed = parseIpv4Input(address, mask);
      if (!parsed.ok) return invalid(mode, parsed.errors);
      const gateway = rest[0];
      if (gateway !== undefined && !isIpv4Address(gateway)) return invalid(mode, [error("ipv4.invalid-address", { value: gateway })]);
      const port = pcPort(device);
      return ok(mode, {
        edit: (doc) => {
          const addressed = setInterfaceIpv4(doc, { deviceId: device.id, portId: port, ipv4: parsed.ipv4 });
          return gateway === undefined ? addressed : chain(addressed, (next) => setDefaultGateway(next, { deviceId: device.id, gateway }));
        },
      });
    },
  },
  {
    id: "ipconfig-clear",
    words: ["ipconfig", "clear"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) =>
      ok(mode, {
        edit: (doc) =>
          chain(setDefaultGateway(doc, { deviceId: device.id, gateway: null }), (next) =>
            setInterfaceIpv4(next, { deviceId: device.id, portId: pcPort(device), ipv4: null }),
          ),
      }),
  },
  {
    id: "ipconfig-dhcp",
    words: ["ipconfig", "dhcp"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => ok(mode, { edit: (doc) => setInterfaceDhcp(doc, { deviceId: device.id, portId: pcPort(device), enabled: true }) }),
  },
  {
    id: "ipconfig-renew",
    words: ["ipconfig", "renew"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "dhcp", action: "renew" } }),
  },
  {
    id: "ipconfig-release",
    words: ["ipconfig", "release"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "dhcp", action: "release" } }),
  },
  {
    id: "ipconfig-dns",
    words: ["ipconfig", "dns"],
    syntax: "<serveur>",
    modes: ["operation"],
    devices: ["pc"],
    required: ["serveur"],
    maxArgs: 1,
    run: ({ device, mode, args }) => {
      const server = args[0] ?? "";
      if (!isDnsAddress(server)) return invalid(mode, [error("dns.invalid-address", { value: server })]);
      return ok(mode, { edit: (doc) => setDnsServer(doc, { deviceId: device.id, server }) });
    },
  },
  {
    id: "ipconfig-dns-clear",
    words: ["ipconfig", "dns", "clear"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => ok(mode, { edit: (doc) => setDnsServer(doc, { deviceId: device.id, server: null }) }),
  },
  {
    id: "nslookup",
    words: ["nslookup"],
    syntax: "<nom>",
    modes: ["operation"],
    devices: ["pc"],
    required: ["nom"],
    maxArgs: 1,
    run: ({ mode, args }) => {
      const name = normalizeDnsName(args[0] ?? "");
      if (name === null) return invalid(mode, [error("dns.invalid-name", { value: args[0] ?? "" })]);
      return ok(mode, { request: { kind: "nslookup", name } });
    },
  },
  {
    id: "ping",
    words: ["ping"],
    syntax: "<adresse|nom> [-n <nombre>]",
    modes: ["operation"],
    devices: ["pc"],
    required: ["adresse"],
    maxArgs: 3,
    run: ({ mode, args }) => {
      const [destination = "", flag, value] = args;
      if (flag !== undefined && flag !== "-n") return fail(mode, "cli.unexpected-argument", { word: flag });
      if (flag === "-n" && value === undefined) return fail(mode, "cli.missing-argument", { argument: "nombre" });
      const count = value === undefined ? DEFAULT_PING_COUNT : Number(value);
      if (!Number.isInteger(count) || count < 1 || count > MAX_PING_COUNT) return fail(mode, "cli.invalid-count", { max: MAX_PING_COUNT });
      return ok(mode, { request: { kind: "ping", destination, count } });
    },
  },
  {
    id: "arp-show",
    words: ["arp", "-a"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-arp" } }),
  },
  {
    id: "arp-clear",
    words: ["arp", "-d"],
    syntax: "",
    modes: ["operation"],
    devices: ["pc"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "clear-table", table: "arp" } }),
  },
  // ------------------------------------------------ Routeurs et switches : consultation
  {
    id: "show-interfaces",
    words: ["show", "interfaces"],
    syntax: "",
    modes: ALL_MODES,
    devices: NETWORK_DEVICES,
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-interfaces" } }),
  },
  {
    id: "show-routes",
    words: ["show", "routes"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-routes" } }),
  },
  {
    id: "show-arp",
    words: ["show", "arp"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-arp" } }),
  },
  {
    id: "show-mac",
    words: ["show", "mac"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["switch"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-mac" } }),
  },
  {
    id: "show-config",
    words: ["show", "config"],
    syntax: "",
    modes: ALL_MODES,
    devices: NETWORK_DEVICES,
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-config" } }),
  },
  {
    id: "show-vlans",
    words: ["show", "vlans"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["switch"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-vlans" } }),
  },
  {
    id: "show-stp",
    words: ["show", "spanning-tree"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["switch"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-stp" } }),
  },
  {
    id: "stp-enable",
    words: ["spanning-tree", "enable"],
    syntax: "",
    modes: ["config"],
    devices: ["switch"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode, doc }) => ok(mode, { edit: (current) => setStp(current, { deviceId: device.id, enabled: true, priority: stpOf(doc, device).priority }) }),
  },
  {
    id: "stp-disable",
    words: ["spanning-tree", "disable"],
    syntax: "",
    modes: ["config"],
    devices: ["switch"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode, doc }) => ok(mode, { edit: (current) => setStp(current, { deviceId: device.id, enabled: false, priority: stpOf(doc, device).priority }) }),
  },
  {
    id: "stp-priority",
    words: ["spanning-tree", "priority"],
    syntax: "<priorité>",
    modes: ["config"],
    devices: ["switch"],
    required: ["priorité"],
    maxArgs: 1,
    run: ({ device, mode, doc, args }) => {
      const priority = /^\d{1,5}$/.test(args[0] ?? "") ? Number(args[0]) : Number.NaN;
      if (!isStpPriority(priority)) return invalid(mode, [error("stp.invalid-priority", { value: args[0] ?? "", max: STP_PRIORITY_MAX, step: STP_PRIORITY_STEP })]);
      return ok(mode, { edit: (current) => setStp(current, { deviceId: device.id, enabled: stpOf(doc, device).enabled, priority }) });
    },
  },
  {
    id: "show-dhcp",
    words: ["show", "dhcp"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-dhcp" } }),
  },
  {
    id: "show-dns",
    words: ["show", "dns"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-dns" } }),
  },
  {
    id: "show-ospf",
    words: ["show", "ospf"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-ospf" } }),
  },
  {
    id: "show-ospf-database",
    words: ["show", "ospf", "database"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-ospf-database" } }),
  },
  {
    id: "show-vrrp",
    words: ["show", "vrrp"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-vrrp" } }),
  },
  {
    id: "show-rip",
    words: ["show", "rip"],
    syntax: "",
    modes: ALL_MODES,
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "show-rip" } }),
  },
  {
    id: "dns-enable",
    words: ["dns", "enable"],
    syntax: "",
    modes: ["config"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => ok(mode, { edit: (doc) => setDnsEnabled(doc, { deviceId: device.id, enabled: true }) }),
  },
  {
    id: "dns-disable",
    words: ["dns", "disable"],
    syntax: "",
    modes: ["config"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => ok(mode, { edit: (doc) => setDnsEnabled(doc, { deviceId: device.id, enabled: false }) }),
  },
  {
    id: "dns-record",
    words: ["dns", "record"],
    syntax: "<nom> <adresse>",
    modes: ["config"],
    devices: ["router"],
    required: ["nom", "adresse"],
    maxArgs: 2,
    run: ({ device, mode, args }) => {
      const parsed = parseDnsRecordInput(args[0] ?? "", args[1] ?? "");
      if (!parsed.ok) return invalid(mode, parsed.errors);
      return ok(mode, { edit: (doc) => setDnsRecord(doc, { deviceId: device.id, name: parsed.name, address: parsed.address }) });
    },
  },
  {
    id: "dns-delete",
    words: ["dns", "delete"],
    syntax: "<nom>",
    modes: ["config"],
    devices: ["router"],
    required: ["nom"],
    maxArgs: 1,
    run: ({ device, mode, args }) => ok(mode, { edit: (doc) => setDnsRecord(doc, { deviceId: device.id, name: args[0] ?? "", address: null }) }),
  },
  {
    id: "clear-arp",
    words: ["clear", "arp"],
    syntax: "",
    modes: ["operation"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "clear-table", table: "arp" } }),
  },
  {
    id: "clear-mac",
    words: ["clear", "mac"],
    syntax: "",
    modes: ["operation"],
    devices: ["switch"],
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode, { request: { kind: "clear-table", table: "mac" } }),
  },
  // ------------------------------------------------ Navigation entre les modes
  {
    id: "configure",
    words: ["configure"],
    syntax: "",
    modes: ["operation"],
    devices: NETWORK_DEVICES,
    required: [],
    maxArgs: 0,
    run: () => ok({ kind: "config" }),
  },
  {
    id: "exit",
    words: ["exit"],
    syntax: "",
    modes: ["config", "interface"],
    devices: NETWORK_DEVICES,
    required: [],
    maxArgs: 0,
    run: ({ mode }) => ok(mode.kind === "interface" ? { kind: "config" } : OPERATION_MODE),
  },
  {
    id: "end",
    words: ["end"],
    syntax: "",
    modes: ["config", "interface"],
    devices: NETWORK_DEVICES,
    required: [],
    maxArgs: 0,
    run: () => ok(OPERATION_MODE),
  },
  // ------------------------------------------------ Configuration
  {
    id: "hostname",
    words: ["hostname"],
    syntax: "<nom>",
    modes: ["config"],
    devices: NETWORK_DEVICES,
    required: ["nom"],
    maxArgs: 1,
    run: ({ device, mode, args }) => ok(mode, { edit: (doc) => renameDevice(doc, { deviceId: device.id, name: args[0] ?? "" }) }),
  },
  {
    id: "interface",
    words: ["interface"],
    syntax: "<port>[.<vlan>]",
    modes: ["config", "interface"],
    devices: NETWORK_DEVICES,
    required: ["port"],
    maxArgs: 1,
    run: ({ device, mode, args }) => {
      const model = getModel(device.model);
      const ports = model.ports.map((port) => port.id);
      const port = (args[0] ?? "").toLowerCase();
      // Sous-interface 802.1Q « port.vlan » : routeurs seulement.
      const sub = model.kind === "router" ? parseSubinterface(port) : null;
      if (sub && ports.includes(sub.parent)) return ok({ kind: "interface", portId: subinterfaceId(sub.parent, sub.vlan) });
      if (!ports.includes(port)) return fail(mode, "cli.unknown-port", { port: args[0] ?? "", ports: ports.join(", ") });
      return ok({ kind: "interface", portId: port });
    },
  },
  {
    id: "access-vlan",
    words: ["access", "vlan"],
    syntax: "<vlan>",
    modes: ["interface"],
    devices: ["switch"],
    required: ["vlan"],
    maxArgs: 1,
    run: ({ device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "access vlan" });
      const vlan = vlanNumber(args[0] ?? "");
      if (vlan === null) return invalid(mode, [error("vlan.invalid-id", { value: args[0] ?? "", min: VLAN_MIN, max: VLAN_MAX })]);
      return ok(mode, { edit: (doc) => setSwitchport(doc, { deviceId: device.id, portId: mode.portId, switchport: { mode: "access", vlan } }) });
    },
  },
  {
    id: "trunk",
    words: ["trunk"],
    syntax: "[native <vlan>] [allowed <liste>|all]",
    modes: ["interface"],
    devices: ["switch"],
    required: [],
    maxArgs: 4,
    run: ({ device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "trunk" });
      let nativeVlan = DEFAULT_VLAN;
      let allowedVlans: "all" | number[] = "all";
      for (let index = 0; index < args.length; index += 2) {
        const keyword = (args[index] ?? "").toLowerCase();
        const value = args[index + 1];
        if (keyword !== "native" && keyword !== "allowed") return fail(mode, "cli.unexpected-argument", { word: args[index] ?? "" });
        if (value === undefined) return fail(mode, "cli.missing-argument", { argument: keyword === "native" ? "vlan" : "liste" });
        if (keyword === "native") {
          const vlan = vlanNumber(value);
          if (vlan === null) return invalid(mode, [error("vlan.invalid-id", { value, min: VLAN_MIN, max: VLAN_MAX })]);
          nativeVlan = vlan;
        } else {
          const list = parseVlanList(value);
          if (list === null) return invalid(mode, [error("vlan.invalid-id", { value, min: VLAN_MIN, max: VLAN_MAX })]);
          allowedVlans = list;
        }
      }
      return ok(mode, { edit: (doc) => setSwitchport(doc, { deviceId: device.id, portId: mode.portId, switchport: { mode: "trunk", nativeVlan, allowedVlans } }) });
    },
  },
  {
    id: "address",
    words: ["address"],
    syntax: "<adresse>/<préfixe> | <adresse> <masque>",
    modes: ["interface"],
    devices: ["router"],
    required: ["adresse"],
    maxArgs: 2,
    run: ({ device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "address" });
      const { address, mask } = splitCidr(args);
      if (mask === "") return fail(mode, "cli.missing-argument", { argument: "masque" });
      const parsed = parseIpv4Input(address, mask);
      if (!parsed.ok) return invalid(mode, parsed.errors);
      return ok(mode, { edit: (doc) => setInterfaceIpv4(doc, { deviceId: device.id, portId: mode.portId, ipv4: parsed.ipv4 }) });
    },
  },
  {
    id: "address-clear",
    words: ["address", "clear"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "address clear" });
      return ok(mode, { edit: (doc) => setInterfaceIpv4(doc, { deviceId: device.id, portId: mode.portId, ipv4: null }) });
    },
  },
  {
    id: "dhcp-pool",
    words: ["dhcp", "pool"],
    syntax: "<début> <fin> [gateway <passerelle>] [lease <durée>]",
    modes: ["interface"],
    devices: ["router"],
    required: ["début", "fin"],
    maxArgs: 6,
    run: ({ doc, device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "dhcp pool" });
      const [start = "", end = "", ...options] = args;
      // Par défaut : l'adresse de l'interface comme passerelle, bail d'un jour.
      let gateway = doc.configurations[device.id]?.interfaces[mode.portId]?.ipv4?.address ?? "";
      let lease = formatLeaseDuration(DHCP_LEASE_DEFAULT);
      for (let index = 0; index < options.length; index += 2) {
        const keyword = (options[index] ?? "").toLowerCase();
        const value = options[index + 1];
        if (keyword !== "gateway" && keyword !== "lease") return fail(mode, "cli.unexpected-argument", { word: options[index] ?? "" });
        if (value === undefined) return fail(mode, "cli.missing-argument", { argument: keyword === "gateway" ? "passerelle" : "durée" });
        if (keyword === "gateway") gateway = value;
        else lease = value;
      }
      if (gateway === "") return invalid(mode, [error("dhcp.interface-not-addressed", { deviceId: device.id, deviceName: device.name, portId: mode.portId })]);
      const parsed = parseDhcpPoolInput({ start, end, gateway, lease });
      if (!parsed.ok) return invalid(mode, parsed.errors);
      return ok(mode, { edit: (current) => setDhcpPool(current, { deviceId: device.id, interfaceId: mode.portId, pool: parsed.pool }) });
    },
  },
  {
    id: "dhcp-clear",
    words: ["dhcp", "clear"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "dhcp clear" });
      return ok(mode, { edit: (doc) => setDhcpPool(doc, { deviceId: device.id, interfaceId: mode.portId, pool: null }) });
    },
  },
  {
    id: "rip-enable",
    words: ["rip", "enable"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "rip enable" });
      return ok(mode, { edit: (doc) => setRipInterface(doc, { deviceId: device.id, interfaceId: mode.portId, mode: "active" }) });
    },
  },
  {
    id: "rip-passive",
    words: ["rip", "passive"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "rip passive" });
      return ok(mode, { edit: (doc) => setRipInterface(doc, { deviceId: device.id, interfaceId: mode.portId, mode: "passive" }) });
    },
  },
  {
    id: "rip-disable",
    words: ["rip", "disable"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "rip disable" });
      return ok(mode, { edit: (doc) => setRipInterface(doc, { deviceId: device.id, interfaceId: mode.portId, mode: null }) });
    },
  },
  {
    id: "ospf-enable",
    words: ["ospf", "enable"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ doc, device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "ospf enable" });
      return ok(mode, { edit: (current) => setOspfInterface(current, { deviceId: device.id, interfaceId: mode.portId, ospf: ospfWith(doc, device, mode.portId, { mode: "active" }) }) });
    },
  },
  {
    id: "ospf-passive",
    words: ["ospf", "passive"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ doc, device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "ospf passive" });
      return ok(mode, { edit: (current) => setOspfInterface(current, { deviceId: device.id, interfaceId: mode.portId, ospf: ospfWith(doc, device, mode.portId, { mode: "passive" }) }) });
    },
  },
  {
    id: "ospf-disable",
    words: ["ospf", "disable"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "ospf disable" });
      return ok(mode, { edit: (current) => setOspfInterface(current, { deviceId: device.id, interfaceId: mode.portId, ospf: null }) });
    },
  },
  {
    id: "ospf-cost",
    words: ["ospf", "cost"],
    syntax: "<coût>",
    modes: ["interface"],
    devices: ["router"],
    required: ["coût"],
    maxArgs: 1,
    run: ({ doc, device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "ospf cost" });
      const cost = /^\d{1,5}$/.test(args[0] ?? "") ? Number(args[0]) : Number.NaN;
      if (!isOspfCost(cost)) return invalid(mode, [error("ospf.invalid-cost", { value: args[0] ?? "", min: OSPF_COST_MIN, max: OSPF_COST_MAX })]);
      const current = doc.configurations[device.id]?.ospfInterfaces[mode.portId];
      if (!current) return invalid(mode, [error("ospf.interface-not-enabled", { deviceId: device.id, deviceName: device.name, portId: mode.portId })]);
      return ok(mode, { edit: (next) => setOspfInterface(next, { deviceId: device.id, interfaceId: mode.portId, ospf: { ...current, cost } }) });
    },
  },
  {
    id: "ospf-priority",
    words: ["ospf", "priority"],
    syntax: "<priorité>",
    modes: ["interface"],
    devices: ["router"],
    required: ["priorité"],
    maxArgs: 1,
    run: ({ doc, device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "ospf priority" });
      const priority = /^\d{1,3}$/.test(args[0] ?? "") ? Number(args[0]) : Number.NaN;
      if (!isOspfPriority(priority)) return invalid(mode, [error("ospf.invalid-priority", { value: args[0] ?? "", max: OSPF_PRIORITY_MAX })]);
      const current = doc.configurations[device.id]?.ospfInterfaces[mode.portId];
      if (!current) return invalid(mode, [error("ospf.interface-not-enabled", { deviceId: device.id, deviceName: device.name, portId: mode.portId })]);
      return ok(mode, { edit: (next) => setOspfInterface(next, { deviceId: device.id, interfaceId: mode.portId, ospf: { ...current, priority } }) });
    },
  },
  {
    id: "vrrp-group",
    words: ["vrrp"],
    syntax: "<vrid> <adresse> [priority <priorité>] [preempt on|off]",
    modes: ["interface"],
    devices: ["router"],
    required: ["vrid", "adresse"],
    maxArgs: 6,
    run: ({ device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "vrrp" });
      const [vridText = "", address = "", ...options] = args;
      const vrid = /^\d{1,3}$/.test(vridText) ? Number(vridText) : Number.NaN;
      if (!isVrid(vrid)) return invalid(mode, [error("vrrp.invalid-vrid", { value: vridText, min: VRID_MIN, max: VRID_MAX })]);
      if (!isIpv4Address(address)) return invalid(mode, [error("ipv4.invalid-address", { value: address })]);
      let priority = VRRP_DEFAULT_PRIORITY;
      let preempt = true;
      for (let index = 0; index < options.length; index += 2) {
        const keyword = (options[index] ?? "").toLowerCase();
        const value = options[index + 1];
        if (keyword !== "priority" && keyword !== "preempt") return fail(mode, "cli.unexpected-argument", { word: options[index] ?? "" });
        if (value === undefined) return fail(mode, "cli.missing-argument", { argument: keyword === "priority" ? "priorité" : "on|off" });
        if (keyword === "priority") {
          priority = /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
          if (!isVrrpPriority(priority)) return invalid(mode, [error("vrrp.invalid-priority", { value, min: VRRP_PRIORITY_MIN, max: VRRP_PRIORITY_MAX })]);
        } else {
          const choice = value.toLowerCase();
          if (choice !== "on" && choice !== "off") return fail(mode, "cli.unexpected-argument", { word: value });
          preempt = choice === "on";
        }
      }
      return ok(mode, { edit: (doc) => setVrrpGroup(doc, { deviceId: device.id, interfaceId: mode.portId, group: { vrid, address, priority, preempt } }) });
    },
  },
  {
    id: "vrrp-clear",
    words: ["vrrp", "clear"],
    syntax: "",
    modes: ["interface"],
    devices: ["router"],
    required: [],
    maxArgs: 0,
    run: ({ device, mode }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "vrrp clear" });
      return ok(mode, { edit: (doc) => setVrrpGroup(doc, { deviceId: device.id, interfaceId: mode.portId, group: null }) });
    },
  },
  {
    id: "ospf-area",
    words: ["ospf", "area"],
    syntax: "<zone>",
    modes: ["interface"],
    devices: ["router"],
    required: ["zone"],
    maxArgs: 1,
    run: ({ doc, device, mode, args }) => {
      if (mode.kind !== "interface") return fail(mode, "cli.wrong-mode", { command: "ospf area" });
      const area = parseOspfArea(args[0] ?? "");
      if (area === null) return invalid(mode, [error("ospf.invalid-area", { value: args[0] ?? "" })]);
      const current = doc.configurations[device.id]?.ospfInterfaces[mode.portId];
      if (!current) return invalid(mode, [error("ospf.interface-not-enabled", { deviceId: device.id, deviceName: device.name, portId: mode.portId })]);
      return ok(mode, { edit: (next) => setOspfInterface(next, { deviceId: device.id, interfaceId: mode.portId, ospf: { ...current, area } }) });
    },
  },
  {
    id: "route-add",
    words: ["route", "add"],
    syntax: "<réseau>/<préfixe> via <prochain-saut>",
    modes: ["config"],
    devices: ["router"],
    required: ["réseau", "via", "prochain-saut"],
    maxArgs: 4,
    run: ({ device, mode, args }) => {
      const { address, mask, rest } = splitCidr(args);
      const [via, nextHop] = rest;
      if (via?.toLowerCase() !== "via") return fail(mode, "cli.missing-argument", { argument: "via" });
      if (nextHop === undefined) return fail(mode, "cli.missing-argument", { argument: "prochain-saut" });
      const parsed = parseRouteInput(address, mask, nextHop);
      if (!parsed.ok) return invalid(mode, parsed.errors);
      return ok(mode, { edit: (doc) => addStaticRoute(doc, { deviceId: device.id, route: parsed.route }) });
    },
  },
  {
    id: "route-delete",
    words: ["route", "delete"],
    syntax: "<réseau>/<préfixe>",
    modes: ["config"],
    devices: ["router"],
    required: ["réseau"],
    maxArgs: 2,
    run: ({ device, mode, args }) => {
      const { address, mask } = splitCidr(args);
      const parsed = parseIpv4Input(address, mask);
      if (!parsed.ok) return invalid(mode, parsed.errors);
      return ok(mode, {
        edit: (doc) =>
          removeStaticRoute(doc, { deviceId: device.id, destination: parsed.ipv4.address, prefixLength: parsed.ipv4.prefixLength }),
      });
    },
  },
];

function available(device: Device, mode: CliMode): CommandSpec[] {
  const kind = getModel(device.model).kind;
  return COMMANDS.filter((spec) => spec.devices.includes(kind) && spec.modes.includes(mode.kind));
}

function usage(spec: CommandSpec): string {
  return [...spec.words, spec.syntax].filter(Boolean).join(" ");
}

function helpEntries(device: Device, mode: CliMode): CliHelpEntry[] {
  return available(device, mode).map((spec) => ({ id: spec.id, usage: usage(spec) }));
}

/** Distance d'édition (suggestions de correction). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0;
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

type Match =
  | { readonly kind: "found"; readonly spec: CommandSpec; readonly args: string[] }
  | { readonly kind: "ambiguous"; readonly word: string; readonly candidates: string[] }
  | { readonly kind: "incomplete"; readonly command: string; readonly options: string[] }
  | { readonly kind: "none"; readonly word: string };

/**
 * Associe les premiers mots de la ligne à une commande. Chaque mot-clé peut
 * être abrégé (« sh int » = « show interfaces ») s'il n'y a pas d'ambiguïté ;
 * les mots restants sont les arguments. À mots-clés communs, la commande la
 * plus longue l'emporte (« address clear » plutôt que « address »).
 */
function match(specs: readonly CommandSpec[], tokens: readonly string[]): Match {
  let candidates = [...specs];
  let depth = 0;
  for (; depth < tokens.length; depth += 1) {
    const word = (tokens[depth] ?? "").toLowerCase();
    const continuing = candidates.filter((spec) => spec.words.length > depth);
    if (continuing.length === 0) break;
    const exact = continuing.filter((spec) => spec.words[depth] === word);
    const prefixed = exact.length > 0 ? exact : continuing.filter((spec) => spec.words[depth]?.startsWith(word));
    const keywords = [...new Set(prefixed.map((spec) => spec.words[depth] ?? ""))];
    if (keywords.length > 1) return { kind: "ambiguous", word, candidates: keywords.sort() };
    const completeHere = candidates.filter((spec) => spec.words.length === depth);
    if (keywords.length === 0) {
      // Mot qui n'est pas un mot-clé : premier argument d'une commande déjà complète.
      if (completeHere.length > 0) break;
      return depth === 0 ? { kind: "none", word } : { kind: "incomplete", command: tokens.slice(0, depth).join(" "), options: nextWords(candidates, depth) };
    }
    candidates = [...prefixed, ...completeHere];
  }
  const spec = candidates.filter((item) => item.words.length <= depth).sort((a, b) => b.words.length - a.words.length)[0];
  if (!spec) return { kind: "incomplete", command: tokens.slice(0, depth).join(" "), options: nextWords(candidates, depth) };
  return { kind: "found", spec, args: tokens.slice(spec.words.length) };
}

function nextWords(specs: readonly CommandSpec[], depth: number): string[] {
  return [...new Set(specs.flatMap((spec) => (spec.words.length > depth ? [spec.words[depth] ?? ""] : [])))].sort();
}

/** Commandes dont les premiers mots-clés commencent par les mots donnés. */
function startingWith(specs: readonly CommandSpec[], words: readonly string[]): CommandSpec[] {
  return specs.filter((spec) => words.every((word, index) => spec.words[index]?.startsWith(word.toLowerCase()) ?? false));
}

/** Exécute une ligne saisie dans la console d'un équipement. */
export function interpret(doc: NfgDocument, deviceId: string, mode: CliMode, line: string): CliResult {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  if (!device) return invalid(mode, [error("device.not-found", { deviceId })]);
  const tokens = tokenize(line);
  if (tokens.length === 0) return ok(mode);

  // « ? » en fin de ligne : aide contextuelle sur les commandes qui commencent ainsi.
  if (tokens.at(-1) === "?") {
    const entries = startingWith(available(device, mode), tokens.slice(0, -1)).map((spec) => ({ id: spec.id, usage: usage(spec) }));
    return ok(mode, { request: { kind: "help", entries } });
  }

  const found = match(available(device, mode), tokens);
  if (found.kind === "ambiguous") return fail(mode, "cli.ambiguous", { word: found.word, candidates: found.candidates.join(", ") });
  if (found.kind === "incomplete") return fail(mode, "cli.incomplete", { command: found.command, options: found.options.join(", ") });
  if (found.kind === "none") {
    // Commande existante dans un autre mode : on l'indique plutôt que de la dire inconnue.
    const kind = getModel(device.model).kind;
    const elsewhere = match(
      COMMANDS.filter((spec) => spec.devices.includes(kind)),
      tokens,
    );
    if (elsewhere.kind === "found") {
      return fail(mode, "cli.wrong-mode", { command: elsewhere.spec.words.join(" "), mode: elsewhere.spec.modes[0] ?? "operation" });
    }
    const keywords = [...new Set(available(device, mode).map((spec) => spec.words[0] ?? ""))];
    const suggestion = keywords
      .map((keyword) => ({ keyword, score: distance(found.word, keyword) }))
      .filter((item) => item.score <= 2)
      .sort((a, b) => a.score - b.score || a.keyword.localeCompare(b.keyword))[0]?.keyword;
    return fail(mode, "cli.unknown-command", { word: found.word, suggestion: suggestion ?? "" });
  }
  const { spec, args } = found;
  if (args.length < spec.required.length) {
    return fail(mode, "cli.missing-argument", { argument: spec.required[args.length] ?? "", usage: usage(spec) });
  }
  if (args.length > spec.maxArgs) return fail(mode, "cli.unexpected-argument", { word: args[spec.maxArgs] ?? "" });
  return spec.run({ doc, device, mode, args });
}

/** Invite de commande : « R1> », « R1(config)> », « R1(config ge0)> », « PC1> ». */
export function cliPrompt(device: Device, mode: CliMode): string {
  if (mode.kind === "config") return `${device.name}(config)>`;
  if (mode.kind === "interface") return `${device.name}(config ${mode.portId})>`;
  return `${device.name}>`;
}

/**
 * Complétion par la touche Tab : complète le dernier mot s'il n'existe
 * qu'une possibilité, sinon renvoie la liste des possibilités.
 */
export function complete(doc: NfgDocument, deviceId: string, mode: CliMode, line: string): { line: string; candidates: string[] } {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  if (!device) return { line, candidates: [] };
  const endsWithSpace = /\s$/.test(line);
  const tokens = tokenize(line);
  const done = endsWithSpace ? tokens : tokens.slice(0, -1);
  const partial = endsWithSpace ? "" : (tokens.at(-1) ?? "").toLowerCase();
  const options = new Set<string>();
  for (const spec of available(device, mode)) {
    const keywords = done.slice(0, spec.words.length);
    if (startingWith([spec], keywords).length === 0) continue;
    const next = spec.words[done.length];
    if (next !== undefined) options.add(next);
    // Après « interface », propose les ports de l'équipement.
    else if (spec.id === "interface" && done.length === 1) for (const port of getModel(device.model).ports) options.add(port.id);
  }
  const candidates = [...options].filter((option) => option.startsWith(partial)).sort();
  if (candidates.length === 1) {
    return { line: [...done, candidates[0]].join(" ") + " ", candidates };
  }
  return { line, candidates };
}

/**
 * Configuration d'un équipement réécrite sous forme de commandes de la
 * console : la rejouer sur un équipement vierge redonne la même configuration.
 */
export function configurationCommands(doc: NfgDocument, deviceId: string): string[] {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  if (!device) return [];
  const config = doc.configurations[device.id];
  const model = getModel(device.model);
  if (model.kind === "pc") {
    const lines: string[] = [];
    const ipv4 = config?.interfaces[pcPort(device)]?.ipv4;
    if (config?.interfaces[pcPort(device)]?.dhcp) lines.push("ipconfig dhcp");
    else if (ipv4) lines.push(["ipconfig set", ipv4.address, prefixToMask(ipv4.prefixLength), config.defaultGateway ?? ""].join(" ").trim());
    if (config?.dnsServer) lines.push(`ipconfig dns ${config.dnsServer}`);
    return lines;
  }
  const lines = ["configure", `hostname ${device.name}`];
  for (const port of model.ports) {
    const ipv4 = config?.interfaces[port.id]?.ipv4;
    if (ipv4) lines.push(`interface ${port.id}`, `address ${ipv4.address}/${String(ipv4.prefixLength)}`, "exit");
    // Sous-interfaces 802.1Q du port, par VLAN croissant.
    const subinterfaces = Object.entries(config?.interfaces ?? {})
      .flatMap(([id, value]) => {
        const sub = parseSubinterface(id);
        return sub?.parent === port.id && value.ipv4 ? [{ id, vlan: sub.vlan, ipv4: value.ipv4 }] : [];
      })
      .sort((a, b) => a.vlan - b.vlan);
    for (const sub of subinterfaces) lines.push(`interface ${sub.id}`, `address ${sub.ipv4.address}/${String(sub.ipv4.prefixLength)}`, "exit");
    // Plages DHCP, RIP, OSPF et VRRP du port puis de ses sous-interfaces (après leurs adresses).
    for (const id of [port.id, ...subinterfaces.map((sub) => sub.id)]) {
      const pool = config?.dhcpPools[id];
      if (pool) lines.push(`interface ${id}`, `dhcp pool ${pool.start} ${pool.end} gateway ${pool.gateway} lease ${formatLeaseDuration(pool.leaseSeconds)}`, "exit");
      const rip = config?.ripInterfaces[id];
      if (rip) lines.push(`interface ${id}`, rip === "active" ? "rip enable" : "rip passive", "exit");
      const ospf = config?.ospfInterfaces[id];
      if (ospf) {
        lines.push(`interface ${id}`, ospf.mode === "active" ? "ospf enable" : "ospf passive");
        // Coût et priorité : seulement s'ils diffèrent des valeurs par défaut.
        if (ospf.cost !== OSPF_DEFAULT_COST) lines.push(`ospf cost ${String(ospf.cost)}`);
        if (ospf.priority !== OSPF_DEFAULT_PRIORITY) lines.push(`ospf priority ${String(ospf.priority)}`);
        if (ospf.area !== OSPF_BACKBONE_AREA) lines.push(`ospf area ${ospf.area}`);
        lines.push("exit");
      }
      const vrrp = config?.vrrpGroups[id];
      if (vrrp) {
        // Priorité et préemption : seulement si elles diffèrent des valeurs par défaut (100, préemption active).
        const options = [vrrp.priority !== VRRP_DEFAULT_PRIORITY ? `priority ${String(vrrp.priority)}` : "", vrrp.preempt ? "" : "preempt off"].filter(Boolean);
        lines.push(`interface ${id}`, [`vrrp ${String(vrrp.vrid)} ${vrrp.address}`, ...options].join(" "), "exit");
      }
    }
    const switchport = config?.switchports[port.id];
    if (switchport?.mode === "access") lines.push(`interface ${port.id}`, `access vlan ${String(switchport.vlan)}`, "exit");
    if (switchport?.mode === "trunk") {
      lines.push(`interface ${port.id}`, ["trunk", `native ${String(switchport.nativeVlan)}`, `allowed ${formatVlanList(switchport.allowedVlans)}`].join(" "), "exit");
    }
  }
  for (const route of config?.staticRoutes ?? []) {
    lines.push(`route add ${route.destination}/${String(route.prefixLength)} via ${route.nextHop}`);
  }
  // Service DNS : activé (même sans nom), puis ses enregistrements par nom.
  if (config?.dnsRecords) {
    lines.push("dns enable");
    for (const record of sortedDnsRecords(config.dnsRecords)) lines.push(`dns record ${record.name} ${record.address}`);
  }
  // STP : seulement ce qui diffère d'un switch neuf (activé, priorité 32768).
  if (config?.stp && !config.stp.enabled) lines.push("spanning-tree disable");
  if (config?.stp && config.stp.priority !== STP_DEFAULT_PRIORITY) lines.push(`spanning-tree priority ${String(config.stp.priority)}`);
  lines.push("end");
  return lines;
}
