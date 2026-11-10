import { useId, type ReactNode } from "react";

interface PanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Panneau opaque nommé par son titre (région accessible). */
export function Panel({ title, description, actions, children }: PanelProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-text">
            {title}
          </h2>
          {description !== undefined && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
