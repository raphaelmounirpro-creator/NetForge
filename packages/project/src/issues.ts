/**
 * Problèmes détectés sur un projet : code stable + paramètres.
 * Le texte affiché est produit par l'interface (i18n) à partir du code,
 * ce qui permet une traduction future et une CLI cohérente avec les formulaires.
 */
export const ISSUE_CODES = [
  // Import et format
  "import.too-large",
  "import.invalid-json",
  "import.too-deep",
  "import.too-many-nodes",
  "import.forbidden-key",
  "import.not-netforge",
  "import.future-version",
  "import.unsupported-version",
  "import.schema",
  // Projet
  "project.invalid-name",
  "project.too-many-devices",
  "project.too-many-links",
  // Équipements
  "device.not-found",
  "device.duplicate-id",
  "device.invalid-name",
  "device.duplicate-name",
  // Liens
  "link.not-found",
  "link.duplicate-id",
  "link.unknown-device",
  "link.unknown-port",
  "link.same-device",
  "link.port-in-use",
  "link.no-free-port",
  "link.incompatible-media",
  "link.fiber-missing",
  "link.fiber-unexpected",
  "link.invalid-fiber",
  "topology.switch-loop",
  // Configurations et disposition
  "config.missing",
  "config.unknown-device",
  "config.unknown-port",
  "config.not-ip-capable",
  "config.gateway-not-supported",
  "config.invalid-subinterface",
  "config.subinterface-not-supported",
  "config.switchports-not-supported",
  "config.stp-not-supported",
  "stp.invalid-priority",
  // DHCP
  "config.dhcp-client-not-supported",
  "config.dhcp-with-address",
  "config.dhcp-with-gateway",
  "config.dhcp-server-not-supported",
  "dhcp.invalid-lease",
  "dhcp.interface-not-addressed",
  "dhcp.invalid-range",
  "dhcp.range-outside-subnet",
  "dhcp.gateway-outside-subnet",
  "dhcp.range-contains-static",
  // DNS
  "dns.client-not-supported",
  "dns.server-not-supported",
  "dns.invalid-name",
  "dns.invalid-address",
  "dns.too-many-records",
  "dns.record-not-found",
  // RIP
  "rip.not-supported",
  "rip.interface-not-addressed",
  // OSPF
  "ospf.not-supported",
  "ospf.interface-not-addressed",
  "ospf.interface-not-enabled",
  "ospf.invalid-cost",
  "ospf.invalid-priority",
  "ospf.invalid-area",
  "ospf.abr-without-backbone",
  "ospf.area-mismatch",
  // BGP
  "bgp.not-supported",
  "bgp.not-enabled",
  "bgp.invalid-as",
  "bgp.internal-neighbor",
  "bgp.duplicate-neighbor",
  "bgp.neighbor-not-found",
  "bgp.neighbor-not-connected",
  "bgp.not-network-address",
  "bgp.duplicate-network",
  "bgp.network-not-found",
  "bgp.too-many",
  // PON (v13)
  "pon.not-olt",
  "pon.not-ont",
  "pon.not-pon-port",
  "pon.invalid-serial",
  "pon.invalid-onu-id",
  "pon.duplicate-serial",
  "pon.duplicate-onu-id",
  "pon.not-authorized",
  "pon.too-many",
  "pon.no-free-onu-id",
  "pon.missing-serial",
  "pon.duplicate-ont-serial",
  "pon.invalid-rate",
  "pon.invalid-service-list",
  "pon.service-invalid-rate",
  "pon.service-direction",
  "pon.service-duplicate-vlan",
  "pon.service-undefined",
  // VRRP
  "vrrp.not-supported",
  "vrrp.interface-not-addressed",
  "vrrp.invalid-vrid",
  "vrrp.invalid-priority",
  "vrrp.address-outside-subnet",
  "vrrp.address-mismatch",
  // VLAN
  "vlan.invalid-id",
  "vlan.mode-mismatch",
  "vlan.native-mismatch",
  "vlan.subinterfaces-on-access-port",
  "layout.missing",
  "layout.unknown-device",
  "annotation.not-found",
  "annotation.invalid-text",
  "annotation.too-many",
  "annotation.duplicate-id",
  // Pannes optiques
  "fault.not-found",
  "fault.too-many",
  "fault.unknown-target",
  "fault.invalid-target",
  "fault.invalid-loss",
  "fault.duplicate",
  "fault.position-not-supported",
  "fault.position-out-of-range",
  "repair.nothing-found",
  // IPv4
  "ipv4.invalid-address",
  "ipv4.invalid-mask",
  "ipv4.unassignable",
  "ipv4.overlap",
  "ipv4.duplicate-address",
  "gateway.unassignable",
  "gateway.without-address",
  "gateway.outside-subnet",
  "gateway.is-own-address",
  // Routes statiques
  "config.routes-not-supported",
  "route.not-found",
  "route.too-many",
  "route.not-network-address",
  "route.duplicate",
  "route.invalid-next-hop",
  "route.next-hop-is-own-address",
  "route.next-hop-not-connected",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];
export type IssueSeverity = "error" | "warning";
export type IssueParams = Readonly<Record<string, string | number>>;

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  params: IssueParams;
}

export function error(code: IssueCode, params: IssueParams = {}): Issue {
  return { code, severity: "error", params };
}

export function warning(code: IssueCode, params: IssueParams = {}): Issue {
  return { code, severity: "warning", params };
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
