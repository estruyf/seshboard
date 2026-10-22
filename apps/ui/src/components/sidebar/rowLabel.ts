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
  archived: boolean;
  /** One of several sessions picked with ⌘- or ⇧-click. */
  picked?: boolean;
  beside: boolean;
  /** Shown in a window of its own. */
  ownWindow?: boolean;
  /** It holds a message you typed and didn't send. */
  draft?: boolean;
  /** A pipeline runs from it, or it is a run row: where the run is ("Validate · 3 of 4"). */
  pipeline?: string | null;
  updatedAt: number;
  now: number;
}): string {
  const parts = [row.title || 'Untitled session'];
  if (row.project) parts.push(row.project);
  if (row.status) parts.push(STATUS_LABEL[row.status]);
  if (row.pipeline) parts.push(`pipeline at ${row.pipeline.replace(/ · /g, ', ')}`);
  if (row.pinned) parts.push('pinned');
  if (row.archived) parts.push('archived');
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
