import type { Request, Response } from "express";

/**
 * Cookies de l'API : session et pré-session (jeton CSRF des parcours sans
 * compte). En HTTPS, préfixe __Host- (Secure, Path=/, sans Domain : limité à
 * l'hôte) ; en développement local (http://localhost), mêmes attributs sans
 * Secure ni préfixe, exception documentée dans docs/securite.md.
 */
export interface CookieNames {
  readonly session: string;
  readonly presession: string;
}

export function cookieNames(secure: boolean): CookieNames {
  return secure ? { session: "__Host-nf_session", presession: "__Host-nf_pre" } : { session: "nf_session", presession: "nf_pre" };
}

/** Lecture d'un cookie de l'API (valeurs base64url : aucun décodage nécessaire). */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function setCookie(response: Response, name: string, value: string, options: { secure: boolean; maxAgeSeconds: number }): void {
  const attributes = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${String(options.maxAgeSeconds)}`];
  if (options.secure) attributes.push("Secure");
  response.append("Set-Cookie", attributes.join("; "));
}

export function clearCookie(response: Response, name: string, secure: boolean): void {
  setCookie(response, name, "", { secure, maxAgeSeconds: 0 });
}
