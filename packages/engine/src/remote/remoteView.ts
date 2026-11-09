import { createHash } from 'node:crypto';
import { skimMarks,
  inheritedDefault,
  inheritedPermissionMode,
  isAbsolutePath,
  listedInMainList,
  type PipelineRunState,
  type RemoteRunState,
  type CatchUp,
  type Effort,
  type PermissionMode,
  type PermissionRequest,
  type ProfileDefaults,
  type ProjectDefaults,
  type RemoteBlock,
  type RemoteMessage,
  type RemotePrompt,
  type RemoteSession,
  type RemoteSessionProfile,
  type RemoteSessionOptions,
  type RemoteSessions,
  type RemoteTriggerOrigin,
  type TriggerSession,
  type SessionHostInfo,
  type TranscriptBlock,
  type TranscriptMessage,
  type RemoteUsageBreakdown,
  type UsageBreakdown,
  type WorktreeBase,
  otherProviderOf,
} from '@seshboard/protocol';
import { companionSessions, promptsFor, sessionsFor, type SessionSources } from '../companion/companionSessions.ts';

/**
 * What a phone sees, made from what the engine knows: pure functions, so what leaves the computer is easy to check.
 * Paths stay on the computer: a project is an opaque id and a name.
 */

/** A project's id for phones: stable, and says nothing about where it is. */
export const projectIdOf = (root: string) => createHash('sha256').update(`switchboard-remote:${root}`).digest('hex').slice(0, 16);

/** The most sessions a phone lists. */
export const REMOTE_SESSION_LIMIT = 100;

export interface ListOptions {
  archiveAfterDays: number;
  scope: 'switchboard' | 'all';
  /** The names projects go by (custom names), by root. */
  projectNames: ReadonlyMap<string, string>;
  /** Every Claude profile; a session names its own only when there is more than one. */
  profiles?: readonly RemoteSessionProfile[];
  /** Every pipeline run: a step's sub-session sits under its parent, and the runs of what is listed go along. */
  runs?: readonly PipelineRunState[];
  /** Who started each session or run from afar (`SessionOrigins`), by id: each session says so (`startedBy`). */
  starters?: ReadonlyMap<string, string>;
  /** The sessions and runs triggers started (by session or run id): the bolt and "Started by …" on the phone too. */
  triggers?: readonly TriggerSession[];
  /** Providers whose sessions are read-only here (Codex), with the command that continues one (`{sessionId}` in it). */
  readOnlyProviders?: ReadonlyMap<string, string>;
  now?: number;
}

/** What a phone gets of the trigger that started a session or a run, by its id. */
export function triggerOrigins(links: readonly TriggerSession[] = []): Map<string, RemoteTriggerOrigin> {
  return new Map(links.map((l) => [l.sessionId, { name: l.triggerName, kind: l.kind, ref: l.ref, url: l.url, at: l.at }]));
}

