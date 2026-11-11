import { Injectable } from "@nestjs/common";

/**
 * Horloge de l'application, injectable : les tests la remplacent pour
 * vérifier les expirations (jetons, sessions, limites) sans attendre.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

/** Horloge réglable des tests. */
export class FakeClock extends Clock {
  constructor(private current = new Date("2026-11-11T09:00:00.000Z")) {
    super();
  }

  override now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export const minutes = (count: number): number => count * 60_000;
