import {
  DEFAULT_STATE_LABELS,
  defaultTriggerName,
  effectiveMaxAtOnce,
  eventRef,
  TRIGGER_LIMITS,
  triggerProblem,
  triggerSessionTitle,
  type Effort,
  type PermissionMode,
  type PipelineRunStatus,
  type ProjectDefaults,
  type StateLabels,
  type Trigger,
  type TriggerEvent,
  type TriggerSave,
  type TriggerSource,
  type TriggerStart,
  type WorktreeBase,
} from '@switchboard/protocol/client';

// Event triggers (#180) in the window: the editor's form and its rules, and the words the Triggers tab and Upcoming
// show. Without React or the stores, so they are tested on their own.

/** Which issues an issues trigger picks up: those with a label, those assigned to you (or someone), or both. */
export type WhichIssues = 'label' | 'assignee' | 'both';
export const WHICH_ISSUES: ReadonlyArray<{ value: WhichIssues; label: string }> = [
  { value: 'label', label: 'Label' },
  { value: 'assignee', label: 'Assigned to me' },
  { value: 'both', label: 'Label and assigned to me' },
];

/** The sources the editor shows; phase 2's are there, but can't be picked yet. */
export const TRIGGER_SOURCES = [
  { kind: 'ci', title: 'CI fails on a branch', detail: 'A failed workflow run', soon: false },
  { kind: 'issues', title: 'Issues for you', detail: 'Matches a label, you, or both', soon: false },
  { kind: 'changes', title: 'Changes requested', detail: 'On a pull request a session opened', soon: true },
  { kind: 'command', title: 'A command', detail: 'Each new JSON line it prints', soon: true },
] as const;

/** What the editor holds while you change it. */
export interface TriggerForm {
  id: string | null;
  projectRoot: string;
  name: string;
  /** The name follows the source until you type one. */
  nameTouched: boolean;
  kind: 'ci' | 'issues';
  branch: string;
  /** Empty: every workflow. */
  workflows: string[];
  which: WhichIssues;
  label: string;
  /** `@me`, or a login. */
  assignee: string;
  collaboratorsOnly: boolean;
  stateLabels: StateLabels;
  assignOnPickUp: boolean;
  prompt: string;
  /** What each event starts: a session, or a run of `pipelineId` with the event as its task (#185). */
  start: 'session' | 'pipeline';
  /** The pipeline picked; kept while you switch to a session, so switching back finds it. */
  pipelineId: string | null;
  /** A pipeline's runs go on without stopping for you: plans approved, steps that wait started, questions decided. */
  unattended: boolean;
  /** A pipeline's Push opens the pull request without waiting for you. */
  autoPush: boolean;
  profileId: string | null;
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
  workspace: 'current' | 'worktree';
  baseRef: WorktreeBase;
  maxAtOnce: number;
  maxWaiting: number;
  intervalMinutes: number;
  paused: boolean;
}

/** The prompts a new trigger starts with, per source. */
export const DEFAULT_PROMPTS = {
  ci: 'CI failed on {{event.branch}} in {{event.workflow}} ({{event.url}}). Find the cause and fix it. Run the failing test locally if you can. Don’t push.',
  issues: 'Work on {{event.title}} ({{event.url}}). Read the issue first, ask me if something is unclear, then open a pull request that closes it.',
} as const;

/** The tasks a pipeline gets, per source: its steps say how (plan, build, check), and its Push step opens the pull request. */
export const DEFAULT_TASKS = {
  ci: 'CI failed on {{event.branch}} in {{event.workflow}} ({{event.url}}). Find the cause and fix it.',
  issues: 'Work on {{event.title}} ({{event.url}}).',
} as const;

/** The prompt a new trigger starts with for a source and what it starts. */
export const defaultPrompt = (kind: 'ci' | 'issues', start: 'session' | 'pipeline') => (start === 'pipeline' ? DEFAULT_TASKS[kind] : DEFAULT_PROMPTS[kind]);

