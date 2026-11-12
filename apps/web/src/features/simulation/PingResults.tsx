import { Button } from "../../components/ui/Button";
import { fill, messages } from "../../i18n";
import { pingAttemptText, pingResolutionLine, pingSummary } from "../../i18n/simulation";
import { useLabLayout } from "../lab/layout";
import { explainEcho } from "./observation";
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
        // Ping par nom : l'adresse obtenue par DNS s'ajoute au titre ; un échec de résolution remplace les échos.
        const byName = view.resolution !== null;
        const resolution = pingResolutionLine(view);
        const heading = byName && view.address !== null ? fill(t.pingHeadingResolved, { source, destination: view.destination, address: view.address }) : fill(t.pingHeading, { source, destination: view.destination });
        return (
          <li key={view.id} className="border-b border-border px-3 py-2">
            <h3 className="font-mono text-sm font-semibold break-all text-text">{heading}</h3>
            {resolution?.failed ? (
              <p aria-live="polite" data-severity="error" className="mt-1 text-xs font-semibold text-danger">
                {`✕ ${resolution.text}`}
              </p>
            ) : view.attempts.length === 0 ? (
              <p className="mt-1 text-xs text-text-muted">{view.resolution === "pending" ? fill(t.pingResolving, { name: view.destination }) : t.pingWaiting}</p>
            ) : (
              <ol className="mt-1 space-y-0.5 font-mono text-xs">
                {view.attempts.map((attempt) => (
                  <li
                    key={attempt.sequence}
                    data-status={attempt.status}
                    className={`flex flex-wrap items-center gap-x-2 ${attempt.status === "reply" ? "text-text" : attempt.status === "pending" ? "text-text-muted" : "text-danger"}`}
                  >
                    <span>
                      {attempt.status === "reply" ? "✓ " : attempt.status === "pending" ? "… " : "✗ "}
                      {pingAttemptText(attempt)}
                    </span>
                    {attempt.status !== "reply" && attempt.status !== "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="font-sans"
                        aria-label={fill(t.whyLabel, { sequence: attempt.sequence })}
                        onClick={() => {
                          explainEcho(session, view.id, attempt.sequence);
                          useLabLayout.getState().openProperties();
                        }}
                      >
                        {t.why}
                      </Button>
                    )}
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
