import type { NfgDocument } from "@netforge/project";
import type { Context } from "konva/lib/Context";
import type { KonvaEventObject } from "konva/lib/Node";
import { Layer, Shape, Stage } from "react-konva";
import { messages } from "../../../i18n";
import type { Viewport } from "../store";
import type { ThemeColors } from "./useThemeColors";

const WIDTH = 180;
const HEIGHT = 120;
const PADDING = 60;
/** En dessous de cette largeur de canevas, la mini-carte masquerait trop la topologie. */
const MIN_CANVAS_WIDTH = 640;

interface MinimapProps {
  doc: NfgDocument;
  viewport: Viewport;
  canvas: { width: number; height: number };
  colors: ThemeColors;
  selectedId: string | null;
  onNavigate: (viewport: Viewport) => void;
}

/**
 * Mini-carte : vue d'ensemble de la topologie et de la zone affichée ; un
 * clic recentre la vue. Aide visuelle à la souris : le zoom, « Ajuster à la
 * topologie » et la liste des équipements restent les alternatives clavier.
 */
export function Minimap({ doc, viewport, canvas, colors, selectedId, onNavigate }: MinimapProps) {
  const points = [...Object.values(doc.layout.devices), ...doc.layout.annotations];
  if (points.length === 0 || canvas.width < MIN_CANVAS_WIDTH) return null;
  const view = { x: -viewport.x / viewport.scale, y: -viewport.y / viewport.scale, w: canvas.width / viewport.scale, h: canvas.height / viewport.scale };
  const minX = Math.min(view.x, ...points.map((p) => p.x)) - PADDING;
  const minY = Math.min(view.y, ...points.map((p) => p.y)) - PADDING;
  const maxX = Math.max(view.x + view.w, ...points.map((p) => p.x)) + PADDING;
  const maxY = Math.max(view.y + view.h, ...points.map((p) => p.y)) + PADDING;
  const scale = Math.min(WIDTH / (maxX - minX), HEIGHT / (maxY - minY));
  const map = (x: number, y: number) => ({ x: (x - minX) * scale, y: (y - minY) * scale });

  const draw = (context: Context) => {
    context.lineWidth = 1;
    context.strokeStyle = colors["border-strong"];
    for (const link of doc.topology.links) {
      const a = doc.layout.devices[link.endpoints[0].deviceId];
      const b = doc.layout.devices[link.endpoints[1].deviceId];
      if (!a || !b) continue;
      const from = map(a.x, a.y);
      const to = map(b.x, b.y);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    for (const [id, position] of Object.entries(doc.layout.devices)) {
      const point = map(position.x, position.y);
      context.fillStyle = id === selectedId ? colors.accent : colors.text;
      context.fillRect(point.x - 2, point.y - 2, 4, 4);
    }
    const corner = map(view.x, view.y);
    context.strokeStyle = colors.accent;
    context.lineWidth = 1.5;
    context.strokeRect(corner.x, corner.y, view.w * scale, view.h * scale);
  };

  const navigate = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const world = { x: pointer.x / scale + minX, y: pointer.y / scale + minY };
    onNavigate({ ...viewport, x: canvas.width / 2 - world.x * viewport.scale, y: canvas.height / 2 - world.y * viewport.scale });
  };

  return (
    <div
      aria-hidden="true"
      title={messages.canvas.minimap}
      className="absolute top-3 right-3 overflow-hidden rounded-md border border-border bg-surface/90 shadow-sm"
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <Stage width={WIDTH} height={HEIGHT} onClick={navigate} onTap={navigate}>
        <Layer>
          <Shape sceneFunc={draw} />
        </Layer>
      </Stage>
    </div>
  );
}
