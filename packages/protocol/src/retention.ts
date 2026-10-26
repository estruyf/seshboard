/**
 * When sessions leave the sidebar's main list (Archived) and when archived ones go to the Trash. Plain TypeScript, so
 * the sidebar, the VS Code companion and the engine's daily clean-up all use the same rules.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Finished sessions are archived after this many days without activity. */
export const ARCHIVE_AFTER_DAYS = { min: 1, max: 365, default: 3 } as const;
/** Archived sessions go to the Trash after this many days in Archived, when deleting is on. */
export const DELETE_AFTER_DAYS = { min: 1, max: 3650, default: 30 } as const;

/** Moving archived sessions to the Trash: off by default. */
export interface DeleteArchived {
  enabled: boolean;
  /** Days in Archived before a session goes. */
  afterDays: number;
}

export const DEFAULT_DELETE_ARCHIVED: DeleteArchived = { enabled: false, afterDays: DELETE_AFTER_DAYS.default };

/** A whole number of days within a range, or null when the value isn't a number. */
export function clampDays(value: unknown, range: { min: number; max: number }): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** What the sidebar knows about a session to decide whether it is listed or archived. */
export interface ListingState {
  /** Waits for you (a permission or a question) or failed. */
  attention: boolean;
  working: boolean;
  pinned: boolean;
  /** When the user archived it by hand. */
  archivedAt: number | null;
  /** When the user unarchived it by hand. */
  restoredAt: number | null;
  unread: boolean;
  /** The last activity. */
  updatedAt: number;
  /** Open in Seshboard (a process idling elsewhere doesn't count). */
  openInApp: boolean;
}

/**
 * Main list or Archived? Anything that needs you or is pinned stays up. Archiving by hand hides a session until it has
 * new activity (one that is still working stays archived until it finishes). Unarchiving by hand keeps it up until it
 * has new activity. Otherwise what works, is open in the app or is unread stays, and the rest after `archiveAfterDays`
 * without activity.
 */
export function listedInMainList(s: ListingState, now: number, archiveAfterDays: number): boolean {
  if (s.attention || s.pinned) return true;
  if (s.archivedAt !== null && (s.archivedAt >= s.updatedAt || s.working)) return false;
  if (s.working) return true;
  if (s.restoredAt !== null && s.restoredAt >= s.updatedAt) return true;
  return s.openInApp || s.unread || now - s.updatedAt < archiveAfterDays * DAY_MS;
}

/**
 * When an archived session went to Archived: when you archived it, or for one archived automatically, its last
 * activity plus `archiveAfterDays`. Null while the main list shows it.
 */
export function archivedSince(s: ListingState, now: number, archiveAfterDays: number): number | null {
  if (listedInMainList(s, now, archiveAfterDays)) return null;
  if (s.archivedAt !== null && (s.archivedAt >= s.updatedAt || s.working)) return s.archivedAt;
  return s.updatedAt + archiveAfterDays * DAY_MS;
}

/** Why a session is never moved to the Trash in bulk or by the daily clean-up. */
export const KEEP_REASONS = ['pinned', 'working', 'needs-you', 'open-elsewhere', 'queued', 'draft'] as const;
export type KeepReason = (typeof KEEP_REASONS)[number];

/** What a session's deletion depends on, on top of its listing. */
export interface DeletionState {
  pinned: boolean;
  working: boolean;
  /** Waits for a permission or an answer. */
  needsYou: boolean;
  /** Open in another Claude Code window (a terminal, an editor, Claude desktop). */
  openElsewhere: boolean;
  /** A queued prompt waits for it. */
  queued: boolean;
  /** Its message box holds a message you haven't sent. */
  draft: boolean;
}

/** The first reason to keep a session, or null when it may go. */
export function keepReason(s: DeletionState): KeepReason | null {
  if (s.pinned) return 'pinned';
  if (s.working) return 'working';
  if (s.needsYou) return 'needs-you';
  if (s.openElsewhere) return 'open-elsewhere';
  if (s.queued) return 'queued';
  if (s.draft) return 'draft';
  return null;
}

/** The reason in a few words, after a session's title ("Release checklist is pinned"). */
export const KEEP_REASON_TEXT: Record<KeepReason, string> = {
  pinned: 'is pinned',
  working: 'is working',
  'needs-you': 'needs you',
  'open-elsewhere': 'is open in another window',
  queued: 'has a queued prompt',
  draft: 'has an unsent message',
};

export type RetentionCandidate = { id: string; listing: ListingState; deletion: DeletionState };

/**
 * The archived sessions that have been in Archived for more than `afterDays` (`due`), and those among them that
 * stay for a reason (`kept`). Deleting being off changes nothing here: the caller decides whether to act.
 */
export function dueForDeletion<T extends RetentionCandidate>(
  sessions: readonly T[],
  options: { now: number; archiveAfterDays: number; afterDays: number },
): { due: T[]; kept: Array<{ session: T; reason: KeepReason }> } {
  const due: T[] = [];
  const kept: Array<{ session: T; reason: KeepReason }> = [];
  const cutoff = options.now - options.afterDays * DAY_MS;
  for (const session of sessions) {
    const since = archivedSince(session.listing, options.now, options.archiveAfterDays);
    if (since === null || since > cutoff) continue;
    const reason = keepReason(session.deletion);
    if (reason) kept.push({ session, reason });
    else due.push(session);
  }
  return { due, kept };
}
