import type { ReactNode } from "react";
import { messages } from "../../i18n";

const t = messages.account;

/**
 * Accueil des parcours de compte (spécification §15.3) : visuel à gauche
 * (environ 58 %), panneau opaque à droite (42 %). La photo de référence n'est
 * pas encore fournie : fond sobre bleu nuit et lueur ambre localisée, à
 * remplacer par le visuel validé (docs/DESIGN.md). Sous 1 024 px, le visuel
 * se réduit à un bandeau au-dessus du formulaire.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <section
        aria-label={t.signature}
        className="relative flex shrink-0 flex-col justify-end overflow-hidden bg-hero px-6 py-8 text-on-hero lg:w-[58%] lg:px-12 lg:py-16"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_110%,color-mix(in_srgb,var(--color-accent)_35%,transparent),transparent_60%)]" />
        <div className="relative max-w-xl">
          <p className="text-xs font-semibold tracking-[0.3em] text-accent">{t.signature}</p>
          <p className="mt-3 text-3xl font-semibold lg:text-5xl">{t.tagline}</p>
          <p className="mt-3 text-base text-on-hero-muted lg:text-lg">{t.subtitle}</p>
        </div>
      </section>
      <div className="flex flex-1 items-start justify-center bg-surface px-4 py-8 sm:px-8 lg:items-center lg:py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
