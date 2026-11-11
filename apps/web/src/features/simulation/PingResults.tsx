import { fill, messages } from "../../i18n";
import { pingAttemptText, pingSummary } from "../../i18n/simulation";
import type { SimulationSession } from "./store";

const t = messages.simulation;

/** Résultats des pings, du plus récent au plus ancien, à la manière de l'outil ping. */
export function PingResults({ session }: { session: SimulationSession }) {
  const pings = [...session.pingOrder].reverse().flatMap((id) => {
    const view = session.pings[id];
    return view ? [view] : [];
  });
  if (pings.length === 0) return <p className="p-3 text-sm text-text-muted">{t.pingsEmpty}</p>;
  return (
    <ul aria-label={t.pingsLabel} className="h-full overflow-y-auto">
      {pings.map((view) => {
        const summary = pingSummary(view);
        const source = session.devices[view.deviceId]?.name ?? view.deviceId;
        return (
          <li key={view.id} className="border-b border-border px-3 py-2">
            <h3 className="font-mono text-sm font-semibold text-text">{fill(t.pingHeading, { source, destination: view.destination })}</h3>
            {view.attempts.length === 0 ? (
              <p className="mt-1 text-xs text-text-muted">{t.pingWaiting}</p>
            ) : (
              <ol className="mt-1 space-y-0.5 font-mono text-xs">
                {view.attempts.map((attempt) => (
                  <li key={attempt.sequence} data-status={attempt.status} className={attempt.status === "reply" ? "text-text" : attempt.status === "pending" ? "text-text-muted" : "text-danger"}>
                    {attempt.status === "reply" ? "✓ " : attempt.status === "pending" ? "… " : "✗ "}
                    {pingAttemptText(attempt)}
                  </li>
                ))}
              </ol>
            )}
            {summary && (
              <p aria-live="polite" data-severity={summary.hasLoss ? "error" : "normal"} className={`mt-1 text-xs ${summary.hasLoss ? "text-danger" : "text-text"}`}>
                <span className="font-semibold">
                  {summary.hasLoss ? "✕ " : "✓ "}
                  {summary.summary}
                </span>
                {summary.rtt && <span className="block text-text-muted">{summary.rtt}</span>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
