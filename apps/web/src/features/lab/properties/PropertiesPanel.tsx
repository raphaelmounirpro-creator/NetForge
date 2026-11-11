import {
  disconnect,
  getModel,
  removeDevice,
  renameDevice,
  renameProject,
  setDefaultGateway,
  validateDocument,
  type Device,
  type Issue,
  type NfgDocument,
} from "@netforge/project";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { Tabs } from "../../../components/ui/Tabs";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore, type OpenProject } from "../store";
import { ConnectForm } from "./ConnectForm";
import { Ipv4Form } from "./Ipv4Form";
import { RoutesTab } from "./RoutesTab";
import { SingleFieldForm } from "./SingleFieldForm";

const t = messages.properties;
type DeviceTab = "general" | "interfaces" | "routes";

function findLinkOnPort(doc: NfgDocument, deviceId: string, portId: string) {
  return doc.topology.links.find((link) => link.endpoints.some((end) => end.deviceId === deviceId && end.portId === portId));
}

function deviceName(doc: NfgDocument, deviceId: string): string {
  return doc.topology.devices.find((device) => device.id === deviceId)?.name ?? deviceId;
}

/** Avertissements concernant un équipement (ou dont il est l'autre partie). */
export function deviceIssues(issues: readonly Issue[], deviceId: string): Issue[] {
  return issues.filter((issue) => issue.params["deviceId"] === deviceId || issue.params["otherDeviceId"] === deviceId);
}

function IssueList({ issues }: { issues: readonly Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <Notice tone="warning" title={t.warnings}>
      <ul className="list-disc space-y-1 pl-4">
        {issues.map((issue) => (
          <li key={`${issue.code}-${JSON.stringify(issue.params)}`}>{formatIssue(issue)}</li>
        ))}
      </ul>
    </Notice>
  );
}

function ProjectProperties({ projectId, project }: { projectId: string; project: OpenProject }) {
  const { document: doc } = project;
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-base font-semibold text-text">{t.projectTitle}</h2>
      <SingleFieldForm
        key={doc.metadata.name}
        label={t.projectName}
        initial={doc.metadata.name}
        disabled={project.access !== "editor"}
        onApply={(name) => useLabStore.getState().apply(projectId, (current) => renameProject(current, { name }))}
      />
      <p className="text-sm text-text-muted">
        {fill(t.summary, { devices: doc.topology.devices.length, links: doc.topology.links.length })}
      </p>
      <p className="text-sm text-text-muted">{t.hint}</p>
      <p className="text-xs text-text-muted">{messages.storage.guestNotice}</p>
    </div>
  );
}

function GeneralTab({ projectId, project, device }: { projectId: string; project: OpenProject; device: Device }) {
  const model = getModel(device.model);
  const editable = project.access === "editor";
  return (
    <div className="flex flex-col gap-4 p-4">
      <SingleFieldForm
        key={device.name}
        label={t.name}
        hint={t.nameHint}
        initial={device.name}
        disabled={!editable}
        onApply={(name) => useLabStore.getState().apply(projectId, (doc) => renameDevice(doc, { deviceId: device.id, name }))}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">{t.model}</dt>
        <dd className="text-text">{device.model}</dd>
        <dt className="text-text-muted">{t.type}</dt>
        <dd className="text-text">{t.kind[model.kind]}</dd>
        <dt className="text-text-muted">{t.portsLabel}</dt>
        <dd className="text-text">{fill(t.ports, { count: model.ports.length })}</dd>
      </dl>
      <Button
        variant="danger"
        size="sm"
        disabled={!editable}
        className="self-start"
        onClick={() => {
          useLabStore.getState().apply(projectId, (doc) => removeDevice(doc, { deviceId: device.id }));
        }}
      >
        {t.deleteDevice}
      </Button>
    </div>
  );
}

