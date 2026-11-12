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
      /** Adresse IPv4, ou nom d'hôte résolu d'abord par le serveur DNS du poste. */
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
    }
  | {
      /** Client DHCP d'un PC : renouveler le bail (ou en obtenir un) ou le libérer. */
      readonly type: "dhcp";
      readonly deviceId: string;
      readonly action: "renew" | "release";
    }
  | {
      /** Résolution d'un nom par le serveur DNS d'un PC (nslookup). */
      readonly type: "nslookup";
      readonly deviceId: string;
      readonly name: string;
    };

export const COMMAND_ERROR_CODES = [
  "command.unknown-device",
  "command.not-a-pc",
  "command.invalid-destination",
  "command.invalid-count",
  "command.unknown-link",
  "command.wrong-table",
  "command.not-dhcp-client",
  "command.invalid-name",
  "command.too-many-pings",
  "command.too-many-lookups",
  "command.interrupted",
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export type CommandOutcome =
  | { readonly ok: true; readonly sessionId: string | null }
  | { readonly ok: false; readonly code: CommandErrorCode; readonly params: TraceParams };
