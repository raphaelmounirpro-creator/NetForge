import { acceptedResponseSchema, doneResponseSchema, sessionResponseSchema } from "@netforge/contracts";
import { fill, messages } from "../../i18n";
import { projectService } from "../lab/services";
import { apiRequest } from "./api";
import { useAccountStore } from "./store";

/**
 * Actions de compte de l'interface : elles n'annoncent jamais un succès que
 * l'API n'a pas confirmé. Les mots de passe ne transitent que par l'appel.
 */
export async function register(email: string, password: string): Promise<void> {
  await apiRequest("POST", "/auth/register", acceptedResponseSchema, { email, password });
}

export async function signIn(email: string, password: string): Promise<void> {
  const session = await apiRequest("POST", "/auth/login", sessionResponseSchema, { email, password });
  useAccountStore.getState().signedIn(session.account);
}

/** Déconnexion : projets du compte enregistrés puis fermés (aucune donnée privée affichée ensuite), session révoquée côté serveur. */
export async function signOut(options: { everywhere?: boolean } = {}): Promise<string> {
  const unsaved = await projectService.closeAccountProjects();
  try {
    await apiRequest("POST", options.everywhere ? "/auth/logout-all" : "/auth/logout", doneResponseSchema, {});
  } finally {
    useAccountStore.getState().signedOut();
  }
  const done = options.everywhere ? messages.account.signedOutAll : messages.account.signedOut;
  return unsaved > 0 ? `${done} ${fill(messages.account.unsavedOnSignOut, { count: unsaved })}` : done;
}

export async function resendVerification(email: string): Promise<void> {
  await apiRequest("POST", "/auth/resend-verification", acceptedResponseSchema, { email });
}

export async function verifyEmail(token: string, password: string): Promise<void> {
  await apiRequest("POST", "/auth/verify-email", doneResponseSchema, { token, password });
}

export async function restartVerification(token: string, password: string): Promise<void> {
  await apiRequest("POST", "/auth/verify-email/restart", doneResponseSchema, { token, password });
}

export async function forgotPassword(email: string): Promise<void> {
  await apiRequest("POST", "/auth/forgot-password", acceptedResponseSchema, { email });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiRequest("POST", "/auth/reset-password", doneResponseSchema, { token, password });
}

/**
 * Jeton d'un lien reçu par courrier : lu dans le fragment (#t=…), puis
 * retiré de l'adresse affichée et de l'historique.
 */
let taken: { path: string; token: string | null } | null = null;

export function takeTokenFromLocation(): string | null {
  const path = window.location.pathname;
  if (window.location.hash) {
    taken = { path, token: /^#t=([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1] ?? null };
    window.history.replaceState(null, "", path);
  }
  // Relecture possible pendant la même visite de la page (double rendu de développement).
  return taken?.path === path ? taken.token : null;
}
