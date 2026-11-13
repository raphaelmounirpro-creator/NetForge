import { OSPF_BACKBONE_AREA, OSPF_DEFAULT_COST, OSPF_DEFAULT_PRIORITY, parseOspfArea, parseSubinterface, setOspfInterface, type DeviceConfig, type OspfInterface, type OspfMode } from "@netforge/project";
import { useId, useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

/** Ordre d’affichage : port physique, puis ses sous-interfaces par VLAN croissant. */
function byInterface(a: string, b: string): number {
  const x = parseSubinterface(a);
  const y = parseSubinterface(b);
  return (x?.parent ?? a).localeCompare(y?.parent ?? b) || (x?.vlan ?? 0) - (y?.vlan ?? 0);
}

const integer = (text: string) => (/^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

interface RowProps {
  projectId: string;
  deviceId: string;
  interfaceId: string;
  current: OspfInterface | undefined;
  disabled: boolean;
}

/** Une interface : mode appliqué aussitôt (comme « ospf enable|passive|disable »), coût et priorité appliqués ensemble. */
function OspfRow({ projectId, deviceId, interfaceId, current, disabled }: RowProps) {
  const [cost, setCost] = useState(String(current?.cost ?? OSPF_DEFAULT_COST));
  const [priority, setPriority] = useState(String(current?.priority ?? OSPF_DEFAULT_PRIORITY));
  const [area, setArea] = useState(current?.area ?? OSPF_BACKBONE_AREA);
  const [error, setError] = useState<string | null>(null);
  const apply = (ospf: OspfInterface | null) => {
    const result = useLabStore.getState().apply(projectId, (doc) => setOspfInterface(doc, { deviceId, interfaceId, ospf }));
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!current) return;
    const values = { cost: integer(cost), priority: integer(priority) };
    if (Number.isNaN(values.cost) || Number.isNaN(values.priority)) {
      setError(t.ospfInvalidNumber);
      return;
    }
    // Zone saisie en décimal ou en notation pointée ; une saisie invalide est expliquée par la commande.
    apply({ ...current, ...values, area: parseOspfArea(area) ?? area });
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <SelectField
        label={fill(t.ospfMode, { port: interfaceId })}
        value={current?.mode ?? "off"}
        disabled={disabled}
        options={(["off", "active", "passive"] as const).map((mode) => ({ value: mode, label: t.ospfModes[mode] }))}
        onChange={(event) => {
          const mode = event.target.value === "off" ? null : (event.target.value as OspfMode);
          apply(mode === null ? null : { mode, cost: current?.cost ?? OSPF_DEFAULT_COST, priority: current?.priority ?? OSPF_DEFAULT_PRIORITY, area: current?.area ?? OSPF_BACKBONE_AREA });
        }}
      />
      {current && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label={fill(t.ospfCost, { port: interfaceId })}
            value={cost}
            inputMode="numeric"
            disabled={disabled}
            className="w-28"
            onChange={(event) => {
              setCost(event.target.value);
            }}
          />
          <TextField
            label={fill(t.ospfPriority, { port: interfaceId })}
            value={priority}
            inputMode="numeric"
            disabled={disabled}
            className="w-28"
            onChange={(event) => {
              setPriority(event.target.value);
            }}
          />
          <TextField
            label={fill(t.ospfArea, { port: interfaceId })}
            value={area}
            disabled={disabled}
            className="w-32"
            onChange={(event) => {
              setArea(event.target.value);
            }}
          />
          <Button type="submit" size="sm" disabled={disabled} aria-label={fill(t.ospfApply, { port: interfaceId })}>
            {t.ospfApplyShort}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

/** Participation des interfaces adressées d'un routeur à OSPF (zone 0) : mêmes commandes que « ospf … » à la console. */
export function OspfSection({ projectId, deviceId, config, disabled }: { projectId: string; deviceId: string; config: DeviceConfig | undefined; disabled: boolean }) {
  const headingId = useId();
  const interfaces = Object.entries(config?.interfaces ?? {})
    .filter(([, value]) => value.ipv4 !== null)
    .map(([id]) => id)
    .sort(byInterface);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {t.ospfTitle}
      </h3>
      <p className="text-xs text-text-muted">{t.ospfHint}</p>
      {interfaces.length === 0 ? (
        <p className="text-sm text-text-muted">{t.ospfNoInterface}</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">{t.ospfTuning}</p>
          {interfaces.map((interfaceId) => {
            const current = config?.ospfInterfaces[interfaceId];
            // Remonté quand la configuration change (console, annulation) : les champs repartent des valeurs du projet.
            const key = `${interfaceId}|${current ? `${current.mode}|${String(current.cost)}|${String(current.priority)}|${current.area}` : "off"}`;
            return <OspfRow key={key} projectId={projectId} deviceId={deviceId} interfaceId={interfaceId} current={current} disabled={disabled} />;
          })}
        </>
      )}
    </section>
  );
}
