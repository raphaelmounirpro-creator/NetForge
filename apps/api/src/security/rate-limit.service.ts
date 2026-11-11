import { Injectable } from "@nestjs/common";
import { Clock } from "../common/clock.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface RateRule {
  /** Nom de la règle (préfixe de la clé). */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * Limites anti-abus partagées : compteurs à fenêtre fixe dans PostgreSQL,
 * incrémentés atomiquement (INSERT … ON CONFLICT … RETURNING), donc communs à
 * toutes les instances de l'API. Une fenêtre expirée repart à 1 : aucun
 * verrouillage permanent. L'horloge de l'application fait foi (tests).
 */
@Injectable()
export class RateLimitService {
  private hits = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private key(rule: RateRule, subject: string): string {
    return `${rule.name}:${subject}`.slice(0, 200);
  }

  /** Compte une occurrence ; renvoie le délai d'attente si la limite est dépassée. */
  async consume(rule: RateRule, subject: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = this.clock.now();
    const expires = new Date(now.getTime() + rule.windowSeconds * 1000);
    const rows = await this.prisma.$queryRaw<{ count: number; expires_at: Date }[]>`
      INSERT INTO rate_limits (key, count, expires_at) VALUES (${this.key(rule, subject)}, 1, ${expires})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.expires_at <= ${now} THEN 1 ELSE rate_limits.count + 1 END,
        expires_at = CASE WHEN rate_limits.expires_at <= ${now} THEN ${expires} ELSE rate_limits.expires_at END
      RETURNING count, expires_at`;
    await this.maybeCleanup(now);
    const row = rows[0];
    if (!row || row.count <= rule.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((row.expires_at.getTime() - now.getTime()) / 1000)) };
  }

  /** Limite déjà atteinte (sans compter de nouvelle occurrence) : sert aux échecs de connexion. */
  async blocked(rule: RateRule, subject: string): Promise<number> {
    const now = this.clock.now();
    const row = await this.prisma.rateLimit.findUnique({ where: { key: this.key(rule, subject) } });
    if (!row || row.expiresAt <= now || row.count < rule.limit) return 0;
    return Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000));
  }

  /** Nettoyage borné des compteurs expirés (une fois toutes les 100 occurrences). */
  private async maybeCleanup(now: Date): Promise<void> {
    this.hits += 1;
    if (this.hits % 100 !== 0) return;
    await this.prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  }
}
