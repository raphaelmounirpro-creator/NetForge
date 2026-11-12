import { createSimulationHost, lanScenario, PROTOCOL_VERSION, routedScenario, type UpdateMessage } from "@netforge/engine";
import { setInterfaceIpv4, moveDevice } from "@netforge/project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNameIndex } from "../../i18n/simulation";
import { useLabStore } from "../lab/store";
import type { WorkerPort } from "./client";
import { createSimulationController } from "./controller";
import { networkFingerprint } from "./fingerprint";
import { JOURNAL_LIMIT, mergeUpdate, useSimulationStore, type SimulationSession } from "./store";

/** Worker exécuté dans le même processus : même adaptateur, messages clonés comme par postMessage. */
function inProcessWorker(): WorkerPort {
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => {
      const copy = structuredClone(message);
      queueMicrotask(() => {
        host.receive(copy);
      });
    },
    terminate: () => {
      host.dispose();
    },
  };
  const host = createSimulationHost({
    post: (message) => {
      const copy = structuredClone(message);
      queueMicrotask(() => port.onmessage?.({ data: copy }));
    },
    now: () => Date.now(),
    setTimer: (callback, delayMs) => {
      const handle = setTimeout(callback, delayMs);
      return () => {
        clearTimeout(handle);
      };
    },
  });
  return port;
}

function openProject(doc = lanScenario()) {
  useLabStore.getState().openProject(doc, { storedRevision: 1, access: "editor", saved: true });
  return doc.metadata.id;
}

const session = () => {
  const value = useSimulationStore.getState().session;
  if (!value) throw new Error("session attendue");
  return value;
};

