import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  PUBLICATION_CODE_PATTERN,
  type AttemptResponse,
  type AttemptSummaryDto,
  type EvaluationResponse,
  type GradeResultDto,
  type MyAttemptsResponse,
  type SubmissionRequest,
} from "@netforge/contracts";
import { ENGINE_VERSION, evaluationMaxScore, gradeSubmission, publicExercise, type Exercise } from "@netforge/engine";
import { parseNfgValue } from "@netforge/project";
import { apiError } from "../common/api-error.js";
import { Clock } from "../common/clock.js";
import { sha256Hex } from "../common/security.js";
import type { Attempt, Publication } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { RULES } from "../security/rules.js";
import { validateExercise } from "./exercises.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const summary = (attempt: Attempt): AttemptSummaryDto => ({
  id: attempt.id,
  startedAt: attempt.startedAt.toISOString(),
  submittedAt: attempt.submittedAt?.toISOString() ?? null,
  score: attempt.score,
  maxScore: attempt.maxScore,
});

/**
 * Passage des évaluations (élève, compte vérifié). Le navigateur ne reçoit que
 * la partie publique de l'instantané ; les indices sont délivrés et comptés
 * ici ; la note est calculée ici par le moteur (version enregistrée), jamais
 * reçue du navigateur. Une soumission refusée (projet invalide, modification
 * interdite, limite d'évaluation) ne consomme pas la tentative.
 */
