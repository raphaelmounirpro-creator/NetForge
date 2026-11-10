import "reflect-metadata";
import { existsSync } from "node:fs";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { configureApp } from "./app-setup.js";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/app-config.js";

async function bootstrap(): Promise<void> {
  // Fichier .env local facultatif (Node ≥ 20.12) ; en production, variables fournies par l'hébergeur.
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
  configureApp(app);
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger("Bootstrap").log(`API NetForge prête sur http://localhost:${String(config.port)}/api`);
}

void bootstrap();
