import { useEffect, useState } from "react";

const TOKENS = ["canvas", "surface", "surface-raised", "border", "border-strong", "text", "text-muted", "accent", "accent-text", "signal", "danger", "warning"] as const;

export type ThemeColors = Record<(typeof TOKENS)[number], string>;

/**
 * Konva dessine sur un <canvas> et ne lit pas les variables CSS : on résout
 * chaque jeton (y compris light-dark()) via une sonde invisible.
 */
function readColors(): ThemeColors {
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.append(probe);
  const colors = {} as ThemeColors;
  for (const token of TOKENS) {
    probe.style.color = `var(--color-${token})`;
    colors[token] = getComputedStyle(probe).color;
  }
  probe.remove();
  return colors;
}

/** Couleurs du thème actif, relues à chaque changement de thème. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setColors(readColors());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
    };
  }, []);
  return colors;
}
