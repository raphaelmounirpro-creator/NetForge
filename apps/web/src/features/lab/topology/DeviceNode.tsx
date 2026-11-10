import type { DeviceKind } from "@netforge/project";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import type { ThemeColors } from "./useThemeColors";

export const DEVICE_SIZE = 56;
const HALF = DEVICE_SIZE / 2;

/** Pictogrammes originaux, dessinés au trait dans la couleur du texte. */
function Glyph({ kind, color }: { kind: DeviceKind; color: string }) {
  const stroke = { stroke: color, strokeWidth: 2, lineCap: "round" as const, lineJoin: "round" as const };
  if (kind === "pc") {
    return (
      <>
        <Rect x={-15} y={-14} width={30} height={20} cornerRadius={2} {...stroke} />
        <Line points={[0, 6, 0, 12]} {...stroke} />
        <Line points={[-8, 13, 8, 13]} {...stroke} />
      </>
    );
  }
  if (kind === "switch") {
    return (
      <>
        <Rect x={-17} y={-8} width={34} height={16} cornerRadius={3} {...stroke} />
        {[-10, -3.5, 3, 9.5].map((x) => (
          <Rect key={x} x={x} y={-3} width={4} height={6} fill={color} />
        ))}
      </>
    );
  }
  // Routeur : cercle et quatre flèches (acheminement dans toutes les directions).
  return (
    <>
      <Circle radius={15} {...stroke} />
      <Line points={[-8, 0, 8, 0]} {...stroke} />
      <Line points={[0, -8, 0, 8]} {...stroke} />
      <Line points={[5, -3, 8, 0, 5, 3]} {...stroke} />
      <Line points={[-5, -3, -8, 0, -5, 3]} {...stroke} />
      <Line points={[-3, -5, 0, -8, 3, -5]} {...stroke} />
      <Line points={[-3, 5, 0, 8, 3, 5]} {...stroke} />
    </>
  );
}

interface DeviceNodeProps {
  id: string;
  kind: DeviceKind;
  name: string;
  detail: string | null;
  x: number;
  y: number;
  selected: boolean;
  linkSource: boolean;
  draggable: boolean;
  colors: ThemeColors;
  onSelect: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

export function DeviceNode(props: DeviceNodeProps) {
  const { id, kind, name, detail, x, y, selected, linkSource, draggable, colors } = props;
  const outline = selected || linkSource ? colors.accent : colors["border-strong"];
  const position = (event: KonvaEventObject<DragEvent>) => [event.target.x(), event.target.y()] as const;
  return (
    <Group
      x={x}
      y={y}
      draggable={draggable}
      onClick={() => {
        props.onSelect(id);
      }}
      onTap={() => {
        props.onSelect(id);
      }}
      onDragStart={() => {
        props.onSelect(id);
      }}
      onDragMove={(event) => {
        props.onDragMove(id, ...position(event));
      }}
      onDragEnd={(event) => {
        props.onDragEnd(id, ...position(event));
      }}
      onMouseEnter={(event) => {
        const container = event.target.getStage()?.container();
        if (container) container.style.cursor = draggable ? "grab" : "pointer";
      }}
      onMouseLeave={(event) => {
        const container = event.target.getStage()?.container();
        if (container) container.style.cursor = "";
      }}
    >
      <Rect
        x={-HALF}
        y={-HALF}
        width={DEVICE_SIZE}
        height={DEVICE_SIZE}
        cornerRadius={10}
        fill={colors.surface}
        stroke={outline}
        strokeWidth={selected || linkSource ? 2.5 : 1.5}
        dash={linkSource ? [6, 4] : []}
      />
      <Glyph kind={kind} color={colors.text} />
      <Text text={name} y={HALF + 6} width={140} x={-70} align="center" fontSize={13} fontStyle="600" fill={colors.text} />
      {detail && (
        <Text text={detail} y={HALF + 23} width={160} x={-80} align="center" fontSize={11} fontFamily="ui-monospace, Consolas, monospace" fill={colors["text-muted"]} />
      )}
    </Group>
  );
}
