import { z } from "zod";

/** Jeton d'injection de la configuration validée. */
export const APP_CONFIG = Symbol("APP_CONFIG");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "doit être une URL postgresql://"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
}

/**
 * Valide les variables d'environnement au démarrage.
 * Le message d'erreur nomme les variables fautives sans jamais afficher leur
 * valeur : DATABASE_URL contient un mot de passe.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")} : ${issue.message}`).join(" ; ");
    throw new Error(`Configuration invalide (${problems}). Voir apps/api/.env.example.`);
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
  };
}
