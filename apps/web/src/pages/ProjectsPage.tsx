import type { Issue, NfgDocument } from "@netforge/project";
import { FileUp, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { navigate } from "../app/router";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Notice } from "../components/ui/Notice";
import { fill, formatIssue, messages } from "../i18n";
import { exportDocument } from "../features/lab/actions";
import type { ImportOutcome } from "../features/lab/projectService";
import { projectService } from "../features/lab/services";
import { NewProjectDialog } from "../features/projects/NewProjectDialog";
import { readImportFile } from "../features/storage/files";
import type { ProjectSummary } from "../features/storage/repository";

const t = messages.projects;
const ti = messages.importFlow;
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

type Message = { tone: "success" | "warning" | "danger"; title: string; lines: string[] } | null;
type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; projects: ProjectSummary[] };

export function ProjectsPage() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [message, setMessage] = useState<Message>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ document: NfgDocument; warnings: Issue[] } | null>(null);
  const [toDelete, setToDelete] = useState<ProjectSummary | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setList({ status: "ready", projects: await projectService.list() });
    } catch {
      setList({ status: "error" });
    }
  }, []);

  useEffect(() => {
    // Lecture initiale de la liste ; l'état est mis à jour à l'arrivée du résultat.
    let active = true;
    projectService.list().then(
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
  }, []);

  const openInLab = async (id: string) => {
    const outcome = await projectService.openStored(id);
    if (outcome.ok) navigate("/laboratoire");
    else setMessage({ tone: "danger", title: t.unreadable, lines: outcome.reason === "invalid" ? outcome.issues.map(formatIssue) : [] });
  };

  const handleImportOutcome = (outcome: ImportOutcome) => {
    switch (outcome.kind) {
      case "invalid":
        setMessage({ tone: "danger", title: ti.invalidTitle, lines: [ti.invalidBody, ...outcome.errors.map(formatIssue)] });
        return;
      case "exists":
        setPendingImport({ document: outcome.document, warnings: outcome.warnings });
        return;
      case "busy":
        setMessage({ tone: "danger", title: ti.invalidTitle, lines: [ti.busy] });
        return;
      case "storage-error":
        setMessage({ tone: "danger", title: ti.invalidTitle, lines: [messages.storage[outcome.error.kind]] });
        return;
      case "imported":
        if (outcome.warnings.length > 0) {
          setMessage({ tone: "warning", title: ti.warningsTitle, lines: outcome.warnings.map(formatIssue) });
        }
        navigate("/laboratoire");
    }
  };

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    const read = await readImportFile(file);
    if (!read.ok) {
      handleImportOutcome({ kind: "invalid", errors: read.errors });
      return;
    }
    handleImportOutcome(await projectService.importText(read.text));
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const outcome = await projectService.remove(toDelete.id);
    setToDelete(null);
    if (outcome === "busy") setMessage({ tone: "danger", title: t.delete, lines: [t.deleteBusy] });
    await refresh();
  };

  const exportStored = async (id: string) => {
    const outcome = await projectService.load(id);
    if (outcome.ok) exportDocument(outcome.project.document);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold text-text">{t.title}</h1>
          <p className="mt-2 text-text-muted">{t.intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              setNewOpen(true);
            }}
          >
            <Plus aria-hidden="true" size={16} />
            {t.newProject}
          </Button>
          <Button
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            <FileUp aria-hidden="true" size={16} />
            {t.import}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.nfg.json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="import-input"
            onChange={(event) => {
              void onFileChosen(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <Notice tone="info" className="mt-6">
        {messages.storage.guestNotice}
      </Notice>

      {message && (
        <div role="alert" className="mt-4">
          <Notice tone={message.tone} title={message.title}>
            <ul className="list-disc space-y-1 pl-4">
              {message.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <section aria-label={t.title} className="mt-6">
        {list.status === "loading" && <p className="text-text-muted">{t.loading}</p>}
        {list.status === "error" && <Notice tone="danger" title={t.loadError}>{messages.storage.unavailable}</Notice>}
        {list.status === "ready" && list.projects.length === 0 && <p className="text-text-muted">{t.empty}</p>}
        {list.status === "ready" && list.projects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">{t.columns.name}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.columns.devices}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.columns.links}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.columns.saved}</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">{t.columns.actions}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.projects.map((project) => (
                  <tr key={project.id} className="border-b border-border">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-text">
                      {project.readable ? project.name : `${t.unreadable} (${project.id})`}
                    </th>
                    <td className="px-3 py-2 text-text">{project.deviceCount}</td>
                    <td className="px-3 py-2 text-text">{project.linkCount}</td>
                    <td className="px-3 py-2 text-text-muted">{dateFormatter.format(new Date(project.savedAt))}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {project.readable && (
                          <>
                            <Button size="sm" variant="primary" onClick={() => void openInLab(project.id)}>
                              {t.open}
                            </Button>
                            <Button size="sm" onClick={() => void exportStored(project.id)}>
                              {t.export}
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setToDelete(project);
                          }}
                        >
                          {t.delete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NewProjectDialog
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
        }}
        onCreated={() => {
          setNewOpen(false);
          navigate("/laboratoire");
        }}
      />

      <Dialog
        open={pendingImport !== null}
        title={ti.existsTitle}
        onClose={() => {
          setPendingImport(null);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingImport(null);
              }}
            >
              {t.cancel}
            </Button>
            <Button
              onClick={() => {
                const pending = pendingImport;
                setPendingImport(null);
                if (pending) void projectService.importReplace(pending.document).then(handleImportOutcome);
              }}
            >
              {ti.replace}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const pending = pendingImport;
                setPendingImport(null);
                if (pending) void projectService.saveAsCopy(pending.document).then(handleImportOutcome);
              }}
            >
              {ti.copy}
            </Button>
          </>
        }
      >
        {fill(ti.existsBody, { name: pendingImport?.document.metadata.name ?? "" })}
      </Dialog>

      <Dialog
        open={toDelete !== null}
        title={fill(t.deleteTitle, { name: toDelete?.name ?? "" })}
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
              {t.cancel}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              {t.deleteConfirm}
            </Button>
          </>
        }
      >
        {t.deleteBody}
      </Dialog>
    </div>
  );
}
