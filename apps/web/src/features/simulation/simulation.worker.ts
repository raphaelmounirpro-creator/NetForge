import "../../zodConfig";
import { createSimulationHost } from "@netforge/engine";

/**
 * Web Worker du moteur : le calcul ne bloque jamais le fil de l'interface.
 * Ce fichier ne fait que relier les messages du navigateur à l'adaptateur
 * du moteur ; toute la logique est dans @netforge/engine (testée sans navigateur).
 */
interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;

const host = createSimulationHost({
  post: (message) => {
    scope.postMessage(message);
  },
  now: () => performance.now(),
  setTimer: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(handle);
    };
  },
});

scope.onmessage = (event) => {
  host.receive(event.data);
};
