import type { CommandResult, DeviceLocation } from "@netforge/project";
import { useId, useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { formatIssue, messages } from "../../../i18n";

const t = messages.properties;

/** Implantation d'un équipement optique (rue, immeuble, logement) ; champs vides : non renseignés. */
export function LocationForm({
  location,
  disabled,
  onApply,
}: {
  location: DeviceLocation | null;
  disabled: boolean;
  onApply: (location: { street: string; building: string; unit: string }) => CommandResult | null;
}) {
  const headingId = useId();
  const [street, setStreet] = useState(location?.street ?? "");
  const [building, setBuilding] = useState(location?.building ?? "");
  const [unit, setUnit] = useState(location?.unit ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const result = onApply({ street, building, unit });
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
  };

  return (
    <form onSubmit={submit} noValidate aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {t.locationTitle}
      </h3>
      <p className="text-xs text-text-muted">{t.locationHint}</p>
      <TextField label={t.locationStreet} value={street} disabled={disabled} autoComplete="off" onChange={(event) => { setStreet(event.target.value); }} />
      <TextField label={t.locationBuilding} value={building} disabled={disabled} autoComplete="off" onChange={(event) => { setBuilding(event.target.value); }} />
      <TextField label={t.locationUnit} value={unit} disabled={disabled} autoComplete="off" onChange={(event) => { setUnit(event.target.value); }} />
      <Button type="submit" size="sm" variant="primary" className="self-start" disabled={disabled}>
        {t.locationApply}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
