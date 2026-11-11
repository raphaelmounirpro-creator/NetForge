import { inspectConnector, measurementConformity, measurePower, type Direction } from "@netforge/engine";
import { getModel, isOptical, type NfgDocument } from "@netforge/project";
import { useId } from "react";
import { Button } from "../../components/ui/Button";
import { compareNames, fill, messages } from "../../i18n";
import { useLabStore, type Selection } from "../lab/store";
import { inspectionText, measurementText } from "./format";
import { isOpticalDevice } from "./hooks";
import { useOpticsSession, useOpticsStore, type OpticsLogEntry } from "./store";

const t = messages.optics;
const selectClass = "min-h-9 w-full rounded-sm border border-border-strong bg-canvas px-2 text-sm text-text";

function LogLine({ doc, entry }: { doc: NfgDocument; entry: OpticsLogEntry }) {
  if (entry.kind === "inspection") return <li className="text-text">{inspectionText(doc, entry.inspection)}</li>;
  const conformity = measurementConformity(entry.measurement);
  return (
    <li className={conformity === "deviation" ? "text-danger" : "text-text"}>
      {conformity === "deviation" ? "✕ " : conformity === "conform" ? "✓ " : ""}
      {measurementText(doc, entry.measurement)}
      {conformity && ` (${t.conformity[conformity]})`}
    </li>
  );
}

/** Photomètre et microscope d'inspection, sur les connecteurs de l'équipement sélectionné. */
export function OpticsMeasure({ projectId, doc, selection }: { projectId: string; doc: NfgDocument; selection: Selection }) {
  const id = useId();
  const session = useOpticsSession(projectId);
  const store = useOpticsStore.getState;
  const onts = doc.topology.devices.filter((device) => getModel(device.model).kind === "ont").sort((a, b) => compareNames(a.name, b.name));
  const ontId = session.ontId && onts.some((device) => device.id === session.ontId) ? session.ontId : (onts[0]?.id ?? null);
  const device = selection?.kind === "device" ? doc.topology.devices.find((item) => item.id === selection.id) : undefined;
  const optical = device ? isOpticalDevice(doc, device.id) : false;
  const ports = device ? getModel(device.model).ports.filter((port) => port.medium === "fiber") : [];
  // Alternative au canevas : choix de l'équipement au clavier (la sélection du laboratoire suit).
  const opticalDevices = doc.topology.devices
    .filter((item) => isOptical(getModel(item.model).kind) && getModel(item.model).ports.some((port) => port.connector !== null))
    .sort((a, b) => compareNames(a.name, b.name));

  const measure = (portId: string) => {
    if (!device) return;
    const point = { deviceId: device.id, portId };
    const measurement =
      session.direction === "downstream" ? measurePower(doc, { direction: "downstream", point }) : measurePower(doc, { direction: "upstream", point, ontId: ontId ?? "" });
    store().record(projectId, { kind: "power", measurement });
  };
  const inspect = (portId: string) => {
    if (!device) return;
    store().record(projectId, { kind: "inspection", inspection: inspectConnector(doc, { deviceId: device.id, portId }) });
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{t.measureTitle}</h3>
      <p className="text-xs text-text-muted">{t.measureHint}</p>
      <fieldset className="flex flex-col gap-1 text-sm text-text">
        <legend className="mb-1 text-xs font-semibold">{t.direction}</legend>
        {(["downstream", "upstream"] as const satisfies readonly Direction[]).map((direction) => (
          <label key={direction} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-direction`}
              checked={session.direction === direction}
              onChange={() => {
                store().update(projectId, { direction });
              }}
            />
            {t.directions[direction]}
          </label>
        ))}
      </fieldset>
      {session.direction === "upstream" &&
        (onts.length === 0 ? (
          <p className="text-xs text-text-muted">{t.noOnt}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-ont`} className="text-xs font-medium text-text">
              {t.ontChoice}
            </label>
            <select
              id={`${id}-ont`}
              className={selectClass}
              value={ontId ?? ""}
              onChange={(event) => {
                store().update(projectId, { ontId: event.target.value });
              }}
            >
              {onts.map((ont) => (
                <option key={ont.id} value={ont.id}>
                  {ont.name}
                </option>
              ))}
            </select>
          </div>
        ))}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-device`} className="text-xs font-medium text-text">
          {t.deviceChoice}
        </label>
        <select
          id={`${id}-device`}
          className={selectClass}
          value={device && optical ? device.id : ""}
          onChange={(event) => {
            useLabStore.getState().select(projectId, event.target.value ? { kind: "device", id: event.target.value } : null);
          }}
        >
          <option value="">{t.deviceNone}</option>
          {opticalDevices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {!device ? (
        <p className="text-sm text-text-muted">{t.selectDevice}</p>
      ) : !optical ? (
        <p className="text-sm text-text-muted">{fill(t.notOptical, { name: device.name })}</p>
      ) : (
        <section aria-label={fill(t.portsOf, { name: device.name })} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-text">{fill(t.portsOf, { name: device.name })}</h4>
          <ul className="flex flex-col gap-1">
            {ports.map((port) => (
              <li key={port.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border px-2 py-1">
                <span className="font-mono text-sm text-text">
                  {port.id}
                  {port.connector && <span className="ml-2 text-xs text-text-muted">{port.connector}</span>}
                </span>
                {port.connector === null ? (
                  <span className="text-xs text-text-muted">{t.cableEntryPort}</span>
                ) : (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="primary"
                      aria-label={fill(t.measureLabel, { port: port.id, name: device.name })}
                      onClick={() => {
                        measure(port.id);
                      }}
                    >
                      {t.measure}
                    </Button>
                    <Button
                      size="sm"
                      aria-label={fill(t.inspectLabel, { port: port.id, name: device.name })}
                      onClick={() => {
                        inspect(port.id);
                      }}
                    >
                      {t.inspect}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t.log} className="flex flex-col gap-1 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-text">{t.log}</h4>
          {session.log.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                store().clearLog(projectId);
              }}
            >
              {t.clearLog}
            </Button>
          )}
        </div>
        <div role="status" aria-live="polite" className="text-xs">
          {session.log.length === 0 ? (
            <p className="text-text-muted">{t.emptyLog}</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {session.log.map((entry) => (
                <LogLine key={entry.id} doc={doc} entry={entry} />
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