@Injectable()
export class EvaluationsService {
  private readonly logger = new Logger("Evaluations");

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly limits: RateLimitService,
  ) {}

  private async publication(code: string): Promise<Publication> {
    if (!PUBLICATION_CODE_PATTERN.test(code)) throw apiError(HttpStatus.NOT_FOUND, "evaluation.not-found");
    const publication = await this.prisma.publication.findUnique({ where: { code } });
    if (!publication) throw apiError(HttpStatus.NOT_FOUND, "evaluation.not-found");
    return publication;
  }

  /** L'instantané a été validé à la publication ; il est relu comme toute donnée enregistrée. */
  private exercise(publication: Publication): Exercise {
    return validateExercise(publication.content);
  }

  private async rate(rule: (typeof RULES)[keyof typeof RULES], subject: string): Promise<void> {
    const { allowed, retryAfterSeconds } = await this.limits.consume(rule, subject);
    if (!allowed) throw apiError(HttpStatus.TOO_MANY_REQUESTS, "evaluation.rate-limited", { retryAfterSeconds });
  }

  async evaluation(userId: string, code: string): Promise<EvaluationResponse> {
    const publication = await this.publication(code);
    const attempts = await this.prisma.attempt.findMany({ where: { publicationId: publication.id, userId }, orderBy: { startedAt: "asc" } });
    return {
      code,
      exercise: publicExercise(this.exercise(publication)),
      maxAttempts: publication.maxAttempts,
      closed: publication.closedAt !== null,
      attempts: attempts.map(summary),
    };
  }

  /** Nouvelle tentative, ou reprise de la tentative en cours (une seule ouverte à la fois). */
  async start(userId: string, code: string): Promise<AttemptResponse> {
    const publication = await this.publication(code);
    if (publication.closedAt) throw apiError(HttpStatus.CONFLICT, "evaluation.closed");
    const open = await this.prisma.attempt.findFirst({ where: { publicationId: publication.id, userId, submittedAt: null } });
    if (open) return this.response(open, publication);
    await this.rate(RULES.attemptStartAccount, userId);
    const used = await this.prisma.attempt.count({ where: { publicationId: publication.id, userId } });
    if (used >= publication.maxAttempts) throw apiError(HttpStatus.CONFLICT, "evaluation.no-attempts-left");
    const attempt = await this.prisma.attempt.create({
      data: { publicationId: publication.id, userId, startedAt: this.clock.now(), maxScore: evaluationMaxScore(this.exercise(publication)) },
    });
    return this.response(attempt, publication);
  }

  private async owned(userId: string, id: string): Promise<{ attempt: Attempt; publication: Publication }> {
    if (!UUID.test(id)) throw apiError(HttpStatus.NOT_FOUND, "evaluation.not-found");
    const attempt = await this.prisma.attempt.findFirst({ where: { id, userId }, include: { publication: true } });
    if (!attempt) throw apiError(HttpStatus.NOT_FOUND, "evaluation.not-found");
    const { publication, ...rest } = attempt;
    return { attempt: rest, publication };
  }

  async attempt(userId: string, id: string): Promise<AttemptResponse> {
    const { attempt, publication } = await this.owned(userId, id);
    return this.response(attempt, publication);
  }

  /** Indice suivant : délivré et compté par le serveur (incrément atomique sur une tentative ouverte). */
  async hint(userId: string, id: string): Promise<AttemptResponse> {
    const { attempt, publication } = await this.owned(userId, id);
    if (attempt.submittedAt) throw apiError(HttpStatus.CONFLICT, "evaluation.already-submitted");
    if (attempt.hintsRevealed >= this.exercise(publication).hints.length) throw apiError(HttpStatus.CONFLICT, "evaluation.no-more-hints");
    const updated = await this.prisma.attempt.updateMany({
      where: { id, userId, submittedAt: null, hintsRevealed: attempt.hintsRevealed },
      data: { hintsRevealed: { increment: 1 } },
    });
    if (updated.count === 0) throw apiError(HttpStatus.CONFLICT, "evaluation.already-submitted");
    return this.attempt(userId, id);
  }

  async submit(userId: string, id: string, submission: SubmissionRequest): Promise<AttemptResponse> {
    const { attempt, publication } = await this.owned(userId, id);
    if (attempt.submittedAt) throw apiError(HttpStatus.CONFLICT, "evaluation.already-submitted");
    if (publication.closedAt) throw apiError(HttpStatus.CONFLICT, "evaluation.closed");
    await this.rate(RULES.submissionAccount, userId);
    const project = parseNfgValue(submission.project);
    if (!project.ok) {
      throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, "evaluation.invalid-project", { issues: project.errors.slice(0, 50).map((issue) => ({ code: issue.code, params: issue.params })) });
    }
    const exercise = this.exercise(publication);
    const started = performance.now();
    const grade = gradeSubmission(exercise, project.document, submission.answers, attempt.hintsRevealed);
    const elapsed = Math.round(performance.now() - started);
    if (!grade.ok) {
      this.logger.log(`Soumission refusée (${grade.reason}) en ${String(elapsed)} ms`);
      switch (grade.reason) {
        case "limit":
          throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, "evaluation.limit-exceeded", { limit: grade.limit, max: grade.max, step: grade.step });
        case "forbidden-change":
          throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, "evaluation.forbidden-change", { changes: [...grade.changes] });
        case "invalid-project":
          throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, "evaluation.invalid-project", { issues: grade.issues.slice(0, 50).map((issue) => ({ code: issue.code, params: issue.params })) });
        case "invalid-answer":
          throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, "evaluation.invalid-answer", { step: grade.step });
      }
    }
    const result: GradeResultDto = {
      evaluatorVersion: grade.evaluatorVersion,
      engineVersion: ENGINE_VERSION,
      steps: grade.steps.map((step) => ({ ...step })),
      earned: grade.earned,
      hintPenalty: grade.hintPenalty,
      score: grade.score,
      max: grade.max,
    };
    // Note enregistrée une seule fois, avec le nombre d'indices utilisé pour la calculer.
    const saved = await this.prisma.attempt.updateMany({
      where: { id, userId, submittedAt: null, hintsRevealed: attempt.hintsRevealed },
      data: {
        submittedAt: this.clock.now(),
        score: grade.score,
        maxScore: grade.max,
        result,
        evaluatorVersion: grade.evaluatorVersion,
        engineVersion: ENGINE_VERSION,
        submissionHash: sha256Hex(JSON.stringify({ project: project.document, answers: submission.answers })),
      },
    });
    if (saved.count === 0) throw apiError(HttpStatus.CONFLICT, "evaluation.already-submitted");
    this.logger.log(`Soumission notée en ${String(elapsed)} ms`);
    return this.attempt(userId, id);
  }

  async mine(userId: string): Promise<MyAttemptsResponse> {
    const rows = await this.prisma.attempt.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 200,
      include: { publication: { select: { code: true, title: true } } },
    });
    return { attempts: rows.map((row) => ({ ...summary(row), code: row.publication.code, title: row.publication.title })) };
  }

  private response(attempt: Attempt, publication: Publication): AttemptResponse {
    const exercise = this.exercise(publication);
    const submitted = attempt.submittedAt !== null;
    return {
      id: attempt.id,
      code: publication.code,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      hints: exercise.hints.slice(0, attempt.hintsRevealed),
      hintCount: exercise.hints.length,
      result: submitted ? (attempt.result as GradeResultDto) : null,
      debrief: submitted ? exercise.steps.flatMap((step) => (step.kind === "debrief" ? [{ title: step.title, text: step.text }] : [])) : null,
    };
  }
}
