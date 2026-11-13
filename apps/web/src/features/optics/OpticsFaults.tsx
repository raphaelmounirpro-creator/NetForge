import { addFault, FAULT_KINDS, removeFault, repair, REPAIR_ACTIONS, type FaultKind, type NfgDocument, type RepairAction } from "@netforge/project";
import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { fill, messages } from "../../i18n";
import { newEntityId } from "../lab/actions";
import { useLabStore } from "../lab/store";
import { deviceName, formatDb, formatLength } from "./format";
import { faultTargets, repairTargets, targetLabel, type TargetOption } from "./targets";

const t = messages.optics;
const selectClass = "min-h-9 w-full rounded-sm border border-border-strong bg-canvas px-2 text-sm text-text disabled:opacity-60";
const LOSS_KINDS: ReadonlySet<FaultKind> = new Set<FaultKind>(["bend", "dirty-connector", "bad-splice"]);

const POSITION_KINDS: ReadonlySet<FaultKind> = new Set<FaultKind>(["cut", "bend"]);

/** Première extrémité d'un lien (origine de la position d'une panne de fibre). */
function linkOrigin(doc: NfgDocument, linkId: string): string | null {
  const link = doc.topology.links.find((item) => item.id === linkId);
  return link ? link.endpoints[0].deviceId : null;
}

