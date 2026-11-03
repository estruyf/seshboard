/**
 * Loose ends (session triage): what sessions left behind in git and on GitHub, and whose it is. Pure, so the rules can
 * be tested without git: `looseEndsWatcher.ts` gathers the facts per repository and keeps the result.
 *
 * Whose is it? By branch, not by checkout: pipeline steps and continued sessions share a worktree, so one checkout per
 * session doesn't hold.
 * - Commits not pushed, failing checks and a pull request closed without merging go to the newest session recorded on
 *   that branch, never on the repository's default branch.
 * - Uncommitted changes go to the newest session whose branch is the one checked out in that checkout.
 * - A merged pull request cancels "not pushed": a squash merge leaves the branch's own commits on no remote.
 * - A pipeline step's loose ends go to its run's row (or the session the run started from): `ownerOf`.
 */
import { isSameOrInside, sameLooseEnds, type GitLooseEnd } from '@seshboard/protocol';

/** A checkout of the repository, as `listWorktrees` found it. */
export interface RepoCheckout {
  path: string;
  /** Null when detached. */
  branch: string | null;
  /** Changed, staged and new files. */
  uncommitted: number;
  /** Commits beyond the default branch that no remote has. */
  unpushed: number;
}

/** What one repository has, read in one go. */
export interface RepoFacts {
  root: string;
  baseBranch: string | null;
  checkouts: readonly RepoCheckout[];
  /** The newest pull request of each branch; null when unknown (gh offline or failing). Empty without gh or GitHub. */
  pullRequests: ReadonlyMap<string, { number: number; state: 'open' | 'merged' | 'closed' }> | null;
  /** Open pull requests with failing checks, by branch; null when unknown. */
  failing: ReadonlyMap<string, { pr: number; failed: number }> | null;
}

/** A session of the repository: where it works and on which branch it last was. */
export interface BranchSession {
  id: string;
  cwd: string | null;
  branch: string | null;
  updatedAt: number;
}

const newest = (sessions: readonly BranchSession[]) => sessions.reduce<BranchSession | null>((best, s) => (!best || s.updatedAt > best.updatedAt ? s : best), null);

/** Each owner's loose ends in this repository, git's first. `ownerOf` maps a pipeline step to its run row or parent. */
export function attributeLooseEnds(repo: RepoFacts, sessions: readonly BranchSession[], ownerOf: (sessionId: string) => string = (id) => id): Map<string, GitLooseEnd[]> {
  const out = new Map<string, GitLooseEnd[]>();
  const add = (session: BranchSession | null, end: GitLooseEnd) => {
    if (!session) return;
    const owner = ownerOf(session.id);
    out.set(owner, [...(out.get(owner) ?? []), end]);
  };
  const paths = repo.checkouts.map((c) => c.path);
  /** The checkout a folder is in: the deepest one (worktrees under `.claude/worktrees/` sit inside the main one). */
  const checkoutOf = (cwd: string | null) => (cwd ? (paths.filter((p) => isSameOrInside(cwd, p)).sort((a, b) => b.length - a.length)[0] ?? null) : null);
  const onBranch = (branch: string) => newest(sessions.filter((s) => s.branch === branch));
  const shared = (branch: string | null): branch is string => branch !== null && branch !== repo.baseBranch;

  for (const checkout of repo.checkouts) {
    if (checkout.uncommitted > 0 && checkout.branch) {
      add(newest(sessions.filter((s) => s.branch === checkout.branch && checkoutOf(s.cwd) === checkout.path)), { kind: 'uncommitted', files: checkout.uncommitted });
    }
  }
  for (const checkout of repo.checkouts) {
    const branch = checkout.branch;
    if (!shared(branch)) continue;
    const pr = repo.pullRequests?.get(branch) ?? null;
    if (checkout.unpushed > 0 && pr?.state !== 'merged') add(onBranch(branch), { kind: 'unpushed', commits: checkout.unpushed });
    const failing = repo.failing?.get(branch);
    if (failing && pr?.state === 'open' && failing.pr === pr.number) add(onBranch(branch), { kind: 'checks-failing', pr: failing.pr, failed: failing.failed });
    if (pr?.state === 'closed') add(onBranch(branch), { kind: 'pr-closed', pr: pr.number });
  }
  return out;
}

/**
 * The loose ends to keep for the owners of one repository after a look: what the look found, except what it couldn't
 * know. Unknown is never "none", so a row doesn't jump from Done to Open and back:
 * - git failed (`git: false`): every owner keeps what it had;
 * - GitHub unknown (`github: false`): uncommitted changes are new, the rest (which a merged pull request decides) is
 *   kept as it was.
 */
export function mergeLooseEnds(
  previous: ReadonlyMap<string, readonly GitLooseEnd[]>,
  found: ReadonlyMap<string, readonly GitLooseEnd[]>,
  owners: Iterable<string>,
  known: { git: boolean; github: boolean },
): Map<string, GitLooseEnd[]> {
  const out = new Map<string, GitLooseEnd[]>();
  for (const owner of owners) {
    const before = previous.get(owner) ?? [];
    const now = found.get(owner) ?? [];
    const ends = !known.git ? [...before] : known.github ? [...now] : [...now.filter((e) => e.kind === 'uncommitted'), ...before.filter((e) => e.kind !== 'uncommitted')];
    if (ends.length) out.set(owner, ends);
  }
  return out;
}

/** The owners whose loose ends changed between two maps (added, changed or gone). */
export function changedOwners(before: ReadonlyMap<string, readonly GitLooseEnd[]>, after: ReadonlyMap<string, readonly GitLooseEnd[]>): string[] {
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].filter((id) => !sameLooseEnds(before.get(id) ?? [], after.get(id) ?? []));
}

/**
 * Whether a session's repository is worth a look: it is listed, or it went to Done by itself (inactive) in the last few
 * days, which a loose end would have kept it out of. Marked done by you, it stays where you put it.
 */
export function isCandidate(s: { listed: boolean; archivedAt: number | null; updatedAt: number; working: boolean }, now: number, archiveAfterDays: number, recentDays = 3): boolean {
  if (s.listed) return true;
  const byHand = s.archivedAt !== null && (s.archivedAt >= s.updatedAt || s.working);
  if (byHand) return false;
  const doneSince = s.updatedAt + archiveAfterDays * 24 * 60 * 60 * 1000;
  return now - doneSince < recentDays * 24 * 60 * 60 * 1000;
}
