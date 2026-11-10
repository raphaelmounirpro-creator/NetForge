import type { CommandResult } from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { formatIssue, messages } from "../../../i18n";

interface SingleFieldFormProps {
  label: string;
  hint?: string;
  initial: string;
  placeholder?: string;
  disabled: boolean;
  /** Applique la valeur via une commande métier ; null si le projet n'est pas modifiable. */
  onApply: (value: string) => CommandResult | null;
}

/** Formulaire d'un seul champ (nom, passerelle) appliqué explicitement. */
export function SingleFieldForm({ label, hint, initial, placeholder, disabled, onApply }: SingleFieldFormProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const result = onApply(value);
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
  };

  return (
    <form onSubmit={submit} noValidate className="flex items-end gap-2">
      <TextField
        className="flex-1"
        label={label}
        hint={hint}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        error={error}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <Button type="submit" size="sm" variant="primary" disabled={disabled} className={hint || error ? "mb-5" : ""}>
        {messages.properties.apply}
      </Button>
    </form>
  );
}
