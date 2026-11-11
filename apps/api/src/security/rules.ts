import type { RateRule } from "./rate-limit.service.js";

/**
 * Seuils anti-abus (docs/securite.md). Fenêtres fixes, aucun verrouillage
 * permanent. Les limites par adresse IP sont larges pour une salle de classe
 * derrière une même adresse ; les limites par compte et par couple
 * compte + IP arrêtent la recherche de mot de passe sur un compte.
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const RULES = {
  /** Échecs de connexion (et de mot de passe à la validation). */
  loginFailIp: { name: "login-fail-ip", limit: 100, windowSeconds: 15 * MINUTE },
  loginFailAccount: { name: "login-fail-acct", limit: 50, windowSeconds: 15 * MINUTE },
  loginFailAccountIp: { name: "login-fail-acct-ip", limit: 10, windowSeconds: 15 * MINUTE },
  /** Inscriptions par adresse IP. */
  registerIp: { name: "register-ip", limit: 20, windowSeconds: HOUR },
  /** Demandes de renvoi et de récupération par adresse IP. */
  mailRequestIp: { name: "mail-request-ip", limit: 30, windowSeconds: HOUR },
  /** Courriers par compte : 5 par heure (le délai minimal entre deux envois est configurable). */
  mailAccountHour: { name: "mail-acct-hour", limit: 5, windowSeconds: HOUR },
  /** Plafond global d'envois, à ajuster au quota du fournisseur de courrier. */
  mailGlobalHour: { name: "mail-global-hour", limit: 200, windowSeconds: HOUR },
  /** Soumissions de jetons (validation, reprise, réinitialisation) par adresse IP. */
  tokenIp: { name: "token-ip", limit: 30, windowSeconds: 15 * MINUTE },
  /** Évaluations : tentatives commencées et soumissions par compte (chaque soumission exécute le moteur). */
  attemptStartAccount: { name: "attempt-start-acct", limit: 30, windowSeconds: HOUR },
  submissionAccount: { name: "submission-acct", limit: 30, windowSeconds: 15 * MINUTE },
} as const satisfies Record<string, RateRule>;

/** Délai minimal entre deux courriers du même type au même compte (fenêtre = RESEND_MIN_SECONDS). */
export const resendRule = (seconds: number): RateRule => ({ name: "mail-acct-min", limit: 1, windowSeconds: seconds });
