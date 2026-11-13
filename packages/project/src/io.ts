import { DEVICE_MODELS, getModel, type DeviceModelId } from "./catalog.js";
import { formatPonSerial } from "./pon.js";
import { error, type Issue } from "./issues.js";
import { STP_DEFAULT_PRIORITY } from "./stp.js";
import { CURRENT_SCHEMA_VERSION, LIMITS, NFG_FORMAT, nfgDocumentSchema, type NfgDocument } from "./schema.js";
import { validateDocument } from "./validation.js";

export type ParseResult = { ok: true; document: NfgDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };

const MAX_REPORTED_SCHEMA_ERRORS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Version 1 → 2 : ajout des routes statiques (liste vide pour chaque
 * équipement). Une structure inattendue est laissée telle quelle : la
 * validation du schéma la refusera ensuite avec un message précis.
 */
function migrateV1toV2(doc: Record<string, unknown>): Record<string, unknown> {
  const configurations = doc["configurations"];
  if (!isRecord(configurations)) return { ...doc, schemaVersion: 2 };
  const migrated: Record<string, unknown> = {};
  for (const [deviceId, config] of Object.entries(configurations)) {
    // Une clé déjà présente (fichier v1 retouché à la main) n'est pas écrasée :
    // elle sera validée par le schéma v2 plutôt que perdue silencieusement.
    migrated[deviceId] = isRecord(config) ? { ...config, staticRoutes: config["staticRoutes"] ?? [] } : config;
  }
  return { ...doc, schemaVersion: 2, configurations: migrated };
}

/** Version 2 → 3 : ajout des annotations libres (liste vide). */
function migrateV2toV3(doc: Record<string, unknown>): Record<string, unknown> {
  const layout = doc["layout"];
  if (!isRecord(layout)) return { ...doc, schemaVersion: 3 };
  return { ...doc, schemaVersion: 3, layout: { ...layout, annotations: layout["annotations"] ?? [] } };
}

/**
 * Version 3 → 4 : catalogue 2 (équipements FTTH, aucun modèle existant
 * modifié), propriété « fiber » des liens (null : tous les liens v3 sont en
 * cuivre) et liste des pannes (vide).
 */
function migrateV3toV4(doc: Record<string, unknown>): Record<string, unknown> {
  const topology = doc["topology"];
  const links: unknown[] | null = isRecord(topology) && Array.isArray(topology["links"]) ? (topology["links"] as unknown[]) : null;
  return {
    ...doc,
    schemaVersion: 4,
    models: isRecord(doc["models"]) && doc["models"]["catalog"] === 1 ? { ...doc["models"], catalog: 2 } : doc["models"],
    topology:
      isRecord(topology) && links
        ? { ...topology, links: links.map((link) => (isRecord(link) ? { ...link, fiber: link["fiber"] ?? null } : link)) }
        : topology,
    faults: doc["faults"] ?? [],
  };
}

/**
 * Version 4 → 5 : VLAN et STP. Chaque configuration reçoit une table de
 * ports de switch vide (tous les ports en accès dans le VLAN 1) ; un switch
 * reçoit STP désactivé (priorité 32768), les autres équipements aucune
 * configuration STP. Comportement identique à la version 4 : une boucle
 * existante reste une boucle (cas d'étude).
 */
function migrateV4toV5(doc: Record<string, unknown>): Record<string, unknown> {
  const configurations = doc["configurations"];
  if (!isRecord(configurations)) return { ...doc, schemaVersion: 5 };
  const topology = doc["topology"];
  const devices: unknown[] = isRecord(topology) && Array.isArray(topology["devices"]) ? (topology["devices"] as unknown[]) : [];
  const switches = new Set(
    devices.flatMap((device) =>
      isRecord(device) && typeof device["id"] === "string" && typeof device["model"] === "string" && isSwitchModel(device["model"]) ? [device["id"]] : [],
    ),
  );
  const migrated: Record<string, unknown> = {};
  for (const [id, config] of Object.entries(configurations)) {
    migrated[id] = isRecord(config)
      ? {
          ...config,
          switchports: config["switchports"] ?? {},
          stp: config["stp"] ?? (switches.has(id) ? { enabled: false, priority: STP_DEFAULT_PRIORITY } : null),
        }
      : config;
  }
  return { ...doc, schemaVersion: 5, configurations: migrated };
}

