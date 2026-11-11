import type { ApiError } from "@netforge/contracts";
import { fill, messages } from "../../i18n";
import { ApiRequestError } from "./api";

const t = messages.account;

function wait(seconds: number): string {
  return seconds >= 120 ? fill(t.waitMinutes, { minutes: Math.ceil(seconds / 60) }) : fill(t.waitSeconds, { seconds });
}

/** Texte français d'une erreur de l'API (code stable et paramètres). */
export function apiErrorText(error: unknown): string {
  const body: ApiError = error instanceof ApiRequestError ? error.body : { code: "server.unavailable" };
  return fill(messages.apiErrors[body.code], { wait: wait(body.retryAfterSeconds ?? 60) });
}
