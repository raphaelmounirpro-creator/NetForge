import { Inject, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { Clock, minutes } from "../common/clock.js";
import { clearCookie, cookieNames, readCookie, setCookie } from "../common/cookies.js";
import { randomSecret, sha256Hex } from "../common/security.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** La dernière activité n'est enregistrée qu'une fois par minute (pas une écriture par requête). */
const ACTIVITY_RESOLUTION_MS = 60_000;

export interface ActiveSession {
  readonly sessionId: string;
  readonly user: User;
}

/**
 * Sessions opaques révocables côté serveur : le cookie HttpOnly porte un
 * secret de 256 bits, la base son empreinte. Chaque requête privée vérifie
 * révocation, échéance absolue et inactivité. Seuls les comptes dont
 * l'adresse est validée obtiennent une session.
 */
@Injectable()
export class SessionsService {
  private readonly cookie: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.cookie = cookieNames(config.secureCookies).session;
  }

  /** Ouvre une nouvelle session (identifiant renouvelé à chaque connexion) et pose le cookie. */
  async open(response: Response, userId: string): Promise<string> {
    const secret = randomSecret();
    const now = this.clock.now();
    const absoluteMs = this.config.auth.sessionAbsoluteHours * 3_600_000;
    await this.prisma.session.create({
      data: { userId, tokenHash: sha256Hex(secret), lastUsedAt: now, expiresAt: new Date(now.getTime() + absoluteMs) },
    });
    setCookie(response, this.cookie, secret, { secure: this.config.secureCookies, maxAgeSeconds: Math.floor(absoluteMs / 1000) });
    // La pré-session des parcours sans compte n'a plus d'usage.
    clearCookie(response, cookieNames(this.config.secureCookies).presession, this.config.secureCookies);
    return secret;
  }

  async resolve(request: Request): Promise<ActiveSession | null> {
    const secret = readCookie(request, this.cookie);
    if (!secret) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256Hex(secret) }, include: { user: true } });
    if (!session || session.revokedAt) return null;
    const now = this.clock.now();
    const idleLimit = now.getTime() - minutes(this.config.auth.sessionIdleMinutes);
    if (session.expiresAt <= now || session.lastUsedAt.getTime() <= idleLimit || !session.user.emailVerifiedAt) return null;
    if (now.getTime() - session.lastUsedAt.getTime() >= ACTIVITY_RESOLUTION_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    }
    return { sessionId: session.id, user: session.user };
  }

  /** Révoque en base la session portée par la requête, sans toucher au cookie (renouvellement à la connexion). */
  async revokeRequestSession(request: Request): Promise<void> {
    const secret = readCookie(request, this.cookie);
    if (secret) await this.prisma.session.updateMany({ where: { tokenHash: sha256Hex(secret), revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  /** Déconnexion : révocation côté serveur et effacement du cookie. */
  async revokeCurrent(request: Request, response: Response): Promise<void> {
    await this.revokeRequestSession(request);
    this.clear(response);
  }

  /** « Déconnecter tous mes appareils », réinitialisation du mot de passe, événement de sécurité. */
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  clear(response: Response): void {
    clearCookie(response, this.cookie, this.config.secureCookies);
  }
}
