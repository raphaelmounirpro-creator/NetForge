import { useState, type SubmitEvent } from "react";
import { Link } from "../app/router";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { messages } from "../i18n";
import { restartVerification, takeTokenFromLocation, verifyEmail } from "../features/account/actions";
import { errorCode } from "../features/account/api";
import { AuthLayout } from "../features/account/AuthLayout";
import { apiErrorText } from "../features/account/errors";
import { PasswordField } from "../features/account/fields";

const t = messages.account;
const TOKEN_ERRORS = new Set(["auth.token-invalid", "auth.token-expired", "auth.token-consumed"]);

function NewLinkActions() {
  return (
    <div className="mt-4 flex flex-col items-start gap-2 text-sm">
      <Link to="/verifier-email" className="text-accent-text underline underline-offset-4">
        {t.newLink}
      </Link>
      <Link to="/connexion" className="text-text-muted underline underline-offset-4">
        {t.backToSignIn}
      </Link>
    </div>
  );
}

/**
 * Confirmation explicite de l'adresse : le lien seul ne valide rien (aucune
 * requête GET ne consomme le jeton). Le mot de passe de l'inscription est
 * demandé ; à défaut, la reprise permet de choisir de nouveaux identifiants.
 */
export function ConfirmEmailPage() {
  const [token] = useState(takeTokenFromLocation);
  const [mode, setMode] = useState<"confirm" | "restart">("confirm");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);

  if (!token) {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-semibold text-text">{t.confirmTitle}</h1>
        <Notice tone="warning" className="mt-4">
          {t.noToken}
        </Notice>
        <NewLinkActions />
      </AuthLayout>
    );
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "restart" && password !== confirmation) {
      setError({ code: "mismatch", text: t.mismatch });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "confirm") await verifyEmail(token, password);
      else await restartVerification(token, password);
      setDone(mode === "confirm" ? t.confirmed : t.restarted);
    } catch (caught) {
      setError({ code: errorCode(caught), text: apiErrorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-semibold text-text">{t.confirmTitle}</h1>
        <Notice tone="success" className="mt-4">
          <span role="status">{done}</span>
        </Notice>
        <Link to="/connexion" className="mt-6 inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-on-accent">
          {t.submitSignIn}
        </Link>
      </AuthLayout>
    );
  }

  const tokenProblem = error && TOKEN_ERRORS.has(error.code);
  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold text-text">{mode === "confirm" ? t.confirmTitle : t.restartTitle}</h1>
      <p className="mt-2 text-text-muted">{mode === "confirm" ? t.confirmBody : t.restartBody}</p>
      {tokenProblem ? (
        <>
          <Notice tone="danger" className="mt-4">
            <span role="alert">{error.text}</span>
          </Notice>
          <NewLinkActions />
        </>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)} className="mt-6 flex flex-col gap-4" aria-busy={busy}>
          <PasswordField
            key={mode}
            label={mode === "confirm" ? t.password : t.passwordNew}
            autoComplete={mode === "confirm" ? "current-password" : "new-password"}
            hint={mode === "restart" ? t.passwordPolicy : undefined}
            value={password}
            error={error && error.code !== "mismatch" ? error.text : null}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          {mode === "restart" && (
            <PasswordField
              label={t.passwordConfirm}
              autoComplete="new-password"
              value={confirmation}
              error={error?.code === "mismatch" ? error.text : null}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
            />
          )}
          <Button type="submit" variant="primary" busy={busy} className="w-full">
            {busy ? t.working : mode === "confirm" ? t.confirmSubmit : t.restartSubmit}
          </Button>
          {mode === "confirm" && (
            <button
              type="button"
              onClick={() => {
                setMode("restart");
                setPassword("");
                setError(null);
              }}
              className="self-start text-left text-sm text-accent-text underline underline-offset-4"
            >
              {t.unknownPassword}
            </button>
          )}
        </form>
      )}
    </AuthLayout>
  );
}
