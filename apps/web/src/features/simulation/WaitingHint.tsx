import { FastForward, Pause, StepForward } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { messages } from "../../i18n";
import { simulation, useIsStale } from "./services";
import type { SimulationSession } from "./store";

const t = messages.simulation;

/**
 * Rappel affiché au-dessus des résultats quand la simulation est en pause
 * alors que des échanges restent à calculer (ex. ping lancé mais pas encore
 * déroulé) : la suite se calcule depuis ici, sans chercher la barre.
 */
export function WaitingHint({ session }: { session: SimulationSession }) {
  const stale = useIsStale(session.projectId);
  const waiting =
    session.mode === "paused" && session.activity && session.status === "ready" && session.phase === "ready" && !session.workerError && !stale;
  if (!waiting) return null;
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-raised px-3 py-2 text-xs text-text">
      <Pause aria-hidden="true" size={14} className="text-accent-text" />
      <span className="min-w-0 flex-1">{t.waitingHint}</span>
      <Button size="sm" variant="primary" onClick={() => void simulation.finish()}>
        <FastForward aria-hidden="true" size={14} />
        {t.finish}
      </Button>
      <Button size="sm" onClick={() => void simulation.step()}>
        <StepForward aria-hidden="true" size={14} />
        {t.step}
      </Button>
    </div>
  );
}
