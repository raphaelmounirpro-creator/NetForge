import { describe, expect, it } from "vitest";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { setStp } from "./commands.js";
import type { NfgDocument } from "./schema.js";
import { isStpPriority } from "./stp.js";
import { expectOk, projectWith } from "./test-helpers.js";
import { validateDocument } from "./validation.js";

const codes = (result: { ok: boolean; errors?: Array<{ code: string }> }) => result.errors?.map((issue) => issue.code);

function session(doc: NfgDocument, deviceId: string, lines: readonly string[]): NfgDocument {
  let mode: CliMode = OPERATION_MODE;
  let current = doc;
  for (const line of lines) {
    const result = interpret(current, deviceId, mode, line);
    mode = result.mode;
    if (!result.ok) throw new Error(`refus : ${line}`);
    if (result.edit) current = expectOk(result.edit(current));
  }
  return current;
}

describe("STP : configuration", () => {
  it("active STP sur un switch neuf (priorité 32768) et n'en donne pas aux autres équipements", () => {
    const doc = projectWith(["sw1", "S-24"], ["pc1", "PC"], ["r1", "R-200"]);
    expect(doc.configurations["sw1"]?.stp).toEqual({ enabled: true, priority: 32768 });
    expect([doc.configurations["pc1"]?.stp, doc.configurations["r1"]?.stp]).toEqual([null, null]);
  });

  it("accepte une priorité multiple de 4096 entre 0 et 61440", () => {
    expect([0, 4096, 32768, 61440].every(isStpPriority)).toBe(true);
    expect([-4096, 100, 65536, 4096.5].some(isStpPriority)).toBe(false);
    const doc = projectWith(["sw1", "S-24"], ["r1", "R-200"]);
    expect(expectOk(setStp(doc, { deviceId: "sw1", enabled: false, priority: 4096 })).configurations["sw1"]?.stp).toEqual({ enabled: false, priority: 4096 });
    expect(codes(setStp(doc, { deviceId: "sw1", enabled: true, priority: 1000 }))).toEqual(["stp.invalid-priority"]);
    expect(codes(setStp(doc, { deviceId: "r1", enabled: true, priority: 4096 }))).toEqual(["config.stp-not-supported"]);
  });

  it("refuse une configuration STP sur un équipement qui n'est pas un switch", () => {
    const doc = projectWith(["r1", "R-200"]);
    const config = doc.configurations["r1"];
    if (!config) throw new Error("configuration attendue");
    const broken: NfgDocument = { ...doc, configurations: { r1: { ...config, stp: { enabled: true, priority: 32768 } } } };
    expect(validateDocument(broken).map((issue) => issue.code)).toContain("config.stp-not-supported");
  });
});

describe("STP : console", () => {
  it("désactive, réactive et règle la priorité comme le formulaire", () => {
    const base = projectWith(["sw1", "S-24"]);
    const viaCli = session(base, "sw1", ["configure", "spanning-tree priority 4096", "spanning-tree disable", "end"]);
    expect(viaCli.configurations["sw1"]).toEqual(expectOk(setStp(base, { deviceId: "sw1", enabled: false, priority: 4096 })).configurations["sw1"]);
    expect(session(viaCli, "sw1", ["configure", "spanning-tree enable"]).configurations["sw1"]?.stp).toEqual({ enabled: true, priority: 4096 });
    expect(interpret(base, "sw1", OPERATION_MODE, "show spanning-tree")).toMatchObject({ ok: true, request: { kind: "show-stp" } });
  });

  it("refuse une priorité invalide avec le même problème que le formulaire", () => {
    const result = interpret(projectWith(["sw1", "S-24"]), "sw1", { kind: "config" }, "spanning-tree priority 5000");
    expect(result.ok ? null : result.issues.map((issue) => issue.code)).toEqual(["stp.invalid-priority"]);
  });

  it("réécrit seulement ce qui diffère d'un switch neuf ; rejouer redonne la même configuration", () => {
    const base = projectWith(["sw1", "S-24"]);
    expect(configurationCommands(base, "sw1")).toEqual(["configure", "hostname SW1", "end"]);
    const configured = expectOk(setStp(base, { deviceId: "sw1", enabled: false, priority: 8192 }));
    const commands = configurationCommands(configured, "sw1");
    expect(commands).toEqual(["configure", "hostname SW1", "spanning-tree disable", "spanning-tree priority 8192", "end"]);
    expect(session(base, "sw1", commands).configurations["sw1"]).toEqual(configured.configurations["sw1"]);
  });
});
