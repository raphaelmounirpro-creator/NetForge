import { exerciseProgressSchema, newProgress, type Exercise, type ExerciseProgress } from "@netforge/engine";
import { create } from "zustand";
import { navigate } from "../../app/router";
import { projectService } from "../lab/services";
import { useLabStore } from "../lab/store";
import { findExercise } from "./catalog";

/**
 * Progression des exercices, par projet, enregistrée sur l'appareil
 * (localStorage). Relue comme une donnée externe : une progression invalide
 * ou d'une autre révision de l'exercice est ignorée.
 */
const keyOf = (projectId: string) => `netforge.exercise.${projectId}`;

function read(projectId: string): ExerciseProgress | null {
  try {
    const raw = localStorage.getItem(keyOf(projectId));
    if (raw === null) return null;
    const parsed = exerciseProgressSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const exercise = findExercise(parsed.data.exerciseId);
    return exercise?.revision === parsed.data.revision ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(projectId: string, progress: ExerciseProgress): void {
  try {
    localStorage.setItem(keyOf(projectId), JSON.stringify(progress));
  } catch {
    // Stockage indisponible : la progression vaut pour la session.
  }
}

interface ExerciseState {
  /** Progressions connues (null : le projet n'est pas un exercice). */
  progress: Readonly<Record<string, ExerciseProgress | null>>;
  load: (projectId: string) => ExerciseProgress | null;
  save: (projectId: string, progress: ExerciseProgress) => void;
}

export const useExerciseStore = create<ExerciseState>()((set, get) => ({
  progress: {},
  load: (projectId) => {
    const known = get().progress[projectId];
    if (known !== undefined) return known;
    const loaded = read(projectId);
    set((state) => ({ progress: { ...state.progress, [projectId]: loaded } }));
    return loaded;
  },
  save: (projectId, progress) => {
    write(projectId, progress);
    set((state) => ({ progress: { ...state.progress, [projectId]: progress } }));
  },
}));

/** Commence un exercice : nouveau projet (copie de la topologie initiale) ouvert dans le laboratoire. */
export async function startExercise(exercise: Exercise): Promise<boolean> {
  const outcome = await projectService.createFrom(exercise.project, exercise.project.metadata.name);
  if (outcome.kind !== "imported") return false;
  useExerciseStore.getState().save(outcome.id, newProgress(exercise));
  useLabStore.getState().setView(outcome.id, exercise.allowed.includes("optics") ? "optics" : "simulation");
  navigate("/laboratoire");
  return true;
}