/** The sidebar's sessions (needs you first, then working, then the most recent) and their prompts. */
export function remoteSessions(sources: SessionSources, options: ListOptions): RemoteSessions {
  const all = companionSessions(sources, { scope: options.scope, archiveAfterDays: options.archiveAfterDays, ...(options.now ? { now: options.now } : {}) });
  const listed = sessionsFor(all, [], REMOTE_SESSION_LIMIT);
  const flags = new Map(sources.summaries.map((s) => [s.id, s]));
  const running = new Map(sources.hosts.filter((h) => h.state !== 'closed' && h.state !== 'error').map((h) => [h.sessionId, h]));
  const live = new Map(sources.live.map((l) => [l.sessionId, l]));
  const profiles = options.profiles && options.profiles.length > 1 ? new Map(options.profiles.map(({ id, name, color }) => [id, { id, name, color }])) : null;
  const profileOf = (id: string | null | undefined) => (profiles && id ? (profiles.get(id) ?? null) : null);
  // A step's session sits under its run's parent before its transcript says so (a session still starting).
  const stepParent = new Map<string, string>();
  for (const { run, steps } of options.runs ?? []) for (const step of steps) if (step.sessionId) stepParent.set(step.sessionId, run.parentSessionId ?? run.id);
  const sessions: RemoteSession[] = listed.map((s) => ({
    id: s.id,
    title: s.title,
    projectId: projectIdOf(s.projectRoot),
    projectName: options.projectNames.get(s.projectRoot) ?? lastSegment(s.projectRoot),
    branch: s.branch,
    status: s.status,
    updatedAt: s.updatedAt,
    workingSince: live.get(s.id)?.updatedAt ?? live.get(s.id)?.startedAt ?? null,
    unread: flags.get(s.id)?.unread ?? false,
    pinned: flags.get(s.id)?.pinned ?? false,
    provider: (flags.get(s.id) ? otherProviderOf(flags.get(s.id)!) : null) ?? running.get(s.id)?.provider ?? null,
    model: running.get(s.id)?.model ?? null,
    effort: running.get(s.id)?.effort ?? null,
    permissionMode: running.get(s.id)?.permissionMode ?? null,
    profile: profileOf(running.get(s.id)?.profileId ?? flags.get(s.id)?.profileId ?? live.get(s.id)?.profileId),
    auto: autoOf(running.get(s.id)),
    background: running.get(s.id)?.backgroundTasks ?? [],
    parentId: flags.get(s.id)?.parentId ?? stepParent.get(s.id) ?? null,
  }));
  // Who started it: the device that did, or the one that started what it sits under (a pipeline's step, an agent).
  for (const session of sessions) {
    const resume = session.provider ? options.readOnlyProviders?.get(session.provider) : undefined;
    if (resume) session.readOnly = { resumeCommand: resume.replaceAll('{sessionId}', session.id) };
  }
  if (options.starters) {
    const starters = options.starters;
    for (const session of sessions) session.startedBy = starters.get(session.id) ?? (session.parentId ? starters.get(session.parentId) : undefined) ?? null;
  }
  const prompts = promptsFor(sources.permissions ?? [], listed).map(remotePrompt);
  const origins = triggerOrigins(options.triggers);
  for (const session of sessions) {
    const origin = origins.get(session.id);
    if (origin) session.trigger = origin;
  }
  if (!options.runs) return { sessions, prompts };
  const now = options.now ?? Date.now();
  const runs = remoteRuns(options.runs, new Set(sessions.map((s) => s.id)), { projectNames: options.projectNames, archiveAfterDays: options.archiveAfterDays, now, origins, ...(sources.kept ? { kept: sources.kept } : {}) });
  return { sessions, prompts, runs };
}

/** The most runs a phone gets. */
export const REMOTE_RUN_LIMIT = 50;

/**
 * The runs a phone gets, newest first: those started from a session it lists or with a sub-session it lists, and the
 * run rows (runs started from New session) the sidebar lists. A run row is listed as a session is: while it works or
 * waits for you, until you archive it, and for `archiveAfterDays` after its last activity.
 */
export function remoteRuns(runs: readonly PipelineRunState[], listed: ReadonlySet<string>, options: { projectNames: ReadonlyMap<string, string>; archiveAfterDays: number; now: number; kept?: ReadonlySet<string>; origins?: ReadonlyMap<string, RemoteTriggerOrigin> }): RemoteRunState[] {
  const shown = runs.filter((state) => {
    const { run, steps } = state;
    if (run.parentSessionId) return listed.has(run.parentSessionId) || steps.some((s) => s.sessionId !== null && listed.has(s.sessionId));
    const goesOn = run.status === 'running' || run.status === 'waiting' || run.status === 'paused';
    return listedInMainList({ attention: run.status === 'waiting', working: goesOn, pinned: false, archivedAt: run.archivedAt, restoredAt: run.restoredAt, unread: false, updatedAt: run.updatedAt, openInApp: false, keep: options.kept?.has(run.id) ?? false }, options.now, options.archiveAfterDays);
  });
  return shown
    .sort((a, b) => b.run.updatedAt - a.run.updatedAt)
    .slice(0, REMOTE_RUN_LIMIT)
    .map((state) => remoteRun(state, options.projectNames, options.origins?.get(state.run.id)));
}

/**
 * A run for a phone: its project as an id and a name, without its folders, its profile, the plan and the actions'
 * output; with the trigger that started it, when one did.
 */
export function remoteRun(state: PipelineRunState, projectNames: ReadonlyMap<string, string>, trigger?: RemoteTriggerOrigin): RemoteRunState {
  const { pipeline, projectRoot, cwd, profileId: _profile, ...run } = state.run;
  const { scope: _scope, ...saved } = pipeline;
  return {
    run: { ...run, pipeline: saved, projectId: projectIdOf(projectRoot), projectName: projectNames.get(projectRoot) ?? lastSegment(projectRoot), worktree: cwd !== projectRoot, ...(trigger ? { trigger } : {}) },
    steps: state.steps.map(({ plan: _plan, actions: _actions, ...step }) => step),
  };
}

