import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PrismaClient } from "../generated/prisma/client.js";

/** Délai maximal d'établissement d'une connexion PostgreSQL. */
const CONNECTION_TIMEOUT_MS = 2000;

/**
 * Client Prisma partagé. La connexion est ouverte à la première requête :
 * l'API démarre même si PostgreSQL est indisponible (voir /api/health/ready).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