/** Lecture d'une perte saisie à la française (virgule ou point). */
function parseLoss(value: string): number | null {
  const cleaned = value.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

function TargetSelect({ id, label, options, value, onChange, disabled }: { id: string; label: string; options: readonly TargetOption[]; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-text">
        {label}
      </label>
      <select
        id={id}
        className={selectClass}
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {options.length === 0 && <p className="text-xs text-text-muted">{t.noTarget}</p>}
    </div>
  );
}

/** Formateur : pannes injectées, ajout et retrait (mêmes commandes que l'import d'un projet). */
export function OpticsFaults({ projectId, doc, editable }: { projectId: string; doc: NfgDocument; editable: boolean }) {
  const id = useId();
  const [kind, setKind] = useState<FaultKind>("dirty-connector");
  const [targetValue, setTargetValue] = useState("");
  const [loss, setLoss] = useState("3");
  const [lossError, setLossError] = useState<string | null>(null);
  const [position, setPosition] = useState("");
  const [positionError, setPositionError] = useState<string | null>(null);
  const options = faultTargets(doc, kind);
  const selected = options.find((option) => option.value === targetValue) ?? options[0];
  const needsLoss = LOSS_KINDS.has(kind);
  const origin = selected?.target.kind === "link" && POSITION_KINDS.has(kind) ? linkOrigin(doc, selected.target.linkId) : null;

  const submit = () => {
    if (!selected) return;
    const extraLoss = needsLoss ? parseLoss(loss) : null;
    if (needsLoss && extraLoss === null) {
      setLossError(t.invalidLoss);
      return;
    }
    setLossError(null);
    const positionM = origin !== null && position.trim() !== "" ? parseLoss(position) : null;
    if (origin !== null && position.trim() !== "" && positionM === null) {
      setPositionError(t.invalidPosition);
      return;
    }
    setPositionError(null);
    useLabStore.getState().apply(projectId, (current) => addFault(current, { id: newEntityId(), kind, target: selected.target, extraLoss, positionM }));
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-text">{t.faultsTitle}</h3>
      <p className="text-xs text-text-muted">{t.faultsHint}</p>
      {doc.faults.length === 0 ? (
        <p className="text-sm text-text-muted">{t.noFaults}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {doc.faults.map((fault) => {
            const label = fill(t.faultLine, { kind: t.faultKinds[fault.kind], target: targetLabel(doc, fault.target) });
            return (
              <li key={fault.id} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-sm">
                <span className="text-text">
                  {label}
                  {fault.positionM !== null && fault.target.kind === "link" && (
                    <span className="text-text-muted">{fill(t.faultAt, { position: formatLength(fault.positionM), device: deviceName(doc, linkOrigin(doc, fault.target.linkId) ?? "") })}</span>
                  )}
                  {fault.extraLoss !== null && <span className="ml-1 font-mono text-danger">{fill(t.faultLoss, { loss: formatDb(fault.extraLoss) })}</span>}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!editable}
                  aria-label={fill(t.removeFault, { label })}
                  onClick={() => {
                    useLabStore.getState().apply(projectId, (current) => removeFault(current, { id: fault.id }));
                  }}
                >
                  {t.remove}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        noValidate
        aria-label={t.addFault}
        className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-kind`} className="text-xs font-medium text-text">
            {t.faultKind}
          </label>
          <select
            id={`${id}-kind`}
            className={selectClass}
            value={kind}
            disabled={!editable}
            onChange={(event) => {
              setKind(event.target.value as FaultKind);
              setTargetValue("");
            }}
          >
            {FAULT_KINDS.map((value) => (
              <option key={value} value={value}>
                {t.faultKinds[value]}
              </option>
            ))}
          </select>
        </div>
        <TargetSelect id={`${id}-target`} label={t.faultTarget} options={options} value={selected?.value ?? ""} onChange={setTargetValue} disabled={!editable} />
        {needsLoss && (
          <TextField
            label={t.faultExtra}
            hint={t.faultExtraHint}
            value={loss}
            inputMode="decimal"
            autoComplete="off"
            error={lossError}
            disabled={!editable}
            onChange={(event) => {
              setLoss(event.target.value);
            }}
          />
        )}
        {origin !== null && (
          <TextField
            label={fill(t.faultPosition, { device: deviceName(doc, origin) })}
            hint={t.faultPositionHint}
            value={position}
            inputMode="decimal"
            autoComplete="off"
            error={positionError}
            disabled={!editable}
            onChange={(event) => {
              setPosition(event.target.value);
            }}
          />
        )}
        <Button type="submit" size="sm" variant="primary" className="self-start" disabled={!editable || !selected}>
          {t.addFault}
        </Button>
      </form>
    </div>
  );
}

/** Élève : interventions de terrain. Le résultat se constate en remesurant. */
export function OpticsInterventions({ projectId, doc, editable }: { projectId: string; doc: NfgDocument; editable: boolean }) {
  const id = useId();
  const [action, setAction] = useState<RepairAction>("clean");
  const [targetValue, setTargetValue] = useState("");
  const options = repairTargets(doc, action);
  const selected = options.find((option) => option.value === targetValue) ?? options[0];

  const perform = () => {
    if (!selected) return;
    const store = useLabStore.getState();
    const result = store.apply(projectId, (current) => repair(current, { action, target: selected.target }));
    if (result?.ok) store.setNotice(projectId, fill(t.performed, { action: t.actions[action], target: selected.label }));
  };

  return (
    <form
      noValidate
      aria-label={t.interventionsTitle}
      className="flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        perform();
      }}
    >
      <h3 className="text-sm font-semibold text-text">{t.interventionsTitle}</h3>
      <p className="text-xs text-text-muted">{editable ? t.interventionsHint : t.readonly}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-action`} className="text-xs font-medium text-text">
          {t.action}
        </label>
        <select
          id={`${id}-action`}
          className={selectClass}
          value={action}
          disabled={!editable}
          onChange={(event) => {
            setAction(event.target.value as RepairAction);
            setTargetValue("");
          }}
        >
          {REPAIR_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {t.actions[value]}
            </option>
          ))}
        </select>
      </div>
      <TargetSelect id={`${id}-target`} label={t.actionTarget} options={options} value={selected?.value ?? ""} onChange={setTargetValue} disabled={!editable} />
      <Button type="submit" size="sm" variant="primary" className="self-start" disabled={!editable || !selected}>
        {t.perform}
      </Button>
    </form>
  );
}
