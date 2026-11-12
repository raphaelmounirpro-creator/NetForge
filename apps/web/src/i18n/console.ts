import type { DeviceView } from "@netforge/engine";
import { formatVlanList, getModel, prefixToMask, switchportOf, type CliError, type CliHelpEntry, type NfgDocument } from "@netforge/project";
import { fill, messages } from "./index";
import { formatSimTime, type NameIndex } from "./simulation";

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
      kinds[route.kind],
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

/** « ipconfig » : configuration du projet et adresse MAC calculée par le moteur. */
export function ipconfig(doc: NfgDocument, deviceId: string, view: DeviceView | undefined): string[] {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  if (!device) return [];
  const config = doc.configurations[deviceId];
  const i = t.ipconfig;
  return getModel(device.model).ports.flatMap((port) => {
    const ipv4 = config?.interfaces[port.id]?.ipv4 ?? null;
    const mac = view?.interfaces.find((item) => item.portId === port.id)?.mac ?? "—";
    return [
      fill(i.title, { port: port.id }),
      fill(i.mac, { value: mac }),
      fill(i.address, { value: ipv4?.address ?? i.none }),
      fill(i.mask, { value: ipv4 ? prefixToMask(ipv4.prefixLength) : i.none }),
      fill(i.gateway, { value: config?.defaultGateway ?? i.none }),
    ];
  });
}
