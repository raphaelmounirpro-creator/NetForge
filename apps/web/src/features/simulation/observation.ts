import { create } from "zustand";
import { isLossOrError, type ExplanationLevel } from "../../i18n/simulation";
import type { JournalEntry, SimulationSession } from "./store";

/**
 * État d'observation de la vue Simulation (session uniquement, jamais
 * exporté) : décision inspectée, échange suivi, niveau d'explication et
 * onglets affichés. Le niveau d'explication est mémorisé sur l'appareil.
 */
export type DockTab = "journal" | "pings" | "console";
export type SideTab = "runtime" | "inspector";

const LEVEL_KEY = "netforge.explanationLevel";

function readLevel(): ExplanationLevel {
  try {
    return localStorage.getItem(LEVEL_KEY) === "technical" ? "technical" : "beginner";
  } catch {
    return "beginner";
  }
}

interface ObservationState {
  /** Clé de la décision inspectée dans le journal. */
  inspected: number | null;
  /** Échange suivi (ex. « ping-1#2 ») : filtre du journal et chemin sur le canevas. */
  exchange: string | null;
  level: ExplanationLevel;
  dock: DockTab;
  side: SideTab;
  inspect: (key: number | null) => void;
  follow: (exchange: string | null) => void;
  setLevel: (level: ExplanationLevel) => void;
  setDock: (dock: DockTab) => void;
  setSide: (side: SideTab) => void;
  /** Nouveau chargement ou réinitialisation : rien ne reste sélectionné. */
  reset: () => void;
}

export const useObservationStore = create<ObservationState>()((set) => ({
  inspected: null,
  exchange: null,
  level: readLevel(),
  dock: "journal",
  side: "runtime",
  inspect: (key) => {
    set(key === null ? { inspected: null } : { inspected: key, side: "inspector" });
  },
  follow: (exchange) => {
    set({ exchange });
  },
  setLevel: (level) => {
    try {
      localStorage.setItem(LEVEL_KEY, level);
    } catch {
      // Stockage indisponible : la préférence vaut pour la session.
    }
    set({ level });
  },
  setDock: (dock) => {
    set({ dock });
  },
  setSide: (side) => {
    set({ side });
  },
  reset: () => {
    set({ inspected: null, exchange: null });
  },
}));

/** Décisions conservées d'un échange, dans l'ordre du journal. */
export function exchangeEntries(session: SimulationSession, exchange: string): JournalEntry[] {
  return session.journal.filter((item) => item.entry.exchange === exchange);
}

/**
 * « Pourquoi ? » sur un écho en échec : suit l'échange et inspecte la
 * décision qui l'explique — la première perte ou erreur en chemin (paquet
 * abandonné, échec ARP…), à défaut le constat du ping lui-même.
 */
export function explainEcho(session: SimulationSession, sessionId: string, sequence: number): void {
  const exchange = `${sessionId}#${String(sequence)}`;
  const entries = exchangeEntries(session, exchange);
  const cause =
    entries.find((item) => isLossOrError(item.entry) && !item.entry.code.startsWith("ping.")) ??
    entries.find((item) => isLossOrError(item.entry)) ??
    entries.at(-1);
  const store = useObservationStore.getState();
  store.follow(exchange);
  store.setDock("journal");
  store.inspect(cause?.key ?? null);
  if (!cause) store.setSide("inspector");
}
