/**
 * Point d'entrée public du moteur NetForge.
 *
 * Phase 0 : seul le socle du temps simulé est en place. La file d'événements,
 * le générateur pseudo-aléatoire et les protocoles arrivent en phase 2.
 */
export const ENGINE_VERSION = "0.0.0";

export * from "./time.js";