/** Version 5 → 6 : adressage manuel conservé, aucun serveur DHCP par défaut. */
function migrateV5toV6(doc: Record<string, unknown>): Record<string, unknown> {
  const configurations = doc["configurations"];
  if (!isRecord(configurations)) return { ...doc, schemaVersion: 6 };
  return {
    ...doc,
    schemaVersion: 6,
    configurations: Object.fromEntries(Object.entries(configurations).map(([id, config]) => [id, isRecord(config) ? {
      ...config,
      interfaces: isRecord(config["interfaces"])
        ? Object.fromEntries(Object.entries(config["interfaces"]).map(([port, value]) => [port, isRecord(value) ? { ...value, dhcp: value["dhcp"] ?? false } : value]))
        : config["interfaces"],
      dhcpPools: config["dhcpPools"] ?? {},
    } : config])),
  };
}

function isSwitchModel(model: string): boolean {
  return model in DEVICE_MODELS && getModel(model as DeviceModelId).kind === "switch";
}

/** Version 6 → 7 : aucun résolveur ni service DNS activé implicitement. */
function migrateV6toV7(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  return {
    ...doc,
    schemaVersion: 7,
    configurations: isRecord(configs)
      ? Object.fromEntries(Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, dnsServer: null, dnsRecords: null } : config]))
      : configs,
  };
}

/** Version 7 → 8 : aucun routeur ne participe à RIP. */
function migrateV7toV8(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  return {
    ...doc,
    schemaVersion: 8,
    configurations: isRecord(configs)
      ? Object.fromEntries(Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, ripInterfaces: {} } : config]))
      : configs,
  };
}

/** Version 8 → 9 : aucun routeur ne participe à OSPF. */
function migrateV8toV9(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  return {
    ...doc,
    schemaVersion: 9,
    configurations: isRecord(configs)
      ? Object.fromEntries(Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, ospfInterfaces: {} } : config]))
      : configs,
  };
}

/** Version 9 → 10 : aucun groupe VRRP. */
function migrateV9toV10(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  return {
    ...doc,
    schemaVersion: 10,
    configurations: isRecord(configs)
      ? Object.fromEntries(Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, vrrpGroups: {} } : config]))
      : configs,
  };
}

/** Version 10 → 11 : toutes les interfaces OSPF existantes sont dans la dorsale (zone 0.0.0.0). */
function migrateV10toV11(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  const withArea = (interfaces: unknown) =>
    isRecord(interfaces) ? Object.fromEntries(Object.entries(interfaces).map(([id, value]) => [id, isRecord(value) ? { ...value, area: "0.0.0.0" } : value])) : interfaces;
  return {
    ...doc,
    schemaVersion: 11,
    configurations: isRecord(configs)
      ? Object.fromEntries(Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, ospfInterfaces: withArea(config["ospfInterfaces"]) } : config]))
      : configs,
  };
}

/** Version 11 → 12 : aucun routeur ne participe à BGP. */
function migrateV11toV12(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  return {
    ...doc,
    schemaVersion: 12,
    configurations: isRecord(configs)
      ? Object.fromEntries(Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, bgp: null } : config]))
      : configs,
  };
}

/**
 * Version 12 → 13 : catalogue 3 (OLT et ONT XGS-PON ajoutés, aucun modèle
 * modifié). Chaque ONT reçoit un numéro de série NetForge, dans l'ordre des
 * équipements (NFGE00000001, NFGE00000002…) ; aucun OLT n'a d'ONT autorisé :
 * les ONT existants sont découverts mais pas enregistrés tant que le
 * formateur ne les autorise pas.
 */
function migrateV12toV13(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  const topology = doc["topology"];
  const devices: unknown[] = isRecord(topology) && Array.isArray(topology["devices"]) ? (topology["devices"] as unknown[]) : [];
  const serials = new Map<string, string>();
  for (const device of devices) {
    if (!isRecord(device) || typeof device["id"] !== "string" || typeof device["model"] !== "string") continue;
    if (!Object.hasOwn(DEVICE_MODELS, device["model"])) continue;
    if (getModel(device["model"] as DeviceModelId).kind === "ont") serials.set(device["id"], formatPonSerial(serials.size + 1));
  }
  return {
    ...doc,
    schemaVersion: 13,
    models: isRecord(doc["models"]) && doc["models"]["catalog"] === 2 ? { ...doc["models"], catalog: 3 } : doc["models"],
    configurations: isRecord(configs)
      ? Object.fromEntries(
          Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, ponAuthorizations: {}, serialNumber: serials.get(id) ?? null } : config]),
        )
      : configs,
  };
}

/**
 * Version 13 → 14 : aucun OLT n'a de profil de service, aucun ONT autorisé
 * n'a de service souscrit.
 */
