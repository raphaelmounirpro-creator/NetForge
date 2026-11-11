import { getModel, type DeviceModelId } from "@netforge/project";
import { Box, Cable, GitFork, Monitor, Network, Plug, Router, Server, SquareStack, StickyNote, Wifi, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { fill, messages } from "../../i18n";
import { addDeviceAtViewCenter, addNoteAtViewCenter } from "./actions";
import { DRAG_TYPE } from "./topology/TopologyCanvas";
import { useLabStore, type OpenProject } from "./store";

const t = messages.palette;

interface Entry {
  model: DeviceModelId;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const IP_ENTRIES: readonly Entry[] = [
  { model: "PC", label: t.pc, hint: t.pcHint, icon: Monitor },
  { model: "S-24", label: t.switch, hint: t.switchHint, icon: Network },
  { model: "R-200", label: t.router, hint: t.routerHint, icon: Router },
];

/** Ordre de la chaîne FTTH, du central à l'abonné ; le coupleur a son propre sélecteur de rapport. */
const FTTH_BEFORE: readonly Entry[] = [
  { model: "OLT-16", label: t.olt, hint: t.oltHint, icon: Server },
  { model: "ODF-12", label: t.odf, hint: t.odfHint, icon: SquareStack },
];
const FTTH_AFTER: readonly Entry[] = [
  { model: "BPE-12", label: t.spliceBox, hint: t.spliceBoxHint, icon: Cable },
  { model: "PBO-8", label: t.pbo, hint: t.pboHint, icon: Box },
  { model: "PTO", label: t.pto, hint: t.ptoHint, icon: Plug },
  { model: "ONT-1G", label: t.ont, hint: t.ontHint, icon: Wifi },
];
const RATIOS = [2, 4, 8, 16, 32, 64] as const;
const splitterModel = (ratio: (typeof RATIOS)[number]): DeviceModelId => `SPL-${String(ratio)}` as DeviceModelId;

const entryClass =
  "flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors duration-(--duration-fast) hover:border-accent-text disabled:cursor-not-allowed disabled:opacity-50";

function EntryButton({ projectId, entry, editable }: { projectId: string; entry: Entry; editable: boolean }) {
  const { model, label, hint, icon: Icon } = entry;
  return (
    <button
      type="button"
      disabled={!editable}
      draggable={editable}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, model);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => {
        addDeviceAtViewCenter(projectId, model);
      }}
      className={entryClass}
    >
      <Icon aria-hidden="true" size={20} className="shrink-0 text-text-muted" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="block text-xs text-text-muted">{hint}</span>
      </span>
    </button>
  );
}

function SplitterEntry({ projectId, editable }: { projectId: string; editable: boolean }) {
  const id = useId();
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>(8);
  return (
    <div className="flex items-stretch gap-2">
      <div className="min-w-0 flex-1">
        <EntryButton
          projectId={projectId}
          editable={editable}
          entry={{ model: splitterModel(ratio), label: fill(t.splitter, { ratio }), hint: fill(t.splitterHint, { ratio }), icon: GitFork }}
        />
      </div>
      <label htmlFor={id} className="sr-only">
        {t.splitterRatio}
      </label>
      <select
        id={id}
        value={ratio}
        disabled={!editable}
        onChange={(event) => {
          setRatio(Number(event.target.value) as (typeof RATIOS)[number]);
        }}
        className="w-16 shrink-0 rounded-md border border-border-strong bg-canvas px-1 font-mono text-sm text-text disabled:opacity-50"
      >
        {RATIOS.map((value) => (
          <option key={value} value={value}>
            1:{value}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Palette d'équipements et liste structurée des équipements du projet (alternative au canevas). */
export function Palette({ projectId, project }: { projectId: string; project: OpenProject }) {
  const editable = project.access === "editor";
  const selectedId = project.selection?.kind === "device" ? project.selection.id : null;
  const selectedNote = project.selection?.kind === "annotation" ? project.selection.id : null;
  const notes = project.document.layout.annotations;
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-4">
      <section aria-labelledby="palette-add" className="shrink-0">
        <h2 id="palette-add" className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">
          {t.title}
        </h2>
        <p className="mt-1 text-xs text-text-muted">{t.dragHint}</p>
        <h3 className="mt-3 text-xs font-semibold text-text">{t.groupIp}</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {IP_ENTRIES.map((entry) => (
            <li key={entry.model}>
              <EntryButton projectId={projectId} entry={entry} editable={editable} />
            </li>
          ))}
        </ul>
        <h3 className="mt-4 text-xs font-semibold text-text">{t.groupFtth}</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {FTTH_BEFORE.map((entry) => (
            <li key={entry.model}>
              <EntryButton projectId={projectId} entry={entry} editable={editable} />
            </li>
          ))}
          <li>
            <SplitterEntry projectId={projectId} editable={editable} />
          </li>
          {FTTH_AFTER.map((entry) => (
            <li key={entry.model}>
              <EntryButton projectId={projectId} entry={entry} editable={editable} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="palette-annotate" className="shrink-0">
        <h2 id="palette-annotate" className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">
          {t.annotate}
        </h2>
        <button
          type="button"
          disabled={!editable}
          onClick={() => {
            addNoteAtViewCenter(projectId);
          }}
          className="mt-3 flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors duration-(--duration-fast) hover:border-accent-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          <StickyNote aria-hidden="true" size={20} className="shrink-0 text-text-muted" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text">{t.addNote}</span>
            <span className="block text-xs text-text-muted">{t.addNoteHint}</span>
          </span>
        </button>
      </section>

      {/* shrink-0 : la palette défile en entier, aucune section ne s'écrase sous la suivante. */}
      <section aria-labelledby="palette-devices" className="shrink-0">
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

      <section aria-labelledby="palette-notes" className="shrink-0">
        <h2 id="palette-notes" className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">
          {t.notesTitle}
        </h2>
        {notes.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">{t.noNotes}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  aria-current={note.id === selectedNote ? "true" : undefined}
                  onClick={() => {
                    useLabStore.getState().select(projectId, { kind: "annotation", id: note.id });
                  }}
                  className={`w-full truncate rounded-sm border px-2.5 py-1.5 text-left text-sm transition-colors duration-(--duration-fast) ${
                    note.id === selectedNote ? "border-accent-text bg-surface-raised text-text" : "border-transparent text-text hover:border-border"
                  }`}
                >
                  {note.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
