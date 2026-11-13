import { analyzePon, type DeviceView } from "@netforge/engine";
import { formatVlanList, getModel, prefixToMask, switchportOf, type CliError, type CliHelpEntry, type NfgDocument } from "@netforge/project";
import { fill, messages } from "./index";
import { formatSimTime, ospfSequence, type NameIndex } from "./simulation";
import { blockText, ontStateText } from "../features/optics/format";

/**
 * Sorties de la console mises en forme à partir des codes de l'interpréteur
 * (packages/project/src/cli.ts) et des tables calculées par le moteur.
 */
const t = messages.console;

/** Tableau en colonnes alignées (police à chasse fixe). */
export function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string[] {
  if (rows.length === 0) return [t.empty];
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
}

export function formatCliError(error: CliError): string[] {
  const params: Record<string, string | number> = { ...error.params };
  if (error.code === "cli.wrong-mode") {
    const mode = String(error.params["mode"] ?? "operation") as keyof typeof t.modes;
    params["modeName"] = t.modes[mode];
    params["modeHint"] = t.modeHints[mode];
  }
  const lines = [fill(t.errors[error.code], params)];
  if (error.code === "cli.unknown-command" && error.params["suggestion"]) lines.push(fill(t.suggestion, params));
  if (error.code === "cli.missing-argument" && error.params["usage"]) lines.push(fill(t.usage, params));
  return lines;
}

export function helpLines(entries: readonly CliHelpEntry[]): string[] {
  const width = Math.max(0, ...entries.map((entry) => entry.usage.length));
  return entries.map((entry) => `${entry.usage.padEnd(width)}  ${entry.id in t.help ? t.help[entry.id as keyof typeof t.help] : ""}`.trimEnd());
}

export function showInterfaces(view: DeviceView): string[] {
  const c = t.columns;
  const ports = view.interfaces.filter((item) => item.linkId !== null || item.ipv4 !== null);
  return table(
    [c.port, c.mac, c.ipv4, c.state],
    (ports.length > 0 ? ports : view.interfaces).map((item) => [item.portId, item.mac, item.ipv4 ?? "—", item.up ? t.up : t.down]),
  );
}

export function showRoutes(view: DeviceView): string[] {
  const c = t.columns;
  const kinds = messages.simulation.runtime.routeKinds;
  return table(
    [c.kind, c.destination, c.nextHop, c.port, c.state],
    view.routes.map((route) => [
      route.metric === null
        ? kinds[route.kind]
        : fill(route.kind === "bgp" ? messages.simulation.runtime.routeBgp : messages.simulation.runtime.routeMetric, { kind: kinds[route.kind], metric: route.metric }),
      `${route.destination}/${String(route.prefixLength)}`,
      route.nextHop ?? messages.simulation.runtime.direct,
      route.portId ?? "—",
      route.active ? t.active : `${t.inactive} (${route.reason ? messages.simulation.runtime.reasons[route.reason] : ""})`,
    ]),
  );
}

export function showArp(view: DeviceView, names: NameIndex): string[] {
  const c = t.columns;
  return table(
    [c.ip, c.mac, c.port, c.expires],
    view.arpCache.map((entry) => [entry.ip, names.mac(entry.mac), entry.portId, formatSimTime(entry.expiresAt)]),
  );
}

export function showMac(view: DeviceView, names: NameIndex): string[] {
  const c = t.columns;
  return table(
    [c.vlan, c.mac, c.port, c.expires],
    view.macTable.map((entry) => [String(entry.vlan), names.mac(entry.mac), entry.portId, formatSimTime(entry.expiresAt)]),
  );
}

