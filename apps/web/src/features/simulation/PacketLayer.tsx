import type { TraceCode, TraceEntry } from "@netforge/engine";
import Konva from "konva";
import type { Context } from "konva/lib/Context";
import { useEffect, useRef } from "react";
import { Layer, Shape } from "react-konva";
import { messages } from "../../i18n";
import type { ThemeColors } from "../lab/topology/useThemeColors";
import { useSimulationStore, type JournalEntry } from "./store";

/**
 * Animation des trames sur le canevas, pilotée uniquement par les décisions
 * du moteur : une trame animée = une décision « eth.transmit » réellement
 * calculée ; une croix « perdu » = un abandon décidé par le moteur.
 *
 * Le rythme visuel est indépendant du temps simulé et ne ralentit jamais le
 * moteur : chaque événement occupe un « saut » visuel ; si l'affichage prend
 * du retard, les animations non commencées sont abandonnées (le journal, lui,
 * contient tout). En pause, le mouvement s'arrête ; un pas à pas anime
 * seulement les trames de ce pas. Avec « réduire les animations », les trames
 * du dernier lot sont montrées immobiles au milieu de leur câble.
 */
export const HOP_MS = 500;
const LOSS_MS = 1400;
export const MAX_BACKLOG_MS = 2500;

/** Décisions représentées par une croix « perdu » à l'endroit de l'abandon. */
const DROP_CODES: ReadonlySet<TraceCode> = new Set<TraceCode>([
  "eth.no-link",
  "eth.link-down",
  "eth.lost-in-transit",
  "arp.failed",
  "arp.queue-full",
  "ip.no-route",
  "ip.ttl-expired",
  "ip.broadcast-dropped",
  "ip.not-for-host",
  "icmp.error-suppressed",
]);

export interface Animation {
  readonly kind: "frame" | "drop";
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly start: number;
  readonly duration: number;
}

