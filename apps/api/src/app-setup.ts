import { LIMITS } from "@netforge/project";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { AppConfig } from "./config/app-config.js";
import { securityHeaders } from "./security/security-headers.js";

/** Préfixe commun de toutes les routes : l'interface appelle /api sur la même origine. */
export const API_PREFIX = "api";

/** Corps JSON maximal : un projet .nfg.json à sa taille d'import maximale, plus l'enveloppe. */
export const JSON_BODY_LIMIT_BYTES = LIMITS.maxImportBytes + 64 * 1024;

/** Réglages HTTP partagés par le serveur réel et les tests. */
export function configureApp(app: NestExpressApplication, config: Pick<AppConfig, "trustProxy">): void {
  app.disable("x-powered-by");
  // Adresse cliente : seulement d'après les proxys de confiance configurés (jamais un en-tête accepté aveuglément).
  app.set("trust proxy", config.trustProxy);
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT_BYTES });
  app.use(securityHeaders);
  app.setGlobalPrefix(API_PREFIX);
}
