import { Injectable } from "@nestjs/common";
import type { ApiErrorCode } from "@netforge/contracts";
import { Clock, minutes } from "../common/clock.js";
import { randomSecret, sha256Hex } from "../common/security.js";
import type { TokenPurpose, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

type TransactionClient = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

export type TokenInspection = { ok: true; tokenId: string; user: User } | { ok: false; code: ApiErrorCode };

/**
 * Jetons d'e-mail : 32 octets aléatoires, seule l'empreinte SHA-256 est
 * stockée, avec propriétaire, finalité, expiration, version des identifiants
 * et état de consommation. La consommation est un UPDATE conditionnel :
 * deux demandes simultanées ne peuvent pas réussir toutes les deux.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async issue(user: Pick<User, "id" | "credentialsVersion">, purpose: TokenPurpose, ttlMinutes: number): Promise<string> {
    const secret = randomSecret();
    await this.prisma.emailToken.create({
      data: {
        userId: user.id,
        purpose,
        tokenHash: sha256Hex(secret),
        credentialsVersion: user.credentialsVersion,
        expiresAt: new Date(this.clock.now().getTime() + minutes(ttlMinutes)),
      },
    });
    return secret;
  }

  /** État d'un jeton présenté, sans le consommer (aucune donnée de compte n'est renvoyée au client). */
  async inspect(secret: string, purpose: TokenPurpose): Promise<TokenInspection> {
    const token = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256Hex(secret) }, include: { user: true } });
    // Finalité vérifiée : un jeton de validation ne réinitialise pas un mot de passe, et inversement.
    if (!token || token.purpose !== purpose) return { ok: false, code: "auth.token-invalid" };
    if (token.consumedAt) return { ok: false, code: "auth.token-consumed" };
    if (token.expiresAt <= this.clock.now()) return { ok: false, code: "auth.token-expired" };
    if (token.credentialsVersion !== token.user.credentialsVersion) return { ok: false, code: "auth.token-invalid" };
    return { ok: true, tokenId: token.id, user: token.user };
  }

  /** Consommation atomique, dans la transaction de l'opération qu'elle autorise. */
  async consume(tx: TransactionClient, tokenId: string): Promise<boolean> {
    const now = this.clock.now();
    const result = await tx.emailToken.updateMany({ where: { id: tokenId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    return result.count === 1;
  }
}
