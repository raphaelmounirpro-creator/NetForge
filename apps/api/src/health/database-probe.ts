import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Délai maximal accordé à la requête de vérification. */
const PROBE_TIMEOUT_MS = 3000;

/**
 * Résumé d'erreur journalisable : nom, code éventuel et première ligne non vide
 * du message. Jamais l'URL de connexion (mot de passe) ni la pile complète.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "erreur inconnue";
  const code = "code" in error && typeof error.code === "string" ? ` [${error.code}]` : "";
  const firstLine = error.message.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  return `${error.name}${code}${firstLine ? ` : ${firstLine}` : ""}`;
}

/** Vérifie que PostgreSQL répond à une requête triviale dans un délai borné. */
@Injectable()
export class DatabaseProbe {
  private readonly logger = new Logger(DatabaseProbe.name);

  constructor(private readonly prisma: PrismaService) {}

  async isUp(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`délai de ${String(PROBE_TIMEOUT_MS)} ms dépassé`));
      }, PROBE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return true;
    } catch (error) {
      this.logger.warn(`PostgreSQL indisponible : ${describeError(error)}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
