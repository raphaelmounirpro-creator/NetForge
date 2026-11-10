import { Injectable } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@netforge/contracts";
import { API_VERSION } from "../version.js";
import { DatabaseProbe } from "./database-probe.js";

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseProbe) {}

  /** Vivacité : ne dépend d'aucun service externe. */
  liveness(): HealthResponse {
    return { status: "ok", service: "netforge-api", version: API_VERSION };
  }

  /** Préparation : l'API ne peut servir les données persistantes que si la base répond. */
  async readiness(): Promise<ReadinessResponse> {
    const databaseUp = await this.database.isUp();
    return {
      status: databaseUp ? "ready" : "not_ready",
      checks: { database: databaseUp ? "up" : "down" },
    };
  }
}
