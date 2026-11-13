import type { DirectionShare, PortBandwidth } from "@netforge/engine";
import type { NfgDocument } from "@netforge/project";
import { fill, messages } from "../../i18n";
import { deviceName, formatMbps } from "./format";

const t = messages.optics;
const b = t.bandwidth;
const serviceName = messages.properties.serviceNames;
const contentionFormat = new Intl.NumberFormat("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Share({ doc, share }: { doc: NfgDocument; share: DirectionShare }) {
  const title = fill(b.direction[share.direction], { capacity: fill(b.rate, { value: formatMbps(share.capacityKbps) }) });
  const rate = (kbps: number) => fill(b.rate, { value: formatMbps(kbps) });
  return (
    <section aria-label={title} className="flex flex-col gap-1.5 rounded-md border border-border p-3 text-xs">
      <h5 className="text-sm font-semibold text-text">{title}</h5>
      {share.flows.length === 0 ? (
        <p className="text-text-muted">{b.empty}</p>
      ) : (
        <>
          <p className="text-text-muted">
            {fill(b.summary, { guaranteed: rate(share.guaranteedKbps), demand: rate(share.demandKbps), contention: contentionFormat.format(share.contention) })}
          </p>
          {share.guaranteesExceeded && <p className="font-semibold text-warning">{b.exceeded}</p>}
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th scope="col" className="py-1 pr-2 font-medium">
                  {b.columns.flow}
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  {b.columns.vlan}
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  {b.columns.guaranteed}
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  {b.columns.max}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {b.columns.peak}
                </th>
              </tr>
            </thead>
            <tbody>
              {share.flows.map((flow) => (
                <tr key={`${flow.service}-${flow.ontId ?? "multicast"}`} className="border-b border-border align-top">
                  <th scope="row" className="py-1 pr-2 text-left font-normal text-text">
                    {flow.ontId === null
                      ? fill(b.multicast, { service: serviceName[flow.service], subscribers: flow.subscribers.map((id) => deviceName(doc, id)).join(", ") })
                      : fill(b.flow, { ont: deviceName(doc, flow.ontId), service: serviceName[flow.service] })}
                  </th>
                  <td className="py-1 pr-2 text-right font-mono text-text">{flow.vlan}</td>
                  <td className="py-1 pr-2 text-right font-mono text-text">{formatMbps(flow.guaranteedKbps)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-text">{formatMbps(flow.maxKbps)}</td>
                  <td className="py-1 text-right font-mono text-text">{formatMbps(flow.peakKbps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/**
 * Onglet Débits de la vue Optique : partage de chaque port PON à l'heure de
 * pointe, calculé par le moteur (analyzePonBandwidth). Débits en Mbit/s.
 */
export function OpticsBandwidth({ doc, ports }: { doc: NfgDocument; ports: readonly PortBandwidth[] }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{b.title}</h3>
      <p className="text-xs text-text-muted">{b.hint}</p>
      {ports.length === 0 ? (
        <p className="text-sm text-text-muted">{b.none}</p>
      ) : (
        ports.map((port) => {
          const label = fill(b.port, { olt: deviceName(doc, port.oltId), port: port.portId, technology: t.technology[port.technology] });
          return (
            <section key={`${port.oltId}/${port.portId}`} aria-label={label} className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text">{label}</h4>
              <Share doc={doc} share={port.downstream} />
              <Share doc={doc} share={port.upstream} />
              {port.idle.length > 0 && (
                <div className="text-xs">
                  <p className="font-semibold text-text-muted">{b.idleTitle}</p>
                  <ul className="text-text">
                    {port.idle.map((item) => (
                      <li key={item.serial}>
                        {fill(b.idle, { serial: item.serial, name: item.ontId ? deviceName(doc, item.ontId) : b.idleAbsent, services: item.services.map((service) => serviceName[service]).join(", ") })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })
      )}
      <p className="text-xs text-text-muted">{b.sources}</p>
    </div>
  );
}
