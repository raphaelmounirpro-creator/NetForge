import { connectDevices, getModel, moveDevice, type NfgDocument } from "@netforge/project";
import type { KonvaEventObject } from "konva/lib/Node";
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Layer, Line, Stage, Text } from "react-konva";
import { fill, messages } from "../../../i18n";
import { deleteSelection, newEntityId, zoomBy } from "../actions";
import { useLabStore, type OpenProject } from "../store";
import { DeviceNode } from "./DeviceNode";
import { useThemeColors } from "./useThemeColors";

const t = messages.canvas;
const PORT_LABEL_DISTANCE = 56;
const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;
const WHEEL_ZOOM = 1.1;

/** Libellé secondaire d'un équipement : première adresse configurée. */
function deviceDetail(doc: NfgDocument, deviceId: string): string | null {
  const config = doc.configurations[deviceId];
  const first = config && Object.values(config.interfaces).find((item) => item.ipv4)?.ipv4;
  return first ? `${first.address}/${String(first.prefixLength)}` : null;
}

interface DragState {
  id: string;
  x: number;
  y: number;
}

interface TopologyCanvasProps {
  projectId: string;
  project: OpenProject;
  /** « simulate » : observation (déplacements autorisés, aucun outil d'édition du réseau). */
  mode?: "edit" | "simulate";
  /** État des câbles calculé par le moteur (vue Simulation). */
  linkStates?: Readonly<Record<string, boolean>> | undefined;
}

