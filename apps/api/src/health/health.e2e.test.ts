import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { healthResponseSchema, readinessResponseSchema } from "@netforge/contracts";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { configureApp } from "../app-setup.js";
import { AppModule } from "../app.module.js";
import { DatabaseProbe } from "./database-probe.js";

// Port 9 (discard) : aucune base ne répond, la connexion échoue rapidement.
const UNREACHABLE_DATABASE_URL = "postgresql://netforge:netforge@127.0.0.1:9/netforge";

let app: NestExpressApplication | undefined;

async function startApp(databaseProbe?: Pick<DatabaseProbe, "isUp">): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot({ nodeEnv: "test", port: 0, databaseUrl: UNREACHABLE_DATABASE_URL })],
  });
  if (databaseProbe) {
    builder.overrideProvider(DatabaseProbe).useValue(databaseProbe);
  }
  const moduleRef = await builder.compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/health (vivacité)", () => {
  it("répond 200 selon le contrat partagé, même sans base", async () => {
    const server = (await startApp()).getHttpServer();
    const response = await request(server).get("/api/health").expect(200);
    expect(healthResponseSchema.parse(response.body).service).toBe("netforge-api");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("GET /api/health/ready (préparation)", () => {
  it("répond 200 quand la base répond", async () => {
    const server = (await startApp({ isUp: () => Promise.resolve(true) })).getHttpServer();
    const response = await request(server).get("/api/health/ready").expect(200);
    expect(readinessResponseSchema.parse(response.body)).toEqual({ status: "ready", checks: { database: "up" } });
  });

  it("répond 503 avec un diagnostic quand PostgreSQL est injoignable (sonde réelle)", async () => {
    const server = (await startApp()).getHttpServer();
    const response = await request(server).get("/api/health/ready").expect(503);
    expect(readinessResponseSchema.parse(response.body)).toEqual({ status: "not_ready", checks: { database: "down" } });
    expect(JSON.stringify(response.body)).not.toContain("127.0.0.1");
  });
});
