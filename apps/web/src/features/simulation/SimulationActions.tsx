import { PING_DEFAULTS } from "@netforge/engine";
import { useId, useMemo, useState, type SubmitEvent } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { compareNames, messages } from "../../i18n";
import { formatCommandError } from "../../i18n/simulation";
import { simulation } from "./services";
import type { SimulationSession } from "./store";

const t = messages.simulation;

/** Formulaire de ping : l'interface exprime l'intention, le moteur valide et exécute. */
function PingForm({ session, disabled }: { session: SimulationSession; disabled: boolean }) {
  const sourceId = useId();
  const pcs = useMemo(
    () =>
      Object.values(session.devices)
        .filter((device) => device.kind === "pc")
        .sort((a, b) => compareNames(a.name, b.name)),
    [session.devices],
  );
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [count, setCount] = useState(String(PING_DEFAULTS.count));
  const [error, setError] = useState<string | null>(null);
  /** Ping programmé alors que la simulation est en pause : rappel tant qu'il n'a pas démarré. */
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const waiting = queuedId !== null && session.pings[queuedId]?.done === false;
  const selected = pcs.some((pc) => pc.deviceId === source) ? source : (pcs[0]?.deviceId ?? "");

  if (pcs.length === 0) return <p className="text-sm text-text-muted">{t.pingNoPc}</p>;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const reply = await simulation.ping(selected, destination, Number(count));
    if (reply.ok) {
      setError(null);
      setQueuedId(reply.sessionId);
    } else {
      setError(formatCommandError(reply.code, reply.params));
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate aria-labelledby={`${sourceId}-title`} className="flex flex-col gap-3">
      <h2 id={`${sourceId}-title`} className="text-sm font-semibold text-text">
        {t.pingTitle}
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={sourceId} className="text-xs font-medium text-text">
          {t.pingSource}
        </label>
        <select
          id={sourceId}
          value={selected}
          disabled={disabled}
          onChange={(event) => {
            setSource(event.target.value);
          }}
          className="min-h-9 rounded-sm border border-border-strong bg-canvas px-2 text-sm text-text"
        >
          {pcs.map((pc) => (
            <option key={pc.deviceId} value={pc.deviceId}>
              {pc.name}
              {pc.interfaces[0]?.ipv4 ? ` (${pc.interfaces[0].ipv4})` : ""}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label={t.pingDestination}
        value={destination}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        error={error}
        onChange={(event) => {
          setDestination(event.target.value);
        }}
      />
      <TextField
        label={t.pingCount}
        type="number"
        min={1}
        max={PING_DEFAULTS.maxCount}
        value={count}
        disabled={disabled}
        onChange={(event) => {
          setCount(event.target.value);
        }}
      />
      <Button type="submit" variant="primary" size="sm" disabled={disabled} className="self-start">
        {t.pingSend}
      </Button>
      <p aria-live="polite" className="text-xs text-text-muted">
        {waiting && session.mode === "paused" ? t.pingQueued : ""}
      </p>
    </form>
  );
}

/** Panne injectée : coupe ou rétablit un câble pendant la simulation (le projet n'est pas modifié). */
function LinkFaults({ session, disabled }: { session: SimulationSession; disabled: boolean }) {
  const names = session.names;
  const links = useMemo(
    () =>
      Object.keys(session.links)
        .map((linkId) => ({ linkId, label: names.link(linkId) }))
        .sort((a, b) => compareNames(a.label, b.label)),
    [session.links, names],
  );
  return (
    <section aria-labelledby="sim-faults" className="flex flex-col gap-2">
      <h2 id="sim-faults" className="text-sm font-semibold text-text">
        {t.faultsTitle}
      </h2>
      <p className="text-xs text-text-muted">{t.faultsHint}</p>
      {links.length === 0 ? (
        <p className="text-sm text-text-muted">{t.noLinks}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map(({ linkId, label }) => {
            const up = session.links[linkId] ?? true;
            return (
              <li key={linkId} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1.5">
                <span className="min-w-0 text-xs">
                  {label.split(" ↔ ").map((end, index) => (
                    <span key={end} className="block font-mono text-text">
                      {index > 0 ? "↔ " : ""}
                      {end}
                    </span>
                  ))}
                  <span className={up ? "text-text-muted" : "font-semibold text-danger"}>{up ? `● ${t.linkUp}` : `✕ ${t.linkDown}`}</span>
                </span>
                <Button
                  size="sm"
                  variant={up ? "ghost" : "secondary"}
                  disabled={disabled}
                  aria-label={`${up ? t.faultCut : t.faultRestore} ${label}`}
                  onClick={() => void simulation.setLink(linkId, !up)}
                >
                  {up ? t.faultCut : t.faultRestore}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Panneau gauche de la vue Simulation. */
export function SimulationActions({ session, disabled }: { session: SimulationSession | null; disabled: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4">
      {session ? (
        <>
          <PingForm session={session} disabled={disabled} />
          <LinkFaults session={session} disabled={disabled} />
        </>
      ) : (
        <p className="text-sm text-text-muted">{t.runtime.notLoaded}</p>
      )}
    </div>
  );
}
