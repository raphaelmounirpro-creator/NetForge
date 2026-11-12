import { cliPrompt, configurationCommands, interpret, type CliRequest } from "@netforge/project";
import { fill, formatIssue, messages } from "../../i18n";
import { formatCliError, helpLines, ipconfig, showArp, showDhcp, showDns, showInterfaces, showMac, showRoutes, showStp, showVlans } from "../../i18n/console";
import { formatCommandError } from "../../i18n/simulation";
import { useLabStore } from "../lab/store";
import { consoleKey, EMPTY_CONSOLE, useConsoleStore } from "./consoleStore";
import { networkFingerprint } from "./fingerprint";
import { simulation } from "./services";
import { useSimulationStore } from "./store";

const t = messages.console;

/**
 * Exécute une ligne de console : l'interpréteur (pur) décide de l'intention ;
 * les modifications passent par la même commande métier que les formulaires
 * (apply du projet), les demandes d'exécution par le moteur.
 */
export async function runConsoleLine(projectId: string, deviceId: string, line: string): Promise<void> {
  const lab = useLabStore.getState();
  const doc = lab.projects[projectId]?.document;
  const device = doc?.topology.devices.find((item) => item.id === deviceId);
  if (!doc || !device) return;
  const key = consoleKey(projectId, deviceId);
  const consoles = useConsoleStore.getState();
  const current = consoles.consoles[key] ?? EMPTY_CONSOLE;
  consoles.append(key, "input", [`${cliPrompt(device, current.mode)} ${line}`]);
  if (line.trim() !== "") consoles.remember(key, line.trim());

  const result = interpret(doc, deviceId, current.mode, line);
  consoles.setMode(key, result.mode);
  if (!result.ok) {
    consoles.append(key, "error", result.error ? formatCliError(result.error) : result.issues.map(formatIssue));
    return;
  }
  if (result.edit) {
    const applied = lab.apply(projectId, result.edit);
    if (!applied) consoles.append(key, "error", [t.readonly]);
    else if (!applied.ok) consoles.append(key, "error", applied.errors.map(formatIssue));
    else {
      const session = useSimulationStore.getState().session;
      const stale = session?.projectId === projectId && session.fingerprint !== networkFingerprint(applied.document);
      consoles.append(key, "info", [stale ? t.appliedStale : t.applied]);
      if (applied.warnings.length > 0) consoles.append(key, "error", applied.warnings.map(formatIssue));
    }
  }
  if (result.request) await handleRequest(projectId, deviceId, key, result.request);
}

async function handleRequest(projectId: string, deviceId: string, key: string, request: CliRequest): Promise<void> {
  const consoles = useConsoleStore.getState();
  const doc = useLabStore.getState().projects[projectId]?.document;
  if (!doc) return;
  const session = useSimulationStore.getState().session;
  const own = session?.projectId === projectId ? session : null;
  const view = own?.devices[deviceId];
  const stale = own !== null && own.fingerprint !== networkFingerprint(doc);

  const runtime = (lines: (names: NonNullable<typeof own>["names"]) => string[]) => {
    if (!own || !view) {
      consoles.append(key, "error", [t.notLoaded]);
      return;
    }
    consoles.append(key, "output", lines(own.names));
    if (stale) consoles.append(key, "info", [t.staleNote]);
  };

  switch (request.kind) {
    case "help":
      consoles.append(key, "output", helpLines(request.entries));
      return;
    case "clear-screen":
      consoles.clear(key);
      return;
    case "show-config": {
      const lines = configurationCommands(doc, deviceId);
      consoles.append(key, "output", lines.length > 0 ? lines : [t.noConfig]);
      return;
    }
    case "ipconfig":
      consoles.append(key, "output", ipconfig(doc, deviceId, view));
      return;
    case "show-vlans":
      consoles.append(key, "output", showVlans(doc, deviceId));
      return;
    case "show-interfaces":
      runtime(() => (view ? showInterfaces(view) : []));
      return;
    case "show-routes":
      runtime(() => (view ? showRoutes(view) : []));
      return;
    case "show-arp":
      runtime((names) => (view ? showArp(view, names) : []));
      return;
    case "show-mac":
      runtime((names) => (view ? showMac(view, names) : []));
      return;
    case "show-stp":
      runtime((names) => (view ? showStp(view, names) : []));
      return;
    case "show-dhcp":
      runtime((names) => (view ? showDhcp(view, names) : []));
      return;
    case "show-dns":
      runtime(() => (view ? showDns(view) : []));
      return;
    case "nslookup": {
      const reply = await simulation.nslookup(deviceId, request.name);
      if (!reply.ok) {
        consoles.append(key, "error", [formatCommandError(reply.code, reply.params)]);
        return;
      }
      consoles.append(key, "output", [fill(t.nslookupStart, { name: request.name })]);
      watchSession(key, reply.sessionId);
      if (stale) consoles.append(key, "info", [t.staleNote]);
      return;
    }
    case "dhcp": {
      const reply = await simulation.dhcp(deviceId, request.action);
      consoles.append(key, reply.ok ? "info" : "error", [reply.ok ? messages.simulation.runtime.dhcpQueued : formatCommandError(reply.code, reply.params)]);
      return;
    }
    case "clear-table": {
      const reply = await simulation.clearTable(deviceId, request.table);
      consoles.append(key, reply.ok ? "info" : "error", [reply.ok ? t.tableCleared[request.table] : formatCommandError(reply.code, reply.params)]);
      return;
    }
    case "ping": {
      const reply = await simulation.ping(deviceId, request.destination, request.count);
      if (!reply.ok) {
        consoles.append(key, "error", [formatCommandError(reply.code, reply.params)]);
        return;
      }
      consoles.append(key, "output", [fill(t.pingStart, { count: request.count, destination: request.destination })]);
      watchSession(key, reply.sessionId);
      return;
    }
  }
}

/** Suit un ping ou un nslookup : ses résultats s'afficheront dans la console au fil du calcul. */
function watchSession(key: string, sessionId: string | null): void {
  const consoles = useConsoleStore.getState();
  if (sessionId) {
    consoles.watch(sessionId, key);
    const latest = useSimulationStore.getState().session;
    if (latest) consoles.syncPings(latest);
  }
  if (useSimulationStore.getState().session?.mode === "paused") consoles.append(key, "info", [t.pingPaused]);
}
