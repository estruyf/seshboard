import { DEFAULT_PREFERENCES, type DeleteArchived, type LaterItem, type RetentionCandidate, type SessionSummary } from '@seshboard/protocol';
import { companionStatus, type SessionSources } from '../companion/companionSessions.ts';

/** The two settings from Settings › Sessions that the engine needs (main keeps the preferences and sends them). */
export interface RetentionPolicy {
  archiveAfterDays: number;
  deleteArchived: DeleteArchived;
}

export const DEFAULT_RETENTION: RetentionPolicy = { archiveAfterDays: DEFAULT_PREFERENCES.archiveAfterDays, deleteArchived: DEFAULT_PREFERENCES.deleteArchived };

/** Where the renderer saves unsent messages (`useDraftsSync`): `{ version, drafts: { <session id or new:…>: … } }`. */
export const DRAFTS_KEY = 'ui.drafts';

/** The sessions with an unsent message, from the saved drafts. Only drafts with text or context are saved. */
export function sessionsWithDrafts(stored: unknown): Set<string> {
  const drafts = (stored as { drafts?: unknown } | null)?.drafts;
  if (!drafts || typeof drafts !== 'object') return new Set();
  // New session's prompts are kept under `new:<folder>`; they belong to no session.
  return new Set(Object.keys(drafts).filter((key) => !key.startsWith('new:')));
}

/** The sessions a queued prompt waits for. */
export const sessionsWithQueuedPrompts = (items: readonly LaterItem[]): Set<string> =>
  new Set(items.flatMap((item) => (item.waitFor.kind === 'session' ? [item.waitFor.sessionId] : [])));

export type SessionCandidate = RetentionCandidate & { summary: SessionSummary };

/**
 * Every indexed session with what the archive rule and the keep rules need: its listing (as the sidebar sees it) and
 * why it might have to stay. A process in another Claude Code window counts as open elsewhere, idle or not.
 */
export function retentionCandidates(sources: SessionSources & { drafts: ReadonlySet<string>; queued: ReadonlySet<string> }): SessionCandidate[] {
  const live = new Map(sources.live.map((l) => [l.sessionId, l]));
  const hosts = new Map(sources.hosts.map((h) => [h.sessionId, h]));
  return sources.summaries.map((summary) => {
    const l = live.get(summary.id) ?? null;
    const host = hosts.get(summary.id);
    const hosted = !!host && host.state !== 'closed' && host.state !== 'error';
    const status = companionStatus(summary, l, host);
    const updatedAt = Math.max(summary.updatedAt, l && l.status !== 'idle' ? (l.updatedAt ?? 0) : 0);
    // A background command or agent still running counts as work.
    const working = status === 'working' || status === 'background';
    return {
      id: summary.id,
      summary,
      listing: {
        attention: status === 'needs-you' || status === 'error',
        working: status === 'working',
        pinned: summary.pinned,
        archivedAt: summary.archivedAt,
        restoredAt: summary.restoredAt,
        unread: summary.unread,
        updatedAt,
        openInApp: hosted || l?.origin === 'app',
      },
      deletion: {
        pinned: summary.pinned,
        working,
        needsYou: status === 'needs-you',
        openElsewhere: !!l && !hosted,
        queued: sources.queued.has(summary.id),
        draft: sources.drafts.has(summary.id),
      },
    };
  });
}

/** "141 MB" for the log. */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}