beforeEach(() => {
  vi.useFakeTimers();
  useSimulationStore.getState().clear();
  useLabStore.setState({ projects: {}, order: [], activeId: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("contrôleur de simulation (Worker en processus)", () => {
  it("charge le projet, exécute un ping et projette tables et résultats", async () => {
    const controller = createSimulationController(inProcessWorker);
    const projectId = openProject();
    await controller.start(projectId);
    await vi.advanceTimersByTimeAsync(0);
    expect(session()).toMatchObject({ phase: "ready", projectId, time: 0 });
    expect(Object.keys(session().devices).sort()).toEqual(["pc1", "pc2", "sw1"]);

    const reply = await controller.ping("pc1", "192.168.1.11", 2);
    expect(reply).toEqual({ ok: true, sessionId: "ping-1" });
    await controller.finish();
    await vi.advanceTimersByTimeAsync(100);

    const ping = session().pings["ping-1"];
    expect(ping?.done).toBe(true);
    expect(ping?.attempts.map((attempt) => attempt.status)).toEqual(["reply", "reply"]);
    expect(session().devices["pc1"]?.arpCache).toHaveLength(1);
    expect(session().devices["sw1"]?.macTable).toHaveLength(2);
    expect(session().journal.some((item) => item.entry.code === "arp.request-sent")).toBe(true);
    expect(session().mode).toBe("paused");
  });

  it("transmet le refus du moteur avec son code", async () => {
    const controller = createSimulationController(inProcessWorker);
    await controller.start(openProject());
    await vi.advanceTimersByTimeAsync(0);
    expect(await controller.ping("sw1", "192.168.1.11", 1)).toMatchObject({ ok: false, code: "command.not-a-pc" });
    expect(await controller.ping("pc1", "224.0.0.9", 1)).toMatchObject({ ok: false, code: "command.invalid-destination" });
  });

  it("réinitialise en rechargeant la configuration actuelle du projet", async () => {
    const controller = createSimulationController(inProcessWorker);
    const projectId = openProject(routedScenario());
    await controller.start(projectId);
    await controller.ping("pc1", "192.168.2.10", 1);
    await controller.finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(session().pingOrder).toEqual(["ping-1"]);

    useLabStore.getState().apply(projectId, (doc) =>
      setInterfaceIpv4(doc, { deviceId: "pc2", portId: "eth0", ipv4: { address: "192.168.2.20", prefixLength: 24 } }),
    );
    const before = session().fingerprint;
    await controller.reset();
    await vi.advanceTimersByTimeAsync(0);
    expect(session().fingerprint).not.toBe(before);
    expect(session()).toMatchObject({ time: 0, pingOrder: [], journal: [] });
    expect(session().devices["pc2"]?.interfaces[0]?.ipv4).toBe("192.168.2.20/24");
  });

  it("signale un message illisible du Worker", async () => {
    let port: WorkerPort | null = null;
    const controller = createSimulationController(() => {
      port = inProcessWorker();
      return port;
    });
    await controller.start(openProject());
    (port as WorkerPort | null)?.onmessage?.({ data: { v: 42, type: "update" } });
    expect(session().workerError).toBe(true);
  });

  it("met en pause la simulation d'un projet quand un autre devient actif", async () => {
    const controller = createSimulationController(inProcessWorker);
    const first = openProject();
    await controller.start(first);
    await controller.ping("pc1", "192.168.1.11", 4);
    await controller.play(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(session().mode).toBe("playing");
    const other = openProject({ ...routedScenario(), metadata: { ...routedScenario().metadata, id: "autre" } });
    controller.onActiveProjectChange(other);
    await vi.advanceTimersByTimeAsync(100);
    expect(session().mode).toBe("paused");
    expect(useLabStore.getState().projects[other]?.notice).toBe("La simulation de « LAN de base » a été mise en pause.");
  });
});

describe("empreinte du réseau simulé", () => {
  it("ignore la disposition mais pas la configuration", () => {
    const doc = lanScenario();
    const moved = moveDevice(doc, { deviceId: "pc1", position: { x: 900, y: 900 } });
    const readdressed = setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.50", prefixLength: 24 } });
    if (!moved.ok || !readdressed.ok) throw new Error("commandes attendues");
    expect(networkFingerprint(moved.document)).toBe(networkFingerprint(doc));
    expect(networkFingerprint(readdressed.document)).not.toBe(networkFingerprint(doc));
  });

  it("ne dépend pas de l'ordre des clés", () => {
    const doc = lanScenario();
    const reordered = { ...doc, configurations: Object.fromEntries(Object.entries(doc.configurations).reverse()) };
    expect(networkFingerprint(reordered)).toBe(networkFingerprint(doc));
  });
});

describe("projection des lots du moteur", () => {
  const base: SimulationSession = {
    projectId: "p",
    projectName: "P",
    fingerprint: "",
    phase: "loading",
    loadIssues: [],
    workerError: false,
    mode: "paused",
    speed: 1,
    time: 0,
    status: "ready",
    diagnostic: null,
    processedEvents: 0,
    pendingEvents: 0,
    activity: false,
    lagging: false,
    notice: null,
    lastComputeMs: 0,
    devices: {},
    pings: {},
    pingOrder: [],
    lookups: {},
    links: {},
    names: buildNameIndex([]),
    journal: [],
    journalTotal: 0,
    journalHidden: 0,
    lastSeq: 0,
  };
  const entry = (event: number) => ({ event, parent: null, time: event, deviceId: null, portId: null, exchange: null, code: "ping.send" as const, params: {}, pdu: null });
  const update = (seq: number, trace: number[], droppedTrace = 0): UpdateMessage => ({
    v: PROTOCOL_VERSION,
    type: "update",
    seq,
    full: false,
    mode: "paused",
    speed: 1,
    time: seq,
    status: "ready",
    diagnostic: null,
    processedEvents: 0,
    pendingEvents: 0,
    activity: false,
    trace: trace.map(entry),
    droppedTrace,
    changes: { devices: [], pings: [], lookups: [], links: [] },
    computeMs: 0,
    lagging: false,
    notice: null,
  });

  it("ignore un lot plus ancien que le dernier intégré", () => {
    const after = mergeUpdate(mergeUpdate(base, update(2, [1])), update(1, [9]));
    expect(after.time).toBe(2);
    expect(after.journal.map((item) => item.entry.event)).toEqual([1]);
  });

  it("conserve les références inchangées pour éviter les rendus inutiles", () => {
    const first = mergeUpdate(base, update(1, [1]));
    const second = mergeUpdate(first, update(2, [2]));
    expect(second.devices).toBe(first.devices);
    expect(second.links).toBe(first.links);
    expect(second.pings).toBe(first.pings);
    expect(second.names).toBe(first.names);
  });

  it("limite le journal affiché et compte les décisions masquées", () => {
    const many = Array.from({ length: JOURNAL_LIMIT + 50 }, (_, index) => index);
    const after = mergeUpdate(base, update(1, many, 10));
    expect(after.journal).toHaveLength(JOURNAL_LIMIT);
    expect(after.journalHidden).toBe(60);
    expect(after.journalTotal).toBe(JOURNAL_LIMIT + 60);
    // Clés stables et croissantes, qui tiennent compte des décisions non transmises.
    expect(after.journal[0]?.key).toBe(60);
    expect(after.journal.at(-1)?.key).toBe(JOURNAL_LIMIT + 59);
  });
});