/** « show vlans » : ports d'accès par VLAN, puis trunks (configuration du projet). */
export function showVlans(doc: NfgDocument, deviceId: string): string[] {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  if (!device) return [];
  const c = t.columns;
  const switchports = doc.configurations[deviceId]?.switchports;
  const ports = getModel(device.model).ports.map((port) => ({ id: port.id, config: switchportOf(switchports, port.id) }));
  const byVlan = new Map<number, string[]>();
  for (const port of ports) {
    if (port.config.mode !== "access") continue;
    byVlan.set(port.config.vlan, [...(byVlan.get(port.config.vlan) ?? []), port.id]);
  }
  const access = table(
    [c.vlan, c.ports],
    [...byVlan.entries()].sort(([a], [b]) => a - b).map(([vlan, ids]) => [String(vlan), ids.join(", ")]),
  );
  const trunks = ports.flatMap((port) => (port.config.mode === "trunk" ? [[port.id, String(port.config.nativeVlan), formatVlanList(port.config.allowedVlans)]] : []));
  return trunks.length === 0 ? access : [...access, "", ...table([c.trunk, c.native, c.allowed], trunks)];
}

/** « show spanning-tree » : racine élue, port racine, puis rôle et état de chaque port (calculés par le moteur). */
export function showStp(view: DeviceView, names: NameIndex): string[] {
  const r = messages.simulation.runtime;
  const stp = view.stp;
  if (!stp?.enabled) return [r.stpDisabled];
  const summary =
    stp.rootDeviceId === view.deviceId
      ? fill(r.stpIsRoot, { bridge: stp.bridgeId })
      : fill(r.stpRoot, { root: names.device(stp.rootDeviceId ?? ""), bridge: stp.rootBridgeId ?? "", cost: stp.rootCost, port: stp.rootPort ?? "—" });
  const c = t.columns;
  const roles = messages.simulation.stpRoles;
  const states = messages.simulation.stpStates;
  return [summary, "", ...table([c.port, c.role, c.stpState, c.cost], stp.ports.map((port) => [port.portId, roles[port.role], states[port.state], String(port.cost)]))];
}

/** Affiche uniquement les plages et baux calculés par le moteur. */
export function showDhcp(view: DeviceView, names: NameIndex): string[] {
  const server = view.dhcpServer;
  const r = messages.simulation.runtime;
  if (!server) return [r.dhcpNone];
  return [
    ...server.pools.map((pool) => `${pool.portId} : ${fill(r.dhcpPool, { ...pool })}`),
    ...table([t.columns.ip, t.columns.mac, t.columns.port, t.columns.state, t.columns.expires], server.leases.map((lease) => [
      lease.address, names.mac(lease.mac), lease.portId, lease.state === "bound" ? r.dhcpBound : r.dhcpOffered, lease.expiresAt === null ? "—" : formatSimTime(lease.expiresAt),
    ])),
  ];
}

/** « show dns » : noms publiés et réponses données par le service DNS (calculés par le moteur). */
export function showDns(view: DeviceView): string[] {
  const service = view.dnsServer;
  const r = messages.simulation.runtime;
  if (!service) return [r.dnsNone];
  return [
    fill(r.dnsCounters, { answered: service.answered, nameErrors: service.nameErrors }),
    "",
    ...(service.records.length === 0 ? [r.dnsNoRecords] : table([t.columns.name, t.columns.address], service.records.map((record) => [record.name, record.address]))),
  ];
}

/** « show rip » : interfaces RIP, table RIP calculée par le moteur et prochaine annonce périodique. */
export function showRip(view: DeviceView): string[] {
  const rip = view.rip;
  const r = messages.simulation.runtime;
  if (!rip) return [t.ripNone];
  const c = t.columns;
  const states = messages.simulation.ripStates;
  return [
    rip.interfaces.map((item) => fill(r.ripInterface, { port: item.portId, mode: r.ripModes[item.mode] }) + (item.up ? "" : ` (${t.down})`)).join(" ; "),
    fill(r.ripNext, { time: formatSimTime(rip.nextUpdateAt) }),
    "",
    ...table(
      [c.network, c.nextHop, c.port, c.metric, c.state, c.expires],
      rip.routes.map((entry) => [
        `${entry.destination}/${String(entry.prefixLength)}`,
        entry.nextHop ?? r.direct,
        entry.portId,
        String(entry.metric),
        states[entry.state],
        entry.state === "deleting" && entry.garbageAt !== null ? formatSimTime(entry.garbageAt) : entry.expiresAt === null ? "—" : formatSimTime(entry.expiresAt),
      ]),
    ),
  ];
}

