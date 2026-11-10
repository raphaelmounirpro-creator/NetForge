import { ENGINE_VERSION } from "@netforge/engine";
import { LogoMark } from "./components/brand/Logo";
import { Panel } from "./components/ui/Panel";
import { ServiceStatusPanel } from "./features/service-status/ServiceStatusPanel";
import { ThemeToggle } from "./features/theme/ThemeToggle";
import { messages } from "./i18n";

const { app, home, roadmap, footer } = messages;

export function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-canvas">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <a href="/" aria-label={app.homeLabel} className="flex items-center gap-2.5 rounded-sm">
            <LogoMark size={28} />
            <span className="text-base font-semibold tracking-wide text-text">{app.name}</span>
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.16em] text-accent-text uppercase">{app.tagline}</p>
          <h1 className="mt-3 text-3xl font-semibold text-balance text-text sm:text-4xl">{home.title}</h1>
          <p className="mt-4 text-base leading-relaxed text-text-muted">{home.intro}</p>
          <p className="mt-3 text-base leading-relaxed text-text-muted">{home.honesty}</p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <ServiceStatusPanel />

          <Panel title={roadmap.title}>
            <ol className="space-y-3">
              {roadmap.steps.map((step) => (
                <li key={step.phase} className="flex gap-3">
                  <span
                    className={`mt-0.5 w-16 shrink-0 self-start rounded-sm border py-0.5 text-center text-xs font-semibold ${
                      step.current ? "border-accent-text text-accent-text" : "border-border text-text-muted"
                    }`}
                  >
                    {step.phase}
                  </span>
                  <span className="text-sm text-text">
                    {step.label}
                    <span className="block text-xs text-text-muted">{step.current ? roadmap.current : roadmap.planned}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto w-full max-w-5xl px-4 py-4 text-xs text-text-muted sm:px-6">
          {app.name} · {footer.engine} {ENGINE_VERSION}
        </p>
      </footer>
    </div>
  );
}
