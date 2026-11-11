import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { CsrfService } from "./csrf.service.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Garde globale : toute requête qui modifie l'état (POST, PUT, PATCH,
 * DELETE) doit porter un jeton CSRF valide. Aucune route GET ne modifie un
 * compte ou un projet.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!SAFE_METHODS.has(request.method)) this.csrf.verify(request);
    return true;
  }
}
