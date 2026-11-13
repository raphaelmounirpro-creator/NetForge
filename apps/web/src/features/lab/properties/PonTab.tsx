import {
  formatMbpsInput,
  getModel,
  isDownstreamOnly,
  ONU_ID_MAX,
  parseRateInput,
  PON_SERVICES,
  ponTechnologyOf,
  setOntServices,
  setPonAuthorization,
  setPonService,
  type Device,
  type NfgDocument,
  type PonRate,
  type PonService,
  type PonServiceProfile,
} from "@netforge/project";
import { useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { formatMbps } from "../../optics/format";
import { useLabStore } from "../store";

const t = messages.properties;

/** Débits affichés à la française (« 0,2/0,2 ») ; la saisie accepte la virgule ou le point. */
const rateDisplay = (rate: PonRate | null) => (rate ? `${formatMbps(rate.guaranteedKbps)}/${formatMbps(rate.maxKbps)}` : "");
const rateText = (rate: PonRate | null | undefined) => (rate ? `${formatMbpsInput(rate.guaranteedKbps)}/${formatMbpsInput(rate.maxKbps)}` : "");

/** Profil d'un service sur l'OLT : VLAN et débits « garanti/maximum » ; même commande que « service » à la console. */
function ServiceForm({ projectId, deviceId, service, profile, disabled }: { projectId: string; deviceId: string; service: PonService; profile: PonServiceProfile | undefined; disabled: boolean }) {
  const [vlan, setVlan] = useState(profile ? String(profile.vlan) : "");
  const [down, setDown] = useState(rateText(profile?.downstream));
  const [up, setUp] = useState(rateText(profile?.upstream));
  const [error, setError] = useState<string | null>(null);
  const name = t.serviceNames[service];
  const downstreamOnly = isDownstreamOnly(service);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const vlanId = /^[1-9]\d{0,3}$/.test(vlan.trim()) ? Number(vlan.trim()) : Number.NaN;
    if (!(vlanId >= 1 && vlanId <= 4094)) {
      setError(t.serviceInvalidVlan);
      return;
    }
    const downstream = parseRateInput(down);
    const upstream = downstreamOnly ? null : parseRateInput(up);
    const invalid = downstream === null ? down : !downstreamOnly && upstream === null ? up : null;
    if (invalid !== null || downstream === null) {
      setError(formatIssue({ code: "pon.invalid-rate", severity: "error", params: { value: invalid ?? down } }));
      return;
    }
    const result = useLabStore.getState().apply(projectId, (current) => setPonService(current, { deviceId, service, profile: { vlan: vlanId, downstream, upstream } }));
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
  };

  return (
    <form onSubmit={submit} noValidate aria-label={name} className="flex flex-col gap-1.5 rounded-sm border border-border p-2">
      <p className="text-xs font-semibold text-text">
        {name}{" "}
        <span className="font-normal text-text-muted">
          {profile
            ? fill(profile.upstream ? t.serviceSummary : t.serviceSummaryDown, { vlan: profile.vlan, down: rateDisplay(profile.downstream), up: rateDisplay(profile.upstream) })
            : t.serviceUndefined}
        </span>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={t.serviceVlan} value={vlan} inputMode="numeric" disabled={disabled} className="w-20" onChange={(event) => { setVlan(event.target.value); }} />
        <TextField label={t.serviceDown} value={down} disabled={disabled} className="w-36" onChange={(event) => { setDown(event.target.value); }} />
        {!downstreamOnly && <TextField label={t.serviceUp} value={up} disabled={disabled} className="w-36" onChange={(event) => { setUp(event.target.value); }} />}
        <Button type="submit" size="sm" variant="primary" disabled={disabled}>
          {fill(t.serviceSave, { service: name })}
        </Button>
        {profile && (
          <Button size="sm" disabled={disabled} onClick={() => useLabStore.getState().apply(projectId, (current) => setPonService(current, { deviceId, service, profile: null }))}>
            {fill(t.serviceRemove, { service: name })}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

/** ONT autorisés sur les ports d'un OLT : mêmes commandes que « ont add|delete » à la console. */
export function PonTab({ projectId, doc, device, disabled }: { projectId: string; doc: NfgDocument; device: Device; disabled: boolean }) {
  const ports = getModel(device.model).ports.map((port) => port.id);
  const technology = ponTechnologyOf(device.model) ?? "gpon";
  const authorizations = doc.configurations[device.id]?.ponAuthorizations ?? {};
  const profiles = doc.configurations[device.id]?.ponServices ?? {};
  const defined = PON_SERVICES.filter((service) => profiles[service] !== undefined);
  const entries = ports.flatMap((portId) => (authorizations[portId] ?? []).map((entry) => ({ portId, ...entry })));
  const [portId, setPortId] = useState(ports[0] ?? "");
  const [serial, setSerial] = useState("");
  const [onuId, setOnuId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const text = onuId.trim();
    if (text !== "" && !/^\d{1,4}$/.test(text)) {
      setError(t.ponInvalidOnuId);
      return;
    }
    const result = useLabStore
      .getState()
      .apply(projectId, (current) => setPonAuthorization(current, { deviceId: device.id, portId, serial, present: true, ...(text === "" ? {} : { onuId: Number(text) }) }));
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
    if (result?.ok) {
      setSerial("");
      setOnuId("");
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{t.ponTitle}</h3>
      <p className="text-xs text-text-muted">{fill(t.ponHint, { max: ONU_ID_MAX[technology] })}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">{t.ponNone}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={`${entry.portId}-${entry.serial}`} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-xs">
              <span className="font-mono text-text">{fill(t.ponEntry, { port: entry.portId, serial: entry.serial, onuId: entry.onuId })}</span>
              {defined.length > 0 && (
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="sr-only">{fill(t.offerLegend, { serial: entry.serial })}</legend>
                  {defined.map((service) => (
                    <label key={service} className="flex items-center gap-1 text-text">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={entry.services.includes(service)}
                        onChange={(event) => {
                          const services = event.target.checked ? [...entry.services, service] : entry.services.filter((item) => item !== service);
                          useLabStore.getState().apply(projectId, (current) => setOntServices(current, { deviceId: device.id, portId: entry.portId, serial: entry.serial, services }));
                        }}
                      />
                      {t.serviceNames[service]}
                    </label>
                  ))}
                </fieldset>
              )}
              <Button
                size="sm"
                disabled={disabled}
                aria-label={fill(t.ponRemove, { serial: entry.serial, port: entry.portId })}
                onClick={() => {
                  useLabStore.getState().apply(projectId, (current) => setPonAuthorization(current, { deviceId: device.id, portId: entry.portId, serial: entry.serial, present: false }));
                }}
              >
                {t.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
        <SelectField
          label={t.ponPort}
          value={portId}
          disabled={disabled}
          className="w-24"
          options={ports.map((value) => ({ value, label: value }))}
          onChange={(event) => {
            setPortId(event.target.value);
          }}
        />
        <TextField
          label={t.ponSerial}
          value={serial}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="w-40"
          onChange={(event) => {
            setSerial(event.target.value);
          }}
        />
        <TextField
          label={t.ponOnuId}
          value={onuId}
          inputMode="numeric"
          disabled={disabled}
          className="w-48"
          onChange={(event) => {
            setOnuId(event.target.value);
          }}
        />
        <Button type="submit" size="sm" variant="primary" disabled={disabled}>
          {t.ponAdd}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {entries.length > 0 && defined.length === 0 && <p className="text-xs text-text-muted">{t.offerNone}</p>}
      <section aria-label={t.servicesTitle} className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="text-sm font-semibold text-text">{t.servicesTitle}</h3>
        <p className="text-xs text-text-muted">{t.servicesHint}</p>
        {PON_SERVICES.map((service) => (
          <ServiceForm key={`${service}-${JSON.stringify(profiles[service] ?? null)}`} projectId={projectId} deviceId={device.id} service={service} profile={profiles[service]} disabled={disabled} />
        ))}
      </section>
    </div>
  );
}
