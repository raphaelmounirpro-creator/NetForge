import type { Issue } from "@netforge/project";
import { fr } from "./fr";

/** Messages de la langue active. Une seule langue (français) pour l'instant. */
export const messages = fr;

/**
 * Tri des noms à la française, nombres compris (PC2 avant PC10). Un seul
 * comparateur partagé : localeCompare avec options en recrée un à chaque appel.
 */
const nameCollator = new Intl.Collator("fr", { numeric: true });
export const compareNames = (a: string, b: string): number => nameCollator.compare(a, b);

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
  const kind = params["kind"];
  if (typeof kind === "string" && kind in fr.optics.faultKinds) params["kindText"] = fr.optics.faultKinds[kind as keyof typeof fr.optics.faultKinds];
  const action = params["action"];
  if (typeof action === "string" && action in fr.optics.actions) params["actionText"] = fr.optics.actions[action as keyof typeof fr.optics.actions];
  if (typeof params["maxBytes"] === "number") params["maxMegabytes"] = params["maxBytes"] / (1024 * 1024);
  return fill(fr.issues[issue.code], params);
}
