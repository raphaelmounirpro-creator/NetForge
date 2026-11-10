import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { messages } from "../../i18n";

type Theme = "dark" | "light";

// Préférence d'affichage propre à cet appareil ; jamais une donnée de compte.
const STORAGE_KEY = "netforge.theme";

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Bascule entre le thème sombre (identité par défaut) et le thème clair équivalent. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Stockage indisponible (navigation privée, quota) : le thème reste appliqué pour la session.
    }
  }, [theme]);

  const label = theme === "dark" ? messages.theme.switchToLight : messages.theme.switchToDark;
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(theme === "dark" ? "light" : "dark");
      }}
      aria-label={label}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-md border border-transparent text-text-muted transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-border hover:text-text"
    >
      <Icon aria-hidden="true" size={20} strokeWidth={2} />
    </button>
  );
}
