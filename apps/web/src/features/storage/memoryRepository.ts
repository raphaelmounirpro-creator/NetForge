import type { NfgDocument } from "@netforge/project";
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

/** Dépôt en mémoire, même contrat que IndexedDB : tests et repli sans stockage. */
export class MemoryProjectRepository implements ProjectRepository {
  readonly records = new Map<string, ProjectRecord>();
  /** Permet aux tests de simuler un quota dépassé. */
  failNextSaveWith: StorageError | null = null;

  list(): Promise<ProjectSummary[]> {
    return Promise.resolve(sortSummaries([...this.records.values()].map(toSummary)));
  }

  load(id: string): Promise<LoadOutcome> {
    return Promise.resolve(toLoadOutcome(this.records.get(id)));
  }

  save(document: NfgDocument, expectedRevision: number | null): Promise<SaveOutcome> {
    if (this.failNextSaveWith) {
      const failure = this.failNextSaveWith;
      this.failNextSaveWith = null;
      return Promise.reject(failure);
    }
    const storedRevision = this.records.get(document.metadata.id)?.revision ?? null;
    if (storedRevision !== expectedRevision) return Promise.resolve({ ok: false, reason: "conflict", storedRevision });
    const revision = (storedRevision ?? 0) + 1;
    // Copie profonde : le stockage ne partage jamais d'objet avec l'interface.
    this.records.set(document.metadata.id, {
      id: document.metadata.id,
      revision,
      savedAt: document.metadata.updatedAt,
      document: structuredClone(document),
    });
    return Promise.resolve({ ok: true, revision });
  }

  remove(id: string): Promise<void> {
    this.records.delete(id);
    return Promise.resolve();
  }
}
