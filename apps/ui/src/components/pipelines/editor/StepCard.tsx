import { AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type DragEvent, type ReactNode } from 'react';
import { PIPELINE_LIMITS, type Effort, type ModelOption, type PermissionMode, type PipelineClaudeStep, type PipelinePushStep } from '@seshboard/protocol/client';
import { modelLabel } from '../../../lib/autoModel.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../../lib/modes.ts';
import { mentionChoices, stepSummary } from '../../../state/pipelines.ts';
import { EFFORT_LABEL, EFFORTS } from '../../newSession/route.ts';
import { Button } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Pill } from '../../ui/Pill.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { Select } from '../../ui/Select.tsx';
import { canMove, earlierSessions, renameStep, updateStep, verdictOn, type PipelineForm } from './editorModel.ts';
import { MentionPromptField } from './MentionPromptField.tsx';

export const FIELD = 'h-8 rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink disabled:opacity-70';
const CHIP = 'h-7 rounded-md border border-edge bg-transparent px-2 text-ui text-text hover:bg-border/45';

/** One row of a step's form: the label on the left, the controls on the right. */
function Row({ label, htmlFor, labelId, children, hook }: { label: string; htmlFor?: string; labelId?: string; children: ReactNode; hook?: `data-${string}` }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 @max-[640px]:grid-cols-1 @max-[640px]:gap-1" data-setting-row {...(hook ? { [hook]: true } : {})}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="pt-1.5 text-ui text-muted">
          {label}
        </label>
      ) : (
        <span id={labelId} className="pt-1.5 text-ui text-muted">
          {label}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export interface StepCardProps {
  form: PipelineForm;
  index: number;
  open: boolean;
  onToggle(): void;
  onChange(form: PipelineForm): void;
  onMove(by: -1 | 1): void;
  onRemove(): void;
  readOnly: boolean;
  /** The issues about this step. */
  issues: string[];
  models: readonly ModelOption[];
  /** The project actions "Run first" offers, by name. */
  actions: readonly string[];
  /** Whether `actions` is one project's list: a pipeline for every project can't say an action is missing. */
  actionsKnown: boolean;
  /** Drag to reorder: the card's own handlers, and whether it is where a drop would go. */
  drag: {
    armed: boolean;
    onArm(): void;
    onDragStart(event: DragEvent<HTMLDivElement>): void;
    onDragOver(event: DragEvent<HTMLDivElement>): void;
    onDrop(event: DragEvent<HTMLDivElement>): void;
    onDragEnd(): void;
    dropBefore: boolean;
  };
}

/** A step: folded to its one line, or open to its form. Push is a card of its own kind, always last. */
export function StepCard({ form, index, open, onToggle, onChange, onMove, onRemove, readOnly, issues, models, actions, actionsKnown, drag }: StepCardProps) {
  const id = useId();
  const step = form.steps[index]!;
  const push = step.kind === 'push';
  const movable = !readOnly && !push;
  return (
    <div
      className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3"
      draggable={movable && drag.armed}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      onDragEnd={drag.onDragEnd}
      data-pipeline-step-card={step.name}
      data-step-kind={step.kind}
      data-open={open || undefined}
    >
      {drag.dropBefore && <div aria-hidden className="absolute -top-1.5 right-0 left-10 h-0.5 rounded-full bg-accent-ink" />}
      {/* The number, on the rail. */}
      <span aria-hidden className={`relative z-10 mt-2.5 flex size-7 items-center justify-center rounded-full border text-meta font-semibold tabular-nums ${open ? 'border-accent-ink bg-card text-text' : 'border-border bg-bg text-muted'}`}>
        {index + 1}
      </span>
      <section aria-labelledby={`${id}-name`} className={`min-w-0 rounded-xl border bg-card ${open ? 'border-accent-ink' : issues.length ? 'border-error/50' : 'border-border'}`}>
        <div className="flex min-h-12 items-center gap-1 pr-2">
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-form`} className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-l-xl py-2 pl-3 text-left hover:bg-border/25" data-pipeline-step-toggle>
            {open ? <ChevronDown size={13} aria-hidden className="shrink-0 text-faint" /> : <ChevronRight size={13} aria-hidden className="shrink-0 text-faint" />}
            <span id={`${id}-name`} className="shrink-0 truncate text-body font-semibold">
              {step.name.trim() || `Step ${index + 1}`}
            </span>
            <span className={`shrink-0 rounded-md px-1.5 py-px text-meta font-semibold ${push ? 'bg-link/15 text-link' : 'bg-pipeline/15 text-pipeline'}`}>{push ? 'push' : 'claude'}</span>
            {!open && <span className="min-w-0 truncate text-ui text-muted">{stepSummary(step, form)}</span>}
            {issues.length > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-meta text-error" data-tooltip={issues.join(' ')}>
                <AlertCircle size={12} aria-hidden />
                <span className="sr-only">{issues.length === 1 ? '1 issue' : `${issues.length} issues`}</span>
              </span>
            )}
          </button>
          {!readOnly && (
            <span className="flex shrink-0 items-center">
              {!push && (
                <>
                  <Button variant="quiet" size="sm" iconOnly icon={<ArrowUp size={13} aria-hidden />} aria-label={`Move ${step.name || 'step'} up`} disabled={!canMove(form, index, -1)} onClick={() => onMove(-1)} data-pipeline-step-up />
                  <Button variant="quiet" size="sm" iconOnly icon={<ArrowDown size={13} aria-hidden />} aria-label={`Move ${step.name || 'step'} down`} disabled={!canMove(form, index, 1)} onClick={() => onMove(1)} data-pipeline-step-down />
                </>
              )}
              <Button variant="quiet" size="sm" iconOnly icon={<Trash2 size={13} aria-hidden />} aria-label={`Remove ${step.name || 'step'}`} disabled={form.steps.length === 1} onClick={onRemove} data-pipeline-step-remove />
              {movable && (
                <span
                  aria-hidden
                  // Pressing the grip lets the card be dragged; the arrows do the same from the keyboard.
                  onPointerDown={drag.onArm}
                  className="flex h-6 w-5 cursor-grab items-center justify-center text-faint hover:text-text active:cursor-grabbing"
                  data-tooltip="Drag to reorder"
                  data-pipeline-step-grip
                >
                  <GripVertical size={13} />
                </span>
              )}
            </span>
          )}
        </div>
        {issues.length > 0 && (
          <ul className="grid gap-0.5 px-3 pb-2 text-meta text-error" data-pipeline-step-issues>
            {issues.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {open && (
          <div id={`${id}-form`} className="grid gap-3 border-t border-border px-3 py-3">
            <Row label="Name" htmlFor={`${id}-name-field`}>
              <input
                id={`${id}-name-field`}
                value={step.name}
                maxLength={PIPELINE_LIMITS.name}
                disabled={readOnly}
                onChange={(e) => onChange(renameStep(form, index, e.target.value))}
                className={`${FIELD} w-56 max-w-full`}
                data-pipeline-step-name
              />
            </Row>
            {step.kind === 'push' ? (
              <PushForm step={step} form={form} index={index} readOnly={readOnly} onChange={onChange} />
            ) : (
              <ClaudeForm step={step} form={form} index={index} readOnly={readOnly} onChange={onChange} models={models} actions={actions} actionsKnown={actionsKnown} id={id} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function PushForm({ step, form, index, readOnly, onChange }: { step: PipelinePushStep; form: PipelineForm; index: number; readOnly: boolean; onChange(form: PipelineForm): void }) {
  return (
    <>
      <p className="text-meta text-muted">Commits, pushes and opens a pull request. No model.</p>
      <div className="grid gap-2">
        <Checkbox checked={step.draft} disabled={readOnly} onChange={(draft) => onChange(updateStep<PipelinePushStep>(form, index, { draft }))} dataAttrs={{ 'data-pipeline-draft': true }}>
          <span className="text-ui text-text">Open the pull request as a draft</span>
        </Checkbox>
        {/* Only for your own pipelines: a built-in always waits. */}
        {!form.builtIn && (
          <span data-setting-row>
            <Checkbox checked={form.autoPush} disabled={readOnly} onChange={(autoPush) => onChange({ ...form, autoPush })} dataAttrs={{ 'data-pipeline-auto-push': true }}>
              <span className="grid gap-0.5">
                <span className="text-ui text-text">Push without asking</span>
                <span className="text-meta text-muted">Off: the run waits for you before it pushes.</span>
              </span>
            </Checkbox>
          </span>
        )}
      </div>
    </>
  );
}

const startValue = (start: PipelineClaudeStep['start']) => (typeof start === 'object' ? `fork:${start.fork}` : 'fresh');

function ClaudeForm({ step, form, index, readOnly, onChange, models, actions, actionsKnown, id }: { step: PipelineClaudeStep; form: PipelineForm; index: number; readOnly: boolean; onChange(form: PipelineForm): void; models: readonly ModelOption[]; actions: readonly string[]; actionsKnown: boolean; id: string }) {
  const update = (patch: Partial<PipelineClaudeStep>) => onChange(updateStep<PipelineClaudeStep>(form, index, patch));
  const earlier = earlierSessions(form.steps, index);
  const start = startValue(step.start);
  const startSegments = [{ value: 'fresh', label: 'Fresh', data: { 'data-pipeline-start': 'fresh' } }, ...earlier.map((s) => ({ value: `fork:${s.name.trim()}`, label: `Fork of ${s.name.trim()}`, data: { 'data-pipeline-start': s.name.trim() } }))];
  // A fork of a step that isn't before it any more still shows, so the issue has something to point at.
  if (!startSegments.some((s) => s.value === start)) startSegments.push({ value: start, label: `Fork of ${start.slice(5)}`, data: { 'data-pipeline-start': start.slice(5) } });

  const setStart = (value: string) => update({ start: value === 'fresh' ? 'fresh' : { fork: value.slice(5) } });

  const modelOptions = [
    { value: '', label: 'Default model' },
    ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName })),
    ...(step.model && !models.some((m) => m.value === step.model) ? [{ value: step.model, label: modelLabel(models, step.model) }] : []),
  ];
  const modes: PermissionMode[] = step.permissionMode && !MODE_CHOICES.includes(step.permissionMode) ? [...MODE_CHOICES, step.permissionMode] : MODE_CHOICES;
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState('');
  const offered = [...new Set([...actions, ...step.actionsFirst])];
  const toggleAction = (name: string) => update({ actionsFirst: step.actionsFirst.includes(name) ? step.actionsFirst.filter((a) => a !== name) : [...step.actionsFirst, name] });
  const addTyped = () => {
    const name = typed.trim();
    if (name && !step.actionsFirst.includes(name)) update({ actionsFirst: [...step.actionsFirst, name] });
    setTyped('');
    setAdding(false);
  };
  const noEarlier = earlier.length === 0;
  const sendTo = step.verdict?.sendTo ?? '';

  return (
    <>
      <Row label="Starts" labelId={`${id}-starts`}>
        {/* Fresh and one fork fit side by side; more earlier steps would wrap out of the track, so they get a menu. */}
        {startSegments.length <= 2 ? (
          <SegmentedControl
            mode="radio"
            label="Starts"
            value={start}
            onChange={(value) => setStart(value)}
            segments={startSegments.map((s) => ({ ...s, disabled: readOnly }))}
            data-pipeline-starts
          />
        ) : (
          <Select
            label="Starts"
            className={CHIP}
            value={start}
            disabled={readOnly}
            onChange={(value) => setStart(value)}
            options={startSegments.map((s) => ({ value: s.value, label: s.label }))}
            menuWidth={220}
            dataAttrs={{ 'data-pipeline-starts': true }}
          />
        )}
      </Row>
      <Row label="Model" labelId={`${id}-model`}>
        <div role="group" aria-labelledby={`${id}-model`} className="flex flex-wrap items-center gap-1.5">
          <Select label="Model" className={CHIP} value={step.model ?? ''} disabled={readOnly} onChange={(value) => update({ model: value || null })} options={modelOptions} dataAttrs={{ 'data-pipeline-model': true }} />
          <Select<Effort | ''>
            label="Effort"
            className={CHIP}
            value={step.effort ?? ''}
            disabled={readOnly}
            onChange={(value) => update({ effort: value || null })}
            options={[{ value: '', label: 'Default effort' }, ...EFFORTS.map((e) => ({ value: e, label: `${EFFORT_LABEL[e]} effort` }))]}
            dataAttrs={{ 'data-pipeline-effort': true }}
          />
          <Select<PermissionMode | ''>
            label="Permission mode"
            className={CHIP}
            value={step.permissionMode ?? ''}
            disabled={readOnly}
            onChange={(value) => update({ permissionMode: value || null })}
            options={[{ value: '', label: 'Default mode' }, ...modes.map((m) => ({ value: m, label: MODE_LABEL[m], icon: <span className={`size-2 rounded-full ${MODE_DOT[m] ?? 'bg-faint'}`} /> }))]}
            dataAttrs={{ 'data-pipeline-mode': true }}
          />
          <Checkbox checked={step.readOnly} disabled={readOnly} onChange={(value) => update({ readOnly: value })} className="ml-1" tooltip="Only tools that read. Use it for a review." dataAttrs={{ 'data-pipeline-read-only': true }}>
            <span className="text-ui text-text">Read only</span>
          </Checkbox>
        </div>
      </Row>
      {step.permissionMode === 'plan' && (
        <Row label="Plan" labelId={`${id}-plan`}>
          <Checkbox checked={step.approvePlan} disabled={readOnly} onChange={(approvePlan) => update({ approvePlan })} dataAttrs={{ 'data-pipeline-approve-plan': true }}>
            <span className="grid gap-0.5">
              <span className="text-ui text-text">Approve the plan for me</span>
              <span className="text-meta text-muted">The run goes on to the next step once the plan is written. The plan is kept for later steps and the pull request.</span>
            </span>
          </Checkbox>
        </Row>
      )}
      <Row label="Prompt" htmlFor={`${id}-prompt`}>
        <MentionPromptField id={`${id}-prompt`} value={step.prompt} onChange={(prompt) => update({ prompt })} choices={mentionChoices(form.steps, index)} describedBy={`${id}-prompt-hint`} invalid={!step.prompt.trim()} readOnly={readOnly} />
        <p id={`${id}-prompt-hint`} className="mt-1.5 text-meta text-muted">
          @ links the parent or an earlier step. Claude gets their brief, as with any linked session.
        </p>
      </Row>
      <Row label="Run first" labelId={`${id}-run-first`} hook="data-pipeline-run-first">
        <div role="group" aria-labelledby={`${id}-run-first`} className="flex flex-wrap items-center gap-1.5">
          {offered.map((name) => {
            const on = step.actionsFirst.includes(name);
            const missing = actionsKnown && on && !actions.includes(name);
            return (
              <Pill
                key={name}
                tone={missing ? 'caution' : 'default'}
                selected={on && !missing}
                onClick={readOnly ? undefined : () => toggleAction(name)}
                aria-pressed={readOnly ? undefined : on}
                icon={on ? <Check size={11} aria-hidden /> : undefined}
                data-tooltip={missing ? `${name} isn't one of the project's actions here. The step runs without it.` : on && !actionsKnown && !actions.includes(name) ? `Runs the project's ${name} action, in projects that have one.` : undefined}
                data-pipeline-action={name}
              >
                {name}
              </Pill>
            );
          })}
          {!readOnly &&
            (adding ? (
              <input
                autoFocus
                aria-label="Action name"
                placeholder="Action name"
                value={typed}
                maxLength={200}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={addTyped}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTyped();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setTyped('');
                    setAdding(false);
                  }
                }}
                className={`${FIELD} h-6 w-36 rounded-full`}
                data-pipeline-action-field
              />
            ) : (
              <Pill dashed icon={<Plus size={11} aria-hidden />} onClick={() => setAdding(true)} disabled={step.actionsFirst.length >= 10} data-pipeline-add-action>
                action
              </Pill>
            ))}
          <span className="text-meta text-muted">project actions, results go in the prompt</span>
        </div>
      </Row>
      <Row label="Verdict" labelId={`${id}-verdict`} hook="data-pipeline-verdict">
        <div className="grid gap-2">
          <div role="group" aria-labelledby={`${id}-verdict`} className="flex min-h-7 flex-wrap items-center gap-1.5">
            <Checkbox
              checked={!!step.verdict}
              disabled={readOnly}
              disabledReason={!readOnly && noEarlier && !step.verdict ? 'Needs an earlier step to send changes to.' : null}
              onChange={(on) => update({ verdict: on ? verdictOn(form.steps, index) : null })}
              dataAttrs={{ 'data-pipeline-verdict-toggle': true }}
            >
              <span className="text-ui text-text">Ends with a verdict</span>
            </Checkbox>
            {step.verdict && (
              <>
                <span className="ml-1 text-meta text-muted">changes go to</span>
                <Select
                  label="Changes go to"
                  className={CHIP}
                  value={step.verdict.sendTo}
                  disabled={readOnly}
                  onChange={(sendTo) => update({ verdict: { ...step.verdict!, sendTo } })}
                  options={[...earlier.map((s) => ({ value: s.name.trim(), label: s.name.trim() })), ...(earlier.some((s) => s.name.trim() === sendTo) ? [] : [{ value: sendTo, label: sendTo || 'No step' }])]}
                  dataAttrs={{ 'data-pipeline-send-to': true }}
                />
                <span className="text-meta text-muted">up to</span>
                <Select
                  label="Rounds"
                  className={CHIP}
                  value={String(step.verdict.rounds)}
                  disabled={readOnly}
                  onChange={(rounds) => update({ verdict: { ...step.verdict!, rounds: Number(rounds) } })}
                  options={Array.from({ length: PIPELINE_LIMITS.rounds.max - PIPELINE_LIMITS.rounds.min + 1 }, (_, i) => {
                    const n = PIPELINE_LIMITS.rounds.min + i;
                    return { value: String(n), label: `${n} ${n === 1 ? 'round' : 'rounds'}` };
                  })}
                  dataAttrs={{ 'data-pipeline-rounds': true }}
                />
              </>
            )}
          </div>
          {step.verdict && <p className="text-meta text-muted">Ask Claude to end with Verdict: pass or Verdict: changes needed, and a list. A reply without a verdict stops the run.</p>}
          <span data-setting-row data-pipeline-confirm>
            <Checkbox checked={step.confirmBefore} disabled={readOnly} onChange={(confirmBefore) => update({ confirmBefore })} dataAttrs={{ 'data-pipeline-confirm-toggle': true }}>
              <span className="text-ui text-text">Wait for me before this step</span>
            </Checkbox>
          </span>
        </div>
      </Row>
    </>
  );
}
