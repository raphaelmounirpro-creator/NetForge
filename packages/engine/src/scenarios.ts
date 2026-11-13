import {
  addDevice,
  addFault,
  addStaticRoute,
  connectPorts,
  createProject,
  setDefaultGateway,
  setDhcpPool,
  setDnsRecord,
  setDnsServer,
  setInterfaceDhcp,
  setFiber,
  setInterfaceIpv4,
  setOspfInterface,
  setRipInterface,
  setStp,
  setVrrpGroup,
  setBgpAs,
  setBgpNeighbor,
  setBgpNetwork,
  setDeviceLocation,
  setOntSerial,
  setOntServices,
  setPonAuthorization,
  setPonService,
  setSwitchport,
  type CommandResult,
  type DeviceModelId,
  type FaultKind,
  type FaultTarget,
  type Fiber,
  type NfgDocument,
  type OspfMode,
  type PonService,
  type RipMode,
} from "@netforge/project";

/**
 * Topologies de référence versionnées : utilisées par les tests du moteur,
 * la mesure de performance et les parcours navigateur. Elles sont
 * construites avec les commandes d'édition, donc toujours valides. Leurs
 * switches ont STP désactivé (scénarios antérieurs à STP, comportement
 * conservé, comme pour un projet migré) ; un scénario l'active explicitement.
 */

const CREATED_AT = "2026-11-11T08:00:00.000Z";

/** Deux clients automatiques, serveur sur R1 ; réseau distant pour vérifier la passerelle reçue. */
export function dhcpScenario(options: { singleAddress?: boolean; noServer?: boolean } = {}): NfgDocument {
  const builder = new ScenarioBuilder("dhcp", "DHCP : attribution et baux")
    .device("pc1", "PC", 80, 100).device("pc2", "PC", 80, 280)
    .device("sw1", "S-24", 320, 180).device("r1", "R-200", 560, 180)
    .device("pc3", "PC", 800, 180)
    .link("pc1", "eth0", "sw1", "ge1").link("pc2", "eth0", "sw1", "ge2")
    .link("sw1", "ge3", "r1", "ge0").link("r1", "ge1", "pc3", "eth0")
    .ip("r1", "ge0", "192.168.1.1/24").ip("r1", "ge1", "10.0.0.1/24")
    .ip("pc3", "eth0", "10.0.0.2/24").gateway("pc3", "10.0.0.1")
    .dhcpClient("pc1").dhcpClient("pc2");
  if (!options.noServer) builder.dhcpPool("r1", "ge0", "192.168.1.100", options.singleAddress ? "192.168.1.100" : "192.168.1.101", "192.168.1.1");
  return builder.build();
}

/**
 * Résolution de noms : service DNS sur R1 (srv.lab, pc1.lab), PC1 et SRV
 * l'interrogent (chacun par l'adresse de R1 sur son réseau), PC2 n'a pas de
 * serveur DNS. Sans service, R1 ne répond pas sur le port 53.
 */
export function dnsScenario(options: { serviceDisabled?: boolean } = {}): NfgDocument {
  const builder = new ScenarioBuilder("dns", "DNS : résolution de noms")
    .device("pc1", "PC", 80, 100).device("pc2", "PC", 80, 280)
    .device("sw1", "S-24", 320, 180).device("r1", "R-200", 560, 180)
    .device("srv", "PC", 800, 180)
    .link("pc1", "eth0", "sw1", "ge1").link("pc2", "eth0", "sw1", "ge2")
    .link("sw1", "ge3", "r1", "ge0").link("r1", "ge1", "srv", "eth0")
    .ip("r1", "ge0", "192.168.1.1/24").ip("r1", "ge1", "10.0.0.1/24")
    .ip("pc1", "eth0", "192.168.1.10/24").gateway("pc1", "192.168.1.1").dnsServer("pc1", "192.168.1.1")
    .ip("pc2", "eth0", "192.168.1.11/24").gateway("pc2", "192.168.1.1")
    .ip("srv", "eth0", "10.0.0.10/24").gateway("srv", "10.0.0.1").dnsServer("srv", "10.0.0.1");
  if (!options.serviceDisabled) builder.dnsRecord("r1", "srv.lab", "10.0.0.10").dnsRecord("r1", "pc1.lab", "192.168.1.10");
  return builder.build();
}