/** Protocole de plus haut niveau transporté par la trame (nom de protocole, non traduit). */
function frameLabel(entry: TraceEntry): string {
  const pdu = entry.pdu;
  if (pdu?.kind !== "ethernet") return "";
  if (pdu.payload.kind === "arp") return "ARP";
  const carried = pdu.payload.payload;
  if (carried.kind === "udp") return carried.payload.kind.toUpperCase();
  if (carried.kind === "ospf") return "OSPF";
  return "ICMP";
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface PacketLayerProps {
  positionOf: (deviceId: string) => { x: number; y: number } | undefined;
  colors: ThemeColors;
}

export function PacketLayer({ positionOf, colors }: PacketLayerProps) {
  const layerRef = useRef<Konva.Layer>(null);
  const items = useRef<Animation[]>([]);
  const clock = useRef({ now: 0, cursor: 0, runUntil: 0 });
  const lastKey = useRef(-1);
  const positions = useRef(positionOf);
  const palette = useRef(colors);
  const journal = useSimulationStore((state) => state.session?.journal);
  const mode = useSimulationStore((state) => state.session?.mode ?? "paused");
  const playing = useRef(mode !== "paused");

  useEffect(() => {
    positions.current = positionOf;
    palette.current = colors;
    playing.current = mode !== "paused";
    layerRef.current?.batchDraw();
  }, [positionOf, colors, mode]);

  // Nouvelles décisions : programmation des animations correspondantes.
  useEffect(() => {
    if (!journal) return;
    const newest = journal.at(-1)?.key ?? -1;
    if (newest < lastKey.current) {
      // Réinitialisation : le journal repart de zéro.
      items.current = [];
      lastKey.current = -1;
    }
    const fresh = journal.filter((item) => item.key > lastKey.current);
    lastKey.current = Math.max(lastKey.current, newest);
    if (fresh.length === 0) return;
    scheduleAnimations(fresh, items.current, clock.current, prefersReducedMotion());
    if (!playing.current) {
      // Pas à pas ou commande en pause : on anime ce lot, puis le mouvement s'arrête.
      clock.current.runUntil = Math.max(clock.current.runUntil, ...items.current.map((item) => item.start + item.duration));
    }
    layerRef.current?.batchDraw();
  }, [journal]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const animation = new Konva.Animation((frame) => {
      const state = clock.current;
      const running = playing.current || state.now < state.runUntil;
      if (!running || items.current.length === 0 || prefersReducedMotion()) return false;
      state.now += Math.min(frame.timeDiff, 100);
      items.current = items.current.filter((item) => item.start + item.duration > state.now);
      return true;
    }, layer);
    animation.start();
    return () => {
      animation.stop();
    };
  }, []);

  const draw = (context: Context) => {
    const reduced = prefersReducedMotion();
    const now = clock.current.now;
    const { signal, danger, canvas } = palette.current;
    context.font = "bold 10px ui-monospace, Consolas, monospace";
    context.textBaseline = "middle";
    for (const item of items.current) {
      if (!reduced && item.start > now) continue;
      const from = positions.current(item.from);
      const to = positions.current(item.to);
      if (!from || !to) continue;
      if (item.kind === "drop") {
        context.fillStyle = danger;
        context.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
        context.fillText(`✕ ${messages.simulation.animation.lost}`, from.x - 24, from.y - 42);
        context.font = "bold 10px ui-monospace, Consolas, monospace";
        continue;
      }
      const progress = reduced ? 0.5 : Math.min(1, Math.max(0, (now - item.start) / item.duration));
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.fillStyle = signal;
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = canvas;
      context.stroke();
      // Sens de la trame : flèche vers le destinataire (utile aussi sans animation).
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14);
      context.lineTo(x + Math.cos(angle + 2.5) * 9, y + Math.sin(angle + 2.5) * 9);
      context.lineTo(x + Math.cos(angle - 2.5) * 9, y + Math.sin(angle - 2.5) * 9);
      context.closePath();
      context.fill();
      context.fillStyle = signal;
      context.fillText(item.label, x + 10, y - 12);
    }
  };

  return (
    <Layer ref={layerRef} listening={false}>
      <Shape sceneFunc={draw} />
    </Layer>
  );
}

/**
 * Programme les animations d'un lot : les trames d'un même événement partent
 * ensemble, les événements successifs se suivent d'un saut visuel.
 */
export function scheduleAnimations(fresh: readonly JournalEntry[], queue: Animation[], clock: { now: number; cursor: number }, reduced: boolean): void {
  if (reduced) {
    // Sans mouvement : seules les trames du dernier lot restent affichées, immobiles.
    queue.length = 0;
  }
  // Retard trop important : on abandonne ce qui n'a pas commencé (le journal reste complet).
  if (clock.cursor - clock.now > MAX_BACKLOG_MS) {
    const started = queue.filter((item) => item.start <= clock.now);
    queue.length = 0;
    queue.push(...started);
    clock.cursor = clock.now;
  }
  let event = -1;
  let start = Math.max(clock.now, clock.cursor);
  for (const { entry } of fresh) {
    const isFrame = entry.code === "eth.transmit";
    const isDrop = DROP_CODES.has(entry.code) && entry.deviceId !== null;
    if (!isFrame && !isDrop) continue;
    if (entry.event !== event) {
      if (event !== -1) start = Math.max(clock.now, clock.cursor);
      event = entry.event;
    }
    if (isFrame) {
      const to = entry.params["toDeviceId"];
      if (entry.deviceId === null || typeof to !== "string") continue;
      queue.push({ kind: "frame", from: entry.deviceId, to, label: frameLabel(entry), start, duration: HOP_MS });
      clock.cursor = start + HOP_MS;
    } else if (entry.deviceId !== null) {
      queue.push({ kind: "drop", from: entry.deviceId, to: entry.deviceId, label: "", start, duration: LOSS_MS });
      clock.cursor = Math.max(clock.cursor, start + HOP_MS);
    }
  }
}
