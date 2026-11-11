// PostgreSQL local sans Docker ni droits administrateur (pnpm db:local).
//
// Lance un vrai serveur PostgreSQL à partir des binaires fournis par le paquet
// npm « embedded-postgres ». Les identifiants, le port et le nom de la base
// sont lus dans DATABASE_URL (apps/api/.env) pour rester alignés avec l'API.
// Données conservées dans apps/api/.local-db/ (ignoré par Git).
// Réservé au développement : ne jamais utiliser ces identifiants en production.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiRoot, "..", "..");

// Les binaires PostgreSQL Windows ne gèrent pas les chemins de plus de 260
// caractères ; les fichiers embarqués ajoutent environ 170 caractères au
// chemin du dépôt (constaté le 2026-11-10 : échec « plpgsql is not available »).
const MAX_SAFE_WINDOWS_ROOT_LENGTH = 80;
const pathTooLong = process.platform === "win32" && repoRoot.length > MAX_SAFE_WINDOWS_ROOT_LENGTH;
if (pathTooLong) {
  console.warn(
    `Attention : chemin du dépôt long (${String(repoRoot.length)} caractères). Sous Windows, PostgreSQL embarqué ` +
      `peut échouer au-delà de ${String(MAX_SAFE_WINDOWS_ROOT_LENGTH)} : clonez dans un chemin court (ex. C:\\dev\\NetForge).`,
  );
}
const envFile = join(apiRoot, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error("DATABASE_URL absente : copiez apps/api/.env.example vers apps/api/.env.");
  process.exit(1);
}

const url = new URL(rawUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error(`DATABASE_URL vise l'hôte « ${url.hostname} » : pnpm db:local ne gère qu'une base locale.`);
  process.exit(1);
}

const settings = {
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, ""),
};
const dataDir = join(apiRoot, ".local-db", "data");

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: settings.user,
  password: settings.password,
  port: settings.port,
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--no-locale"],
  // PostgreSQL 18 : sans processus io_worker, qui survivent sous Windows à l'arrêt du serveur (constaté le 2026-11-11).
  postgresFlags: ["-c", "io_method=sync"],
  onLog: () => {},
  onError: (message) => console.error(String(message).trim()),
});

async function ensureDatabase() {
  const client = server.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [settings.database]);
    if (result.rowCount === 0) {
      await server.createDatabase(settings.database);
      console.log(`Base « ${settings.database} » créée.`);
    }
  } finally {
    await client.end();
  }
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nArrêt de PostgreSQL local…");
  await server.stop();
  process.exit(0);
}

try {
  if (!existsSync(join(dataDir, "PG_VERSION"))) {
    console.log("Initialisation du cluster PostgreSQL local…");
    await server.initialise();
  }
  await server.start();
  await ensureDatabase();
  console.log(`PostgreSQL local prêt sur le port ${String(settings.port)} (base « ${settings.database} »). Ctrl+C pour arrêter.`);
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
} catch (error) {
  console.error(`Échec du démarrage de PostgreSQL local : ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    pathTooLong
      ? "Cause probable : chemin du dépôt trop long pour PostgreSQL sous Windows (voir l'avertissement ci-dessus)."
      : `Si le port ${String(settings.port)} est occupé, changez-le dans DATABASE_URL (apps/api/.env).`,
  );
  await server.stop().catch(() => {});
  process.exit(1);
}
