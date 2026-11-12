import type { Issue } from "@netforge/project";
import { z } from "zod";
import type { CommandErrorCode } from "./commands.js";
import type { SimTime } from "./time.js";
import type { Diagnostic, TraceEntry, TraceParams } from "./trace.js";
import type { SimulationChanges, SimulationStatus } from "./views.js";

/**
 * Protocole entre l'interface et le moteur exécuté dans un Web Worker.
 *
 * - Requêtes (interface → moteur) : validées à la réception, corrélées par
 *   un identifiant croissant, traitées dans l'ordre d'arrivée, chacune
 *   suivie d'un accusé (« ack ») ou d'une erreur portant le même identifiant.
 * - Mises à jour (moteur → interface) : envoyées par lots, numérotées, avec
 *   les seules décisions et tables modifiées depuis la précédente.
 * Toute évolution incompatible incrémente PROTOCOL_VERSION.
 */
export const PROTOCOL_VERSION = 2;

/** Vitesses d'observation : temps simulé écoulé par seconde réelle. */
export const PLAYBACK_SPEEDS = [1, 10, 100] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const identifier = z.string().min(1).max(64);

export const simCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ping"),
    deviceId: identifier,
    destination: z.string().max(256),
    count: z.int().min(1).max(20).optional(),
  }),
  z.strictObject({ type: z.literal("set-link"), linkId: identifier, up: z.boolean() }),
  z.strictObject({ type: z.literal("clear-table"), deviceId: identifier, table: z.enum(["arp", "mac"]) }),
  z.strictObject({ type: z.literal("dhcp"), deviceId: identifier, action: z.enum(["renew", "release"]) }),
  z.strictObject({ type: z.literal("nslookup"), deviceId: identifier, name: z.string().max(256) }),
]);

const base = { v: z.literal(PROTOCOL_VERSION), id: z.int().min(1).max(Number.MAX_SAFE_INTEGER) };

export const simRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("load"), document: z.unknown(), seed: z.int().min(0).max(0xffffffff) }),
  z.strictObject({ ...base, type: z.literal("command"), command: simCommandSchema }),
  z.strictObject({ ...base, type: z.literal("play"), speed: z.union([z.literal(1), z.literal(10), z.literal(100)]) }),
  z.strictObject({ ...base, type: z.literal("pause") }),
  z.strictObject({ ...base, type: z.literal("step") }),
  z.strictObject({ ...base, type: z.literal("finish") }),
  z.strictObject({ ...base, type: z.literal("reset") }),
]);

export type SimRequest = z.infer<typeof simRequestSchema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Requête sans enveloppe : version et identifiant sont ajoutés par le client. */
export type SimRequestBody = DistributiveOmit<SimRequest, "v" | "id">;

export type SimMode = "paused" | "playing" | "finishing";

export type HostErrorCode =
  | "protocol.invalid-message"
  | "protocol.version"
  | "load.invalid-document"
  | "sim.not-loaded"
  | CommandErrorCode;

export interface AckMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: "ack";
  readonly id: number;
  /** Ping ou résolution nslookup créé par une commande (sinon null). */
  readonly sessionId: string | null;
}

export interface ErrorMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: "error";
  /** Requête concernée, ou null si elle était illisible. */
  readonly id: number | null;
  readonly code: HostErrorCode;
  readonly params: TraceParams;
  /** Problèmes de validation du document (chargement refusé). */
  readonly issues: readonly Issue[];
}

/** Message d'information joint à une mise à jour. */
export type UpdateNotice = "finished" | "compute-budget" | "interrupted" | null;

export interface UpdateMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: "update";
  /** Numéro croissant : une mise à jour plus ancienne qu'une autre déjà reçue est ignorée. */
  readonly seq: number;
  /** Vrai : « changes » contient l'état complet (chargement, réinitialisation). */
  readonly full: boolean;
  readonly mode: SimMode;
  readonly speed: PlaybackSpeed;
  readonly time: SimTime;
  readonly status: SimulationStatus;
  readonly diagnostic: Diagnostic | null;
  readonly processedEvents: number;
  readonly pendingEvents: number;
  readonly activity: boolean;
  readonly trace: readonly TraceEntry[];
  /** Décisions calculées mais non transmises (journal affiché limité). */
  readonly droppedTrace: number;
  readonly changes: SimulationChanges;
  /** Durée réelle du calcul de ce lot, en millisecondes (mesure de performance). */
  readonly computeMs: number;
  /** Vrai si le calcul n'a pas pu suivre la vitesse demandée pendant ce lot. */
  readonly lagging: boolean;
  readonly notice: UpdateNotice;
}

export type WorkerMessage = AckMessage | ErrorMessage | UpdateMessage;

/** Vérification de l'enveloppe des messages reçus du Worker (version et type). */
export const workerMessageEnvelopeSchema = z.looseObject({
  v: z.literal(PROTOCOL_VERSION),
  type: z.enum(["ack", "error", "update"]),
});
