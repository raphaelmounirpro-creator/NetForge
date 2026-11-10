import { addDevice, serializeNfg, setInterfaceIpv4 } from "@netforge/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "../storage/memoryRepository";
import { StorageError } from "../storage/repository";
import { createProjectService, type ProjectService } from "./projectService";
import { useLabStore } from "./store";

let repository: MemoryProjectRepository;
let service: ProjectService;
let idCounter = 0;
let clock = 0;

beforeEach(() => {
  useLabStore.setState({ projects: {}, order: [], activeId: null });
  repository = new MemoryProjectRepository();
  idCounter = 0;
  clock = 0;
  service = createProjectService({
    repository,
    acquireLock: () => Promise.resolve("unsupported"),
    now: () => new Date(Date.UTC(2026, 10, 10, 12, 0, clock++)).toISOString(),
    newId: () => `projet-${String(++idCounter)}`,
    saveDelayMs: 60_000, // les tests enregistrent explicitement avec flush()
    sessionStorage: null,
  });
});

afterEach(() => {
  service.dispose();
});

const project = (id: string) => {
  const value = useLabStore.getState().projects[id];
  if (!value) throw new Error(`projet ${id} non ouvert`);
  return value;
};

async function createWithPc(): Promise<string> {
  const created = await service.newProject("LAN de base");
  if (!created.ok) throw new Error("création refusée");
  useLabStore.getState().apply(created.id, (doc) => addDevice(doc, { id: "pc1", model: "PC", position: { x: 0, y: 0 } }));
  await service.flush(created.id);
  return created.id;
}

describe("enregistrement local", () => {
  it("enregistre un nouveau projet puis chaque modification avec une révision croissante", async () => {
    const id = await createWithPc();
    expect(repository.records.get(id)?.revision).toBe(2);
    expect(project(id).saveStatus).toBe("saved");
    const loaded = await repository.load(id);
    expect(loaded.ok && loaded.project.document.topology.devices.map((device) => device.name)).toEqual(["PC1"]);
  });

  it("n'écrase jamais une version enregistrée par un autre onglet (conflit explicite)", async () => {
    const id = await createWithPc();
    // Un autre onglet enregistre entre-temps (révision 3).
    const stored = await repository.load(id);
    if (!stored.ok) throw new Error("projet absent");
    await repository.save(stored.project.document, 2);

    useLabStore.getState().apply(id, (doc) => addDevice(doc, { id: "pc2", model: "PC", position: { x: 50, y: 0 } }));
    await service.flush(id);

    expect(project(id).saveStatus).toBe("conflict");
    expect(repository.records.get(id)?.revision).toBe(3);
    const after = await repository.load(id);
    expect(after.ok && after.project.document.topology.devices).toHaveLength(1);
  });

  it("signale un quota dépassé puis réessaie à la modification suivante", async () => {
    const id = await createWithPc();
    repository.failNextSaveWith = new StorageError("quota");
    useLabStore.getState().apply(id, (doc) => addDevice(doc, { id: "pc2", model: "PC", position: { x: 50, y: 0 } }));
    await service.flush(id);
    expect(project(id).saveStatus).toBe("error");
    expect(project(id).saveError).toBe("quota");

    useLabStore.getState().apply(id, (doc) => addDevice(doc, { id: "pc3", model: "PC", position: { x: 90, y: 0 } }));
    await service.flush(id);
    expect(project(id).saveStatus).toBe("saved");
    expect(repository.records.get(id)?.revision).toBe(3);
  });

  it("refuse la fermeture silencieuse d'un projet non enregistré", async () => {
    const id = await createWithPc();
    repository.failNextSaveWith = new StorageError("unavailable");
    useLabStore.getState().apply(id, (doc) => addDevice(doc, { id: "pc2", model: "PC", position: { x: 50, y: 0 } }));
    await expect(service.close(id)).resolves.toBe("unsaved");
    expect(useLabStore.getState().order).toContain(id);
    await expect(service.close(id, { force: true })).resolves.toBe("closed");
    expect(useLabStore.getState().order).not.toContain(id);
  });
});

describe("annuler et rétablir", () => {
  it("restaure les états successifs et les marque à enregistrer", async () => {
    const id = await createWithPc();
    const { apply, undo, redo } = useLabStore.getState();
    apply(id, (doc) => setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "10.0.0.2", prefixLength: 24 } }));
    undo(id);
    expect(project(id).document.configurations["pc1"]?.interfaces).toEqual({});
    expect(project(id).saveStatus).toBe("pending");
    redo(id);
    expect(project(id).document.configurations["pc1"]?.interfaces["eth0"]?.ipv4?.address).toBe("10.0.0.2");
  });

  it("vide la sélection d'un équipement disparu après annulation", async () => {
    const id = await createWithPc();
    const { apply, select, undo } = useLabStore.getState();
    apply(id, (doc) => addDevice(doc, { id: "pc2", model: "PC", position: { x: 50, y: 0 } }));
    select(id, { kind: "device", id: "pc2" });
    undo(id);
    expect(project(id).selection).toBeNull();
  });
});

describe("import", () => {
  it("laisse le projet courant et le stockage intacts quand l'import échoue", async () => {
    const id = await createWithPc();
    const before = JSON.stringify(project(id).document);
    const outcome = await service.importText('{"format":"netforge-project","schemaVersion":42}');
    expect(outcome.kind).toBe("invalid");
    expect(JSON.stringify(project(id).document)).toBe(before);
    expect([...repository.records.keys()]).toEqual([id]);
    expect(useLabStore.getState().activeId).toBe(id);
  });

  it("détecte un projet déjà présent et permet l'import comme copie", async () => {
    const id = await createWithPc();
    const exported = serializeNfg(project(id).document);
    const outcome = await service.importText(exported);
    expect(outcome.kind).toBe("exists");
    if (outcome.kind !== "exists") return;
    const copy = await service.saveAsCopy(outcome.document);
    expect(copy.kind).toBe("imported");
    const copyId = copy.kind === "imported" ? copy.id : "";
    expect(project(copyId).document.metadata.name).toBe("LAN de base (copie)");
    expect(project(copyId).document.topology).toEqual(project(id).document.topology);
  });

  it("importe un projet inconnu tel quel (aller-retour sans perte)", async () => {
    const id = await createWithPc();
    const exported = serializeNfg(project(id).document);
    await service.remove(id);
    const outcome = await service.importText(exported);
    expect(outcome.kind).toBe("imported");
    expect(serializeNfg(project(id).document)).toBe(exported);
  });

  it("remplace un projet ouvert de façon annulable", async () => {
    const id = await createWithPc();
    const original = project(id).document;
    const replacement = { ...original, topology: { devices: [], links: [] }, configurations: {}, layout: { devices: {} } };
    await service.importReplace(replacement);
    expect(project(id).document.topology.devices).toHaveLength(0);
    useLabStore.getState().undo(id);
    expect(project(id).document.topology.devices).toHaveLength(1);
  });
});
