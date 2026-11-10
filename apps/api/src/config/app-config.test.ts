import { describe, expect, it } from "vitest";
import { loadConfig } from "./app-config.js";

const SECRET_URL = "postgresql://netforge:mot-de-passe-secret@localhost:5432/netforge";

describe("loadConfig", () => {
  it("applique les valeurs par défaut documentées", () => {
    expect(loadConfig({ DATABASE_URL: SECRET_URL })).toEqual({
      nodeEnv: "development",
      port: 3000,
      databaseUrl: SECRET_URL,
    });
  });

  it("refuse une configuration sans DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("n'affiche jamais la valeur d'une variable invalide", () => {
    const invalid = { DATABASE_URL: "mysql://netforge:mot-de-passe-secret@localhost/db", PORT: "99999" };
    expect(() => loadConfig(invalid)).toThrow(/PORT/);
    try {
      loadConfig(invalid);
    } catch (error) {
      expect(String(error)).not.toContain("mot-de-passe-secret");
    }
  });
});
