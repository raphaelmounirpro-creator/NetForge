import { useEffect } from "react";
import { Link, navigate, usePathname } from "./app/router";
import { LogoMark } from "./components/brand/Logo";
import { AccountMenu } from "./features/account/AccountMenu";
import { ThemeToggle } from "./features/theme/ThemeToggle";
import { messages } from "./i18n";
import { ConfirmEmailPage } from "./pages/ConfirmEmailPage";
import { LabPage } from "./pages/LabPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ParcoursPage } from "./pages/ParcoursPage";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordRecoveryPages";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SignInPage } from "./pages/SignInPage";
import { VerifyNoticePage } from "./pages/VerifyNoticePage";

const { app, nav } = messages;

const NAV_ITEMS = [
  { to: "/projets", label: nav.projects },
  { to: "/laboratoire", label: nav.lab },
  { to: "/parcours", label: nav.courses },
] as const;

function CurrentPage({ pathname }: { pathname: string }) {
  if (pathname === "/laboratoire") return <LabPage />;
  if (pathname === "/projets") return <ProjectsPage />;
  if (pathname === "/parcours") return <ParcoursPage />;
  if (pathname === "/connexion") return <SignInPage />;
  if (pathname === "/inscription") return <SignInPage initialTab="register" />;
  if (pathname === "/verifier-email") return <VerifyNoticePage />;
  if (pathname === "/confirmer-email") return <ConfirmEmailPage />;
  if (pathname === "/mot-de-passe-oublie") return <ForgotPasswordPage />;
  if (pathname === "/reinitialiser-mot-de-passe") return <ResetPasswordPage />;
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
        {/* Petit écran : la navigation passe sur une seconde ligne, rien ne déborde à 360 px. */}
        <div className="flex min-h-12 flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1 sm:py-0">
          <Link to="/laboratoire" aria-label={app.homeLabel} className="flex items-center gap-2 rounded-sm">
            <LogoMark size={26} />
            <span className="text-base font-semibold tracking-wide text-text">{app.name}</span>
          </Link>
          <nav aria-label={app.mainNav} className="order-last w-full sm:order-none sm:w-auto">
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
          <div className="ml-auto flex items-center gap-2">
            <AccountMenu />
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
