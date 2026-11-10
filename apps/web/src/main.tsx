import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installUnloadProtection, projectService } from "./features/lab/services";
import "./styles/index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Élément racine #root introuvable dans index.html");
}

installUnloadProtection();
// Rouvre les projets qui étaient ouverts lors de la dernière visite (récupération locale).
void projectService.restoreSession();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
