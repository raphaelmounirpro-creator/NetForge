/**
 * Verrou d'édition d'un projet entre onglets (API Web Locks).
 * Politique : un seul onglet éditeur par projet ; les autres sont en lecture
 * seule et peuvent « prendre la main » explicitement. Sans Web Locks, le
 * contrôle de révision à l'enregistrement reste la protection.
 */
export interface EditLock {
  release: () => void;
  /** Résolue si un autre onglet prend la main sur ce projet. */
  lost: Promise<void>;
}

export type LockOutcome = EditLock | "busy" | "unsupported";

const lockName = (projectId: string) => `netforge:projet:${projectId}`;

export function acquireEditLock(projectId: string, options: { steal?: boolean } = {}): Promise<LockOutcome> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return Promise.resolve("unsupported");
  return new Promise((resolve) => {
    let release: () => void = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    let markLost: () => void = () => {};
    const lost = new Promise<void>((done) => {
      markLost = done;
    });
    const lockOptions: LockOptions = options.steal ? { steal: true } : { ifAvailable: true };
    navigator.locks
      .request(lockName(projectId), lockOptions, async (lock) => {
        if (!lock) {
          resolve("busy");
          return;
        }
        resolve({ release, lost });
        await held;
      })
      .catch((error: unknown) => {
        // Verrou repris par un autre onglet (steal) : la requête est interrompue.
        if (error instanceof DOMException && error.name === "AbortError") markLost();
      });
  });
}
