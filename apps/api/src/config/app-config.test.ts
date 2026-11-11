import { describe, expect, it } from "vitest";
import { loadConfig } from "./app-config.js";

const SECRET_URL = "postgresql://netforge:mot-de-passe-secret@localhost:5432/netforge";
const CSRF = "c".repeat(40);

describe("loadConfig", () => {
  it("applique les valeurs par défaut documentées", () => {
    expect(loadConfig({ DATABASE_URL: SECRET_URL, CSRF_SECRET: CSRF })).toEqual({
      nodeEnv: "development",
      port: 3000,
      databaseUrl: SECRET_URL,
      appOrigin: "http://localhost:5173",
      secureCookies: false,
      csrfSecret: CSRF,
      trustProxy: false,
      mail: { smtpUrl: null, from: null },
      auth: { verifyTokenTtlMinutes: 1440, resetTokenTtlMinutes: 30, resendMinSeconds: 60, sessionIdleMinutes: 60, sessionAbsoluteHours: 12 },
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

  it("exige en production une origine HTTPS et une clé CSRF, et active les cookies sécurisés", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: SECRET_URL })).toThrow(/APP_ORIGIN, CSRF_SECRET/);
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: SECRET_URL, CSRF_SECRET: CSRF, APP_ORIGIN: "http://exemple.test" })).toThrow(/HTTPS/);
    const config = loadConfig({ NODE_ENV: "production", DATABASE_URL: SECRET_URL, CSRF_SECRET: CSRF, APP_ORIGIN: "https://netforge.exemple.test/chemin" });
    expect(config.appOrigin).toBe("https://netforge.exemple.test");
    expect(config.secureCookies).toBe(true);
  });

  it("génère hors production une clé CSRF propre au processus si elle manque", () => {
    const a = loadConfig({ DATABASE_URL: SECRET_URL }).csrfSecret;
    const b = loadConfig({ DATABASE_URL: SECRET_URL }).csrfSecret;
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
  });

  it("exige l'expéditeur avec un serveur d'envoi et lit les proxys de confiance", () => {
    expect(() => loadConfig({ DATABASE_URL: SECRET_URL, SMTP_URL: "smtp://u:p@localhost:1025" })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ DATABASE_URL: SECRET_URL, TRUST_PROXY: "true" })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ DATABASE_URL: SECRET_URL, TRUST_PROXY: "1" }).trustProxy).toBe(1);
  });
});