/**
 * Trois routeurs en triangle, chacun avec son réseau de postes (interface
 * passive), sans route statique : RIP apprend tous les réseaux.
 * PC1 10.1.0.10 — R1 ge0 10.1.0.1/24 ; R2 ge0 10.2.0.1/24 — PC2 10.2.0.10 ; R3 ge0 10.3.0.1/24 — PC3 10.3.0.10
 * R1 ge1 10.12.0.1/30 — R2 ge1 10.12.0.2/30 (l4) ; R2 ge2 10.23.0.1/30 — R3 ge2 10.23.0.2/30 (l5) ;
 * R1 ge2 10.13.0.1/30 — R3 ge1 10.13.0.2/30 (l6, absent sans redondance).
 */
export function ripScenario(options: { redundant?: boolean; rip?: boolean } = {}): NfgDocument {
  const redundant = options.redundant ?? true;
  const builder = new ScenarioBuilder("rip", "RIP : routage dynamique")
    .device("pc1", "PC", 80, 300).device("r1", "R-200", 300, 300)
    .device("r2", "R-200", 620, 300).device("pc2", "PC", 840, 300)
    .device("r3", "R-200", 460, 130).device("pc3", "PC", 220, 130)
    .link("pc1", "eth0", "r1", "ge0").link("r2", "ge0", "pc2", "eth0").link("r3", "ge0", "pc3", "eth0")
    .link("r1", "ge1", "r2", "ge1").link("r2", "ge2", "r3", "ge2");
  if (redundant) builder.link("r1", "ge2", "r3", "ge1");
  builder
    .ip("r1", "ge0", "10.1.0.1/24").ip("r2", "ge0", "10.2.0.1/24").ip("r3", "ge0", "10.3.0.1/24")
    .ip("r1", "ge1", "10.12.0.1/30").ip("r2", "ge1", "10.12.0.2/30")
    .ip("r2", "ge2", "10.23.0.1/30").ip("r3", "ge2", "10.23.0.2/30")
    .ip("pc1", "eth0", "10.1.0.10/24").gateway("pc1", "10.1.0.1")
    .ip("pc2", "eth0", "10.2.0.10/24").gateway("pc2", "10.2.0.1")
    .ip("pc3", "eth0", "10.3.0.10/24").gateway("pc3", "10.3.0.1");
  if (redundant) builder.ip("r1", "ge2", "10.13.0.1/30").ip("r3", "ge1", "10.13.0.2/30");
  if (options.rip ?? true) {
    for (const router of ["r1", "r2", "r3"]) builder.rip(router, "ge0", "passive");
    builder.rip("r1", "ge1").rip("r2", "ge1").rip("r2", "ge2").rip("r3", "ge2");
    if (redundant) builder.rip("r1", "ge2").rip("r3", "ge1");
  }
  return builder.build();
}

/**
 * OSPF, triangle à coûts inégaux : R1–R2 et R2–R3 coûtent 10, le lien direct
 * R1–R3 coûte 30. Le chemin de R1 vers le réseau de PC3 passe par R2 (coût
 * 30) plutôt que par le lien direct (coût 40), à l'inverse de RIP. Réseaux
 * de postes en interfaces passives. Identifiants : R1 10.13.0.1, R2 10.23.0.1,
 * R3 10.23.0.2 (plus grande adresse).
 */
export function ospfScenario(options: { ospf?: boolean } = {}): NfgDocument {
  const builder = new ScenarioBuilder("ospf", "OSPF : routage à état de liens")
    .device("pc1", "PC", 80, 320).device("r1", "R-200", 300, 320)
    .device("r2", "R-200", 460, 130).device("pc2", "PC", 220, 130)
    .device("r3", "R-200", 620, 320).device("pc3", "PC", 840, 320)
    .link("pc1", "eth0", "r1", "ge0").link("r2", "ge0", "pc2", "eth0").link("r3", "ge0", "pc3", "eth0")
    .link("r1", "ge1", "r2", "ge1").link("r2", "ge2", "r3", "ge2").link("r1", "ge2", "r3", "ge1")
    .ip("r1", "ge0", "10.1.0.1/24").ip("r2", "ge0", "10.2.0.1/24").ip("r3", "ge0", "10.3.0.1/24")
    .ip("r1", "ge1", "10.12.0.1/30").ip("r2", "ge1", "10.12.0.2/30")
    .ip("r2", "ge2", "10.23.0.1/30").ip("r3", "ge2", "10.23.0.2/30")
    .ip("r1", "ge2", "10.13.0.1/30").ip("r3", "ge1", "10.13.0.2/30")
    .ip("pc1", "eth0", "10.1.0.10/24").gateway("pc1", "10.1.0.1")
    .ip("pc2", "eth0", "10.2.0.10/24").gateway("pc2", "10.2.0.1")
    .ip("pc3", "eth0", "10.3.0.10/24").gateway("pc3", "10.3.0.1");
  if (options.ospf ?? true) {
    for (const router of ["r1", "r2", "r3"]) builder.ospf(router, "ge0", { mode: "passive" });
    builder.ospf("r1", "ge1").ospf("r2", "ge1").ospf("r2", "ge2").ospf("r3", "ge2");
    builder.ospf("r1", "ge2", { cost: 30 }).ospf("r3", "ge1", { cost: 30 });
  }
  return builder.build();
}

