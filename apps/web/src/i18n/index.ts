import type { Issue } from "@netforge/project";
import { fr } from "./fr";

/** Messages de la langue active. Une seule langue (français) pour l'instant. */
export const messages = fr;

/** Remplit un gabarit « Texte {nom} » avec les paramètres fournis. */
export function fill(template: string, params: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

function reasonText(reason: string | number | undefined): string {
  return typeof reason === "string" && reason in fr.ipv4Reasons ? fr.ipv4Reasons[reason as keyof typeof fr.ipv4Reasons] : String(reason ?? "");
}

/** Texte français d'un problème métier, à partir de son code stable et de ses paramètres. */
export function formatIssue(issue: Issue): string {
  const params: Record<string, string | number> = { ...issue.params };
  if ("reason" in params) params["reasonText"] = reasonText(params["reason"]);
  if (typeof params["maxBytes"] === "number") params["maxMegabytes"] = params["maxBytes"] / (1024 * 1024);
  return fill(fr.issues[issue.code], params);
}
