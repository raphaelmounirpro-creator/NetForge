import { addDevice, disconnect, removeDevice, type DeviceModelId, type NfgDocument, type Position } from "@netforge/project";
import { downloadText } from "../storage/files";
import { projectService } from "./services";
import { DEFAULT_VIEWPORT, useLabStore, type Viewport } from "./store";

/**
 * Actions de l'éditeur partagées par la palette, la barre d'outils, le
 * canevas et les raccourcis. Toute modification passe par une commande métier.
 */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3;
const SPREAD = 32;
const NEAR = 40;

export function newEntityId(): string {
  return crypto.randomUUID();
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Centre de la zone visible, en coordonnées de la topologie. */
function viewCenter(viewport: Viewport): Position {
  const { width, height } = useLabStore.getState().canvasSize;
  const w = width || 800;
  const h = height || 600;
  return { x: (w / 2 - viewport.x) / viewport.scale, y: (h / 2 - viewport.y) / viewport.scale };
}

/** Décale la position tant qu'un équipement occupe déjà l'emplacement. */
function freeSpot(doc: NfgDocument, start: Position): Position {
  const occupied = Object.values(doc.layout.devices);
  let candidate = start;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = candidate;
    if (!occupied.some((pos) => Math.abs(pos.x - current.x) < NEAR && Math.abs(pos.y - current.y) < NEAR)) return current;
    candidate = { x: start.x + SPREAD * ((attempt % 6) + 1), y: start.y + SPREAD * Math.floor(attempt / 6 + 1) };
  }
  return candidate;
}

export function addDeviceAtViewCenter(projectId: string, model: DeviceModelId): void {
  const state = useLabStore.getState();
  const project = state.projects[projectId];
  if (!project) return;
  const id = newEntityId();
  const result = state.apply(projectId, (doc) => addDevice(doc, { id, model, position: freeSpot(doc, viewCenter(project.viewport)) }));
  if (result?.ok) state.select(projectId, { kind: "device", id });
}

export function deleteSelection(projectId: string): void {
  const state = useLabStore.getState();
  const selection = state.projects[projectId]?.selection;
  if (!selection) return;
  state.apply(projectId, (doc) =>
    selection.kind === "device" ? removeDevice(doc, { deviceId: selection.id }) : disconnect(doc, { linkId: selection.id }),
  );
}

/** Zoom centré sur un point de l'écran (par défaut le centre du canevas). */
export function zoomBy(projectId: string, factor: number, anchor?: { x: number; y: number }): void {
  const state = useLabStore.getState();
  const viewport = state.projects[projectId]?.viewport;
  if (!viewport) return;
  const point = anchor ?? { x: state.canvasSize.width / 2, y: state.canvasSize.height / 2 };
  const scale = clampScale(viewport.scale * factor);
  const world = { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
  state.setViewport(projectId, { scale, x: point.x - world.x * scale, y: point.y - world.y * scale });
}

/** Ajuste la vue pour afficher toute la topologie. */
export function fitToContent(projectId: string): void {
  const state = useLabStore.getState();
  const project = state.projects[projectId];
  if (!project) return;
  const positions = Object.values(project.document.layout.devices);
  const { width, height } = state.canvasSize;
  if (positions.length === 0 || width === 0) {
    state.setViewport(projectId, DEFAULT_VIEWPORT);
    return;
  }
  const xs = positions.map((pos) => pos.x);
  const ys = positions.map((pos) => pos.y);
  const bounds = { minX: Math.min(...xs) - 80, maxX: Math.max(...xs) + 80, minY: Math.min(...ys) - 60, maxY: Math.max(...ys) + 90 };
  const scale = clampScale(Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY), 1.5));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  state.setViewport(projectId, { scale, x: width / 2 - centerX * scale, y: height / 2 - centerY * scale });
}

export function exportDocument(document: NfgDocument): void {
  const { fileName, text } = projectService.exportDocument(document);
  downloadText(fileName, text);
}

export function exportProject(projectId: string): void {
  const project = useLabStore.getState().projects[projectId];
  if (project) exportDocument(project.document);
}
