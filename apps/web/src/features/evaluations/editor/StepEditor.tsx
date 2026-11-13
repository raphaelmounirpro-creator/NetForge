import type { Criterion, ExerciseStep, ObservationCheck } from "@netforge/engine";
import { getModel, type NfgDocument } from "@netforge/project";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button, IconButton } from "../../../components/ui/Button";
import { SelectField } from "../../../components/ui/SelectField";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import { fill, messages } from "../../../i18n";
import { nextChoiceId, topologyDefaults } from "./draft";

const t = messages.evaluations;

type Options = readonly { value: string; label: string }[];

const points = (raw: string) => Math.max(0, Math.min(100, Math.trunc(Number(raw) || 0)));

function deviceOptions(project: NfgDocument, kind?: "ont"): Options {
  return project.topology.devices
    .filter((device) => !kind || getModel(device.model).kind === kind)
    .map((device) => ({ value: device.id, label: device.name }));
}

/** Liste des équipements, avec l'identifiant courant même s'il n'existe plus (le schéma le signalera). */
function withCurrent(options: Options, current: string): Options {
  return options.some((option) => option.value === current) ? options : [{ value: current, label: current }, ...options];
}

function PointsField({ label = t.stepFields.points, value, onChange }: { label?: string; value: number; onChange: (value: number) => void }) {
  return (
    <TextField
      label={label}
      type="number"
      min={0}
      max={100}
      value={value}
      className="w-40"
      onChange={(event) => {
        onChange(points(event.target.value));
      }}
    />
  );
}

function CheckEditor({ check, project, onChange }: { check: ObservationCheck; project: NfgDocument; onChange: (check: ObservationCheck) => void }) {
  const defaults = topologyDefaults(project);
  return (
    <fieldset className="flex flex-col gap-2 rounded-sm border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-text">{t.check}</legend>
      <SelectField
        label={t.checkKind}
        value={check.kind}
        options={(["ping-observed", "power-measured"] as const).map((value) => ({ value, label: t.checkKinds[value] }))}
        onChange={(event) => {
          const kind = event.target.value;
          if (kind === check.kind) return;
          if (kind === "ping-observed") onChange({ kind, from: defaults.from, to: defaults.to, outcome: "success" });
          else onChange({ kind: "power-measured", deviceId: defaults.ont, portId: "pon", direction: "downstream", outcome: "conform" });
        }}
      />
      {check.kind === "ping-observed" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <SelectField
            label={t.from}
            value={check.from}
            options={withCurrent(deviceOptions(project), check.from)}
            onChange={(event) => {
              onChange({ ...check, from: event.target.value });
            }}
          />
          <TextField
            label={t.to}
            value={check.to}
            maxLength={15}
            onChange={(event) => {
              onChange({ ...check, to: event.target.value.trim() });
            }}
          />
          <SelectField
            label={t.outcome}
            value={check.outcome}
            options={(["success", "failure"] as const).map((value) => ({ value, label: t.outcomes[value] }))}
            onChange={(event) => {
              onChange({ ...check, outcome: event.target.value === "failure" ? "failure" : "success" });
            }}
          />
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <SelectField
            label={t.device}
            value={check.deviceId}
            options={withCurrent(deviceOptions(project), check.deviceId)}
            onChange={(event) => {
              onChange({ ...check, deviceId: event.target.value });
            }}
          />
          <SelectField
            label={t.port}
            value={check.portId}
            options={withCurrent(
              (() => {
                const device = project.topology.devices.find((item) => item.id === check.deviceId);
                return device ? getModel(device.model).ports.map((port) => ({ value: port.id, label: port.id })) : [];
              })(),
              check.portId,
            )}
            onChange={(event) => {
              onChange({ ...check, portId: event.target.value });
            }}
          />
          <SelectField
            label={t.direction}
            value={check.direction}
            options={(["downstream", "upstream"] as const).map((value) => ({ value, label: t.directions[value] }))}
            onChange={(event) => {
              onChange({ ...check, direction: event.target.value === "upstream" ? "upstream" : "downstream" });
            }}
          />
          <SelectField
            label={t.outcome}
            value={check.outcome}
            options={(["conform", "deviation"] as const).map((value) => ({ value, label: t.outcomes[value] }))}
            onChange={(event) => {
              onChange({ ...check, outcome: event.target.value === "deviation" ? "deviation" : "conform" });
            }}
          />
        </div>
      )}
    </fieldset>
  );
}

