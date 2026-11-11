import { navigate } from "../../app/router";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { messages } from "../../i18n";
import { useAccountStore } from "../account/store";

const t = messages.evaluations;

/** Exercices du compte et évaluations : connexion requise (retour à la page demandée ensuite). */
export function AccountRequired({ path }: { path: string }) {
  const status = useAccountStore((state) => state.status);
  if (status === "unavailable") return <Notice tone="warning">{t.accountUnavailable}</Notice>;
  return (
    <Notice
      tone="info"
      actions={
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            useAccountStore.getState().setReturnTo(path);
            navigate("/connexion");
          }}
        >
          {t.signIn}
        </Button>
      }
    >
      {t.accountRequired}
    </Notice>
  );
}
