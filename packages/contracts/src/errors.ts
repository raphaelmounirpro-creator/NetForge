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
});
export type ApiError = z.infer<typeof apiErrorSchema>;
