import { randomBytes } from "node:crypto";
import { z } from "zod";

/** Jeton d'injection de la configuration validée. */
export const APP_CONFIG = Symbol("APP_CONFIG");

const positiveInt = (fallback: number, max: number) => z.coerce.number().int().min(1).max(max).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "doit être une URL postgresql://"),
  /** Origine publique de l'application : liens des e-mails et contrôle de l'en-tête Origin. */
  APP_ORIGIN: z.url().optional(),
  /** Clé HMAC des jetons CSRF (32 caractères au moins). */
  CSRF_SECRET: z.string().min(32, "32 caractères au moins").optional(),
  /** Proxys de confiance pour l'adresse cliente : « false » (aucun), nombre de sauts, ou « loopback ». */
  TRUST_PROXY: z
    .string()
    .regex(/^(false|loopback|[1-9])$/, "« false », « loopback » ou un nombre de sauts de 1 à 9")
    .default("false"),
  /** Serveur d'envoi : smtp://utilisateur:motdepasse@hôte:port (ou smtps://). Absent : courrier indisponible. */
  SMTP_URL: z
    .string()
    .refine((value) => /^smtps?:\/\//.test(value), "doit être une URL smtp:// ou smtps://")
    .optional(),
  MAIL_FROM: z.string().min(3).max(200).optional(),
  VERIFY_TOKEN_TTL_MINUTES: positiveInt(24 * 60, 7 * 24 * 60),
  RESET_TOKEN_TTL_MINUTES: positiveInt(30, 24 * 60),
  RESEND_MIN_SECONDS: positiveInt(60, 3600),
  SESSION_IDLE_MINUTES: positiveInt(60, 24 * 60),
  SESSION_ABSOLUTE_HOURS: positiveInt(12, 30 * 24),
});

export interface AuthTimings {
  /** Validité d'un lien de validation d'adresse. */
  verifyTokenTtlMinutes: number;
  /** Validité d'un lien de réinitialisation. */
  resetTokenTtlMinutes: number;
  /** Délai minimal entre deux envois au même compte. */
  resendMinSeconds: number;
  /** Inactivité au-delà de laquelle une session expire. */
  sessionIdleMinutes: number;
  /** Durée de vie absolue d'une session, jamais prolongée. */
  sessionAbsoluteHours: number;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  appOrigin: string;
  /** Vrai si l'origine est en HTTPS : cookies Secure et préfixe __Host-. */
  secureCookies: boolean;
  csrfSecret: string;
  trustProxy: false | number | "loopback";
  mail: { smtpUrl: string | null; from: string | null };
  auth: AuthTimings;
}

/**
 * Valide les variables d'environnement au démarrage.
 * Le message d'erreur nomme les variables fautives sans jamais afficher leur
 * valeur : DATABASE_URL, SMTP_URL et CSRF_SECRET contiennent des secrets.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")} : ${issue.message}`).join(" ; ");
    throw new Error(`Configuration invalide (${problems}). Voir apps/api/.env.example.`);
  }
  const data = parsed.data;
  const production = data.NODE_ENV === "production";
  const missing: string[] = [];
  if (production && !data.APP_ORIGIN) missing.push("APP_ORIGIN");
  if (production && !data.CSRF_SECRET) missing.push("CSRF_SECRET");
  if (data.SMTP_URL && !data.MAIL_FROM) missing.push("MAIL_FROM (exigée avec SMTP_URL)");
  if (missing.length > 0) throw new Error(`Configuration invalide (manquantes : ${missing.join(", ")}). Voir apps/api/.env.example.`);

  const appOrigin = new URL(data.APP_ORIGIN ?? "http://localhost:5173").origin;
  if (production && !appOrigin.startsWith("https://")) {
    throw new Error("Configuration invalide (APP_ORIGIN : HTTPS obligatoire en production).");
  }
  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    appOrigin,
    secureCookies: appOrigin.startsWith("https://"),
    // Hors production seulement : clé aléatoire propre au processus (une seule instance locale).
    csrfSecret: data.CSRF_SECRET ?? randomBytes(32).toString("base64url"),
    trustProxy: data.TRUST_PROXY === "false" ? false : data.TRUST_PROXY === "loopback" ? "loopback" : Number(data.TRUST_PROXY),
    mail: { smtpUrl: data.SMTP_URL ?? null, from: data.MAIL_FROM ?? null },
    auth: {
      verifyTokenTtlMinutes: data.VERIFY_TOKEN_TTL_MINUTES,
      resetTokenTtlMinutes: data.RESET_TOKEN_TTL_MINUTES,
      resendMinSeconds: data.RESEND_MIN_SECONDS,
      sessionIdleMinutes: data.SESSION_IDLE_MINUTES,
      sessionAbsoluteHours: data.SESSION_ABSOLUTE_HOURS,
    },
  };
}
