import { useEffect, useState, type SubmitEvent } from "react";
import { Link } from "../app/router";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { fill, messages } from "../i18n";
import { resendVerification } from "../features/account/actions";
import { AuthLayout } from "../features/account/AuthLayout";
import { apiErrorText } from "../features/account/errors";
import { EmailField } from "../features/account/fields";
import { useAccountStore } from "../features/account/store";

const t = messages.account;
/** Délai d'attente affiché entre deux renvois (le serveur applique sa propre limite). */
const RESEND_WAIT_SECONDS = 60;

/** « Vérifiez votre adresse e-mail » : renvoi limité, retour à la connexion, accès invité. */
export function VerifyNoticePage() {
  const pendingEmail = useAccountStore((state) => state.pendingEmail);
  const [email, setEmail] = useState(pendingEmail ?? "");
  const [wait, setWait] = useState(pendingEmail ? RESEND_WAIT_SECONDS : 0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      setWait((value) => value - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  const resend = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy || wait > 0) return;
    setBusy(true);
    try {
      await resendVerification(email);
      setResult({ tone: "success", text: t.resent });
      setWait(RESEND_WAIT_SECONDS);
    } catch (error) {
      setResult({ tone: "danger", text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold text-text">{t.verifyTitle}</h1>
      <p className="mt-3 text-text">{pendingEmail ? fill(t.verifyBody, { email: pendingEmail }) : t.verifyBodyGeneric}</p>
      <p className="mt-2 text-sm text-text-muted">{t.verifyDelivery}</p>
      <form noValidate onSubmit={(event) => void resend(event)} className="mt-6 flex flex-col gap-4" aria-busy={busy}>
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
        <Button type="submit" busy={busy} disabled={wait > 0 || email.trim() === ""} className="w-full">
          {wait > 0 ? fill(t.resendWait, { seconds: wait }) : t.resend}
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-start gap-2 text-sm">
        <Link to="/connexion" className="text-accent-text underline underline-offset-4">
          {t.backToSignIn}
        </Link>
        <Link to="/laboratoire" className="text-text-muted underline underline-offset-4">
          {t.explore}
        </Link>
      </div>
    </AuthLayout>
  );
}
