import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { CSRF_HEADER } from "@netforge/contracts";
import type { Request, Response } from "express";
import { apiError } from "../common/api-error.js";
import { cookieNames, readCookie, setCookie } from "../common/cookies.js";
import { hmacBase64Url, randomSecret, safeEqual, sha256Hex } from "../common/security.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";

/** Durée de vie d'une pré-session (parcours de connexion, d'inscription ou de récupération). */
const PRESESSION_MAX_AGE_SECONDS = 2 * 60 * 60;

/**
 * Protection CSRF : « double soumission signée » liée à la session (OWASP).
 * Le jeton est un nonce et son HMAC calculé sur une donnée propre à la
 * session : l'empreinte du cookie de session, ou à défaut celle d'un cookie
 * de pré-session (parcours sans compte, contre la CSRF de connexion). Le
 * client le renvoie dans l'en-tête X-CSRF-Token ; il ne sert jamais
 * d'authentification. S'y ajoutent les contrôles Origin et Sec-Fetch-Site.
 */
@Injectable()
export class CsrfService {
  private readonly names: ReturnType<typeof cookieNames>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.names = cookieNames(config.secureCookies);
  }

  /** Donnée de liaison : session si présente, sinon pré-session. */
  private binding(request: Request, override?: { sessionToken?: string }): string | null {
    const session = override?.sessionToken ?? readCookie(request, this.names.session);
    if (session) return `s:${sha256Hex(session)}`;
    const presession = readCookie(request, this.names.presession);
    return presession ? `p:${sha256Hex(presession)}` : null;
  }

  private sign(binding: string): string {
    const nonce = randomSecret();
    return `${nonce}.${hmacBase64Url(this.config.csrfSecret, `${binding}.${nonce}`)}`;
  }

  /** Jeton pour la requête courante ; crée une pré-session si aucune session n'existe. */
  issue(request: Request, response: Response): string {
    const existing = this.binding(request);
    if (existing) return this.sign(existing);
    const presession = randomSecret();
    setCookie(response, this.names.presession, presession, { secure: this.config.secureCookies, maxAgeSeconds: PRESESSION_MAX_AGE_SECONDS });
    return this.sign(`p:${sha256Hex(presession)}`);
  }

  /** Jeton lié à une nouvelle session (après connexion : renouvellement). */
  issueForSession(sessionToken: string): string {
    return this.sign(`s:${sha256Hex(sessionToken)}`);
  }

  /** Vérifie une requête qui modifie l'état ; lève 403 csrf.invalid sinon. */
  verify(request: Request): void {
    const fetchSite = request.headers["sec-fetch-site"];
    if (typeof fetchSite === "string" && fetchSite !== "same-origin") throw apiError(HttpStatus.FORBIDDEN, "csrf.invalid");
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin !== this.config.appOrigin) throw apiError(HttpStatus.FORBIDDEN, "csrf.invalid");
    const token = request.headers[CSRF_HEADER];
    const binding = this.binding(request);
    if (typeof token !== "string" || !binding) throw apiError(HttpStatus.FORBIDDEN, "csrf.invalid");
    const [nonce, signature, extra] = token.split(".");
    if (!nonce || !signature || extra !== undefined) throw apiError(HttpStatus.FORBIDDEN, "csrf.invalid");
    if (!safeEqual(signature, hmacBase64Url(this.config.csrfSecret, `${binding}.${nonce}`))) throw apiError(HttpStatus.FORBIDDEN, "csrf.invalid");
  }
}
