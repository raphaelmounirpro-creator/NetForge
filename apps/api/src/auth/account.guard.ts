import { type CanActivate, createParamDecorator, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { apiError } from "../common/api-error.js";
import type { User } from "../generated/prisma/client.js";
import { SessionsService } from "./sessions.service.js";

/** Compte authentifié de la requête (posé par AccountGuard, jamais par le client). */
const accounts = new WeakMap<Request, User>();

/**
 * Exige une session valide d'un compte dont l'adresse est validée : la règle
 * est appliquée par l'API, indépendamment de l'interface.
 */
@Injectable()
export class AccountGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const active = await this.sessions.resolve(request);
    if (!active) throw apiError(HttpStatus.UNAUTHORIZED, "auth.unauthenticated");
    accounts.set(request, active.user);
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): User => {
  const user = accounts.get(context.switchToHttp().getRequest<Request>());
  if (!user) throw apiError(HttpStatus.UNAUTHORIZED, "auth.unauthenticated");
  return user;
});

/** Adresse du client telle que résolue par Express selon les proxys de confiance configurés. */
export const ClientIp = createParamDecorator((_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest<Request>().ip ?? "inconnue");
