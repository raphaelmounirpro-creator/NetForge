import { z } from "zod";

/**
 * Exercices du compte et évaluations notées par le serveur (phase 6).
 *
 * - Exercices : privés à leur auteur, contenu complet au format
 *   « netforge-exercise » validé par le moteur côté serveur.
 * - Publications : instantané immuable d'une révision, joignable par un code
 *   non devinable ; nombre de tentatives borné.
 * - Tentatives : l'élève ne reçoit que la partie publique ; indices délivrés
 *   et comptés par le serveur ; la note est calculée par le serveur, jamais
 *   déclarée par le navigateur (corps de soumission strict, sans score).
 */
export const MAX_ACCOUNT_EXERCISES = 100;
export const MAX_PUBLICATIONS_PER_EXERCISE = 20;
export const MAX_ATTEMPTS_PER_PUBLICATION = 10;
/** 12 caractères base32 : 60 bits aléatoires. */
export const PUBLICATION_CODE_PATTERN = /^[a-z2-7]{12}$/;

const isoDate = z.iso.datetime();
const code = z.string().regex(PUBLICATION_CODE_PATTERN);

// --- Auteur -----------------------------------------------------------------

export const exerciseSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  revision: z.int().min(1),
  savedAt: isoDate,
  publicationCount: z.int().min(0),
});
export type ExerciseSummaryDto = z.infer<typeof exerciseSummarySchema>;

export const exerciseListResponseSchema = z.strictObject({ exercises: z.array(exerciseSummarySchema).max(MAX_ACCOUNT_EXERCISES) });
export type ExerciseListResponse = z.infer<typeof exerciseListResponseSchema>;

export const exerciseResponseSchema = z.strictObject({ id: z.uuid(), revision: z.int().min(1), savedAt: isoDate, exercise: z.unknown() });
export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;

export const createExerciseRequestSchema = z.strictObject({ exercise: z.unknown() });
export const updateExerciseRequestSchema = z.strictObject({ exercise: z.unknown(), expectedRevision: z.int().min(1) });

export const exerciseSaveResponseSchema = z.strictObject({ id: z.uuid(), revision: z.int().min(1), savedAt: isoDate });
export type ExerciseSaveResponse = z.infer<typeof exerciseSaveResponseSchema>;

export const publishRequestSchema = z.strictObject({ maxAttempts: z.int().min(1).max(MAX_ATTEMPTS_PER_PUBLICATION) });

export const publicationSummarySchema = z.strictObject({
  code,
  exerciseRevision: z.int().min(1),
  maxAttempts: z.int().min(1),
  createdAt: isoDate,
  closedAt: isoDate.nullable(),
  /** Nombre de tentatives commencées (aucune donnée sur les élèves : consultation des notes en phase 17). */
  attemptCount: z.int().min(0),
});
export type PublicationSummaryDto = z.infer<typeof publicationSummarySchema>;

export const publicationListResponseSchema = z.strictObject({ publications: z.array(publicationSummarySchema).max(MAX_PUBLICATIONS_PER_EXERCISE) });
export type PublicationListResponse = z.infer<typeof publicationListResponseSchema>;

// --- Élève ------------------------------------------------------------------

export const attemptSummarySchema = z.strictObject({
  id: z.uuid(),
  startedAt: isoDate,
  submittedAt: isoDate.nullable(),
  score: z.int().min(0).nullable(),
  maxScore: z.int().min(0),
});
export type AttemptSummaryDto = z.infer<typeof attemptSummarySchema>;

/** Partie publique de l'exercice (type PublicExercise du moteur), relue par le client comme donnée externe. */
export const evaluationResponseSchema = z.strictObject({
  code,
  exercise: z.unknown(),
  maxAttempts: z.int().min(1),
  closed: z.boolean(),
  attempts: z.array(attemptSummarySchema).max(MAX_ATTEMPTS_PER_PUBLICATION),
});
export type EvaluationResponse = z.infer<typeof evaluationResponseSchema>;

export const stepGradeSchema = z.strictObject({
  step: z.int().min(0),
  kind: z.enum(["observe", "hypothesis", "measure", "fix", "retest", "debrief"]),
  title: z.string(),
  points: z.int().min(0),
  max: z.int().min(0),
  status: z.enum(["earned", "missed", "not-graded"]),
});

export const gradeResultSchema = z.strictObject({
  evaluatorVersion: z.int().min(1),
  engineVersion: z.string(),
  steps: z.array(stepGradeSchema).max(12),
  earned: z.int().min(0),
  hintPenalty: z.int().min(0),
  score: z.int().min(0),
  max: z.int().min(0),
});
export type GradeResultDto = z.infer<typeof gradeResultSchema>;

export const attemptResponseSchema = z.strictObject({
  id: z.uuid(),
  code,
  startedAt: isoDate,
  submittedAt: isoDate.nullable(),
  /** Indices déjà délivrés, dans l'ordre. */
  hints: z.array(z.string()).max(5),
  hintCount: z.int().min(0),
  result: gradeResultSchema.nullable(),
  /** Bilans de l'exercice, révélés seulement après la soumission notée. */
  debrief: z.array(z.strictObject({ title: z.string(), text: z.string() })).nullable(),
});
export type AttemptResponse = z.infer<typeof attemptResponseSchema>;

export const answerRequestSchema = z.strictObject({
  step: z.int().min(0).max(11),
  choice: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  value: z.string().max(40).optional(),
});

/** Soumission : le projet final et les réponses, rien d'autre (un score déclaré est refusé). */
export const submissionRequestSchema = z.strictObject({
  project: z.unknown(),
  answers: z.array(answerRequestSchema).max(12),
});
export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;

export const myAttemptsResponseSchema = z.strictObject({
  attempts: z.array(attemptSummarySchema.extend({ code, title: z.string() })).max(200),
});
export type MyAttemptsResponse = z.infer<typeof myAttemptsResponseSchema>;
