import { describe, expect, it } from "vitest";
import { createSimulationHost, type HostEnvironment } from "./host.js";
import { PROTOCOL_VERSION, type UpdateMessage, type WorkerMessage } from "./protocol.js";
import { lanScenario, routedScenario } from "./scenarios.js";
import { command, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { TraceEntry } from "./trace.js";

/** Environnement factice : horloge réelle et minuteurs contrôlés par le test. */
function fakeEnvironment(options: { msPerNowCall?: number } = {}) {
  let now = 0;
  const posted: WorkerMessage[] = [];
  let timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  const env: HostEnvironment = {
    post: (message) => posted.push(structuredClone(message)),
    now: () => {
      now += options.msPerNowCall ?? 0;
      return now;
    },
    setTimer: (callback, delayMs) => {
      const timer = { at: now + delayMs, callback, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  /** Avance le temps réel et déclenche les minuteurs échus, dans l'ordre. */
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = timers.filter((timer) => !timer.cancelled && timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((timer) => timer !== due);
      now = Math.max(now, due.at);
      due.callback();
    }
    now = Math.max(now, target);
  };
  const updates = () => posted.filter((message): message is UpdateMessage => message.type === "update");
  return { env, posted, advance, updates };
}

const request = (id: number, body: Record<string, unknown>) => ({ v: PROTOCOL_VERSION, id, ...body });

describe("adaptateur du moteur (Worker)", () => {
  it("refuse un message illisible ou d'une autre version du protocole", () => {
    const { env, posted } = fakeEnvironment();
    const host = createSimulationHost(env);
    host.receive("bonjour");
    host.receive({ v: 99, id: 4, type: "pause" });
    host.receive({ v: PROTOCOL_VERSION, id: 5, type: "play", speed: 3 });
    expect(posted).toEqual([
      expect.objectContaining({ type: "error", id: null, code: "protocol.invalid-message" }),
      expect.objectContaining({ type: "error", id: 4, code: "protocol.version" }),
      expect.objectContaining({ type: "error", id: 5, code: "protocol.invalid-message" }),
    ]);
  });

  it("refuse une commande avant le chargement et un document invalide", () => {
    const { env, posted } = fakeEnvironment();
    const host = createSimulationHost(env);
    host.receive(request(1, { type: "step" }));
    host.receive(request(2, { type: "load", document: { format: "autre" }, seed: 1 }));
    expect(posted[0]).toMatchObject({ type: "error", id: 1, code: "sim.not-loaded" });
    expect(posted[1]).toMatchObject({ type: "error", id: 2, code: "load.invalid-document", issues: [expect.objectContaining({ code: "import.not-netforge" })] });
  });

  it("accuse réception de chaque requête dans l'ordre et envoie l'état complet au chargement", () => {
    const { env, posted } = fakeEnvironment();
    const host = createSimulationHost(env);
    host.receive(request(1, { type: "load", document: lanScenario(), seed: 1 }));
    host.receive(request(2, { type: "command", command: { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 } }));
    host.receive(request(3, { type: "command", command: { type: "ping", deviceId: "sw1", destination: "192.168.1.11" } }));
    const replies = posted.filter((message) => message.type !== "update");
    expect(replies).toEqual([
      expect.objectContaining({ type: "ack", id: 1 }),
      expect.objectContaining({ type: "ack", id: 2, sessionId: "ping-1" }),
      expect.objectContaining({ type: "error", id: 3, code: "command.not-a-pc" }),
    ]);
    const first = posted.find((message): message is UpdateMessage => message.type === "update");
    expect(first).toMatchObject({ full: true, time: 0, mode: "paused" });
    expect(first?.changes.devices.map((device) => device.deviceId)).toEqual(["pc1", "pc2", "sw1"]);
  });

  it("donne, par lots, exactement la trace d'un appel direct au moteur", () => {
    const { env, advance, updates } = fakeEnvironment();
    const host = createSimulationHost(env, { sliceEvents: 5 });
    host.receive(request(1, { type: "load", document: routedScenario(), seed: 9 }));
    host.receive(request(2, { type: "command", command: { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 2 } }));
    host.receive(request(3, { type: "finish" }));
    advance(1000);
    const received: TraceEntry[] = updates().flatMap((update) => update.trace);
    const last = updates().at(-1);
    expect(last).toMatchObject({ mode: "paused", notice: "finished", activity: false });
    expect(updates().length).toBeGreaterThan(3);

    const direct = start(routedScenario(), { seed: 9 });
    command(direct, { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 2 });
    expect(received).toEqual(settle(direct));
  });

  it("lit en continu au rythme du temps réel × vitesse, puis s'arrête en pause", () => {
    const { env, advance, updates } = fakeEnvironment();
    const host = createSimulationHost(env);
    host.receive(request(1, { type: "load", document: lanScenario(), seed: 1 }));
    host.receive(request(2, { type: "command", command: { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 4 } }));
    host.receive(request(3, { type: "play", speed: 1 }));
    advance(1500);
    const time = updates().at(-1)?.time ?? 0;
    expect(time).toBeGreaterThanOrEqual(fromSeconds(1.4));
    expect(time).toBeLessThanOrEqual(fromSeconds(1.5));
    const ping = updates()
      .flatMap((update) => update.changes.pings)
      .filter((view) => view.id === "ping-1")
      .at(-1);
    expect(ping?.attempts.map((attempt) => attempt.status)).toEqual(["reply", "reply"]);

    host.receive(request(4, { type: "pause" }));
    const count = updates().length;
    advance(2000);
    expect(updates().length).toBe(count);
    expect(updates().at(-1)).toMatchObject({ mode: "paused" });
  });

  it("avance pas à pas et réinitialise en conservant la configuration", () => {
    const { env, updates } = fakeEnvironment();
    const host = createSimulationHost(env);
    host.receive(request(1, { type: "load", document: lanScenario(), seed: 1 }));
    host.receive(request(2, { type: "command", command: { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 } }));
    // La commande est appliquée à l'instant courant : premier écho et requête ARP immédiats.
    expect(updates().at(-1)?.trace.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["command.ping", "ping.send", "arp.request-sent"]),
    );
    expect(updates().at(-1)?.time).toBe(0);
    host.receive(request(3, { type: "step" }));
    const stepped = updates().at(-1);
    expect(stepped?.trace.length).toBeGreaterThan(0);
    expect(stepped?.time).toBeGreaterThan(0);

    host.receive(request(5, { type: "reset" }));
    const reset = updates().at(-1);
    expect(reset).toMatchObject({ full: true, time: 0, processedEvents: 0, pendingEvents: 0 });
    expect(reset?.changes.pings).toEqual([]);
    expect(reset?.changes.devices.every((device) => device.arpCache.length === 0 && device.macTable.length === 0)).toBe(true);
    expect(reset?.changes.devices.find((device) => device.deviceId === "pc1")?.interfaces[0]?.ipv4).toBe("192.168.1.10/24");
  });

  it("limite le journal transmis et compte les décisions non transmises", () => {
    const { env, advance, updates } = fakeEnvironment();
    const host = createSimulationHost(env, { maxTraceEntriesPerUpdate: 5, sliceEvents: 10_000 });
    host.receive(request(1, { type: "load", document: lanScenario(), seed: 1 }));
    host.receive(request(2, { type: "command", command: { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 } }));
    host.receive(request(3, { type: "finish" }));
    advance(10);
    const finished = updates().find((update) => update.notice === "finished");
    expect(finished?.trace).toHaveLength(5);
    expect(finished?.droppedTrace).toBeGreaterThan(0);
    // Les dernières décisions sont conservées : la fin du ping est visible.
    expect(finished?.trace.at(-1)?.code).toBe("ping.done");
  });

  it("regroupe les lots pendant « terminer » sans perdre de décision, même en cas de pause", () => {
    // Chaque lecture d'horloge « coûte » 1 ms : les lots sont courts, les envois espacés de 100 ms.
    const { env, advance, updates } = fakeEnvironment({ msPerNowCall: 1 });
    const host = createSimulationHost(env, { sliceEvents: 2 });
    host.receive(request(1, { type: "load", document: routedScenario(), seed: 4 }));
    host.receive(request(2, { type: "command", command: { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 3 } }));
    host.receive(request(3, { type: "finish" }));
    advance(40);
    host.receive(request(4, { type: "pause" }));
    host.receive(request(5, { type: "finish" }));
    advance(10_000);
    const all = updates();
    expect(all.at(-1)).toMatchObject({ notice: "finished" });
    const received = all.flatMap((update) => update.trace);
    expect(all.reduce((sum, update) => sum + update.droppedTrace, 0)).toBe(0);

    const direct = start(routedScenario(), { seed: 4 });
    command(direct, { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 3 });
    expect(received).toEqual(settle(direct));
  });

  it("met en pause avec une explication si « terminer » dépasse sa durée de calcul", () => {
    // Chaque lecture de l'horloge « coûte » 1 ms : le budget de 20 ms est vite atteint.
    const { env, advance, updates } = fakeEnvironment({ msPerNowCall: 1 });
    const host = createSimulationHost(env, { finishBudgetMs: 20, sliceEvents: 1 });
    host.receive(request(1, { type: "load", document: routedScenario(), seed: 1 }));
    host.receive(request(2, { type: "command", command: { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 4 } }));
    host.receive(request(3, { type: "finish" }));
    advance(1000);
    const last = updates().at(-1);
    expect(last).toMatchObject({ mode: "paused", notice: "compute-budget", activity: true });
  });
});
