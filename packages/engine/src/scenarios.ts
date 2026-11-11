import {
  addDevice,
  addFault,
  addStaticRoute,
  connectPorts,
  createProject,
  setDefaultGateway,
  setFiber,
  setInterfaceIpv4,
  type CommandResult,
  type DeviceModelId,
  type FaultKind,
  type FaultTarget,
  type Fiber,
  type NfgDocument,
} from "@netforge/project";

/**
 * Topologies de référence versionnées : utilisées par les tests du moteur,
 * la mesure de performance et les parcours navigateur. Elles sont
 * construites avec les commandes d'édition, donc toujours valides.
 */

const CREATED_AT = "2026-11-11T08:00:00.000Z";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(`scénario invalide : ${result.errors.map((issue) => issue.code).join(", ")}`);
  return result.document;
}

export class ScenarioBuilder {
  private doc: NfgDocument;
  private linkCount = 0;

  constructor(id: string, name: string) {
    this.doc = ok(createProject({ id, name, now: CREATED_AT }));
  }

  device(id: string, model: DeviceModelId, x: number, y: number): this {
    this.doc = ok(addDevice(this.doc, { id, model, name: id.toUpperCase(), position: { x, y } }));
    return this;
  }

  link(a: string, aPort: string, b: string, bPort: string): this {
    this.linkCount += 1;
    this.doc = ok(
      connectPorts(this.doc, {
        linkId: `l${String(this.linkCount)}`,
        a: { deviceId: a, portId: aPort },
        b: { deviceId: b, portId: bPort },
      }),
    );
    return this;
  }

  ip(deviceId: string, portId: string, cidr: string): this {
    const [address = "", prefix = "0"] = cidr.split("/");
    this.doc = ok(setInterfaceIpv4(this.doc, { deviceId, portId, ipv4: { address, prefixLength: Number(prefix) } }));
    return this;
  }

  gateway(deviceId: string, gateway: string): this {
    this.doc = ok(setDefaultGateway(this.doc, { deviceId, gateway }));
    return this;
  }

  route(deviceId: string, cidr: string, nextHop: string): this {
    const [destination = "", prefix = "0"] = cidr.split("/");
    this.doc = ok(addStaticRoute(this.doc, { deviceId, route: { destination, prefixLength: Number(prefix), nextHop } }));
    return this;
  }

  /** Propriétés de la fibre du dernier lien créé. */
  fiber(length: number, type: Fiber["type"] = "G.652.D", cable: Fiber["cable"] = "distribution"): this {
    this.doc = ok(setFiber(this.doc, { linkId: `l${String(this.linkCount)}`, fiber: { length, type, cable } }));
    return this;
  }

  fault(id: string, kind: FaultKind, target: FaultTarget, extraLoss: number | null = null): this {
    this.doc = ok(addFault(this.doc, { id, kind, target, extraLoss }));
    return this;
  }

  build(): NfgDocument {
    return this.doc;
  }
}

/** PC1 (192.168.1.10/24) et PC2 (192.168.1.11/24) reliés par SW1 (liens l1, l2). */
export function lanScenario(): NfgDocument {
  return new ScenarioBuilder("scenario-lan", "LAN de base")
    .device("pc1", "PC", 100, 300)
    .device("sw1", "S-24", 300, 200)
    .device("pc2", "PC", 500, 300)
    .link("pc1", "eth0", "sw1", "ge1")
    .link("pc2", "eth0", "sw1", "ge2")
    .ip("pc1", "eth0", "192.168.1.10/24")
    .ip("pc2", "eth0", "192.168.1.11/24")
    .build();
}

/** LAN de base + PC3 (192.168.1.12/24) sur SW1 ge3 (lien l3). */
export function lanThreeScenario(): NfgDocument {
  return new ScenarioBuilder("scenario-lan3", "LAN à trois PC")
    .device("pc1", "PC", 100, 300)
    .device("sw1", "S-24", 300, 200)
    .device("pc2", "PC", 500, 300)
    .device("pc3", "PC", 300, 400)
    .link("pc1", "eth0", "sw1", "ge1")
    .link("pc2", "eth0", "sw1", "ge2")
    .link("pc3", "eth0", "sw1", "ge3")
    .ip("pc1", "eth0", "192.168.1.10/24")
    .ip("pc2", "eth0", "192.168.1.11/24")
    .ip("pc3", "eth0", "192.168.1.12/24")
    .build();
}

