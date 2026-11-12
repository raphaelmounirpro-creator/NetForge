import { setStp, STP_PRIORITY_MAX, STP_PRIORITY_STEP } from "@netforge/project";
import { useId, useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

const PRIORITIES = Array.from({ length: STP_PRIORITY_MAX / STP_PRIORITY_STEP + 1 }, (_, index) => index * STP_PRIORITY_STEP);

/** Spanning Tree d'un switch : même commande que « spanning-tree enable|disable|priority » de la console. */
export function StpForm({ projectId, deviceId, current, disabled }: { projectId: string; deviceId: string; current: { enabled: boolean; priority: number }; disabled: boolean }) {
  const [enabled, setEnabled] = useState(current.enabled);
  const [priority, setPriority] = useState(current.priority);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = useId();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const result = useLabStore.getState().apply(projectId, (doc) => setStp(doc, { deviceId, enabled, priority }));
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2 rounded-md border border-border p-3">
      <h3 className="text-sm font-semibold text-text">{t.stpTitle}</h3>
      <p className="text-xs text-text-muted">{t.stpHint}</p>
      <div className="flex items-center gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
          }}
        />
        <label htmlFor={checkboxId} className="text-sm text-text">
          {t.stpEnabled}
        </label>
      </div>
      <SelectField
        label={t.stpPriority}
        value={String(priority)}
        disabled={disabled}
        className="w-40"
        options={PRIORITIES.map((value) => ({ value: String(value), label: String(value) }))}
        onChange={(event) => {
          setPriority(Number(event.target.value));
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" variant="primary" disabled={disabled} className="self-start">
        {t.apply}
      </Button>
    </form>
  );
}
