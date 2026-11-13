import { parseIpv4Input, setBgpAs, setBgpNeighbor, setBgpNetwork, type CommandResult, type DeviceConfig, type NfgDocument } from "@netforge/project";
import { useId, useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";

const t = messages.properties;

const asNumber = (text: string) => (/^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

interface Props {
  projectId: string;
  deviceId: string;
  config: DeviceConfig | undefined;
  disabled: boolean;
}

/** BGP d'un routeur : AS, voisins externes et réseaux annoncés ; mêmes commandes que « bgp as|neighbor|network » à la console. */
export function BgpSection({ projectId, deviceId, config, disabled }: Props) {
  const headingId = useId();
  const bgp = config?.bgp ?? null;
  const [as, setAs] = useState(bgp ? String(bgp.as) : "");
  const [neighbor, setNeighbor] = useState("");
  const [remoteAs, setRemoteAs] = useState("");
  const [network, setNetwork] = useState("");
  const [mask, setMask] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = (edit: (doc: NfgDocument) => CommandResult): boolean => {
    const result = useLabStore.getState().apply(projectId, edit);
    const failed = result !== null && !result.ok;
    setError(result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);
    return !failed;
  };

  const submitAs = (event: SubmitEvent) => {
    event.preventDefault();
    const value = asNumber(as);
    if (Number.isNaN(value)) {
      setError(t.bgpInvalidAs);
      return;
    }
    apply((doc) => setBgpAs(doc, { deviceId, as: value }));
  };

  const submitNeighbor = (event: SubmitEvent) => {
    event.preventDefault();
    const value = asNumber(remoteAs);
    if (Number.isNaN(value)) {
      setError(t.bgpInvalidAs);
      return;
    }
    if (apply((doc) => setBgpNeighbor(doc, { deviceId, address: neighbor, remoteAs: value }))) {
      setNeighbor("");
      setRemoteAs("");
    }
  };

  const submitNetwork = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseIpv4Input(network, mask);
    if (!parsed.ok) {
      setError(parsed.errors.map(formatIssue).join(" "));
      return;
    }
    if (apply((doc) => setBgpNetwork(doc, { deviceId, network: { address: parsed.ipv4.address, prefixLength: parsed.ipv4.prefixLength }, present: true }))) {
      setNetwork("");
      setMask("");
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {t.bgpTitle}
      </h3>
      <p className="text-xs text-text-muted">{t.bgpHint}</p>
      <form onSubmit={submitAs} noValidate className="flex flex-wrap items-end gap-2">
        <TextField label={t.bgpAs} value={as} inputMode="numeric" disabled={disabled} className="w-40" onChange={(event) => { setAs(event.target.value); }} />
        <Button type="submit" size="sm" variant="primary" disabled={disabled}>
          {t.bgpApply}
        </Button>
        {bgp && (
          <Button size="sm" disabled={disabled} onClick={() => apply((doc) => setBgpAs(doc, { deviceId, as: null }))}>
            {t.bgpDisable}
          </Button>
        )}
      </form>
      {!bgp ? (
        <p className="text-sm text-text-muted">{t.bgpDisabled}</p>
      ) : (
        <>
          <h4 className="text-xs font-semibold text-text">{t.bgpNeighborsTitle}</h4>
          {bgp.neighbors.length === 0 ? (
            <p className="text-xs text-text-muted">{t.bgpNoNeighbor}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {bgp.neighbors.map((item) => (
                <li key={item.address} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-xs">
                  <span className="font-mono text-text">{fill(t.bgpNeighbor, { address: item.address, as: item.remoteAs })}</span>
                  <Button size="sm" disabled={disabled} aria-label={fill(t.bgpRemoveNeighbor, { address: item.address })} onClick={() => apply((doc) => setBgpNeighbor(doc, { deviceId, address: item.address, remoteAs: null }))}>
                    {t.remove}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitNeighbor} noValidate className="flex flex-wrap items-end gap-2">
            <TextField label={t.bgpNeighborAddress} value={neighbor} disabled={disabled} className="w-40" onChange={(event) => { setNeighbor(event.target.value); }} />
            <TextField label={t.bgpRemoteAs} value={remoteAs} inputMode="numeric" disabled={disabled} className="w-28" onChange={(event) => { setRemoteAs(event.target.value); }} />
            <Button type="submit" size="sm" disabled={disabled}>
              {t.bgpAddNeighbor}
            </Button>
          </form>
          <h4 className="text-xs font-semibold text-text">{t.bgpNetworksTitle}</h4>
          {bgp.networks.length === 0 ? (
            <p className="text-xs text-text-muted">{t.bgpNoNetwork}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {bgp.networks.map((item) => {
                const cidr = `${item.address}/${String(item.prefixLength)}`;
                return (
                  <li key={cidr} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-xs">
                    <span className="font-mono text-text">{cidr}</span>
                    <Button size="sm" disabled={disabled} aria-label={fill(t.bgpRemoveNetwork, { network: cidr })} onClick={() => apply((doc) => setBgpNetwork(doc, { deviceId, network: item, present: false }))}>
                      {t.remove}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <form onSubmit={submitNetwork} noValidate className="flex flex-wrap items-end gap-2">
            <TextField label={t.bgpNetwork} value={network} disabled={disabled} className="w-36" onChange={(event) => { setNetwork(event.target.value); }} />
            <TextField label={t.bgpMask} value={mask} disabled={disabled} className="w-36" onChange={(event) => { setMask(event.target.value); }} />
            <Button type="submit" size="sm" disabled={disabled}>
              {t.bgpAddNetwork}
            </Button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
