import { type DynamicModule, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "./app-config.js";

/** Rend la configuration validée injectable dans toute l'application. */
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