/** « show ospf » : identifiant du routeur, état des interfaces (DR, BDR) et voisins, calculés par le moteur. */
export function showOspf(view: DeviceView): string[] {
  const ospf = view.ospf;
  if (!ospf) return [t.ospfNone];
  const s = messages.simulation;
  const c = t.columns;
  return [
    fill(s.runtime.ospfRouter, { routerId: ospf.routerId, areas: fill(ospf.abr ? s.runtime.ospfAbr : s.runtime.ospfAreas, { areas: ospf.areas.join(", ") }), time: formatSimTime(ospf.nextHelloAt) }),
    "",
    ...table(
      [c.port, c.area, c.state, c.cost, c.priority, c.dr, c.bdr],
      ospf.interfaces.map((item) => [item.portId, item.area, s.ospfInterfaceStates[item.state], String(item.cost), String(item.priority), item.dr ?? s.ospfNone, item.bdr ?? s.ospfNone]),
    ),
    "",
    ...table(
      [c.neighbor, c.address, c.port, c.priority, c.state, c.role, c.deadAt],
      ospf.interfaces.flatMap((item) =>
        item.neighbors.map((neighbor) => [
          neighbor.routerId,
          neighbor.address,
          item.portId,
          String(neighbor.priority),
          s.ospfNeighborStates[neighbor.state],
          s.ospfRoles[neighbor.role],
          formatSimTime(neighbor.deadAt),
        ]),
      ),
    ),
  ];
}

/** « show ospf database » : LSA de la base d'états des liens, avec leur contenu. */
export function showOspfDatabase(view: DeviceView): string[] {
  const ospf = view.ospf;
  if (!ospf) return [t.ospfNone];
  if (ospf.lsdb.length === 0) return [t.ospfLsdbEmpty];
  const v = messages.simulation.values;
  const c = t.columns;
  return table(
    [c.area, c.lsaType, c.lsId, c.advertisingRouter, c.sequence, c.age, c.content],
    ospf.lsdb.map((lsa) => [
      lsa.area,
      messages.simulation.ospfLsaTypes[lsa.lsaType],
      lsa.lsId,
      lsa.advertisingRouter,
      ospfSequence(lsa.sequence),
      String(lsa.age),
      lsa.lsaType === "summary"
        ? fill(v.ospfSummary, { mask: lsa.mask ?? "", metric: lsa.metric ?? 0 })
        : lsa.lsaType === "router"
        ? lsa.links.map((link) => fill(v.ospfLink, { type: v.ospfLinkTypes[link.type], linkId: link.linkId, linkData: link.linkData, metric: link.metric })).join(" ; ")
        : `${fill(v.ospfNetwork, { mask: lsa.mask ?? "" })} ; ${lsa.attachedRouters.join(", ")}`,
    ]),
  );
}

/** « show bgp » : sessions avec les voisins, puis tous les chemins connus (le retenu marqué). */
export function showBgp(view: DeviceView): string[] {
  const bgp = view.bgp;
  if (!bgp) return [t.bgpNone];
  const s = messages.simulation;
  const r = s.runtime;
  const c = t.columns;
  return [
    fill(r.bgpRouter, { as: bgp.as, routerId: bgp.routerId }),
    "",
    ...table(
      [c.neighbor, c.remoteAs, c.state, c.received],
      bgp.peers.map((peer) => [peer.address, String(peer.remoteAs), s.bgpStates[peer.state], String(peer.received)]),
    ),
    "",
    ...table(
      [c.network, c.asPath, c.nextHop, c.best],
      bgp.table.map((route) => [route.network, route.asPath.length === 0 ? "—" : route.asPath.join(" "), route.nextHop ?? r.bgpLocal, route.best ? r.bgpBest : r.bgpAlternative]),
    ),
  ];
}

/**
 * « show pon » : activation PON calculée par le moteur (analyse statique, sans
 * simulation chargée). OLT : ONT autorisés et découverts par port ; ONT : état
 * et étapes. Comme la console d'un équipement réel, on n'y lit que des
 * symptômes (puissance, numéro de série), jamais la panne.
 */