function InterfacesTab({ projectId, project, device }: { projectId: string; project: OpenProject; device: Device }) {
  const { document: doc } = project;
  const model = getModel(device.model);
  const editable = project.access === "editor";
  const config = doc.configurations[device.id];
  return (
    <div className="flex flex-col gap-3 p-4">
      <ConnectForm key={`${device.id}-${String(doc.topology.links.length)}`} projectId={projectId} doc={doc} deviceId={device.id} disabled={!editable} />
      <p className="text-xs text-text-muted">{model.ipCapable ? t.maskHint : t.noIp}</p>
      <ul className="flex flex-col gap-2">
        {model.ports.map((port) => {
          const link = findLinkOnPort(doc, device.id, port.id);
          const other = link?.endpoints.find((end) => !(end.deviceId === device.id && end.portId === port.id));
          const ipv4 = config?.interfaces[port.id]?.ipv4 ?? null;
          return (
            <li key={port.id} className="rounded-md border border-border p-3">
              <fieldset className="min-w-0">
                <legend className="sr-only">{fill(t.port, { port: port.id })}</legend>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-text">{port.id}</span>
                  {link && other ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-text">{fill(t.linkedTo, { device: deviceName(doc, other.deviceId), port: other.portId })}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!editable}
                        onClick={() => {
                          useLabStore.getState().apply(projectId, (current) => disconnect(current, { linkId: link.id }));
                        }}
                      >
                        {t.disconnect}
                      </Button>
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">{t.free}</span>
                  )}
                </div>
                {model.ipCapable && (
                  <Ipv4Form
                    key={`${port.id}:${ipv4 ? `${ipv4.address}/${String(ipv4.prefixLength)}` : "-"}`}
                    projectId={projectId}
                    deviceId={device.id}
                    portId={port.id}
                    current={ipv4}
                    disabled={!editable}
                  />
                )}
              </fieldset>
            </li>
          );
        })}
      </ul>
      {model.kind === "pc" && (
        <SingleFieldForm
          key={config?.defaultGateway ?? "-"}
          label={t.gateway}
          hint={t.gatewayHint}
          initial={config?.defaultGateway ?? ""}
          disabled={!editable}
          onApply={(gateway) => useLabStore.getState().apply(projectId, (current) => setDefaultGateway(current, { deviceId: device.id, gateway }))}
        />
      )}
    </div>
  );
}

function DeviceProperties({ projectId, project, device, issues }: { projectId: string; project: OpenProject; device: Device; issues: Issue[] }) {
  const [tab, setTab] = useState<DeviceTab>("interfaces");
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <h2 className="text-base font-semibold text-text">
          {device.name} <span className="text-sm font-normal text-text-muted">· {device.model}</span>
        </h2>
        <IssueList issues={issues} />
      </div>
      <Tabs
        label={t.tabs}
        size="sm"
        tabs={[
          { id: "general", label: t.general },
          { id: "interfaces", label: t.interfaces },
          ...(getModel(device.model).kind === "router" ? [{ id: "routes" as const, label: t.routes }] : []),
        ]}
        selected={tab}
        onSelect={setTab}
        className="min-h-0 flex-1"
      >
        {tab === "general" ? (
          <GeneralTab projectId={projectId} project={project} device={device} />
        ) : tab === "routes" ? (
          <RoutesTab projectId={projectId} project={project} device={device} />
        ) : (
          <InterfacesTab projectId={projectId} project={project} device={device} />
        )}
      </Tabs>
    </div>
  );
}

function LinkProperties({ projectId, project, linkId }: { projectId: string; project: OpenProject; linkId: string }) {
  const link = project.document.topology.links.find((item) => item.id === linkId);
  if (!link) return null;
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-base font-semibold text-text">{t.linkTitle}</h2>
      <dl className="flex flex-col gap-1 text-sm">
        <dt className="text-text-muted">{t.linkEnds}</dt>
        {link.endpoints.map((end) => (
          <dd key={`${end.deviceId}-${end.portId}`} className="font-mono text-text">
            {deviceName(project.document, end.deviceId)} · {end.portId}
          </dd>
        ))}
        <dt className="mt-2 text-text-muted">{t.medium}</dt>
        <dd className="text-text">{t.linkMedium}</dd>
      </dl>
      <Button
        variant="danger"
        size="sm"
        disabled={project.access !== "editor"}
        className="self-start"
        onClick={() => {
          useLabStore.getState().apply(projectId, (doc) => disconnect(doc, { linkId }));
        }}
      >
        {t.deleteLink}
      </Button>
    </div>
  );
}

/** Panneau de droite : propriétés de la sélection, partagé par les deux vues. */
export function PropertiesPanel({ projectId, project }: { projectId: string; project: OpenProject }) {
  const { selection, document: doc } = project;
  const warnings = useMemo(() => validateDocument(doc).filter((issue) => issue.severity === "warning"), [doc]);
  const device = selection?.kind === "device" ? doc.topology.devices.find((item) => item.id === selection.id) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {device ? (
        <DeviceProperties key={device.id} projectId={projectId} project={project} device={device} issues={deviceIssues(warnings, device.id)} />
      ) : selection?.kind === "link" ? (
        <LinkProperties projectId={projectId} project={project} linkId={selection.id} />
      ) : (
        <ProjectProperties projectId={projectId} project={project} />
      )}
    </div>
  );
}
