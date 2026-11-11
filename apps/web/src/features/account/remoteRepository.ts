import { doneResponseSchema, projectListResponseSchema, projectResponseSchema, saveResponseSchema } from "@netforge/contracts";
import type { NfgDocument } from "@netforge/project";
import { StorageError, toLoadOutcome, type LoadOutcome, type ProjectRepository, type ProjectSummary, type SaveOutcome } from "../storage/repository";
import { ApiRequestError, apiRequest } from "./api";
import { useAccountStore } from "./store";

/** Erreur d'API traduite en erreur de stockage ; une session expirée ramène l'interface au mode invité. */
function storageError(error: unknown): StorageError {
  if (error instanceof ApiRequestError && error.status === 401) {
    useAccountStore.getState().signedOut();
    return new StorageError("unauthorized", { cause: error });
  }
  if (error instanceof ApiRequestError && error.body.code === "server.unavailable") return new StorageError("offline", { cause: error });
  return new StorageError("unknown", { cause: error });
}

/**
 * Projets privés du compte, par l'API : même contrat que le stockage local
 * (révisions, conflits), contenu relu et validé comme un import. Rien n'est
 * mis en cache dans le navigateur : la relecture vient toujours du serveur.
 */
export class RemoteProjectRepository implements ProjectRepository {
  async list(): Promise<ProjectSummary[]> {
    try {
      const { projects } = await apiRequest("GET", "/projects", projectListResponseSchema);
      return projects.map((project) => ({ ...project, readable: true }));
    } catch (error) {
      throw storageError(error);
    }
  }

  async load(id: string): Promise<LoadOutcome> {
    try {
      const project = await apiRequest("GET", `/projects/${encodeURIComponent(id)}`, projectResponseSchema);
      return toLoadOutcome({ id: project.id, revision: project.revision, savedAt: project.savedAt, document: project.document });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return { ok: false, reason: "not-found" };
      throw storageError(error);
    }
  }

  async save(document: NfgDocument, expectedRevision: number | null): Promise<SaveOutcome> {
    try {
      const saved =
        expectedRevision === null
          ? await apiRequest("POST", "/projects", saveResponseSchema, { document })
          : await apiRequest("PUT", `/projects/${encodeURIComponent(document.metadata.id)}`, saveResponseSchema, { document, expectedRevision });
      return { ok: true, revision: saved.revision };
    } catch (error) {
      if (error instanceof ApiRequestError && error.body.code === "project.conflict") return { ok: false, reason: "conflict", storedRevision: error.body.storedRevision ?? null };
      throw storageError(error);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await apiRequest("DELETE", `/projects/${encodeURIComponent(id)}`, doneResponseSchema);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return;
      throw storageError(error);
    }
  }
}
