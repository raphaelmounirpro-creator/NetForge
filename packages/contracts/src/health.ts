import { z } from "zod";

/**
 * Vivacité : le processus API répond. N'indique rien sur PostgreSQL.
 * GET /api/health → 200
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("netforge-api"),
  version: z.string().min(1),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Préparation : l'API peut servir des requêtes dépendant de la base.
 * GET /api/health/ready → 200 si prête, 503 sinon (même schéma de corps).
 */
export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({
    database: z.enum(["up", "down"]),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
