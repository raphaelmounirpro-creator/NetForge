import { Cable, Download, Keyboard, Maximize, MousePointer2, PanelLeft, PanelRight, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { messages } from "../../i18n";
import { exportProject, fitToContent, zoomBy } from "./actions";
import { SaveStatus } from "./SaveStatus";
import { useLabStore, type OpenProject } from "./store";

const t = messages.lab;
const ZOOM_STEP = 1.2;
const ICON = 18;

interface LabToolbarProps {
  projectId: string;
  project: OpenProject;
  paletteOpen: boolean;
  propertiesOpen: boolean;
  onTogglePalette: () => void;
  onToggleProperties: () => void;
  onShowShortcuts: () => void;
}

function Separator() {
  return <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

export function LabToolbar(props: LabToolbarProps) {
  const { projectId, project } = props;
  const editable = project.access === "editor";
  const topology = project.view === "topology";
  // Le zoom sert aussi à la vue Simulation, qui affiche le même canevas.
  const canvasView = project.view !== "configuration";
  const store = useLabStore.getState;

  return (
    <div role="toolbar" aria-label={t.toolbar} className="flex items-center gap-0.5">
      <IconButton
        label={project.view === "simulation" ? (props.paletteOpen ? t.hideActions : t.showActions) : props.paletteOpen ? t.hidePalette : t.showPalette}
        pressed={props.paletteOpen}
        icon={<PanelLeft size={ICON} />}
        onClick={props.onTogglePalette}
      />
      <Separator />
      {topology && (
        <>
          <IconButton label={t.toolSelect} pressed={project.tool === "select"} icon={<MousePointer2 size={ICON} />} onClick={() => { store().setTool(projectId, "select"); }} />
          <IconButton label={t.toolLink} pressed={project.tool === "link"} disabled={!editable} icon={<Cable size={ICON} />} onClick={() => { store().setTool(projectId, project.tool === "link" ? "select" : "link"); }} />
          <Separator />
        </>
      )}
      <IconButton label={t.undo} disabled={!editable || project.past.length === 0} icon={<Undo2 size={ICON} />} onClick={() => { store().undo(projectId); }} />
      <IconButton label={t.redo} disabled={!editable || project.future.length === 0} icon={<Redo2 size={ICON} />} onClick={() => { store().redo(projectId); }} />
      {canvasView && (
        <>
          <Separator />
          <IconButton label={t.zoomOut} icon={<ZoomOut size={ICON} />} onClick={() => { zoomBy(projectId, 1 / ZOOM_STEP); }} />
          <span className="w-12 text-center font-mono text-xs text-text-muted" aria-hidden="true">
            {Math.round(project.viewport.scale * 100)} %
          </span>
          <IconButton label={t.zoomIn} icon={<ZoomIn size={ICON} />} onClick={() => { zoomBy(projectId, ZOOM_STEP); }} />
          <IconButton label={t.zoomFit} icon={<Maximize size={ICON} />} onClick={() => { fitToContent(projectId); }} />
        </>
      )}
      <Separator />
      <span className="px-2">
        <SaveStatus project={project} />
      </span>
      <IconButton label={t.export} icon={<Download size={ICON} />} onClick={() => { exportProject(projectId); }} />
      <IconButton label={t.shortcuts} icon={<Keyboard size={ICON} />} onClick={props.onShowShortcuts} />
      <IconButton label={props.propertiesOpen ? t.hideProperties : t.showProperties} pressed={props.propertiesOpen} icon={<PanelRight size={ICON} />} onClick={props.onToggleProperties} />
    </div>
  );
}
