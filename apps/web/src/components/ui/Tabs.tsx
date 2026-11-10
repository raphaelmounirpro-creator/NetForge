import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

interface TabsProps<T extends string> {
  /** Nom accessible de la liste d'onglets. */
  label: string;
  tabs: ReadonlyArray<TabItem<T>>;
  selected: T;
  onSelect: (id: T) => void;
  children: ReactNode;
  /** Contenu affiché à droite des onglets (hors de la liste d'onglets). */
  trailing?: ReactNode;
  size?: "md" | "sm";
  className?: string;
}

/**
 * Onglets WAI-ARIA : tablist/tab/tabpanel, focus itinérant, flèches,
 * Début et Fin. Le panneau affiche le contenu de l'onglet sélectionné.
 */
export function Tabs<T extends string>({ label, tabs, selected, onSelect, children, trailing, size = "md", className = "" }: TabsProps<T>) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const tabId = (id: T) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  const focusTab = (index: number) => {
    const target = tabs[(index + tabs.length) % tabs.length];
    if (!target) return;
    onSelect(target.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(target.id))}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.id === selected);
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusTab(next);
  };

  const sizeClass = size === "sm" ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm";

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 border-b border-border">
      <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex shrink-0 gap-1">
        {tabs.map((tab) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={panelId}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                onSelect(tab.id);
              }}
              className={`-mb-px border-b-2 font-medium transition-colors duration-(--duration-base) ease-(--ease-standard) ${sizeClass} ${
                isSelected ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {trailing && <div className="ml-auto flex max-w-full min-w-0 items-center gap-1 overflow-x-auto py-1 pr-2">{trailing}</div>}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(selected)} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