function CriteriaEditor({ criteria, project, onChange }: { criteria: readonly Criterion[]; project: NfgDocument; onChange: (criteria: Criterion[]) => void }) {
  const defaults = topologyDefaults(project);
  const replace = (index: number, criterion: Criterion) => {
    onChange(criteria.map((item, position) => (position === index ? criterion : item)));
  };
  return (
    <fieldset className="flex flex-col gap-2 rounded-sm border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-text">{t.criteria}</legend>
      <p className="text-xs text-text-muted">{t.criteriaHint}</p>
      {criteria.map((criterion, index) => (
        <div key={`${String(index)}-${criterion.kind}`} className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
          <SelectField
            label={fill(t.criterion, { n: index + 1 })}
            value={criterion.kind}
            className="w-48"
            options={(["ping-succeeds", "ping-fails", "optical-service", "ont-operational"] as const).map((value) => ({ value, label: t.criterionKinds[value] }))}
            onChange={(event) => {
              const kind = event.target.value;
              const onOnt = criterion.kind === "optical-service" || criterion.kind === "ont-operational";
              if (kind === "optical-service" || kind === "ont-operational") replace(index, { kind, ont: onOnt ? criterion.ont : defaults.ont });
              else if (kind === "ping-succeeds" || kind === "ping-fails") replace(index, { kind, from: onOnt ? defaults.from : criterion.from, to: onOnt ? defaults.to : criterion.to });
            }}
          />
          {criterion.kind === "optical-service" || criterion.kind === "ont-operational" ? (
            <SelectField
              label={t.ont}
              value={criterion.ont}
              className="w-48"
              options={withCurrent(deviceOptions(project, "ont"), criterion.ont)}
              onChange={(event) => {
                replace(index, { ...criterion, ont: event.target.value });
              }}
            />
          ) : (
            <>
              <SelectField
                label={t.from}
                value={criterion.from}
                className="w-40"
                options={withCurrent(deviceOptions(project), criterion.from)}
                onChange={(event) => {
                  replace(index, { ...criterion, from: event.target.value });
                }}
              />
              <TextField
                label={t.to}
                value={criterion.to}
                maxLength={15}
                className="w-40"
                onChange={(event) => {
                  replace(index, { ...criterion, to: event.target.value.trim() });
                }}
              />
            </>
          )}
          {criteria.length > 1 && (
            <IconButton
              label={fill(t.removeCriterion, { n: index + 1 })}
              icon={<Trash2 size={16} />}
              onClick={() => {
                onChange(criteria.filter((_, position) => position !== index));
              }}
            />
          )}
        </div>
      ))}
      {criteria.length < 10 && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => {
            onChange([...criteria, { kind: "ping-succeeds", from: defaults.from, to: defaults.to }]);
          }}
        >
          {t.addCriterion}
        </Button>
      )}
    </fieldset>
  );
}

function ChoicesEditor({ step, onChange }: { step: Extract<ExerciseStep, { kind: "hypothesis" }>; onChange: (step: ExerciseStep) => void }) {
  const setChoices = (choices: typeof step.choices) => {
    onChange({ ...step, choices });
  };
  return (
    <fieldset className="flex flex-col gap-2 rounded-sm border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-text">{t.choices}</legend>
      {step.choices.map((choice, index) => (
        <div key={choice.id} className="flex flex-col gap-2 border-t border-border pt-2">
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              label={fill(t.choice, { n: index + 1 })}
              mono={false}
              value={choice.text}
              maxLength={300}
              className="min-w-48 flex-1"
              onChange={(event) => {
                setChoices(step.choices.map((item) => (item.id === choice.id ? { ...item, text: event.target.value } : item)));
              }}
            />
            <label className="flex min-h-9 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={choice.correct}
                onChange={(event) => {
                  setChoices(step.choices.map((item) => (item.id === choice.id ? { ...item, correct: event.target.checked } : item)));
                }}
              />
              {t.choiceCorrect}
            </label>
            {step.choices.length > 2 && (
              <IconButton
                label={fill(t.removeChoice, { n: index + 1 })}
                icon={<Trash2 size={16} />}
                onClick={() => {
                  setChoices(step.choices.filter((item) => item.id !== choice.id));
                }}
              />
            )}
          </div>
          <TextField
            label={fill(t.choiceFeedback, { n: index + 1 })}
            mono={false}
            value={choice.feedback}
            maxLength={600}
            onChange={(event) => {
              setChoices(step.choices.map((item) => (item.id === choice.id ? { ...item, feedback: event.target.value } : item)));
            }}
          />
        </div>
      ))}
      {step.choices.length < 6 && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => {
            setChoices([...step.choices, { id: nextChoiceId(step.choices.map((choice) => choice.id)), text: `${t.newChoice} ${String(step.choices.length + 1)}`, correct: false, feedback: t.newFeedback }]);
          }}
        >
          {t.addChoice}
        </Button>
      )}
    </fieldset>
  );
}

