import { createHash } from 'node:crypto';
import {
  isAbsolutePath,
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
  type SessionHostInfo,
  type TranscriptBlock,
  type TranscriptMessage,
} from '@switchboard/protocol';
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
  now?: number;
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
  const sessions: RemoteSession[] = listed.map((s) => ({
    id: s.id,
    title: s.title,
    projectId: projectIdOf(s.projectRoot),
    projectName: options.projectNames.get(s.projectRoot) ?? lastSegment(s.projectRoot),
    branch: s.branch,
    status: s.status,
    updatedAt: s.updatedAt,
    unread: flags.get(s.id)?.unread ?? false,
    pinned: flags.get(s.id)?.pinned ?? false,
    model: running.get(s.id)?.model ?? null,
    effort: running.get(s.id)?.effort ?? null,
    permissionMode: running.get(s.id)?.permissionMode ?? null,
    profile: profileOf(running.get(s.id)?.profileId ?? flags.get(s.id)?.profileId ?? live.get(s.id)?.profileId),
    auto: autoOf(running.get(s.id)),
  }));
  return { sessions, prompts: promptsFor(sources.permissions ?? [], listed).map(remotePrompt) };
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
  title: p.title,
  description: p.description,
  alwaysLabel: p.alwaysLabel,
  createdAt: p.createdAt,
});

const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

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

/** What a new session from a phone starts with: what the phone chose, else the project's default, then its profile's. */
export interface SessionChoice {
  profileId: string;
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
  worktree: boolean;
  baseRef: 'fresh' | 'head';
}

export function sessionChoice(options: RemoteSessionOptions, project: ProjectDefaults, profile: { id: string; defaults: ProfileDefaults }): SessionChoice {
  const workspace = project.workspace ?? profile.defaults.workspace;
  return {
    profileId: profile.id,
    model: options.model !== undefined ? options.model : (project.model ?? profile.defaults.model),
    effort: options.effort !== undefined ? options.effort : (project.effort ?? profile.defaults.effort),
    permissionMode: options.permissionMode ?? project.permissionMode ?? profile.defaults.permissionMode ?? 'default',
    worktree: options.worktree ?? workspace === 'worktree',
    baseRef: project.baseRef ?? profile.defaults.baseRef ?? 'fresh',
  };
}

/** A project's or a profile's defaults as a phone gets them. */
export const remoteDefaults = (defaults: ProfileDefaults) => ({
  model: defaults.model,
  effort: defaults.effort,
  permissionMode: defaults.permissionMode,
  worktree: defaults.workspace === null ? null : defaults.workspace === 'worktree',
});