/** Which pipeline a trigger starts, of the project's: the one picked, while the project can still run it. */
export const formPipeline = <P extends { id: string }>(form: Pick<TriggerForm, 'start' | 'pipelineId'>, pipelines: readonly P[]): P | null => (form.start === 'pipeline' ? (pipelines.find((p) => p.id === form.pipelineId) ?? null) : null);

/** A mode a trigger may run in: never bypass permissions. */
const safeMode = (mode: PermissionMode | null | undefined): PermissionMode => (mode && mode !== 'bypassPermissions' ? mode : 'default');

/**
 * A new trigger's form: the issues source, the project's defaults (its own, else its profile's) for what sessions run
 * with, and a worktree when the project sets nothing, so more than one can run. `from` is New session's prompt and
 * choices (Start ▾ › Start when…).
 */
export function newTriggerForm(projectRoot: string, defaults: ProjectDefaults | null | undefined, from: Partial<Pick<TriggerForm, 'prompt' | 'profileId' | 'model' | 'effort' | 'permissionMode' | 'workspace' | 'baseRef' | 'start' | 'pipelineId'>> = {}): TriggerForm {
  const start = from.start ?? 'session';
  return {
    id: null,
    projectRoot,
    name: defaultTriggerName({ kind: 'issues', label: 'switchboard', assignee: '@me', collaboratorsOnly: true }),
    nameTouched: false,
    kind: 'issues',
    branch: '',
    workflows: [],
    which: 'both',
    label: 'switchboard',
    assignee: '@me',
    collaboratorsOnly: true,
    stateLabels: { on: true, ...DEFAULT_STATE_LABELS },
    assignOnPickUp: false,
    prompt: from.prompt?.trim() || defaultPrompt('issues', start),
    start,
    pipelineId: from.pipelineId ?? null,
    unattended: false,
    autoPush: false,
    profileId: from.profileId ?? null,
    model: from.model ?? defaults?.model ?? null,
    effort: from.effort ?? defaults?.effort ?? null,
    permissionMode: safeMode(from.permissionMode ?? defaults?.permissionMode),
    workspace: from.workspace ?? defaults?.workspace ?? 'worktree',
    baseRef: from.baseRef ?? defaults?.baseRef ?? 'fresh',
    maxAtOnce: 3,
    maxWaiting: 10,
    intervalMinutes: 5,
    paused: false,
  };
}

/** A stored trigger as the editor's form (Edit…). */
export function triggerForm(trigger: Trigger): TriggerForm {
  const source = trigger.source;
  const issues = source.kind === 'issues' ? source : null;
  return {
    id: trigger.id,
    projectRoot: trigger.projectRoot,
    name: trigger.name,
    nameTouched: true,
    kind: source.kind,
    branch: source.kind === 'ci' ? (source.branch ?? '') : '',
    workflows: source.kind === 'ci' ? source.workflows : [],
    which: issues?.label && issues.assignee ? 'both' : issues?.assignee ? 'assignee' : 'label',
    label: issues?.label ?? 'switchboard',
    assignee: issues?.assignee ?? '@me',
    collaboratorsOnly: issues?.collaboratorsOnly ?? true,
    stateLabels: trigger.stateLabels,
    assignOnPickUp: trigger.assignOnPickUp,
    prompt: trigger.prompt,
    start: trigger.start?.kind ?? 'session',
    pipelineId: trigger.start?.kind === 'pipeline' ? trigger.start.pipelineId : null,
    unattended: trigger.start?.kind === 'pipeline' && trigger.start.unattended,
    autoPush: trigger.start?.kind === 'pipeline' && trigger.start.autoPush,
    profileId: trigger.draft.profileId,
    model: trigger.draft.model,
    effort: trigger.draft.effort,
    permissionMode: trigger.draft.permissionMode,
    workspace: trigger.draft.workspace,
    baseRef: trigger.draft.baseRef,
    maxAtOnce: trigger.maxAtOnce,
    maxWaiting: trigger.maxWaiting,
    intervalMinutes: trigger.intervalMinutes,
    paused: trigger.paused,
  };
}

