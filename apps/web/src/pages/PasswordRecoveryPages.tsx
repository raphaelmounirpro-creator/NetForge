import { useState, type SubmitEvent } from "react";
import { Link } from "../app/router";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { messages } from "../i18n";
import { forgotPassword, resetPassword, takeTokenFromLocation } from "../features/account/actions";
import { errorCode } from "../features/account/api";
import { AuthLayout } from "../features/account/AuthLayout";
import { apiErrorText } from "../features/account/errors";
import { EmailField, PasswordField } from "../features/account/fields";

const t = messages.account;
const TOKEN_ERRORS = new Set(["auth.token-invalid", "auth.token-expired", "auth.token-consumed"]);

function BackLinks() {
  return (
    <div className="mt-6 flex flex-col items-start gap-2 text-sm">
      <Link to="/connexion" className="text-accent-text underline underline-offset-4">
        {t.backToSignIn}
      </Link>
      <Link to="/laboratoire" className="text-text-muted underline underline-offset-4">
        {t.explore}
      </Link>
    </div>
  );
}

/** « Mot de passe oublié ? » : réponse identique que l'adresse corresponde ou non à un compte. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await forgotPassword(email);
      setResult({ tone: "success", text: t.forgotSent });
    } catch (error) {
      setResult({ tone: "danger", text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold text-text">{t.forgotTitle}</h1>
      <p className="mt-2 text-text-muted">{t.forgotBody}</p>
      <form noValidate onSubmit={(event) => void submit(event)} className="mt-6 flex flex-col gap-4" aria-busy={busy}>
        <EmailField
          label={t.email}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <div role="status" className="empty:hidden">
          {result && <Notice tone={result.tone}>{result.text}</Notice>}
        </div>
        <Button type="submit" variant="primary" busy={busy} disabled={email.trim() === ""} className="w-full">
          {busy ? t.working : t.forgotSubmit}
        </Button>
      </form>
      <BackLinks />
    </AuthLayout>
  );
}

/** Nouveau mot de passe depuis le lien reçu : pas de connexion automatique ; toutes les sessions sont fermées. */
export function ResetPasswordPage() {
  const [token] = useState(takeTokenFromLocation);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy || !token) return;
    if (password !== confirmation) {
      setError({ code: "mismatch", text: t.mismatch });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError({ code: errorCode(caught), text: apiErrorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (!token) body = <Notice tone="warning">{t.noToken}</Notice>;
  else if (done)
    body = (
      <Notice tone="success">
        <span role="status">{t.resetDone}</span>
      </Notice>
    );
  else if (error && TOKEN_ERRORS.has(error.code))
    body = (
      <Notice tone="danger">
        <span role="alert">{error.text}</span>
      </Notice>
    );
  else
    body = (
      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" aria-busy={busy}>
        <PasswordField
          label={t.passwordNew}
          autoComplete="new-password"
          hint={t.passwordPolicy}
          value={password}
          error={error && error.code !== "mismatch" ? error.text : null}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <PasswordField
          label={t.passwordConfirm}
          autoComplete="new-password"
          value={confirmation}
          error={error?.code === "mismatch" ? error.text : null}
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
        />
        <Button type="submit" variant="primary" busy={busy} className="w-full">
          {busy ? t.working : t.resetSubmit}
        </Button>
      </form>
    );

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold text-text">{t.resetTitle}</h1>
      <p className="mt-2 mb-6 text-text-muted">{t.resetBody}</p>
      {body}
      {(done || !token || (error && TOKEN_ERRORS.has(error.code))) && (
        <div className="mt-4 text-sm">
          <Link to={done ? "/connexion" : "/mot-de-passe-oublie"} className="text-accent-text underline underline-offset-4">
            {done ? t.submitSignIn : t.newLink}
          </Link>
        </div>
      )}
      <BackLinks />
    </AuthLayout>
  );
}
