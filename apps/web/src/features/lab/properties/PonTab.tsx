import { getModel, ONU_ID_MAX, ponTechnologyOf, setPonAuthorization, type Device, type NfgDocument } from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

/** ONT autorisés sur les ports d'un OLT : mêmes commandes que « ont add|delete » à la console. */
export function PonTab({ projectId, doc, device, disabled }: { projectId: string; doc: NfgDocument; device: Device; disabled: boolean }) {
  const ports = getModel(device.model).ports.map((port) => port.id);
  const technology = ponTechnologyOf(device.model) ?? "gpon";
  const authorizations = doc.configurations[device.id]?.ponAuthorizations ?? {};
  const entries = ports.flatMap((portId) => (authorizations[portId] ?? []).map((entry) => ({ portId, ...entry })));
  const [portId, setPortId] = useState(ports[0] ?? "");
  const [serial, setSerial] = useState("");
  const [onuId, setOnuId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const text = onuId.trim();
    if (text !== "" && !/^\d{1,4}$/.test(text)) {
      setError(t.ponInvalidOnuId);
      return;
    }
    const result = useLabStore
      .getState()
      .apply(projectId, (current) => setPonAuthorization(current, { deviceId: device.id, portId, serial, present: true, ...(text === "" ? {} : { onuId: Number(text) }) }));
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
    if (result?.ok) {
      setSerial("");
      setOnuId("");
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{t.ponTitle}</h3>
      <p className="text-xs text-text-muted">{fill(t.ponHint, { max: ONU_ID_MAX[technology] })}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">{t.ponNone}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={`${entry.portId}-${entry.serial}`} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-xs">
              <span className="font-mono text-text">{fill(t.ponEntry, { port: entry.portId, serial: entry.serial, onuId: entry.onuId })}</span>
              <Button
                size="sm"
                disabled={disabled}
                aria-label={fill(t.ponRemove, { serial: entry.serial, port: entry.portId })}
                onClick={() => {
                  useLabStore.getState().apply(projectId, (current) => setPonAuthorization(current, { deviceId: device.id, portId: entry.portId, serial: entry.serial, present: false }));
                }}
              >
                {t.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
        <SelectField
          label={t.ponPort}
          value={portId}
          disabled={disabled}
          className="w-24"
          options={ports.map((value) => ({ value, label: value }))}
          onChange={(event) => {
            setPortId(event.target.value);
          }}
        />
        <TextField
          label={t.ponSerial}
          value={serial}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="w-40"
          onChange={(event) => {
            setSerial(event.target.value);
          }}
        />
        <TextField
          label={t.ponOnuId}
          value={onuId}
          inputMode="numeric"
          disabled={disabled}
          className="w-48"
          onChange={(event) => {
            setOnuId(event.target.value);
          }}
        />
        <Button type="submit" size="sm" variant="primary" disabled={disabled}>
          {t.ponAdd}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
