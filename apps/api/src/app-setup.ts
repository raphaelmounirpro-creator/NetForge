import type { NestExpressApplication } from "@nestjs/platform-express";

/** Préfixe commun de toutes les routes : l'interface appelle /api sur la même origine. */
export const API_PREFIX = "api";

/** Réglages HTTP partagés par le serveur réel et les tests. */
export function configureApp(app: NestExpressApplication): void {
  app.disable("x-powered-by");
  app.setGlobalPrefix(API_PREFIX);
}
