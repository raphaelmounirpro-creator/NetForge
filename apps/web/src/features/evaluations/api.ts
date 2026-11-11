import {
  attemptResponseSchema,
  doneResponseSchema,
  evaluationResponseSchema,
  exerciseListResponseSchema,
  exerciseResponseSchema,
  exerciseSaveResponseSchema,
  myAttemptsResponseSchema,
  publicationListResponseSchema,
  publicationSummarySchema,
  type SubmissionRequest,
} from "@netforge/contracts";
import { apiRequest } from "../account/api";

/**
 * Exercices du compte et évaluations notées (phase 6). Toutes les réponses
 * sont relues avec les contrats partagés ; la partie publique d'un exercice
 * est en plus validée par le moteur (parsePublicExercise) à l'usage.
 */
export const evaluationsApi = {
  listExercises: () => apiRequest("GET", "/exercises", exerciseListResponseSchema),
  getExercise: (id: string) => apiRequest("GET", `/exercises/${encodeURIComponent(id)}`, exerciseResponseSchema),
  createExercise: (exercise: unknown) => apiRequest("POST", "/exercises", exerciseSaveResponseSchema, { exercise }),
  updateExercise: (id: string, exercise: unknown, expectedRevision: number) =>
    apiRequest("PUT", `/exercises/${encodeURIComponent(id)}`, exerciseSaveResponseSchema, { exercise, expectedRevision }),
  deleteExercise: (id: string) => apiRequest("DELETE", `/exercises/${encodeURIComponent(id)}`, doneResponseSchema),
  publish: (id: string, maxAttempts: number) => apiRequest("POST", `/exercises/${encodeURIComponent(id)}/publications`, publicationSummarySchema, { maxAttempts }),
  publications: (id: string) => apiRequest("GET", `/exercises/${encodeURIComponent(id)}/publications`, publicationListResponseSchema),
  close: (code: string) => apiRequest("POST", `/evaluations/${encodeURIComponent(code)}/close`, doneResponseSchema),

  evaluation: (code: string) => apiRequest("GET", `/evaluations/${encodeURIComponent(code)}`, evaluationResponseSchema),
  start: (code: string) => apiRequest("POST", `/evaluations/${encodeURIComponent(code)}/attempts`, attemptResponseSchema),
  attempt: (id: string) => apiRequest("GET", `/attempts/${encodeURIComponent(id)}`, attemptResponseSchema),
  hint: (id: string) => apiRequest("POST", `/attempts/${encodeURIComponent(id)}/hints`, attemptResponseSchema),
  submit: (id: string, submission: SubmissionRequest) => apiRequest("POST", `/attempts/${encodeURIComponent(id)}/submission`, attemptResponseSchema, submission),
  mine: () => apiRequest("GET", "/attempts", myAttemptsResponseSchema),
};
