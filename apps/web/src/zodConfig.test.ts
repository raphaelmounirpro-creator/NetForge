import { expect, it } from "vitest";

/*
 * La politique de contenu interdit eval : charger les schémas du format et du
 * moteur puis valider un projet ne doit construire aucune fonction depuis une
 * chaîne. Sans `zodConfig` en premier, Zod 4 appelle `new Function("")` dès la
 * construction de ses schémas d'objet (violation « script-src eval » constatée
 * en production le 2026-11-14). Modules chargés dynamiquement, après l'espion.
 */
it("aucune fonction construite depuis une chaîne au chargement et à la validation d'un projet", async () => {
  const original = globalThis.Function;
  const calls: unknown[][] = [];
  globalThis.Function = new Proxy(original, {
    construct(target, args: unknown[]) {
      calls.push(args);
      return Reflect.construct(target, args) as object;
    },
    apply(target, self, args: unknown[]) {
      calls.push(args);
      return Reflect.apply(target, self, args) as unknown;
    },
  });
  try {
    await import("./zodConfig");
    const { ftthScenario, workerMessageEnvelopeSchema } = await import("@netforge/engine");
    const { parseNfgText, serializeNfg } = await import("@netforge/project");
    expect(parseNfgText(serializeNfg(ftthScenario())).ok).toBe(true);
    expect(workerMessageEnvelopeSchema.safeParse({}).success).toBe(false);
  } finally {
    globalThis.Function = original;
  }
  expect(calls).toEqual([]);
});
