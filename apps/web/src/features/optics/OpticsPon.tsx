import type { OntActivation, PonReport } from "@netforge/engine";
import type { NfgDocument } from "@netforge/project";
import { useState } from "react";
import { fill, messages } from "../../i18n";
import { blockText, deviceName, ontStateText } from "./format";

const t = messages.optics;
const p = t.pon;

function ActivationSteps({ doc, ont }: { doc: NfgDocument; ont: OntActivation }) {
  const title = fill(p.stepsTitle, { name: deviceName(doc, ont.ontId) });
  return (
    <section aria-label={title} className="flex flex-col gap-1 rounded-md border border-border p-3">
      <h4 className="text-sm font-semibold text-text">{title}</h4>
      <ol className="flex flex-col gap-1 text-xs">
        {ont.steps.map(({ step, outcome }) => (
          <li key={step} className="flex justify-between gap-3">
            <span className="text-text">{p.steps[ont.technology][step]}</span>
            <span className={`shrink-0 font-mono ${outcome === "failed" ? "text-danger" : outcome === "done" ? "text-text" : "text-text-muted"}`}>{p.outcome[outcome]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Onglet PON de la vue Optique : ports d'OLT (ONT autorisés et découverts),
 * puis chaque ONT avec son état d'activation et les étapes franchies.
 * Données du moteur (analyzePon) ; aucune décision prise ici.
 */
export function OpticsPon({ doc, report, exercise }: { doc: NfgDocument; report: PonReport; exercise: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (report.onts.length === 0) return <p className="p-4 text-sm text-text-muted">{p.noOnt}</p>;
  const current = report.onts.find((ont) => ont.ontId === selected) ?? report.onts.find((ont) => ont.state !== "O5") ?? report.onts[0];
  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{p.title}</h3>
      <p className="text-xs text-text-muted">{p.hint}</p>
      {report.ports.length > 0 && (
        <section aria-label={p.portsTitle} className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">{p.portsTitle}</h4>
          {report.ports.map((port) => {
            const label = fill(p.port, { olt: deviceName(doc, port.oltId), port: port.portId, technology: t.technology[port.technology] });
            return (
              <section key={`${port.oltId}/${port.portId}`} aria-label={label} className="flex flex-col gap-1.5 rounded-md border border-border p-3 text-xs">
                <h5 className="text-sm font-semibold text-text">{label}</h5>
                <p className="font-semibold text-text-muted">{p.authorizedTitle}</p>
                {port.authorizations.length === 0 ? (
                  <p className="text-text-muted">{p.noAuthorization}</p>
                ) : (
                  <ul className="flex flex-col gap-0.5 font-mono text-text">
                    {port.authorizations.map((entry) => (
                      <li key={entry.serial}>
                        {fill(p.authorization, {
                          serial: entry.serial,
                          onuId: entry.onuId,
                          state: entry.state && entry.ontId ? `${deviceName(doc, entry.ontId)}, ${ontStateText(entry.state)}` : p.absent,
                        })}
                      </li>
                    ))}
                  </ul>
                )}
                {port.discovered.length > 0 && (
                  <>
                    <p className="font-semibold text-text-muted">{p.discoveredTitle}</p>
                    <ul className="flex flex-col gap-0.5 text-text">
                      {port.discovered.map((item) => (
                        <li key={item.ontId}>{fill(p.discovered, { serial: item.serial, name: deviceName(doc, item.ontId), reason: p.blocks[item.block] })}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            );
          })}
        </section>
      )}
      <section aria-label={p.ontsTitle} className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">{p.ontsTitle}</h4>
        <ul className="flex flex-col gap-1">
          {report.onts.map((ont) => {
            const isCurrent = ont.ontId === current?.ontId;
            return (
              <li key={ont.ontId}>
                <button
                  type="button"
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => {
                    setSelected(ont.ontId);
                  }}
                  className={`flex w-full flex-col gap-0.5 rounded-sm border px-2.5 py-1.5 text-left text-xs transition-colors duration-(--duration-fast) ${
                    isCurrent ? "border-accent-text bg-surface-raised" : "border-transparent hover:border-border"
                  }`}
                >
                  <span className="text-sm font-medium text-text">
                    {fill(p.ont, { name: deviceName(doc, ont.ontId), technology: t.technology[ont.technology], serial: ont.serial ?? p.noSerial })}
                  </span>
                  <span className={`font-semibold ${ont.state === "O5" ? "text-success" : "text-danger"}`}>{ontStateText(ont.state)}</span>
                  {ont.state === "O5" && ont.olt && ont.onuId !== null ? (
                    <span className="text-text-muted">{fill(p.onuId, { onuId: ont.onuId, olt: deviceName(doc, ont.olt.deviceId), port: ont.olt.portId })}</span>
                  ) : (
                    <span className="text-text-muted">{blockText(ont, exercise)}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {current && <ActivationSteps doc={doc} ont={current} />}
      <p className="text-xs text-text-muted">{p.sources}</p>
    </div>
  );
}
