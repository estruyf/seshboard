import { existsSync } from 'node:fs';
import { parseBriefs, replaceBriefs, writeBriefs, type CatchUp, type SessionSummary, type TranscriptMessage, type WorktreePullRequest } from '@switchboard/protocol';
import { buildBrief, type BriefSource } from './brief.ts';
import type { LinkStore, SessionPr } from './linkStore.ts';
import { openedPullRequests } from './prDetect.ts';

/** How long sending waits for gh and git before it writes the brief with what it has. */
export const WARM_WAIT_MS = 2_000;
/** Commits listed per brief. */
const MAX_COMMITS = 10;

export interface LinkServiceDeps {
  store: LinkStore;
  session(id: string): SessionSummary | null;
  /** How a session runs now: null when it isn't running anywhere. */
  status(id: string): 'working' | 'waiting' | null;
  catchUp(id: string): CatchUp | null;
  projectName(root: string): string | null;
  /** Whether the folder is in a git repository. */
  inRepo(folder: string): boolean;
  /** The project's pull requests by head branch, from gh (cached); null without gh. */
  pullRequests(root: string): Promise<Map<string, WorktreePullRequest> | null>;
  /** The branch's own commits, newest first, as `<sha> <subject>`. */
  commits(folder: string, branch: string, base: string | null): Promise<string[]>;
  /** The last reply of the session's last turn. */
  lastReply(id: string): Promise<string | null>;
  log(level: 'debug' | 'warn', message: string): void;
}

interface Warm {
  pr: WorktreePullRequest | null;
  commits: string[];
  lastReply: string | null;
  at: number;
}

const prOf = (row: SessionPr): WorktreePullRequest => ({ number: row.number, state: row.state, url: row.url, ...(row.base ? { base: row.base } : {}) });

/**
 * Session linking in the engine (docs/session-linking.md): turns the stubs the message box writes into briefs right
 * before Claude reads a message, records the links, and keeps what a brief needs at hand. `expand` never waits, so
 * `SessionHost.push` can call it; `warm` (when a chip is added, and before sending) reads gh and git ahead of it.
 */
export class LinkService {
  private readonly warmed = new Map<string, Warm>();

  constructor(private readonly deps: LinkServiceDeps) {}

  /** The branch a session works on: its worktree's, else the one its transcript recorded. */
  private branchOf(session: SessionSummary): string | null {
    return session.worktree?.branch ?? session.gitBranch ?? null;
  }

  /** The session's pull request: one it opened (the newest open one first), else the one for its branch. */
  private prFor(sessionId: string, fromBranch: WorktreePullRequest | null): { pr: WorktreePullRequest | null; checkedAt: number | null } {
    const rows = this.deps.store.prsOf(sessionId);
    const opened = rows.filter((r) => r.source === 'opened');
    const pick = opened.find((r) => r.state === 'open') ?? opened[0] ?? null;
    if (pick) {
      // gh's newer view of the same pull request wins over the stored one.
      const fresh = fromBranch && fromBranch.number === pick.number ? fromBranch : null;
      return { pr: fresh ?? prOf(pick), checkedAt: fresh ? null : pick.checkedAt };
    }
    if (fromBranch) return { pr: fromBranch, checkedAt: null };
    const stored = rows[0];
    return stored ? { pr: prOf(stored), checkedAt: stored.checkedAt } : { pr: null, checkedAt: null };
  }

