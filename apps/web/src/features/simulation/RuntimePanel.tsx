import type { DeviceView } from "@netforge/engine";
import { useId, useMemo, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { compareNames, fill, messages } from "../../i18n";
import { buildNameIndex, formatSimTime, ospfSequence, type NameIndex } from "../../i18n/simulation";
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
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {title}
      </h3>
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
function DeviceRuntime({ device, names, disabled }: { device: DeviceView; names: NameIndex; disabled: boolean }) {
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

      {device.dhcpClient && <EntryList title={t.dhcpClientTitle} empty={null}>
        <li className="text-sm text-text">{messages.simulation.dhcpPhases[device.dhcpClient.phase]}</li>
        {device.dhcpClient.lease ? <Entry
          main={fill(t.dhcpLease, { address: device.dhcpClient.lease.address, prefix: device.dhcpClient.lease.prefixLength, gateway: device.dhcpClient.lease.gateway ?? "—", server: device.dhcpClient.lease.server })}
          detail={fill(t.dhcpTimes, { obtained: formatSimTime(device.dhcpClient.lease.obtainedAt), renew: formatSimTime(device.dhcpClient.lease.renewAt), rebind: formatSimTime(device.dhcpClient.lease.rebindAt), expires: formatSimTime(device.dhcpClient.lease.expiresAt) })}
        /> : <li className="text-xs text-text-muted">{t.dhcpNone}</li>}
        <li className="flex flex-wrap gap-2">
          <Button size="sm" disabled={disabled} onClick={() => void simulation.dhcp(device.deviceId, "renew")}>{t.dhcpRenew}</Button>
          <Button size="sm" variant="ghost" disabled={disabled || !device.dhcpClient.lease} onClick={() => void simulation.dhcp(device.deviceId, "release")}>{t.dhcpRelease}</Button>
        </li>
      </EntryList>}

      {device.dhcpServer && <EntryList title={t.dhcpServerTitle} empty={null}>
        {device.dhcpServer.pools.map((pool) => <Entry key={pool.portId} main={pool.portId} detail={fill(t.dhcpPool, { ...pool })} />)}
        {device.dhcpServer.leases.length === 0 && <li className="text-xs text-text-muted">{t.dhcpNone}</li>}
        {device.dhcpServer.leases.map((lease) => <Entry key={lease.address} main={`${lease.address} → ${names.mac(lease.mac)}`} detail={fill(t.dhcpLeaseEntry, { state: lease.state === "bound" ? t.dhcpBound : t.dhcpOffered, port: lease.portId, expires: lease.expiresAt === null ? "—" : formatSimTime(lease.expiresAt) })} />)}
      </EntryList>}

      {device.rip && (
        <EntryList title={t.ripTitle} empty={null}>
          <li className="text-xs text-text-muted">
            {device.rip.interfaces.map((item) => fill(t.ripInterface, { port: item.portId, mode: t.ripModes[item.mode] }) + (item.up ? "" : ` (${t.down})`)).join(" ; ")}
          </li>
          <li className="text-xs text-text-muted">{fill(t.ripNext, { time: formatSimTime(device.rip.nextUpdateAt) })}</li>
          {device.rip.routes.map((entry) => (
            <Entry
              key={`${entry.destination}/${String(entry.prefixLength)}`}
              main={`${entry.destination}/${String(entry.prefixLength)} → ${entry.nextHop ?? t.direct}`}
              detail={
                entry.state === "local" ? (
                  fill(t.ripLocal, { port: entry.portId })
                ) : entry.state === "deleting" ? (
                  <State ok={false} label={fill(t.ripDeleting, { port: entry.portId, garbage: entry.garbageAt === null ? "—" : formatSimTime(entry.garbageAt) })} />
                ) : (
                  fill(t.ripValid, { metric: entry.metric, port: entry.portId, expires: entry.expiresAt === null ? "—" : formatSimTime(entry.expiresAt) })
                )
              }
            />
          ))}
        </EntryList>
      )}

      {device.ospf && (
        <>
          <EntryList title={t.ospfTitle} empty={null}>
            <li className="text-xs text-text-muted">{fill(t.ospfRouter, { routerId: device.ospf.routerId, time: formatSimTime(device.ospf.nextHelloAt) })}</li>
            {device.ospf.interfaces.map((item) => (
              <Entry
                key={item.portId}
                main={fill(t.ospfInterface, { port: item.portId, state: messages.simulation.ospfInterfaceStates[item.state], cost: item.cost, priority: item.priority })}
                detail={
                  item.state === "down" ? (
                    <State ok={false} label={messages.simulation.ospfInterfaceStates.down} />
                  ) : item.mode === "passive" ? null : (
                    fill(t.ospfElected, { dr: item.dr ? names.router(item.dr) : messages.simulation.ospfNone, bdr: item.bdr ? names.router(item.bdr) : messages.simulation.ospfNone })
                  )
                }
              />
            ))}
            {device.ospf.interfaces.flatMap((item) =>
              item.neighbors.map((neighbor) => {
                const values = {
                  state: messages.simulation.ospfNeighborStates[neighbor.state],
                  role: messages.simulation.ospfRoles[neighbor.role],
                  priority: neighbor.priority,
                  dead: formatSimTime(neighbor.deadAt),
                  requests: neighbor.requests,
                };
                // Full et 2-Way (entre deux DR Other) sont des états stables ; les autres, des étapes de l'échange de base.
                const stable = neighbor.state === "full" || neighbor.state === "2-way";
                return (
                  <Entry
                    key={`${item.portId}-${neighbor.routerId}`}
                    main={`${item.portId} → ${names.router(neighbor.routerId)} · ${neighbor.address}`}
                    detail={stable ? <State ok label={fill(t.ospfNeighbor, values)} /> : fill(neighbor.state === "loading" ? t.ospfLoading : t.ospfNeighbor, values)}
                  />
                );
              }),
            )}
          </EntryList>
          <EntryList title={t.ospfLsdbTitle} empty={device.ospf.lsdb.length === 0 ? messages.console.ospfLsdbEmpty : null}>
            {device.ospf.lsdb.map((lsa) => (
              <Entry
                key={`${lsa.lsaType}|${lsa.lsId}|${lsa.advertisingRouter}`}
                main={`${messages.simulation.ospfLsaTypes[lsa.lsaType]} ${lsa.lsId} · ${names.router(lsa.advertisingRouter)}`}
                detail={fill(t.ospfLsa, {
                  sequence: ospfSequence(lsa.sequence),
                  age: lsa.age,
                  content: lsa.lsaType === "router" ? fill(t.ospfRouterLinks, { count: lsa.links.length }) : fill(t.ospfAttached, { routers: lsa.attachedRouters.map((id) => names.router(id)).join(", ") }),
                })}
              />
            ))}
          </EntryList>
        </>
      )}

      {device.dnsServer && (
        <EntryList title={t.dnsServerTitle} empty={null}>
          <li className="text-xs text-text-muted">{fill(t.dnsCounters, { answered: device.dnsServer.answered, nameErrors: device.dnsServer.nameErrors })}</li>
          {device.dnsServer.records.length === 0 && <li className="text-xs text-text-muted">{t.dnsNoRecords}</li>}
          {device.dnsServer.records.map((record) => (
            <Entry key={record.name} main={record.name} detail={`→ ${record.address}`} />
          ))}
        </EntryList>
      )}

      {device.stp && (
        <EntryList title={t.stpTitle} empty={device.stp.enabled ? null : t.stpDisabled}>
          {device.stp.enabled && (
            <li className="text-sm text-text">
              {device.stp.rootDeviceId === device.deviceId
                ? fill(t.stpIsRoot, { bridge: device.stp.bridgeId })
                : fill(t.stpRoot, { root: names.device(device.stp.rootDeviceId ?? ""), bridge: device.stp.rootBridgeId ?? "", cost: device.stp.rootCost, port: device.stp.rootPort ?? "—" })}
            </li>
          )}
          {device.stp.enabled &&
            device.stp.ports
              .filter((port) => port.state !== "disabled")
              .map((port) => (
                <Entry
                  key={port.portId}
                  main={port.portId}
                  detail={
                    // Un port bloqué protège de la boucle : symbole neutre, état écrit en toutes lettres.
                    <span className={port.state === "forwarding" ? "text-text" : "text-warning"}>
                      {`${port.state === "forwarding" ? "●" : "⊘"} ${fill(t.stpPort, { role: messages.simulation.stpRoles[port.role], state: messages.simulation.stpStates[port.state], cost: port.cost })}`}
                    </span>
                  }
                />
              ))}
        </EntryList>
      )}

      {device.kind === "switch" ? (
        <EntryList title={t.macTable} empty={device.macTable.length === 0 ? t.macEmpty : null}>
          {device.macTable.map((entry) => (
            <Entry
              key={`${String(entry.vlan)}-${entry.mac}`}
              main={names.mac(entry.mac)}
              detail={fill(t.macDetail, { vlan: entry.vlan, port: entry.portId, expires: formatSimTime(entry.expiresAt) })}
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
                    {route.metric === null ? t.routeKinds[route.kind] : fill(t.routeMetric, { kind: t.routeKinds[route.kind], metric: route.metric })} ·{" "}
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
        <DeviceRuntime device={device} names={names} disabled={disabled} />
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
