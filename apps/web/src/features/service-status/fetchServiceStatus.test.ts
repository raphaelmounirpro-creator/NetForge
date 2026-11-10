import { describe, expect, it } from "vitest";
import { fetchServiceStatus, type FetchLike } from "./fetchServiceStatus";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Faux fetch répondant selon le chemin demandé. */
function fakeFetch(routes: Record<string, () => Response>): FetchLike {
  return (input) => {
    const route = routes[input];
    return route ? Promise.resolve(route()) : Promise.reject(new TypeError("Failed to fetch"));
  };
}

const HEALTH_OK = { status: "ok", service: "netforge-api", version: "0.0.0" };

describe("fetchServiceStatus", () => {
  it("signale l'API indisponible sans conclure sur la base quand le réseau échoue", async () => {
    await expect(fetchServiceStatus(fakeFetch({}))).resolves.toEqual({ api: "down", database: "unknown" });
  });

  it("considère une réponse inattendue du proxy comme une API indisponible", async () => {
    const fetchFn = fakeFetch({ "/api/health": () => new Response("<html>502</html>", { status: 502 }) });
    await expect(fetchServiceStatus(fetchFn)).resolves.toEqual({ api: "down", database: "unknown" });
  });

  it("distingue une API disponible d'une base indisponible (503)", async () => {
    const fetchFn = fakeFetch({
      "/api/health": () => jsonResponse(200, HEALTH_OK),
      "/api/health/ready": () => jsonResponse(503, { status: "not_ready", checks: { database: "down" } }),
    });
    await expect(fetchServiceStatus(fetchFn)).resolves.toEqual({ api: "up", database: "down" });
  });

  it("signale les deux services disponibles", async () => {
    const fetchFn = fakeFetch({
      "/api/health": () => jsonResponse(200, HEALTH_OK),
      "/api/health/ready": () => jsonResponse(200, { status: "ready", checks: { database: "up" } }),
    });
    await expect(fetchServiceStatus(fetchFn)).resolves.toEqual({ api: "up", database: "up" });
  });

  it("refuse un corps de vivacité non conforme au contrat", async () => {
    const fetchFn = fakeFetch({ "/api/health": () => jsonResponse(200, { status: "ok" }) });
    await expect(fetchServiceStatus(fetchFn)).resolves.toEqual({ api: "down", database: "unknown" });
  });
});
