import { OPERATION_MODE, type CliMode } from "@netforge/project";
import { create } from "zustand";
import { pingAttemptText, pingSummary } from "../../i18n/simulation";
import type { SimulationSession } from "./store";

/**
 * État des consoles (session uniquement) : une console par équipement et par
 * projet, avec son mode, ses lignes et son historique. Les pings lancés depuis
 * une console y affichent leurs réponses au fur et à mesure du calcul.
 */
export type ConsoleLineKind = "input" | "output" | "error" | "info";

export interface ConsoleLine {
  readonly id: number;
  readonly kind: ConsoleLineKind;
  readonly text: string;
}

export interface DeviceConsole {
  readonly mode: CliMode;
  readonly lines: readonly ConsoleLine[];
  readonly history: readonly string[];
}

interface PingWatch {
  readonly key: string;
  readonly printed: number;
}

const MAX_LINES = 400;
const MAX_HISTORY = 50;
export const EMPTY_CONSOLE: DeviceConsole = { mode: OPERATION_MODE, lines: [], history: [] };

export const consoleKey = (projectId: string, deviceId: string) => `${projectId}/${deviceId}`;

interface ConsoleState {
  consoles: Readonly<Record<string, DeviceConsole>>;
  /** Pings lancés depuis une console : identifiant de session → console et réponses déjà affichées. */
  watches: Readonly<Record<string, PingWatch>>;
  nextId: number;
  append: (key: string, kind: ConsoleLineKind, texts: readonly string[]) => void;
  setMode: (key: string, mode: CliMode) => void;
  remember: (key: string, line: string) => void;
  clear: (key: string) => void;
  watch: (sessionId: string, key: string) => void;
  /** Affiche les réponses nouvellement calculées des pings suivis. */
  syncPings: (session: SimulationSession) => void;
  /** Nouveau chargement : les identifiants de ping repartent de 1. */
  forgetWatches: () => void;
}

export const useConsoleStore = create<ConsoleState>()((set, get) => {
  const update = (key: string, patch: (current: DeviceConsole) => Partial<DeviceConsole>) => {
    set((state) => {
      const current = state.consoles[key] ?? EMPTY_CONSOLE;
      return { consoles: { ...state.consoles, [key]: { ...current, ...patch(current) } } };
    });
  };

  return {
    consoles: {},
    watches: {},
    nextId: 1,
    append: (key, kind, texts) => {
      const first = get().nextId;
      set({ nextId: first + texts.length });
      update(key, (current) => ({
        lines: [...current.lines, ...texts.map((text, index) => ({ id: first + index, kind, text }))].slice(-MAX_LINES),
      }));
    },
    setMode: (key, mode) => {
      update(key, () => ({ mode }));
    },
    remember: (key, line) => {
      update(key, (current) => ({ history: [...current.history.filter((item) => item !== line), line].slice(-MAX_HISTORY) }));
    },
    clear: (key) => {
      update(key, () => ({ lines: [] }));
    },
    watch: (sessionId, key) => {
      set((state) => ({ watches: { ...state.watches, [sessionId]: { key, printed: 0 } } }));
    },
    syncPings: (session) => {
      const { watches } = get();
      for (const [sessionId, watch] of Object.entries(watches)) {
        const view = session.pings[sessionId];
        if (!view) continue;
        let printed = watch.printed;
        const lines: string[] = [];
        for (const attempt of view.attempts.slice(printed)) {
          if (attempt.status === "pending") break;
          lines.push(pingAttemptText(attempt));
          printed += 1;
        }
        const summary = view.done && printed === view.attempts.length ? pingSummary(view) : null;
        if (lines.length > 0) get().append(watch.key, "output", lines);
        if (summary) get().append(watch.key, summary.hasLoss ? "error" : "output", [summary.summary, ...(summary.rtt ? [summary.rtt] : [])]);
        if (summary) {
          set((state) => {
            const { [sessionId]: _done, ...rest } = state.watches;
            return { watches: rest };
          });
        } else if (printed !== watch.printed) {
          set((state) => ({ watches: { ...state.watches, [sessionId]: { ...watch, printed } } }));
        }
      }
    },
    forgetWatches: () => {
      set({ watches: {} });
    },
  };
});
