import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useAccountStore } from "./features/account/store";
import { installUnloadProtection, projectService } from "./features/lab/services";
import { installSimulationLifecycle } from "./features/simulation/services";
import "./styles/index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Élément racine #root introuvable dans index.html");
}

installUnloadProtection();
installSimulationLifecycle();
// Session du compte (si l'API répond), puis réouverture des projets de la dernière visite :
// ceux du compte ne sont relus que si la session est valide.
void useAccountStore
  .getState()
  .refresh()
  .then(() => projectService.restoreSession());

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
