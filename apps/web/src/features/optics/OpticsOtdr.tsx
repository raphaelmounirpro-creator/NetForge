import { OTDR_WAVELENGTHS, runOtdr, type Direction, type OtdrEvent, type OtdrTrace, type OtdrWavelength } from "@netforge/engine";
import { getModel, isOptical, type NfgDocument } from "@netforge/project";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { compareNames, fill, messages } from "../../i18n";
import { deviceName, formatDb, formatWavelength } from "./format";
import { useOpticsSession, useOpticsStore } from "./store";

const t = messages.optics;
const o = t.otdr;
const selectClass = "min-h-9 w-full rounded-sm border border-border-strong bg-canvas px-2 text-sm text-text";
const km = new Intl.NumberFormat("fr", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const formatKm = (metres: number) => `${km.format(metres / 1000)} km`;

function where(event: OtdrEvent): string {
  if (event.distanceM !== null) return fill(o.at, { distance: formatKm(event.distanceM) });
  return event.section ? fill(o.between, { start: formatKm(event.section.startM), end: formatKm(event.section.endM) }) : "";
}

function eventLabel(doc: NfgDocument, event: OtdrEvent): string {
  const element = event.element;
  if (element.kind === "fiber") {
    const link = doc.topology.links.find((item) => item.id === element.linkId);
    const [a, b] = link ? link.endpoints.map((end) => `${deviceName(doc, end.deviceId)} ${end.portId}`) : ["", ""];
    return fill(o.events[event.kind === "break" ? "break" : "fiber-loss"], { a: a ?? "", b: b ?? "" });
  }
  const device = deviceName(doc, element.deviceId);
  if (element.kind === "coupler") return fill(o.events.coupler, { device, ratio: element.ratio });
  return fill(o.events[event.kind === "splice" ? "splice" : event.kind === "unmeasurable" ? "unmeasurable" : event.kind === "end" ? "end" : "connection"], { device, port: element.portId });
}

export function otdrSummary(doc: NfgDocument, trace: OtdrTrace): string {
  const launch = `${deviceName(doc, trace.launch.deviceId)} ${trace.launch.portId}`;
  const last = trace.events.at(-1);
  return fill(o.summary[trace.outcome], {
    launch,
    towards: trace.towards ? `${deviceName(doc, trace.towards.deviceId)} ${trace.towards.portId}` : "",
    wavelength: formatWavelength(trace.wavelengthNm),
    length: formatKm(trace.lengthM),
    loss: formatDb(last?.cumulativeDb ?? 0),
    where: last ? where(last) : "",
  });
}

/** Courbe de la trace (niveau relatif selon la distance), numéros d'événements et section incertaine. */
function TraceChart({ trace }: { trace: OtdrTrace }) {
  const width = 560;
  const height = 220;
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 30;
  const maxX = Math.max(trace.lengthM, trace.uncertain?.endM ?? 0, 1);
  const minY = Math.min(...trace.points.map((point) => point.levelDb), -1);
  const x = (metres: number) => left + (metres / maxX) * (width - left - right);
  const y = (db: number) => top + (db / minY) * (height - top - bottom);
  const located = trace.events.map((event, index) => ({ event, index })).filter(({ event }) => event.distanceM !== null);
  return (
    <svg viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={o.chartLabel} className="w-full rounded-sm border border-border bg-canvas">
      <title>{o.chartLabel}</title>
      <g className="text-text-muted" stroke="currentColor" strokeWidth="1">
        <line x1={left} y1={top} x2={left} y2={height - bottom} />
        <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
      </g>
      <g className="text-text-muted" fill="currentColor" fontSize="10" fontFamily="ui-monospace, Consolas, monospace">
        <text x={left} y={height - 10} textAnchor="middle">
          0
        </text>
        <text x={width - right} y={height - 10} textAnchor="end">
          {`${km.format(maxX / 1000)} ${o.axisDistance}`}
        </text>
        <text x={left - 4} y={top + 4} textAnchor="end">
          0
        </text>
        <text x={left - 4} y={height - bottom} textAnchor="end">
          {formatDb(minY)}
        </text>
        <text x={4} y={top + 4}>
          {o.axisLevel}
        </text>
      </g>
      {trace.uncertain && (
        <rect x={x(trace.uncertain.startM)} y={top} width={Math.max(2, x(trace.uncertain.endM) - x(trace.uncertain.startM))} height={height - top - bottom} className="text-warning" fill="currentColor" opacity="0.15" />
      )}
      <polyline className="text-accent-text" fill="none" stroke="currentColor" strokeWidth="2" points={trace.points.map((point) => `${x(point.distanceM).toFixed(1)},${y(point.levelDb).toFixed(1)}`).join(" ")} />
      <g className="text-text" fill="currentColor" fontSize="9" fontFamily="ui-monospace, Consolas, monospace">
        {located.map(({ event, index }) => (
          <text key={index} x={x(event.distanceM ?? 0)} y={top + 9 + (index % 3) * 10} textAnchor="middle">
            {index + 1}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** Onglet OTDR de la vue Optique : réglages, acquisition (moteur), courbe et tableau des événements. */
export function OpticsOtdr({ projectId, doc }: { projectId: string; doc: NfgDocument }) {
  const id = useId();
  const session = useOpticsSession(projectId);
  const points = doc.topology.devices
    .filter((device) => isOptical(getModel(device.model).kind))
    .sort((a, b) => compareNames(a.name, b.name))
    .flatMap((device) => getModel(device.model).ports.filter((port) => port.connector !== null).map((port) => ({ value: `${device.id}/${port.id}`, deviceId: device.id, portId: port.id, label: fill(o.pointOption, { device: device.name, port: port.id }) })));
  const onts = doc.topology.devices.filter((device) => getModel(device.model).kind === "ont").sort((a, b) => compareNames(a.name, b.name));
  const [point, setPoint] = useState(points.find((item) => getModel(doc.topology.devices.find((device) => device.id === item.deviceId)?.model ?? "PC").kind === "olt")?.value ?? "");
  const [direction, setDirection] = useState<Direction>("downstream");
  const [ontId, setOntId] = useState(onts[0]?.id ?? "");
  const [wavelength, setWavelength] = useState<OtdrWavelength>(1550);
  const trace = session.otdr;

  const run = () => {
    const chosen = points.find((item) => item.value === point);
    if (!chosen) return;
    const result = runOtdr(doc, { point: { deviceId: chosen.deviceId, portId: chosen.portId }, direction, wavelengthNm: wavelength, ...(direction === "downstream" && ontId ? { ontId } : {}) });
    useOpticsStore.getState().update(projectId, { otdr: result });
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{o.title}</h3>
      <p className="text-xs text-text-muted">{o.hint}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-point`} className="text-xs font-medium text-text">
          {o.point}
        </label>
        <select
          id={`${id}-point`}
          className={selectClass}
          value={point}
          onChange={(event) => {
            setPoint(event.target.value);
          }}
        >
          <option value="">{o.pointNone}</option>
          {points.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm text-text">
        <legend className="mb-1 text-xs font-semibold">{o.direction}</legend>
        {(["downstream", "upstream"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-direction`}
              checked={direction === value}
              onChange={() => {
                setDirection(value);
              }}
            />
            {o.directions[value]}
          </label>
        ))}
      </fieldset>
      {direction === "downstream" && onts.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-ont`} className="text-xs font-medium text-text">
            {o.branch}
          </label>
          <select
            id={`${id}-ont`}
            className={selectClass}
            value={ontId}
            onChange={(event) => {
              setOntId(event.target.value);
            }}
          >
            {onts.map((ont) => (
              <option key={ont.id} value={ont.id}>
                {ont.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <fieldset className="flex flex-wrap gap-4 text-sm text-text">
        <legend className="mb-1 text-xs font-semibold">{o.wavelength}</legend>
        {OTDR_WAVELENGTHS.map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-wavelength`}
              checked={wavelength === value}
              onChange={() => {
                setWavelength(value);
              }}
            />
            {o.wavelengths[value]}
          </label>
        ))}
      </fieldset>
      <Button size="sm" variant="primary" className="self-start" disabled={!point} onClick={run}>
        {o.run}
      </Button>

      {!trace ? (
        <p className="text-sm text-text-muted">{o.empty}</p>
      ) : (
        <section aria-label={o.title} className="flex flex-col gap-2">
          <p role="status" className="text-sm text-text">
            {otdrSummary(doc, trace)}
          </p>
          {trace.throughSplitter && trace.towards && <p className="text-xs text-text-muted">{fill(o.splitterNote, { ont: deviceName(doc, trace.towards.deviceId) })}</p>}
          {trace.uncertain && <p className="text-xs text-warning">{o.uncertainNote}</p>}
          {trace.points.length > 1 && <TraceChart trace={trace} />}
          {trace.events.length > 0 && (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {o.columns.index}
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {o.columns.distance}
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {o.columns.event}
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    {o.columns.loss}
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    {o.columns.cumulative}
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    {o.columns.reflective}
                  </th>
                </tr>
              </thead>
              <tbody>
                {trace.events.map((event, index) => (
                  <tr key={index} className={`border-b border-border align-top ${event.anomaly ? "text-danger" : "text-text"}`}>
                    <td className="py-1 pr-2 font-mono">{index + 1}</td>
                    <td className="py-1 pr-2 font-mono">{event.distanceM !== null ? formatKm(event.distanceM) : where(event)}</td>
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {eventLabel(doc, event)}
                      {event.anomaly && event.expectedMaxDb !== null && event.lossDb !== null && <span className="block">{fill(o.anomaly, { expected: formatDb(event.expectedMaxDb) })}</span>}
                    </th>
                    <td className="py-1 pr-2 text-right font-mono">{event.lossDb === null ? "—" : formatDb(event.lossDb)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{event.cumulativeDb === null ? "—" : formatDb(event.cumulativeDb)}</td>
                    <td className="py-1">{event.reflective ? o.reflective : o.notReflective}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-text-muted">{o.sources}</p>
        </section>
      )}
    </div>
  );
}
