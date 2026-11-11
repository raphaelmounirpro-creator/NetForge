import { create } from "zustand";

/** Largeur à partir de laquelle les panneaux latéraux sont ouverts par défaut. */
export const WIDE_LAYOUT = 1024;

const wide = () => typeof window !== "undefined" && window.innerWidth >= WIDE_LAYOUT;

interface LabLayoutState {
  paletteOpen: boolean;
  propertiesOpen: boolean;
  togglePalette: () => void;
  toggleProperties: () => void;
  /** Ouvre le panneau droit (ex. pour montrer l'inspection d'une décision). */
  openProperties: () => void;
}

/** Panneaux du laboratoire : état d'affichage de la session, partagé par les vues. */
export const useLabLayout = create<LabLayoutState>()((set) => ({
  paletteOpen: wide(),
  propertiesOpen: wide(),
  togglePalette: () => {
    set((state) => ({ paletteOpen: !state.paletteOpen }));
  },
  toggleProperties: () => {
    set((state) => ({ propertiesOpen: !state.propertiesOpen }));
  },
  openProperties: () => {
    set({ propertiesOpen: true });
  },
}));
