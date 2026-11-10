import { useEffect } from "react";
import { Link, navigate, usePathname } from "./app/router";
import { LogoMark } from "./components/brand/Logo";
import { ThemeToggle } from "./features/theme/ThemeToggle";
import { messages } from "./i18n";
import { LabPage } from "./pages/LabPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectsPage } from "./pages/ProjectsPage";

const { app, nav } = messages;

const NAV_ITEMS = [
  { to: "/projets", label: nav.projects },
  { to: "/laboratoire", label: nav.lab },
] as const;

function CurrentPage({ pathname }: { pathname: string }) {
  if (pathname === "/laboratoire") return <LabPage />;
  if (pathname === "/projets") return <ProjectsPage />;
  if (pathname === "/") return null;
  return <NotFoundPage />;
}

export function App() {
  const pathname = usePathname();

  useEffect(() => {
    // L'accès invité ouvre directement le laboratoire.
    if (pathname === "/") navigate("/laboratoire", { replace: true });
  }, [pathname]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-border bg-canvas">
        <div className="flex h-12 items-center gap-6 px-4">
          <Link to="/laboratoire" aria-label={app.homeLabel} className="flex items-center gap-2 rounded-sm">
            <LogoMark size={26} />
            <span className="text-base font-semibold tracking-wide text-text">{app.name}</span>
          </Link>
          <nav aria-label={app.mainNav}>
            <ul className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="inline-flex min-h-9 items-center rounded-sm px-3 text-sm text-text-muted underline-offset-4 transition-colors duration-(--duration-fast) hover:text-text aria-[current=page]:font-semibold aria-[current=page]:text-text aria-[current=page]:underline aria-[current=page]:decoration-accent aria-[current=page]:decoration-2"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <CurrentPage pathname={pathname} />
      </main>
    </div>
  );
}
