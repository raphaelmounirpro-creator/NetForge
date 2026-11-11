import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module.js";
import { ApiExceptionFilter } from "./common/api-error.js";
import { CommonModule } from "./common/common.module.js";
import type { AppConfig } from "./config/app-config.js";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { CsrfGuard } from "./security/csrf.guard.js";
import { SecurityModule } from "./security/security.module.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), CommonModule, SecurityModule, HealthModule, AuthModule, ProjectsModule],
      providers: [
        // Toute requête qui modifie l'état passe par la vérification CSRF.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
