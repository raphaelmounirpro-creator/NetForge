import { useState, type SubmitEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextField } from "../../components/ui/TextField";
import { formatIssue, messages } from "../../i18n";
import { projectService } from "../lab/services";

const t = messages.projects;

/** Création d'un projet invité nommé ; il s'ouvre dans le laboratoire. */
export function NewProjectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  return (
    <Dialog open={open} title={t.nameDialogTitle} onClose={onClose} actions={null}>
      {open && <NewProjectForm onCancel={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function NewProjectForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState<string>(t.defaultName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await projectService.newProject(name);
    setBusy(false);
    if (!result.ok) {
      setError(result.errors.map(formatIssue).join(" "));
      return;
    }
    onCreated(result.id);
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <TextField
        label={t.nameLabel}
        value={name}
        autoFocus
        onFocus={(event) => {
          event.target.select();
        }}
        error={error}
        maxLength={80}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {t.create}
        </Button>
      </div>
    </form>
  );
}
