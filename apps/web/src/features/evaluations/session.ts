import type { PublicExercise } from "@netforge/engine";
import { navigate } from "../../app/router";
import { projectService } from "../lab/services";
import { useLabStore } from "../lab/store";
import { useEvaluationLinks } from "./links";

const PREFIX = "netforge.evaluation.";

/** Projet de l'appareil déjà relié à cette tentative (reprise), s'il existe encore. */
function linkedProject(attemptId: string): string | null {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const projectId = key.slice(PREFIX.length);
      if (useEvaluationLinks.getState().load(projectId)?.attemptId === attemptId) return projectId;
    }
  } catch {
    // Stockage indisponible : un nouveau projet sera créé.
  }
  return null;
}

/**
 * Ouvre le travail d'une tentative dans le laboratoire : le projet déjà relié
 * si la tentative est reprise, sinon une copie de la topologie initiale.
 */
export async function openAttempt(code: string, attemptId: string, exercise: PublicExercise): Promise<boolean> {
  const view = exercise.allowed.includes("optics") || exercise.allowed.includes("pon") ? "optics" : "simulation";
  const existing = linkedProject(attemptId);
  if (existing) {
    const opened = await projectService.openStored(existing);
    if (opened.ok) {
      navigate("/laboratoire");
      return true;
    }
  }
  const outcome = await projectService.createFrom(exercise.project, exercise.title);
  if (outcome.kind !== "imported") return false;
  useEvaluationLinks.getState().save(outcome.id, { code, attemptId, answers: {} });
  useLabStore.getState().setView(outcome.id, view);
  navigate("/laboratoire");
  return true;
}
