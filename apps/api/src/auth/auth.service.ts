import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { Account } from "@netforge/contracts";
import type { Response } from "express";
import { apiError } from "../common/api-error.js";
import { Clock } from "../common/clock.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { Prisma, type User } from "../generated/prisma/client.js";
import { MailService, MailUnavailableError } from "../mail/mail.service.js";
import type { MailKind, MailParams } from "../mail/templates.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CsrfService } from "../security/csrf.service.js";
import { RateLimitService, type RateRule } from "../security/rate-limit.service.js";
import { resendRule, RULES } from "../security/rules.js";
import { maskEmail, normalizeEmail, type NormalizedEmail } from "./email.js";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./password.js";
import { SessionsService } from "./sessions.service.js";
import { TokensService } from "./tokens.service.js";

export const toAccount = (user: User): Account => ({ id: user.id, email: user.email });

/**
 * Parcours de compte (spécification §14, OWASP). Réponses publiques
 * identiques que le compte existe ou non ; jamais de connexion automatique
 * depuis un lien ; aucune session pour une adresse non validée ; un mot de
 * passe existant n'est jamais remplacé par une nouvelle inscription.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger("Comptes");
  /** Empreinte de référence : même coût de calcul quand le compte n'existe pas (anti-énumération). */
  private readonly decoyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly mail: MailService,
    private readonly limits: RateLimitService,
    private readonly csrf: CsrfService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.decoyHash = hashPassword("netforge-empreinte-de-reference");
  }

  // ---------------------------------------------------------------- Aides

  private async limit(rule: RateRule, subject: string): Promise<void> {
    const outcome = await this.limits.consume(rule, subject);
    if (!outcome.allowed) throw apiError(HttpStatus.TOO_MANY_REQUESTS, "auth.rate-limited", { retryAfterSeconds: outcome.retryAfterSeconds });
  }

  private email(raw: string): NormalizedEmail {
    const normalized = normalizeEmail(raw);
    if (!normalized) throw apiError(HttpStatus.BAD_REQUEST, "auth.invalid-email");
    return normalized;
  }

  private policy(password: string, emailKey: string): void {
    const problem = checkPasswordPolicy(password, emailKey);
    if (problem) throw apiError(HttpStatus.BAD_REQUEST, problem);
  }

  private requireMail(): void {
    if (!this.mail.available) throw apiError(HttpStatus.SERVICE_UNAVAILABLE, "auth.mail-unavailable");
  }

  /**
   * Courrier à un compte, borné (délai minimal, plafond horaire par compte,
   * plafond global). Renvoie faux si une limite l'empêche : la réponse
   * publique reste identique, sans envoi massif.
   */
  private async mailAccount<K extends MailKind>(user: User, kind: K, params: MailParams[K]): Promise<boolean> {
    for (const [rule, subject] of [
      // Délai minimal entre deux courriers du même type (renvoi) ; plafond horaire commun à tous les types.
      [resendRule(this.config.auth.resendMinSeconds), `${user.id}:${kind}`],
      [RULES.mailAccountHour, user.id],
      [RULES.mailGlobalHour, "all"],
    ] as const) {
      if (!(await this.limits.consume(rule, subject)).allowed) return false;
    }
    try {
      await this.mail.send(kind, user.email, params);
      return true;
    } catch (error) {
      if (error instanceof MailUnavailableError) {
        this.logger.warn(`Courrier « ${kind} » non envoyé à ${maskEmail(user.email)}`);
        throw apiError(HttpStatus.SERVICE_UNAVAILABLE, "auth.mail-unavailable");
      }
      throw error;
    }
  }

  private async sendVerification(user: User): Promise<void> {
    const ttlMinutes = this.config.auth.verifyTokenTtlMinutes;
    const token = await this.tokens.issue(user, "VERIFY_EMAIL", ttlMinutes);
    await this.mailAccount(user, "verify-email", { token, ttlMinutes });
  }

  // ---------------------------------------------------------------- Inscription et validation

  async register(rawEmail: string, password: string, ip: string): Promise<void> {
    this.requireMail();
    await this.limit(RULES.registerIp, ip);
    const { email, key } = this.email(rawEmail);
    this.policy(password, key);
    // Hachage dans tous les cas : durée de traitement comparable, compte existant ou non.
    const passwordHash = await hashPassword(password);
    const existing = await this.prisma.user.findUnique({ where: { emailKey: key } });
    if (existing) {
      // Jamais de remplacement du mot de passe : on prévient le titulaire, ou on renvoie le lien en attente.
      if (existing.emailVerifiedAt) await this.mailAccount(existing, "already-registered", {});
      else await this.sendVerification(existing);
      return;
    }
    let user: User;
    try {
      user = await this.prisma.user.create({ data: { email, emailKey: key, passwordHash } });
    } catch (error) {
      // Inscription simultanée de la même adresse : la première l'emporte, même réponse publique.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
      throw error;
    }
    try {
      await this.sendVerification(user);
    } catch (error) {
      // Pas de compte fantôme sans courrier : l'inscription pourra être refaite.
      await this.prisma.user.delete({ where: { id: user.id } });
      throw error;
    }
  }

  /** Confirmation explicite : le jeton ET le mot de passe de l'inscription (contre l'activation d'un compte précréé par un tiers). */
  async verifyEmail(token: string, password: string, ip: string): Promise<void> {
    await this.limit(RULES.tokenIp, ip);
    const inspection = await this.tokens.inspect(token, "VERIFY_EMAIL");
    if (!inspection.ok) throw apiError(HttpStatus.BAD_REQUEST, inspection.code);
    const { user, tokenId } = inspection;
    await this.checkPasswordAttempt(user, password, ip, "auth.password-mismatch");
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.tokens.consume(tx, tokenId))) throw apiError(HttpStatus.BAD_REQUEST, "auth.token-consumed");
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? this.clock.now() } });
      // Les autres liens de validation encore valides deviennent inutiles.
      await tx.emailToken.updateMany({ where: { userId: user.id, purpose: "VERIFY_EMAIL", consumedAt: null }, data: { consumedAt: this.clock.now() } });
    });
  }

  /**
   * Reprise de création : la possession de l'adresse (jeton) permet de
   * choisir de nouveaux identifiants ; les anciens secrets (mot de passe,
   * jetons, sessions) sont invalidés. Le titulaire de l'adresse garde la main
   * sur un compte précréé par un tiers.
   */
  async restartVerification(token: string, password: string, ip: string): Promise<void> {
    await this.limit(RULES.tokenIp, ip);
    const inspection = await this.tokens.inspect(token, "VERIFY_EMAIL");
    if (!inspection.ok) throw apiError(HttpStatus.BAD_REQUEST, inspection.code);
    const { user, tokenId } = inspection;
    this.policy(password, user.emailKey);
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.tokens.consume(tx, tokenId))) throw apiError(HttpStatus.BAD_REQUEST, "auth.token-consumed");
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, credentialsVersion: { increment: 1 }, emailVerifiedAt: this.clock.now() },
      });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: this.clock.now() } });
    });
  }

  /** Renvoi du lien de validation : réponse publique identique, renvoi borné, aucun identifiant modifié. */
  async resendVerification(rawEmail: string, ip: string): Promise<void> {
    this.requireMail();
    await this.limit(RULES.mailRequestIp, ip);
    const normalized = normalizeEmail(rawEmail);
    if (!normalized) return;
    const user = await this.prisma.user.findUnique({ where: { emailKey: normalized.key } });
    if (user && !user.emailVerifiedAt) await this.sendVerification(user);
  }

  // ---------------------------------------------------------------- Connexion

  /** Mot de passe vérifié avec limites d'échec (par IP, par compte, par couple compte + IP). */
  private async checkPasswordAttempt(user: User | null, password: string, ip: string, failure: "auth.invalid-credentials" | "auth.password-mismatch"): Promise<void> {
    const subjects: [RateRule, string][] = [[RULES.loginFailIp, ip]];
    if (user) subjects.push([RULES.loginFailAccount, user.id], [RULES.loginFailAccountIp, `${user.id}:${ip}`]);
    for (const [rule, subject] of subjects) {
      const wait = await this.limits.blocked(rule, subject);
      if (wait > 0) throw apiError(HttpStatus.TOO_MANY_REQUESTS, "auth.rate-limited", { retryAfterSeconds: wait });
    }
    const valid = await verifyPassword(password, user?.passwordHash ?? (await this.decoyHash));
    if (valid && user) return;
    for (const [rule, subject] of subjects) await this.limits.consume(rule, subject);
    throw apiError(failure === "auth.invalid-credentials" ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_REQUEST, failure);
  }

  async login(rawEmail: string, password: string, ip: string, response: Response, previous: { revoke: () => Promise<void> }): Promise<{ account: Account; csrfToken: string }> {
    const normalized = normalizeEmail(rawEmail);
    const user = normalized ? await this.prisma.user.findUnique({ where: { emailKey: normalized.key } }) : null;
    await this.checkPasswordAttempt(user, password, ip, "auth.invalid-credentials");
    if (!user) throw apiError(HttpStatus.UNAUTHORIZED, "auth.invalid-credentials");
    // Seul qui connaît le mot de passe apprend que l'adresse n'est pas validée.
    if (!user.emailVerifiedAt) throw apiError(HttpStatus.FORBIDDEN, "auth.email-not-verified");
    // Renouvellement : une éventuelle session précédente (autre compte) est révoquée.
    await previous.revoke();
    const secret = await this.sessions.open(response, user.id);
    return { account: toAccount(user), csrfToken: this.csrf.issueForSession(secret) };
  }

  // ---------------------------------------------------------------- Récupération

  /** « Mot de passe oublié ? » : réponse générique ; une adresse non validée reçoit le lien de validation, pas de réinitialisation. */
  async forgotPassword(rawEmail: string, ip: string): Promise<void> {
    this.requireMail();
    await this.limit(RULES.mailRequestIp, ip);
    const normalized = normalizeEmail(rawEmail);
    if (!normalized) return;
    const user = await this.prisma.user.findUnique({ where: { emailKey: normalized.key } });
    if (!user) return;
    if (!user.emailVerifiedAt) {
      await this.sendVerification(user);
      return;
    }
    const ttlMinutes = this.config.auth.resetTokenTtlMinutes;
    const token = await this.tokens.issue(user, "RESET_PASSWORD", ttlMinutes);
    await this.mailAccount(user, "reset-password", { token, ttlMinutes });
  }

  /** Nouveau mot de passe : jeton consommé, anciens secrets invalidés, toutes les sessions révoquées, titulaire prévenu. */
  async resetPassword(token: string, password: string, ip: string): Promise<void> {
    await this.limit(RULES.tokenIp, ip);
    const inspection = await this.tokens.inspect(token, "RESET_PASSWORD");
    if (!inspection.ok) throw apiError(HttpStatus.BAD_REQUEST, inspection.code);
    const { user, tokenId } = inspection;
    this.policy(password, user.emailKey);
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.tokens.consume(tx, tokenId))) throw apiError(HttpStatus.BAD_REQUEST, "auth.token-consumed");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, credentialsVersion: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: this.clock.now() } });
    });
    // Notification après coup : son échec n'annule pas le changement déjà effectué (journalisé sans adresse complète).
    try {
      await this.mail.send("password-changed", user.email, {});
    } catch {
      this.logger.warn(`Notification de changement de mot de passe non envoyée à ${maskEmail(user.email)}`);
    }
  }
}
