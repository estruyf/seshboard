import type { Brief, CatchUp, SessionSummary, WorktreePullRequest } from '@switchboard/protocol';
import { stubBrief } from '@switchboard/protocol';

/** Everything a brief says about a linked session, gathered by `LinkService` from what the engine holds. */
export interface BriefSource {
  label: string;
  sessionId: string;
  /** Null: the session is gone (deleted, or never was). */
  session: SessionSummary | null;
  projectName: string | null;
  /** Its folder is still on disk (a removed worktree isn't). */
  folderExists: boolean;
  /** The folder is in a git repository. */
  inRepo: boolean;
  branch: string | null;
  pr: WorktreePullRequest | null;
  /** When the pull request was last read from gh, when that is a while ago (gh missing or offline). */
  prAsOf: number | null;
  /** How it runs now: null when it isn't running anywhere. */
  status: 'working' | 'waiting' | null;
  catchUp: CatchUp | null;
  commits: readonly string[];
  lastReply: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A clock time on this computer, `2026-10-18 13:02`: briefs stay in the transcript, so they never say "1h ago".
 */
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `#148 open, base main, https://…` (and `draft`, and when it was read when that is a while ago). */
export function prLine(pr: WorktreePullRequest, asOf: number | null): string {
  const state = pr.state === 'open' && pr.draft ? 'open, draft' : pr.state;
  return [`#${pr.number} ${state}`, pr.base ? `base ${pr.base}` : null, pr.url].filter(Boolean).join(', ') + (asOf ? ` (as of ${clockTime(asOf)})` : '');
}

/** A brief about a linked session, from what is known about it. Nothing here waits or calls a model. */
export function buildBrief(source: BriefSource): Brief {
  const brief: Brief = { ...stubBrief(source.label, source.sessionId), stub: false };
  const session = source.session;
  if (!session) {
    brief.fields.state = 'gone, this session no longer exists';
    return brief;
  }
  const card = source.catchUp;
  brief.fields.project = source.projectName ?? session.projectRoot;
  const folder = session.cwd ?? session.projectRoot;
  brief.fields.folder = source.folderExists ? folder : `${folder} (removed)`;
  brief.fields.branch = source.branch ?? (source.inRepo ? 'none (detached)' : 'none (not a git repository)');
  brief.fields['pull request'] = source.pr ? prLine(source.pr, source.prAsOf) : source.branch ? 'none yet' : 'none';
  brief.fields.state =
    source.status === 'working'
      ? 'working, details may change'
      : source.status === 'waiting'
        ? `waits for you${card?.state === 'waiting' && card.need.title ? ` (${card.need.title})` : ''}`
        : `finished, last active ${clockTime(session.updatedAt)}`;
  const asked = card?.ask || session.firstPrompt;
  if (asked) brief.fields.asked = asked;
  brief.commits = [...source.commits];
  // While it works, what it did is about to change: only its reply so far.
  if (card && source.status !== 'working') {
    brief.did = [...card.did];
    brief.skipped = [...card.skipped];
    if (card.need.kind !== 'none' && card.need.title) brief.next = card.need.title;
  }
  brief.lastReply = source.lastReply?.trim() || null;
  return brief;
}
