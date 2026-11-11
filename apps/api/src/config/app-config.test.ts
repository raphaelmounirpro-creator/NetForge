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
      mail: { smtp: null, from: null },
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

  it("déduit l'origine et les proxys de confiance sur Vercel, avec les règles de production", () => {
    const vercel = { VERCEL: "1", DATABASE_URL: SECRET_URL, CSRF_SECRET: CSRF };
    const production = loadConfig({ ...vercel, VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "netforge.exemple.test" });
    expect([production.appOrigin, production.secureCookies, production.trustProxy, production.nodeEnv]).toEqual(["https://netforge.exemple.test", true, 1, "production"]);
    const preview = loadConfig({ ...vercel, VERCEL_ENV: "preview", VERCEL_URL: "netforge-abc123.vercel.app" });
    expect(preview.appOrigin).toBe("https://netforge-abc123.vercel.app");
    expect(() => loadConfig({ VERCEL: "1", DATABASE_URL: SECRET_URL, VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" })).toThrow(/CSRF_SECRET/);
  });

  it("accepte un serveur d'envoi en variables séparées (identifiants complets exigés)", () => {
    const config = loadConfig({ DATABASE_URL: SECRET_URL, SMTP_HOST: "smtp.exemple.test", SMTP_USER: "envoi@exemple.test", SMTP_PASSWORD: "secret-applicatif", MAIL_FROM: "NetForge <envoi@exemple.test>" });
    expect(config.mail.smtp).toEqual({ kind: "host", host: "smtp.exemple.test", port: 465, user: "envoi@exemple.test", password: "secret-applicatif" });
    expect(() => loadConfig({ DATABASE_URL: SECRET_URL, SMTP_HOST: "smtp.exemple.test", MAIL_FROM: "x@y.z" })).toThrow(/SMTP_USER/);
    expect(() => loadConfig({ DATABASE_URL: SECRET_URL, SMTP_HOST: "smtp.exemple.test", SMTP_PORT: "25", SMTP_USER: "a", SMTP_PASSWORD: "b", MAIL_FROM: "x@y.z" })).toThrow(/SMTP_PORT/);
  });

  it("exige l'expéditeur avec un serveur d'envoi et lit les proxys de confiance", () => {
    expect(() => loadConfig({ DATABASE_URL: SECRET_URL, SMTP_URL: "smtp://u:p@localhost:1025" })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ DATABASE_URL: SECRET_URL, TRUST_PROXY: "true" })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ DATABASE_URL: SECRET_URL, TRUST_PROXY: "1" }).trustProxy).toBe(1);
  });
});