/**
 * Deux sous-réseaux reliés par R1 :
 * PC1 192.168.1.10/24 (passerelle .1) — SW1 — R1 ge0 192.168.1.1/24
 * R1 ge1 192.168.2.1/24 — SW2 — PC2 192.168.2.10/24 (passerelle .1)
 */
export function routedScenario(): NfgDocument {
  return new ScenarioBuilder("scenario-routed", "Deux sous-réseaux")
    .device("pc1", "PC", 100, 300)
    .device("sw1", "S-24", 250, 200)
    .device("r1", "R-200", 400, 120)
    .device("sw2", "S-24", 550, 200)
    .device("pc2", "PC", 700, 300)
    .link("pc1", "eth0", "sw1", "ge1")
    .link("sw1", "ge24", "r1", "ge0")
    .link("r1", "ge1", "sw2", "ge24")
    .link("sw2", "ge1", "pc2", "eth0")
    .ip("pc1", "eth0", "192.168.1.10/24")
    .ip("r1", "ge0", "192.168.1.1/24")
    .ip("r1", "ge1", "192.168.2.1/24")
    .ip("pc2", "eth0", "192.168.2.10/24")
    .gateway("pc1", "192.168.1.1")
    .gateway("pc2", "192.168.2.1")
    .build();
}

/**
 * Trois réseaux et deux routeurs : les routes statiques sont indispensables.
 * PC1 10.0.1.10/24 — R1 (ge0 10.0.1.1/24, ge1 10.0.12.1/30)
 * R2 (ge1 10.0.12.2/30, ge0 10.0.2.1/24) — PC2 10.0.2.10/24
 */
export function twoRoutersScenario(options: { r1Route?: boolean; r2Route?: boolean } = {}): NfgDocument {
  const builder = new ScenarioBuilder("scenario-two-routers", "Deux routeurs")
    .device("pc1", "PC", 100, 300)
    .device("r1", "R-200", 300, 200)
    .device("r2", "R-200", 500, 200)
    .device("pc2", "PC", 700, 300)
    .link("pc1", "eth0", "r1", "ge0")
    .link("r1", "ge1", "r2", "ge1")
    .link("r2", "ge0", "pc2", "eth0")
    .ip("pc1", "eth0", "10.0.1.10/24")
    .ip("r1", "ge0", "10.0.1.1/24")
    .ip("r1", "ge1", "10.0.12.1/30")
    .ip("r2", "ge1", "10.0.12.2/30")
    .ip("r2", "ge0", "10.0.2.1/24")
    .ip("pc2", "eth0", "10.0.2.10/24")
    .gateway("pc1", "10.0.1.1")
    .gateway("pc2", "10.0.2.1");
  if (options.r1Route ?? true) builder.route("r1", "10.0.2.0/24", "10.0.12.2");
  if (options.r2Route ?? true) builder.route("r2", "10.0.1.0/24", "10.0.12.1");
  return builder.build();
}

/**
 * Boucle de commutation : LAN de base + SW2 relié à SW1 par trois câbles
 * parallèles (l3 à l5). Sans STP, une trame diffusée s'y multiplie.
 */
export function switchLoopScenario(): NfgDocument {
  return new ScenarioBuilder("scenario-loop", "Boucle de commutation")
    .device("pc1", "PC", 100, 300)
    .device("sw1", "S-24", 300, 200)
    .device("pc2", "PC", 500, 300)
    .device("sw2", "S-24", 300, 50)
    .link("pc1", "eth0", "sw1", "ge1")
    .link("pc2", "eth0", "sw1", "ge2")
    .link("sw1", "ge10", "sw2", "ge1")
    .link("sw1", "ge11", "sw2", "ge2")
    .link("sw1", "ge12", "sw2", "ge3")
    .ip("pc1", "eth0", "192.168.1.10/24")
    .ip("pc2", "eth0", "192.168.1.11/24")
    .build();
}