function migrateV13toV14(doc: Record<string, unknown>): Record<string, unknown> {
  const configs = doc["configurations"];
  const withServices = (authorizations: unknown) =>
    isRecord(authorizations)
      ? Object.fromEntries(
          Object.entries(authorizations).map(([port, entries]) => [port, Array.isArray(entries) ? entries.map((entry: unknown) => (isRecord(entry) ? { ...entry, services: [] } : entry)) : entries]),
        )
      : authorizations;
  return {
    ...doc,
    schemaVersion: 14,
    configurations: isRecord(configs)
      ? Object.fromEntries(
          Object.entries(configs).map(([id, config]) => [id, isRecord(config) ? { ...config, ponAuthorizations: withServices(config["ponAuthorizations"]), ponServices: {} } : config]),
        )
      : configs,
  };
}

/**
 * Migrations explicites : MIGRATIONS[v] transforme un document de la version
 * v en version v + 1. Chaque nouvelle version ajoute ici une étape testée.
 */
const MIGRATIONS: Readonly<Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
  6: migrateV6toV7,
  7: migrateV7toV8,
  8: migrateV8toV9,
  9: migrateV9toV10,
  10: migrateV10toV11,
  11: migrateV11toV12,
  12: migrateV12toV13,
  13: migrateV13toV14,
};

/** Clés qui modifieraient le prototype des objets reconstruits : toujours refusées. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parcours itératif borné : refuse les structures trop profondes, trop
 * volumineuses ou porteuses de clés réservées, avant toute autre analyse.
 */
function checkStructure(value: unknown): Issue | null {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > LIMITS.maxJsonNodes) return error("import.too-many-nodes", { max: LIMITS.maxJsonNodes });
    if (typeof current.node !== "object" || current.node === null) continue;
    if (current.depth > LIMITS.maxJsonDepth) return error("import.too-deep", { max: LIMITS.maxJsonDepth });
    for (const [key, child] of Object.entries(current.node)) {
      if (FORBIDDEN_KEYS.has(key)) return error("import.forbidden-key", { key });
      stack.push({ node: child, depth: current.depth + 1 });
    }
  }
  return null;
}

/** Taille UTF-8 d'un texte, sans dépendre de TextEncoder (paquet sans DOM). */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function migrateToCurrent(raw: Record<string, unknown>): { ok: true; value: Record<string, unknown> } | { ok: false; error: Issue } {
  const version = raw["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: error("import.unsupported-version", { version: String(version) }) };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: error("import.future-version", { version, supported: CURRENT_SCHEMA_VERSION }) };
  }
  let value = raw;
  for (let step = version; step < CURRENT_SCHEMA_VERSION; step += 1) {
    const migrate = MIGRATIONS[step];
    if (!migrate) return { ok: false, error: error("import.unsupported-version", { version }) };
    value = migrate(value);
  }
  return { ok: true, value };
}

/**
 * Valide une valeur externe (import, stockage local) et renvoie un document
 * à la version courante. Aucune donnée n'est exécutée ni interprétée comme du code.
 */
export function parseNfgValue(raw: unknown): ParseResult {
  const structureIssue = checkStructure(raw);
  if (structureIssue) return { ok: false, errors: [structureIssue] };
  if (!isRecord(raw) || raw["format"] !== NFG_FORMAT) {
    return { ok: false, errors: [error("import.not-netforge")] };
  }
  const migrated = migrateToCurrent(raw);
  if (!migrated.ok) return { ok: false, errors: [migrated.error] };

  const parsed = nfgDocumentSchema.safeParse(migrated.value);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, MAX_REPORTED_SCHEMA_ERRORS)
      .map((issue) => error("import.schema", { path: issue.path.map(String).join(".") || "(racine)" }));
    return { ok: false, errors };
  }
  const issues = validateDocument(parsed.data);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, document: parsed.data, warnings: issues };
}

/** Analyse le texte d'un fichier .nfg.json, taille comprise. */
export function parseNfgText(text: string): ParseResult {
  // Un caractère UTF-16 occupe au moins un octet : rejet immédiat d'un texte trop long.
  if (text.length > LIMITS.maxImportBytes || utf8ByteLength(text) > LIMITS.maxImportBytes) {
    return { ok: false, errors: [error("import.too-large", { maxBytes: LIMITS.maxImportBytes })] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: [error("import.invalid-json")] };
  }
  return parseNfgValue(raw);
}

/** Sérialisation stable et lisible (indentation de 2 espaces). */
export function serializeNfg(doc: NfgDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Nom de fichier d'export dérivé du nom du projet. */
export function exportFileName(doc: NfgDocument): string {
  const base = doc.metadata.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${base || "projet"}.nfg.json`;
}
