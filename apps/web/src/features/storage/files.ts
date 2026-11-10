import { error, LIMITS, type Issue } from "@netforge/project";

/** Propose le téléchargement d'un texte (export .nfg.json). */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Laisse au navigateur le temps de démarrer le téléchargement.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** Lit un fichier choisi par l'utilisateur, en refusant d'emblée un fichier trop volumineux. */
export async function readImportFile(file: File): Promise<{ ok: true; text: string } | { ok: false; errors: Issue[] }> {
  if (file.size > LIMITS.maxImportBytes) {
    return { ok: false, errors: [error("import.too-large", { maxBytes: LIMITS.maxImportBytes })] };
  }
  return { ok: true, text: await file.text() };
}
