import { parseSubinterface, setVrrpGroup, VRRP_DEFAULT_PRIORITY, type DeviceConfig } from "@netforge/project";
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

const integer = (text: string) => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

interface FormProps {
  projectId: string;
  deviceId: string;
  config: DeviceConfig | undefined;
  interfaces: readonly string[];
  disabled: boolean;
}

/** Saisie d'un groupe sur l'interface choisie : même commande que « vrrp <vrid> <adresse> [priority] [preempt] ». */
function VrrpForm({ projectId, deviceId, config, interfaces, disabled }: FormProps) {
  const [interfaceId, setInterfaceId] = useState(interfaces[0] ?? "");
  const existing = config?.vrrpGroups[interfaceId];
  const [vrid, setVrid] = useState(String(existing?.vrid ?? 1));
  const [address, setAddress] = useState(existing?.address ?? "");
  const [priority, setPriority] = useState(String(existing?.priority ?? VRRP_DEFAULT_PRIORITY));
  const [preempt, setPreempt] = useState(existing?.preempt ?? true);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = useId();

  const choose = (id: string) => {
    const group = config?.vrrpGroups[id];
    setInterfaceId(id);
    setVrid(String(group?.vrid ?? 1));
    setAddress(group?.address ?? "");
    setPriority(String(group?.priority ?? VRRP_DEFAULT_PRIORITY));
    setPreempt(group?.preempt ?? true);
    setError(null);
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const group = { vrid: integer(vrid), address: address.trim(), priority: integer(priority), preempt };
    if (Number.isNaN(group.vrid) || Number.isNaN(group.priority)) {
      setError(t.ospfInvalidNumber);
      return;
    }
    const result = useLabStore.getState().apply(projectId, (doc) => setVrrpGroup(doc, { deviceId, interfaceId, group }));
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <SelectField
        label={t.vrrpInterface}
        value={interfaceId}
        disabled={disabled}
        options={interfaces.map((id) => ({ value: id, label: id }))}
        onChange={(event) => {
          choose(event.target.value);
        }}
      />
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={t.vrrpVrid} value={vrid} inputMode="numeric" disabled={disabled} className="w-28" onChange={(event) => { setVrid(event.target.value); }} />
        <TextField label={t.vrrpPriority} value={priority} inputMode="numeric" disabled={disabled} className="w-36" onChange={(event) => { setPriority(event.target.value); }} />
      </div>
      <TextField label={t.vrrpAddress} value={address} disabled={disabled} onChange={(event) => { setAddress(event.target.value); }} />
      <div className="flex items-center gap-2">
        <input id={checkboxId} type="checkbox" checked={preempt} disabled={disabled} onChange={(event) => { setPreempt(event.target.checked); }} />
        <label htmlFor={checkboxId} className="text-sm text-text">
          {t.vrrpPreempt}
        </label>
      </div>
      <p className="text-xs text-text-muted">{t.vrrpOwnerHint}</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" variant="primary" disabled={disabled || interfaceId === ""} className="self-start">
        {t.vrrpSave}
      </Button>
    </form>
  );
}

/** Groupes VRRP des interfaces adressées d'un routeur (un par interface). */
export function VrrpSection({ projectId, deviceId, config, disabled }: { projectId: string; deviceId: string; config: DeviceConfig | undefined; disabled: boolean }) {
  const headingId = useId();
  const interfaces = Object.entries(config?.interfaces ?? {})
    .filter(([, value]) => value.ipv4 !== null)
    .map(([id]) => id)
    .sort(byInterface);
  const groups = Object.entries(config?.vrrpGroups ?? {}).sort(([a], [b]) => byInterface(a, b));
  // Remonté quand les groupes changent (console, annulation) : la saisie repart des valeurs du projet.
  const formKey = JSON.stringify(config?.vrrpGroups ?? {});
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {t.vrrpTitle}
      </h3>
      <p className="text-xs text-text-muted">{t.vrrpHint}</p>
      {groups.length === 0 ? (
        <p className="text-sm text-text-muted">{t.vrrpNone}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {groups.map(([interfaceId, group]) => (
            <li key={interfaceId} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-xs">
              <span className="font-mono text-text">
                {fill(t.vrrpGroup, { port: interfaceId, vrid: group.vrid, address: group.address, priority: group.priority, preempt: group.preempt ? "" : t.vrrpPreemptOff })}
              </span>
              <Button
                size="sm"
                disabled={disabled}
                aria-label={fill(t.vrrpRemove, { port: interfaceId })}
                onClick={() => {
                  useLabStore.getState().apply(projectId, (doc) => setVrrpGroup(doc, { deviceId, interfaceId, group: null }));
                }}
              >
                {t.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {interfaces.length === 0 ? (
        <p className="text-sm text-text-muted">{t.vrrpNoInterface}</p>
      ) : (
        <VrrpForm key={formKey} projectId={projectId} deviceId={deviceId} config={config} interfaces={interfaces} disabled={disabled} />
      )}
    </section>
  );
}
