import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { compareNames, fill, messages } from "../../i18n";
import {
  TRACE_CATEGORIES,
  formatSimTime,
  formatTrace,
  isLossOrError,
  traceCategory,
  type NameIndex,
  type TraceCategory,
} from "../../i18n/simulation";
import { JOURNAL_LIMIT, type JournalEntry, type SimulationSession } from "./store";

const t = messages.simulation;
/** Lignes rendues d'emblée : le rendu reste court même quand le moteur produit beaucoup de décisions. */
const RENDER_STEP = 100;

const Row = memo(function Row({ item, names }: { item: JournalEntry; names: NameIndex }) {
  const { entry } = item;
  const category = traceCategory(entry.code);
  // Perte ou erreur : rouge, mais aussi symbole et texte (la couleur n'est jamais seule).
  const error = isLossOrError(entry);
  return (
    <li
      className={`grid grid-cols-[6.75rem_minmax(0,1fr)] gap-x-3 border-b border-border py-1.5 pr-3 text-xs [contain-intrinsic-size:auto_2rem] [content-visibility:auto] ${
        error ? "border-l-4 border-l-danger bg-danger/10 pl-2" : "pl-3"
      }`}
      data-code={entry.code}
      data-severity={error ? "error" : "normal"}
    >
      <span className="font-mono text-text-muted">{formatSimTime(entry.time)}</span>
      <span className={`break-words ${error ? "font-medium text-danger" : "text-text"}`}>
        {error && (
          <span aria-hidden="true" className="mr-1 font-bold">
            ✕
          </span>
        )}
        {error && <span className="sr-only">{t.lossOrError} </span>}
        <span className={`mr-2 inline-block rounded-sm border px-1 font-medium ${error ? "border-danger text-danger" : "border-border text-accent-text"}`}>
          {t.categories[category]}
        </span>
        {formatTrace(entry, names)}
      </span>
    </li>
  );
});

/**
 * Journal des décisions du moteur, dans l'ordre de calcul. Les filtres ne
 * changent que l'affichage ; le moteur calcule toujours tous les événements.
 */
export function TraceJournal({ session }: { session: SimulationSession }) {
  const filterId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const [device, setDevice] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<TraceCategory>>(() => new Set());
  const [renderLimit, setRenderLimit] = useState(RENDER_STEP);
  const [lossesOnly, setLossesOnly] = useState(false);
  const names = session.names;
  // Rendu différé et interruptible : un lot volumineux ne bloque jamais le fil de l'interface.
  const journal = useDeferredValue(session.journal);
  const devices = useMemo(
    () => Object.values(session.devices).sort((a, b) => compareNames(a.name, b.name)),
    [session.devices],
  );
  const entries = useMemo(
    () =>
      journal.filter(
        (item) =>
          (device === "" || item.entry.deviceId === device) &&
          !hidden.has(traceCategory(item.entry.code)) &&
          (!lossesOnly || isLossOrError(item.entry)),
      ),
    [journal, device, hidden, lossesOnly],
  );
  const shown = entries.length > renderLimit ? entries.slice(-renderLimit) : entries;

  // Défilement automatique vers la dernière décision, sauf si l'utilisateur relit plus haut.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [shown]);

  const toggle = (category: TraceCategory) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2 text-xs">
        <span className="flex items-center gap-2">
          <label htmlFor={filterId} className="text-text-muted">
            {t.filterDevice}
          </label>
          <select
            id={filterId}
            value={device}
            onChange={(event) => {
              setDevice(event.target.value);
            }}
            className="min-h-8 rounded-sm border border-border-strong bg-canvas px-2 text-xs text-text"
          >
            <option value="">{t.allDevices}</option>
            {devices.map((item) => (
              <option key={item.deviceId} value={item.deviceId}>
                {item.name}
              </option>
            ))}
          </select>
        </span>
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="sr-only">{t.filters}</legend>
          {TRACE_CATEGORIES.map((category) => {
            const shown = !hidden.has(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={shown}
                onClick={() => {
                  toggle(category);
                }}
                className={`min-h-7 rounded-sm border px-2 transition-colors duration-(--duration-fast) ${
                  shown ? "border-accent-text text-text" : "border-border text-text-muted line-through"
                }`}
              >
                {t.categories[category]}
              </button>
            );
          })}
        </fieldset>
        <button
          type="button"
          aria-pressed={lossesOnly}
          onClick={() => {
            setLossesOnly((value) => !value);
          }}
          className={`min-h-7 rounded-sm border px-2 font-medium transition-colors duration-(--duration-fast) ${
            lossesOnly ? "border-danger bg-danger/10 text-danger" : "border-border text-text-muted hover:text-text"
          }`}
        >
          ✕ {t.lossesOnly}
        </button>
      </div>
      {session.journalHidden > 0 && (
        <p className="shrink-0 border-b border-border px-3 py-1 text-xs text-text-muted">
          {fill(t.journalTrimmed, { count: session.journalHidden.toLocaleString("fr-FR"), max: JOURNAL_LIMIT.toLocaleString("fr-FR") })}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="p-3 text-sm text-text-muted">{session.journal.length === 0 ? t.journalEmpty : t.journalFiltered}</p>
      ) : (
        <ol
          ref={listRef}
          aria-label={t.journalLabel}
          tabIndex={0}
          onScroll={(event) => {
            const list = event.currentTarget;
            stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {entries.length > shown.length && (
            <li className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">
              {fill(t.journalWindow, { shown: shown.length, total: entries.length })}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenderLimit((value) => value + RENDER_STEP);
                }}
              >
                {fill(t.journalMore, { count: RENDER_STEP })}
              </Button>
            </li>
          )}
          {shown.map((item) => (
            <Row key={item.key} item={item} names={names} />
          ))}
        </ol>
      )}
    </div>
  );
}
