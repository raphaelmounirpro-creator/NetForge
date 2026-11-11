import { disconnect, getModel, isOptical, validateDocument, type NfgDocument } from "@netforge/project";
import { useMemo } from "react";
import { Button } from "../../components/ui/Button";
import { fill, messages } from "../../i18n";
import { deviceIssues } from "./properties/PropertiesPanel";
import { formatLength } from "../optics/format";
import { useLabStore, type OpenProject } from "./store";

const t = messages.configuration;
const cell = "border-b border-border px-3 py-2 text-left align-top";
const head = `${cell} text-xs font-semibold text-text-muted`;

function nameOf(doc: NfgDocument, deviceId: string): string {
  return doc.topology.devices.find((device) => device.id === deviceId)?.name ?? deviceId;
}

/** Vue tabulaire du projet : plan d'adressage et liens, utilisable sans le canevas. */
export function ConfigurationView({ projectId, project }: { projectId: string; project: OpenProject }) {
  const { document: doc, selection } = project;
  const warnings = useMemo(() => validateDocument(doc).filter((issue) => issue.severity === "warning"), [doc]);
  const select = useLabStore.getState().select;
  const routes = doc.topology.devices.flatMap((device) =>
    (doc.configurations[device.id]?.staticRoutes ?? []).map((route) => ({ device, route })),
  );

  return (
    <div className="h-full overflow-auto p-4">
      <section aria-labelledby="config-devices">
        <h2 id="config-devices" className="text-base font-semibold text-text">
          {t.devicesTitle}
        </h2>
        {doc.topology.devices.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t.emptyDevices}</p>
        ) : (
          <table className="mt-3 w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className={head}>{t.columns.name}</th>
                <th scope="col" className={head}>{t.columns.model}</th>
                <th scope="col" className={head}>{t.columns.addresses}</th>
                <th scope="col" className={head}>{t.columns.gateway}</th>
                <th scope="col" className={head}>{t.columns.links}</th>
                <th scope="col" className={head}>{t.columns.status}</th>
                <th scope="col" className={head}><span className="sr-only">{t.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody>
              {doc.topology.devices.map((device) => {
                const config = doc.configurations[device.id];
                const addresses = getModel(device.model)
                  .ports.map((port) => ({ port: port.id, ipv4: config?.interfaces[port.id]?.ipv4 }))
                  .filter((item) => item.ipv4);
                const linkCount = doc.topology.links.filter((link) => link.endpoints.some((end) => end.deviceId === device.id)).length;
                const issueCount = deviceIssues(warnings, device.id).length;
                const selected = selection?.kind === "device" && selection.id === device.id;
                return (
                  <tr key={device.id} className={selected ? "bg-surface-raised" : undefined}>
                    <th scope="row" className={`${cell} font-medium text-text`}>{device.name}</th>
                    <td className={`${cell} text-text-muted`}>{device.model}</td>
                    <td className={`${cell} font-mono text-text`}>
                      {addresses.length === 0
                        ? isOptical(getModel(device.model).kind)
                          ? t.optical
                          : t.none
                        : addresses.map((item) => (
                            <span key={item.port} className="block">
                              {item.port} {item.ipv4?.address}/{item.ipv4?.prefixLength}
                            </span>
                          ))}
                    </td>
                    <td className={`${cell} font-mono text-text`}>{config?.defaultGateway ?? t.none}</td>
                    <td className={`${cell} text-text`}>{linkCount}</td>
                    <td className={`${cell} ${issueCount > 0 ? "text-warning" : "text-text-muted"}`}>
                      {issueCount > 0 ? `⚠ ${fill(t.warnings, { count: issueCount })}` : t.ok}
                    </td>
                    <td className={cell}>
                      <Button
                        size="sm"
                        variant={selected ? "primary" : "secondary"}
                        aria-pressed={selected}
                        aria-label={fill(t.select, { name: device.name })}
                        onClick={() => {
                          select(projectId, { kind: "device", id: device.id });
                        }}
                      >
                        {messages.properties.title}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="config-links" className="mt-8">
        <h2 id="config-links" className="text-base font-semibold text-text">
          {t.linksTitle}
        </h2>
        {doc.topology.links.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t.emptyLinks}</p>
        ) : (
          <table className="mt-3 w-full min-w-[30rem] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className={head}>{t.columns.endA}</th>
                <th scope="col" className={head}>{t.columns.endB}</th>
                <th scope="col" className={head}>{t.columns.medium}</th>
                <th scope="col" className={head}><span className="sr-only">{t.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody>
              {doc.topology.links.map((link) => {
                const [a, b] = link.endpoints;
                const endA = `${nameOf(doc, a.deviceId)} · ${a.portId}`;
                const endB = `${nameOf(doc, b.deviceId)} · ${b.portId}`;
                const selected = selection?.kind === "link" && selection.id === link.id;
                return (
                  <tr key={link.id} className={selected ? "bg-surface-raised" : undefined}>
                    <td className={`${cell} font-mono text-text`}>{endA}</td>
                    <td className={`${cell} font-mono text-text`}>{endB}</td>
                    <td className={`${cell} text-text`}>
                      {link.fiber ? fill(t.fiber, { length: formatLength(link.fiber.length), type: link.fiber.type }) : t.copper}
                    </td>
                    <td className={`${cell} flex flex-wrap gap-2`}>
                      {/* Alternative clavier au canevas : la fiche du lien (fibre comprise) s'ouvre dans le panneau de droite. */}
                      <Button
                        size="sm"
                        variant={selected ? "primary" : "secondary"}
                        aria-pressed={selected}
                        aria-label={fill(t.selectLink, { a: endA, b: endB })}
                        onClick={() => {
                          select(projectId, { kind: "link", id: link.id });
                        }}
                      >
                        {messages.properties.title}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={project.access !== "editor"}
                        onClick={() => {
                          useLabStore.getState().apply(projectId, (current) => disconnect(current, { linkId: link.id }));
                        }}
                      >
                        {messages.properties.deleteLink}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="config-routes" className="mt-8">
        <h2 id="config-routes" className="text-base font-semibold text-text">
          {t.routesTitle}
        </h2>
        {routes.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t.emptyRoutes}</p>
        ) : (
          <table className="mt-3 w-full min-w-[30rem] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className={head}>{t.routeColumns.router}</th>
                <th scope="col" className={head}>{t.routeColumns.destination}</th>
                <th scope="col" className={head}>{t.routeColumns.nextHop}</th>
              </tr>
            </thead>
            <tbody>
              {routes.map(({ device, route }) => (
                <tr key={`${device.id}-${route.destination}-${String(route.prefixLength)}`}>
                  <th scope="row" className={`${cell} font-medium text-text`}>{device.name}</th>
                  <td className={`${cell} font-mono text-text`}>{route.destination}/{route.prefixLength}</td>
                  <td className={`${cell} font-mono text-text`}>{route.nextHop}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