/** What Auto did for a running session, as its model chip shows it: nothing once you changed the model yourself. */
export function autoOf(host: Pick<SessionHostInfo, 'autoPick' | 'autoChoosing'> | undefined): RemoteSession['auto'] {
  if (host?.autoChoosing) return { picked: null, choosing: true };
  const pick = host?.autoPick;
  return pick && !pick.left ? { picked: pick.model, choosing: false } : null;
}

export const remotePrompt = (p: PermissionRequest): RemotePrompt => ({
  requestId: p.requestId,
  sessionId: p.sessionId,
  toolName: p.toolName,
  input: p.input,
  ...(p.truncated ? { truncated: true } : {}),
  title: p.title,
  description: p.description,
  alwaysLabel: p.alwaysLabel,
  createdAt: p.createdAt,
});

export const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

function remoteBlock(block: TranscriptBlock): RemoteBlock {
  switch (block.type) {
    case 'tool_result':
      // The images a tool returned stay on the computer.
      return { type: 'tool_result', toolUseId: block.toolUseId, isError: block.isError, text: block.text, truncated: block.truncated };
    case 'image':
      return { type: 'image' };
    default:
      return block;
  }
}

export const remoteMessage = (message: TranscriptMessage, device?: string): RemoteMessage => ({
  uuid: message.uuid,
  timestamp: message.timestamp,
  parentToolUseId: message.parentToolUseId,
  ...remoteTurn(message.role, message.blocks.map(remoteBlock)),
  ...(device ? { device } : {}),
  ...(message.usage ? { usage: { id: message.usage.id ?? message.uuid, input: message.usage.input, output: message.usage.output, cacheRead: message.usage.cacheRead, cacheWrite: message.usage.cacheCreation } } : {}),
});

const tag = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? null;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const NOTICE_LABELS: Record<string, string> = { compact_boundary: 'Conversation compacted', informational: 'Information' };

/**
 * A turn as a phone shows it, the way the app's transcript reads the markup Claude Code writes into user turns
 * (apps/ui `displayItems`): a background task finishing, command output and an interrupt become a `system` line, a
 * slash command reads `/name args`, and reminders go. A system turn's markers become their label.
 */
