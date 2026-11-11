import { randomBytes } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  MAX_ACCOUNT_EXERCISES,
  MAX_PUBLICATIONS_PER_EXERCISE,
  type ExerciseResponse,
  type ExerciseSaveResponse,
  type ExerciseSummaryDto,
  type PublicationSummaryDto,
} from "@netforge/contracts";
import { evaluationReadiness, parseExercise, type Exercise } from "@netforge/engine";
import { apiError } from "../common/api-error.js";
import { Clock } from "../common/clock.js";
import { sha256Hex } from "../common/security.js";
import { PrismaService } from "../prisma/prisma.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Code de publication : 12 caractères base32, soit 60 bits aléatoires (non devinable, sans énumération). */
export function publicationCode(): string {
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => BASE32.charAt(byte & 31)).join("");
}

/** Valide un exercice reçu (donnée externe) ; le contenu enregistré est la forme validée et migrée. */
export function validateExercise(raw: unknown): Exercise {
  const parsed = parseExercise(raw);
  if (!parsed.ok) {
    throw apiError(HttpStatus.BAD_REQUEST, "exercise.invalid", {
      paths: parsed.paths.slice(0, 50),
      issues: parsed.issues.slice(0, 50).map((issue) => ({ code: issue.code, params: issue.params })),
    });
  }
  return parsed.exercise;
}

/**
 * Exercices du compte : privés à leur auteur (un exercice d'un autre compte
 * est traité comme inexistant). Publication = instantané immuable d'une
 * révision, joignable par un code non devinable.
 */
@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(ownerId: string): Promise<ExerciseSummaryDto[]> {
    const rows = await this.prisma.exercise.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      take: MAX_ACCOUNT_EXERCISES,
      select: { id: true, title: true, revision: true, updatedAt: true, _count: { select: { publications: true } } },
    });
    return rows.map((row) => ({ id: row.id, title: row.title, revision: row.revision, savedAt: row.updatedAt.toISOString(), publicationCount: row._count.publications }));
  }

  private async owned(ownerId: string, id: string) {
    if (!UUID.test(id)) throw apiError(HttpStatus.NOT_FOUND, "exercise.not-found");
    const exercise = await this.prisma.exercise.findFirst({ where: { id, ownerId } });
    if (!exercise) throw apiError(HttpStatus.NOT_FOUND, "exercise.not-found");
    return exercise;
  }

  async get(ownerId: string, id: string): Promise<ExerciseResponse> {
    const exercise = await this.owned(ownerId, id);
    return { id: exercise.id, revision: exercise.revision, savedAt: exercise.updatedAt.toISOString(), exercise: exercise.content };
  }

  async create(ownerId: string, raw: unknown): Promise<ExerciseSaveResponse> {
    const exercise = validateExercise(raw);
    if ((await this.prisma.exercise.count({ where: { ownerId } })) >= MAX_ACCOUNT_EXERCISES) throw apiError(HttpStatus.CONFLICT, "exercise.too-many");
    const created = await this.prisma.exercise.create({ data: { ownerId, title: exercise.title, content: exercise } });
    return { id: created.id, revision: created.revision, savedAt: created.updatedAt.toISOString() };
  }

  /** Nouvelle révision, seulement si la révision enregistrée est celle que le client a lue. */
  async update(ownerId: string, id: string, raw: unknown, expectedRevision: number): Promise<ExerciseSaveResponse> {
    const exercise = validateExercise(raw);
    await this.owned(ownerId, id);
    const result = await this.prisma.exercise.updateMany({
      where: { id, ownerId, revision: expectedRevision },
      data: { title: exercise.title, content: exercise, revision: { increment: 1 } },
    });
    const stored = await this.owned(ownerId, id);
    if (result.count === 0) throw apiError(HttpStatus.CONFLICT, "exercise.conflict", { storedRevision: stored.revision });
    return { id, revision: stored.revision, savedAt: stored.updatedAt.toISOString() };
  }

  /** Les publications restent valables (instantanés) ; leurs tentatives sont conservées. */
  async remove(ownerId: string, id: string): Promise<void> {
    await this.owned(ownerId, id);
    await this.prisma.exercise.deleteMany({ where: { id, ownerId } });
  }

  async publish(ownerId: string, id: string, maxAttempts: number): Promise<PublicationSummaryDto> {
    const stored = await this.owned(ownerId, id);
    const exercise = validateExercise(stored.content);
    const readiness = evaluationReadiness(exercise);
    if (!readiness.ok) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, "evaluation.not-ready", { reason: readiness.reason, ...(readiness.max === undefined ? {} : { max: readiness.max }) });
    if ((await this.prisma.publication.count({ where: { exerciseId: id } })) >= MAX_PUBLICATIONS_PER_EXERCISE) throw apiError(HttpStatus.CONFLICT, "exercise.too-many");
    const content = exercise as object;
    const contentHash = sha256Hex(JSON.stringify(content));
    // 60 bits aléatoires : une collision est improbable, mais l'unicité est garantie par la base.
    for (let tries = 0; tries < 3; tries += 1) {
      const code = publicationCode();
      if (await this.prisma.publication.findUnique({ where: { code }, select: { id: true } })) continue;
      const publication = await this.prisma.publication.create({
        data: { code, ownerId, exerciseId: id, exerciseRevision: stored.revision, title: exercise.title, content, contentHash, maxAttempts },
      });
      return { code, exerciseRevision: publication.exerciseRevision, maxAttempts, createdAt: publication.createdAt.toISOString(), closedAt: null, attemptCount: 0 };
    }
    throw apiError(HttpStatus.SERVICE_UNAVAILABLE, "server.unavailable");
  }

  async publications(ownerId: string, id: string): Promise<PublicationSummaryDto[]> {
    await this.owned(ownerId, id);
    const rows = await this.prisma.publication.findMany({
      where: { exerciseId: id, ownerId },
      orderBy: { createdAt: "desc" },
      take: MAX_PUBLICATIONS_PER_EXERCISE,
      include: { _count: { select: { attempts: true } } },
    });
    return rows.map((row) => ({
      code: row.code,
      exerciseRevision: row.exerciseRevision,
      maxAttempts: row.maxAttempts,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      attemptCount: row._count.attempts,
    }));
  }

  /** Fermeture par l'auteur : plus de nouvelle tentative ni de soumission. */
  async close(ownerId: string, code: string): Promise<void> {
    const result = await this.prisma.publication.updateMany({ where: { code, ownerId, closedAt: null }, data: { closedAt: this.clock.now() } });
    if (result.count === 0 && !(await this.prisma.publication.findFirst({ where: { code, ownerId }, select: { id: true } }))) {
      throw apiError(HttpStatus.NOT_FOUND, "evaluation.not-found");
    }
  }
}
