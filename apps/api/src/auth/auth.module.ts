import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SecurityModule } from "../security/security.module.js";
import { AccountGuard } from "./account.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionsService } from "./sessions.service.js";
import { TokensService } from "./tokens.service.js";

@Module({
  imports: [PrismaModule, MailModule, SecurityModule],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, TokensService, AccountGuard],
  exports: [SessionsService, AccountGuard],
})
export class AuthModule {}
