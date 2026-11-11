import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SecurityModule } from "../security/security.module.js";
import { EvaluationsController, ExercisesController } from "./exercises.controller.js";
import { EvaluationsService } from "./evaluations.service.js";
import { ExercisesService } from "./exercises.service.js";

@Module({
  imports: [PrismaModule, AuthModule, SecurityModule],
  controllers: [ExercisesController, EvaluationsController],
  providers: [ExercisesService, EvaluationsService],
})
export class ExercisesModule {}
