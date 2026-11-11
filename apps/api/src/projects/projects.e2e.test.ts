import { ftthScenario, lanScenario } from "@netforge/engine";
import { parseNfgValue, renameProject, serializeNfg, type NfgDocument } from "@netforge/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Browser, expectStatus, signedIn, startTestApp, type TestApp } from "../test-support/test-app.js";

/*
 * Projets privés : isolation des comptes, révisions et conflits, validation
 * du contenu, relecture en base et après redémarrage de l'API.
 */
let test: TestApp;

beforeEach(async () => {
  test = await startTestApp();
});

afterEach(async () => {
  await test.close();
});

const code = (body: unknown) => (body as { code?: string }).code;

function withId(doc: NfgDocument, id: string, name = doc.metadata.name): NfgDocument {
  return { ...doc, metadata: { ...doc.metadata, id, name } };
}

const ID_A = "5b0f8d2e-1c4a-4d7e-9b2a-3f6c8e1d0a11";
const ID_B = "7c1e9f3a-2d5b-4e8f-8c3b-4a7d9f2e1b22";

describe("projets du compte", () => {
  it("refuse tout accès sans session", async () => {
    const anonymous = new Browser(test);
    expect((await anonymous.get("/api/projects")).status).toBe(401);
    expect((await anonymous.post("/api/projects", { document: withId(lanScenario(), ID_A) })).status).toBe(401);
  });

  it("enregistre, liste, relit et met à jour avec révision ; contenu relu en base", async () => {
    const browser = await signedIn(test, "eleve@exemple.test");
    const doc = withId(ftthScenario(), ID_A, "Réseau FTTH de l'élève");
    const created = await browser.post("/api/projects", { document: doc });
    expect([created.status, (created.body as { revision: number }).revision]).toEqual([201, 1]);

    const list = await browser.get("/api/projects");
    expect(list.body).toMatchObject({ projects: [{ id: ID_A, name: "Réseau FTTH de l'élève", revision: 1, deviceCount: 11, linkCount: 12 }] });

    const read = await browser.get(`/api/projects/${ID_A}`);
    // JSONB réordonne les clés : le contenu est comparé en objet, puis relu comme le fera l'interface.
    const stored = (read.body as { document: unknown }).document;
    expect(stored).toEqual(doc);
    const reparsed = parseNfgValue(stored);
    expect(reparsed.ok && serializeNfg(reparsed.document)).toBe(serializeNfg(doc));

    const renamed = renameProject(doc, { name: "Renommé" });
    if (!renamed.ok) throw new Error("renommage attendu");
    const updated = await browser.put(`/api/projects/${ID_A}`, { document: renamed.document, expectedRevision: 1 });
    expect([updated.status, (updated.body as { revision: number }).revision]).toEqual([200, 2]);
    const row = await test.prisma.project.findUniqueOrThrow({ where: { id: ID_A } });
    expect([row.name, row.revision, (row.content as { metadata: { name: string } }).metadata.name]).toEqual(["Renommé", 2, "Renommé"]);
  });

  it("détecte un conflit de révision sans rien écraser", async () => {
    const browser = await signedIn(test, "eleve@exemple.test");
    const doc = withId(lanScenario(), ID_A);
    await browser.post("/api/projects", { document: doc });
    expectStatus(await browser.put(`/api/projects/${ID_A}`, { document: withId(doc, ID_A, "Version 2"), expectedRevision: 1 }), 200);
    const stale = await browser.put(`/api/projects/${ID_A}`, { document: withId(doc, ID_A, "Version obsolète"), expectedRevision: 1 });
    expect([stale.status, stale.body]).toEqual([409, { code: "project.conflict", storedRevision: 2 }]);
    expect((await test.prisma.project.findUniqueOrThrow({ where: { id: ID_A } })).name).toBe("Version 2");
    const duplicate = await browser.post("/api/projects", { document: doc });
    expect([duplicate.status, duplicate.body]).toEqual([409, { code: "project.conflict", storedRevision: 2 }]);
  });

  it("isole les comptes : lecture, modification, suppression et identifiant refusés à un autre compte", async () => {
    const owner = await signedIn(test, "proprietaire@exemple.test");
    const intruder = await signedIn(test, "autre@exemple.test");
    await owner.post("/api/projects", { document: withId(lanScenario(), ID_A) });
    expect((await intruder.get("/api/projects")).body).toEqual({ projects: [] });
    const read = await intruder.get(`/api/projects/${ID_A}`);
    expect([read.status, code(read.body)]).toEqual([404, "project.not-found"]);
    const write = await intruder.put(`/api/projects/${ID_A}`, { document: withId(lanScenario(), ID_A, "Pirate"), expectedRevision: 1 });
    expect(write.status).toBe(404);
    expect((await intruder.delete(`/api/projects/${ID_A}`)).status).toBe(404);
    // Même identifiant : conflit, sans révéler la révision du projet d'autrui.
    const steal = await intruder.post("/api/projects", { document: withId(lanScenario(), ID_A) });
    expect([steal.status, steal.body]).toEqual([409, { code: "project.conflict", storedRevision: null }]);
    expect((await test.prisma.project.findUniqueOrThrow({ where: { id: ID_A } })).name).toBe(lanScenario().metadata.name);
  });

  it("refuse un contenu invalide avec les codes du format, et un identifiant qui n'est pas un UUID", async () => {
    const browser = await signedIn(test, "eleve@exemple.test");
    const invalid = await browser.post("/api/projects", { document: { format: "netforge-project", schemaVersion: 4 } });
    expect([invalid.status, code(invalid.body)]).toEqual([400, "project.invalid"]);
    expect((invalid.body as { issues: { code: string }[] }).issues[0]?.code).toBe("import.schema");
    const badId = await browser.post("/api/projects", { document: withId(lanScenario(), "projet-1") });
    expect(code(badId.body)).toBe("project.invalid");
    const mismatch = await browser.put(`/api/projects/${ID_A}`, { document: withId(lanScenario(), ID_B), expectedRevision: 1 });
    expect(code(mismatch.body)).toBe("project.invalid");
  });

  it("migre un ancien format à l'enregistrement et traite le nom comme une simple donnée", async () => {
    const browser = await signedIn(test, "eleve@exemple.test");
    const current = withId(lanScenario(), ID_A, "<img src=x onerror=alert(1)>");
    const { faults: _faults, ...withoutFaults } = current;
    const versionThree = { ...withoutFaults, schemaVersion: 3, models: { catalog: 1 }, topology: { ...current.topology, links: current.topology.links.map(({ fiber: _fiber, ...link }) => link) } };
    expectStatus(await browser.post("/api/projects", { document: versionThree }), 201);
    const read = await browser.get(`/api/projects/${ID_A}`);
    expect(read.headers["content-type"]).toMatch(/^application\/json/);
    expect(read.headers["x-content-type-options"]).toBe("nosniff");
    expect((read.body as { document: NfgDocument }).document.schemaVersion).toBe(4);
    expect((read.body as { document: NfgDocument }).document.metadata.name).toBe("<img src=x onerror=alert(1)>");
  });

  it("supprime un projet et conserve les données après redémarrage de l'API", async () => {
    const browser = await signedIn(test, "eleve@exemple.test");
    await browser.post("/api/projects", { document: withId(lanScenario(), ID_A) });
    await browser.post("/api/projects", { document: withId(ftthScenario(), ID_B) });
    expectStatus(await browser.delete(`/api/projects/${ID_A}`), 200);
    expect((await browser.get(`/api/projects/${ID_A}`)).status).toBe(404);
    await test.close();
    test = await startTestApp({}, { reset: false });
    const again = await signedIn(test, "eleve2@exemple.test");
    expect((await again.get("/api/projects")).body).toEqual({ projects: [] });
    expect(await test.prisma.project.count()).toBe(1);
  });
});
