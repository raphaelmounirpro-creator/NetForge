import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { configureApp } from "./app-setup.js";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/app-config.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let ready: Promise<Handler> | null = null;

/**
 * API NestJS pour une fonction Vercel (api/index.mjs) : construite une fois
 * par instance, réutilisée par les requêtes suivantes (Fluid compute). Même
 * configuration validée et mêmes réglages HTTP que le serveur local.
 */
export function serverlessHandler(): Promise<Handler> {
  ready ??= (async () => {
    const config = loadConfig(process.env);
    const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { bodyParser: false, logger: ["error", "warn"] });
    configureApp(app, config);
    await app.init();
    return app.getHttpAdapter().getInstance() as Handler;
  })();
  // Un échec d'initialisation (configuration invalide) n'est pas mis en cache : nouvel essai à la requête suivante.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
