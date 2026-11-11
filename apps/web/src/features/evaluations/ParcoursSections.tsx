import type { MyAttemptsResponse } from "@netforge/contracts";
import { useEffect, useState } from "react";
import { Link, navigate } from "../../app/router";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { fill, messages } from "../../i18n";
import { useAccountStore } from "../account/store";
import { evaluationsApi } from "./api";
import { formatDate } from "./ResultView";

const t = messages.evaluations;

/** Code d'évaluation extrait d'un code seul ou d'un lien complet (…/evaluation/<code>). */
export function evaluationCodeOf(input: string): string | null {
  const match = /(?:^|\/)([a-z2-7]{12})\/?$/.exec(input.trim().toLowerCase());
  return match?.[1] ?? null;
}

function JoinForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const code = evaluationCodeOf(value);
        if (!code) {
          setError(t.joinInvalid);
          return;
        }
        navigate(`/evaluation/${code}`);
      }}
    >
      <TextField
        label={t.joinLabel}
        hint={t.joinHint}
        error={error}
        value={value}
        autoComplete="off"
        spellCheck={false}
        className="min-w-64 flex-1"
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
      />
      <Button type="submit" variant="primary">
        {t.joinSubmit}
      </Button>
    </form>
  );
}

function MyResults() {
  const [data, setData] = useState<MyAttemptsResponse | null>(null);
  useEffect(() => {
    void evaluationsApi.mine().then(setData, () => undefined);
  }, []);
  if (!data) return null;
  return (
    <section aria-labelledby="my-evaluations" className="flex flex-col gap-2">
      <h2 id="my-evaluations" className="text-lg font-semibold text-text">
        {t.resultsTitle}
      </h2>
      {data.attempts.length === 0 ? (
        <p className="text-sm text-text-muted">{t.resultsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {data.attempts.map((attempt) => (
            <li key={attempt.id} className="flex flex-wrap gap-x-2">
              <Link to={`/evaluation/${attempt.code}`} className="text-accent-text underline underline-offset-4">
                {attempt.title}
              </Link>
              <span className="text-text-muted">
                {formatDate(attempt.startedAt)} · {attempt.score === null ? t.inProgress : fill(t.score, { score: attempt.score, max: attempt.maxScore })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Page Parcours : création d'exercices, accès à une évaluation par lien ou code, résultats vérifiés. */
export function ParcoursSections() {
  const status = useAccountStore((state) => state.status);
  return (
    <>
      <section aria-labelledby="join-evaluation" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
        <h2 id="join-evaluation" className="text-lg font-semibold text-text">
          {t.joinTitle}
        </h2>
        <JoinForm />
      </section>
      {status === "signed-in" && <MyResults />}
      <section aria-labelledby="author-exercises" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-5">
        <h2 id="author-exercises" className="text-lg font-semibold text-text">
          {t.authorTitle}
        </h2>
        <p className="text-sm text-text-muted">{t.authorIntro}</p>
        <Link to="/exercices" className="inline-flex min-h-10 items-center self-start rounded-md border border-border-strong px-4 text-sm text-text hover:border-accent-text hover:text-accent-text">
          {t.openEditor}
        </Link>
      </section>
    </>
  );
}
