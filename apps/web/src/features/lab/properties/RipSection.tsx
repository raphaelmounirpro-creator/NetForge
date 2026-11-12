import { parseSubinterface, setRipInterface, type DeviceConfig, type RipMode } from "@netforge/project";
import { useId, useState } from "react";
import { SelectField } from "../../../components/ui/SelectField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

/** Ordre d’affichage : port physique, puis ses sous-interfaces par VLAN croissant. */
function byInterface(a: string, b: string): number {
  const x = parseSubinterface(a);
  const y = parseSubinterface(b);
  return (x?.parent ?? a).localeCompare(y?.parent ?? b) || (x?.vlan ?? 0) - (y?.vlan ?? 0);
}

/** Participation des interfaces adressées d'un routeur à RIP : même commande que « rip enable|passive|disable ». */
export function RipSection({ projectId, deviceId, config, disabled }: { projectId: string; deviceId: string; config: DeviceConfig | undefined; disabled: boolean }) {
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const interfaces = Object.entries(config?.interfaces ?? {})
    .filter(([, value]) => value.ipv4 !== null)
    .map(([id]) => id)
    .sort(byInterface);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {t.ripTitle}
      </h3>
      <p className="text-xs text-text-muted">{t.ripHint}</p>
      {interfaces.length === 0 ? (
        <p className="text-sm text-text-muted">{t.ripNoInterface}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {interfaces.map((interfaceId) => (
            <SelectField
              key={interfaceId}
              label={fill(t.ripMode, { port: interfaceId })}
              value={config?.ripInterfaces[interfaceId] ?? "off"}
              disabled={disabled}
              options={(["off", "active", "passive"] as const).map((mode) => ({ value: mode, label: t.ripModes[mode] }))}
              onChange={(event) => {
                const mode = event.target.value === "off" ? null : (event.target.value as RipMode);
                const result = useLabStore.getState().apply(projectId, (doc) => setRipInterface(doc, { deviceId, interfaceId, mode }));
                setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
              }}
            />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
