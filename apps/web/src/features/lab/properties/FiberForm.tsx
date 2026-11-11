import { FIBER_CABLES, FIBER_TYPES, setFiber, type Fiber } from "@netforge/project";
import { useId, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;
const selectClass = "min-h-9 w-full rounded-sm border border-border-strong bg-canvas px-2 text-sm text-text disabled:opacity-60";

/** Propriétés d'une fibre : longueur en mètres (virgule acceptée), type et usage du câble. */
export function FiberForm({ projectId, linkId, fiber, disabled }: { projectId: string; linkId: string; fiber: Fiber; disabled: boolean }) {
  const id = useId();
  const [length, setLength] = useState(String(fiber.length).replace(".", ","));
  const [type, setType] = useState<Fiber["type"]>(fiber.type);
  const [cable, setCable] = useState<Fiber["cable"]>(fiber.cable);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      noValidate
      aria-label={t.fiberTitle}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const cleaned = length.trim().replace(/\s+/g, "").replace(",", ".");
        if (!/^\d+(\.\d+)?$/.test(cleaned)) {
          setError(t.fiberInvalid);
          return;
        }
        const result = useLabStore.getState().apply(projectId, (doc) => setFiber(doc, { linkId, fiber: { length: Number(cleaned), type, cable } }));
        setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
      }}
    >
      <p className="text-xs font-semibold text-text">{t.fiberTitle}</p>
      <TextField
        label={t.fiberLength}
        hint={t.fiberHint}
        value={length}
        inputMode="decimal"
        autoComplete="off"
        error={error}
        disabled={disabled}
        onChange={(event) => {
          setLength(event.target.value);
        }}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-type`} className="text-xs font-medium text-text">
          {t.fiberType}
        </label>
        <select
          id={`${id}-type`}
          className={selectClass}
          value={type}
          disabled={disabled}
          onChange={(event) => {
            setType(event.target.value as Fiber["type"]);
          }}
        >
          {FIBER_TYPES.map((value) => (
            <option key={value} value={value}>
              {t.fiberTypes[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-cable`} className="text-xs font-medium text-text">
          {t.fiberCable}
        </label>
        <select
          id={`${id}-cable`}
          className={selectClass}
          value={cable}
          disabled={disabled}
          onChange={(event) => {
            setCable(event.target.value as Fiber["cable"]);
          }}
        >
          {FIBER_CABLES.map((value) => (
            <option key={value} value={value}>
              {t.fiberCables[value]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" variant="primary" className="self-start" disabled={disabled}>
        {t.apply}
      </Button>
    </form>
  );
}
