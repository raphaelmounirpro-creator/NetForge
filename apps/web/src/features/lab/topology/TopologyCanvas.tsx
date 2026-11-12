import { connectDevices, DEVICE_MODELS, getModel, moveAnnotation, moveDevice, type DeviceModelId, type NfgDocument } from "@netforge/project";
import type { KonvaEventObject } from "konva/lib/Node";
import { memo, useEffect, useId, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent } from "react";
import { Label, Layer, Line, Stage, Tag, Text } from "react-konva";
import { fill, messages } from "../../../i18n";
import { formatLength } from "../../optics/format";
import { addDeviceAt, deleteSelection, fitToContent, newEntityId, zoomBy } from "../actions";
import { useLabStore, type OpenProject } from "../store";
import { PacketLayer } from "../../simulation/PacketLayer";
import { DeviceNode } from "./DeviceNode";
import { Minimap } from "./Minimap";
import { useThemeColors } from "./useThemeColors";

const t = messages.canvas;
const PORT_LABEL_DISTANCE = 56;
const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;
const WHEEL_ZOOM = 1.1;
/** Type de donnée du glisser-déposer depuis la palette (identifiant de modèle). */
export const DRAG_TYPE = "application/x-netforge-model";
const NOTE_WIDTH = 220;
/** Projets déjà ajustés automatiquement pendant la session (une seule fois par projet). */
const autoFitted = new Set<string>();
/** Marge (px) sous laquelle un équipement est jugé hors de la zone visible. */
const FIT_MARGIN = 40;

/** Libellé secondaire d'un équipement : première adresse configurée, ou rapport d'un coupleur. */
function deviceDetail(doc: NfgDocument, deviceId: string): string | null {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  const model = device ? getModel(device.model) : null;
  if (model?.kind === "splitter") return `1:${String(model.ports.length - 1)}`;
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
  /** « simulate » et « optics » : observation (déplacements autorisés, aucun outil d'édition du réseau). */
  mode?: "edit" | "simulate" | "optics";
  /** État des câbles calculé par le moteur (vue Simulation). */
  linkStates?: Readonly<Record<string, boolean>> | undefined;
  /** Câbles empruntés par l'échange suivi (vue Simulation) ou par le chemin optique choisi. */
  highlightLinks?: ReadonlySet<string> | undefined;
  /** Libellés secondaires imposés (état optique des ONT dans la vue Optique). */
  deviceDetails?: ReadonlyMap<string, string> | undefined;
  /** Ports qui ne transmettent pas (Spanning Tree), clé « équipement/port » → état écrit (vue Simulation). */
  blockedPorts?: ReadonlyMap<string, string> | undefined;
}