/**
 * OSPF sur un réseau à diffusion : quatre routeurs reliés par un switch
 * (10.0.0.0/24), chacun avec un réseau de postes passif (PC1 derrière R1, PC3
 * derrière R3). Priorités : R2 100
 * (DR), R3 0 (inéligible), R1 et R4 1 ; à priorité égale, R4 (10.4.0.1)
 * l'emporte sur R1 (10.1.0.1) pour le rôle de BDR.
 */
export function ospfLanScenario(): NfgDocument {
  const builder = new ScenarioBuilder("ospf-lan", "OSPF : élection du DR")
    .device("sw1", "S-24", 460, 260)
    .device("r1", "R-200", 220, 120).device("r2", "R-200", 700, 120)
    .device("r3", "R-200", 220, 400).device("r4", "R-200", 700, 400);
  ["r1", "r2", "r3", "r4"].forEach((router, index) => {
    const n = String(index + 1);
    builder.link("sw1", `ge${n}`, router, "ge0").ip(router, "ge0", `10.0.0.${n}/24`).ip(router, "ge1", `10.${n}.0.1/24`);
  });
  builder
    .device("pc1", "PC", 0, 120).device("pc3", "PC", 0, 400)
    .link("r1", "ge1", "pc1", "eth0").link("r3", "ge1", "pc3", "eth0")
    .ip("pc1", "eth0", "10.1.0.10/24").gateway("pc1", "10.1.0.1")
    .ip("pc3", "eth0", "10.3.0.10/24").gateway("pc3", "10.3.0.1");
  return builder
    .ospf("r1", "ge0").ospf("r2", "ge0", { priority: 100 }).ospf("r3", "ge0", { priority: 0 }).ospf("r4", "ge0")
    .ospf("r1", "ge1", { mode: "passive" }).ospf("r2", "ge1", { mode: "passive" }).ospf("r3", "ge1", { mode: "passive" }).ospf("r4", "ge1", { mode: "passive" })
    .build();
}

/**
 * VRRP : deux routeurs de passerelle (R1 priorité 110, R2 priorité 100) derrière
 * le switch du réseau de PC1, adresse virtuelle 192.168.1.1 (VRID 1), passerelle
 * de PC1. OSPF relie R1 et R2 à R3, qui dessert le réseau de PC2 : après une
 * bascule, le retour passe aussi par le nouveau maître. Option `owner` : R1
 * possède l'adresse virtuelle (192.168.1.1 sur ge0, priorité 255).
 */
export function vrrpScenario(options: { owner?: boolean; r1Preempt?: boolean } = {}): NfgDocument {
  const r1Address = options.owner ? "192.168.1.1/24" : "192.168.1.2/24";
  return new ScenarioBuilder("vrrp", "VRRP : passerelle redondante")
    .device("pc1", "PC", 60, 260).device("sw1", "S-24", 260, 260)
    .device("r1", "R-200", 480, 120).device("r2", "R-200", 480, 400)
    .device("r3", "R-200", 720, 260).device("pc2", "PC", 940, 260)
    .link("pc1", "eth0", "sw1", "ge1").link("sw1", "ge2", "r1", "ge0").link("sw1", "ge3", "r2", "ge0")
    .link("r1", "ge1", "r3", "ge1").link("r2", "ge1", "r3", "ge2").link("r3", "ge0", "pc2", "eth0")
    .ip("r1", "ge0", r1Address).ip("r2", "ge0", "192.168.1.3/24")
    .ip("r1", "ge1", "10.13.0.1/30").ip("r3", "ge1", "10.13.0.2/30")
    .ip("r2", "ge1", "10.23.0.1/30").ip("r3", "ge2", "10.23.0.2/30")
    .ip("r3", "ge0", "10.3.0.1/24")
    .ip("pc1", "eth0", "192.168.1.10/24").gateway("pc1", "192.168.1.1")
    .ip("pc2", "eth0", "10.3.0.10/24").gateway("pc2", "10.3.0.1")
    .vrrp("r1", "ge0", 1, "192.168.1.1", { priority: 110, preempt: options.r1Preempt ?? true }).vrrp("r2", "ge0", 1, "192.168.1.1")
    .ospf("r1", "ge0", { mode: "passive" }).ospf("r2", "ge0", { mode: "passive" }).ospf("r3", "ge0", { mode: "passive" })
    .ospf("r1", "ge1").ospf("r2", "ge1").ospf("r3", "ge1").ospf("r3", "ge2")
    .build();
}

