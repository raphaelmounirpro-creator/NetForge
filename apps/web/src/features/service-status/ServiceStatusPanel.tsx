import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Panel } from "../../components/ui/Panel";
import { StatusBadge, type StatusTone } from "../../components/ui/StatusBadge";
import { messages } from "../../i18n";
import { fetchServiceStatus, type ServiceStatus } from "./fetchServiceStatus";

const t = messages.services;

type ServiceView = "up" | "down" | "unknown" | "checking";

const VIEW: Record<ServiceView, { tone: StatusTone; label: string }> = {
  up: { tone: "success", label: t.up },
  down: { tone: "danger", label: t.down },
  unknown: { tone: "neutral", label: t.unknown },
  checking: { tone: "pending", label: t.checking },
};

const timeFormatter = new Intl.DateTimeFormat("fr-FR", { timeStyle: "medium" });

export function ServiceStatusPanel() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  // Vérification lancée dès l'affichage : l'état initial est donc « en cours ».
  const [checking, setChecking] = useState(true);
  // Chaque nouvelle demande relance l'effet ; le nettoyage annule la précédente.
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchServiceStatus(fetch, controller.signal).then(
      (result) => {
        setStatus(result);
        setCheckedAt(new Date());
        setChecking(false);
      },
      () => {
        // Vérification annulée (nouvelle demande ou démontage) : rien à afficher.
      },
    );
    return () => {
      controller.abort();
    };
  }, [requestId]);

  const recheck = () => {
    setChecking(true);
    setRequestId((id) => id + 1);
  };

  const apiView: ServiceView = checking || !status ? "checking" : status.api;
  const databaseView: ServiceView = checking || !status ? "checking" : status.database;

  return (
    <Panel
      title={t.title}
      description={t.description}
      actions={
        <Button onClick={recheck} busy={checking}>
          {t.recheck}
        </Button>
      }
    >
      <dl className="divide-y divide-border">
        {[
          { name: t.api, view: apiView },
          { name: t.database, view: databaseView },
        ].map(({ name, view }) => (
          <div key={name} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
            <dt className="text-sm text-text">{name}</dt>
            <dd>
              <StatusBadge tone={VIEW[view].tone} label={VIEW[view].label} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-text-muted" aria-live="polite">
        {checkedAt && !checking ? `${t.lastChecked} : ${timeFormatter.format(checkedAt)}` : " "}
      </p>
    </Panel>
  );
}
