import { useEffect } from "react";
import { deleteSelection, fitToContent, zoomBy } from "./actions";
import { useLabStore } from "./store";

const ZOOM_STEP = 1.2;

/** Vrai si la touche vise un champ de saisie : les raccourcis ne doivent pas gêner la frappe. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Raccourcis du laboratoire (documentés dans la boîte « Raccourcis clavier »). */
export function useLabShortcuts(projectId: string | null): void {
  useEffect(() => {
    if (!projectId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target) || document.querySelector("dialog[open]")) return;
      const state = useLabStore.getState();
      const project = state.projects[projectId];
      if (!project) return;
      const editable = project.access === "editor";
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;

      if (command && key === "z" && !event.shiftKey) {
        event.preventDefault();
        state.undo(projectId);
      } else if (command && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        state.redo(projectId);
      } else if (command || event.altKey) {
        return;
      } else if (event.key === "Delete" || event.key === "Backspace") {
        // La vue Simulation observe le réseau : on n'y supprime rien au clavier.
        if (!editable || !project.selection || project.view === "simulation") return;
        event.preventDefault();
        deleteSelection(projectId);
      } else if (event.key === "Escape") {
        state.select(projectId, null);
        state.setLinkSource(projectId, null);
      } else if (project.view === "configuration") {
        return;
      } else if (key === "v" && project.view === "topology") {
        state.setTool(projectId, "select");
      } else if (key === "l" && editable && project.view === "topology") {
        state.setTool(projectId, project.tool === "link" ? "select" : "link");
      } else if (event.key === "+" || event.key === "=") {
        zoomBy(projectId, ZOOM_STEP);
      } else if (event.key === "-") {
        zoomBy(projectId, 1 / ZOOM_STEP);
      } else if (event.key === "0") {
        fitToContent(projectId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [projectId]);
}
