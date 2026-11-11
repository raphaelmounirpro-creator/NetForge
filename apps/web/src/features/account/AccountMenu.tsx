import { ChevronDown, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, navigate } from "../../app/router";
import { fill, messages } from "../../i18n";
import { signOut } from "./actions";
import { apiErrorText } from "./errors";
import { useAccountStore } from "./store";

const t = messages.account;

/**
 * Accès au compte dans l'en-tête. « Se connecter » n'apparaît que si l'API
 * répond (jamais de bouton inopérant) ; connecté : déconnexion simple ou de
 * tous les appareils.
 */
export function AccountMenu() {
  const status = useAccountStore((state) => state.status);
  const account = useAccountStore((state) => state.account);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (status === "guest") {
    return (
      <Link to="/connexion" className="inline-flex min-h-9 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-text hover:border-accent-text hover:text-accent-text">
        {t.signIn}
      </Link>
    );
  }
  if (status !== "signed-in" || !account) return null;

  const run = async (everywhere: boolean) => {
    setBusy(true);
    let message: string;
    try {
      message = await signOut({ everywhere });
    } catch (error) {
      message = apiErrorText(error);
    }
    setBusy(false);
    setOpen(false);
    useAccountStore.getState().setFlash(message);
    navigate("/connexion");
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={fill(t.menu, { email: account.email })}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="inline-flex min-h-9 max-w-56 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-text hover:border-accent-text"
      >
        <UserRound aria-hidden="true" size={16} className="shrink-0 text-text-muted" />
        <span className="hidden truncate sm:inline">{account.email}</span>
        <ChevronDown aria-hidden="true" size={14} className="shrink-0" />
      </button>
      {open && (
        <div id={menuId} className="absolute right-0 z-20 mt-1 flex w-64 flex-col gap-1 rounded-md border border-border bg-surface p-2 shadow-lg">
          <p className="truncate px-2 py-1 text-xs text-text-muted">{account.email}</p>
          <button type="button" disabled={busy} onClick={() => void run(false)} className="rounded-sm px-2 py-2 text-left text-sm text-text hover:bg-surface-raised disabled:opacity-60">
            {t.signOut}
          </button>
          <button type="button" disabled={busy} onClick={() => void run(true)} className="rounded-sm px-2 py-2 text-left text-sm text-text hover:bg-surface-raised disabled:opacity-60">
            {t.signOutAll}
          </button>
        </div>
      )}
    </div>
  );
}
