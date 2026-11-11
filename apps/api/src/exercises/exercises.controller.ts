import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from "@nestjs/common";
import {
  createExerciseRequestSchema,
  publishRequestSchema,
  submissionRequestSchema,
  updateExerciseRequestSchema,
  type AttemptResponse,
  type DoneResponse,
  type EvaluationResponse,
  type ExerciseListResponse,
  type ExerciseResponse,
  type ExerciseSaveResponse,
  type MyAttemptsResponse,
  type PublicationListResponse,
  type PublicationSummaryDto,
} from "@netforge/contracts";
import { AccountGuard, CurrentUser } from "../auth/account.guard.js";
import { parseBody } from "../common/api-error.js";
import type { User } from "../generated/prisma/client.js";
import { EvaluationsService } from "./evaluations.service.js";
import { ExercisesService } from "./exercises.service.js";

/** Exercices de l'auteur connecté (adresse validée exigée) et leurs publications. */
@Controller("exercises")
@UseGuards(AccountGuard)
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  async list(@CurrentUser() user: User): Promise<ExerciseListResponse> {
    return { exercises: await this.exercises.list(user.id) };
  }

  @Get(":id")
  get(@CurrentUser() user: User, @Param("id") id: string): Promise<ExerciseResponse> {
    return this.exercises.get(user.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<ExerciseSaveResponse> {
    return this.exercises.create(user.id, parseBody(createExerciseRequestSchema, body).exercise);
  }

  @Put(":id")
  update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown): Promise<ExerciseSaveResponse> {
    const { exercise, expectedRevision } = parseBody(updateExerciseRequestSchema, body);
    return this.exercises.update(user.id, id, exercise, expectedRevision);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: User, @Param("id") id: string): Promise<DoneResponse> {
    await this.exercises.remove(user.id, id);
    return { status: "done" };
  }

  @Post(":id/publications")
  @HttpCode(HttpStatus.CREATED)
  publish(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown): Promise<PublicationSummaryDto> {
    return this.exercises.publish(user.id, id, parseBody(publishRequestSchema, body).maxAttempts);
  }

  @Get(":id/publications")
  async publications(@CurrentUser() user: User, @Param("id") id: string): Promise<PublicationListResponse> {
    return { publications: await this.exercises.publications(user.id, id) };
  }
}

/** Évaluations publiées : passage par l'élève (compte vérifié) et fermeture par l'auteur. */
@Controller()
@UseGuards(AccountGuard)
export class EvaluationsController {
  constructor(
    private readonly evaluations: EvaluationsService,
    private readonly exercises: ExercisesService,
  ) {}

  @Get("evaluations/:code")
  evaluation(@CurrentUser() user: User, @Param("code") code: string): Promise<EvaluationResponse> {
    return this.evaluations.evaluation(user.id, code);
  }

  @Post("evaluations/:code/attempts")
  @HttpCode(HttpStatus.CREATED)
  start(@CurrentUser() user: User, @Param("code") code: string): Promise<AttemptResponse> {
    return this.evaluations.start(user.id, code);
  }

  @Post("evaluations/:code/close")
  @HttpCode(HttpStatus.OK)
  async close(@CurrentUser() user: User, @Param("code") code: string): Promise<DoneResponse> {
    await this.exercises.close(user.id, code);
    return { status: "done" };
  }

  @Get("attempts")
  mine(@CurrentUser() user: User): Promise<MyAttemptsResponse> {
    return this.evaluations.mine(user.id);
  }

  @Get("attempts/:id")
  attempt(@CurrentUser() user: User, @Param("id") id: string): Promise<AttemptResponse> {
    return this.evaluations.attempt(user.id, id);
  }

  @Post("attempts/:id/hints")
  @HttpCode(HttpStatus.OK)
  hint(@CurrentUser() user: User, @Param("id") id: string): Promise<AttemptResponse> {
    return this.evaluations.hint(user.id, id);
  }

  @Post("attempts/:id/submission")
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown): Promise<AttemptResponse> {
    return this.evaluations.submit(user.id, id, parseBody(submissionRequestSchema, body));
  }
}
