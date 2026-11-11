import type { NextFunction, Request, Response } from "express";

/**
 * En-têtes de toutes les réponses de l'API : aucun contenu actif, aucune
 * intégration en cadre, pas de devinette de type MIME, pas de référent
 * (les liens porteurs de jetons ne fuient pas), aucune mise en cache des
 * réponses (données privées).
 */
export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
  next();
}
