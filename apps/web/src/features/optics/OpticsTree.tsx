import { opticalTree, type OntActivation, type OpticalReport, type OpticalStatus, type OpticalTreeNode, type PonReport } from "@netforge/engine";
import { compareNames, fill, messages } from "../../i18n";
import { getModel, isOptical, ponTechnologyOf, type Device, type NfgDocument } from "@netforge/project";
import { useMemo } from "react";
import { deviceName, ontStateText, statusText } from "./format";
import { ontStatuses } from "./hooks";

const t = messages.optics;
const kinds = messages.properties.kind;

interface Context {
  readonly doc: NfgDocument;
  readonly devices: ReadonlyMap<string, Device>;
  readonly states: ReadonlyMap<string, OntActivation>;
  readonly optical: ReadonlyMap<string, OpticalStatus>;
  readonly exercise: boolean;
}

/** Résumé d'une branche : nombre d'ONT en fonctionnement (O5) ou hors service. */
function summary(onts: readonly string[], states: Context["states"]): { text: string; ok: boolean } {
  const down = onts.filter((id) => states.get(id)?.state !== "O5").length;
  return down === 0 ? { text: fill(t.tree.summaryOk, { total: onts.length }), ok: true } : { text: fill(t.tree.summaryPartial, { down, total: onts.length }), ok: false };
}

function Branch({ node, context }: { node: OpticalTreeNode; context: Context }) {
  const device = context.devices.get(node.deviceId);
  const isOnt = device ? getModel(device.model).kind === "ont" : false;
  const name = deviceName(context.doc, node.deviceId);
  if (isOnt) {
    const optical = context.optical.get(node.deviceId);
    const state = context.states.get(node.deviceId);
    const ok = state?.state === "O5";
    return (
      <li className={`text-xs ${ok ? "text-success" : "text-danger"}`}>
        {fill(t.tree.ont, { name, optical: optical ? statusText(optical, context.exercise) : "", pon: state ? ontStateText(state.state) : "" })}
      </li>
    );
  }
  const { text, ok } = summary(node.onts, context.states);
  return (
    <li className="flex flex-col gap-1">
      <span className="text-xs text-text">
        {fill(t.tree.node, { name, model: device?.model ?? "" })}
        {node.entryPorts.length > 0 && <span className="text-text-muted"> · {fill(t.tree.entries, { ports: node.entryPorts.join(", ") })}</span>}
        <span className={`block font-semibold ${ok ? "text-success" : "text-danger"}`}>{text}</span>
      </span>
      {node.children.length > 0 && (
        <ul className="flex flex-col gap-1 border-l border-border pl-3">
          {node.children.map((child) => (
            <Branch key={child.deviceId} node={child} context={context} />
          ))}
        </ul>
      )}
    </li>
  );
}

function useContext(doc: NfgDocument, report: OpticalReport, pon: PonReport, exercise: boolean): Context {
  return useMemo(
    () => ({
      doc,
      devices: new Map(doc.topology.devices.map((device) => [device.id, device])),
      states: new Map(pon.onts.map((ont) => [ont.ontId, ont])),
      optical: ontStatuses(report),
      exercise,
    }),
    [doc, report, pon, exercise],
  );
}

/** Arbre du réseau : de chaque port d'OLT aux ONT, état de chaque branche (symbole et texte, la couleur le double). */
export function OpticsTreeView({ doc, report, pon, exercise }: { doc: NfgDocument; report: OpticalReport; pon: PonReport; exercise: boolean }) {
  const roots = useMemo(() => opticalTree(report), [report]);
  const context = useContext(doc, report, pon, exercise);
  return (
    <section aria-label={t.tree.title} className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">{t.tree.hint}</p>
      {roots.length === 0 ? (
        <p className="text-sm text-text-muted">{t.tree.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {roots.map((root) => {
            const olt = context.devices.get(root.olt.deviceId);
            const technology = olt ? ponTechnologyOf(olt.model) : null;
            const { text, ok } = summary(root.onts, context.states);
            return (
              <li key={`${root.olt.deviceId}/${root.olt.portId}`} className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-text">
                  {fill(t.tree.root, { olt: deviceName(doc, root.olt.deviceId), port: root.olt.portId, technology: technology ? t.technology[technology] : "" })}
                  <span className={`block text-xs ${ok ? "text-success" : "text-danger"}`}>{text}</span>
                </span>
                <ul className="flex flex-col gap-1 border-l border-border pl-3">
                  {root.children.map((child) => (
                    <Branch key={child.deviceId} node={child} context={context} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Implantation : équipements optiques par rue puis par immeuble ou site. */
export function OpticsSitesView({ doc, pon }: { doc: NfgDocument; pon: PonReport }) {
  const states = new Map(pon.onts.map((ont) => [ont.ontId, ont]));
  const optical = doc.topology.devices.filter((device) => isOptical(getModel(device.model).kind)).sort((a, b) => compareNames(a.name, b.name));
  const located = optical.filter((device) => device.location !== null);
  const streets = new Map<string, Map<string, Device[]>>();
  for (const device of located) {
    const street = device.location?.street ?? t.sites.noStreet;
    const building = device.location?.building ?? t.sites.noBuilding;
    const buildings = streets.get(street) ?? new Map<string, Device[]>();
    buildings.set(building, [...(buildings.get(building) ?? []), device]);
    streets.set(street, buildings);
  }
  const unknown = optical.filter((device) => device.location === null);
  return (
    <section aria-label={t.sites.title} className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">{t.sites.hint}</p>
      {located.length === 0 ? (
        <p className="text-sm text-text-muted">{t.sites.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...streets.entries()]
            .sort(([a], [b]) => compareNames(a, b))
            .map(([street, buildings]) => (
              <li key={street} className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-text">{street}</span>
                <ul className="flex flex-col gap-2 border-l border-border pl-3">
                  {[...buildings.entries()]
                    .sort(([a], [b]) => compareNames(a, b))
                    .map(([building, devices]) => (
                      <li key={building} className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-text">{building}</span>
                        <ul className="flex flex-col gap-0.5 border-l border-border pl-3 text-xs">
                          {devices.map((device) => {
                            const state = states.get(device.id);
                            return (
                              <li key={device.id} className={state ? (state.state === "O5" ? "text-success" : "text-danger") : "text-text"}>
                                {fill(t.sites.device, { name: device.name, kind: kinds[getModel(device.model).kind] })}
                                {device.location?.unit && <span className="text-text-muted"> · {device.location.unit}</span>}
                                {state && <span> · {ontStateText(state.state)}</span>}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
        </ul>
      )}
      {unknown.length > 0 && located.length > 0 && <p className="text-xs text-text-muted">{fill(t.sites.unknown, { names: unknown.map((device) => device.name).join(", ") })}</p>}
    </section>
  );
}