/** The source a form describes. */
export function formSource(form: TriggerForm): TriggerSource {
  if (form.kind === 'ci') return { kind: 'ci', branch: form.branch.trim() || null, workflows: form.workflows };
  return {
    kind: 'issues',
    label: form.which === 'assignee' ? null : form.label.trim() || null,
    assignee: form.which === 'label' ? null : form.assignee.trim() || null,
    collaboratorsOnly: form.collaboratorsOnly,
  };
}

/**
 * Changes a form; the name follows the source while you haven't typed one, the folder holds `maxAtOnce` at 1, and the
 * source's prompt replaces the other source's while it is still the one a new trigger starts with.
 */
export function updateForm(form: TriggerForm, patch: Partial<TriggerForm>, defaultBranch: string | null = null): TriggerForm {
  const next = { ...form, ...patch };
  // The prompt follows the source and what it starts while it is still the one a new trigger starts with.
  if ((next.kind !== form.kind || next.start !== form.start) && form.prompt === defaultPrompt(form.kind, form.start)) next.prompt = defaultPrompt(next.kind, next.start);
  if (!next.nameTouched) next.name = defaultTriggerName(formSource(next), defaultBranch);
  // Sessions in the project's folder run one at a time; a pipeline run makes its own worktree.
  const inFolder = (f: TriggerForm) => f.start === 'session' && f.workspace === 'current';
  if (inFolder(next)) next.maxAtOnce = 1;
  else if (inFolder(form) && next.maxAtOnce === 1) next.maxAtOnce = 3;
  return next;
}

/** Why the form can't be saved, in words for the editor; null when it is fine. */
export function formProblem(form: TriggerForm): string | null {
  if (form.kind === 'issues' && (form.which === 'label' || form.which === 'both') && !form.label.trim()) return 'Type the label to look for.';
  if (form.kind === 'issues' && form.which !== 'label' && !form.assignee.trim()) return 'Pick who the issues are assigned to.';
  if (form.kind === 'issues' && form.stateLabels.on && Object.values({ w: form.stateLabels.working, n: form.stateLabels.needsInput, p: form.stateLabels.prOpen, f: form.stateLabels.failed }).some((l) => !l.trim())) return 'Give every state label a name.';
  return triggerProblem({ name: form.name, prompt: form.prompt, source: formSource(form), draft: { permissionMode: form.permissionMode }, start: formStart(form) });
}

/** What the trigger starts, as saved: a session, or the pipeline picked (empty until one is, which `formProblem` says). */
export const formStart = (form: Pick<TriggerForm, 'start' | 'pipelineId' | 'unattended' | 'autoPush'>): TriggerStart =>
  form.start === 'pipeline' ? { kind: 'pipeline', pipelineId: form.pipelineId ?? '', unattended: form.unattended, autoPush: form.autoPush } : { kind: 'session' };

/** What `triggers.save` gets from a form. */
export function formToSave(form: TriggerForm): TriggerSave {
  const ci = form.kind === 'ci';
  return {
    ...(form.id ? { id: form.id } : {}),
    projectRoot: form.projectRoot,
    name: form.name.trim(),
    source: formSource(form),
    prompt: form.prompt.trim(),
    start: formStart(form),
    draft: { profileId: form.profileId, model: form.model, effort: form.effort, permissionMode: safeMode(form.permissionMode) as Exclude<PermissionMode, 'bypassPermissions'>, workspace: form.workspace, baseRef: form.baseRef },
    maxAtOnce: form.start === 'session' && form.workspace === 'current' ? 1 : clamp(form.maxAtOnce, TRIGGER_LIMITS.atOnce),
    maxWaiting: clamp(form.maxWaiting, TRIGGER_LIMITS.waiting),
    intervalMinutes: clamp(form.intervalMinutes, TRIGGER_LIMITS.interval),
    // State labels are for issues only; Assign to me for a label alone, since with an assignee every issue has one.
    stateLabels: ci ? { ...form.stateLabels, on: false } : form.stateLabels,
    assignOnPickUp: !ci && form.which === 'label' && form.assignOnPickUp,
    paused: form.paused,
  };
}

