import { HttpStatus, Injectable } from "@nestjs/common";
import { MAX_ACCOUNT_PROJECTS, type ProjectResponse, type ProjectSummaryDto, type SaveResponse } from "@netforge/contracts";
import { parseNfgValue, type NfgDocument } from "@netforge/project";
import { apiError } from "../common/api-error.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Projets privés : chaque lecture, modification et suppression est
 * restreinte au propriétaire. Un projet d'un autre compte est traité comme
 * inexistant (même réponse 404). Le contenu est validé (et migré) comme un
 * import .nfg.json ; la révision détecte les écritures concurrentes.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  private validate(raw: unknown): NfgDocument {
    const parsed = parseNfgValue(raw);
    if (!parsed.ok) {
      throw apiError(HttpStatus.BAD_REQUEST, "project.invalid", { issues: parsed.errors.slice(0, 50).map((issue) => ({ code: issue.code, params: issue.params })) });
    }
    if (!UUID.test(parsed.document.metadata.id)) throw apiError(HttpStatus.BAD_REQUEST, "project.invalid");
    return parsed.document;
  }

  async list(ownerId: string): Promise<ProjectSummaryDto[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; revision: number; updated_at: Date; device_count: number; link_count: number }[]>`
      SELECT id, name, revision, updated_at,
        COALESCE(json_array_length(content->'topology'->'devices'), 0)::int AS device_count,
        COALESCE(json_array_length(content->'topology'->'links'), 0)::int AS link_count
      FROM projects WHERE owner_id = ${ownerId}::uuid ORDER BY updated_at DESC LIMIT ${MAX_ACCOUNT_PROJECTS}`;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      revision: row.revision,
      savedAt: row.updated_at.toISOString(),
      deviceCount: row.device_count,
      linkCount: row.link_count,
    }));
  }

  async get(ownerId: string, id: string): Promise<ProjectResponse> {
    if (!UUID.test(id)) throw apiError(HttpStatus.NOT_FOUND, "project.not-found");
    const project = await this.prisma.project.findFirst({ where: { id, ownerId } });
    if (!project) throw apiError(HttpStatus.NOT_FOUND, "project.not-found");
    return { id: project.id, revision: project.revision, savedAt: project.updatedAt.toISOString(), document: project.content };
  }

  /** Enregistrement initial (import volontaire d'un projet local, nouveau projet du compte). */
  async create(ownerId: string, raw: unknown): Promise<SaveResponse> {
    const document = this.validate(raw);
    if ((await this.prisma.project.count({ where: { ownerId } })) >= MAX_ACCOUNT_PROJECTS) throw apiError(HttpStatus.CONFLICT, "project.too-many");
    try {
      const created = await this.prisma.project.create({
        data: { id: document.metadata.id, ownerId, name: document.metadata.name, schemaVersion: document.schemaVersion, content: document },
      });
      return { revision: created.revision, savedAt: created.updatedAt.toISOString() };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      // Identifiant déjà pris : conflit, sans révéler la révision d'un projet d'un autre compte.
      const own = await this.prisma.project.findFirst({ where: { id: document.metadata.id, ownerId }, select: { revision: true } });
      throw apiError(HttpStatus.CONFLICT, "project.conflict", { storedRevision: own?.revision ?? null });
    }
  }

  /** Nouvelle révision, seulement si la révision enregistrée est celle que le client a lue. */
  async update(ownerId: string, id: string, raw: unknown, expectedRevision: number): Promise<SaveResponse> {
    const document = this.validate(raw);
    if (document.metadata.id !== id) throw apiError(HttpStatus.BAD_REQUEST, "project.invalid");
    const result = await this.prisma.project.updateMany({
      where: { id, ownerId, revision: expectedRevision },
      data: { name: document.metadata.name, schemaVersion: document.schemaVersion, content: document, revision: { increment: 1 } },
    });
    const stored = await this.prisma.project.findFirst({ where: { id, ownerId }, select: { revision: true, updatedAt: true } });
    if (!stored) throw apiError(HttpStatus.NOT_FOUND, "project.not-found");
    if (result.count === 0) throw apiError(HttpStatus.CONFLICT, "project.conflict", { storedRevision: stored.revision });
    return { revision: stored.revision, savedAt: stored.updatedAt.toISOString() };
  }

  async remove(ownerId: string, id: string): Promise<void> {
    if (!UUID.test(id)) throw apiError(HttpStatus.NOT_FOUND, "project.not-found");
    const result = await this.prisma.project.deleteMany({ where: { id, ownerId } });
    if (result.count === 0) throw apiError(HttpStatus.NOT_FOUND, "project.not-found");
  }
}
