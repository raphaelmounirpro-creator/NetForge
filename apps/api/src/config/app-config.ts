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
    .optional(),
  /** Serveur d'envoi : smtp://utilisateur:motdepasse@hôte:port (ou smtps://), ou les variables SMTP_HOST… ci-dessous. */
  SMTP_URL: z
    .string()
    .refine((value) => /^smtps?:\/\//.test(value), "doit être une URL smtp:// ou smtps://")
    .optional(),
  SMTP_HOST: z.string().min(1).max(253).optional(),
  /** 465 : TLS implicite ; 587 : STARTTLS (le port 25 est refusé : bloqué par les hébergeurs). */
  SMTP_PORT: z.coerce.number().int().refine((port) => port === 465 || port === 587 || port === 1025, "465, 587 (ou 1025 en local)").default(465),
  SMTP_USER: z.string().min(1).max(320).optional(),
  SMTP_PASSWORD: z.string().min(1).max(512).optional(),
  MAIL_FROM: z.string().min(3).max(200).optional(),
  VERIFY_TOKEN_TTL_MINUTES: positiveInt(24 * 60, 7 * 24 * 60),
  RESET_TOKEN_TTL_MINUTES: positiveInt(30, 24 * 60),
  RESEND_MIN_SECONDS: positiveInt(60, 3600),
  SESSION_IDLE_MINUTES: positiveInt(60, 24 * 60),
  SESSION_ABSOLUTE_HOURS: positiveInt(12, 30 * 24),
  /** Variables système de Vercel (jamais saisies à la main). */
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
});

export interface AuthTimings {
  /** Validité d'un lien de validation d'adresse. */
  verifyTokenTtlMinutes: number;
  /** Validité d'un lien de réinitialisation. */
  resetTokenTtlMinutes: number;
  /** Délai minimal entre deux envois du même type au même compte. */
  resendMinSeconds: number;
  /** Inactivité au-delà de laquelle une session expire. */
  sessionIdleMinutes: number;
  /** Durée de vie absolue d'une session, jamais prolongée. */
  sessionAbsoluteHours: number;
}

/** Serveur d'envoi : URL complète, ou hôte, port et identifiants séparés (plus simple pour un mot de passe d'application). */
export type SmtpSettings = { kind: "url"; url: string } | { kind: "host"; host: string; port: number; user: string; password: string };

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  appOrigin: string;
  /** Vrai si l'origine est en HTTPS : cookies Secure et préfixe __Host-. */
  secureCookies: boolean;
  csrfSecret: string;
  trustProxy: false | number | "loopback";
  mail: { smtp: SmtpSettings | null; from: string | null };
  auth: AuthTimings;
}

/** Origine publique : déclarée, sinon déduite des variables système de Vercel (production, prévisualisation). */
function deployedOrigin(data: z.infer<typeof envSchema>): string | undefined {
  if (data.APP_ORIGIN) return data.APP_ORIGIN;
  if (data.VERCEL_ENV === "production" && data.VERCEL_PROJECT_PRODUCTION_URL) return `https://${data.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (data.VERCEL_ENV === "preview" && data.VERCEL_URL) return `https://${data.VERCEL_URL}`;
  return undefined;
}

/**
 * Valide les variables d'environnement au démarrage.
 * Le message d'erreur nomme les variables fautives sans jamais afficher leur
 * valeur : DATABASE_URL, SMTP_URL, SMTP_PASSWORD et CSRF_SECRET sont secrets.
 * Sur Vercel (VERCEL=1), les règles de production s'appliquent toujours.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")} : ${issue.message}`).join(" ; ");
    throw new Error(`Configuration invalide (${problems}). Voir apps/api/.env.example.`);
  }
  const data = parsed.data;
  const deployed = data.NODE_ENV === "production" || data.VERCEL === "1";
  const origin = deployedOrigin(data);
  const missing: string[] = [];
  if (deployed && !origin) missing.push("APP_ORIGIN");
  if (deployed && !data.CSRF_SECRET) missing.push("CSRF_SECRET");
  if ((data.SMTP_URL || data.SMTP_HOST) && !data.MAIL_FROM) missing.push("MAIL_FROM (exigée avec un serveur d'envoi)");
  if (data.SMTP_HOST && (!data.SMTP_USER || !data.SMTP_PASSWORD)) missing.push("SMTP_USER et SMTP_PASSWORD (exigées avec SMTP_HOST)");
  if (missing.length > 0) throw new Error(`Configuration invalide (manquantes : ${missing.join(", ")}). Voir apps/api/.env.example.`);

  const appOrigin = new URL(origin ?? "http://localhost:5173").origin;
  if (deployed && !appOrigin.startsWith("https://")) {
    throw new Error("Configuration invalide (APP_ORIGIN : HTTPS obligatoire en production).");
  }
  const trust = data.TRUST_PROXY ?? (data.VERCEL === "1" ? "1" : "false");
  const smtp: SmtpSettings | null = data.SMTP_HOST
    ? { kind: "host", host: data.SMTP_HOST, port: data.SMTP_PORT, user: data.SMTP_USER ?? "", password: data.SMTP_PASSWORD ?? "" }
    : data.SMTP_URL
      ? { kind: "url", url: data.SMTP_URL }
      : null;
  return {
    nodeEnv: deployed && data.NODE_ENV !== "test" ? "production" : data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    appOrigin,
    secureCookies: appOrigin.startsWith("https://"),
    // Hors production seulement : clé aléatoire propre au processus (une seule instance locale).
    csrfSecret: data.CSRF_SECRET ?? randomBytes(32).toString("base64url"),
    // Vercel écrase X-Forwarded-For avec l'adresse du client (anti-usurpation) : un saut de confiance.
    trustProxy: trust === "false" ? false : trust === "loopback" ? "loopback" : Number(trust),
    mail: { smtp, from: data.MAIL_FROM ?? null },
    auth: {
      verifyTokenTtlMinutes: data.VERIFY_TOKEN_TTL_MINUTES,
      resetTokenTtlMinutes: data.RESET_TOKEN_TTL_MINUTES,
      resendMinSeconds: data.RESEND_MIN_SECONDS,
      sessionIdleMinutes: data.SESSION_IDLE_MINUTES,
      sessionAbsoluteHours: data.SESSION_ABSOLUTE_HOURS,
    },
  };
}
