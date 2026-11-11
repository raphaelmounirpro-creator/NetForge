import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { createMailTransport, MailService, MailTransport } from "./mail.service.js";

@Module({
  providers: [{ provide: MailTransport, useFactory: (config: AppConfig) => createMailTransport(config), inject: [APP_CONFIG] }, MailService],
  exports: [MailService],
})
export class MailModule {}