export const PERFORMANCE_SCENARIO = {
  accessSwitches: 9,
  pcsPerSwitch: 10,
} as const;

/**
 * Scénario de performance : 100 équipements, 99 liens, un seul réseau /24.
 * SW0 (cœur) relie 9 switches d'accès (SW1–SW9, port ge24) ; chacun dessert
 * 10 PC (ge1–ge10). PC n = 10.10.0.n/24, n de 1 à 90.
 */
export function performanceScenario(): NfgDocument {
  const builder = new ScenarioBuilder("scenario-perf-100", "Performance 100 équipements").device("sw0", "S-24", 1400, 60);
  for (let s = 1; s <= PERFORMANCE_SCENARIO.accessSwitches; s += 1) {
    const sw = `sw${String(s)}`;
    builder.device(sw, "S-24", s * 300, 300).link("sw0", `ge${String(s)}`, sw, "ge24");
    for (let p = 1; p <= PERFORMANCE_SCENARIO.pcsPerSwitch; p += 1) {
      const n = (s - 1) * PERFORMANCE_SCENARIO.pcsPerSwitch + p;
      const pc = `pc${String(n)}`;
      builder
        .device(pc, "PC", s * 300 - 135 + ((p - 1) % 5) * 70, 480 + Math.floor((p - 1) / 5) * 140)
        .link(pc, "eth0", sw, `ge${String(p)}`)
        .ip(pc, "eth0", `10.10.0.${String(n)}/24`);
    }
  }
  return builder.build();
}

/** Longueurs des câbles de raccordement PBO → PTO (m), par abonné. */
export const FTTH_DROPS = [150, 60, 120] as const;

/**
 * Réseau FTTH de référence (GPON classe B+) :
 * OLT1 pon1 —jarretière 2 m— ODF1 f1 | r1 —transport 5 km— CPL1 (1:8) o1
 * —1 km— CPL2 (1:4) o1..o3 —distribution 800 m— PBO1 in1..in3 | out1..out3
 * —raccordement (FTTH_DROPS, G.657.A2, câble court)— PTO1..3 | out —jarretière 2 m— ONT1..3.
 * Liens : l1 à l3 (tronc), l4 à l6 (distribution), l7 à l9 (raccordement), l10 à l12 (jarretières).
 * Option dirtyPto3 : connecteur de sortie de PTO3 sale (+4,5 dB), exercice de dépannage.
 */
export function ftthScenario(options: { dirtyPto3?: boolean } = {}): NfgDocument {
  const builder = new ScenarioBuilder("scenario-ftth", "Réseau FTTH")
    .device("olt1", "OLT-16", 80, 260)
    .device("odf1", "ODF-12", 240, 260)
    .device("cpl1", "SPL-8", 400, 260)
    .device("cpl2", "SPL-4", 560, 260)
    .device("pbo1", "PBO-8", 720, 260)
    .link("olt1", "pon1", "odf1", "f1")
    .link("odf1", "r1", "cpl1", "com")
    .fiber(5000)
    .link("cpl1", "o1", "cpl2", "com")
    .fiber(1000);
  for (let index = 1; index <= 3; index += 1) {
    builder.link("cpl2", `o${String(index)}`, "pbo1", `in${String(index)}`).fiber(800);
  }
  FTTH_DROPS.forEach((length, offset) => {
    const index = String(offset + 1);
    builder.device(`pto${index}`, "PTO", 880, 120 + offset * 140).link("pbo1", `out${index}`, `pto${index}`, "in").fiber(length, "G.657.A2", "short");
  });
  for (let index = 1; index <= 3; index += 1) {
    builder.device(`ont${String(index)}`, "ONT-1G", 1040, 120 + (index - 1) * 140).link(`pto${String(index)}`, "out", `ont${String(index)}`, "pon");
  }
  if (options.dirtyPto3) builder.fault("panne-1", "dirty-connector", { kind: "port", deviceId: "pto3", portId: "out" }, 4.5);
  return builder.build();
}