const clamp = (n: number, limit: { min: number; max: number }) => Math.min(limit.max, Math.max(limit.min, Math.round(n)));

/**
 * The warning a label-only trigger gets on a repository more people work on: everyone's labelled issues would start
 * here. Null with an assignee in the filter, or when the repository has one collaborator (or gh can't tell).
 */
export function sharedRepoWarning(form: Pick<TriggerForm, 'kind' | 'which' | 'label'>, repo: string | null, collaborators: number | null): string | null {
  if (form.kind !== 'issues' || form.which !== 'label' || !repo || collaborators === null || collaborators <= 1) return null;
  return `${repo} has ${collaborators} collaborators. Everyone's ${form.label.trim() || 'labelled'} issues will start here. Use Assigned to me, turn on state labels, or Assign to me when picked up.`;
}

/** The footer's line: what the first check does. */
export const firstCheckLine = (kind: 'ci' | 'issues') => (kind === 'ci' ? 'Failures from before now are marked as seen.' : 'Issues that match now are marked as seen. Only new ones start a session.');

/** "checked 2m ago", "checked now", "not checked yet". */
export function checkedLine(at: number | null, now: number): string {
  if (at === null) return 'not checked yet';
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return 'checked now';
  if (diff < 3_600_000) return `checked ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `checked ${Math.floor(diff / 3_600_000)}h ago`;
  return `checked ${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * What Check now found, for its toast: new events, nothing new, or why the check didn't work. `ok` when it worked.
 * `found` is null when the engine didn't count (one from before the count, still running after the window reloaded).
 */
export function checkedNowLine(trigger: Pick<Trigger, 'name' | 'source' | 'paused' | 'pausedReason' | 'failures' | 'lastError' | 'blockedUntil'>, found: number | null, now: number): { text: string; ok: boolean } {
  if (trigger.paused) return { text: `${trigger.name}: ${pausedLine(trigger)}`, ok: false };
  if (trigger.blockedUntil !== null && trigger.blockedUntil > now) {
    return { text: `GitHub asked to slow down. ${trigger.name} checks again after ${new Date(trigger.blockedUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`, ok: false };
  }
  if (trigger.failures > 0) return { text: `Couldn't check ${trigger.name}: ${trigger.lastError ?? 'unknown reason'}.`, ok: false };
  if (found === null) return { text: `Checked ${trigger.name}.`, ok: true };
  if (found === 0) return { text: `Checked ${trigger.name}. Nothing new.`, ok: true };
  const what = trigger.source.kind === 'ci' ? (found === 1 ? 'failed run' : 'failed runs') : found === 1 ? 'issue' : 'issues';
  return { text: `Checked ${trigger.name}. ${found} new ${what}.`, ok: true };
}

/** Where the work on a started event is, from its session or pipeline run: working, waiting for you, or finished. */
export type EventSessionState = 'working' | 'needs-you' | 'finished';

/**
 * Where a pipeline run is, as an event's state: a step works (or it waits for a slot, or for the next start), it waits
 * for you (a stop, a step to confirm, Push), or it ended. A run that is gone counts as finished.
 */
export function runEventState(status: PipelineRunStatus | null): EventSessionState {
  if (status === 'running' || status === 'paused') return 'working';
  if (status === 'waiting') return 'needs-you';
  return 'finished';
}

/** The events a card shows, newest first, waiting ones before the rest. */
export function cardEvents(events: readonly TriggerEvent[]): TriggerEvent[] {
  const rank = (e: TriggerEvent) => (e.status === 'started' || e.status === 'queued' ? 0 : e.status === 'waiting' ? 1 : 2);
  return [...events].sort((a, b) => rank(a) - rank(b) || (a.status === 'waiting' && b.status === 'waiting' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
}

/** How many of a trigger's sessions are busy, and how many events wait. */
export function triggerCounts(trigger: Pick<Trigger, 'maxAtOnce' | 'draft'>, events: readonly TriggerEvent[], busy: (event: TriggerEvent) => boolean) {
  return {
    busy: events.filter(busy).length,
    max: effectiveMaxAtOnce(trigger),
    waiting: events.filter((e) => e.status === 'waiting').length,
    skipped: events.filter((e) => e.status === 'skipped').length,
  };
}

/** The pill after a trigger's name: "2 of 3 busy", "1 waiting", "Paused", or nothing. */
export function statusPill(trigger: Pick<Trigger, 'paused'>, counts: { busy: number; max: number; waiting: number }): { text: string; tone: 'working' | 'muted' | 'caution' } | null {
  if (trigger.paused) return { text: 'Paused', tone: 'caution' };
  if (counts.busy > 0) return { text: `${counts.busy} of ${counts.max} busy`, tone: 'working' };
  if (counts.waiting > 0) return { text: `${counts.waiting} waiting`, tone: 'muted' };
  return null;
}

/** Why a trigger is paused, as its card says it. */
export function pausedLine(trigger: Pick<Trigger, 'paused' | 'pausedReason' | 'failures'>): string | null {
  if (!trigger.paused) return null;
  if (!trigger.pausedReason) return 'Paused by you.';
  const reason = trigger.pausedReason.replace(/\.$/, '');
  return trigger.failures >= 5 ? `Paused after ${trigger.failures} failed checks: ${reason}.` : /^imported/i.test(reason) ? `${reason}.` : `Paused: ${reason}.`;
}

/** The second line of an event row: what it is, and where it stands. */
export function eventDetail(event: TriggerEvent, now: number, extra: { position?: number; of?: number } = {}): string {
  const at = clock(event.startedAt ?? event.createdAt, now);
  const what = event.kind === 'ci' ? [eventRef(event), event.fields.commit ? `commit ${event.fields.commit}` : null, at] : ['issue'];
  switch (event.status) {
    case 'waiting':
      return [...what.slice(0, event.kind === 'ci' ? 2 : 1), `waiting for a slot${extra.position ? ` · ${extra.position} of ${extra.of}` : ''}`].filter(Boolean).join(' · ');
    case 'queued':
      return [...what, `in the queue: ${event.reason ?? 'a limit holds it'}`].filter(Boolean).join(' · ');
    case 'skipped':
      return `skipped: ${event.reason ?? 'no reason'}`;
    case 'replaced':
      return `replaced: ${event.reason ?? 'a newer failure took its place'}`;
    case 'started':
      return event.kind === 'ci' ? what.filter(Boolean).join(' · ') : `issue · picked up ${at}`;
  }
}

/** "#214 Archive keeps the scroll position", or "Fix test on main" for a run: the title its session gets. */
export const eventTitle = (event: TriggerEvent): string => triggerSessionTitle(event);

/** For screen readers: "Issue 214, Archive keeps the scroll position, waiting for a slot, 1 of 10". */
export function speakEvent(event: TriggerEvent, state: EventSessionState | null, extra: { position?: number; of?: number } = {}): string {
  const what = event.kind === 'issue' ? `Issue ${event.fields.number ?? ''}, ${event.title}` : `${event.fields.workflow || 'CI'} failed on ${event.fields.branch || 'the branch'}, run ${event.fields.number || event.fields.run || ''}`;
  const where =
    event.status === 'waiting'
      ? `waiting for a slot${extra.position ? `, ${extra.position} of ${extra.of}` : ''}`
      : event.status === 'started'
        ? state === 'working'
          ? 'working'
          : state === 'needs-you'
            ? 'needs you'
            : 'finished'
        : event.status === 'queued'
          ? 'in the queue'
          : `${event.status}, ${event.reason ?? ''}`.replace(/, $/, '');
  return `${what}, ${where}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "14:02" today, "yesterday", else the day. */
export function clock(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const days = Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
  if (days === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 1) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Any workflow" or "CI, Lint", for a CI trigger's meta line. */
export const workflowsLine = (workflows: readonly string[]) => (workflows.length ? workflows.join(', ') : 'Any workflow');
