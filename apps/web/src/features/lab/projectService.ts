import {
  createProject,
  exportFileName,
  LIMITS,
  parseNfgText,
  serializeNfg,
  type Issue,
  type NfgDocument,
} from "@netforge/project";
import type { EditLock, LockOutcome } from "../storage/editLock";
import { StorageError, type LoadOutcome, type ProjectRepository } from "../storage/repository";
import { hasUnsavedChanges, useLabStore } from "./store";

export interface ProjectServiceDeps {
  repository: ProjectRepository;
  acquireLock: (projectId: string, options?: { steal?: boolean }) => Promise<LockOutcome>;
  now: () => string;
  newId: () => string;
  /** Délai avant enregistrement automatique après une modification. */
  saveDelayMs: number;
  /** Stockage de la session (onglets ouverts) ; null si indisponible. */
  sessionStorage: Pick<Storage, "getItem" | "setItem"> | null;
}

export type ImportOutcome =
  | { kind: "invalid"; errors: Issue[] }
  | { kind: "exists"; document: NfgDocument; warnings: Issue[] }
  | { kind: "imported"; id: string; warnings: Issue[] }
  | { kind: "busy" }
  | { kind: "storage-error"; error: StorageError };

const SESSION_KEY = "netforge.lab.session";

export type ProjectService = ReturnType<typeof createProjectService>;

/**
 * Cycle de vie des projets invités : création, ouverture, enregistrement
 * automatique, conflits entre onglets, import/export et fermeture sûre.
 */
