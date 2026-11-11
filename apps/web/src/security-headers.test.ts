import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import securityHeaders from "../security-headers.json" with { type: "json" };

/** En-têtes du déploiement (vercel.json) : identiques à ceux de l'aperçu local (vite preview), testés par les parcours. */
describe("en-têtes de sécurité de l'interface", () => {
  it("vercel.json applique exactement les en-têtes de security-headers.json aux pages (hors /api)", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const pages = vercel.headers.find((rule) => rule.source === "/((?!api/).*)");
    expect(Object.fromEntries((pages?.headers ?? []).map(({ key, value }) => [key, value]))).toEqual(securityHeaders);
  });

  it("la politique de contenu n'autorise que l'origine du site, sans script en ligne ni intégration en cadre", () => {
    const csp = securityHeaders["Content-Security-Policy"];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
  });
});
