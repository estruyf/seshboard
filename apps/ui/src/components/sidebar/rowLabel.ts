import { otherProviderOf, PROVIDER_NAMES, type SessionProvider } from '@seshboard/protocol/client';
import type { RowStatus } from '../../state/sidebarRows.ts';

/** What a row's status icon means, in words: its tooltip, and what VoiceOver reads for it. */
export const STATUS_LABEL: Record<Exclude<RowStatus, null>, string> = {
  'needs-you': 'Waiting for you',
  running: 'Claude is working',
  error: 'Last run failed',
  unread: 'New activity since you last looked',
  background: 'Ready, a background task is running',
  idle: 'Open and ready',
};

/** Who works in a session, for "… is working": another provider's name (GitHub Copilot), or Claude. */
export const agentNameOf = (session: { provider?: SessionProvider | null } | null | undefined): string => {
  const other = session ? otherProviderOf(session) : null;
  return other ? PROVIDER_NAMES[other] : 'Claude';
};

/** `STATUS_LABEL` with the agent's name in "… is working". */
export const statusLabel = (status: Exclude<RowStatus, null>, agent = 'Claude'): string => (status === 'running' ? `${agent} is working` : STATUS_LABEL[status]);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "5 minutes ago", "yesterday", "Oct 3": the sidebar's short ages ("5m") in words a screen reader can say. */
export function spokenAge(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${plural(Math.floor(diff / MINUTE), 'minute')} ago`;
  if (diff < DAY) return `${plural(Math.floor(diff / HOUR), 'hour')} ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `on ${date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * The accessible name of a session row: the title first (what people scan for), then the project,
 * what it's doing, and the flags the row only shows as icons or colour.
 */
export function sessionRowLabel(row: {
  title: string;
  project: string | undefined;
  status: RowStatus;
  pinned: boolean;
  /** In Done: true, or why ("Inactive 3 days"). */
  archived: boolean | string | null;
  /** What's left, in your words. */
  note?: string | null;
  /** A reminder that came due: "Reminder", "Reminder (from 09:00)". */
  reminder?: string | null;
  /** What it left behind: uncommitted changes, commits not pushed and the rest (`looseEndLines`). */
  left?: readonly string[];
  /** One of several sessions picked with ⌘- or ⇧-click. */
  picked?: boolean;
  beside: boolean;
  /** Shown in a window of its own. */
  ownWindow?: boolean;
  /** It holds a message you typed and didn't send. */
  draft?: boolean;
  /** Who works in it, for "… is working" (`agentNameOf`). Claude by default. */
  agent?: string;
  /** A pipeline runs from it, or it is a run row: where the run is ("Validate · 3 of 4"). */
  pipeline?: string | null;
  updatedAt: number;
  now: number;
}): string {
  const parts = [row.title || 'Untitled session'];
  if (row.project) parts.push(row.project);
  if (row.status) parts.push(statusLabel(row.status, row.agent));
  if (row.pipeline) parts.push(`pipeline at ${row.pipeline.replace(/ · /g, ', ')}`);
  if (row.reminder) parts.push(row.reminder.charAt(0).toLowerCase() + row.reminder.slice(1));
  if (row.note) parts.push(`note: ${row.note}`);
  if (row.left?.length) parts.push(`left: ${row.left.map((line) => line.charAt(0).toLowerCase() + line.slice(1)).join(', ')}`);
  if (row.pinned) parts.push('pinned');
  // In Done: why, in the row's words ("Done", "Inactive 3 days").
  if (row.archived) parts.push(typeof row.archived === 'string' ? row.archived.toLowerCase() : 'done');
  if (row.picked) parts.push('in the selection');
  if (row.beside) parts.push('open in another pane');
  if (row.ownWindow) parts.push('open in its own window');
  if (row.draft) parts.push('unsent message');
  parts.push(`updated ${spokenAge(row.updatedAt, row.now)}`);
  return parts.join(', ');
}

/** The accessible name of a pipeline's sub-session: its step, its parent, then the model and state the row shows. */
export function stepRowLabel(row: { title: string; parent: string | null; meta: string | null; status: RowStatus }): string {
  const parts = [row.title || 'Untitled session'];
  if (row.parent) parts.push(`step of ${row.parent}`);
  if (row.meta) parts.push(row.meta.replace(/ · /g, ', '));
  if (row.status) parts.push(STATUS_LABEL[row.status]);
  return parts.join(', ');
}

/** How Minimal mode marks a row's state: by shape, so it reads without colour. A failure keeps its red badge. */
export type MinimalMark = 'dot' | 'spinner' | 'ring' | 'error' | 'none';

/** The state names Minimal mode's marks say, as their `aria-label` and tooltip. */
export const MINIMAL_STATE_LABEL: Record<Exclude<RowStatus, null>, string> = {
  'needs-you': 'Needs you',
  running: 'Working',
  background: 'Working in the background',
  unread: 'To review',
  error: 'Failed',
  idle: 'Open',
};

/**
 * Minimal mode's mark for a state: a filled dot for needs you, a turning arc while it works, a ring to review, the
 * red badge for a failure, and nothing (an empty slot, so titles line up) when it is open or done.
 */
export function minimalMark(status: RowStatus): { mark: MinimalMark; label: string | null } {
  switch (status) {
    case 'needs-you':
      return { mark: 'dot', label: MINIMAL_STATE_LABEL[status] };
    case 'running':
    case 'background':
      return { mark: 'spinner', label: MINIMAL_STATE_LABEL[status] };
    case 'unread':
      return { mark: 'ring', label: MINIMAL_STATE_LABEL[status] };
    case 'error':
      return { mark: 'error', label: MINIMAL_STATE_LABEL[status] };
    case 'idle':
    case null:
      return { mark: 'none', label: null };
  }
}

/**
 * The tooltip of a one-line row in Minimal mode: the title, then everything the second line and the marks would have
 * said (what it waits for, project, branch, computer, what is open, note, reminder, why it is done, a usage limit,
 * the profile, the folder). Empty parts are left out.
 */
export function minimalRowTooltip(row: {
  title: string;
  waitingFor?: string | null;
  project?: string | null;
  branch?: string | null;
  computer?: string | null;
  terminal?: boolean;
  tabs?: number;
  note?: string | null;
  reminder?: string | null;
  done?: string | null;
  limit?: string | null;
  profile?: string | null;
  cwd?: string | null;
}): string {
  const tabs = row.tabs ?? 0;
  const open = [row.terminal ? 'a terminal' : null, tabs > 0 ? `${tabs} browser ${tabs === 1 ? 'tab' : 'tabs'}` : null].filter(Boolean);
  return [
    row.title || 'Untitled session',
    row.waitingFor,
    [row.project, row.branch].filter(Boolean).join(' · ') || null,
    row.computer ? `On ${row.computer}` : null,
    open.length ? `Open: ${open.join(', ')}` : null,
    row.note ? `Note: ${row.note}` : null,
    row.reminder,
    row.done,
    row.limit,
    row.profile ? `Profile: ${row.profile}` : null,
    row.cwd,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The kinds of row the sidebar lists, for what sits at their left edge (`rowLeading`). */
export type SidebarRowKind = 'session' | 'run' | 'queue' | 'pipeline-step';

/**
 * What a row shows at its left edge: its state mark, an empty slot of the same width, or its project's tile (a run row:
 * the pipeline's). Minimal mode has no project markers on any row: sessions and steps show their state, queued
 * prompts an empty slot (their header says what they are), so every title starts at the same place. Full mode is as
 * it was: the project's tile, and a step's state.
 */
export function rowLeading(kind: SidebarRowKind, { minimal }: { minimal: boolean }): 'state' | 'empty' | 'project' {
  if (kind === 'pipeline-step') return 'state';
  if (!minimal) return 'project';
  return kind === 'queue' ? 'empty' : 'state';
}

/** A queued prompt's tooltip: the prompt (cut at 300 characters), then its project and when it was queued. */
export function queueRowTooltip(prompt: string, project: string, queued: string): string {
  return [prompt.length > 300 ? `${prompt.slice(0, 299)}…` : prompt, `${project} · queued ${queued}`].join('\n');
}