/**
 * OSPF multi-zone : zone 1 (R1, PC1) — R2, routeur de bordure — dorsale (R2,
 * R3, PC3) — R3, routeur de bordure — zone 2 (R4, PC4). Chaque routeur
 * interne ne connaît que sa zone ; les autres réseaux lui parviennent par les
 * résumés des routeurs de bordure. Identifiants : R1 10.12.0.1, R2 10.23.0.1,
 * R3 10.34.0.1, R4 10.34.0.2.
 */
export function ospfAreasScenario(): NfgDocument {
  return new ScenarioBuilder("ospf-zones", "OSPF : zones multiples")
    .device("pc1", "PC", 0, 300).device("r1", "R-200", 200, 300).device("r2", "R-200", 420, 300)
    .device("r3", "R-200", 640, 300).device("pc3", "PC", 640, 40).device("r4", "R-200", 860, 300).device("pc4", "PC", 1060, 300)
    .link("pc1", "eth0", "r1", "ge0").link("r1", "ge1", "r2", "ge1").link("r2", "ge2", "r3", "ge2")
    .link("r3", "ge0", "pc3", "eth0").link("r3", "ge1", "r4", "ge1").link("r4", "ge0", "pc4", "eth0")
    .ip("r1", "ge0", "10.1.0.1/24").ip("r1", "ge1", "10.12.0.1/30").ip("r2", "ge1", "10.12.0.2/30")
    .ip("r2", "ge2", "10.23.0.1/30").ip("r3", "ge2", "10.23.0.2/30").ip("r3", "ge0", "10.3.0.1/24")
    .ip("r3", "ge1", "10.34.0.1/30").ip("r4", "ge1", "10.34.0.2/30").ip("r4", "ge0", "10.4.0.1/24")
    .ip("pc1", "eth0", "10.1.0.10/24").gateway("pc1", "10.1.0.1")
    .ip("pc3", "eth0", "10.3.0.10/24").gateway("pc3", "10.3.0.1")
    .ip("pc4", "eth0", "10.4.0.10/24").gateway("pc4", "10.4.0.1")
    .ospf("r1", "ge0", { mode: "passive", area: "0.0.0.1" }).ospf("r1", "ge1", { area: "0.0.0.1" }).ospf("r2", "ge1", { area: "0.0.0.1" })
    .ospf("r2", "ge2").ospf("r3", "ge2").ospf("r3", "ge0", { mode: "passive" })
    .ospf("r3", "ge1", { area: "0.0.0.2" }).ospf("r4", "ge1", { area: "0.0.0.2" }).ospf("r4", "ge0", { mode: "passive", area: "0.0.0.2" })
    .build();
}

/**
 * BGP : trois systèmes autonomes en triangle, un routeur chacun (R1 AS 65001,
 * R2 AS 65002, R3 AS 65003), chacun annonçant le réseau de son poste. Le
 * chemin direct (un AS) l'emporte sur le détour (deux AS) ; après une
 * coupure, le détour prend le relais. Option `bgp` faux : aucun routage.
 */
