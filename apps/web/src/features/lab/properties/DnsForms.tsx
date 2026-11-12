import { parseDnsRecordInput, setDnsEnabled, setDnsRecord, setDnsServer, sortedDnsRecords, type CommandResult } from "@netforge/project";
import { useId, useState, type SubmitEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../../i18n";
import { useLabStore } from "../store";
import { SingleFieldForm } from "./SingleFieldForm";

const t = messages.properties;

const errorsOf = (result: CommandResult | null) => (result && !result.ok ? result.errors.map(formatIssue).join(" ") : null);

/** Résolveur d'un PC : même commande que « ipconfig dns » (vide : « ipconfig dns clear »). */
export function DnsServerForm({ projectId, deviceId, current, disabled }: { projectId: string; deviceId: string; current: string | null; disabled: boolean }) {
  return (
    <SingleFieldForm
      key={current ?? "-"}
      label={t.dnsServer}
      hint={t.dnsServerHint}
      initial={current ?? ""}
      disabled={disabled}
      onApply={(server) => useLabStore.getState().apply(projectId, (doc) => setDnsServer(doc, { deviceId, server }))}
    />
  );
}

/** Service DNS d'un routeur : mêmes commandes que « dns enable|disable|record|delete ». */
export function DnsServiceSection({ projectId, deviceId, records, disabled }: { projectId: string; deviceId: string; records: Readonly<Record<string, string>> | null; disabled: boolean }) {
  const headingId = useId();
  const checkboxId = useId();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enabled = records !== null;

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseDnsRecordInput(name, address);
    if (!parsed.ok) {
      setError(parsed.errors.map(formatIssue).join(" "));
      return;
    }
    const message = errorsOf(useLabStore.getState().apply(projectId, (doc) => setDnsRecord(doc, { deviceId, name: parsed.name, address: parsed.address })));
    setError(message);
    if (message === null) {
      setName("");
      setAddress("");
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {t.dnsServiceTitle}
      </h3>
      <p className="text-xs text-text-muted">{t.dnsServiceHint}</p>
      <div className="flex items-center gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => {
            const checked = event.target.checked;
            setError(errorsOf(useLabStore.getState().apply(projectId, (doc) => setDnsEnabled(doc, { deviceId, enabled: checked }))));
          }}
        />
        <label htmlFor={checkboxId} className="text-sm text-text">
          {t.dnsEnabled}
        </label>
      </div>
      {enabled && (
        <>
          {Object.keys(records).length === 0 ? (
            <p className="text-sm text-text-muted">{t.dnsNoRecords}</p>
          ) : (
            <ul aria-label={t.dnsRecordsLabel} className="flex flex-col gap-1">
              {sortedDnsRecords(records).map((record) => (
                <li key={record.name} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1.5">
                  <span className="min-w-0 font-mono text-xs break-all text-text">
                    {record.name} <span className="text-text-muted">→ {record.address}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={fill(t.dnsRemoveRecord, { name: record.name })}
                    onClick={() => {
                      setError(errorsOf(useLabStore.getState().apply(projectId, (doc) => setDnsRecord(doc, { deviceId, name: record.name, address: null }))));
                    }}
                  >
                    {t.remove}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <TextField
          label={t.dnsName}
          hint={t.dnsNameHint}
          value={name}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField
          label={t.dnsAddress}
          value={address}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" variant="primary" disabled={disabled} className="self-start">
          {t.dnsAddRecord}
        </Button>
      </form>
    </section>
  );
}