/** Mémoïsé : la vue Simulation reçoit des lots fréquents qui ne concernent pas le canevas. */
export const TopologyCanvas = memo(function TopologyCanvas({ projectId, project, mode = "edit", linkStates }: TopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const colors = useThemeColors();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const { document: doc, viewport, selection, linkSourceId, access } = project;
  const editable = access === "editor";
  const simulate = mode === "simulate";
  const tool = simulate ? "select" : project.tool;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) };
      setSize(next);
      useLabStore.getState().setCanvasSize(next);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const positionOf = useMemo(
    () => (deviceId: string) => (drag?.id === deviceId ? drag : doc.layout.devices[deviceId]),
    [doc.layout.devices, drag],
  );
  const nameOf = (deviceId: string) => doc.topology.devices.find((device) => device.id === deviceId)?.name ?? "";

  const store = useLabStore.getState;

  const handleDeviceClick = (deviceId: string) => {
    containerRef.current?.focus({ preventScroll: true });
    if (tool !== "link" || !editable) {
      store().select(projectId, { kind: "device", id: deviceId });
      return;
    }
    if (!linkSourceId || linkSourceId === deviceId) {
      store().setLinkSource(projectId, linkSourceId === deviceId ? null : deviceId);
      return;
    }
    const linkId = newEntityId();
    const result = store().apply(projectId, (current) => connectDevices(current, { linkId, aDeviceId: linkSourceId, bDeviceId: deviceId }));
    store().setLinkSource(projectId, null);
    if (result?.ok) {
      const link = result.document.topology.links.find((item) => item.id === linkId);
      if (link) {
        const [a, b] = link.endpoints;
        store().select(projectId, { kind: "link", id: linkId });
        store().setNotice(
          projectId,
          fill(messages.lab.linkCreated, { a: `${nameOf(a.deviceId)} ${a.portId}`, b: `${nameOf(b.deviceId)} ${b.portId}` }),
        );
      }
    }
  };

  const handleDragEnd = (deviceId: string, x: number, y: number) => {
    setDrag(null);
    store().apply(projectId, (current) => moveDevice(current, { deviceId, position: { x, y } }));
  };

  const handleStageClick = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (event.target !== event.target.getStage()) return;
    containerRef.current?.focus({ preventScroll: true });
    store().select(projectId, null);
    store().setLinkSource(projectId, null);
  };

  const handleStageDragEnd = (event: KonvaEventObject<DragEvent>) => {
    const stage = event.target.getStage();
    if (!stage || event.target !== stage) return;
    store().setViewport(projectId, { ...viewport, x: stage.x(), y: stage.y() });
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = event.target.getStage()?.getPointerPosition();
    zoomBy(projectId, event.evt.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, pointer ?? undefined);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      store().select(projectId, null);
      store().setLinkSource(projectId, null);
      return;
    }
    if (!editable || selection?.kind !== "device") return;
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    const current = doc.layout.devices[selection.id];
    if (!move || !current) return;
    event.preventDefault();
    store().apply(projectId, (latest) => moveDevice(latest, { deviceId: selection.id, position: { x: current.x + move[0], y: current.y + move[1] } }));
  };

  const empty = doc.topology.devices.length === 0;
  const showPortLabels = viewport.scale >= 0.6;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={simulate ? messages.lab.viewSimulation : messages.lab.viewTopology}
      aria-describedby={helpId}
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.key === "Delete" || event.key === "Backspace") && editable && !simulate) {
          event.preventDefault();
          deleteSelection(projectId);
          return;
        }
        handleKeyDown(event);
      }}
      className="relative h-full min-h-0 w-full overflow-hidden bg-canvas focus-visible:outline-offset-[-2px]"
      style={{
        backgroundImage: `radial-gradient(${colors.border} 1px, transparent 1px)`,
        backgroundSize: `${String(24 * viewport.scale)}px ${String(24 * viewport.scale)}px`,
        backgroundPosition: `${String(viewport.x)}px ${String(viewport.y)}px`,
      }}
    >
      <p id={helpId} className="sr-only">
        {t.label}
      </p>
      {size.width > 0 && size.height > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          draggable
          onClick={handleStageClick}
          onTap={handleStageClick}
          onDragEnd={handleStageDragEnd}
          onWheel={handleWheel}
        >
          <Layer>
            {doc.topology.links.map((link) => {
              const [a, b] = link.endpoints;
              const posA = positionOf(a.deviceId);
              const posB = positionOf(b.deviceId);
              if (!posA || !posB) return null;
              const selected = selection?.kind === "link" && selection.id === link.id;
              const down = linkStates?.[link.id] === false;
              const select = () => {
                store().select(projectId, { kind: "link", id: link.id });
              };
              return (
                <Line
                  key={link.id}
                  points={[posA.x, posA.y, posB.x, posB.y]}
                  stroke={selected ? colors.accent : down ? colors.danger : colors["border-strong"]}
                  strokeWidth={selected ? 3 : 2}
                  dash={down ? [8, 6] : []}
                  hitStrokeWidth={14}
                  onClick={select}
                  onTap={select}
                />
              );
            })}
            {showPortLabels &&
              doc.topology.links.flatMap((link) => {
                const [a, b] = link.endpoints;
                const posA = positionOf(a.deviceId);
                const posB = positionOf(b.deviceId);
                if (!posA || !posB) return [];
                const distance = Math.hypot(posB.x - posA.x, posB.y - posA.y) || 1;
                const ratio = Math.min(0.4, PORT_LABEL_DISTANCE / distance);
                return [
                  { end: a, x: posA.x + (posB.x - posA.x) * ratio, y: posA.y + (posB.y - posA.y) * ratio },
                  { end: b, x: posB.x + (posA.x - posB.x) * ratio, y: posB.y + (posA.y - posB.y) * ratio },
                ].map(({ end, x, y }) => (
                  <Text
                    key={`${link.id}-${end.deviceId}`}
                    text={end.portId}
                    x={x - 20}
                    y={y - 14}
                    width={40}
                    align="center"
                    fontSize={10}
                    fontFamily="ui-monospace, Consolas, monospace"
                    fill={colors["text-muted"]}
                    listening={false}
                  />
                ));
              })}
            {/* Câble coupé : le libellé texte double le pointillé (la couleur n'est jamais seule). */}
            {doc.topology.links.map((link) => {
              if (linkStates?.[link.id] !== false) return null;
              const [a, b] = link.endpoints;
              const posA = positionOf(a.deviceId);
              const posB = positionOf(b.deviceId);
              if (!posA || !posB) return null;
              return (
                <Text
                  key={`${link.id}-down`}
                  text={`✕ ${messages.simulation.linkDown}`}
                  x={(posA.x + posB.x) / 2 - 40}
                  y={(posA.y + posB.y) / 2 - 8}
                  width={80}
                  align="center"
                  fontSize={12}
                  fontStyle="bold"
                  fill={colors.danger}
                  listening={false}
                />
              );
            })}
            {doc.topology.devices.map((device) => {
              const position = doc.layout.devices[device.id];
              if (!position) return null;
              return (
                <DeviceNode
                  key={device.id}
                  id={device.id}
                  kind={getModel(device.model).kind}
                  name={device.name}
                  detail={deviceDetail(doc, device.id)}
                  x={position.x}
                  y={position.y}
                  selected={selection?.kind === "device" && selection.id === device.id}
                  linkSource={linkSourceId === device.id}
                  draggable={editable && tool === "select"}
                  colors={colors}
                  onSelect={handleDeviceClick}
                  onDragMove={(id, x, y) => {
                    setDrag({ id, x, y });
                  }}
                  onDragEnd={handleDragEnd}
                />
              );
            })}
          </Layer>
        </Stage>
      )}
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-lg border border-border bg-surface p-5 text-center">
            <p className="font-semibold text-text">{t.emptyTitle}</p>
            <p className="mt-1 text-sm text-text-muted">{t.emptyBody}</p>
          </div>
        </div>
      )}
      {tool === "link" && editable && !simulate && (
        <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-accent-text bg-surface px-3 py-1.5 text-xs text-text">
          {linkSourceId ? fill(messages.lab.linkModeSource, { name: nameOf(linkSourceId) }) : messages.lab.linkModeHint}
        </p>
      )}
    </div>
  );
});
