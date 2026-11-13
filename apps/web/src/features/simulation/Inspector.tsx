import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { fill, messages } from "../../i18n";
import { formatExchange, formatSimTime, formatTrace, isLossOrError, pduLayers, type ExplanationLevel } from "../../i18n/simulation";
import { useObservationStore } from "./observation";
import type { SimulationSession } from "./store";

const t = messages.simulation;
const ti = t.inspector;

export function LevelToggle({ level }: { level: ExplanationLevel }) {
  return (
    <span role="group" aria-label={t.level} className="inline-flex overflow-hidden rounded-sm border border-border-strong text-xs">
      {(["beginner", "technical"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={level === value}
          onClick={() => {
            useObservationStore.getState().setLevel(value);
          }}
          className={`min-h-7 px-2 transition-colors duration-(--duration-fast) ${level === value ? "bg-accent text-on-accent" : "text-text-muted hover:text-text"}`}
        >
          {t.levels[value]}
        </button>
      ))}
    </span>
  );
}

/**
 * Inspecteur d'une décision : explication (débutant ou technique), contexte
 * (équipement, instant, événement, cause, échange) et unité de données
 * décomposée par couche — uniquement les champs modélisés par le moteur.
 */
export function Inspector({ session }: { session: SimulationSession }) {
  const inspected = useObservationStore((state) => state.inspected);
  const level = useObservationStore((state) => state.level);
  const index = inspected === null ? -1 : session.journal.findIndex((item) => item.key === inspected);
  const item = session.journal[index];
  if (!item) return <p className="text-sm text-text-muted">{ti.empty}</p>;

  const { entry } = item;
  const names = session.names;
  const store = useObservationStore.getState();
  const cause = entry.parent === null ? undefined : session.journal.find((candidate) => candidate.entry.event === entry.parent);
  const error = isLossOrError(entry);
  const layers = entry.pdu ? pduLayers(entry.pdu, names) : [];
  const previous = session.journal[index - 1];
  const next = session.journal[index + 1];

  return (
    <article aria-labelledby="inspector-title" className="flex flex-col gap-4 text-sm">
      <header className="flex flex-col gap-1">
        <h3 id="inspector-title" className="font-semibold text-text">
          {ti.title} · <span className="font-mono">{formatSimTime(entry.time)}</span>
        </h3>
        {error && <p className="font-semibold text-danger">{ti.lossBadge}</p>}
      </header>

      <section aria-labelledby="inspector-explanation" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 id="inspector-explanation" className="text-xs font-semibold text-text-muted">
            {ti.explanation}
          </h4>
          <LevelToggle level={level} />
        </div>
        <p className={error ? "text-danger" : "text-text"}>{formatTrace(entry, names, level)}</p>
      </section>

      <section aria-labelledby="inspector-context" className="flex flex-col gap-1">
        <h4 id="inspector-context" className="text-xs font-semibold text-text-muted">
          {ti.context}
        </h4>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-text-muted">{ti.device}</dt>
          <dd className="text-text">{entry.deviceId ? `${names.device(entry.deviceId)}${entry.portId ? ` · ${entry.portId}` : ""}` : "—"}</dd>
          <dt className="text-text-muted">{ti.event}</dt>
          <dd className="text-text">{fill(ti.eventValue, { event: entry.event })}</dd>
          <dt className="text-text-muted">{ti.cause}</dt>
          <dd className="text-text">
            {entry.parent === null ? ti.causeNone : fill(ti.causeValue, { event: entry.parent })}
            {entry.parent !== null &&
              (cause ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-2"
                  onClick={() => {
                    store.inspect(cause.key);
                  }}
                >
                  {ti.inspectCause}
                </Button>
              ) : (
                <span className="ml-2 text-text-muted">{ti.causeMissing}</span>
              ))}
          </dd>
          <dt className="text-text-muted">{ti.exchange}</dt>
          <dd className="text-text">
            {entry.exchange ? formatExchange(entry.exchange) : ti.noExchange}
            {entry.exchange && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-2"
                onClick={() => {
                  store.follow(entry.exchange);
                }}
              >
                {ti.follow}
              </Button>
            )}
          </dd>
          <dt className="text-text-muted">{ti.code}</dt>
          <dd className="font-mono text-text">{entry.code}</dd>
        </dl>
      </section>

      <section aria-labelledby="inspector-pdu" className="flex flex-col gap-2">
        <h4 id="inspector-pdu" className="text-xs font-semibold text-text-muted">
          {ti.pdu}
        </h4>
        {layers.length === 0 ? (
          <p className="text-xs text-text-muted">{ti.noPdu}</p>
        ) : (
          <>
            {layers.map((layer) => (
              <section key={layer.id} aria-label={layer.title} className="rounded-sm border border-border">
                <p className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-border px-2 py-1 text-xs">
                  <span className="font-semibold text-text">{layer.title}</span>
                  <span className="text-text-muted">{layer.osi}</span>
                </p>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-2 py-1 text-xs">
                  {/* Libellés répétés (entrées RIP, liens et LSA OSPF) : la position identifie le champ, la liste est figée. */}
                  {layer.fields.map(([label, value], index) => (
                    <div key={`${String(index)}-${label}`} className="contents">
                      <dt className="text-text-muted">{label}</dt>
                      <dd className="font-mono break-words text-text">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <p className="text-xs text-text-muted">{ti.modeled}</p>
          </>
        )}
      </section>

      <nav aria-label={ti.title} className="flex justify-between gap-2">
        <Button
          size="sm"
          disabled={!previous}
          onClick={() => {
            if (previous) store.inspect(previous.key);
          }}
        >
          <ChevronLeft aria-hidden="true" size={14} />
          {ti.previous}
        </Button>
        <Button
          size="sm"
          disabled={!next}
          onClick={() => {
            if (next) store.inspect(next.key);
          }}
        >
          {ti.next}
          <ChevronRight aria-hidden="true" size={14} />
        </Button>
      </nav>
    </article>
  );
}
