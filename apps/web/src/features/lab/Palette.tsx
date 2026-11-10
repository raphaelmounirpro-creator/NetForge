import { getModel, type DeviceModelId } from "@netforge/project";
import { Monitor, Network, Router, type LucideIcon } from "lucide-react";
import { messages } from "../../i18n";
import { addDeviceAtViewCenter } from "./actions";
import { useLabStore, type OpenProject } from "./store";

const t = messages.palette;

const ENTRIES: ReadonlyArray<{ model: DeviceModelId; label: string; hint: string; icon: LucideIcon }> = [
  { model: "PC", label: t.pc, hint: t.pcHint, icon: Monitor },
  { model: "S-24", label: t.switch, hint: t.switchHint, icon: Network },
  { model: "R-200", label: t.router, hint: t.routerHint, icon: Router },
];

/** Palette d'équipements et liste structurée des équipements du projet (alternative au canevas). */
export function Palette({ projectId, project }: { projectId: string; project: OpenProject }) {
  const editable = project.access === "editor";
  const selectedId = project.selection?.kind === "device" ? project.selection.id : null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-4">
      <section aria-labelledby="palette-add">
        <h2 id="palette-add" className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">
          {t.title}
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {ENTRIES.map(({ model, label, hint, icon: Icon }) => (
            <li key={model}>
              <button
                type="button"
                disabled={!editable}
                onClick={() => {
                  addDeviceAtViewCenter(projectId, model);
                }}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors duration-(--duration-fast) hover:border-accent-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon aria-hidden="true" size={20} className="shrink-0 text-text-muted" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">{label}</span>
                  <span className="block text-xs text-text-muted">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="palette-devices" className="min-h-0">
        <h2 id="palette-devices" className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">
          {t.devicesTitle}
        </h2>
        {project.document.topology.devices.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">{t.noDevices}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1">
            {project.document.topology.devices.map((device) => {
              const selected = device.id === selectedId;
              return (
                <li key={device.id}>
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => {
                      useLabStore.getState().select(projectId, { kind: "device", id: device.id });
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-sm border px-2.5 py-1.5 text-left text-sm transition-colors duration-(--duration-fast) ${
                      selected ? "border-accent-text bg-surface-raised text-text" : "border-transparent text-text hover:border-border"
                    }`}
                  >
                    <span className="truncate font-medium">{device.name}</span>
                    <span className="shrink-0 text-xs text-text-muted">{getModel(device.model).kind === "pc" ? "PC" : device.model}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
