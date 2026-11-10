import type { NfgDocument } from "@netforge/project";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  sortSummaries,
  StorageError,
  toLoadOutcome,
  toSummary,
  type LoadOutcome,
  type ProjectRecord,
  type ProjectRepository,
  type ProjectSummary,
  type SaveOutcome,
} from "./repository";

interface NetForgeDb extends DBSchema {
  projects: { key: string; value: ProjectRecord };
}

const DB_NAME = "netforge";
const DB_VERSION = 1;

function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") return new StorageError("quota", { cause: error });
  if (["InvalidStateError", "SecurityError", "UnknownError", "NotFoundError"].includes(name)) {
    return new StorageError("unavailable", { cause: error });
  }
  return new StorageError("unknown", { cause: error });
}

/**
 * Projets invités dans IndexedDB. Chaque enregistrement vérifie la révision
 * dans la même transaction que l'écriture : une version enregistrée par un
 * autre onglet n'est jamais écrasée silencieusement.
 */
export class IndexedDbProjectRepository implements ProjectRepository {
  private dbPromise: Promise<IDBPDatabase<NetForgeDb>> | null = null;

  private db(): Promise<IDBPDatabase<NetForgeDb>> {
    this.dbPromise ??= openDB<NetForgeDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("projects", { keyPath: "id" });
      },
    }).catch((error: unknown) => {
      this.dbPromise = null;
      throw toStorageError(error);
    });
    return this.dbPromise;
  }

  async list(): Promise<ProjectSummary[]> {
    try {
      const records = await (await this.db()).getAll("projects");
      return sortSummaries(records.map(toSummary));
    } catch (error) {
      throw toStorageError(error);
    }
  }

  async load(id: string): Promise<LoadOutcome> {
    try {
      return toLoadOutcome(await (await this.db()).get("projects", id));
    } catch (error) {
      throw toStorageError(error);
    }
  }

  async save(document: NfgDocument, expectedRevision: number | null): Promise<SaveOutcome> {
    try {
      const transaction = (await this.db()).transaction("projects", "readwrite");
      const existing = await transaction.store.get(document.metadata.id);
      const storedRevision = existing?.revision ?? null;
      if (storedRevision !== expectedRevision) {
        await transaction.done;
        return { ok: false, reason: "conflict", storedRevision };
      }
      const revision = (storedRevision ?? 0) + 1;
      await transaction.store.put({ id: document.metadata.id, revision, savedAt: document.metadata.updatedAt, document });
      await transaction.done;
      return { ok: true, revision };
    } catch (error) {
      throw toStorageError(error);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await (await this.db()).delete("projects", id);
    } catch (error) {
      throw toStorageError(error);
    }
  }
}
