import { parseNfgValue, type Issue, type NfgDocument } from "@netforge/project";

/** Projet tel qu'enregistré localement, avec sa révision. */
export interface StoredProject {
  document: NfgDocument;
  /** Incrémentée à chaque enregistrement : sert à détecter les écritures concurrentes. */
  revision: number;
  savedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  revision: number;
  savedAt: string;
  deviceCount: number;
  linkCount: number;
  /** Faux si le contenu enregistré ne passe plus la validation. */
  readable: boolean;
}

export type LoadOutcome =
  | { ok: true; project: StoredProject }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "invalid"; issues: Issue[] };

export type SaveOutcome = { ok: true; revision: number } | { ok: false; reason: "conflict"; storedRevision: number | null };

export type StorageErrorKind = "quota" | "unavailable" | "unknown";

/** Échec du stockage du navigateur (quota, stockage bloqué…). */
export class StorageError extends Error {
  constructor(
    readonly kind: StorageErrorKind,
    options?: { cause?: unknown },
  ) {
    super(`Stockage local : ${kind}`, options);
    this.name = "StorageError";
  }
}

export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<LoadOutcome>;
  /**
   * Enregistre si la révision stockée vaut expectedRevision (null : projet
   * absent). Sinon renvoie un conflit sans rien écrire.
   */
  save(document: NfgDocument, expectedRevision: number | null): Promise<SaveOutcome>;
  remove(id: string): Promise<void>;
}

/** Enregistrement brut tel que stocké (validé à la lecture : donnée externe). */
export interface ProjectRecord {
  id: string;
  revision: number;
  savedAt: string;
  document: unknown;
}

export function toLoadOutcome(record: ProjectRecord | undefined): LoadOutcome {
  if (!record) return { ok: false, reason: "not-found" };
  const parsed = parseNfgValue(record.document);
  if (!parsed.ok) return { ok: false, reason: "invalid", issues: parsed.errors };
  return { ok: true, project: { document: parsed.document, revision: record.revision, savedAt: record.savedAt } };
}

export function toSummary(record: ProjectRecord): ProjectSummary {
  const parsed = parseNfgValue(record.document);
  const document = parsed.ok ? parsed.document : null;
  return {
    id: record.id,
    name: document?.metadata.name ?? record.id,
    revision: record.revision,
    savedAt: record.savedAt,
    deviceCount: document?.topology.devices.length ?? 0,
    linkCount: document?.topology.links.length ?? 0,
    readable: document !== null,
  };
}

export function sortSummaries(summaries: ProjectSummary[]): ProjectSummary[] {
  return [...summaries].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
