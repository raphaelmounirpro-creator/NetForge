import { error, type Issue } from "./issues.js";
import { CURRENT_SCHEMA_VERSION, LIMITS, NFG_FORMAT, nfgDocumentSchema, type NfgDocument } from "./schema.js";
import { validateDocument } from "./validation.js";

export type ParseResult = { ok: true; document: NfgDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };

const MAX_REPORTED_SCHEMA_ERRORS = 10;

/**
 * Migrations explicites : MIGRATIONS[v] transforme un document de la version
 * v en version v + 1. Aucune migration tant que seule la version 1 existe ;
 * chaque nouvelle version ajoute ici une étape testée.
 */
const MIGRATIONS: Readonly<Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
