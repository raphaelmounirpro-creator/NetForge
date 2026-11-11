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
  if (kind === "olt") {
    // Châssis à cartes, rangée de ports PON.
    return (
      <>
        <Rect x={-17} y={-13} width={34} height={26} cornerRadius={2} {...stroke} />
        <Line points={[-17, -4, 17, -4]} {...stroke} />
        {[-10, -3.5, 3, 9.5].map((x) => (
          <Circle key={x} x={x + 1} y={5} radius={2.2} {...stroke} />
        ))}
      </>
    );
  }
  if (kind === "ont") {
    // Boîtier d'abonné : voyants à gauche, port optique à droite.
    return (
      <>
        <Rect x={-16} y={-9} width={32} height={18} cornerRadius={4} {...stroke} />
        <Circle x={-9} y={0} radius={1.5} fill={color} />
        <Circle x={-3} y={0} radius={1.5} fill={color} />
        <Circle x={8} y={0} radius={3.5} {...stroke} />
      </>
    );
  }
  if (kind === "odf") {
    // Tiroir : étagères et connecteurs en façade.
    return (
      <>
        <Rect x={-17} y={-13} width={34} height={26} cornerRadius={2} {...stroke} />
        {[-5, 4].map((y) => (
          <Line key={y} points={[-17, y, 17, y]} {...stroke} />
        ))}
        {[-11, -5, 1, 7, 13].map((x) => (
          <Rect key={x} x={x - 1.5} y={-11} width={3} height={4} fill={color} />
        ))}
      </>
    );
  }
  if (kind === "splitter") {
    // Une entrée, quatre sorties en éventail.
    return (
      <>
        <Line points={[-16, 0, -4, 0]} {...stroke} />
        {[-12, -4, 4, 12].map((y) => (
          <Line key={y} points={[-4, 0, 16, y]} {...stroke} />
        ))}
        <Circle x={-4} y={0} radius={3} fill={color} />
      </>
    );
  }
  if (kind === "pbo") {
    // Boîte de rue : couvercle et départs vers les abonnés.
    return (
      <>
        <Rect x={-14} y={-12} width={28} height={18} cornerRadius={3} {...stroke} />
        <Line points={[-14, -6, 14, -6]} {...stroke} />
        {[-8, 0, 8].map((x) => (
          <Line key={x} points={[x, 6, x, 13]} {...stroke} />
        ))}
      </>
    );
  }
  if (kind === "pto") {
    // Prise murale : plaque et logement du connecteur.
    return (
      <>
        <Rect x={-13} y={-13} width={26} height={26} cornerRadius={4} {...stroke} />
        <Rect x={-5} y={-7} width={10} height={14} cornerRadius={2} {...stroke} />
        <Line points={[0, -3, 0, 3]} {...stroke} />
      </>
    );
  }
  if (kind === "splice-box") {
    // Manchon d'épissure : corps allongé, câbles aux extrémités.
    return (
      <>
        <Rect x={-12} y={-8} width={24} height={16} cornerRadius={8} {...stroke} />
        <Line points={[-18, 0, -12, 0]} {...stroke} />
        <Line points={[12, 0, 18, 0]} {...stroke} />
        <Line points={[-5, -3, 5, 3]} {...stroke} />
        <Line points={[-5, 3, 5, -3]} {...stroke} />
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
