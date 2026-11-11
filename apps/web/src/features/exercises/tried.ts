import { parseExercise, type Exercise } from "@netforge/engine";

/**
 * Exercices du compte essayés en entraînement par leur auteur : copiés sur
 * l'appareil pour que le guide les retrouve (relus et validés comme toute
 * donnée externe). L'auteur voit de toute façon l'exercice complet.
 */
const KEY = "netforge.exercise.tried";
const MAX_TRIED = 10;

let cache: { raw: string; exercises: Map<string, Exercise> } | null = null;

function readAll(): Map<string, Exercise> {
  let raw = "{}";
  try {
    raw = localStorage.getItem(KEY) ?? "{}";
  } catch {
    // Stockage indisponible.
  }
  if (cache?.raw === raw) return cache.exercises;
  const exercises = new Map<string, Exercise>();
  try {
    const stored = JSON.parse(raw) as unknown;
    if (typeof stored === "object" && stored !== null) {
      for (const value of Object.values(stored)) {
        const parsed = parseExercise(value);
        if (parsed.ok) exercises.set(parsed.exercise.id, parsed.exercise);
      }
    }
  } catch {
    // Contenu illisible : ignoré.
  }
  cache = { raw, exercises };
  return exercises;
}

export function findTried(id: string): Exercise | undefined {
  return readAll().get(id);
}

export function rememberTried(exercise: Exercise): void {
  const entries = [...readAll().entries()].filter(([id]) => id !== exercise.id).slice(-(MAX_TRIED - 1));
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...entries, [exercise.id, exercise]])));
  } catch {
    // Stockage indisponible : l'essai ne sera pas guidé après rechargement.
  }
}