/** Mémoïsé : la vue Simulation reçoit des lots fréquents qui ne concernent pas le canevas. */
export const TopologyCanvas = memo(function TopologyCanvas({ projectId, project, mode = "edit", linkStates, highlightLinks, deviceDetails, blockedPorts }: TopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const colors = useThemeColors();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const { document: doc, viewport, selection, linkSourceId, access } = project;
  const editable = access === "editor";
  const simulate = mode !== "edit";
  const tool = simulate ? "select" : project.tool;

  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) };
      const lab = useLabStore.getState();
      const previous = lab.canvasSize;
      setSize(next);
      lab.setCanvasSize(next);
      // Zone visible redimensionnée (vue Simulation et son panneau de résultats, panneaux latéraux) :
      // le centre de la vue reste en place, sinon une partie de la topologie passerait hors champ.
      const current = lab.projects[projectRef.current];
      if (current && previous.width > 0 && previous.height > 0 && (previous.width !== next.width || previous.height !== next.height)) {
        const { viewport: view } = current;
        lab.setViewport(projectRef.current, { ...view, x: view.x + (next.width - previous.width) / 2, y: view.y + (next.height - previous.height) / 2 });
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Première ouverture d'un projet dont la topologie dépasse la zone visible (vue jamais déplacée) : on l'ajuste.
  useEffect(() => {
    if (size.width === 0 || size.height === 0 || autoFitted.has(projectId)) return;
    autoFitted.add(projectId);
    const current = useLabStore.getState().projects[projectId];
    if (!current) return;
    const { x, y, scale } = current.viewport;
    if (x !== 0 || y !== 0 || scale !== 1) return;
    const outside = Object.values(current.document.layout.devices).some(
      (pos) => pos.x < FIT_MARGIN || pos.y < FIT_MARGIN || pos.x > size.width - FIT_MARGIN || pos.y > size.height - FIT_MARGIN,
    );
    if (outside) fitToContent(projectId);
  }, [projectId, size.width, size.height]);

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
    if (!editable || (selection?.kind !== "device" && selection?.kind !== "annotation")) return;
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    if (selection.kind === "device") {
      const current = doc.layout.devices[selection.id];
      if (!current) return;
      event.preventDefault();
      store().apply(projectId, (latest) => moveDevice(latest, { deviceId: selection.id, position: { x: current.x + move[0], y: current.y + move[1] } }));
      return;
    }
    const note = doc.layout.annotations.find((item) => item.id === selection.id);
    if (!note) return;
    event.preventDefault();
    store().apply(projectId, (latest) => moveAnnotation(latest, { id: selection.id, position: { x: note.x + move[0], y: note.y + move[1] } }));
  };

  // Glisser-déposer depuis la palette : l'équipement est placé sous le pointeur.
  const acceptsDrop = editable && !simulate;
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const model = event.dataTransfer.getData(DRAG_TYPE);
    if (!acceptsDrop || !model || !(model in DEVICE_MODELS)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    addDeviceAt(projectId, model as DeviceModelId, {
      x: (event.clientX - rect.left - viewport.x) / viewport.scale,
      y: (event.clientY - rect.top - viewport.y) / viewport.scale,
    });
  };

  const empty = doc.topology.devices.length === 0;
  const showPortLabels = viewport.scale >= 0.6;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={mode === "optics" ? messages.lab.viewOptics : simulate ? messages.lab.viewSimulation : messages.lab.viewTopology}
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
      onDragOver={(event) => {
        if (acceptsDrop && event.dataTransfer.types.includes(DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleDrop}
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
              const followed = highlightLinks?.has(link.id) ?? false;
              const select = () => {
                store().select(projectId, { kind: "link", id: link.id });
              };
              return (
                <Line
                  key={link.id}
                  points={[posA.x, posA.y, posB.x, posB.y]}
                  stroke={selected ? colors.accent : down ? colors.danger : followed ? colors.signal : colors["border-strong"]}
                  strokeWidth={selected ? 3 : followed ? 4 : 2}
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
                return [
                  { end: a, from: posA, to: posB },
                  { end: b, from: posB, to: posA },
                ].map(({ end, from, to }) => {
                  // VLAN d'un port de switch configuré (le VLAN 1 par défaut n'est pas annoté) ;
                  // l'étiquette, plus longue, est éloignée du symbole pour ne pas couvrir son nom.
                  const switchport = doc.configurations[end.deviceId]?.switchports[end.portId];
                  const text = switchport ? `${end.portId}·${switchport.mode === "trunk" ? "trunk" : `V${String(switchport.vlan)}`}` : end.portId;
                  const width = Math.max(40, text.length * 6.5);
                  const ratio = Math.min(switchport ? 0.45 : 0.4, (switchport ? PORT_LABEL_DISTANCE + 24 : PORT_LABEL_DISTANCE) / distance);
                  const x = from.x + (to.x - from.x) * ratio;
                  const y = from.y + (to.y - from.y) * ratio;
                  return (
                    <Text
                      key={`${link.id}-${end.deviceId}`}
                      text={text}
                      x={x - width / 2}
                      y={y - 14}
                      width={width}
                      align="center"
                      fontSize={10}
                      fontFamily="ui-monospace, Consolas, monospace"
                      fill={colors["text-muted"]}
                      listening={false}
                    />
                  );
                });
              })}
            {/* Fibre : sa longueur, écrite au milieu du lien, la distingue d'un câble cuivre. */}
            {showPortLabels &&
              doc.topology.links.map((link) => {
                if (link.fiber === null) return null;
                const [a, b] = link.endpoints;
                const posA = positionOf(a.deviceId);
                const posB = positionOf(b.deviceId);
                if (!posA || !posB) return null;
                return (
                  <Text
                    key={`${link.id}-fiber`}
                    text={formatLength(link.fiber.length)}
                    x={(posA.x + posB.x) / 2 - 40}
                    y={(posA.y + posB.y) / 2 + 4}
                    width={80}
                    align="center"
                    fontSize={10}
                    fill={colors["text-muted"]}
                    listening={false}
                  />
                );
              })}
            {/* Port bloqué par le Spanning Tree : symbole et état écrits près de l'extrémité du câble. */}
            {blockedPorts &&
              doc.topology.links.flatMap((link) => {
                const [a, b] = link.endpoints;
                const posA = positionOf(a.deviceId);
                const posB = positionOf(b.deviceId);
                if (!posA || !posB) return [];
                return [
                  { end: a, from: posA, to: posB },
                  { end: b, from: posB, to: posA },
                ].flatMap(({ end, from, to }) => {
                  const state = blockedPorts.get(`${end.deviceId}/${end.portId}`);
                  if (!state) return [];
                  const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                  const ratio = Math.min(0.5, (PORT_LABEL_DISTANCE + 40) / distance);
                  return [
                    <Text
                      key={`${link.id}-${end.deviceId}-stp`}
                      text={`⊘ ${state}`}
                      x={from.x + (to.x - from.x) * ratio - 45}
                      y={from.y + (to.y - from.y) * ratio - 6}
                      width={90}
                      align="center"
                      fontSize={11}
                      fontStyle="bold"
                      fill={colors.warning}
                      listening={false}
                    />,
                  ];
                });
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
            {doc.layout.annotations.map((note) => {
              const selected = selection?.kind === "annotation" && selection.id === note.id;
              const select = () => {
                store().select(projectId, { kind: "annotation", id: note.id });
              };
              return (
                <Label
                  key={note.id}
                  x={note.x}
                  y={note.y}
                  draggable={editable}
                  onClick={select}
                  onTap={select}
                  onDragEnd={(event) => {
                    const node = event.target;
                    store().apply(projectId, (latest) => moveAnnotation(latest, { id: note.id, position: { x: node.x(), y: node.y() } }));
                  }}
                >
                  <Tag fill={colors.surface} stroke={selected ? colors.accent : colors.border} strokeWidth={selected ? 2 : 1} cornerRadius={6} />
                  <Text text={note.text} width={NOTE_WIDTH} padding={8} fontSize={13} lineHeight={1.3} fill={colors.text} />
                </Label>
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
                  detail={deviceDetails?.get(device.id) ?? deviceDetail(doc, device.id)}
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
          {mode === "simulate" && <PacketLayer positionOf={positionOf} colors={colors} />}
        </Stage>
      )}
      <Minimap
        doc={doc}
        viewport={viewport}
        canvas={size}
        colors={colors}
        selectedId={selection?.kind === "device" ? selection.id : null}
        onNavigate={(next) => {
          store().setViewport(projectId, next);
        }}
      />
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
