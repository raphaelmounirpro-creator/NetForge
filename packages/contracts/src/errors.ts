import { z } from "zod";

/**
 * Codes d'erreur stables de l'API ; le texte affiché vit dans l'interface
 * (apps/web/src/i18n). Aucune trace interne, requête SQL ou donnée d'un autre
 * compte n'est renvoyée.
 */
export const API_ERROR_CODES = [
  "request.invalid",
  "request.not-found",
  "request.too-large",
  "csrf.invalid",
  "auth.unauthenticated",
  "auth.invalid-email",
  "auth.password-too-short",
  "auth.password-too-long",
  "auth.password-weak",
  "auth.invalid-credentials",
  "auth.email-not-verified",
  "auth.password-mismatch",
  "auth.token-invalid",
  "auth.token-expired",
  "auth.token-consumed",
  "auth.rate-limited",
  "auth.mail-unavailable",
  "project.not-found",
  "project.conflict",
  "project.invalid",
  "project.too-many",
  "exercise.not-found",
  "exercise.invalid",
  "exercise.conflict",
  "exercise.too-many",
  "evaluation.not-found",
  "evaluation.not-ready",
  "evaluation.closed",
  "evaluation.no-attempts-left",
  "evaluation.already-submitted",
  "evaluation.no-more-hints",
  "evaluation.invalid-project",
  "evaluation.invalid-answer",
  "evaluation.forbidden-change",
  "evaluation.limit-exceeded",
  "evaluation.rate-limited",
  "server.unavailable",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorSchema = z.strictObject({
  code: z.enum(API_ERROR_CODES),
  /** Délai avant nouvel essai (limites anti-abus). */
  retryAfterSeconds: z.int().min(0).optional(),
  /** Révision enregistrée en cas de conflit (null : projet absent côté serveur). */
  storedRevision: z.int().min(1).nullable().optional(),
  /** Problèmes de validation d'un projet (codes du format .nfg.json). */
  issues: z.array(z.strictObject({ code: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) })).max(50).optional(),
  /** Exercice invalide : chemins des champs refusés. */
  paths: z.array(z.string()).max(50).optional(),
  /** Évaluation : limite atteinte (diagnostic, aucune note). */
  limit: z.enum(["devices", "links", "checks", "events", "pending-events", "time"]).optional(),
  max: z.int().min(0).optional(),
  /** Étape concernée (null : soumission entière). */
  step: z.int().min(0).nullable().optional(),
  /** Évaluation : modifications du projet hors des fonctions autorisées. */
  changes: z.array(z.enum(["topology", "addressing", "routes", "optics", "vlans", "faults"])).max(6).optional(),
  /** Publication impossible : raison. */
  reason: z.enum(["no-graded-points", "too-many-checks"]).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
