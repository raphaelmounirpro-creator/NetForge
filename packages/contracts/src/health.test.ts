import { describe, expect, it } from "vitest";
import { healthResponseSchema, readinessResponseSchema } from "./health.js";

describe("contrats de santé de l'API", () => {
  it("accepte une réponse de vivacité conforme", () => {
    const parsed = healthResponseSchema.parse({ status: "ok", service: "netforge-api", version: "0.0.0" });
    expect(parsed.status).toBe("ok");
  });

  it("refuse une réponse de préparation incohérente", () => {
    expect(readinessResponseSchema.safeParse({ status: "ready", checks: { database: "maybe" } }).success).toBe(false);
    expect(readinessResponseSchema.safeParse({ status: "ready" }).success).toBe(false);
  });
});
