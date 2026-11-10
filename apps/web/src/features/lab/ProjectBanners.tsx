import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { messages } from "../../i18n";
import { exportProject } from "./actions";
import { projectService } from "./services";
import type { OpenProject } from "./store";

const t = messages.lab;

/** Bandeaux persistants : lecture seule, conflit de version, erreur de stockage. */
export function ProjectBanners({ projectId, project }: { projectId: string; project: OpenProject }) {
  const [busy, setBusy] = useState(false);
  const unsaved = project.change !== project.savedChange;

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  if (project.access === "readonly") {
    return (
      <Notice
        tone="info"
        title={t.readonlyTitle}
        className="m-2"
        actions={
          <>
            <Button size="sm" variant="primary" busy={busy} onClick={() => void run(() => projectService.takeOver(projectId))}>
              {t.takeOver}
            </Button>
            {unsaved && (
              <Button size="sm" onClick={() => { exportProject(projectId); }}>
                {t.exportMine}
              </Button>
            )}
          </>
        }
      >
        {t.readonlyBody} {unsaved && t.takeOverUnsaved}
      </Notice>
    );
  }

  if (project.saveStatus === "conflict") {
    return (
      <Notice
        tone="danger"
        title={t.conflictTitle}
        className="m-2"
        actions={
          <>
            <Button size="sm" variant="primary" busy={busy} onClick={() => void run(async () => {
              await projectService.saveAsCopy(project.document);
              await projectService.reloadStored(projectId);
            })}>
              {t.keepMineAsCopy}
            </Button>
            <Button size="sm" onClick={() => { exportProject(projectId); }}>
              {t.exportMine}
            </Button>
            <Button size="sm" variant="ghost" busy={busy} onClick={() => void run(() => projectService.reloadStored(projectId))}>
              {t.loadStored}
            </Button>
          </>
        }
      >
        {t.conflictBody}
      </Notice>
    );
  }

  if (project.saveStatus === "error") {
    return (
      <Notice
        tone="danger"
        title={t.saveErrorTitle}
        className="m-2"
        actions={
          <>
            <Button size="sm" variant="primary" onClick={() => { exportProject(projectId); }}>
              {t.exportMine}
            </Button>
            <Button size="sm" variant="ghost" busy={busy} onClick={() => void run(() => projectService.flush(projectId))}>
              {t.retrySave}
            </Button>
          </>
        }
      >
        {messages.storage[project.saveError ?? "unknown"]}
      </Notice>
    );
  }

  return null;
}
