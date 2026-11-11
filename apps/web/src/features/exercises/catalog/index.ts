import { parseExercise, type Exercise } from "@netforge/engine";
import { retourManquant } from "./retourManquant";

/**
 * Exercices embarqués, validés au chargement comme toute donnée externe :
 * un exercice invalide n'est pas proposé (son identifiant est signalé).
 */
const RAW: readonly unknown[] = [retourManquant];

export const exercises: readonly Exercise[] = RAW.flatMap((raw) => {
  const parsed = parseExercise(raw);
  return parsed.ok ? [parsed.exercise] : [];
});

export const invalidExercises: readonly string[] = RAW.flatMap((raw) => {
  const parsed = parseExercise(raw);
  if (parsed.ok) return [];
  const id = typeof raw === "object" && raw !== null && "id" in raw ? String(raw.id) : "?";
  return [id];
});

export function findExercise(id: string): Exercise | undefined {
  return exercises.find((exercise) => exercise.id === id);
}
