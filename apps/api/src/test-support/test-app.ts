import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { CSRF_HEADER } from "@netforge/contracts";
import request from "supertest";
import { inject } from "vitest";
import { configureApp } from "../app-setup.js";
import { AppModule } from "../app.module.js";
import { Clock, FakeClock } from "../common/clock.js";
import { type AppConfig, loadConfig } from "../config/app-config.js";
import { MailTransport, MailUnavailableError, type OutgoingMail } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Boîte d'envoi des tests : capture les courriers, peut simuler une panne. */
export class FakeMailTransport extends MailTransport {
  readonly outbox: OutgoingMail[] = [];
  available = true;
  failing = false;

  send(mail: OutgoingMail): Promise<void> {
    if (this.failing) return Promise.reject(new MailUnavailableError());
    this.outbox.push(mail);
    return Promise.resolve();
  }

  /** Jeton contenu dans le dernier courrier adressé à ce destinataire (fragment #t=…). */
  lastToken(to: string): string {
    const mail = [...this.outbox].reverse().find((item) => item.to.toLowerCase() === to.toLowerCase());
    const token = mail ? /#t=([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1] : undefined;
    if (!token) throw new Error(`aucun jeton envoyé à ${to}`);
    return token;
  }
}

export const APP_ORIGIN = "http://localhost:5173";

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly config: AppConfig;
  readonly clock: FakeClock;
  readonly mail: FakeMailTransport;
  readonly prisma: PrismaService;
  close(): Promise<void>;
}

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ NODE_ENV: "test", DATABASE_URL: inject("testDatabaseUrl"), CSRF_SECRET: "s".repeat(48), APP_ORIGIN, ...env });
}

/** Application complète sur la base de test, horloge et courrier remplacés ; tables vidées. */
export async function startTestApp(env: Record<string, string> = {}, options: { reset?: boolean } = {}): Promise<TestApp> {
  const config = testConfig(env);
  const clock = new FakeClock(new Date());
  const mail = new FakeMailTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(MailTransport)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, bodyParser: false });
  configureApp(app, config);
  await app.init();
  const prisma = app.get(PrismaService);
  if (options.reset ?? true) await prisma.$executeRawUnsafe("TRUNCATE users, rate_limits CASCADE");
  return { app, config, clock, mail, prisma, close: () => app.close() };
}

/**
 * Navigateur simulé : conserve les cookies (session, pré-session) et joint
 * le jeton CSRF aux requêtes qui modifient l'état, comme l'interface.
 */
export class Browser {
  readonly agent: ReturnType<typeof request.agent>;
  csrf = "";

  constructor(test: TestApp) {
    this.agent = request.agent(test.app.getHttpServer());
  }

  async refreshCsrf(): Promise<void> {
    const response = await this.agent.get("/api/auth/csrf").expect(200);
    this.csrf = (response.body as { csrfToken: string }).csrfToken;
  }

  async post(path: string, body: object = {}): Promise<request.Response> {
    if (!this.csrf) await this.refreshCsrf();
    const response = await this.agent.post(path).set(CSRF_HEADER, this.csrf).set("Origin", APP_ORIGIN).send(body);
    // Comme l'interface : le jeton CSRF renouvelé à la connexion remplace celui de la pré-session.
    const renewed = (response.body as { csrfToken?: unknown }).csrfToken;
    if (typeof renewed === "string") this.csrf = renewed;
    return response;
  }

  async put(path: string, body: object): Promise<request.Response> {
    if (!this.csrf) await this.refreshCsrf();
    return this.agent.put(path).set(CSRF_HEADER, this.csrf).set("Origin", APP_ORIGIN).send(body);
  }

  async delete(path: string): Promise<request.Response> {
    if (!this.csrf) await this.refreshCsrf();
    return this.agent.delete(path).set(CSRF_HEADER, this.csrf).set("Origin", APP_ORIGIN);
  }

  get(path: string): Promise<request.Response> {
    return this.agent.get(path).then((response) => response);
  }
}

export const PASSWORD = "une phrase de passe assez longue";
export const OTHER_PASSWORD = "une autre phrase de passe solide";

/** Compte validé et connecté (parcours complet par l'API). */
export async function signedIn(test: TestApp, email: string, password = PASSWORD): Promise<Browser> {
  const browser = new Browser(test);
  expectStatus(await browser.post("/api/auth/register", { email, password }), 202);
  expectStatus(await browser.post("/api/auth/verify-email", { token: test.mail.lastToken(email), password }), 200);
  const login = await browser.post("/api/auth/login", { email, password });
  expectStatus(login, 200);
  browser.csrf = (login.body as { csrfToken: string }).csrfToken;
  return browser;
}

export function expectStatus(response: request.Response, status: number): void {
  if (response.status !== status) throw new Error(`statut ${String(response.status)} au lieu de ${String(status)} : ${JSON.stringify(response.body)}`);
}
