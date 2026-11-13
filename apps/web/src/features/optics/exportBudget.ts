import type { DirectionBudget, OpticalPath, OpticalReport } from "@netforge/engine";
import type { NfgDocument } from "@netforge/project";
import { fill, messages } from "../../i18n";
import { deviceName, elementLabel, formatDb, formatFineDb, formatWavelength, pathLabel, statusText } from "./format";

/**
 * Exports des bilans optiques (phase 9) : CSV pour un tableur, texte du
 * rapport PDF. Mêmes valeurs que la vue Bilan ; en exercice, bilan de
 * conception sans les pannes, comme à l'écran.
 */
const t = messages.optics;
const e = t.exports;

type Cell = { readonly text: string } | { readonly number: number };

/** Nombre en notation française pour un tableur : virgule décimale, trois décimales, sans séparateur de milliers. */
function csvNumber(value: number): string {
  const fixed = value.toFixed(3);
  return (fixed === "-0.000" ? "0.000" : fixed).replace(".", ",");
}

/** Cellule CSV : séparateur « ; », guillemets doublés ; un texte commençant par = + - @ est neutralisé (injection de formule). */
function csvCell(cell: Cell): string {
  if ("number" in cell) return csvNumber(cell.number);
  const guarded = /^[=+\-@\t\r]/.test(cell.text) ? `'${cell.text}` : cell.text;
  return /[;"\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

function directionRow(doc: NfgDocument, path: OpticalPath, budget: DirectionBudget, exercise: boolean): Cell[] {
  const figures = exercise ? budget.nominal : budget.actual;
  const faultLoss = budget.actual.lossMaxDb - budget.nominal.lossMaxDb;
  const blocked = figures.status === "cut" || figures.status === "incompatible" || figures.status === "technology-mismatch";
  const value = (number: number): Cell => (blocked ? { text: "" } : { number });
  return [
    { text: pathLabel(doc, path) },
    { text: deviceName(doc, path.olt.deviceId) },
    { text: path.olt.portId },
    { text: deviceName(doc, path.ont.deviceId) },
    { text: t.technology[path.oltTechnology] },
    { text: t.technology[path.ontTechnology] },
    { text: t.directionShort[budget.direction] },
    { text: String(budget.wavelengthNm) },
    { number: budget.txMinDbm },
    { number: budget.txMaxDbm },
    { number: budget.sensitivityDbm },
    { number: budget.overloadDbm },
    { number: budget.penaltyDb },
    { number: budget.availableDb },
    { text: budget.odnClass.id },
    { number: budget.nominal.lossMinDb },
    { number: budget.nominal.lossMaxDb },
    ...(exercise ? [] : [{ number: faultLoss }]),
    value(figures.receivedMinDbm),
    value(figures.marginDb),
    value(figures.overloadMarginDb),
    { text: t.status[figures.status] },
  ];
}

/** Fichier CSV des bilans : une ligne par chemin et par sens (UTF-8, séparateur « ; »). */
export function budgetCsv(doc: NfgDocument, report: OpticalReport, exercise: boolean): string {
  const headers = [...e.columns.slice(0, 17), ...(exercise ? [] : [e.faultColumn]), ...e.columns.slice(17)];
  const rows = report.paths.flatMap((path) => [directionRow(doc, path, path.downstream, exercise), directionRow(doc, path, path.upstream, exercise)]);
  return [headers.map((text) => csvCell({ text })), ...rows.map((row) => row.map(csvCell))].map((cells) => cells.join(";")).join("\r\n") + "\r\n";
}

function directionLines(doc: NfgDocument, path: OpticalPath, budget: DirectionBudget, exercise: boolean, reserve: number): string[] {
  const figures = exercise ? budget.nominal : budget.actual;
  const blocked = figures.status === "cut" || figures.status === "incompatible" || figures.status === "technology-mismatch";
  const lines = [
    `  ${fill(budget.direction === "downstream" ? t.downstream : t.upstream, { wavelength: formatWavelength(budget.wavelengthNm) })}`,
    `    ${fill(t.transmitter, { device: deviceName(doc, budget.transmitter.deviceId), profile: t.profiles[budget.transmitterProfile] })} : ${fill(t.txRange, { min: formatDb(budget.txMinDbm), max: formatDb(budget.txMaxDbm) })}`,
    `    ${fill(t.receiver, { device: deviceName(doc, budget.receiver.deviceId), profile: t.profiles[budget.receiverProfile] })} : ${fill(t.rxLimits, { sensitivity: formatDb(budget.sensitivityDbm), overload: formatDb(budget.overloadDbm) })}`,
    `    ${t.penalty} : ${fill(t.db, { value: formatDb(budget.penaltyDb) })} ; ${t.available} : ${fill(t.availableValue, { value: formatDb(budget.availableDb), odnClass: budget.odnClass.id, min: budget.odnClass.minLossDb, max: budget.odnClass.maxLossDb })}`,
    `    ${t.loss} : ${fill(t.lossValue, { min: formatDb(budget.nominal.lossMinDb), max: formatDb(budget.nominal.lossMaxDb) })}${exercise || budget.actual.lossMaxDb === budget.nominal.lossMaxDb ? "" : ` ; ${t.lossWithFaults} : ${fill(t.lossValue, { min: formatDb(budget.actual.lossMinDb), max: formatDb(budget.actual.lossMaxDb) })}`}`,
  ];
  if (!blocked) {
    lines.push(
      `    ${t.receivedMin} : ${fill(t.dbm, { value: formatDb(figures.receivedMinDbm) })} ; ${t.margin} : ${fill(t.marginValue, { value: formatDb(figures.marginDb), reserve: formatDb(reserve) })}`,
      `    ${t.overloadMargin} : ${fill(t.overloadValue, { value: formatDb(figures.overloadMarginDb), received: formatDb(figures.receivedMaxDbm) })}`,
    );
  }
  lines.push(`    ${t.statusLabel} : ${statusText(figures.status, exercise)}`);
  // Contributions dans l'ordre de ce sens, avec le cumul (comme le tableau de la vue Bilan).
  const width = 52;
  lines.push(`    ${t.columns.element.padEnd(width)} ${t.columns.nominal.padStart(11)}${exercise ? "" : ` ${t.columns.fault.padStart(8)}`} ${t.columns.cumulative.padStart(8)}`);
  let sum = 0;
  for (const item of budget.contributions) {
    const element = path.elements[item.index];
    if (!element) continue;
    sum += item.maxDb + (exercise ? 0 : item.faultDb);
    const fault = exercise ? "" : ` ${(item.faultDb > 0 ? `+${formatFineDb(item.faultDb)}` : element.faults.some((f) => f.extraLoss === null) ? "X" : "").padStart(8)}`;
    lines.push(`    ${elementLabel(doc, element.element).slice(0, width).padEnd(width)} ${formatFineDb(item.maxDb).padStart(11)}${fault} ${formatFineDb(sum).padStart(8)}`);
  }
  return lines;
}

/** Texte du rapport PDF : en-tête, puis chaque chemin, ses deux sens et ses contributions. */
export function budgetReportLines(doc: NfgDocument, report: OpticalReport, exercise: boolean, date: string): string[] {
  const lines = [fill(e.meta, { date, count: report.paths.length, mode: exercise ? e.modeDesign : e.modeActual }), t.sources, ""];
  for (const path of report.paths) {
    const technology = path.oltTechnology === path.ontTechnology ? t.technology[path.oltTechnology] : fill(t.pathMismatch, { olt: t.technology[path.oltTechnology], ont: t.technology[path.ontTechnology] });
    lines.push(fill(e.pathTitle, { path: pathLabel(doc, path), technology, status: statusText(exercise ? path.nominalStatus : path.status, exercise) }));
    lines.push(...directionLines(doc, path, path.downstream, exercise, report.reserveDb), ...directionLines(doc, path, path.upstream, exercise, report.reserveDb), "");
  }
  if (report.unreachedOnts.length > 0) lines.push(...report.unreachedOnts.map((ontId) => fill(t.unreached, { name: deviceName(doc, ontId) })));
  return lines;
}
