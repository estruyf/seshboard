import { ArrowDown, ArrowUp, Bot, Folder, GitBranch, GitPullRequest, Globe, Plus, Trash2, Users } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { PIPELINE_LIMITS } from '@switchboard/protocol/client';
import { modelLabel } from '../../lib/autoModel.ts';
import { basename } from '../../lib/format.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import {
  addStep,
  blankChoices,
  earlierClaudeSteps,
  firstProblem,
  formProblems,
  formToSave,
  moveStep,
  newPipelineForm,
  pipelineForm,
  removeStep,
  renameStep,
  setStart,
  setVerdict,
  setWaitsBefore,
  stepDepths,
  stepSummary,
  toggleBrief,
  updateStep,
  waitsBefore,
  type ClaudeForm,
  type FormScope,
  type PipelineForm,
  type PushForm,
} from '../../state/pipelineForm.ts';
import { closePipelineEditor, savePipeline, usePipelines, type PipelineEditorRequest } from '../../state/pipelinesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { EFFORT_LABEL, EFFORTS } from '../newSession/route.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Select } from '../ui/Select.tsx';
import { Stepper } from '../ui/Stepper.tsx';

const FIELD = 'h-8 rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';
const AREA = 'w-full rounded-md border border-edge bg-bg px-2.5 py-1.5 text-ui text-text outline-none focus:border-accent-ink';
const CHIP = 'h-7 rounded-md border border-edge bg-transparent px-2 text-ui text-text hover:bg-border/45';

const SCOPES: Array<{ kind: FormScope; heading: string; line: string; Icon: typeof Globe }> = [
  { kind: 'global', heading: 'All projects', line: 'Only you. Shows in every project.', Icon: Globe },
  { kind: 'project', heading: 'This project', line: 'Only you. Shows in one project.', Icon: Folder },
  { kind: 'shared', heading: 'Shared with the project', line: 'Saved in the project’s .switchboard.json. Everyone who has it sees it; commit that change to share it.', Icon: Users },
];

/** The editor, wherever it was asked for (Settings › Pipelines, the palette). Mounted once in the app. */
export function PipelineEditorHost() {
  const request = usePipelines((s) => s.editor);
  if (!request) return null;
  // Keyed, so another request starts from its own form.
  return <PipelineEditor key={`${request.pipeline?.scope.kind}:${request.pipeline?.id ?? 'new'}:${request.root ?? ''}`} request={request} onClose={closePipelineEditor} />;
}

