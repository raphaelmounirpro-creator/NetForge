import { z } from "zod";

/**
 * Contrats des parcours de compte (phase 5). Les règles métier (politique de
 * mot de passe, comparaison des adresses) sont appliquées par l'API ; ces
 * schémas bornent seulement la forme et la taille des données reçues.
 */

/** Longueur maximale d'une adresse e-mail (RFC 5321 : chemin de 256 octets, adresse utile de 254). */
export const EMAIL_MAX_LENGTH = 254;
/**
 * Politique de mot de passe (docs/securite.md, D-050) : longueur seule, aucune règle de
 * composition. 12 caractères acceptés (choix du propriétaire), 15 ou plus recommandés.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_RECOMMENDED_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
/** Secret de 32 octets encodé en base64url (43 caractères). */
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const email = z.string().max(EMAIL_MAX_LENGTH * 4);
/** Taille bornée avant traitement ; la politique (12 à 128 caractères) est vérifiée par l'API. */
const password = z.string().max(PASSWORD_MAX_LENGTH * 8);

export const credentialsRequestSchema = z.strictObject({ email, password });
export type CredentialsRequest = z.infer<typeof credentialsRequestSchema>;

export const emailRequestSchema = z.strictObject({ email });
export type EmailRequest = z.infer<typeof emailRequestSchema>;

/** Confirmation d'adresse (mot de passe de l'inscription) ou reprise avec de nouveaux identifiants. */
export const tokenPasswordRequestSchema = z.strictObject({ token: tokenSchema, password });
export type TokenPasswordRequest = z.infer<typeof tokenPasswordRequestSchema>;

export const accountSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
});
export type Account = z.infer<typeof accountSchema>;

/** Jeton CSRF lié à la session (ou à la pré-session) : à renvoyer dans l'en-tête X-CSRF-Token. */
export const csrfResponseSchema = z.strictObject({ csrfToken: z.string().min(1) });
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;

/** Réponse de connexion : compte et jeton CSRF renouvelé. */
export const sessionResponseSchema = z.strictObject({ account: accountSchema, csrfToken: z.string().min(1) });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** État de la session (GET /api/auth/session) : compte connecté ou null, et jeton CSRF de la session ou de la pré-session. */
export const sessionStateSchema = z.strictObject({ account: accountSchema.nullable(), csrfToken: z.string().min(1) });
export type SessionState = z.infer<typeof sessionStateSchema>;

/** Réponse publique identique, que le compte existe ou non (anti-énumération). */
export const acceptedResponseSchema = z.strictObject({ status: z.literal("accepted") });
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;

export const doneResponseSchema = z.strictObject({ status: z.literal("done") });
export type DoneResponse = z.infer<typeof doneResponseSchema>;

export const CSRF_HEADER = "x-csrf-token";
