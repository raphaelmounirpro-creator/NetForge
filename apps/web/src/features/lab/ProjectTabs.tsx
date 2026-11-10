import { FolderOpen, Plus, X } from "lucide-react";
import { Link } from "../../app/router";
import { fill, messages } from "../../i18n";
import { useLabStore } from "./store";

const t = messages.lab;

interface ProjectTabsProps {
  onNew: () => void;
  onClose: (id: string) => void;
}

/**
 * Projets ouverts : liste de boutons (projet actif signalé par aria-current)
 * plutôt que des onglets ARIA, car chaque entrée porte aussi un bouton de fermeture.
 */
export function ProjectTabs({ onNew, onClose }: ProjectTabsProps) {
  const order = useLabStore((state) => state.order);
  const projects = useLabStore((state) => state.projects);
  const activeId = useLabStore((state) => state.activeId);

  return (
    <nav aria-label={t.openProjects} className="flex min-h-11 items-stretch gap-1 overflow-x-auto border-b border-border bg-canvas px-2">
      <ul className="flex items-stretch gap-1">
        {order.map((id) => {
          const project = projects[id];
          if (!project) return null;
          const name = project.document.metadata.name;
          const active = id === activeId;
          return (
            <li key={id} className={`flex items-center border-b-2 ${active ? "border-accent" : "border-transparent"}`}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  useLabStore.getState().setActive(id);
                }}
                className={`max-w-56 truncate py-2 pr-1 pl-3 text-sm transition-colors duration-(--duration-fast) ${active ? "font-semibold text-text" : "text-text-muted hover:text-text"}`}
              >
                {name}
                {project.change !== project.savedChange && <span aria-hidden="true"> •</span>}
              </button>
              <button
                type="button"
                aria-label={fill(t.closeProject, { name })}
                title={fill(t.closeProject, { name })}
                onClick={() => {
                  onClose(id);
                }}
                className="mr-1 inline-flex size-7 items-center justify-center rounded-sm text-text-muted hover:bg-surface-raised hover:text-text"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ml-1 flex items-center gap-1">
        <button
          type="button"
          onClick={onNew}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-sm px-2.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text"
        >
          <Plus aria-hidden="true" size={16} />
          {t.newProject}
        </button>
        <Link to="/projets" className="inline-flex min-h-8 items-center gap-1.5 rounded-sm px-2.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text">
          <FolderOpen aria-hidden="true" size={16} />
          {t.openProject}
        </Link>
      </div>
    </nav>
  );
}
