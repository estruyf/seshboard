import { AlertTriangle, CircleDot, CircleX, Folder, GitBranch, ListTree, MessageSquareDiff, Pencil, SquareTerminal, Zap } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { BUILT_IN_PIPELINES, pipelineProblem, STATE_LABEL_KEYS, TRIGGER_LIMITS, type StateLabelKey, type TriggerRepoInfo } from '@switchboard/protocol/client';
import { modelLabel } from '../../lib/autoModel.ts';
import { basename } from '../../lib/format.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { pipelinesFor } from '../../state/pipelines.ts';
import { usePipelines } from '../../state/pipelinesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import {
  firstCheckLine,
  formPipeline,
  formProblem,
  formToSave,
  initialFolds,
  keptFolds,
  limitsLine,
  newTriggerForm,
  problemSection,
  sectionNumber,
  sharedRepoWarning,
  TRIGGER_SOURCES,
  triggerForm,
  triggerSummary,
  updateForm,
  WHICH_ISSUES,
  type TriggerForm,
  type TriggerSection,
} from '../../state/triggers.ts';
import { closeTriggerEditor, loadRepoInfo, saveTrigger, useTriggers, type TriggerEditorRequest } from '../../state/triggersStore.ts';
import { globalMode, layeredDefaults } from '../newSession/choices.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Select } from '../ui/Select.tsx';
import { Stepper } from '../ui/Stepper.tsx';
import { TriggerPromptField } from './TriggerPromptField.tsx';

const FIELD = 'h-8 rounded-md border bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';
const CHIP = 'h-7 rounded-md border border-edge bg-transparent px-2 text-ui text-text hover:bg-border/45';

/** The editor, wherever it was asked for: the Triggers tab, the palette, New session's Start ▾ › Start when…. */
export function TriggerEditorHost() {
  const request = useTriggers((s) => s.editor);
  if (!request) return null;
  // Keyed, so another request starts from its own form.
  return <TriggerEditor key={`${request.root}:${request.trigger?.id ?? 'new'}`} request={request} onClose={closeTriggerEditor} />;
}

/** A field with its small label above it. `labelId` for a group the label names (chips, a select with its login). */
function Field({ label, htmlFor, labelId, children, className = '' }: { label: string; htmlFor?: string; labelId?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`grid min-w-0 content-start gap-1 ${className}`}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-meta text-muted">
          {label}
        </label>
      ) : (
        <span id={labelId} className="text-meta text-muted">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * One numbered card, titled with the question it answers. Folded, it is one line (`folded`) with Change, which opens it
 * and moves focus to its first control.
 */
function Section({ section, number, title, aside, folded, onOpen, children }: { section: TriggerSection; number: number; title: string; aside?: ReactNode; folded?: string | null; onOpen?(): void; children: ReactNode }) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const opening = useRef(false);
  const isFolded = !!folded;
  useEffect(() => {
    if (isFolded || !opening.current) return;
    opening.current = false;
    body.current?.querySelector<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea')?.focus();
  }, [isFolded]);
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-edge bg-card" data-trigger-section={section} data-folded={isFolded || undefined}>
      <div className="flex min-h-11 items-center gap-2.5 px-4 py-2.5">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-meta font-semibold text-on-accent">
          {number}
        </span>
        <h3 id={`${id}-title`} className="shrink-0 text-body font-semibold text-text">
          {title}
        </h3>
        {folded ? (
          <>
            <span className="min-w-0 flex-1 truncate text-ui text-muted" data-trigger-section-line>
              {folded}
            </span>
            <Button
              size="sm"
              aria-expanded={false}
              aria-controls={`${id}-body`}
              onClick={() => {
                opening.current = true;
                onOpen?.();
              }}
              data-trigger-section-change={section}
            >
              Change
            </Button>
          </>
        ) : (
          aside && <span className="text-meta text-muted">{aside}</span>
        )}
      </div>
      <div ref={body} id={`${id}-body`} hidden={isFolded} className="grid gap-3.5 border-t border-edge px-4 pt-3 pb-4">
        {children}
      </div>
    </section>
  );
}

