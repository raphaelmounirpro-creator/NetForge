import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { CsrfService } from "./csrf.service.js";
import { RateLimitService } from "./rate-limit.service.js";

@Module({
  imports: [PrismaModule],
  providers: [CsrfService, RateLimitService],
  exports: [CsrfService, RateLimitService],
})
export class SecurityModule {}
