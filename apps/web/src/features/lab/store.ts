import type { CommandResult, Issue, NfgDocument } from "@netforge/project";
import { create } from "zustand";
import type { StorageErrorKind } from "../storage/repository";

/**
 * État de l'éditeur. Seul le document (topologie, configurations,
 * disposition) est persistant ; sélection, vue, zoom et historique
 * d'édition restent propres à la session et ne sont jamais exportés.
 */
export type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";
export type Access = "editor" | "readonly";
export type LabView = "topology" | "simulation" | "configuration";
export type Tool = "select" | "link";
export type Selection = { kind: "device"; id: string } | { kind: "link"; id: string } | { kind: "annotation"; id: string } | null;

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface OpenProject {
  document: NfgDocument;
  past: NfgDocument[];
  future: NfgDocument[];
  /** Révision IndexedDB du dernier enregistrement connu (null : jamais enregistré). */
  storedRevision: number | null;
  /** Compteur de modifications ; enregistré quand savedChange le rattrape. */
  change: number;
  savedChange: number;
  saveStatus: SaveStatus;
  saveError: StorageErrorKind | null;
  access: Access;
  view: LabView;
  selection: Selection;
  viewport: Viewport;
  tool: Tool;
  /** Équipement de départ en mode liaison. */
  linkSourceId: string | null;
  /** Derniers problèmes renvoyés par une commande (erreurs ou avertissements). */
  feedback: Issue[];
  /** Confirmation d’une action réussie, annoncée aux lecteurs d’écran. */
  notice: string | null;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export const HISTORY_LIMIT = 100;
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

interface LabState {
  projects: Record<string, OpenProject>;
  order: string[];
  activeId: string | null;
  /** Taille du canevas affiché (placement des nouveaux équipements, zoom au centre). */
  canvasSize: CanvasSize;

  openProject: (document: NfgDocument, options: { storedRevision: number | null; access: Access; saved: boolean }) => void;
  closeProject: (id: string) => void;
  setActive: (id: string) => void;
  /** Applique une commande métier ; renvoie son résultat (les erreurs ne modifient rien). */
  apply: (id: string, command: (doc: NfgDocument) => CommandResult) => CommandResult | null;
  undo: (id: string) => void;
  redo: (id: string) => void;
  /** Remplace le document par la version enregistrée (résolution de conflit, reprise de la main). */
  reload: (id: string, document: NfgDocument, storedRevision: number) => void;
  setAccess: (id: string, access: Access) => void;
  markSaving: (id: string) => void;
  markSaved: (id: string, result: { revision: number; change: number; updatedAt: string }) => void;
  markSaveError: (id: string, kind: StorageErrorKind) => void;
  markConflict: (id: string) => void;
  setView: (id: string, view: LabView) => void;
  select: (id: string, selection: Selection) => void;
  setViewport: (id: string, viewport: Viewport) => void;
  setTool: (id: string, tool: Tool) => void;
  setLinkSource: (id: string, deviceId: string | null) => void;
  setFeedback: (id: string, feedback: Issue[]) => void;
  setNotice: (id: string, notice: string | null) => void;
  setCanvasSize: (size: CanvasSize) => void;
}

function newOpenProject(document: NfgDocument, storedRevision: number | null, access: Access, saved: boolean): OpenProject {
  return {
    document,
    past: [],
    future: [],
    storedRevision,
    change: saved ? 0 : 1,
    savedChange: 0,
    saveStatus: saved ? "saved" : "pending",
    saveError: null,
    access,
    view: "topology",
    selection: null,
    viewport: DEFAULT_VIEWPORT,
    tool: "select",
    linkSourceId: null,
    feedback: [],
    notice: null,
  };
}

/** La sélection ne doit jamais désigner un élément disparu (suppression, annulation). */
function sanitizeSelection(document: NfgDocument, selection: Selection): Selection {
  if (!selection) return null;
  const exists =
    selection.kind === "device"
      ? document.topology.devices.some((device) => device.id === selection.id)
      : selection.kind === "link"
        ? document.topology.links.some((link) => link.id === selection.id)
        : document.layout.annotations.some((annotation) => annotation.id === selection.id);
  return exists ? selection : null;
}

export const useLabStore = create<LabState>()((set, get) => {
  const update = (id: string, patch: (project: OpenProject) => Partial<OpenProject>) => {
    set((state) => {
      const project = state.projects[id];
      if (!project) return state;
      return { projects: { ...state.projects, [id]: { ...project, ...patch(project) } } };
    });
  };

  const changed = (project: OpenProject, document: NfgDocument): Partial<OpenProject> => ({
    document,
    change: project.change + 1,
    saveStatus: project.saveStatus === "conflict" ? "conflict" : "pending",
    selection: sanitizeSelection(document, project.selection),
    linkSourceId: document.topology.devices.some((device) => device.id === project.linkSourceId) ? project.linkSourceId : null,
  });

  return {
    projects: {},
    order: [],
    activeId: null,
    canvasSize: { width: 0, height: 0 },

    openProject: (document, { storedRevision, access, saved }) => {
      const id = document.metadata.id;
      set((state) => ({
        projects: state.projects[id] ? state.projects : { ...state.projects, [id]: newOpenProject(document, storedRevision, access, saved) },
        order: state.order.includes(id) ? state.order : [...state.order, id],
        activeId: id,
      }));
    },

    closeProject: (id) => {
      set((state) => {
        const { [id]: _closed, ...projects } = state.projects;
        const order = state.order.filter((item) => item !== id);
        const index = state.order.indexOf(id);
        const activeId = state.activeId === id ? (order[Math.min(index, order.length - 1)] ?? null) : state.activeId;
        return { projects, order, activeId };
      });
    },

    setActive: (id) => {
      if (get().projects[id]) set({ activeId: id });
    },

    apply: (id, command) => {
      const project = get().projects[id];
      if (!project || project.access !== "editor") return null;
      const result = command(project.document);
      if (!result.ok) {
        update(id, () => ({ feedback: result.errors, notice: null }));
        return result;
      }
      update(id, (current) => ({
        ...changed(current, result.document),
        past: [...current.past, current.document].slice(-HISTORY_LIMIT),
        future: [],
        feedback: result.warnings,
        notice: null,
      }));
      return result;
    },

    undo: (id) => {
      const project = get().projects[id];
      const previous = project?.past.at(-1);
      if (!project || !previous || project.access !== "editor") return;
      update(id, (current) => ({
        ...changed(current, previous),
        past: current.past.slice(0, -1),
        future: [current.document, ...current.future],
        feedback: [],
      }));
    },

    redo: (id) => {
      const project = get().projects[id];
      const next = project?.future[0];
      if (!project || !next || project.access !== "editor") return;
      update(id, (current) => ({
        ...changed(current, next),
        past: [...current.past, current.document],
        future: current.future.slice(1),
        feedback: [],
      }));
    },

    reload: (id, document, storedRevision) => {
      update(id, (project) => ({
        ...newOpenProject(document, storedRevision, project.access, true),
        view: project.view,
        viewport: project.viewport,
        selection: sanitizeSelection(document, project.selection),
      }));
    },

    setAccess: (id, access) => {
      update(id, () => ({ access, tool: "select", linkSourceId: null }));
    },

    markSaving: (id) => {
      update(id, (project) => (project.saveStatus === "conflict" ? {} : { saveStatus: "saving" }));
    },

    markSaved: (id, { revision, change, updatedAt }) => {
      update(id, (project) => ({
        storedRevision: revision,
        savedChange: change,
        saveError: null,
        saveStatus: project.change === change ? "saved" : "pending",
        document: { ...project.document, metadata: { ...project.document.metadata, updatedAt } },
      }));
    },

    markSaveError: (id, kind) => {
      update(id, () => ({ saveStatus: "error", saveError: kind }));
    },

    markConflict: (id) => {
      update(id, () => ({ saveStatus: "conflict" }));
    },

    setView: (id, view) => {
      update(id, () => ({ view }));
    },
    select: (id, selection) => {
      update(id, () => ({ selection }));
    },
    setViewport: (id, viewport) => {
      update(id, () => ({ viewport }));
    },
    setTool: (id, tool) => {
      update(id, () => ({ tool, linkSourceId: null }));
    },
    setLinkSource: (id, deviceId) => {
      update(id, () => ({ linkSourceId: deviceId }));
    },
    setFeedback: (id, feedback) => {
      update(id, () => ({ feedback }));
    },
    setNotice: (id, notice) => {
      update(id, () => ({ notice }));
    },
    setCanvasSize: (canvasSize) => {
      set({ canvasSize });
    },
  };
});

/** Vrai si des modifications ne sont pas encore enregistrées (ou n'ont pas pu l'être). */
export function hasUnsavedChanges(project: OpenProject): boolean {
  return project.change !== project.savedChange || project.saveStatus === "error" || project.saveStatus === "conflict";
}
