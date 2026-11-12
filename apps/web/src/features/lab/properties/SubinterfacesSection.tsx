import { getModel, isVlanId, parseIpv4Input, parseSubinterface, setInterfaceIpv4, subinterfaceId, type Device, type NfgDocument } from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";
import { Ipv4Form } from "./Ipv4Form";

const t = messages.properties;

/** Sous-interfaces « port.vlan » d'un routeur : même commande que « interface ge0.10 » + « address » à la console. */
export function SubinterfacesSection({ projectId, doc, device, disabled }: { projectId: string; doc: NfgDocument; device: Device; disabled: boolean }) {
  const ports = getModel(device.model).ports.map((port) => port.id);
  const interfaces = doc.configurations[device.id]?.interfaces ?? {};
  const existing = Object.entries(interfaces)
    .flatMap(([id, value]) => {
      const sub = parseSubinterface(id);
      return sub && value.ipv4 ? [{ id, parent: sub.parent, vlan: sub.vlan, ipv4: value.ipv4 }] : [];
    })
    .sort((a, b) => a.parent.localeCompare(b.parent) || a.vlan - b.vlan);
  const [parent, setParent] = useState(ports[0] ?? "ge0");
  const [vlan, setVlan] = useState("");
  const [address, setAddress] = useState("");
  const [mask, setMask] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (event: SubmitEvent) => {
    event.preventDefault();
    const id = Number(vlan);
    if (!/^[1-9]\d{0,3}$/.test(vlan.trim()) || !isVlanId(id)) {
      setError(t.vlanInvalid);
      return;
    }
    const parsed = parseIpv4Input(address, mask);
    if (!parsed.ok) {
      setError(parsed.errors.map(formatIssue).join(" "));
      return;
    }
    const result = useLabStore.getState().apply(projectId, (current) => setInterfaceIpv4(current, { deviceId: device.id, portId: subinterfaceId(parent, id), ipv4: parsed.ipv4 }));
    if (result && !result.ok) {
      setError(result.errors.map(formatIssue).join(" "));
      return;
    }
    setError(null);
    setVlan("");
    setAddress("");
    setMask("");
  };

  return (
    <section aria-labelledby={`subinterfaces-${device.id}`} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <h3 id={`subinterfaces-${device.id}`} className="text-sm font-semibold text-text">
        {t.subinterfaces}
      </h3>
      <p className="text-xs text-text-muted">{t.subinterfacesHint}</p>
      {existing.length === 0 ? (
        <p className="text-xs text-text-muted">{t.noSubinterfaces}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {existing.map((sub) => (
            <li key={sub.id} className="rounded-sm border border-border p-2">
              <span className="font-mono text-sm font-semibold text-text">{fill(t.subinterface, { port: sub.id })}</span>
              <Ipv4Form key={`${sub.id}:${sub.ipv4.address}/${String(sub.ipv4.prefixLength)}`} projectId={projectId} deviceId={device.id} portId={sub.id} current={sub.ipv4} disabled={disabled} />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate className="flex flex-col gap-2 border-t border-border pt-2">
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label={t.parentPort}
            value={parent}
            disabled={disabled}
            options={ports.map((port) => ({ value: port, label: port }))}
            onChange={(event) => {
              setParent(event.target.value);
            }}
          />
          <TextField
            label={t.subinterfaceVlan}
            value={vlan}
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => {
              setVlan(event.target.value);
            }}
          />
          <TextField
            label={t.address}
            value={address}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => {
              setAddress(event.target.value);
            }}
          />
          <TextField
            label={t.mask}
            value={mask}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => {
              setMask(event.target.value);
            }}
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" variant="secondary" disabled={disabled} className="self-start">
          {t.addSubinterface}
        </Button>
      </form>
    </section>
  );
}
