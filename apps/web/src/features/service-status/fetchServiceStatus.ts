import { healthResponseSchema, readinessResponseSchema } from "@netforge/contracts";

export type ApiState = "up" | "down";
export type DatabaseState = "up" | "down" | "unknown";

export interface ServiceStatus {
  api: ApiState;
  /** « unknown » lorsque l'API ne répond pas : la base ne peut pas être interrogée. */
  database: DatabaseState;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 3000;

/** Lit un corps JSON sans lever d'exception : null si le corps est absent ou invalide. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Interroge la vivacité de l'API puis la préparation de la base.
 * Les réponses sont validées par les contrats partagés : une réponse
 * inattendue (proxy sans API, page HTML…) compte comme une API indisponible.
 */
export async function fetchServiceStatus(
  fetchFn: FetchLike = fetch,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServiceStatus> {
  const requestSignal = (): AbortSignal => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };

  try {
    const health = await fetchFn("/api/health", { signal: requestSignal(), headers: { Accept: "application/json" } });
    if (!health.ok || !healthResponseSchema.safeParse(await readJson(health)).success) {
      return { api: "down", database: "unknown" };
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    return { api: "down", database: "unknown" };
  }

  try {
    // 200 (prête) et 503 (non prête) portent le même schéma de corps.
    const ready = await fetchFn("/api/health/ready", { signal: requestSignal(), headers: { Accept: "application/json" } });
    const parsed = readinessResponseSchema.safeParse(await readJson(ready));
    return { api: "up", database: parsed.success ? parsed.data.checks.database : "unknown" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { api: "up", database: "unknown" };
  }
}