export function createProjectService(deps: ProjectServiceDeps) {
  const store = useLabStore;
  const locks = new Map<string, EditLock>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Map<string, Promise<void>>();

  // ------------------------------------------------------------ Enregistrement

  async function saveNow(id: string): Promise<void> {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    const running = inFlight.get(id);
    if (running) await running;

    const project = store.getState().projects[id];
    if (!project || project.access !== "editor" || project.saveStatus === "conflict") return;
    if (project.change === project.savedChange && project.saveStatus !== "error") return;

    const change = project.change;
    const updatedAt = deps.now();
    const document: NfgDocument = { ...project.document, metadata: { ...project.document.metadata, updatedAt } };
    store.getState().markSaving(id);
    const task = (async () => {
      try {
        const outcome = await deps.repository.save(document, project.storedRevision);
        if (outcome.ok) store.getState().markSaved(id, { revision: outcome.revision, change, updatedAt });
        else store.getState().markConflict(id);
      } catch (error) {
        store.getState().markSaveError(id, error instanceof StorageError ? error.kind : "unknown");
      }
    })();
    inFlight.set(id, task);
    await task;
    inFlight.delete(id);
    // Modifications survenues pendant l'enregistrement : nouvel enregistrement.
    if (store.getState().projects[id]?.saveStatus === "pending") schedule(id);
  }

  function schedule(id: string): void {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.set(
      id,
      setTimeout(() => {
        void saveNow(id);
      }, deps.saveDelayMs),
    );
  }

  /** Enregistre immédiatement un projet, ou tous les projets ouverts. */
  async function flush(id?: string): Promise<void> {
    const ids = id ? [id] : store.getState().order;
    await Promise.all(ids.map((item) => saveNow(item)));
  }

  const unsubscribeChanges = store.subscribe((state, previous) => {
    for (const id of state.order) {
      const project = state.projects[id];
      if (!project || project.access !== "editor") continue;
      if (project.change !== previous.projects[id]?.change && project.change !== project.savedChange) schedule(id);
    }
  });

  // ------------------------------------------------------------ Session

  const unsubscribeSession = store.subscribe((state, previous) => {
    if (state.order === previous.order && state.activeId === previous.activeId) return;
    try {
      deps.sessionStorage?.setItem(SESSION_KEY, JSON.stringify({ open: state.order, active: state.activeId }));
    } catch {
      // Préférence de session seulement : son absence ne gêne pas l'édition.
    }
  });

  async function restoreSession(): Promise<void> {
    let session: { open?: unknown; active?: unknown } = {};
    try {
      session = JSON.parse(deps.sessionStorage?.getItem(SESSION_KEY) ?? "{}") as typeof session;
    } catch {
      return;
    }
    const ids = Array.isArray(session.open) ? session.open.filter((id): id is string => typeof id === "string") : [];
    for (const id of ids) {
      try {
        await openStored(id);
      } catch {
        // Projet supprimé ou stockage indisponible : l'onglet n'est pas restauré.
      }
    }
    if (typeof session.active === "string") store.getState().setActive(session.active);
  }

  // ------------------------------------------------------------ Verrous

  function registerLock(id: string, lock: EditLock): void {
    locks.set(id, lock);
    void lock.lost.then(() => {
      if (locks.get(id) !== lock) return;
      locks.delete(id);
      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      store.getState().setAccess(id, "readonly");
    });
  }

  async function lockAccess(id: string): Promise<"editor" | "readonly"> {
    const lock = await deps.acquireLock(id);
    if (lock === "busy") return "readonly";
    if (lock !== "unsupported") registerLock(id, lock);
    return "editor";
  }

  function releaseLock(id: string): void {
    locks.get(id)?.release();
    locks.delete(id);
  }

  // ------------------------------------------------------------ Projets

  async function newProject(name: string): Promise<{ ok: true; id: string } | { ok: false; errors: Issue[] }> {
    const id = deps.newId();
    const result = createProject({ id, name, now: deps.now() });
    if (!result.ok) return result;
    const access = await lockAccess(id);
    store.getState().openProject(result.document, { storedRevision: null, access, saved: false });
    await saveNow(id);
    return { ok: true, id };
  }

  async function openStored(id: string): Promise<LoadOutcome | { ok: true }> {
    if (store.getState().projects[id]) {
      store.getState().setActive(id);
      return { ok: true };
    }
    const outcome = await deps.repository.load(id);
    if (!outcome.ok) return outcome;
    const access = await lockAccess(id);
    store.getState().openProject(outcome.project.document, { storedRevision: outcome.project.revision, access, saved: true });
    return outcome;
  }

  /** Ferme après enregistrement ; renvoie « unsaved » si des modifications seraient perdues. */
  async function close(id: string, options: { force?: boolean } = {}): Promise<"closed" | "unsaved"> {
    await flush(id);
    const project = store.getState().projects[id];
    if (project && project.access === "editor" && hasUnsavedChanges(project) && !options.force) return "unsaved";
    releaseLock(id);
    store.getState().closeProject(id);
    return "closed";
  }

  /** Prend la main sur un projet ouvert en lecture seule : recharge la version enregistrée. */
  async function takeOver(id: string): Promise<LoadOutcome> {
    const lock = await deps.acquireLock(id, { steal: true });
    if (typeof lock === "object") registerLock(id, lock);
    const outcome = await deps.repository.load(id);
    if (outcome.ok) {
      store.getState().reload(id, outcome.project.document, outcome.project.revision);
      store.getState().setAccess(id, "editor");
    }
    return outcome;
  }

  /** Abandonne la version locale en conflit et recharge la version enregistrée. */
  async function reloadStored(id: string): Promise<LoadOutcome> {
    const outcome = await deps.repository.load(id);
    if (outcome.ok) store.getState().reload(id, outcome.project.document, outcome.project.revision);
    return outcome;
  }

  /** Enregistre la version locale sous un nouveau projet (résolution de conflit sans perte). */
  async function saveAsCopy(document: NfgDocument): Promise<ImportOutcome> {
    const now = deps.now();
    const copy: NfgDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        id: deps.newId(),
        name: `${document.metadata.name} (copie)`.slice(0, LIMITS.maxProjectNameLength),
        createdAt: now,
        updatedAt: now,
      },
    };
    return storeAndOpen(copy, null, []);
  }

  /** Crée un nouveau projet à partir d'un document (exercice) : nouvel identifiant, nom donné. */
  async function createFrom(document: NfgDocument, name: string): Promise<ImportOutcome> {
    const now = deps.now();
    const copy: NfgDocument = {
      ...document,
      metadata: { ...document.metadata, id: deps.newId(), name: name.slice(0, LIMITS.maxProjectNameLength), createdAt: now, updatedAt: now },
    };
    return storeAndOpen(copy, null, []);
  }

  async function storeAndOpen(document: NfgDocument, expectedRevision: number | null, warnings: Issue[]): Promise<ImportOutcome> {
    try {
      const outcome = await deps.repository.save(document, expectedRevision);
      if (!outcome.ok) return { kind: "busy" };
      const access = await lockAccess(document.metadata.id);
      store.getState().openProject(document, { storedRevision: outcome.revision, access, saved: true });
      return { kind: "imported", id: document.metadata.id, warnings };
    } catch (error) {
      return { kind: "storage-error", error: error instanceof StorageError ? error : new StorageError("unknown", { cause: error }) };
    }
  }

  /**
   * Import : validation complète avant toute écriture. En cas d'échec, rien
   * n'est modifié (ni projet courant, ni stockage).
   */
  async function importText(text: string): Promise<ImportOutcome> {
    const parsed = parseNfgText(text);
    if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
    const existing = await deps.repository.load(parsed.document.metadata.id);
    if (existing.ok || existing.reason === "invalid") {
      return { kind: "exists", document: parsed.document, warnings: parsed.warnings };
    }
    return storeAndOpen(parsed.document, null, parsed.warnings);
  }

  /** Remplace un projet existant par un import (annulable s'il est ouvert ici). */
  async function importReplace(document: NfgDocument): Promise<ImportOutcome> {
    const id = document.metadata.id;
    const open = store.getState().projects[id];
    if (open) {
      if (open.access !== "editor") return { kind: "busy" };
      store.getState().apply(id, () => ({ ok: true, document, warnings: [] }));
      store.getState().setActive(id);
      await saveNow(id);
      return { kind: "imported", id, warnings: [] };
    }
    const lock = await deps.acquireLock(id);
    if (lock === "busy") return { kind: "busy" };
    if (lock !== "unsupported") lock.release();
    const existing = await deps.repository.load(id);
    return storeAndOpen(document, existing.ok ? existing.project.revision : null, []);
  }

  async function remove(id: string): Promise<"removed" | "busy"> {
    if (store.getState().projects[id]) await close(id, { force: true });
    const lock = await deps.acquireLock(id);
    if (lock === "busy") return "busy";
    await deps.repository.remove(id);
    if (lock !== "unsupported") lock.release();
    return "removed";
  }

  function exportDocument(document: NfgDocument): { fileName: string; text: string } {
    return { fileName: exportFileName(document), text: serializeNfg(document) };
  }

  function dispose(): void {
    unsubscribeChanges();
    unsubscribeSession();
    for (const timer of timers.values()) clearTimeout(timer);
    for (const id of [...locks.keys()]) releaseLock(id);
  }

  return {
    newProject,
    openStored,
    close,
    takeOver,
    reloadStored,
    saveAsCopy,
    createFrom,
    importText,
    importReplace,
    remove,
    exportDocument,
    flush,
    restoreSession,
    list: () => deps.repository.list(),
    /** Lecture seule d'un projet enregistré, sans l'ouvrir (export depuis la liste). */
    load: (id: string) => deps.repository.load(id),
    dispose,
  };
}
