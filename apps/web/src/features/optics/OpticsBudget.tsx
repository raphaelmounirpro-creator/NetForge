import { type BudgetFigures, type Direction, type DirectionBudget, type OpticalPath } from "@netforge/engine";
import type { NfgDocument } from "@netforge/project";
import { useState } from "react";
import { Notice } from "../../components/ui/Notice";
import { fill, messages } from "../../i18n";
import { deviceName, elementLabel, formatDb, formatFineDb, formatWavelength, pathLabel, statusText } from "./format";

const t = messages.optics;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-mono text-text">{value}</dd>
    </div>
  );
}

/** Bilan d'un sens : limites de l'émetteur et du récepteur, pertes, marges et état. */
function DirectionSummary({ doc, budget, exercise, reserve }: { doc: NfgDocument; budget: DirectionBudget; exercise: boolean; reserve: number }) {
  // En exercice, seul le bilan de conception est affiché : les pannes se découvrent à la mesure.
  const figures: BudgetFigures = exercise ? budget.nominal : budget.actual;
  const withFaults = !exercise && budget.actual.lossMaxDb !== budget.nominal.lossMaxDb;
  const blocked = figures.status === "cut" || figures.status === "incompatible" || figures.status === "technology-mismatch";
  const title = fill(budget.direction === "downstream" ? t.downstream : t.upstream, { wavelength: formatWavelength(budget.wavelengthNm) });
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <h4 className="text-sm font-semibold text-text">{title}</h4>
      <dl className="flex flex-col gap-1.5 text-xs">
        <Row label={fill(t.transmitter, { device: deviceName(doc, budget.transmitter.deviceId), profile: t.profiles[budget.transmitterProfile] })} value={fill(t.txRange, { min: formatDb(budget.txMinDbm), max: formatDb(budget.txMaxDbm) })} />
        <Row
          label={fill(t.receiver, { device: deviceName(doc, budget.receiver.deviceId), profile: t.profiles[budget.receiverProfile] })}
          value={fill(t.rxLimits, { sensitivity: formatDb(budget.sensitivityDbm), overload: formatDb(budget.overloadDbm) })}
        />
        <Row label={t.penalty} value={fill(t.db, { value: formatDb(budget.penaltyDb) })} />
        <Row label={t.available} value={fill(t.availableValue, { value: formatDb(budget.availableDb), odnClass: budget.odnClass.id, min: budget.odnClass.minLossDb, max: budget.odnClass.maxLossDb })} />
        <Row label={t.loss} value={fill(t.lossValue, { min: formatDb(budget.nominal.lossMinDb), max: formatDb(budget.nominal.lossMaxDb) })} />
        {withFaults && <Row label={t.lossWithFaults} value={fill(t.lossValue, { min: formatDb(budget.actual.lossMinDb), max: formatDb(budget.actual.lossMaxDb) })} />}
        {!blocked && (
          <>
            <Row label={t.receivedMin} value={fill(t.dbm, { value: formatDb(figures.receivedMinDbm) })} />
            <Row label={t.threshold} value={fill(t.dbm, { value: formatDb(budget.sensitivityDbm + budget.penaltyDb) })} />
            <Row label={t.margin} value={fill(t.marginValue, { value: formatDb(figures.marginDb), reserve: formatDb(reserve) })} />
            <Row label={t.overloadMargin} value={fill(t.overloadValue, { value: formatDb(figures.overloadMarginDb), received: formatDb(figures.receivedMaxDbm) })} />
          </>
        )}
        <Row label={t.statusLabel} value={statusText(figures.status, exercise)} />
      </dl>
    </section>
  );
}

/** Tableau des contributions : chaque élément traversé, sa perte nominale maximale, la panne éventuelle et le cumul. */
function Contributions({ doc, path, direction, exercise }: { doc: NfgDocument; path: OpticalPath; direction: Direction; exercise: boolean }) {
  const budget = path[direction];
  // Cumul calculé avant le rendu (le rendu ne modifie aucune variable).
  const rows = budget.contributions.reduce<{ item: (typeof budget.contributions)[number]; sum: number }[]>((acc, item) => {
    acc.push({ item, sum: (acc.at(-1)?.sum ?? 0) + item.maxDb + (exercise ? 0 : item.faultDb) });
    return acc;
  }, []);
  return (
    <table className="w-full border-collapse text-xs">
      <caption className="mb-1 text-left text-text-muted">{fill(t.contributionsCaption, { direction: t.directionShort[direction] })}</caption>
      <thead>
        <tr className="border-b border-border text-left text-text-muted">
          <th scope="col" className="py-1 pr-2 font-medium">
            {t.columns.element}
          </th>
          <th scope="col" className="py-1 pr-2 text-right font-medium">
            {t.columns.nominal}
          </th>
          {!exercise && (
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              {t.columns.fault}
            </th>
          )}
          <th scope="col" className="py-1 text-right font-medium">
            {t.columns.cumulative}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ item, sum }) => {
          const element = path.elements[item.index];
          if (!element) return null;
          const fault = element.faults[0];
          return (
            <tr key={item.index} className="border-b border-border align-top">
              <th scope="row" className="py-1 pr-2 text-left font-normal text-text">
                {elementLabel(doc, element.element)}
              </th>
              <td className="py-1 pr-2 text-right font-mono text-text">{formatFineDb(item.maxDb)}</td>
              {!exercise && (
                <td className="py-1 pr-2 text-right font-mono text-danger">
                  {fault ? (fault.extraLoss === null ? `✕ ${t.faultKinds[fault.kind]}` : `+${formatFineDb(item.faultDb)}`) : ""}
                </td>
              )}
              <td className="py-1 text-right font-mono text-text">{formatFineDb(sum)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function OpticsBudget({ doc, path, exercise, reserve }: { doc: NfgDocument; path: OpticalPath | undefined; exercise: boolean; reserve: number }) {
  const [direction, setDirection] = useState<Direction>("downstream");
  if (!path) return <p className="p-4 text-sm text-text-muted">{t.selectPath}</p>;
  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{fill(t.budgetTitle, { path: pathLabel(doc, path) })}</h3>
      {exercise && <Notice tone="info">{t.designOnly}</Notice>}
      <DirectionSummary doc={doc} budget={path.downstream} exercise={exercise} reserve={reserve} />
      <DirectionSummary doc={doc} budget={path.upstream} exercise={exercise} reserve={reserve} />
      <fieldset className="flex flex-wrap gap-3 text-xs text-text">
        <legend className="mb-1 font-semibold">{fill(t.contributions, { direction: t.directionShort[direction] })}</legend>
        {(["downstream", "upstream"] as const).map((value) => (
          <label key={value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`contributions-${path.id}`}
              checked={direction === value}
              onChange={() => {
                setDirection(value);
              }}
            />
            {t.directionShort[value]}
          </label>
        ))}
      </fieldset>
      <Contributions doc={doc} path={path} direction={direction} exercise={exercise} />
      <p className="text-xs text-text-muted">{t.sources}</p>
    </div>
  );
}
