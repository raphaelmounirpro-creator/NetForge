import { Global, Module } from "@nestjs/common";
import { Clock } from "./clock.js";

/** Services transverses injectables partout (horloge remplaçable par les tests). */
@Global()
@Module({
  providers: [Clock],
  exports: [Clock],
})
export class CommonModule {}