/** A source's icon on its tile, in its colour: CI in `error`, issues in `ok`, the rest muted. */
export function SourceIcon({ kind, size = 30 }: { kind: 'ci' | 'issues' | 'changes' | 'command'; size?: number }) {
  const tone = kind === 'ci' ? 'bg-error/12 text-error' : kind === 'issues' ? 'bg-ok/12 text-ok' : kind === 'changes' ? 'bg-caution/12 text-caution' : 'bg-link/12 text-link';
  const icon = kind === 'ci' ? <CircleX size={size * 0.5} aria-hidden /> : kind === 'issues' ? <CircleDot size={size * 0.5} aria-hidden /> : kind === 'changes' ? <MessageSquareDiff size={size * 0.5} aria-hidden /> : <SquareTerminal size={size * 0.5} aria-hidden />;
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-lg ${tone}`} style={{ width: size, height: size }} aria-hidden>
      {icon}
    </span>
  );
}

/**
 * New trigger or Edit trigger, for a project: its name in the title, a sentence that says what it will do, and five
 * numbered sections: when it starts (the source, as four cards; Changes requested and A command come later), which
 * issues or runs, what it does on GitHub (issues only), what it starts (the prompt with its event fields and what the
 * sessions run with), and its limits. GitHub and Limits fold to one line while they hold nothing new. Bypass
 * permissions is never offered.
 */
function TriggerEditor({ request, onClose }: { request: TriggerEditorRequest; onClose(): void }) {
  const id = useId();
  const project = useProjects((s) => s.projects.get(request.root));
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  const profileDefaults = profiles.find((p) => p.id === (project?.profileId ?? defaultProfile))?.defaults ?? null;
  const globalSetting = usePreferences((s) => s.prefs.newSessionMode);
  // The project's and profile's defaults, and the global permission mode where neither sets one (never the mode picked
  // last: a trigger's sessions start on their own).
  const defaults = useMemo(() => {
    const layered = layeredDefaults(project?.defaults, profileDefaults);
    const permissionMode = layered?.permissionMode ?? globalMode(globalSetting, null);
    return { model: null, effort: null, workspace: null, baseRef: null, branch: null, defaultBranch: null, ...layered, permissionMode };
  }, [project?.defaults, profileDefaults, globalSetting]);
  const models = useHosts((s) => s.models);
  const [form, setForm] = useState<TriggerForm>(() => (request.trigger ? triggerForm(request.trigger) : newTriggerForm(request.root, defaults, request.from)));
  const [info, setInfo] = useState<TriggerRepoInfo | null>(() => useTriggers.getState().repoInfo.get(request.root) ?? null);
  const [renaming, setRenaming] = useState(false);
  const [otherAssignee, setOtherAssignee] = useState(() => form.assignee !== '@me');
  const [folded, setFolded] = useState(() => initialFolds(form));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRepoInfo(request.root).then(
      (next) => {
        if (cancelled) return;
        setInfo(next);
        // A new CI trigger's name says the default branch once it is known.
        setForm((current) => updateForm(current, {}, next.defaultBranch));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [request.root]);

  const update = (patch: Partial<TriggerForm>) => setForm((current) => updateForm(current, patch, info?.defaultBranch ?? null));
  // What it can start (#185): the project's pipelines, and a built-in it starts already while the built-ins are hidden.
  const allPipelines = usePipelines((s) => s.pipelines);
  const pipelines = useMemo(() => {
    const own = pipelinesFor(allPipelines, request.root);
    const hidden = form.pipelineId && !own.some((p) => p.id === form.pipelineId) ? BUILT_IN_PIPELINES.find((p) => p.id === form.pipelineId) : undefined;
    return hidden ? [...own, hidden] : own;
  }, [allPipelines, request.root, form.pipelineId]);
  const pipeline = formPipeline(form, pipelines);
  const startsPipeline = form.start === 'pipeline';
  const problem = formProblem(form) ?? (startsPipeline && form.pipelineId ? pipelineProblem(pipeline, request.root) : null);
  const warning = sharedRepoWarning(form, info?.repo ?? null, info?.collaborators ?? null);
  // Sessions in the project's folder run one at a time; a pipeline run makes a worktree of its own.
  const folder = !startsPipeline && form.workspace === 'current';
  const atOnce = folder ? 1 : form.maxAtOnce;
  const unit = (n: number) => (startsPipeline ? (n === 1 ? 'run' : 'runs') : n === 1 ? 'session' : 'sessions');
  const issues = form.kind === 'issues';
  const login = info?.login ?? null;
  const summary = triggerSummary(form, { defaultBranch: info?.defaultBranch ?? null, login, pipelineName: pipeline?.name ?? null });

  // A section opens for good once it holds more than its line says, or has the problem (a pipeline's is in 4).
  const folds = keptFolds(folded, form, problemSection(form) ?? (problem ? 'start' : null));
  useEffect(() => {
    if (folds !== folded) setFolded(folds);
  }, [folds, folded]);
  const open = (section: TriggerSection) => setFolded(new Set([...folds].filter((s) => s !== section)));

  const save = async () => {
    setTried(true);
    if (problem || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTrigger(formToSave(form));
      request.onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Invalid params:?\s*/i, '') : String(e));
      setSaving(false);
    }
  };

  // What the sessions run with, from the project unless changed here.
  const fromProject = !request.trigger && form.model === (defaults?.model ?? null) && form.permissionMode === (defaults?.permissionMode && defaults.permissionMode !== 'bypassPermissions' ? defaults.permissionMode : 'default') && form.workspace === (defaults?.workspace ?? 'worktree');
  const profileId = form.profileId ?? project?.profileId ?? defaultProfile;
  const assigneeOptions = [
    { value: '@me', label: login ? `@${login}` : '@me' },
    ...(otherAssignee ? [{ value: 'other', label: form.assignee && form.assignee !== '@me' ? `@${form.assignee}` : 'Someone else' }] : []),
    ...(!otherAssignee ? [{ value: 'other', label: 'Someone else…' }] : []),
  ];
  const number = (section: TriggerSection) => sectionNumber(form.kind, section);

  return (
    <Dialog
      title={
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0">{request.trigger ? 'Edit trigger:' : 'New trigger:'}</span>
          {/* The name, edited in place; it follows the source until you type one. */}
          <label className={`inline-flex min-w-0 cursor-text items-center gap-1.5 border-b border-dashed ${tried && !form.name.trim() ? 'border-error' : 'border-faint focus-within:border-accent-ink'}`}>
            <input
              aria-label="Trigger name"
              value={form.name}
              maxLength={200}
              placeholder="Name"
              onChange={(e) => update({ name: e.target.value, nameTouched: true })}
              className="field-sizing-content min-w-16 max-w-[min(26rem,50vw)] bg-transparent font-semibold text-text outline-none placeholder:font-normal placeholder:text-faint"
              data-trigger-name
            />
            <Pencil size={12} className="shrink-0 text-faint" aria-hidden />
          </label>
          <span className="min-w-0 truncate font-normal text-muted">· {project?.name ?? basename(request.root)}</span>
        </span>
      }
      icon={<Zap size={16} className="text-trigger" aria-hidden />}
      width="lg"
      flush
      onClose={onClose}
      onSubmit={() => void save()}
      initialFocus={firstRef}
      footerStart={<span className="text-meta text-muted" data-trigger-first-check>{firstCheckLine(form.kind)}</span>}
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={saving || (tried && !!problem)} onClick={() => void save()} data-trigger-save>
            {request.trigger ? 'Save' : 'Create trigger'}
          </Button>
        </>
      }
      data-trigger-editor={request.trigger?.id ?? 'new'}
    >
      {/* The summary stays put while the sections scroll, unless the window is short. */}
      <div className="shrink-0 px-5 pt-4">
        <p aria-live="polite" className="rounded-lg border border-accent-ink/30 bg-accent/10 px-3 py-2 text-body text-text" data-trigger-summary>
          {summary.map((part, i) =>
            part.bold ? (
              <strong key={i} className="font-semibold">
                {part.text}
              </strong>
            ) : (
              <Fragment key={i}>{part.text}</Fragment>
            ),
          )}
        </p>
      </div>
      {/* Under 700px tall this stops scrolling on its own, so the summary scrolls away with it. */}
      <div className="@container grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-5 pt-3 pb-4 [@media(max-height:699px)]:flex-none [@media(max-height:699px)]:overflow-visible">
        <Section section="when" number={number('when')} title="When should it start?">
          <RadioGroup label="When should it start?" className="grid grid-cols-2 gap-2 @max-[640px]:grid-cols-1">
            {TRIGGER_SOURCES.map((source, i) => {
              const checked = !source.soon && form.kind === source.kind;
              return (
                <button
                  key={source.kind}
                  ref={i === 0 ? firstRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-disabled={source.soon || undefined}
                  aria-describedby={source.soon ? `${id}-soon` : undefined}
                  tabIndex={checked ? 0 : -1}
                  // A disabled card stays in the group for screen readers, but the arrow keys skip it.
                  disabled={source.soon}
                  onClick={() => {
                    if (!source.soon && (source.kind === 'ci' || source.kind === 'issues')) update({ kind: source.kind });
                  }}
                  className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left ${checked ? 'border-accent-ink ring-1 ring-accent-ink/40' : 'border-edge hover:bg-border/45'} disabled:cursor-default disabled:hover:bg-transparent`}
                  data-trigger-source={source.kind}
                >
                  <SourceIcon kind={source.kind} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex items-center gap-2 text-ui font-semibold text-text">
                      {source.title}
                      {source.soon && <span className="rounded-md bg-border/70 px-1.5 text-meta font-medium text-muted">Soon</span>}
                    </span>
                    <span className="truncate text-meta text-muted">{source.detail}</span>
                  </span>
                </button>
              );
            })}
          </RadioGroup>
          <span id={`${id}-soon`} className="sr-only">
            Coming later
          </span>
          {info?.problem && (
            <Notice tone="caution" icon={<AlertTriangle size={14} aria-hidden />} data-trigger-gh-problem>
              {info.problem}. Triggers check GitHub through gh on this computer.
            </Notice>
          )}
        </Section>

        <Section section="which" number={number('which')} title={issues ? 'Which issues?' : 'Which runs?'}>
          {form.kind === 'ci' ? (
            <div className="flex flex-wrap gap-x-4 gap-y-3">
              <Field label="Branch" htmlFor={`${id}-branch`}>
                <div className="relative w-64">
                  <input
                    id={`${id}-branch`}
                    value={form.branch}
                    placeholder={info?.defaultBranch ?? 'the default branch'}
                    onChange={(e) => update({ branch: e.target.value })}
                    className={`w-full ${FIELD} border-edge pr-16 font-mono`}
                    data-trigger-branch
                  />
                  {!form.branch.trim() && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">default</span>}
                </div>
              </Field>
              <Field label="Workflows" labelId={`${id}-workflows`} className="flex-1">
                <div role="group" aria-labelledby={`${id}-workflows`} className="flex flex-wrap gap-1.5" data-trigger-workflows>
                  {['', ...(info?.workflows ?? []), ...form.workflows.filter((w) => !info?.workflows.includes(w))].map((name) => {
                    const on = name === '' ? form.workflows.length === 0 : form.workflows.includes(name);
                    return (
                      <button
                        key={name || 'all'}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update({ workflows: name === '' ? [] : on ? form.workflows.filter((w) => w !== name) : [...form.workflows, name] })}
                        className={`h-7 rounded-md border px-2.5 text-ui ${on ? 'border-accent-ink bg-accent/15 font-semibold text-text' : 'border-edge text-muted hover:bg-border/45 hover:text-text'}`}
                        data-trigger-workflow={name || 'all'}
                      >
                        {name || 'All'}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-0.5 text-meta text-muted">A newer failure of the same workflow replaces one that still waits.</p>
              </Field>
            </div>
          ) : (
            <>
              <SegmentedControl mode="radio" label="Which issues" value={form.which} onChange={(which) => update({ which })} segments={WHICH_ISSUES.map((w) => ({ value: w.value, label: w.label, data: { 'data-trigger-which': w.value } }))} className="w-fit" />
              <div className="flex flex-wrap gap-x-4 gap-y-3">
                {form.which !== 'assignee' && (
                  <Field label="Label" htmlFor={`${id}-label`}>
                    <input
                      id={`${id}-label`}
                      value={form.label}
                      onChange={(e) => update({ label: e.target.value })}
                      maxLength={50}
                      className={`w-56 ${FIELD} ${tried && !form.label.trim() ? 'border-error' : 'border-edge'}`}
                      data-trigger-label
                    />
                  </Field>
                )}
                {form.which !== 'label' && (
                  <Field label="Assigned to" labelId={`${id}-assigned`}>
                    <div role="group" aria-labelledby={`${id}-assigned`} className="flex h-8 flex-wrap items-center gap-2" data-trigger-assigned-field>
                      <Select
                        label="Assigned to"
                        className={CHIP}
                        value={form.assignee === '@me' && !otherAssignee ? '@me' : 'other'}
                        onChange={(value) => {
                          setOtherAssignee(value === 'other');
                          update({ assignee: value === '@me' ? '@me' : form.assignee === '@me' ? '' : form.assignee });
                        }}
                        options={assigneeOptions}
                        dataAttrs={{ 'data-trigger-assignee': true }}
                      />
                      {otherAssignee ? (
                        <input
                          aria-label="GitHub login"
                          placeholder="login"
                          value={form.assignee === '@me' ? '' : form.assignee}
                          onChange={(e) => update({ assignee: e.target.value.replace(/^@/, '') })}
                          className={`w-40 ${FIELD} font-mono ${tried && !form.assignee.trim() ? 'border-error' : 'border-edge'}`}
                          data-trigger-assignee-login
                        />
                      ) : (
                        <span className="text-meta text-muted">{login ? 'signed in to gh' : 'the account gh uses'}</span>
                      )}
                    </div>
                  </Field>
                )}
              </div>
              <Checkbox checked={form.collaboratorsOnly} onChange={(collaboratorsOnly) => update({ collaboratorsOnly })} dataAttrs={{ 'data-trigger-collaborators': true }}>
                <span className="grid gap-0.5">
                  <span className="text-ui text-text">Only from collaborators</span>
                  <span className="text-meta text-muted">Owners, members and collaborators. A bot or template can add a label for anyone, so on a public repository anyone could start a session here.</span>
                </span>
              </Checkbox>
            </>
          )}
          {/* Always there, so the warning is read out when it appears. */}
          <div aria-live="polite" className="empty:hidden">
            {warning && (
              <Notice tone="caution" icon={<AlertTriangle size={14} aria-hidden />} role="note" data-trigger-shared-warning>
                {warning}
              </Notice>
            )}
          </div>
        </Section>

        {issues && (
          <Section section="github" number={number('github')} title="What happens on GitHub?" aside="optional" folded={folds.has('github') ? 'Nothing: no labels, no assignee' : null} onOpen={() => open('github')}>
            <div className="grid gap-1.5">
              <Checkbox checked={form.stateLabels.on} onChange={(on) => update({ stateLabels: { ...form.stateLabels, on } })} dataAttrs={{ 'data-trigger-state-labels': true }}>
                <span className="text-ui text-text">Keep a state label on the issue</span>
              </Checkbox>
              {form.stateLabels.on && (
                <div className="grid gap-1.5 pl-5.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {STATE_LABEL_KEYS.map((key) => (
                      <StateLabelPill key={key} which={key} name={form.stateLabels[key]} />
                    ))}
                    <Button variant="quiet" size="sm" aria-expanded={renaming} onClick={() => setRenaming(!renaming)} data-trigger-rename-labels>
                      Rename
                    </Button>
                  </div>
                  {renaming && (
                    <div className="grid grid-cols-2 gap-1.5 @max-[640px]:grid-cols-1" data-trigger-label-names>
                      {STATE_LABEL_KEYS.map((key) => (
                        <input
                          key={key}
                          aria-label={`${STATE_WORDS[key]} label`}
                          value={form.stateLabels[key]}
                          maxLength={50}
                          onChange={(e) => update({ stateLabels: { ...form.stateLabels, [key]: e.target.value } })}
                          className={`${FIELD} ${tried && !form.stateLabels[key].trim() ? 'border-error' : 'border-edge'}`}
                        />
                      ))}
                    </div>
                  )}
                  <p className="text-meta text-muted">{form.which === 'assignee' ? 'Take the state label off to start an issue again.' : `The ${form.label.trim() || 'trigger'} label comes off when work starts.`} Missing labels are created.</p>
                </div>
              )}
            </div>
            {/* With an assignee in the filter every issue has one already: Assign to me would skip them all. */}
            {form.which === 'label' && (
              <Checkbox checked={form.assignOnPickUp} onChange={(assignOnPickUp) => update({ assignOnPickUp })} dataAttrs={{ 'data-trigger-assign': true }}>
                <span className="grid gap-0.5">
                  <span className="text-ui text-text">Assign the issue to me when work starts</span>
                  <span className="text-meta text-muted">Skips issues that already have an assignee.</span>
                </span>
              </Checkbox>
            )}
          </Section>
        )}

        <Section section="start" number={number('start')} title="What does it start?">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                mode="radio"
                label="Starts"
                value={form.start}
                // The first of the project's pipelines, unless one is picked already.
                onChange={(start) => update({ start, pipelineId: start === 'pipeline' && !pipelines.some((p) => p.id === form.pipelineId) ? (pipelines[0]?.id ?? null) : form.pipelineId })}
                segments={[
                  { value: 'session', label: 'A session', data: { 'data-trigger-starts': 'session' } },
                  { value: 'pipeline', label: 'A pipeline', data: { 'data-trigger-starts': 'pipeline' } },
                ]}
                className="w-fit"
              />
              {startsPipeline &&
                (pipelines.length || form.pipelineId ? (
                  <Select
                    label="Pipeline"
                    className={CHIP}
                    value={form.pipelineId ?? ''}
                    onChange={(pipelineId) => update({ pipelineId: pipelineId || null })}
                    options={[
                      ...(pipeline ? [] : [{ value: form.pipelineId ?? '', label: form.pipelineId ? 'A deleted pipeline' : 'Pick a pipeline', icon: <ListTree size={13} aria-hidden /> }]),
                      ...pipelines.map((p) => ({ value: p.id, label: p.name, icon: <ListTree size={13} className="text-pipeline" aria-hidden /> })),
                    ]}
                    dataAttrs={{ 'data-trigger-pipeline-pick': true }}
                  />
                ) : (
                  <span className="text-meta text-muted">This project has no pipelines yet.</span>
                ))}
            </div>
            <p className="text-meta text-muted">{startsPipeline ? 'Each event starts a run of the pipeline, with the task below. No step bypasses permissions.' : 'Each event starts a session with the prompt.'}</p>
          </div>
          {startsPipeline && (
            <div className="grid gap-2">
              <Checkbox checked={form.unattended} onChange={(unattended) => update({ unattended })} dataAttrs={{ 'data-trigger-unattended': true }}>
                <span className="grid gap-0.5">
                  <span className="text-ui text-text">Run without stopping for me</span>
                  <span className="text-meta text-muted">Plans are approved for you, steps that wait for you start, and Claude decides questions itself. Tool permissions, errors and a failing review still stop the run.</span>
                </span>
              </Checkbox>
              <Checkbox checked={form.autoPush} onChange={(autoPush) => update({ autoPush })} dataAttrs={{ 'data-trigger-auto-push': true }}>
                <span className="grid gap-0.5">
                  <span className="text-ui text-text">Open the pull request without me</span>
                  <span className="text-meta text-muted">Push commits, pushes and opens the pull request when the steps before it are done. Merging stays with you.</span>
                </span>
              </Checkbox>
            </div>
          )}
          <Field label={startsPipeline ? 'Task' : 'Prompt'} htmlFor={`${id}-prompt`}>
            <TriggerPromptField id={`${id}-prompt`} value={form.prompt} onChange={(prompt) => update({ prompt })} kind={form.kind} describedBy={`${id}-prompt-hint`} invalid={tried && !form.prompt.trim()} />
            <p id={`${id}-prompt-hint`} className="mt-0.5 text-meta text-muted">
              {`Type {{ for event fields.${startsPipeline ? ' It fills {{task}} in the steps.' : ''} ${issues ? "The issue's text" : "The failed jobs' log"} goes ${startsPipeline ? 'to the first step' : 'in'} as context to read, not instructions.`}
            </p>
          </Field>
          <Field label="Runs with" labelId={`${id}-runs`}>
            <div role="group" aria-labelledby={`${id}-runs`} className="flex flex-wrap items-center gap-1.5" data-trigger-runs-with>
              {!startsPipeline && (
                <Select
                  label="Workspace"
                  className={CHIP}
                  value={form.workspace}
                  onChange={(workspace) => update({ workspace })}
                  options={[
                    { value: 'worktree', label: 'New worktree', icon: <GitBranch size={13} aria-hidden /> },
                    { value: 'current', label: 'Project folder', icon: <Folder size={13} aria-hidden /> },
                  ]}
                  dataAttrs={{ 'data-trigger-workspace': true }}
                />
              )}
              {profiles.length > 1 && (
                <Select
                  label="Claude profile"
                  className={CHIP}
                  value={profileId}
                  onChange={(value) => update({ profileId: value === (project?.profileId ?? defaultProfile) ? null : value })}
                  options={profiles.map((p) => ({ value: p.id, label: p.name, icon: <span className={`size-2 rounded-full ${PROFILE_DOT[p.color]}`} /> }))}
                  dataAttrs={{ 'data-trigger-profile': true }}
                />
              )}
              {startsPipeline ? (
                // The pipeline's steps set their own model and mode, and the run makes its own worktree.
                <span className="text-meta text-muted">A new worktree. Each step sets its own model and mode.</span>
              ) : (
                <>
                  <Select
                    label="Model"
                    className={CHIP}
                    value={form.model ?? ''}
                    onChange={(value) => update({ model: value || null })}
                    options={[{ value: '', label: 'Default model' }, ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName })), ...(form.model && !models.some((m) => m.value === form.model) ? [{ value: form.model, label: modelLabel(models, form.model) }] : [])]}
                    dataAttrs={{ 'data-trigger-model': true }}
                  />
                  <Select
                    label="Permission mode"
                    className={CHIP}
                    value={form.permissionMode}
                    onChange={(permissionMode) => update({ permissionMode })}
                    // Bypass permissions is left out: a trigger starts work from text other people wrote.
                    options={MODE_CHOICES.map((m) => ({ value: m, label: MODE_LABEL[m], icon: <span className={`size-2 rounded-full ${MODE_DOT[m] ?? 'bg-faint'}`} /> }))}
                    dataAttrs={{ 'data-trigger-mode': true }}
                  />
                  {fromProject && <span className="text-meta text-muted">from the project</span>}
                </>
              )}
            </div>
          </Field>
        </Section>

        <Section section="limits" number={number('limits')} title="Limits" folded={folds.has('limits') ? limitsLine(form) : null} onOpen={() => open('limits')}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui">
            <Stepper
              value={atOnce}
              min={TRIGGER_LIMITS.atOnce.min}
              max={folder ? 1 : TRIGGER_LIMITS.atOnce.max}
              onChange={(maxAtOnce) => update({ maxAtOnce })}
              label={startsPipeline ? 'Runs at a time' : 'Sessions at a time'}
              less="Fewer at once"
              more="More at once"
              disabled={folder}
              hook="trigger-at-once"
            />
            <span className="text-text">{unit(atOnce)} at once</span>
            <span className="text-meta text-muted" data-trigger-folder-note={folder || undefined}>
              {folder ? 'Sessions in the project folder edit the same files, so only one runs at a time.' : startsPipeline ? 'A run counts while a step works or it waits for you.' : 'A session counts while it works or waits for you.'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui">
            <Stepper value={form.maxWaiting} min={TRIGGER_LIMITS.waiting.min} max={TRIGGER_LIMITS.waiting.max} onChange={(maxWaiting) => update({ maxWaiting })} label="Events that may wait" less="Fewer waiting" more="More waiting" hook="trigger-waiting" />
            <span className="text-text">{form.maxWaiting === 1 ? 'event waiting' : 'events waiting'}</span>
            <span className="text-meta text-muted">{form.maxWaiting === 0 ? 'New ones are skipped while all are busy.' : `Oldest first. Past ${form.maxWaiting}, new ones are skipped.`}</span>
          </div>
        </Section>

        {tried && problem && (
          <p className="text-ui text-error" role="alert" data-trigger-problem>
            {problem}
          </p>
        )}
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

const STATE_WORDS: Record<StateLabelKey, string> = { working: 'Working', needsInput: 'Needs input', prOpen: 'Pull request open', failed: 'Failed' };

/** Each state label in the status colour it stands for: working yellow, needs input pink, pull request green, failed red. */
const STATE_PILL: Record<StateLabelKey, string> = {
  working: 'border-accent-ink/50 bg-accent/12 text-accent-ink',
  needsInput: 'border-warn/50 bg-warn/10 text-warn',
  prOpen: 'border-ok/50 bg-ok/10 text-ok',
  failed: 'border-error/50 bg-error/10 text-error',
};

/** A state label as a pill, in the colour of the state it says (GitHub gets the same hues when it is made). */
export function StateLabelPill({ which, name }: { which: StateLabelKey; name: string }) {
  return (
    <span className={`inline-flex h-5.5 items-center rounded-full border px-2 text-meta font-medium ${STATE_PILL[which]}`} data-state-label={which}>
      {name}
    </span>
  );
}
