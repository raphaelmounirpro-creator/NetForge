import { sessionStateSchema, type Account } from "@netforge/contracts";
import { create } from "zustand";
import { apiRequest, rememberCsrf } from "./api";

/**
 * État du compte, en mémoire seulement (jamais persistant) :
 * « checking » au démarrage, « guest » si l'API répond sans session,
 * « unavailable » si l'API est injoignable (le laboratoire invité reste
 * entièrement utilisable), « signed-in » avec une session vérifiée.
 */
export type AccountStatus = "checking" | "guest" | "unavailable" | "signed-in";

interface AccountState {
  status: AccountStatus;
  account: Account | null;
  /** Destination demandée avant la connexion (page interne seulement). */
  returnTo: string | null;
  /** Adresse saisie à l'inscription (page « Vérifiez votre adresse »), en mémoire seulement. */
  pendingEmail: string | null;
  /** Message à afficher sur la page de connexion (après déconnexion, validation…). */
  flash: string | null;
  setPendingEmail: (email: string | null) => void;
  setFlash: (message: string | null) => void;
  refresh: () => Promise<void>;
  signedIn: (account: Account) => void;
  signedOut: () => void;
  setReturnTo: (path: string | null) => void;
}

export const useAccountStore = create<AccountState>()((set) => ({
  status: "checking",
  account: null,
  returnTo: null,
  pendingEmail: null,
  flash: null,
  setPendingEmail: (email) => {
    set({ pendingEmail: email });
  },
  setFlash: (message) => {
    set({ flash: message });
  },
  refresh: async () => {
    try {
      const session = await apiRequest("GET", "/auth/session", sessionStateSchema);
      set(session.account ? { status: "signed-in", account: session.account } : { status: "guest", account: null });
    } catch {
      // API injoignable (pnpm dev:web seul, serveur arrêté) : le laboratoire invité reste disponible.
      rememberCsrf(null);
      set({ status: "unavailable", account: null });
    }
  },
  signedIn: (account) => {
    set({ status: "signed-in", account });
  },
  signedOut: () => {
    rememberCsrf(null);
    set({ status: "guest", account: null });
  },
  setReturnTo: (path) => {
    // Redirection ouverte impossible : seulement un chemin interne.
    set({ returnTo: path && /^\/[a-z-/]*$/.test(path) ? path : null });
  },
}));