  /** Reads gh and git for a linked session, at most `wait` ms (the rest lands in the cache for the next brief). */
  async warm(sessionId: string, wait = WARM_WAIT_MS): Promise<void> {
    const work = this.read(sessionId).catch((error: Error) => this.deps.log('debug', `Link ${sessionId}: ${error.message}`));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, wait).unref?.())]);
  }

  private async read(sessionId: string): Promise<void> {
    const session = this.deps.session(sessionId);
    if (!session) return;
    const branch = this.branchOf(session);
    const folder = session.cwd ?? session.projectRoot;
    const [prs, lastReply] = await Promise.all([branch ? this.deps.pullRequests(session.projectRoot).catch(() => null) : null, this.deps.lastReply(sessionId).catch(() => null)]);
    const fromBranch = branch ? (prs?.get(branch) ?? null) : null;
    if (fromBranch) {
      const repo = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\//.exec(fromBranch.url)?.[1];
      if (repo) this.deps.store.savePr(sessionId, { repo, number: fromBranch.number, url: fromBranch.url, state: fromBranch.state, base: fromBranch.base ?? null, head: branch, source: 'branch' });
    }
    const { pr } = this.prFor(sessionId, fromBranch);
    const commits = branch && existsSync(folder) ? await this.deps.commits(folder, branch, pr?.base ?? null).catch(() => []) : [];
    this.warmed.set(sessionId, { pr: fromBranch, commits: commits.slice(0, MAX_COMMITS), lastReply, at: Date.now() });
  }

  /** Warms every session a message links, for sending. */
  async warmText(text: string): Promise<void> {
    const ids = [...new Set(parseBriefs(text).briefs.filter((b) => b.stub).map((b) => b.sessionId))];
    if (ids.length) await Promise.all(ids.map((id) => this.warm(id)));
  }

  /** What a chip shows: the branch and pull request, or that the session is gone. Reads gh first (at most 2 seconds). */
  async info(sessionId: string): Promise<{ gone: boolean; branch: string | null; pr: WorktreePullRequest | null }> {
    const session = this.deps.session(sessionId);
    if (!session) return { gone: true, branch: null, pr: null };
    await this.warm(sessionId);
    return { gone: false, branch: this.branchOf(session), pr: this.prFor(sessionId, this.warmed.get(sessionId)?.pr ?? null).pr };
  }

  /** The brief's facts about a linked session, from what is held now. */
  private source(label: string, sessionId: string): BriefSource {
    const session = this.deps.session(sessionId);
    const warm = this.warmed.get(sessionId);
    const base: BriefSource = { label, sessionId, session, projectName: null, folderExists: false, inRepo: false, branch: null, pr: null, prAsOf: null, status: null, catchUp: null, commits: [], lastReply: null };
    if (!session) return base;
    const folder = session.cwd ?? session.projectRoot;
    const { pr, checkedAt } = this.prFor(sessionId, warm?.pr ?? null);
    const catchUp = this.deps.catchUp(sessionId);
    return {
      ...base,
      projectName: this.deps.projectName(session.projectRoot),
      folderExists: existsSync(folder),
      inRepo: this.deps.inRepo(folder),
      branch: this.branchOf(session),
      pr,
      // Only say when it was read when that was a while ago.
      prAsOf: checkedAt && Date.now() - checkedAt > 10 * 60_000 ? checkedAt : null,
      status: this.deps.status(sessionId),
      catchUp,
      commits: warm?.commits ?? [],
      lastReply: warm?.lastReply ?? null,
    };
  }

  /**
   * The message as Claude reads it: each stub turned into a brief about its session, each link recorded under `from`.
   * Never waits: what `warm` read before is used, the rest comes from the session index and the catch-up store.
   * A text without stubs comes back as it is. `others` is how many other blocks (attached issues) share the budget.
   */
  expand(from: string, text: string, others = 0): string {
    const { briefs } = parseBriefs(text);
    // The same session twice gets one brief, where it is first linked.
    const stubs = briefs.filter((b, i) => b.stub && b.sessionId !== from && briefs.findIndex((o) => o.stub && o.sessionId === b.sessionId) === i);
    if (!stubs.length) return briefs.some((b) => b.stub) ? this.drop(text) : text;
    const written = new Map(writeBriefs(stubs.map((stub) => buildBrief(this.source(stub.label, stub.sessionId))), stubs.length + others).map((brief, i) => [stubs[i]!.sessionId, brief]));
    const out = replaceBriefs(text, (brief, block) => {
      // A brief already written stays as it was; a link to the session itself, or a second one, says nothing.
      if (!brief.stub) return block;
      const replacement = written.get(brief.sessionId);
      if (!replacement) return '';
      written.delete(brief.sessionId);
      this.deps.store.link(from, brief.sessionId, brief.label);
      return replacement;
    });
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /** The text without its stubs (all of them linked the session itself). */
  private drop(text: string): string {
    return replaceBriefs(text, (brief, block) => (brief.stub ? '' : block))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** A session's transcript was read again (the search indexer's pass): store the pull requests it opened. */
  transcriptRead(sessionId: string, messages: readonly TranscriptMessage[]): void {
    for (const pr of openedPullRequests(messages)) {
      const known = this.deps.store.prsOf(sessionId).find((r) => r.repo === pr.repo && r.number === pr.number);
      this.deps.store.savePr(sessionId, { repo: pr.repo, number: pr.number, url: pr.url, state: known?.state ?? 'open', base: pr.base ?? known?.base ?? null, head: known?.head ?? null, source: 'opened' }, known?.seenAt ?? pr.at ?? Date.now());
    }
  }
}
