import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ApiError, ApiErrorCode } from "@netforge/contracts";
import type { Response } from "express";
import type { z } from "zod";

/** Erreur métier : un statut HTTP et un code stable, sans texte (l'interface le rédige). */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, body: ApiError) {
    super(body, status);
  }
}

export const apiError = (status: HttpStatus, code: ApiErrorCode, extra: Omit<ApiError, "code"> = {}): ApiException =>
  new ApiException(status, { code, ...extra });

/** Valide un corps de requête ; toute donnée non conforme est refusée sans détail interne. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw apiError(HttpStatus.BAD_REQUEST, "request.invalid");
  return parsed.data;
}

/**
 * Filtre global : renvoie le code stable d'une ApiException, traduit les
 * erreurs du lecteur de corps (taille, JSON) et masque toute autre erreur
 * (ni trace, ni requête SQL, ni message interne côté client).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("API");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader("Cache-Control", "no-store");
    if (exception instanceof ApiException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    const status: number = exception instanceof HttpException ? exception.getStatus() : readStatus(exception);
    if (status === 413) {
      response.status(status).json({ code: "request.too-large" } satisfies ApiError);
      return;
    }
    if (status >= 400 && status < 500) {
      const notFound = status === 404;
      response.status(notFound ? status : HttpStatus.BAD_REQUEST).json({ code: notFound ? "request.not-found" : "request.invalid" } satisfies ApiError);
      return;
    }
    // Erreur inattendue : journalisée côté serveur (nom seulement, sans données de requête), réponse générique.
    this.logger.error(`Erreur interne : ${exception instanceof Error ? exception.name : typeof exception}`);
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({ code: "server.unavailable" } satisfies ApiError);
  }
}

/** Erreurs du lecteur de corps Express (body-parser) : statut porté par l'objet. */
function readStatus(exception: unknown): number {
  if (typeof exception === "object" && exception !== null && "status" in exception && typeof exception.status === "number") return exception.status;
  return HttpStatus.INTERNAL_SERVER_ERROR;
}
