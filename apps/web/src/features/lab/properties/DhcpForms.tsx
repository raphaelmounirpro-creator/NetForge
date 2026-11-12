import { DHCP_LEASE_DEFAULT, formatLeaseDuration, parseDhcpPoolInput, setDhcpPool, setInterfaceDhcp, type DeviceConfig } from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

/** Le choix DHCP passe par la même commande que « ipconfig dhcp ». */
export function DhcpMode({ projectId, deviceId, portId, automatic, disabled }: { projectId: string; deviceId: string; portId: string; automatic: boolean; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return <div className="mt-3 flex flex-col gap-2">
    <SelectField label={t.dhcpMode} value={automatic ? "dhcp" : "manual"} disabled={disabled}
      options={[{ value: "manual", label: t.dhcpManual }, { value: "dhcp", label: t.dhcpAutomatic }]}
      onChange={(event) => {
        const enabled = event.target.value === "dhcp";
        const result = useLabStore.getState().apply(projectId, (doc) => setInterfaceDhcp(doc, { deviceId, portId, enabled }));
        setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
      }} />
    {automatic && <p className="text-xs text-text-muted">{t.dhcpHint}</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}

function PoolForm({ projectId, deviceId, interfaceId, config, disabled }: { projectId: string; deviceId: string; interfaceId: string; config: DeviceConfig; disabled: boolean }) {
  const pool = config.dhcpPools[interfaceId];
  const [start, setStart] = useState(pool?.start ?? "");
  const [end, setEnd] = useState(pool?.end ?? "");
  const [gateway, setGateway] = useState(pool?.gateway ?? config.interfaces[interfaceId]?.ipv4?.address ?? "");
  const [lease, setLease] = useState(formatLeaseDuration(pool?.leaseSeconds ?? DHCP_LEASE_DEFAULT));
  const [error, setError] = useState<string | null>(null);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseDhcpPoolInput({ start, end, gateway, lease });
    if (!parsed.ok) { setError(parsed.errors.map(formatIssue).join(" ")); return; }
    const result = useLabStore.getState().apply(projectId, (doc) => setDhcpPool(doc, { deviceId, interfaceId, pool: parsed.pool }));
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
  };
  return <form onSubmit={submit} noValidate className="flex flex-col gap-2">
    <TextField label={t.dhcpStart} value={start} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(e) => { setStart(e.target.value); }} />
    <TextField label={t.dhcpEnd} value={end} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(e) => { setEnd(e.target.value); }} />
    <TextField label={t.dhcpGateway} value={gateway} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(e) => { setGateway(e.target.value); }} />
    <TextField label={t.dhcpLease} hint={t.dhcpLeaseHint} value={lease} disabled={disabled} autoComplete="off" onChange={(e) => { setLease(e.target.value); }} />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <Button type="submit" size="sm" variant="primary" disabled={disabled} className="self-start">{t.dhcpSave}</Button>
    {pool && <Button size="sm" variant="ghost" disabled={disabled} className="self-start" onClick={() => {
      const result = useLabStore.getState().apply(projectId, (doc) => setDhcpPool(doc, { deviceId, interfaceId, pool: null }));
      setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
    }}>{t.dhcpRemove}</Button>}
  </form>;
}

/** Une plage par interface adressée, y compris les sous-interfaces de VLAN. */
export function DhcpPools({ projectId, deviceId, config, disabled }: { projectId: string; deviceId: string; config: DeviceConfig; disabled: boolean }) {
  const ports = Object.entries(config.interfaces).filter(([, value]) => value.ipv4 !== null).map(([id]) => id);
  const [chosen, setChosen] = useState("");
  const port = ports.includes(chosen) ? chosen : ports[0];
  if (!port) return null;
  return <section aria-labelledby={`dhcp-${deviceId}`} className="flex flex-col gap-3 border-t border-border pt-4">
    <h3 id={`dhcp-${deviceId}`} className="text-sm font-semibold text-text">{t.dhcpPoolTitle}</h3>
    <p className="text-xs text-text-muted">{t.dhcpPoolHint}</p>
    <SelectField label={t.interfaces} value={port} disabled={disabled} options={ports.map((id) => ({ value: id, label: id }))} onChange={(e) => { setChosen(e.target.value); }} />
    <PoolForm key={`${port}:${JSON.stringify(config.dhcpPools[port])}:${config.interfaces[port]?.ipv4?.address ?? ""}`} projectId={projectId} deviceId={deviceId} interfaceId={port} config={config} disabled={disabled} />
  </section>;
}