export function showPon(doc: NfgDocument, deviceId: string): string[] {
  const report = analyzePon(doc);
  const p = messages.optics.pon;
  const technology = messages.optics.technology;
  const c = t.columns;
  const name = (id: string) => doc.topology.devices.find((device) => device.id === id)?.name ?? id;
  const ont = report.onts.find((item) => item.ontId === deviceId);
  if (ont) {
    return [
      fill(p.ont, { name: name(ont.ontId), technology: technology[ont.technology], serial: ont.serial ?? p.noSerial }),
      ontStateText(ont.state),
      ont.state === "O5" && ont.olt && ont.onuId !== null ? fill(p.onuId, { onuId: ont.onuId, olt: name(ont.olt.deviceId), port: ont.olt.portId }) : blockText(ont, true),
      "",
      ...table(
        [c.step, c.outcome],
        ont.steps.map(({ step, outcome }) => [p.steps[ont.technology][step], p.outcome[outcome]]),
      ),
    ];
  }
  const ports = report.ports.filter((port) => port.oltId === deviceId);
  if (ports.length === 0) return [t.ponNoPort];
  return ports.flatMap((port, index) => [
    ...(index > 0 ? [""] : []),
    fill(p.port, { olt: name(port.oltId), port: port.portId, technology: technology[port.technology] }),
    ...table(
      [c.serial, c.onuId, c.ont, c.state],
      [
        ...port.authorizations.map((entry) => [entry.serial, String(entry.onuId), entry.ontId ? name(entry.ontId) : "—", entry.state ? ontStateText(entry.state) : p.absent]),
        ...port.discovered.map((item) => [item.serial, "—", name(item.ontId), p.blocks[item.block]]),
      ],
    ),
  ]);
}

/** « show vrrp » : groupes VRRP, état, priorité, maître connu et échéances calculés par le moteur. */
export function showVrrp(view: DeviceView): string[] {
  if (!view.vrrp) return [t.vrrpNone];
  const s = messages.simulation;
  const c = t.columns;
  return table(
    [c.port, c.vrid, c.address, c.virtualMac, c.priority, c.preempt, c.state, c.master, c.deadline],
    view.vrrp.map((group) => [
      group.portId,
      String(group.vrid),
      group.address,
      group.virtualMac,
      String(group.priority),
      group.preempt ? s.values.yes : s.values.no,
      s.vrrpStates[group.state],
      group.master ?? "—",
      group.state === "master" && group.nextAdvertAt !== null ? formatSimTime(group.nextAdvertAt) : group.downAt !== null ? formatSimTime(group.downAt) : "—",
    ]),
  );
}

/** « ipconfig » : configuration du projet et adresse MAC calculée par le moteur. */
export function ipconfig(doc: NfgDocument, deviceId: string, view: DeviceView | undefined): string[] {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  if (!device) return [];
  const config = doc.configurations[deviceId];
  const i = t.ipconfig;
  const interfaces = getModel(device.model).ports.flatMap((port) => {
    const automatic = config?.interfaces[port.id]?.dhcp ?? false;
    const lease = automatic ? view?.dhcpClient?.lease : null;
    const ipv4 = automatic ? lease : config?.interfaces[port.id]?.ipv4;
    const mac = view?.interfaces.find((item) => item.portId === port.id)?.mac ?? "—";
    return [
      fill(i.title, { port: port.id }),
      fill(i.mac, { value: mac }),
      fill(i.address, { value: ipv4?.address ?? i.none }),
      fill(i.mask, { value: ipv4 ? prefixToMask(ipv4.prefixLength) : i.none }),
      fill(i.gateway, { value: (automatic ? lease?.gateway : config?.defaultGateway) ?? i.none }),
      ...(automatic ? [messages.properties.dhcpAutomatic, messages.simulation.dhcpPhases[view?.dhcpClient?.phase ?? "init"]] : []),
    ];
  });
  return [...interfaces, fill(i.dns, { value: config?.dnsServer ?? i.none })];
}