function StepBody({ step, project, onChange }: { step: ExerciseStep; project: NfgDocument; onChange: (step: ExerciseStep) => void }) {
  switch (step.kind) {
    case "observe":
    case "retest":
      return (
        <>
          <TextArea label={t.stepFields.instruction} value={step.instruction} maxLength={1000} onChange={(event) => { onChange({ ...step, instruction: event.target.value }); }} />
          <CheckEditor check={step.check} project={project} onChange={(check) => { onChange({ ...step, check }); }} />
          <PointsField value={step.points} onChange={(value) => { onChange({ ...step, points: value }); }} />
        </>
      );
    case "hypothesis":
      return (
        <>
          <TextArea label={t.stepFields.question} value={step.question} maxLength={500} onChange={(event) => { onChange({ ...step, question: event.target.value }); }} />
          <ChoicesEditor step={step} onChange={onChange} />
          <div className="flex flex-wrap gap-3">
            <PointsField value={step.points} onChange={(value) => { onChange({ ...step, points: value }); }} />
            <PointsField label={t.stepFields.retryPoints} value={step.retryPoints} onChange={(value) => { onChange({ ...step, retryPoints: value }); }} />
          </div>
        </>
      );
    case "measure":
      return (
        <>
          <TextArea label={t.stepFields.question} value={step.question} maxLength={500} onChange={(event) => { onChange({ ...step, question: event.target.value }); }} />
          <div className="flex flex-wrap items-end gap-3">
            <SelectField
              label={t.answerKind}
              value={step.answer.kind}
              className="w-72"
              options={(["network", "decibel"] as const).map((value) => ({ value, label: t.answerKinds[value] }))}
              onChange={(event) => {
                onChange({ ...step, answer: event.target.value === "decibel" ? { kind: "decibel", value: -20, tolerance: 0.5 } : { kind: "network", value: "192.168.1.0/24" } });
              }}
            />
            {step.answer.kind === "network" ? (
              <TextField label={t.expected} value={step.answer.value} maxLength={18} className="w-48" onChange={(event) => { onChange({ ...step, answer: { kind: "network", value: event.target.value.trim() } }); }} />
            ) : (
              <>
                <TextField
                  label={t.expected}
                  type="number"
                  step="0.1"
                  min={-60}
                  max={60}
                  value={step.answer.value}
                  className="w-32"
                  onChange={(event) => {
                    if (step.answer.kind === "decibel") onChange({ ...step, answer: { ...step.answer, value: Number(event.target.value) || 0 } });
                  }}
                />
                <TextField
                  label={t.tolerance}
                  type="number"
                  step="0.1"
                  min={0.01}
                  max={5}
                  value={step.answer.tolerance}
                  className="w-32"
                  onChange={(event) => {
                    if (step.answer.kind === "decibel") onChange({ ...step, answer: { ...step.answer, tolerance: Number(event.target.value) || 0 } });
                  }}
                />
              </>
            )}
          </div>
          <TextField label={t.wrongFeedback} mono={false} value={step.wrongFeedback} maxLength={600} onChange={(event) => { onChange({ ...step, wrongFeedback: event.target.value }); }} />
          <PointsField value={step.points} onChange={(value) => { onChange({ ...step, points: value }); }} />
        </>
      );
    case "fix":
      return (
        <>
          <TextArea label={t.stepFields.instruction} value={step.instruction} maxLength={1000} onChange={(event) => { onChange({ ...step, instruction: event.target.value }); }} />
          <CriteriaEditor criteria={step.criteria} project={project} onChange={(criteria) => { onChange({ ...step, criteria }); }} />
          <PointsField value={step.points} onChange={(value) => { onChange({ ...step, points: value }); }} />
        </>
      );
    case "debrief":
      return <TextArea label={t.stepFields.text} value={step.text} maxLength={3000} rows={4} onChange={(event) => { onChange({ ...step, text: event.target.value }); }} />;
  }
}

/** Une étape de l'exercice : titre, champs propres à son type, déplacement et suppression. */
export function StepEditor({
  step,
  index,
  total,
  project,
  onChange,
  onMove,
  onRemove,
}: {
  step: ExerciseStep;
  index: number;
  total: number;
  project: NfgDocument;
  onChange: (step: ExerciseStep) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  return (
    <li>
      <article aria-label={fill(t.stepHeading, { n, kind: t.stepKinds[step.kind] })} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-text">{fill(t.stepHeading, { n, kind: t.stepKinds[step.kind] })}</h3>
          <div className="ml-auto flex gap-1">
            <IconButton label={fill(t.moveUp, { n })} icon={<ArrowUp size={16} />} disabled={index === 0} onClick={() => { onMove(-1); }} />
            <IconButton label={fill(t.moveDown, { n })} icon={<ArrowDown size={16} />} disabled={index === total - 1} onClick={() => { onMove(1); }} />
            <IconButton label={fill(t.removeStep, { n })} icon={<Trash2 size={16} />} disabled={total === 1} onClick={onRemove} />
          </div>
        </div>
        <TextField label={t.stepFields.title} mono={false} value={step.title} maxLength={80} onChange={(event) => { onChange({ ...step, title: event.target.value }); }} />
        <StepBody step={step} project={project} onChange={onChange} />
      </article>
    </li>
  );
}
