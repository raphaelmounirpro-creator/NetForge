import type { TraceParams } from "./trace.js";

/**
 * Actions de l'utilisateur transmises au moteur. Elles sont validées à la
 * réception puis appliquées comme un événement à l'instant courant, donc à
 * une frontière d'événements bien définie.
 */
export type SimCommand =
  | {
      readonly type: "ping";
      readonly deviceId: string;
      readonly destination: string;
      /** Nombre d'échos (défaut 4, maximum 20). */
      readonly count?: number | undefined;
    }
  | {
      /** Panne injectée : coupe ou rétablit un câble existant. */
      readonly type: "set-link";
      readonly linkId: string;
      readonly up: boolean;
    }
  | {
      /** Vide une table apprise : cache ARP (PC, routeur) ou table MAC (switch). */
      readonly type: "clear-table";
      readonly deviceId: string;
      readonly table: "arp" | "mac";
    };

export const COMMAND_ERROR_CODES = [
  "command.unknown-device",
  "command.not-a-pc",
  "command.invalid-destination",
  "command.invalid-count",
  "command.unknown-link",
  "command.wrong-table",
  "command.too-many-pings",
  "command.interrupted",
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export type CommandOutcome =
  | { readonly ok: true; readonly sessionId: string | null }
  | { readonly ok: false; readonly code: CommandErrorCode; readonly params: TraceParams };
