import { pathToFileURL } from "node:url";

/** Démarre la pile isolée (apps/api/scripts/e2e-stack.mjs) ; l'arrêt est renvoyé à Playwright. */
export default async function setup(): Promise<() => Promise<void>> {
  const stackUrl = pathToFileURL(new URL("../../api/scripts/e2e-stack.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
  const { startE2eStack } = (await import(stackUrl)) as { startE2eStack: () => Promise<() => Promise<void>> };
  return startE2eStack();
}
