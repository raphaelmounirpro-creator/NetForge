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
