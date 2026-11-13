import type { ConnectorInspection, Direction, OtdrTrace, PowerMeasurement } from "@netforge/engine";
import { create } from "zustand";

/**
 * État de session de la vue Optique, par projet : chemin choisi, réglages
 * du photomètre et journal des mesures (jamais exporté ; il sert aussi aux
 * vérifications d'un exercice).
 */
export type OpticsTab = "budget" | "pon" | "bandwidth" | "measure" | "otdr" | "interventions" | "faults";

export type OpticsLogEntry =
  | { readonly id: number; readonly kind: "power"; readonly measurement: PowerMeasurement }
  | { readonly id: number; readonly kind: "inspection"; readonly inspection: ConnectorInspection };

export interface OpticsSession {
  readonly selectedPathId: string | null;
  readonly tab: OpticsTab;
  readonly direction: Direction;
  readonly ontId: string | null;
  readonly log: readonly OpticsLogEntry[];
  /** Dernière acquisition OTDR (session seulement). */
  readonly otdr: OtdrTrace | null;
}

export const OPTICS_LOG_LIMIT = 50;

const EMPTY: OpticsSession = { selectedPathId: null, tab: "budget", direction: "downstream", ontId: null, log: [], otdr: null };

type NewEntry = { kind: "power"; measurement: PowerMeasurement } | { kind: "inspection"; inspection: ConnectorInspection };

interface OpticsState {
  sessions: Readonly<Record<string, OpticsSession>>;
  nextId: number;
  update: (projectId: string, patch: Partial<Omit<OpticsSession, "log">>) => void;
  record: (projectId: string, entry: NewEntry) => void;
  clearLog: (projectId: string) => void;
}

export const useOpticsStore = create<OpticsState>()((set) => ({
  sessions: {},
  nextId: 1,
  update: (projectId, patch) => {
    set((state) => ({ sessions: { ...state.sessions, [projectId]: { ...(state.sessions[projectId] ?? EMPTY), ...patch } } }));
  },
  record: (projectId, entry) => {
    set((state) => {
      const session = state.sessions[projectId] ?? EMPTY;
      const log = [{ ...entry, id: state.nextId } as OpticsLogEntry, ...session.log].slice(0, OPTICS_LOG_LIMIT);
      return { nextId: state.nextId + 1, sessions: { ...state.sessions, [projectId]: { ...session, log } } };
    });
  },
  clearLog: (projectId) => {
    set((state) => ({ sessions: { ...state.sessions, [projectId]: { ...(state.sessions[projectId] ?? EMPTY), log: [] } } }));
  },
}));

export function useOpticsSession(projectId: string): OpticsSession {
  return useOpticsStore((state) => state.sessions[projectId] ?? EMPTY);
}

/** Mesures de puissance du journal (vérifications d'exercice). */
export function powerMeasurements(session: OpticsSession): PowerMeasurement[] {
  return session.log.flatMap((entry) => (entry.kind === "power" ? [entry.measurement] : []));
}
