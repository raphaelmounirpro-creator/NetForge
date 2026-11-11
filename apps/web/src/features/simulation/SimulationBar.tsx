import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@netforge/engine";
import { FastForward, Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { fill, messages } from "../../i18n";
import { formatSimTime } from "../../i18n/simulation";
import { SIMULATION_SEED } from "./controller";
import { simulation } from "./services";
import type { SimulationSession } from "./store";

const t = messages.simulation;
const ICON = 16;

/**
 * Barre de simulation : lecture/pause, pas à pas, calcul jusqu'à la fin des
 * échanges, réinitialisation et vitesse d'observation. La vitesse ne change
 * que le rythme d'affichage, jamais les résultats calculés.
 */
export function SimulationBar({ session, stale }: { session: SimulationSession; stale: boolean }) {
  const speedId = useId();
  // Préférence d'affichage : transmise au moteur au lancement de la lecture.
  const [speed, setSpeed] = useState<PlaybackSpeed>(session.speed);
  const blocked = stale || session.phase !== "ready" || session.workerError || session.status === "interrupted";
  const playing = session.mode === "playing";
  const status =
    session.status === "interrupted" ? t.interruptedBadge : session.phase === "loading" ? t.loading : t.mode[session.mode];

  return (
    <div role="toolbar" aria-label={t.bar} className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2">
      {playing ? (
        <Button size="sm" variant="primary" onClick={() => void simulation.pause()}>
          <Pause aria-hidden="true" size={ICON} />
          {t.pause}
        </Button>
      ) : (
        <Button size="sm" variant="primary" disabled={blocked} onClick={() => void simulation.play(speed)}>
          <Play aria-hidden="true" size={ICON} />
          {t.play}
        </Button>
      )}
      <Button size="sm" disabled={blocked || session.pendingEvents === 0} onClick={() => void simulation.step()}>
        <StepForward aria-hidden="true" size={ICON} />
        {t.step}
      </Button>
      <Button size="sm" disabled={blocked || !session.activity || session.mode === "finishing"} onClick={() => void simulation.finish()}>
        <FastForward aria-hidden="true" size={ICON} />
        {t.finish}
      </Button>
      <Button size="sm" disabled={session.phase === "loading"} onClick={() => void simulation.reset()}>
        <RotateCcw aria-hidden="true" size={ICON} />
        {t.reset}
      </Button>
      <span className="flex items-center gap-2 text-xs">
        <label htmlFor={speedId} className="text-text-muted">
          {t.speed}
        </label>
        <select
          id={speedId}
          value={speed}
          onChange={(event) => {
            const next = Number(event.target.value) as PlaybackSpeed;
            setSpeed(next);
            if (playing) void simulation.play(next);
          }}
          className="min-h-8 rounded-sm border border-border-strong bg-canvas px-2 text-xs text-text"
        >
          {PLAYBACK_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {t.speeds[speed]}
            </option>
          ))}
        </select>
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span aria-live="polite" className={`font-semibold ${session.status === "interrupted" ? "text-danger" : "text-text"}`}>
          {status}
          {session.notice === "finished" && session.mode === "paused" && !session.activity ? ` · ${t.finished}` : ""}
        </span>
        <span className="text-text">
          <span aria-hidden="true" className="text-text-muted">
            {t.time}{" "}
          </span>
          <span role="timer" aria-label={t.time} className="font-mono">
            {formatSimTime(session.time)}
          </span>
        </span>
        <span className="text-text-muted">
          {fill(t.counters, {
            processed: session.processedEvents.toLocaleString("fr-FR"),
            pending: session.pendingEvents.toLocaleString("fr-FR"),
          })}
        </span>
        <span className="text-text-muted">{fill(t.seed, { seed: SIMULATION_SEED })}</span>
      </div>
    </div>
  );
}
