import type { DeviceView } from "@netforge/engine";
import { useId, useMemo, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { compareNames, fill, messages } from "../../i18n";
import { buildNameIndex, formatSimTime, type NameIndex } from "../../i18n/simulation";
import { useLabStore, type Selection } from "../lab/store";
import { simulation } from "./services";
import type { SimulationSession } from "./store";

const t = messages.simulation.runtime;
const EMPTY_NAMES = buildNameIndex([]);

/**
 * Listes compactes plutôt que tableaux larges : le panneau mesure 22 rem et
 * chaque entrée tient sur deux lignes lisibles sans défilement horizontal.
 */
function EntryList({ title, empty, children }: { title: string; empty: string | null; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {empty !== null ? <p className="text-xs text-text-muted">{empty}</p> : <ul className="flex flex-col gap-1">{children}</ul>}
    </section>
  );
}

function Entry({ main, detail }: { main: ReactNode; detail: ReactNode }) {
  return (
    <li className="rounded-sm border border-border px-2 py-1.5 text-xs">
      <span className="block font-mono break-words text-text">{main}</span>
      <span className="block text-text-muted">{detail}</span>
    </li>
  );
}

function State({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "text-text" : "font-semibold text-danger"}>{`${ok ? "●" : "✕"} ${label}`}</span>;
}

/** Tables observables d'un équipement : uniquement ce que le moteur a calculé. */
function DeviceRuntime({ device, names }: { device: DeviceView; names: NameIndex }) {
  const usedPorts = device.interfaces.filter((item) => item.linkId !== null || item.ipv4 !== null);
  const shownPorts = usedPorts.length > 0 ? usedPorts : device.interfaces.slice(0, 1);
  return (
    <div className="flex flex-col gap-5">
      <EntryList title={t.interfaces} empty={null}>
        {shownPorts.map((item) => (
          <Entry
            key={item.portId}
            main={`${item.portId}${item.ipv4 ? ` · ${item.ipv4}` : ""}`}
            detail={
              <>
                {t.mac} {item.mac} · <State ok={item.up} label={item.up ? t.up : t.down} />
              </>
            }
          />
        ))}
      </EntryList>

      {device.kind === "switch" ? (
        <EntryList title={t.macTable} empty={device.macTable.length === 0 ? t.macEmpty : null}>
          {device.macTable.map((entry) => (
            <Entry
              key={entry.mac}
              main={names.mac(entry.mac)}
              detail={fill(t.macDetail, { port: entry.portId, expires: formatSimTime(entry.expiresAt) })}
            />
          ))}
        </EntryList>
      ) : (
        <>
          <EntryList title={t.arpCache} empty={device.arpCache.length === 0 ? t.arpEmpty : null}>
            {device.arpCache.map((entry) => (
              <Entry
                key={`${entry.portId}-${entry.ip}`}
                main={`${entry.ip} → ${names.mac(entry.mac)}`}
                detail={fill(t.arpDetail, { port: entry.portId, expires: formatSimTime(entry.expiresAt) })}
              />
            ))}
          </EntryList>
          {device.pendingArp.length > 0 && (
            <EntryList title={t.pendingArp} empty={null}>
              {device.pendingArp.map((entry) => (
                <Entry
                  key={`${entry.portId}-${entry.ip}`}
                  main={entry.ip}
                  detail={fill(t.pendingDetail, { port: entry.portId, attempts: entry.attempts, queued: entry.queued })}
                />
              ))}
            </EntryList>
          )}
          <EntryList title={t.routes} empty={device.routes.length === 0 ? t.routesEmpty : null}>
            {device.routes.map((route) => (
              <Entry
                key={`${route.kind}-${route.destination}-${String(route.prefixLength)}-${route.nextHop ?? ""}`}
                main={`${route.destination}/${String(route.prefixLength)} → ${route.nextHop ?? t.direct}${route.portId ? ` (${route.portId})` : ""}`}
                detail={
                  <>
                    {t.routeKinds[route.kind]} ·{" "}
                    <State ok={route.active} label={route.active ? t.active : fill(t.inactive, { reason: route.reason ? t.reasons[route.reason] : "" })} />
                  </>
                }
              />
            ))}
          </EntryList>
        </>
      )}
    </div>
  );
}

/** Panneau droit de la vue Simulation : état d'exécution de la sélection. */
export function RuntimePanel({
  projectId,
  session,
  selection,
  disabled,
}: {
  projectId: string;
  session: SimulationSession | null;
  selection: Selection;
  disabled: boolean;
}) {
  const chooserId = useId();
  const names = session?.names ?? EMPTY_NAMES;
  const sessionDevices = session?.devices;
  const devices = useMemo(
    () => (sessionDevices ? Object.values(sessionDevices).sort((a, b) => compareNames(a.name, b.name)) : []),
    [sessionDevices],
  );
  const device = session && selection?.kind === "device" ? session.devices[selection.id] : undefined;
  const linkUp = session && selection?.kind === "link" ? session.links[selection.id] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <h2 className="text-base font-semibold text-text">
        {device ? (
          <>
            {device.name} <span className="text-sm font-normal text-text-muted">· {t.title}</span>
          </>
        ) : (
          t.title
        )}
      </h2>
      {session && devices.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={chooserId} className="text-xs font-medium text-text">
            {t.inspect}
          </label>
          <select
            id={chooserId}
            value={device?.deviceId ?? ""}
            onChange={(event) => {
              useLabStore.getState().select(projectId, event.target.value ? { kind: "device", id: event.target.value } : null);
            }}
            className="min-h-9 rounded-sm border border-border-strong bg-canvas px-2 text-sm text-text"
          >
            <option value="">{t.inspectNone}</option>
            {devices.map((item) => (
              <option key={item.deviceId} value={item.deviceId}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {!session ? (
        <p className="text-sm text-text-muted">{t.notLoaded}</p>
      ) : device ? (
        <DeviceRuntime device={device} names={names} />
      ) : selection?.kind === "link" && linkUp !== undefined ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">
            {t.linkTitle} <span className="font-mono">{names.link(selection.id)}</span>
          </p>
          <p className="text-sm">
            <span className="text-text-muted">{t.linkState} : </span>
            <State ok={linkUp} label={linkUp ? messages.simulation.linkUp : messages.simulation.linkDown} />
          </p>
          <Button size="sm" disabled={disabled} className="self-start" onClick={() => void simulation.setLink(selection.id, !linkUp)}>
            {linkUp ? messages.simulation.faultCut : messages.simulation.faultRestore}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">{t.hint}</p>
      )}
    </div>
  );
}
