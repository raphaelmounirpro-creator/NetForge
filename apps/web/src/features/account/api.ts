import { apiErrorSchema, CSRF_HEADER, csrfResponseSchema, type ApiError } from "@netforge/contracts";
import type { z } from "zod";

/**
 * Client HTTP de l'API (même origine : /api). Le secret de session reste
 * dans un cookie HttpOnly que l'interface ne lit jamais ; le jeton CSRF,
 * distinct, n'est gardé qu'en mémoire (jamais dans le stockage du
 * navigateur ni dans une URL).
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(`API ${String(status)} : ${body.code}`);
    this.name = "ApiRequestError";
  }
}

let csrfToken: string | null = null;

export function rememberCsrf(token: string | null): void {
  csrfToken = token;
}

const UNAVAILABLE: ApiError = { code: "server.unavailable" };

async function readError(response: Response): Promise<ApiError> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

async function send(method: string, path: string, body: unknown, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers[CSRF_HEADER] = token;
  try {
    return await fetch(`/api${path}`, { method, headers, body: body === undefined ? null : JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
  } catch {
    // Réseau coupé ou API absente (pnpm dev:web seul).
    throw new ApiRequestError(0, UNAVAILABLE);
  }
}

async function freshCsrf(): Promise<string> {
  const response = await send("GET", "/auth/csrf", undefined, null);
  if (!response.ok) throw new ApiRequestError(response.status, await readError(response));
  const parsed = csrfResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ApiRequestError(response.status, UNAVAILABLE);
  csrfToken = parsed.data.csrfToken;
  return csrfToken;
}

/**
 * Requête validée : le corps de réponse est relu avec le contrat partagé
 * (donnée externe). Un jeton CSRF périmé est renouvelé une fois.
 */
export async function apiRequest<T extends z.ZodType>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, schema: T, body?: unknown): Promise<z.infer<T>> {
  const unsafe = method !== "GET";
  let response = await send(method, path, body, unsafe ? (csrfToken ?? (await freshCsrf())) : null);
  if (unsafe && response.status === 403) {
    const error = await readError(response.clone());
    if (error.code === "csrf.invalid") response = await send(method, path, body, await freshCsrf());
  }
  if (!response.ok) throw new ApiRequestError(response.status, await readError(response));
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ApiRequestError(response.status, UNAVAILABLE);
  const data: unknown = parsed.data;
  // Jeton CSRF renouvelé (connexion, session) : il remplace le précédent.
  if (typeof data === "object" && data !== null && "csrfToken" in data && typeof data.csrfToken === "string") csrfToken = data.csrfToken;
  return parsed.data;
}

export const errorCode = (error: unknown): ApiError["code"] => (error instanceof ApiRequestError ? error.body.code : "server.unavailable");
