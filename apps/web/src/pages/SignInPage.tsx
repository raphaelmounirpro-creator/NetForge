import { useState, type SubmitEvent } from "react";
import { Link, navigate } from "../app/router";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { Tabs } from "../components/ui/Tabs";
import { fill, messages } from "../i18n";
import { register, signIn } from "../features/account/actions";
import { errorCode } from "../features/account/api";
import { AuthLayout } from "../features/account/AuthLayout";
import { apiErrorText } from "../features/account/errors";
import { EmailField, PasswordField } from "../features/account/fields";
import { useAccountStore } from "../features/account/store";

const t = messages.account;
type Tab = "sign-in" | "register";

/** Erreurs reliées à un champ ; les autres s'affichent au niveau du formulaire. */
const PASSWORD_ERRORS = new Set(["auth.password-too-short", "auth.password-too-long", "auth.password-weak"]);

function GuestAccess() {
  return (
    <div className="mt-6 flex flex-col items-center gap-1 border-t border-border pt-5 text-center">
      <Link to="/laboratoire" className="inline-flex min-h-10 items-center rounded-md border border-border-strong px-4 text-sm font-medium text-text hover:border-accent-text hover:text-accent-text">
        {t.explore}
      </Link>
      <p className="text-xs text-text-muted">{t.guestNote}</p>
    </div>
  );
}

function AccountForm({ tab }: { tab: Tab }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const store = useAccountStore.getState;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (tab === "register") {
        await register(email, password);
        store().setPendingEmail(email.trim());
        navigate("/verifier-email");
        return;
      }
      await signIn(email, password);
      const destination = store().returnTo ?? "/projets";
      store().setReturnTo(null);
      navigate(destination);
    } catch (caught) {
      // La saisie est conservée pour corriger ; rien n'est enregistré ailleurs que dans ce formulaire.
      setError({ code: errorCode(caught), text: apiErrorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  const passwordError = error && PASSWORD_ERRORS.has(error.code) ? error.text : null;
  const formError = error && !passwordError ? error : null;
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 pt-5" aria-busy={busy}>
      <EmailField
        label={t.email}
        name="email"
        required
        value={email}
        autoComplete={tab === "register" ? "email" : "username"}
        error={error?.code === "auth.invalid-email" ? error.text : null}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <PasswordField
        label={t.password}
        name="password"
        required
        value={password}
        autoComplete={tab === "register" ? "new-password" : "current-password"}
        hint={tab === "register" ? t.passwordPolicy : undefined}
        error={passwordError}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
      />
      {tab === "sign-in" && (
        <Link to="/mot-de-passe-oublie" className="self-start text-sm text-accent-text underline underline-offset-4">
          {t.forgot}
        </Link>
      )}
      <div role="alert" className="empty:hidden">
        {formError && formError.code !== "auth.invalid-email" && (
          <Notice
            tone="danger"
            title={formError.code === "auth.email-not-verified" ? t.notVerifiedTitle : undefined}
            actions={
              formError.code === "auth.email-not-verified" ? (
                <Button
                  size="sm"
                  type="button"
                  onClick={() => {
                    store().setPendingEmail(email.trim());
                    navigate("/verifier-email");
                  }}
                >
                  {t.newLink}
                </Button>
              ) : undefined
            }
          >
            {formError.code === "auth.email-not-verified" ? t.notVerifiedBody : formError.text}
          </Notice>
        )}
      </div>
      <Button type="submit" variant="primary" busy={busy} className="w-full">
        {busy ? t.working : tab === "register" ? t.submitRegister : t.submitSignIn}
      </Button>
    </form>
  );
}

/** Connexion et création de compte (spécification §15.3). */
export function SignInPage({ initialTab = "sign-in" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const status = useAccountStore((state) => state.status);
  const account = useAccountStore((state) => state.account);
  const flash = useAccountStore((state) => state.flash);

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold text-text">{t.welcome}</h1>
      <p className="mt-1 text-text-muted">{t.welcomeSub}</p>
      {flash && (
        <Notice tone="success" className="mt-4">
          <span role="status">{flash}</span>
        </Notice>
      )}
      {status === "checking" ? (
        <p role="status" className="mt-6 text-sm text-text-muted">
          {t.checking}
        </p>
      ) : status === "unavailable" ? (
        <Notice tone="warning" title={t.unavailableTitle} className="mt-6">
          {t.unavailableBody}
        </Notice>
      ) : status === "signed-in" && account ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-text">{fill(t.alreadySignedIn, { email: account.email })}</p>
          <Link to="/projets" className="inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-on-accent">
            {t.goToProjects}
          </Link>
        </div>
      ) : (
        <Tabs<Tab>
          label={t.tabs}
          tabs={[
            { id: "sign-in", label: t.tabSignIn },
            { id: "register", label: t.tabRegister },
          ]}
          selected={tab}
          onSelect={(next) => {
            setTab(next);
            useAccountStore.getState().setFlash(null);
          }}
          className="mt-6"
        >
          <AccountForm key={tab} tab={tab} />
        </Tabs>
      )}
      <GuestAccess />
    </AuthLayout>
  );
}
