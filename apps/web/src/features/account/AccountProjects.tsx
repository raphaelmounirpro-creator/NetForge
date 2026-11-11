import { useCallback, useEffect, useState } from "react";
import { Link, navigate } from "../../app/router";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Notice } from "../../components/ui/Notice";
import { fill, formatIssue, messages } from "../../i18n";
import { exportDocument } from "../lab/actions";
import { projectService } from "../lab/services";
import type { ProjectSummary } from "../storage/repository";
import { useAccountStore } from "./store";

const t = messages.account;
const tp = messages.projects;
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; projects: ProjectSummary[] };

/**
 * Projets du compte : relus du serveur à chaque affichage (aucun cache local
 * ne peut masquer une absence de persistance distante).
 */
export function AccountProjects({ version }: { version: number }) {
  const status = useAccountStore((state) => state.status);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [problem, setProblem] = useState<string[] | null>(null);
  const [toDelete, setToDelete] = useState<ProjectSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList({ status: "ready", projects: await projectService.list("account") });
    } catch {
      setList({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (status !== "signed-in") return;
    let active = true;
    projectService.list("account").then(
      (projects) => {
        if (active) setList({ status: "ready", projects });
      },
      () => {
        if (active) setList({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [status, version]);

  if (status === "guest")
    return (
      <Notice tone="info" className="mt-6">
        {t.signInForAccount}{" "}
        <Link to="/connexion" className="text-accent-text underline underline-offset-4">
          {t.signIn}
        </Link>
      </Notice>
    );
  if (status !== "signed-in") return null;

  const open = async (id: string) => {
    const outcome = await projectService.openStored(id, "account");
    if (outcome.ok) navigate("/laboratoire");
    else setProblem(outcome.reason === "invalid" ? outcome.issues.map(formatIssue) : [tp.unreadable]);
  };
  const exportOne = async (id: string) => {
    const outcome = await projectService.load(id, "account");
    if (outcome.ok) exportDocument(outcome.project.document);
  };
  const confirmDelete = async () => {
    if (!toDelete) return;
    await projectService.remove(toDelete.id, "account");
    setToDelete(null);
    await refresh();
  };

  return (
    <section aria-labelledby="account-projects" className="mt-8">
      <h2 id="account-projects" className="text-xl font-semibold text-text">
        {t.accountProjects}
      </h2>
      <p className="mt-1 text-sm text-text-muted">{t.accountProjectsHint}</p>
      {problem && (
        <div role="alert" className="mt-3">
          <Notice tone="danger" title={tp.unreadable}>
            {problem.join(" ")}
          </Notice>
        </div>
      )}
      <div className="mt-3">
        {list.status === "loading" && <p className="text-text-muted">{tp.loading}</p>}
        {list.status === "error" && <Notice tone="danger">{t.accountListError}</Notice>}
        {list.status === "ready" && list.projects.length === 0 && <p className="text-text-muted">{t.noAccountProjects}</p>}
        {list.status === "ready" && list.projects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">{t.accountProjects}</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">{tp.columns.name}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{tp.columns.devices}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{tp.columns.links}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{tp.columns.saved}</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">{tp.columns.actions}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.projects.map((project) => (
                  <tr key={project.id} className="border-b border-border">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-text">
                      {project.name}
                    </th>
                    <td className="px-3 py-2 text-text">{project.deviceCount}</td>
                    <td className="px-3 py-2 text-text">{project.linkCount}</td>
                    <td className="px-3 py-2 text-text-muted">{dateFormatter.format(new Date(project.savedAt))}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="primary" onClick={() => void open(project.id)}>
                          {tp.open}
                        </Button>
                        <Button size="sm" onClick={() => void exportOne(project.id)}>
                          {tp.export}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setToDelete(project);
                          }}
                        >
                          {tp.delete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog
        open={toDelete !== null}
        title={fill(tp.deleteTitle, { name: toDelete?.name ?? "" })}
        onClose={() => {
          setToDelete(null);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setToDelete(null);
              }}
            >
              {tp.cancel}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              {tp.deleteConfirm}
            </Button>
          </>
        }
      >
        {tp.deleteBody}
      </Dialog>
    </section>
  );
}