function remoteTurn(role: RemoteMessage['role'], blocks: RemoteBlock[]): Pick<RemoteMessage, 'role' | 'blocks'> {
  const notice = (line: string | null) => ({ role: 'system' as const, blocks: line ? [{ type: 'text' as const, text: line }] : [] });
  if (role === 'system') {
    return { role, blocks: blocks.map((b) => (b.type === 'unknown' ? { type: 'text' as const, text: NOTICE_LABELS[b.kind] ?? b.kind.replace(/_/g, ' ') } : b)) };
  }
  // Skim's keep line is for the desktop's fade; the phone shows the reply without it.
  if (role === 'assistant') return { role, blocks: blocks.map((b) => (b.type === 'text' ? { ...b, text: skimMarks(b.text).text } : b)) };
  if (role !== 'user' || blocks.some((b) => b.type === 'tool_result')) return { role, blocks };
  const text = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n');
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<task-notification>')) return notice(tag(trimmed, 'summary') ?? 'Background task finished');
  // The saved transcript puts a line before an agent's hand-back; the live stream sends the tag on its own.
  if (/^(Another Claude session sent a message:\s*)?<agent-message from="/.test(trimmed)) return notice('An agent reported back');
  const command = tag(text, 'command-name');
  if (command) {
    const args = tag(text, 'command-args') ?? '';
    const line = `${command.startsWith('/') ? command : `/${command}`}${args ? ` ${args}` : ''}`;
    return { role, blocks: [{ type: 'text', text: line }, ...blocks.filter((b) => b.type !== 'text')] };
  }
  const stdout = tag(text, 'local-command-stdout');
  if (stdout !== null) return notice(stdout);
  if (/^\[Request interrupted by user/.test(trimmed)) return notice('Interrupted by you');
  return {
    role,
    blocks: blocks.flatMap((b): RemoteBlock[] => {
      if (b.type !== 'text') return [b];
      const cleaned = b.text.replace(SYSTEM_REMINDER, '').trim();
      return cleaned ? [{ ...b, text: cleaned }] : [];
    }),
  };
}

/**
 * A page of a transcript. `after` resumes after a message the phone has (`reset` when it is gone, with the last
 * page instead); `before` pages back; neither gives the last `limit` messages.
 */
export function transcriptPage(messages: readonly TranscriptMessage[], { before, after, limit }: { before?: string | undefined; after?: string | undefined; limit: number }) {
  if (after !== undefined) {
    const index = messages.findIndex((m) => m.uuid === after);
    if (index !== -1) {
      const rest = messages.slice(index + 1);
      return { messages: rest.slice(0, limit), hasMore: rest.length > limit, reset: false };
    }
    const page = messages.slice(-limit);
    return { messages: page, hasMore: messages.length > page.length, reset: true };
  }
  const end = before === undefined ? messages.length : messages.findIndex((m) => m.uuid === before);
  if (end === -1) return { messages: [], hasMore: false, reset: true };
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasMore: start > 0, reset: false };
}

/** Outside the checkout: absolute (`/…`, `C:\…`, `\\server\…`) or climbing out of it (`../…`). */
const outside = (path: string) => isAbsolutePath(path) || path.startsWith('\\\\') || /^\.\.([\\/]|$)/.test(path);

/** A catch-up for a phone: changed files outside the project stay on the computer. */
export const remoteCatchUp = (card: CatchUp | null): CatchUp | null =>
  card && {
    ...card,
    signals: {
      ...card.signals,
      outOfScope: card.signals.outOfScope.filter((path) => !outside(path)),
      scope: card.signals.scope && outside(card.signals.scope) ? null : card.signals.scope,
    },
  };

/** A diff cut to its first `lines` lines. */
export function capDiff(diff: { diff: string; truncated: boolean }, lines: number): { diff: string; truncated: boolean } {
  const all = diff.diff.split('\n');
  if (all.length <= lines) return diff;
  return { diff: all.slice(0, lines).join('\n'), truncated: true };
}

/** What a new session from a phone starts with: what the phone chose, else the project's default, then its profile's, then the global mode. */
export interface SessionChoice {
  profileId: string;
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
  worktree: boolean;
  baseRef: WorktreeBase;
  /** A branch to check out in the project's folder first; null keeps what is checked out. */
  checkoutBranch: string | null;
}

/** Settings › General › Global model and Global effort: null leaves them to Claude Code. */
export interface GlobalModel {
  model: string | null;
  effort: Effort | null;
}

export const NO_GLOBAL_MODEL: GlobalModel = { model: null, effort: null };

export function sessionChoice(options: RemoteSessionOptions, project: ProjectDefaults, profile: { id: string; defaults: ProfileDefaults }, globalMode: PermissionMode = 'default', globals: GlobalModel = NO_GLOBAL_MODEL): SessionChoice {
  const workspace = project.workspace ?? profile.defaults.workspace;
  return {
    profileId: profile.id,
    model: options.model !== undefined ? options.model : (inheritedDefault('model', project, profile.defaults) ?? globals.model),
    effort: options.effort !== undefined ? options.effort : (inheritedDefault('effort', project, profile.defaults) ?? globals.effort),
    permissionMode: options.permissionMode ?? inheritedPermissionMode(project, profile.defaults) ?? globalMode,
    worktree: options.worktree ?? workspace === 'worktree',
    baseRef: project.baseRef ?? profile.defaults.baseRef ?? 'fresh',
    checkoutBranch: options.checkoutBranch ?? null,
  };
}

/**
 * A project's or a profile's defaults as a phone gets them. The phone takes the project's mode, else the profile's, so
 * the global mode comes in where it applies: a profile without a mode, and a project that skips its profile's. The
 * global model and effort (`globals`) come in the same way; a project's unset ones fall to its profile.
 */
export const remoteDefaults = (defaults: Pick<ProfileDefaults, 'model' | 'effort' | 'permissionMode' | 'workspace'>, globalMode: PermissionMode | null, globals: GlobalModel = NO_GLOBAL_MODEL) => ({
  model: defaults.model ?? globals.model,
  effort: defaults.effort ?? globals.effort,
  permissionMode: defaults.permissionMode ?? globalMode,
  worktree: defaults.workspace === null ? null : defaults.workspace === 'worktree',
});

/** A token breakdown as another computer gets it: each project as its id and name, never its folder. */
export function remoteUsage(breakdown: UsageBreakdown, projectNames: ReadonlyMap<string, string>): RemoteUsageBreakdown {
  return {
    ...breakdown,
    rows: breakdown.rows.map(({ projectRoot, ...row }) => {
      const projectId = projectRoot ? projectIdOf(projectRoot) : null;
      const projectName = projectRoot ? (projectNames.get(projectRoot) ?? lastSegment(projectRoot)) : null;
      // A project row: its key and label are the project, so they become its id and name.
      const projectRow = projectId !== null && row.key === projectRoot;
      return { ...row, key: projectRow ? projectId : row.key, label: projectRow ? projectName! : row.label, projectId, projectName };
    }),
  };
}