export function bgpScenario(options: { bgp?: boolean } = {}): NfgDocument {
  const builder = new ScenarioBuilder("bgp", "BGP : systèmes autonomes")
    .device("pc1", "PC", 80, 320).device("r1", "R-200", 300, 320)
    .device("r2", "R-200", 460, 130).device("pc2", "PC", 220, 130)
    .device("r3", "R-200", 620, 320).device("pc3", "PC", 840, 320)
    .link("pc1", "eth0", "r1", "ge0").link("r2", "ge0", "pc2", "eth0").link("r3", "ge0", "pc3", "eth0")
    .link("r1", "ge1", "r2", "ge1").link("r2", "ge2", "r3", "ge2").link("r1", "ge2", "r3", "ge1")
    .ip("r1", "ge0", "10.1.0.1/24").ip("r2", "ge0", "10.2.0.1/24").ip("r3", "ge0", "10.3.0.1/24")
    .ip("r1", "ge1", "10.12.0.1/30").ip("r2", "ge1", "10.12.0.2/30")
    .ip("r2", "ge2", "10.23.0.1/30").ip("r3", "ge2", "10.23.0.2/30")
    .ip("r1", "ge2", "10.13.0.1/30").ip("r3", "ge1", "10.13.0.2/30")
    .ip("pc1", "eth0", "10.1.0.10/24").gateway("pc1", "10.1.0.1")
    .ip("pc2", "eth0", "10.2.0.10/24").gateway("pc2", "10.2.0.1")
    .ip("pc3", "eth0", "10.3.0.10/24").gateway("pc3", "10.3.0.1");
  if (options.bgp ?? true) {
    builder
      .bgp("r1", 65001, [["10.12.0.2", 65002], ["10.13.0.2", 65003]], ["10.1.0.0/24"])
      .bgp("r2", 65002, [["10.12.0.1", 65001], ["10.23.0.2", 65003]], ["10.2.0.0/24"])
      .bgp("r3", 65003, [["10.23.0.1", 65002], ["10.13.0.1", 65001]], ["10.3.0.0/24"]);
  }
  return builder.build();
}

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
    if (this.doc.configurations[id]?.stp) this.doc = ok(setStp(this.doc, { deviceId: id, enabled: false, priority: 32768 }));
    return this;
  }

  /** Spanning Tree d'un switch (désactivé par défaut dans les scénarios). */
  stp(deviceId: string, enabled: boolean, priority = 32768): this {
    this.doc = ok(setStp(this.doc, { deviceId, enabled, priority }));
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

  dhcpClient(deviceId: string): this {
    this.doc = ok(setInterfaceDhcp(this.doc, { deviceId, portId: "eth0", enabled: true }));
    return this;
  }

  dhcpPool(deviceId: string, portId: string, start: string, end: string, gateway: string, leaseSeconds = 120): this {
    this.doc = ok(setDhcpPool(this.doc, { deviceId, interfaceId: portId, pool: { start, end, gateway, leaseSeconds } }));
    return this;
  }

  dnsServer(deviceId: string, server: string): this {
    this.doc = ok(setDnsServer(this.doc, { deviceId, server }));
    return this;
  }

  dnsRecord(deviceId: string, name: string, address: string): this {
    this.doc = ok(setDnsRecord(this.doc, { deviceId, name, address }));
    return this;
  }

  /** Participation d'une interface de routeur à RIP (active par défaut). */
  rip(deviceId: string, interfaceId: string, mode: RipMode = "active"): this {
    this.doc = ok(setRipInterface(this.doc, { deviceId, interfaceId, mode }));
    return this;
  }

  /** Participation d'une interface de routeur à OSPF (active, coût 10, priorité 1 et dorsale par défaut). */
  ospf(deviceId: string, interfaceId: string, options: { mode?: OspfMode; cost?: number; priority?: number; area?: string } = {}): this {
    const ospf = { mode: options.mode ?? "active", cost: options.cost ?? 10, priority: options.priority ?? 1, area: options.area ?? "0.0.0.0" };
    this.doc = ok(setOspfInterface(this.doc, { deviceId, interfaceId, ospf }));
    return this;
  }

  /** Groupe VRRP d'une interface de routeur (priorité 100 et préemption par défaut). */
  vrrp(deviceId: string, interfaceId: string, vrid: number, address: string, options: { priority?: number; preempt?: boolean } = {}): this {
    this.doc = ok(setVrrpGroup(this.doc, { deviceId, interfaceId, group: { vrid, address, priority: options.priority ?? 100, preempt: options.preempt ?? true } }));
    return this;
  }

  /** BGP d'un routeur : AS, voisins externes (adresse, AS distant) et réseaux annoncés (CIDR). */
  bgp(deviceId: string, as: number, neighbors: ReadonlyArray<readonly [address: string, remoteAs: number]>, networks: readonly string[]): this {
    this.doc = ok(setBgpAs(this.doc, { deviceId, as }));
    for (const [address, remoteAs] of neighbors) this.doc = ok(setBgpNeighbor(this.doc, { deviceId, address, remoteAs }));
    for (const cidr of networks) {
      const [address = "", prefix = "0"] = cidr.split("/");
      this.doc = ok(setBgpNetwork(this.doc, { deviceId, network: { address, prefixLength: Number(prefix) }, present: true }));
    }
    return this;
  }

  route(deviceId: string, cidr: string, nextHop: string): this {
    const [destination = "", prefix = "0"] = cidr.split("/");
    this.doc = ok(addStaticRoute(this.doc, { deviceId, route: { destination, prefixLength: Number(prefix), nextHop } }));
    return this;
  }

  /** Port de switch en accès dans un VLAN. */
  access(deviceId: string, portId: string, vlan: number): this {
    this.doc = ok(setSwitchport(this.doc, { deviceId, portId, switchport: { mode: "access", vlan } }));
    return this;
  }

  /** Port de switch en trunk 802.1Q. */
  trunk(deviceId: string, portId: string, allowedVlans: "all" | number[] = "all", nativeVlan = 1): this {
    this.doc = ok(setSwitchport(this.doc, { deviceId, portId, switchport: { mode: "trunk", nativeVlan, allowedVlans } }));
    return this;
  }

  /** Propriétés de la fibre du dernier lien créé. */
  fiber(length: number, type: Fiber["type"] = "G.652.D", cable: Fiber["cable"] = "distribution"): this {
    this.doc = ok(setFiber(this.doc, { linkId: `l${String(this.linkCount)}`, fiber: { length, type, cable } }));
    return this;
  }

  /** Implantation d'un équipement : rue, immeuble, logement ou étage (chaîne vide : non renseigné). */
  location(deviceId: string, street: string, building: string, unit: string): this {
    this.doc = ok(setDeviceLocation(this.doc, { deviceId, location: { street, building, unit } }));
    return this;
  }

  /** Numéro de série d'un ONT (un ONT neuf reçoit NFGE00000001, NFGE00000002…). */
  serial(ontId: string, serial: string): this {
    this.doc = ok(setOntSerial(this.doc, { deviceId: ontId, serial }));
    return this;
  }

  /** Autorise sur un port d'OLT le numéro de série d'un ONT du projet, ou un numéro donné (12 caractères). */
  authorize(oltId: string, portId: string, ontOrSerial: string, onuId?: number): this {
    const serial = this.doc.configurations[ontOrSerial]?.serialNumber ?? ontOrSerial;
    this.doc = ok(setPonAuthorization(this.doc, { deviceId: oltId, portId, serial, present: true, ...(onuId === undefined ? {} : { onuId }) }));
    return this;
  }

  /** Profil d'un service sur un OLT : VLAN, débits garanti/maximal en Mbit/s (descendant, puis montant ou null). */
  service(oltId: string, service: PonService, vlan: number, down: readonly [number, number], up: readonly [number, number] | null): this {
    const rate = ([guaranteed, max]: readonly [number, number]) => ({ guaranteedKbps: Math.round(guaranteed * 1000), maxKbps: Math.round(max * 1000) });
    this.doc = ok(setPonService(this.doc, { deviceId: oltId, service, profile: { vlan, downstream: rate(down), upstream: up ? rate(up) : null } }));
    return this;
  }

  /** Offre d'un ONT autorisé (par son identifiant d'équipement) sur un port d'OLT. */
  offer(oltId: string, portId: string, ontId: string, services: readonly PonService[]): this {
    const serial = this.doc.configurations[ontId]?.serialNumber ?? ontId;
    this.doc = ok(setOntServices(this.doc, { deviceId: oltId, portId, serial, services }));
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

export const VLAN_SCENARIO = {
  /** VLAN 10 : PC1 (SW1) et PC3 (SW2) ; VLAN 20 : PC2 (SW1) ; PC4 en VLAN 20 mais adressé dans le réseau du VLAN 10. */
  pc1: "192.168.10.11",
  pc2: "192.168.20.12",
  pc3: "192.168.10.13",
  pc4: "192.168.10.14",
} as const;

/**
 * VLAN et routage inter-VLAN (« router-on-a-stick ») : SW1 et SW2 reliés par
 * un trunk (l5, VLAN 10 et 20 autorisés) ; R1 relié à SW1 par un trunk (l6)
 * avec les sous-interfaces ge0.10 et ge0.20. PC4, en VLAN 20, porte une
 * adresse du réseau du VLAN 10 : ses diffusions ARP restent dans le VLAN 20.
 */
export function vlanScenario(options: { trunkAllowed?: "all" | number[] } = {}): NfgDocument {
  return new ScenarioBuilder("scenario-vlan", "VLAN et routage inter-VLAN")
    .device("pc1", "PC", 100, 380)
    .device("pc2", "PC", 260, 380)
    .device("sw1", "S-24", 180, 220)
    .device("sw2", "S-24", 500, 220)
    .device("pc3", "PC", 440, 380)
    .device("pc4", "PC", 580, 380)
    .device("r1", "R-200", 180, 60)
    .link("pc1", "eth0", "sw1", "ge1")
    .link("pc2", "eth0", "sw1", "ge2")
    .link("pc3", "eth0", "sw2", "ge1")
    .link("pc4", "eth0", "sw2", "ge2")
    .link("sw1", "ge24", "sw2", "ge24")
    .link("r1", "ge0", "sw1", "ge23")
    .access("sw1", "ge1", 10)
    .access("sw1", "ge2", 20)
    .access("sw2", "ge1", 10)
    .access("sw2", "ge2", 20)
    .trunk("sw1", "ge24", options.trunkAllowed ?? [10, 20])
    .trunk("sw2", "ge24", options.trunkAllowed ?? [10, 20])
    .trunk("sw1", "ge23", [10, 20])
    .ip("r1", "ge0.10", "192.168.10.1/24")
    .ip("r1", "ge0.20", "192.168.20.1/24")
    .ip("pc1", "eth0", `${VLAN_SCENARIO.pc1}/24`)
    .ip("pc2", "eth0", `${VLAN_SCENARIO.pc2}/24`)
    .ip("pc3", "eth0", `${VLAN_SCENARIO.pc3}/24`)
    .ip("pc4", "eth0", `${VLAN_SCENARIO.pc4}/24`)
    .gateway("pc1", "192.168.10.1")
    .gateway("pc2", "192.168.20.1")
    .gateway("pc3", "192.168.10.1")
    .build();
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

/**
 * Spanning Tree : trois switches en triangle, STP activé. SW1 (priorité 4096)
 * est la racine ; SW2 (28672) l'emporte sur SW3 (32768) sur le segment SW2–SW3,
 * dont le port de SW3 (ge2) est bloqué. PC1 sur SW2, PC2 sur SW3.
 * Liens : l1 SW1 ge1–SW2 ge1, l2 SW2 ge2–SW3 ge2, l3 SW3 ge1–SW1 ge2, l4 et l5 vers les PC.
 */
export function stpTriangleScenario(): NfgDocument {
  return new ScenarioBuilder("scenario-stp", "Spanning Tree en triangle")
    .device("sw1", "S-24", 400, 80)
    .device("sw2", "S-24", 220, 300)
    .device("sw3", "S-24", 580, 300)
    .device("pc1", "PC", 220, 460)
    .device("pc2", "PC", 580, 460)
    .link("sw1", "ge1", "sw2", "ge1")
    .link("sw2", "ge2", "sw3", "ge2")
    .link("sw3", "ge1", "sw1", "ge2")
    .link("pc1", "eth0", "sw2", "ge10")
    .link("pc2", "eth0", "sw3", "ge10")
    .stp("sw1", true, 4096)
    .stp("sw2", true, 28672)
    .stp("sw3", true, 32768)
    .ip("pc1", "eth0", "192.168.1.10/24")
    .ip("pc2", "eth0", "192.168.1.11/24")
    .build();
}

/** Boucle de commutation de référence (trois câbles parallèles) avec STP activé : deux câbles bloqués. */
export function stpParallelScenario(): NfgDocument {
  return new ScenarioBuilder("scenario-stp-parallel", "Câbles parallèles et STP")
    .device("pc1", "PC", 100, 300)
    .device("sw1", "S-24", 300, 200)
    .device("pc2", "PC", 500, 300)
    .device("sw2", "S-24", 300, 50)
    .link("pc1", "eth0", "sw1", "ge1")
    .link("pc2", "eth0", "sw1", "ge2")
    .link("sw1", "ge10", "sw2", "ge1")
    .link("sw1", "ge11", "sw2", "ge2")
    .link("sw1", "ge12", "sw2", "ge3")
    .stp("sw1", true, 4096)
    .stp("sw2", true)
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
 * ONT1 à ONT3 (NFGE00000001 à 3) autorisés sur OLT1 pon1, identifiants d'ONU 0 à 2.
 * Services de l'OLT : Internet (VLAN 100, descendant 100/1 000 Mbit/s, montant 20/500),
 * VoIP (VLAN 200, 0,2/0,2 dans les deux sens), IPTV (VLAN 300, descendant 20/20, multicast).
 * Offres : ONT1 Internet, VoIP, IPTV ; ONT2 Internet, VoIP ; ONT3 Internet, IPTV.
 * Implantation (adresses fictives) : central optique (OLT1, ODF1), armoire de rue (CPL1),
 * Résidence Les Lilas, bâtiment A (CPL2 et PBO1 au local technique, PTO et ONT par appartement).
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
    builder.authorize("olt1", "pon1", `ont${String(index)}`);
  }
  builder
    .service("olt1", "internet", 100, [100, 1000], [20, 500])
    .service("olt1", "voip", 200, [0.2, 0.2], [0.2, 0.2])
    .service("olt1", "iptv", 300, [20, 20], null)
    .offer("olt1", "pon1", "ont1", ["internet", "voip", "iptv"])
    .offer("olt1", "pon1", "ont2", ["internet", "voip"])
    .offer("olt1", "pon1", "ont3", ["internet", "iptv"])
    .location("olt1", "Avenue des Tilleuls", "Central optique", "Salle de transmission")
    .location("odf1", "Avenue des Tilleuls", "Central optique", "Salle de transmission")
    .location("cpl1", "Avenue des Tilleuls", "", "Armoire de rue n° 3")
    .location("cpl2", "Rue des Lilas", "Résidence Les Lilas, bâtiment A", "Local technique")
    .location("pbo1", "Rue des Lilas", "Résidence Les Lilas, bâtiment A", "Local technique");
  ["Appartement 11", "Appartement 12", "Appartement 21"].forEach((unit, offset) => {
    for (const kind of ["pto", "ont"]) builder.location(`${kind}${String(offset + 1)}`, "Rue des Lilas", "Résidence Les Lilas, bâtiment A", unit);
  });
  if (options.dirtyPto3) builder.fault("panne-1", "dirty-connector", { kind: "port", deviceId: "pto3", portId: "out" }, 4.5);
  return builder.build();
}

/**
 * Réseau XGS-PON de référence (classe N1), calculable à la main :
 * OLT1 (OLT-XGS-8) pon1 —jarretière 2 m— ODF1 f1 | r1 —transport 2 km— CPL1 (1:64)
 * o1..o3 —raccordement 300 m (G.657.A2, câble court)— PTO1..3 | out —jarretière 2 m— ONT1..3.
 * ONT1 et ONT2 : ONT-10G (NFGE00000001 et 2) ; ONT3 : ONT-1G GPON (NFGE00000003), technologie incompatible.
 * Autorisations sur pon1 : ONT1 (identifiant 0) et un numéro absent du réseau, NFGE000000FF (identifiant 5) ;
 * ONT2 est découvert mais pas autorisé (option authorizeOnt2 : autorisé, identifiant 1).
 * Liens : l1 (jarretière OLT), l2 (transport), l3 à l5 (raccordement), l6 à l8 (jarretières ONT).
 */
export function xgsPonScenario(options: { authorizeOnt2?: boolean } = {}): NfgDocument {
  const builder = new ScenarioBuilder("scenario-xgs-pon", "Réseau XGS-PON")
    .device("olt1", "OLT-XGS-8", 80, 260)
    .device("odf1", "ODF-12", 260, 260)
    .device("cpl1", "SPL-64", 440, 260)
    .link("olt1", "pon1", "odf1", "f1")
    .link("odf1", "r1", "cpl1", "com")
    .fiber(2000);
  for (let index = 1; index <= 3; index += 1) {
    builder.device(`pto${String(index)}`, "PTO", 640, 120 + (index - 1) * 140).link("cpl1", `o${String(index)}`, `pto${String(index)}`, "in").fiber(300, "G.657.A2", "short");
  }
  for (let index = 1; index <= 3; index += 1) {
    builder.device(`ont${String(index)}`, index === 3 ? "ONT-1G" : "ONT-10G", 840, 120 + (index - 1) * 140).link(`pto${String(index)}`, "out", `ont${String(index)}`, "pon");
  }
  builder.authorize("olt1", "pon1", "ont1", 0).authorize("olt1", "pon1", "NFGE000000FF", 5);
  if (options.authorizeOnt2) builder.authorize("olt1", "pon1", "ont2", 1);
  return builder.build();
}
