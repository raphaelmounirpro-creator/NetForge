import type {
  DeviceView,
  Diagnostic,
  PingView,
  PlaybackSpeed,
  SimMode,
  SimulationStatus,
  TraceEntry,
  UpdateMessage,
  UpdateNotice,
} from "@netforge/engine";
import type { Issue } from "@netforge/project";
import { create } from "zustand";
import { buildNameIndex, type NameIndex } from "../../i18n/simulation";

/**
 * Projection, côté interface, de l'état calculé par le moteur. Rien n'y est
 * décidé : chaque champ provient d'une mise à jour du Worker. Une seule
 * simulation existe à la fois (rattachée à un projet ouvert).
 */
export const JOURNAL_LIMIT = 2000;

export interface JournalEntry {
  /** Numéro d'arrivée, stable : sert de clé d'affichage. */
  readonly key: number;
  readonly entry: TraceEntry;
}

export type SessionPhase = "loading" | "ready" | "failed";

export interface SimulationSession {
  readonly projectId: string;
  readonly projectName: string;
  /** Empreinte du réseau chargé dans le moteur (voir fingerprint.ts). */
  readonly fingerprint: string;
  readonly phase: SessionPhase;
  readonly loadIssues: readonly Issue[];
  readonly workerError: boolean;
  readonly mode: SimMode;
  readonly speed: PlaybackSpeed;
  readonly time: number;
  readonly status: SimulationStatus;
  readonly diagnostic: Diagnostic | null;
  readonly processedEvents: number;
  readonly pendingEvents: number;
  readonly activity: boolean;
  readonly lagging: boolean;
  readonly notice: UpdateNotice;
  readonly lastComputeMs: number;
  readonly devices: Readonly<Record<string, DeviceView>>;
  readonly pings: Readonly<Record<string, PingView>>;
  readonly pingOrder: readonly string[];
  readonly links: Readonly<Record<string, boolean>>;
  /** Noms, adresses MAC et câbles du réseau chargé : fixes pendant une session, calculés au chargement. */
  readonly names: NameIndex;
  readonly journal: readonly JournalEntry[];
  /** Décisions reçues ou calculées depuis le chargement. */
  readonly journalTotal: number;
  /** Décisions qui ne sont plus (ou n'ont jamais été) affichées. */
  readonly journalHidden: number;
  readonly lastSeq: number;
}

interface SimulationStore {
  session: SimulationSession | null;
  begin: (projectId: string, projectName: string, fingerprint: string) => void;
  loadFailed: (issues: readonly Issue[]) => void;
  applyUpdate: (update: UpdateMessage) => void;
  workerFailed: () => void;
  clear: () => void;
}

function emptySession(projectId: string, projectName: string, fingerprint: string): SimulationSession {
  return {
    projectId,
    projectName,
    fingerprint,
    phase: "loading",
    loadIssues: [],
    workerError: false,
    mode: "paused",
    speed: 1,
    time: 0,
    status: "ready",
    diagnostic: null,
    processedEvents: 0,
    pendingEvents: 0,
    activity: false,
    lagging: false,
    notice: null,
    lastComputeMs: 0,
    devices: {},
    pings: {},
    pingOrder: [],
    links: {},
    names: buildNameIndex([]),
    journal: [],
    journalTotal: 0,
    journalHidden: 0,
    lastSeq: 0,
  };
}

/** Intègre un lot du moteur à la projection (fonction pure, testée séparément). */
export function mergeUpdate(session: SimulationSession, update: UpdateMessage): SimulationSession {
  // Un lot plus ancien qu'un lot déjà intégré est ignoré (ordre garanti par seq).
  if (update.seq <= session.lastSeq) return session;
  const base = update.full ? { ...session, devices: {}, pings: {}, pingOrder: [], links: {}, journal: [], journalTotal: 0, journalHidden: 0 } : session;

  // Références conservées quand rien n'a changé : les composants ne se redessinent pas pour rien.
  const { changes } = update;
  let devices = base.devices;
  if (changes.devices.length > 0) {
    const next = { ...base.devices };
    for (const device of changes.devices) next[device.deviceId] = device;
    devices = next;
  }
  let pings = base.pings;
  let pingOrder = base.pingOrder;
  if (changes.pings.length > 0) {
    const next = { ...base.pings };
    const order = [...base.pingOrder];
    for (const ping of changes.pings) {
      if (!(ping.id in next)) order.push(ping.id);
      next[ping.id] = ping;
    }
    pings = next;
    pingOrder = order;
  }
  let links = base.links;
  if (changes.links.length > 0) {
    const next = { ...base.links };
    for (const link of changes.links) next[link.linkId] = link.up;
    links = next;
  }

  const appended = update.trace.map((entry, index) => ({ key: base.journalTotal + update.droppedTrace + index, entry }));
  const combined = appended.length > 0 ? [...base.journal, ...appended] : base.journal;
  const trimmed = Math.max(0, combined.length - JOURNAL_LIMIT);

  return {
    ...base,
    phase: "ready",
    mode: update.mode,
    speed: update.speed,
    time: update.time,
    status: update.status,
    diagnostic: update.diagnostic,
    processedEvents: update.processedEvents,
    pendingEvents: update.pendingEvents,
    activity: update.activity,
    lagging: update.lagging,
    notice: update.notice ?? (update.trace.length > 0 ? null : base.notice),
    lastComputeMs: update.computeMs,
    devices,
    pings,
    pingOrder,
    links,
    names: update.full ? buildNameIndex(changes.devices) : base.names,
    journal: trimmed > 0 ? combined.slice(trimmed) : combined,
    journalTotal: base.journalTotal + update.droppedTrace + update.trace.length,
    journalHidden: base.journalHidden + update.droppedTrace + trimmed,
    lastSeq: update.seq,
  };
}

export const useSimulationStore = create<SimulationStore>()((set) => ({
  session: null,
  begin: (projectId, projectName, fingerprint) => {
    set({ session: emptySession(projectId, projectName, fingerprint) });
  },
  loadFailed: (issues) => {
    set((state) => (state.session ? { session: { ...state.session, phase: "failed", loadIssues: issues } } : state));
  },
  applyUpdate: (update) => {
    set((state) => (state.session ? { session: mergeUpdate(state.session, update) } : state));
  },
  workerFailed: () => {
    set((state) => (state.session ? { session: { ...state.session, workerError: true, mode: "paused" } } : state));
  },
  clear: () => {
    set({ session: null });
  },
}));
