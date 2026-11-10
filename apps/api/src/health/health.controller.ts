import { Controller, Get, Header, HttpStatus, Res } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@netforge/contracts";
import type { Response } from "express";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  live(): HealthResponse {
    return this.health.liveness();
  }

  /** 200 si prête, 503 sinon : utilisable par une sonde de préparation. */
  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const readiness = await this.health.readiness();
    if (readiness.status !== "ready") {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
