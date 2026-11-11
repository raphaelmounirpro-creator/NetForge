import { connectPorts, findPort, freePorts, type NfgDocument } from "@netforge/project";
import { useId, useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { formatIssue, messages } from "../../../i18n";
import { newEntityId } from "../actions";
import { useLabStore } from "../store";

const t = messages.properties;

interface ConnectFormProps {
  projectId: string;
  doc: NfgDocument;
  deviceId: string;
  disabled: boolean;
}

const selectClass = "min-h-9 w-full rounded-sm border border-border-strong bg-canvas px-2 font-mono text-sm text-text disabled:opacity-60";

/** Relie un port libre de l'équipement à un port libre d'un autre équipement (alternative clavier au canevas). */
export function ConnectForm({ projectId, doc, deviceId, disabled }: ConnectFormProps) {
  const id = useId();
  const localPorts = freePorts(doc, deviceId);
  const [localPort, setLocalPort] = useState(localPorts[0] ?? "");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const local = doc.topology.devices.find((device) => device.id === deviceId);
  const chosen = localPorts.includes(localPort) ? localPort : localPorts[0];
  // Seuls les ports de même support que le port local sont proposés (cuivre ↔ cuivre, fibre ↔ fibre).
  const medium = local && chosen ? findPort(local.model, chosen)?.medium : undefined;
  const remote = doc.topology.devices
    .filter((device) => device.id !== deviceId)
    .map((device) => ({ device, ports: freePorts(doc, device.id).filter((port) => findPort(device.model, port)?.medium === medium) }))
    .filter((entry) => entry.ports.length > 0);

  if (localPorts.length === 0) return null;
  if (remote.length === 0) return <p className="text-xs text-text-muted">{doc.topology.devices.length > 1 ? t.noCompatiblePorts : t.noFreePorts}</p>;

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const [targetDevice, targetPort] = target.split("|");
    const port = localPorts.includes(localPort) ? localPort : localPorts[0];
    if (!targetDevice || !targetPort || !port) return;
    const result = useLabStore.getState().apply(projectId, (current) =>
      connectPorts(current, { linkId: newEntityId(), a: { deviceId, portId: port }, b: { deviceId: targetDevice, portId: targetPort } }),
    );
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
    if (result?.ok) setTarget("");
  };

  return (
    <form onSubmit={submit} aria-label={t.connectTitle} className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
      <p className="text-xs font-semibold text-text">{t.connectTitle}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-local`} className="text-xs font-medium text-text">
            {t.localPort}
          </label>
          <select
            id={`${id}-local`}
            className={selectClass}
            value={localPorts.includes(localPort) ? localPort : localPorts[0]}
            disabled={disabled}
            onChange={(event) => {
              setLocalPort(event.target.value);
            }}
          >
            {localPorts.map((port) => (
              <option key={port} value={port}>
                {port}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-remote`} className="text-xs font-medium text-text">
            {t.connectChoose}
          </label>
          <select
            id={`${id}-remote`}
            className={selectClass}
            value={target}
            disabled={disabled}
            onChange={(event) => {
              setTarget(event.target.value);
            }}
          >
            <option value="">—</option>
            {remote.map(({ device, ports }) => (
              <optgroup key={device.id} label={device.name}>
                {ports.map((port) => (
                  <option key={port} value={`${device.id}|${port}`}>
                    {device.name} · {port}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={disabled || target === ""} className="self-start">
        {t.connect}
      </Button>
    </form>
  );
}
