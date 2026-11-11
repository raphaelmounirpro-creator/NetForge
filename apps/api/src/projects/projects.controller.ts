import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from "@nestjs/common";
import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  type DoneResponse,
  type ProjectListResponse,
  type ProjectResponse,
  type SaveResponse,
} from "@netforge/contracts";
import { AccountGuard, CurrentUser } from "../auth/account.guard.js";
import { parseBody } from "../common/api-error.js";
import type { User } from "../generated/prisma/client.js";
import { ProjectsService } from "./projects.service.js";

/** Projets privés du compte connecté (adresse validée exigée par AccountGuard). */
@Controller("projects")
@UseGuards(AccountGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@CurrentUser() user: User): Promise<ProjectListResponse> {
    return { projects: await this.projects.list(user.id) };
  }

  @Get(":id")
  get(@CurrentUser() user: User, @Param("id") id: string): Promise<ProjectResponse> {
    return this.projects.get(user.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<SaveResponse> {
    return this.projects.create(user.id, parseBody(createProjectRequestSchema, body).document);
  }

  @Put(":id")
  update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown): Promise<SaveResponse> {
    const { document, expectedRevision } = parseBody(updateProjectRequestSchema, body);
    return this.projects.update(user.id, id, document, expectedRevision);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: User, @Param("id") id: string): Promise<DoneResponse> {
    await this.projects.remove(user.id, id);
    return { status: "done" };
  }
}
