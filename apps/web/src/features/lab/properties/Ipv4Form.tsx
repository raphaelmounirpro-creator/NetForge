import { parseIpv4Input, prefixToMask, setInterfaceIpv4, type Ipv4Interface } from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

interface Ipv4FormProps {
  projectId: string;
  deviceId: string;
  portId: string;
  current: Ipv4Interface | null;
  disabled: boolean;
}

/** Adresse et masque d'une interface ; même analyse et même commande que la future CLI. */
export function Ipv4Form({ projectId, deviceId, portId, current, disabled }: Ipv4FormProps) {
  const [address, setAddress] = useState(current?.address ?? "");
  const [mask, setMask] = useState(current ? prefixToMask(current.prefixLength) : "");
  const [errors, setErrors] = useState<{ address?: string | undefined; mask?: string | undefined; form?: string }>({});

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseIpv4Input(address, mask);
    if (!parsed.ok) {
      setErrors({
        address: parsed.errors.filter((issue) => issue.code === "ipv4.invalid-address").map(formatIssue)[0],
        mask: parsed.errors.filter((issue) => issue.code === "ipv4.invalid-mask").map(formatIssue)[0],
      });
      return;
    }
    const result = useLabStore.getState().apply(projectId, (doc) => setInterfaceIpv4(doc, { deviceId, portId, ipv4: parsed.ipv4 }));
    setErrors(result && !result.ok ? { form: result.errors.map(formatIssue).join(" ") } : {});
  };

  const clear = () => {
    useLabStore.getState().apply(projectId, (doc) => setInterfaceIpv4(doc, { deviceId, portId, ipv4: null }));
  };

  return (
    <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label={t.address}
          value={address}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          error={errors.address ?? null}
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
          error={errors.mask ?? null}
          onChange={(event) => {
            setMask(event.target.value);
          }}
        />
      </div>
      {errors.form && (
        <p role="alert" className="text-xs text-danger">
          {errors.form}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={disabled}>
          {t.apply}
        </Button>
        {current && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={clear}>
            {t.clear}
          </Button>
        )}
      </div>
    </form>
  );
}
