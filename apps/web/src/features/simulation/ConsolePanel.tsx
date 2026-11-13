import { cliPrompt, complete, getModel, isOptical } from "@netforge/project";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type SubmitEvent } from "react";
import { compareNames, fill, messages } from "../../i18n";
import type { OpenProject } from "../lab/store";
import { runConsoleLine } from "./consoleActions";
import { consoleKey, EMPTY_CONSOLE, useConsoleStore, type ConsoleLineKind } from "./consoleStore";

const t = messages.console;

const LINE_CLASSES: Record<ConsoleLineKind, string> = {
  input: "text-accent-text",
  output: "text-text",
  error: "text-danger",
  info: "text-text-muted",
};

/**
 * Console d'un équipement : invite selon le mode, historique (↑ ↓),
 * complétion (Tab sur une ligne non vide, pour ne pas piéger le focus),
 * sortie annoncée aux lecteurs d'écran.
 */
export function ConsolePanel({ projectId, project }: { projectId: string; project: OpenProject }) {
  const selectId = useId();
  const inputId = useId();
  const outputRef = useRef<HTMLDivElement>(null);
  const doc = project.document;
  // Équipements passifs du réseau optique : pas de console. OLT et ONT en ont une (configuration PON).
  const devices = useMemo(
    () =>
      doc.topology.devices
        .filter((item) => {
          const kind = getModel(item.model).kind;
          return !isOptical(kind) || kind === "olt" || kind === "ont";
        })
        .sort((a, b) => compareNames(a.name, b.name)),
    [doc.topology.devices],
  );
  const selected = project.selection?.kind === "device" ? project.selection.id : null;
  const [chosen, setChosen] = useState<string | null>(null);
  const deviceId = [chosen, selected, devices[0]?.id].find((id) => id && devices.some((device) => device.id === id)) ?? null;
  const device = devices.find((item) => item.id === deviceId);
  const key = deviceId ? consoleKey(projectId, deviceId) : "";
  const state = useConsoleStore((store) => store.consoles[key] ?? EMPTY_CONSOLE);
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [state.lines]);

  if (!device || !deviceId) return <p className="p-3 text-sm text-text-muted">{messages.palette.noDevices}</p>;
  const prompt = cliPrompt(device, state.mode);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const line = value;
    setValue("");
    setHistoryIndex(null);
    void runConsoleLine(projectId, deviceId, line);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const history = state.history;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (history.length === 0) return;
      event.preventDefault();
      const start = historyIndex ?? history.length;
      const next = Math.min(history.length, Math.max(0, start + (event.key === "ArrowUp" ? -1 : 1)));
      setHistoryIndex(next === history.length ? null : next);
      setValue(history[next] ?? "");
    } else if (event.key === "Tab" && !event.shiftKey && value.trim() !== "") {
      event.preventDefault();
      const result = complete(doc, deviceId, state.mode, value);
      setValue(result.line);
      if (result.candidates.length > 1) {
        useConsoleStore.getState().append(key, "info", [fill(t.candidates, { candidates: result.candidates.join("  ") })]);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <label htmlFor={selectId} className="text-text-muted">
          {t.device}
        </label>
        <select
          id={selectId}
          value={deviceId}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
          className="min-h-8 rounded-sm border border-border-strong bg-canvas px-2 text-xs text-text"
        >
          {devices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={outputRef}
        role="log"
        aria-live="polite"
        aria-label={fill(t.output, { device: device.name })}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto bg-canvas px-3 py-2 font-mono text-xs whitespace-pre-wrap"
      >
        {state.lines.length === 0 ? (
          <p className="text-text-muted">{fill(t.intro, { device: device.name })}</p>
        ) : (
          state.lines.map((line) => (
            <p key={line.id} className={LINE_CLASSES[line.kind]}>
              {line.kind === "error" ? "✕ " : ""}
              {line.text}
            </p>
          ))
        )}
      </div>
      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-border bg-canvas px-3 py-1.5 font-mono text-xs">
        <label htmlFor={inputId} className="shrink-0 text-accent-text">
          <span className="sr-only">{fill(t.input, { device: device.name })} </span>
          {prompt}
        </label>
        <input
          id={inputId}
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            setHistoryIndex(null);
          }}
          onKeyDown={onKeyDown}
          className="min-h-8 min-w-0 flex-1 bg-transparent text-text outline-offset-2"
        />
      </form>
    </div>
  );
}
