import type { PublicationSummaryDto } from "@netforge/contracts";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { fill, messages } from "../../../i18n";
import { ApiRequestError } from "../../account/api";
import { apiErrorText } from "../../account/errors";
import { evaluationsApi } from "../api";
import { formatDate } from "../ResultView";

const t = messages.evaluations;

const linkOf = (code: string) => `${window.location.origin}/evaluation/${code}`;

function publishError(error: unknown): string {
  if (error instanceof ApiRequestError && error.body.code === "evaluation.not-ready" && error.body.reason) {
    return fill(t.notReady[error.body.reason], { max: error.body.max ?? 0 });
  }
  return apiErrorText(error);
}

/** Publications d'un exercice : publier la révision enregistrée, transmettre le lien, fermer. */
export function PublicationsPanel({ exerciseId, revision, dirty }: { exerciseId: string; revision: number; dirty: boolean }) {
  const [publications, setPublications] = useState<readonly PublicationSummaryDto[]>([]);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useCallback(() => {
    void evaluationsApi.publications(exerciseId).then(
      (response) => {
        setPublications(response.publications);
      },
      (error: unknown) => {
        setMessage({ tone: "danger", text: apiErrorText(error) });
      },
    );
  }, [exerciseId]);

  useEffect(load, [load]);

  const publish = () => {
    setBusy("publish");
    setMessage(null);
    void evaluationsApi.publish(exerciseId, maxAttempts).then(
      () => {
        setBusy(null);
        setMessage({ tone: "success", text: t.published });
        load();
      },
      (error: unknown) => {
        setBusy(null);
        setMessage({ tone: "danger", text: publishError(error) });
      },
    );
  };

  return (
    <section aria-labelledby="exercise-publications" className="flex flex-col gap-3">
      <h2 id="exercise-publications" className="text-lg font-semibold text-text">
        {t.publications}
      </h2>
      <p className="text-sm text-text-muted">{t.publicationsIntro}</p>
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label={t.maxAttempts}
          type="number"
          min={1}
          max={10}
          value={maxAttempts}
          className="w-40"
          onChange={(event) => {
            setMaxAttempts(Math.max(1, Math.min(10, Math.trunc(Number(event.target.value) || 1))));
          }}
        />
        <Button variant="primary" busy={busy === "publish"} disabled={dirty} onClick={publish}>
          {fill(t.publish, { revision })}
        </Button>
      </div>
      {dirty && <p className="text-xs text-text-muted">{t.publishSaveFirst}</p>}
      {message && (
        <div role="status" aria-live="polite">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      {publications.length === 0 ? (
        <p className="text-sm text-text-muted">{t.noPublications}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {publications.map((publication) => (
            <li key={publication.code} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm">
              <p className="text-text">
                {fill(t.publicationLine, { revision: publication.exerciseRevision, attempts: publication.attemptCount, date: formatDate(publication.createdAt) })}
                {" · "}
                {publication.closedAt ? fill(t.closedOn, { date: formatDate(publication.closedAt) }) : t.openState}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <TextField label={fill(t.link, { revision: publication.exerciseRevision })} value={linkOf(publication.code)} readOnly className="min-w-64 flex-1" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(linkOf(publication.code)).then(
                      () => {
                        setMessage({ tone: "success", text: t.copied });
                      },
                      () => undefined,
                    );
                  }}
                >
                  {t.copy}
                </Button>
                {!publication.closedAt && (
                  <Button
                    size="sm"
                    variant="danger"
                    busy={busy === publication.code}
                    onClick={() => {
                      setBusy(publication.code);
                      void evaluationsApi.close(publication.code).then(
                        () => {
                          setBusy(null);
                          load();
                        },
                        (error: unknown) => {
                          setBusy(null);
                          setMessage({ tone: "danger", text: apiErrorText(error) });
                        },
                      );
                    }}
                  >
                    {t.close}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
