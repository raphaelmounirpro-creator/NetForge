import { formatVlanList, isVlanId, parseVlanList, setSwitchport, type Switchport } from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

interface SwitchportFormProps {
  projectId: string;
  deviceId: string;
  portId: string;
  current: Switchport;
  disabled: boolean;
}

const vlanOf = (text: string): number | null => (/^[1-9]\d{0,3}$/.test(text.trim()) && isVlanId(Number(text)) ? Number(text) : null);

/** Port de switch : accès dans un VLAN ou trunk 802.1Q ; même commande que « access vlan » / « trunk » de la console. */
export function SwitchportForm({ projectId, deviceId, portId, current, disabled }: SwitchportFormProps) {
  const [mode, setMode] = useState<Switchport["mode"]>(current.mode);
  const [vlan, setVlan] = useState(current.mode === "access" ? String(current.vlan) : "1");
  const [native, setNative] = useState(current.mode === "trunk" ? String(current.nativeVlan) : "1");
  const [allowed, setAllowed] = useState(current.mode === "trunk" ? formatVlanList(current.allowedVlans) : "all");
  const [errors, setErrors] = useState<{ vlan?: string; native?: string; allowed?: string; form?: string }>({});

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    let switchport: Switchport;
    if (mode === "access") {
      const id = vlanOf(vlan);
      if (id === null) {
        setErrors({ vlan: t.vlanInvalid });
        return;
      }
      switchport = { mode: "access", vlan: id };
    } else {
      const nativeId = vlanOf(native);
      const list = parseVlanList(allowed);
      if (nativeId === null || list === null) {
        setErrors({ ...(nativeId === null ? { native: t.vlanInvalid } : {}), ...(list === null ? { allowed: t.vlanListInvalid } : {}) });
        return;
      }
      switchport = { mode: "trunk", nativeVlan: nativeId, allowedVlans: list };
    }
    const result = useLabStore.getState().apply(projectId, (doc) => setSwitchport(doc, { deviceId, portId, switchport }));
    setErrors(result && !result.ok ? { form: result.errors.map(formatIssue).join(" ") } : {});
  };

  return (
    <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-2">
      <SelectField
        label={fill(t.switchportMode, { port: portId })}
        value={mode}
        disabled={disabled}
        options={(["access", "trunk"] as const).map((value) => ({ value, label: t.switchportModes[value] }))}
        onChange={(event) => {
          setMode(event.target.value === "trunk" ? "trunk" : "access");
          setErrors({});
        }}
      />
      {mode === "access" ? (
        <TextField
          label={t.accessVlan}
          value={vlan}
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          error={errors.vlan ?? null}
          className="w-32"
          onChange={(event) => {
            setVlan(event.target.value);
          }}
        />
      ) : (
        <div className="grid grid-cols-[8rem_1fr] gap-2">
          <TextField
            label={t.nativeVlan}
            value={native}
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            error={errors.native ?? null}
            onChange={(event) => {
              setNative(event.target.value);
            }}
          />
          <TextField
            label={t.allowedVlans}
            hint={t.allowedHint}
            value={allowed}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            error={errors.allowed ?? null}
            onChange={(event) => {
              setAllowed(event.target.value);
            }}
          />
        </div>
      )}
      {errors.form && (
        <p role="alert" className="text-xs text-danger">
          {errors.form}
        </p>
      )}
      <Button type="submit" size="sm" variant="primary" disabled={disabled} className="self-start">
        {t.apply}
      </Button>
    </form>
  );
}
