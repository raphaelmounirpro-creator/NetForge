import type { ReactNode } from "react";
import photo1376 from "../../assets/connexion-1376.webp";
import photo640 from "../../assets/connexion-640.webp";
import photo960 from "../../assets/connexion-960.webp";
import { messages } from "../../i18n";

const t = messages.account;

/**
 * Accueil des parcours de compte (spécification §15.3) : visuel à gauche
 * (environ 58 %), panneau opaque à droite (42 %). Photo fournie par le
 * propriétaire (salle technique au coucher du soleil, D-047), décorative :
 * le sens est porté par les textes. Un dégradé bleu nuit garantit la
 * lisibilité des textes posés dessus. Sous 1 024 px, le visuel se réduit à
 * un bandeau au-dessus du formulaire.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <section
        aria-label={t.signature}
        className="relative flex shrink-0 flex-col justify-end overflow-hidden bg-hero px-6 py-8 text-on-hero lg:w-[58%] lg:px-12 lg:py-16"
      >
        <img
          src={photo960}
          srcSet={`${photo640} 640w, ${photo960} 960w, ${photo1376} 1376w`}
          sizes="(min-width: 1024px) 58vw, 100vw"
          alt=""
          width={1376}
          height={768}
          decoding="async"
          fetchPriority="high"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[40%_center]"
        />
        {/* Bandeau mobile : le texte couvre presque toute la hauteur, voile uniforme (contraste AA de l'ambre sur le ciel clair). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[color-mix(in_srgb,var(--color-hero)_80%,transparent)] lg:bg-transparent lg:bg-[linear-gradient(to_top,var(--color-hero)_0%,color-mix(in_srgb,var(--color-hero)_88%,transparent)_30%,color-mix(in_srgb,var(--color-hero)_30%,transparent)_65%,transparent_100%)]"
        />
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
