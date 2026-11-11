import { z } from "zod";

/**
 * Projets privés enregistrés dans un compte. Le contenu est un document
 * .nfg.json validé côté serveur (et relu comme donnée externe par le client).
 */
export const MAX_ACCOUNT_PROJECTS = 200;

export const projectSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  revision: z.int().min(1),
  savedAt: z.iso.datetime(),
  deviceCount: z.int().min(0),
  linkCount: z.int().min(0),
});
export type ProjectSummaryDto = z.infer<typeof projectSummarySchema>;

export const projectListResponseSchema = z.strictObject({ projects: z.array(projectSummarySchema).max(MAX_ACCOUNT_PROJECTS) });
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const projectResponseSchema = z.strictObject({
  id: z.uuid(),
  revision: z.int().min(1),
  savedAt: z.iso.datetime(),
  document: z.unknown(),
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

/** Création (import volontaire d'un projet local) : l'identifiant est celui du document. */
export const createProjectRequestSchema = z.strictObject({ document: z.unknown() });
/** Enregistrement d'une nouvelle révision : refusé si la révision enregistrée a changé. */
export const updateProjectRequestSchema = z.strictObject({ document: z.unknown(), expectedRevision: z.int().min(1) });

export const saveResponseSchema = z.strictObject({ revision: z.int().min(1), savedAt: z.iso.datetime() });
export type SaveResponse = z.infer<typeof saveResponseSchema>;