function Row({ label, labelId, htmlFor, children }: { label: string; labelId?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 @max-[640px]:grid-cols-1 @max-[640px]:gap-1">
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

/**
 * New pipeline and Edit pipeline: the name, where the steps work, where it is kept (all projects, one project, or shared
 * in the project's .switchboard.json), and the steps as the tree they make. What is wrong shows under the step it is
 * about, and Save says why it can't be used yet.
 */
function PipelineEditor({ request, onClose }: { request: PipelineEditorRequest; onClose(): void }) {
  const id = useId();
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const projects = useProjects((s) => s.projects);
  const editing = request.pipeline;
  const [form, setForm] = useState<PipelineForm>(() => (editing ? pipelineForm(editing, request.root) : newPipelineForm(request.root)));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const shared = form.scope === 'shared';

  const choices = useMemo(() => {
    const roots = new Set(addedProjects(projects).map((p) => p.root));
    for (const r of [request.root, form.root]) if (r) roots.add(r);
    return [...roots].map((root) => ({ root, name: projects.get(root)?.name ?? basename(root) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const problems = formProblems(form);
  const problem = firstProblem(form);
  const depths = stepDepths(form.steps);

  const save = async () => {
    setTried(true);
    const body = formToSave(form);
    if (!body || saving || !client) return;
    setSaving(true);
    setError(null);
    try {
      // Another place: a new one is made there, then the old one goes (a move).
      const scopeChanged = editing && (editing.scope.kind !== body.scope.kind || ('root' in editing.scope && 'root' in body.scope && editing.scope.root !== body.scope.root));
      const saved = await savePipeline(scopeChanged ? { ...body, id: undefined } : body);
      if (scopeChanged) await client.call('pipelines.remove', { id: editing.id, scope: editing.scope }).catch(() => toast(`Saved “${saved.name}”, but couldn’t take the old one out.`));
      request.onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Invalid params:?\s*/i, '') : String(e));
      setSaving(false);
    }
  };

  const change = (next: PipelineForm) => setForm(next);
  const projectName = (root: string | null) => (root ? (projects.get(root)?.name ?? basename(root)) : null);

  return (
    <Dialog
      title={editing ? 'Edit pipeline' : 'New pipeline'}
      subtitle="Steps run one after another. Each step is its own session, listed under the one that started the run."
      width="lg"
      placement="top"
      onClose={onClose}
      onSubmit={() => void save()}
      initialFocus={nameRef}
      footerStart={
        tried && problem ? (
          <span role="alert" className="text-meta text-error" data-pipeline-editor-problem>
            {problem}
          </span>
        ) : (
          <span className="text-meta text-muted">{form.steps.length} {form.steps.length === 1 ? 'step' : 'steps'}</span>
        )
      }
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            kbd="⌘↵"
            disabled={saving || (tried && !!problem)}
            aria-busy={saving || undefined}
            data-tooltip={tried && problem ? problem : undefined}
            onClick={() => void save()}
            data-pipeline-editor-save
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
      data-pipeline-editor={editing?.id ?? 'new'}
    >
      <div className="@container grid gap-4">
        <Row label="Name" htmlFor={`${id}-name`}>
          <input
            ref={nameRef}
            id={`${id}-name`}
            value={form.name}
            maxLength={60}
            placeholder="Plan, execute, validate"
            onChange={(e) => change({ ...form, name: e.target.value })}
            className={`w-80 ${FIELD} placeholder:text-faint ${tried && !form.name.trim() ? 'border-error' : 'border-edge'}`}
            data-pipeline-editor-name
          />
        </Row>
        <Row label="Works in" labelId={`${id}-workspace`}>
          <Select
            label="Works in"
            className={CHIP}
            value={form.workspace}
            onChange={(workspace) => change({ ...form, workspace })}
            options={[
              { value: 'worktree', label: 'New worktree', icon: <GitBranch size={13} aria-hidden /> },
              { value: 'current', label: 'Project folder', icon: <Folder size={13} aria-hidden /> },
            ]}
            dataAttrs={{ 'data-pipeline-workspace': true }}
          />
          <p className="mt-1.5 text-meta text-muted">{form.workspace === 'worktree' ? 'One new worktree for the whole run, so every step sees the same files.' : 'In the folder of the session that starts the run. Only one run at a time works in a folder.'}</p>
        </Row>
        <Row label="Kept" labelId={`${id}-scope`}>
          <RadioGroup label="Kept" className="grid gap-1.5">
            {SCOPES.map(({ kind, heading, line, Icon }) => {
              const checked = form.scope === kind;
              return (
                <Radio
                  key={kind}
                  checked={checked}
                  disabled={kind !== 'global' && choices.length === 0}
                  onSelect={() => change({ ...form, scope: kind, root: kind === 'global' ? form.root : (form.root ?? choices[0]?.root ?? null) })}
                  className={`w-full rounded-lg border px-3 py-2 ${checked ? 'border-accent-ink bg-accent/8' : 'border-edge hover:bg-border/45'}`}
                  dataAttrs={{ 'data-pipeline-scope': kind }}
                >
                  <span className="flex items-start gap-2">
                    <Icon size={14} aria-hidden className="mt-px shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui font-semibold text-text">{heading}</span>
                      <span className="block text-meta text-muted">{line}</span>
                    </span>
                  </span>
                </Radio>
              );
            })}
          </RadioGroup>
          {form.scope !== 'global' && (
            <div className="mt-1.5">
              <Select
                value={form.root ?? ''}
                options={choices.map((c) => ({ value: c.root, label: c.name }))}
                onChange={(root) => change({ ...form, root })}
                label="Project"
                placeholder="Choose a project"
                className="w-full rounded-md border border-edge bg-bg px-2.5 py-1.5 text-ui text-text"
                dataAttrs={{ 'data-pipeline-project-select': true }}
              />
            </div>
          )}
        </Row>
        {!shared && (
          <Row label="Pushing" labelId={`${id}-autopush`}>
            <Checkbox checked={form.autoPush} onChange={(autoPush) => change({ ...form, autoPush })} dataAttrs={{ 'data-pipeline-autopush': true }}>
              <span className="grid gap-0.5">
                <span className="text-ui text-text">Push without asking</span>
                <span className="text-meta text-muted">Off, the run stops at its push step and waits for you. A pipeline shared with the project always waits.</span>
              </span>
            </Checkbox>
          </Row>
        )}
        {problems.pipeline.length > 0 && tried && (
          <div className="grid gap-1" data-pipeline-editor-errors>
            {problems.pipeline.map((p) => (
              <p key={p} role="alert" className="text-ui text-error">
                {p}
              </p>
            ))}
          </div>
        )}

        <section aria-labelledby={`${id}-steps`} className="grid gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <SectionHeader as="h3" headingId={`${id}-steps`} className="flex-1">
              Steps
            </SectionHeader>
            <Button size="sm" icon={<Plus size={12} aria-hidden />} disabled={form.steps.length >= PIPELINE_LIMITS.steps} onClick={() => change(addStep(form, 'claude'))} data-pipeline-add-step="claude">
              Claude step
            </Button>
            <Button size="sm" icon={<Plus size={12} aria-hidden />} disabled={form.steps.length >= PIPELINE_LIMITS.steps} onClick={() => change(addStep(form, 'push'))} data-pipeline-add-step="push">
              Push step
            </Button>
          </div>
          <ol className="grid gap-2" data-pipeline-editor-steps>
            {form.steps.map((step, i) => (
              <li key={step.key} style={{ marginLeft: depths[i]! * 20 }} className={depths[i]! > 0 ? 'border-l-2 border-edge pl-3' : ''} data-pipeline-step-card={i} data-step-kind={step.kind} data-step-depth={depths[i]}>
                <StepCard form={form} index={i} root={form.root ?? request.root} errors={tried ? problems.steps[i]! : []} onChange={change} shared={shared} />
              </li>
            ))}
          </ol>
        </section>

        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        {shared && form.root && (
          <Notice tone="info" role="note">
            Saved in {projectName(form.root)}’s .switchboard.json. Anyone who runs it for the first time is shown every step first.
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/** One step: its name and place in the order in the header, then what the kind of step has to say. */
function StepCard({ form, index, root, errors, onChange, shared }: { form: PipelineForm; index: number; root: string | null; errors: string[]; onChange(form: PipelineForm): void; shared: boolean }) {
  const step = form.steps[index]!;
  const last = form.steps.length - 1;
  const claude = step.kind === 'claude';
  const waits = waitsBefore(form, index);
  const iconTone = claude ? 'text-muted' : 'text-link';
  return (
    <div className={`grid gap-3 rounded-xl border bg-card p-3 ${errors.length ? 'border-error/60' : 'border-edge'}`}>
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-border/70 text-meta font-medium text-muted" aria-hidden>
          {index + 1}
        </span>
        {claude ? <Bot size={14} className={iconTone} aria-hidden /> : <GitPullRequest size={14} className={iconTone} aria-hidden />}
        <input
          aria-label={`Name of step ${index + 1}`}
          value={step.name}
          maxLength={PIPELINE_LIMITS.stepName}
          onChange={(e) => onChange(renameStep(form, index, e.target.value))}
          className={`min-w-0 flex-1 ${FIELD} font-medium ${errors.some((e) => /name/i.test(e)) ? 'border-error' : 'border-edge'}`}
          data-pipeline-step-name
        />
        <span className="hidden shrink-0 text-meta text-muted @min-[640px]:inline">{stepSummary(step)}</span>
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowUp size={13} aria-hidden />} aria-label={`Move ${step.name || `step ${index + 1}`} up`} disabled={index === 0} onClick={() => onChange(moveStep(form, index, -1))} data-pipeline-step-up />
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowDown size={13} aria-hidden />} aria-label={`Move ${step.name || `step ${index + 1}`} down`} disabled={index === last} onClick={() => onChange(moveStep(form, index, 1))} data-pipeline-step-down />
        <Button variant="quiet" size="sm" iconOnly icon={<Trash2 size={13} aria-hidden />} aria-label={`Remove ${step.name || `step ${index + 1}`}`} disabled={form.steps.length <= 1} onClick={() => onChange(removeStep(form, index))} data-pipeline-step-remove />
      </div>
      {claude ? <ClaudeFields form={form} index={index} step={step} root={root} onChange={onChange} shared={shared} /> : <PushFields form={form} index={index} step={step} onChange={onChange} />}
      <Checkbox checked={waits} onChange={(on) => onChange(setWaitsBefore(form, index, on))} dataAttrs={{ 'data-pipeline-confirm-before': true }}>
        <span className="text-ui text-text">{claude ? 'Wait for me before this step starts' : 'Wait for me before this step'}</span>
        {!claude && <span className="block text-meta text-muted">{form.autoPush && !shared ? 'With push without asking on, it only waits if this is ticked.' : 'A push step always waits for you.'}</span>}
      </Checkbox>
      {errors.length > 0 && (
        <div className="grid gap-1" data-pipeline-step-errors>
          {errors.map((e) => (
            <p key={e} role="alert" className="text-ui text-error">
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ClaudeFields({ form, index, step, root, onChange, shared }: { form: PipelineForm; index: number; step: ClaudeForm; root: string | null; onChange(form: PipelineForm): void; shared: boolean }) {
  const id = useId();
  const models = useHosts((s) => s.models);
  const area = useRef<HTMLTextAreaElement>(null);
  const earlier = earlierClaudeSteps(form, index);
  const patch = (p: Partial<ClaudeForm>) => onChange(updateStep(form, index, p));
  const fork = step.start.kind === 'fork' ? step.start.step : null;
  const briefOf = step.start.kind === 'fresh' ? (step.start.briefOf ?? []) : [];

  /** Puts a blank where the cursor is. */
  const insert = (text: string) => {
    const el = area.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [step.prompt.length, step.prompt.length];
    patch({ prompt: `${step.prompt.slice(0, at[0])}${text}${step.prompt.slice(at[1])}` });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at[0]! + text.length, at[0]! + text.length);
    });
  };

  const modes = shared ? MODE_CHOICES : [...MODE_CHOICES, 'bypassPermissions' as const];
  return (
    <div className="grid gap-3">
      <Row label="Prompt" htmlFor={`${id}-prompt`}>
        <textarea
          ref={area}
          id={`${id}-prompt`}
          value={step.prompt}
          rows={4}
          spellCheck
          onChange={(e) => patch({ prompt: e.target.value })}
          className={`${AREA} font-mono`}
          data-pipeline-step-prompt
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-meta text-muted">Insert</span>
          {blankChoices(form, index).map((b) => (
            <Pill key={b.text} tone="muted" onClick={() => insert(b.text)} data-pipeline-blank={b.text}>
              {b.label}
            </Pill>
          ))}
        </div>
      </Row>
      <Row label="Starts as" labelId={`${id}-start`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            label="Starts as"
            className={CHIP}
            value={fork ?? ''}
            onChange={(value) => onChange(setStart(form, index, value || null))}
            options={[{ value: '', label: 'A fresh session' }, ...earlier.map((s) => ({ value: s.name, label: `Fork of ${s.name}` }))]}
            dataAttrs={{ 'data-pipeline-start': true }}
          />
          <span className="text-meta text-muted">{fork ? 'Continues that session’s conversation, with this prompt as the next message.' : 'A new session that gets a brief of the steps picked below.'}</span>
        </div>
        {!fork && earlier.length > 0 && (
          <div role="group" aria-label="Brief of" className="mt-1.5 flex flex-wrap items-center gap-1.5" data-pipeline-brief-of>
            <span className="text-meta text-muted">Brief of</span>
            {earlier.map((s) => {
              const on = briefOf.includes(s.name);
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(toggleBrief(form, index, s.name, !on))}
                  className={`h-6 rounded-md border px-2 text-ui ${on ? 'border-accent-ink bg-accent/15 font-semibold text-text' : 'border-edge text-muted hover:bg-border/45 hover:text-text'}`}
                  data-pipeline-brief={s.name}
                >
                  {s.name}
                </button>
              );
            })}
            {briefOf.length === 0 && <span className="text-meta text-faint">none picked: the step before</span>}
          </div>
        )}
      </Row>
      <Row label="Runs with" labelId={`${id}-runs`}>
        <div role="group" aria-labelledby={`${id}-runs`} className="flex flex-wrap items-center gap-1.5">
          <Select
            label="Model"
            className={CHIP}
            value={step.model ?? ''}
            onChange={(value) => patch({ model: value || null })}
            options={[
              { value: '', label: 'Default model' },
              ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName })),
              ...(step.model && !models.some((m) => m.value === step.model) ? [{ value: step.model, label: modelLabel(models, step.model) }] : []),
            ]}
            dataAttrs={{ 'data-pipeline-model': true }}
          />
          <Select
            label="Effort"
            className={CHIP}
            value={step.effort ?? ''}
            onChange={(value) => patch({ effort: value || null })}
            options={[{ value: '', label: 'Default effort' }, ...EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))]}
            dataAttrs={{ 'data-pipeline-effort': true }}
          />
          <Select
            label="Permission mode"
            className={CHIP}
            value={step.permissionMode ?? ''}
            onChange={(value) => patch({ permissionMode: value || null })}
            options={[
              { value: '', label: 'Default mode' },
              ...modes.map((m) => ({ value: m, label: MODE_LABEL[m], icon: <span className={`size-2 rounded-full ${MODE_DOT[m] ?? 'bg-faint'}`} /> })),
              ...(step.permissionMode && !modes.includes(step.permissionMode as (typeof modes)[number]) ? [{ value: step.permissionMode, label: MODE_LABEL[step.permissionMode] }] : []),
            ]}
            dataAttrs={{ 'data-pipeline-mode': true }}
          />
        </div>
        <div className="mt-2">
          <Checkbox checked={step.readOnly === true} onChange={(readOnly) => patch({ readOnly })} dataAttrs={{ 'data-pipeline-read-only': true }}>
            <span className="grid gap-0.5">
              <span className="text-ui text-text">Read only</span>
              <span className="text-meta text-muted">The session can read files and look at git, but not change anything.</span>
            </span>
          </Checkbox>
        </div>
      </Row>
      <Row label="Actions first" labelId={`${id}-actions`}>
        <ActionsFirst id={`${id}-actions`} root={root} value={step.actionsFirst ?? []} onChange={(actionsFirst) => patch({ actionsFirst })} />
      </Row>
      <Row label="Verdict" labelId={`${id}-verdict`}>
        <Checkbox checked={!!step.verdict} onChange={(on) => onChange(setVerdict(form, index, on))} disabled={earlier.length === 0} dataAttrs={{ 'data-pipeline-verdict': true }}>
          <span className="grid gap-0.5">
            <span className="text-ui text-text">Ends with a verdict</span>
            <span className="text-meta text-muted">The reply ends with “Verdict: pass” or “Verdict: changes needed”. Changes go back to an earlier step, then this step runs again.</span>
          </span>
        </Checkbox>
        {step.verdict && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-ui text-muted" data-pipeline-verdict-options>
            <span>Send changes to</span>
            <Select
              label="Send changes to"
              className={CHIP}
              value={step.verdict.sendTo}
              placeholder="Choose a step"
              onChange={(sendTo) => patch({ verdict: { ...step.verdict!, sendTo } })}
              options={earlier.map((s) => ({ value: s.name, label: s.name }))}
              dataAttrs={{ 'data-pipeline-send-to': true }}
            />
            <span>up to</span>
            <Stepper
              value={step.verdict.rounds}
              min={PIPELINE_LIMITS.rounds.min}
              max={PIPELINE_LIMITS.rounds.max}
              onChange={(rounds) => patch({ verdict: { ...step.verdict!, rounds } })}
              label="Rounds"
              less="Fewer rounds"
              more="More rounds"
              hook="pipeline-rounds"
            />
            <span>{step.verdict.rounds === 1 ? 'round' : 'rounds'}</span>
          </div>
        )}
      </Row>
    </div>
  );
}

/** The project's shell actions to tick, or a typed list of names when there is no project (or none of its actions are shell ones). */
function ActionsFirst({ id, root, value, onChange }: { id: string; root: string | null; value: string[]; onChange(value: string[]): void }) {
  const { actions } = useProjectActionList(root);
  const shell = actions.filter((a) => a.type === 'shell');
  const [text, setText] = useState(() => value.join(', '));
  if (!root || shell.length === 0) {
    return (
      <>
        <input
          id={id}
          value={text}
          placeholder="Test, Lint"
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.split(',').map((a) => a.trim()).filter(Boolean));
          }}
          className={`w-full ${FIELD} border-edge font-mono placeholder:text-faint`}
          data-pipeline-actions-text
        />
        <p className="mt-1.5 text-meta text-muted">{root ? 'This project has no shell actions yet. Type the names of the actions to run, separated by commas.' : 'Type the names of the project actions to run, separated by commas.'} They run in the run’s folder before Claude starts, and their results go in the prompt.</p>
      </>
    );
  }
  const names = new Set(shell.map((a) => a.name));
  const toggle = (name: string, on: boolean) => onChange(on ? [...value.filter((n) => n !== name), name] : value.filter((n) => n !== name));
  return (
    <>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5" data-pipeline-actions>
        {[...shell.map((a) => a.name), ...value.filter((n) => !names.has(n))].map((name) => {
          const on = value.includes(name);
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(name, !on)}
              className={`h-7 rounded-md border px-2.5 text-ui ${on ? 'border-accent-ink bg-accent/15 font-semibold text-text' : 'border-edge text-muted hover:bg-border/45 hover:text-text'} ${names.has(name) ? '' : 'italic'}`}
              data-pipeline-action-pick={name}
            >
              {name}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-meta text-muted">They run in the run’s folder before Claude starts, in the order ticked, and their results go in the prompt.</p>
    </>
  );
}

function PushFields({ form, index, step, onChange }: { form: PipelineForm; index: number; step: PushForm; onChange(form: PipelineForm): void }) {
  const id = useId();
  const patch = (p: Partial<PushForm>) => onChange(updateStep(form, index, p));
  const pr = step.pullRequest;
  return (
    <div className="grid gap-3">
      <Row label="Does" labelId={`${id}-does`}>
        <div className="grid gap-2">
          <Checkbox checked={step.commit} onChange={(commit) => patch({ commit })} dataAttrs={{ 'data-pipeline-push-commit': true }}>
            <span className="text-ui text-text">Commit what the steps changed first</span>
          </Checkbox>
          <Checkbox checked={pr !== null} onChange={(on) => patch({ pullRequest: on ? { base: null, draft: false } : null })} dataAttrs={{ 'data-pipeline-push-pr': true }}>
            <span className="text-ui text-text">Open a pull request</span>
          </Checkbox>
        </div>
      </Row>
      {pr && (
        <Row label="Pull request" htmlFor={`${id}-base`}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-ui text-muted">
              Into
              <input
                id={`${id}-base`}
                value={pr.base ?? ''}
                placeholder="the default branch"
                onChange={(e) => patch({ pullRequest: { ...pr, base: e.target.value || null } })}
                className={`w-48 ${FIELD} border-edge font-mono placeholder:text-faint`}
                data-pipeline-push-base
              />
            </label>
            <Checkbox checked={pr.draft} onChange={(draft) => patch({ pullRequest: { ...pr, draft } })} dataAttrs={{ 'data-pipeline-push-draft': true }}>
              <span className="text-ui text-text">As a draft</span>
            </Checkbox>
          </div>
        </Row>
      )}
    </div>
  );
}
