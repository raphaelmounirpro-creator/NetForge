import { RemoteProjectRepository } from "../account/remoteRepository";
import { acquireEditLock } from "../storage/editLock";
import { IndexedDbProjectRepository } from "../storage/indexedDbRepository";
import { createProjectService } from "./projectService";
import { hasUnsavedChanges, useLabStore } from "./store";

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Service unique de l'application : projets invités dans IndexedDB, projets du compte par l'API. */
export const projectService = createProjectService({
  repository: new IndexedDbProjectRepository(),
  accountRepository: new RemoteProjectRepository(),
  acquireLock: acquireEditLock,
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
  saveDelayMs: 400,
  sessionStorage: safeLocalStorage(),
});

/** Enregistre dès que l'onglet est masqué et avertit avant de quitter avec des modifications en attente. */
export function installUnloadProtection(): () => void {
  const onHide = () => {
    if (document.visibilityState === "hidden") void projectService.flush();
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    const { projects } = useLabStore.getState();
    const unsaved = Object.values(projects).some((project) => project.access === "editor" && hasUnsavedChanges(project));
    if (unsaved) {
      void projectService.flush();
      event.preventDefault();
    }
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
}
