// Fonction Vercel unique de l'API : toutes les routes /api/* y sont relayées (vercel.json).
// Le code de l'API est construit dans apps/api/dist par la commande de build (pnpm build:vercel).
import { serverlessHandler } from "../apps/api/dist/serverless.js";

export default async function handler(request, response) {
  try {
    const app = await serverlessHandler();
    app(request, response);
  } catch {
    // Configuration absente ou invalide : réponse générique, sans détail interne.
    response.statusCode = 503;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({ code: "server.unavailable" }));
  }
}
