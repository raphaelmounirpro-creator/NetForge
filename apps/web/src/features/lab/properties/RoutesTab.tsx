import {
  addStaticRoute,
  parseIpv4,
  parsePrefixOrMask,
  parseRouteInput,
  removeStaticRoute,
  type Device,
  type IssueCode,
  type StaticRoute,
} from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore, type OpenProject } from "../store";
import { OspfSection } from "./OspfSection";
import { RipSection } from "./RipSection";
import { BgpSection } from "./BgpSection";
import { VrrpSection } from "./VrrpSection";

const t = messages.properties;

const routeLabel = (route: StaticRoute) => `${route.destination}/${String(route.prefixLength)}`;
const fieldError = (code: IssueCode, value: string) => formatIssue({ code, severity: "error", params: { value: value.trim() } });

/** Routes statiques d'un routeur : même analyse et mêmes commandes que la future CLI. */
export function RoutesTab({ projectId, project, device }: { projectId: string; project: OpenProject; device: Device }) {
  const routes = project.document.configurations[device.id]?.staticRoutes ?? [];
  const editable = project.access === "editor";
  const [destination, setDestination] = useState("");
  const [mask, setMask] = useState("");
  const [nextHop, setNextHop] = useState("");
  const [errors, setErrors] = useState<{ destination?: string | undefined; mask?: string | undefined; nextHop?: string | undefined; form?: string }>({});

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseRouteInput(destination, mask, nextHop);
    if (!parsed.ok) {
      setErrors({
        destination: parseIpv4(destination.trim()) === null ? fieldError("ipv4.invalid-address", destination) : undefined,
        mask: parsePrefixOrMask(mask) === null ? fieldError("ipv4.invalid-mask", mask) : undefined,
        nextHop: parseIpv4(nextHop.trim()) === null ? fieldError("ipv4.invalid-address", nextHop) : undefined,
      });
      return;
    }
    const result = useLabStore.getState().apply(projectId, (doc) => addStaticRoute(doc, { deviceId: device.id, route: parsed.route }));
    if (result && !result.ok) {
      setErrors({ form: result.errors.map(formatIssue).join(" ") });
      return;
    }
    setErrors({});
    setDestination("");
    setMask("");
    setNextHop("");
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs text-text-muted">{t.routesHint}</p>
      <section aria-labelledby={`routes-${device.id}`} className="flex flex-col gap-2">
        <h3 id={`routes-${device.id}`} className="text-sm font-semibold text-text">
          {t.routesTitle}
        </h3>
        {routes.length === 0 ? (
          <p className="text-sm text-text-muted">{t.noRoutes}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {routes.map((route) => (
              <li key={routeLabel(route)} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1.5">
                <span className="font-mono text-xs text-text">
                  {routeLabel(route)} <span className="text-text-muted">{fill(t.via, { nextHop: route.nextHop })}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!editable}
                  aria-label={fill(t.removeRoute, { route: routeLabel(route) })}
                  onClick={() => {
                    useLabStore
                      .getState()
                      .apply(projectId, (doc) => removeStaticRoute(doc, { deviceId: device.id, destination: route.destination, prefixLength: route.prefixLength }));
                  }}
                >
                  {t.remove}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label={t.routeDestination}
            value={destination}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            disabled={!editable}
            error={errors.destination ?? null}
            onChange={(event) => {
              setDestination(event.target.value);
            }}
          />
          <TextField
            label={t.routeMask}
            value={mask}
            autoComplete="off"
            spellCheck={false}
            disabled={!editable}
            error={errors.mask ?? null}
            onChange={(event) => {
              setMask(event.target.value);
            }}
          />
        </div>
        <TextField
          label={t.routeNextHop}
          value={nextHop}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={!editable}
          error={errors.nextHop ?? null}
          onChange={(event) => {
            setNextHop(event.target.value);
          }}
        />
        <p className="text-xs text-text-muted">{t.defaultRouteHint}</p>
        {errors.form && (
          <p role="alert" className="text-xs text-danger">
            {errors.form}
          </p>
        )}
        <Button type="submit" size="sm" variant="primary" disabled={!editable} className="self-start">
          {t.addRoute}
        </Button>
      </form>
      <RipSection projectId={projectId} deviceId={device.id} config={project.document.configurations[device.id]} disabled={!editable} />
      <OspfSection projectId={projectId} deviceId={device.id} config={project.document.configurations[device.id]} disabled={!editable} />
      <VrrpSection projectId={projectId} deviceId={device.id} config={project.document.configurations[device.id]} disabled={!editable} />
      <BgpSection projectId={projectId} deviceId={device.id} config={project.document.configurations[device.id]} disabled={!editable} />
    </div>
  );
}
