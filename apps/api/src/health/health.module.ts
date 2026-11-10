import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { DatabaseProbe } from "./database-probe.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthService, DatabaseProbe],
})
export class HealthModule {}
