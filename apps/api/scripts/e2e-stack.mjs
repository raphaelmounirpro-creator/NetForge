// Pile complète isolée pour les parcours navigateur des comptes (pnpm test:e2e:accounts) :
// PostgreSQL embarqué (54330, données dans apps/api/.local-db/e2e, base recréée et migrée),
// boîte de courrier (SMTP 1026, lecture 8026) et API construite (3100). Aucun service externe.

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { startMailCapture } from "./local-mail.mjs";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_PORTS = { postgres: 54_330, smtp: 1026, mail: 8026, api: 3100, web: 4174 };
const USER = "netforge_e2e";
const PASSWORD = "netforge_e2e";
const DATABASE = "netforge_e2e";

async function waitForApi(url, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`L'API de test s'est arrêtée (code ${String(child.exitCode)}).`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // pas encore prête
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("L'API de test n'est pas prête après 20 secondes.");
}

/** Démarre la pile ; renvoie une fonction d'arrêt propre (API, courrier, PostgreSQL). */
export async function startE2eStack() {
  if (!existsSync(join(apiRoot, "dist", "main.js"))) throw new Error("API non construite : pnpm build:packages puis pnpm --filter @netforge/api build.");
  const dataDir = join(apiRoot, ".local-db", "e2e");
  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: E2E_PORTS.postgres,
    authMethod: "scram-sha-256",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--no-locale"],
    postgresFlags: ["-c", "io_method=sync"],
    onLog: () => {},
  });
  if (!existsSync(join(dataDir, "PG_VERSION"))) await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  } finally {
    await client.end();
  }
  await postgres.createDatabase(DATABASE);
  const databaseUrl = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${String(E2E_PORTS.postgres)}/${DATABASE}`;
  execFileSync(process.execPath, [join(apiRoot, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });

  const stopMail = await startMailCapture({ smtpPort: E2E_PORTS.smtp, httpPort: E2E_PORTS.mail, log: () => {} });
  const api = spawn(process.execPath, [join(apiRoot, "dist", "main.js")], {
    cwd: join(apiRoot, "dist"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(E2E_PORTS.api),
      DATABASE_URL: databaseUrl,
      APP_ORIGIN: `http://localhost:${String(E2E_PORTS.web)}`,
      CSRF_SECRET: "e2e-".repeat(12),
      SMTP_URL: `smtp://localhost:${String(E2E_PORTS.smtp)}`,
      MAIL_FROM: "NetForge (essais) <netforge@localhost>",
      TRUST_PROXY: "loopback",
    },
    stdio: "ignore",
  });
  await waitForApi(`http://localhost:${String(E2E_PORTS.api)}/api/health/ready`, api);
  return async () => {
    api.kill();
    await stopMail();
    await postgres.stop();
  };
}
