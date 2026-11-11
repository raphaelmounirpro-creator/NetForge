import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

/**
 * PostgreSQL réel pour les tests d'intégration de l'API (atomicité des
 * jetons, sessions, limites partagées, isolation des comptes) : grappe
 * embarquée persistante dans apps/api/.local-db/test (ignorée par Git), base
 * recréée et migrée à chaque exécution. Aucun service externe.
 */
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 54_329;
const USER = "netforge_test";
const PASSWORD = "netforge_test";
const DATABASE = "netforge_test";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dataDir = join(apiRoot, ".local-db", "test");
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    authMethod: "scram-sha-256",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--no-locale"],
    // PostgreSQL 18 : sans processus io_worker, qui survivent sous Windows à l'arrêt du serveur et bloquent le démarrage suivant.
    postgresFlags: ["-c", "io_method=sync"],
    onLog: () => {},
  });
  try {
    if (!existsSync(join(dataDir, "PG_VERSION"))) await server.initialise();
    await server.start();
  } catch (error) {
    // embedded-postgres rejette parfois sans motif : on nomme la cause probable.
    throw new Error(
      `PostgreSQL de test non démarré (port ${String(PORT)}, ${dataDir}). Cause probable : un processus postgres.exe ` +
        `d'une exécution interrompue occupe encore la grappe ; arrêtez-le puis relancez.`,
      { cause: error },
    );
  }
  const client = server.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  } finally {
    await client.end();
  }
  await server.createDatabase(DATABASE);
  const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${String(PORT)}/${DATABASE}`;
  execFileSync(process.execPath, [join(apiRoot, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  project.provide("testDatabaseUrl", url);
  return async () => {
    await server.stop();
  };
}
