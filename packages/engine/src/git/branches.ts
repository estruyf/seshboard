import type { BranchDeleteItem, BranchDeleteResult, BranchEntry, BranchList, LocalBranch, RemoteBranch, WorktreePullRequest } from '@switchboard/protocol';
import { baseBranch, git, GitError } from './gitChanges.ts';
import { checkoutsOf, mapLimit, saveRecoveryRef } from './worktrees.ts';

/** One line of `for-each-ref` over `refs/heads` and `refs/remotes`. */
export interface RefLine {
  ref: string;
  sha: string;
  /** Full ref of the upstream (`refs/remotes/origin/x`), empty without one. */
  upstream: string;
  /** `ahead 1, behind 2`, `gone` or empty. */
  track: string;
  committedAt: number | null;
  author: string;
  /** The target of a symbolic ref (`refs/remotes/origin/HEAD`). */
  symref: string;
  /** The remote `git push` would use for the branch, when configured. */
  pushRemote: string;
  subject: string;
  /** `<ahead> <behind>` against the base, when this git can say (2.41+). */
  aheadBehind: string | null;
}

const FIELDS = ['%(refname)', '%(objectname)', '%(upstream)', '%(upstream:track,nobracket)', '%(committerdate:unix)', '%(authorname)', '%(symref)', '%(push:remotename)', '%(subject)'];

/** Parses the output of `for-each-ref` with `FIELDS` (and `%(ahead-behind:…)` last, when asked). */
export function parseRefLines(output: string, withAheadBehind: boolean): RefLine[] {
  const lines: RefLine[] = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const [ref, sha, upstream, track, date, author, symref, pushRemote, subject, aheadBehind] = line.split('\0');
    if (!ref || !sha) continue;
    lines.push({
      ref,
      sha,
      upstream: upstream ?? '',
      track: track ?? '',
      committedAt: Number(date) * 1000 || null,
      author: author ?? '',
      symref: symref ?? '',
      pushRemote: pushRemote ?? '',
      subject: subject ?? '',
      aheadBehind: withAheadBehind ? (aheadBehind ?? null) : null,
    });
  }
  return lines;
}

/** `ahead 2, behind 1` → { ahead: 2, behind: 1 }; nothing in it means in sync. */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  return { ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0), gone: /\bgone\b/.test(track) };
}

/** Splits `refs/remotes/<remote>/<branch>` by the longest remote name that fits (remote names may hold slashes). */
export function splitRemoteRef(ref: string, remotes: readonly string[]): { remote: string; branch: string } | null {
  const short = ref.replace(/^refs\/remotes\//, '');
  const remote = [...remotes].sort((a, b) => b.length - a.length).find((r) => short.startsWith(`${r}/`));
  return remote ? { remote, branch: short.slice(remote.length + 1) } : null;
}

/**
 * Every branch of the repository at `root`: each local branch with its copy on a remote (its upstream, or the branch
 * of the same name on the remote it pushes to), then the remote branches nobody has here. `pullRequests` maps
 * branch names to their newest pull request (null: unknown, `gh` isn't there).
 */
export async function listBranchOverview(root: string, options: { pullRequests?: ReadonlyMap<string, WorktreePullRequest> | null } = {}): Promise<BranchList> {
  const checkouts = checkoutsOf(await git(root, ['worktree', 'list', '--porcelain']));
  const mainPath = checkouts[0]?.path ?? root;
  const checkedOut = new Map(checkouts.filter((w) => w.branch && !w.prunable).map((w) => [w.branch!, w.path]));
  const base = await baseBranch(mainPath);
  const baseRef = base
    ? (await git(mainPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], { allowExitCodes: [1] }).catch(() => '')).trim()
      ? `refs/remotes/origin/${base}`
      : (await git(mainPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`], { allowExitCodes: [1] }).catch(() => '')).trim()
        ? `refs/heads/${base}`
        : null
    : null;
  const remotes = (await git(mainPath, ['remote'])).split('\n').filter(Boolean);

  // One read for every ref. `%(ahead-behind:…)` (git 2.41+) counts against the base in the same pass; an older git
  // refuses the field, and the counts are asked per branch instead.
  const read = (withAheadBehind: boolean) =>
    git(mainPath, ['for-each-ref', `--format=${[...FIELDS, ...(withAheadBehind ? [`%(ahead-behind:${baseRef})`] : [])].join('%00')}`, 'refs/heads', 'refs/remotes']).then((out) => parseRefLines(out, withAheadBehind));
  let refs: RefLine[];
  try {
    refs = await read(baseRef !== null);
  } catch (error) {
    if (!baseRef) throw error;
    refs = await read(false);
  }
  const count = async (range: string[]) => Number((await git(mainPath, ['rev-list', '--count', ...range], { allowExitCodes: [128] }).catch(() => '0')).trim() || 0);
  const againstBase = async (line: RefLine): Promise<{ ahead: number | null; behind: number | null }> => {
    if (!baseRef) return { ahead: null, behind: null };
    const [ahead, behind] = line.aheadBehind?.split(' ').map(Number) ?? [];
    if (Number.isFinite(ahead) && Number.isFinite(behind)) return { ahead: ahead!, behind: behind! };
    const [a, b] = await Promise.all([count([`${baseRef}..${line.sha}`]), count([`${line.sha}..${baseRef}`])]);
    return { ahead: a, behind: b };
  };

  // Each remote's default branch, from `refs/remotes/<remote>/HEAD`, which is left out of the list itself.
  const defaults = new Set(refs.filter((r) => r.ref.startsWith('refs/remotes/') && r.symref).map((r) => r.symref));
  const remoteLines = new Map(refs.filter((r) => r.ref.startsWith('refs/remotes/') && !r.symref).map((r) => [r.ref, r]));
  const remoteOf = (line: RefLine): RemoteBranch | null => {
    const split = splitRemoteRef(line.ref, remotes);
    return split ? { remote: split.remote, ref: `${split.remote}/${split.branch}`, sha: line.sha, isDefault: defaults.has(line.ref) } : null;
  };
  const fallbackRemote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);
  const used = new Set<string>();

  const locals = refs.filter((r) => r.ref.startsWith('refs/heads/'));
  const localEntries = await mapLimit(locals, 6, async (line): Promise<BranchEntry> => {
    const name = line.ref.slice('refs/heads/'.length);
    const track = parseTrack(line.track);
    const upstreamRef = line.upstream && !track.gone ? line.upstream : null;
    const upstream = upstreamRef ? upstreamRef.replace(/^refs\/(remotes|heads)\//, '') : null;
    // Its copy on a remote: its upstream, unless that is the base (`git switch -c fix origin/main` tracks main, and
    // main on the remote is no copy of fix); otherwise the branch of the same name where it would be pushed.
    const upstreamLine = upstreamRef ? remoteLines.get(upstreamRef) : undefined;
    const upstreamIsBase = upstreamLine && (defaults.has(upstreamLine.ref) || splitRemoteRef(upstreamLine.ref, remotes)?.branch === base) && name !== base;
    const pushTo = line.pushRemote || fallbackRemote;
    const remoteLine = upstreamLine && !upstreamIsBase ? upstreamLine : track.gone || !pushTo ? undefined : remoteLines.get(`refs/remotes/${pushTo}/${name}`);
    if (remoteLine) used.add(remoteLine.ref);
    const { ahead, behind } = await againstBase(line);
    const isBase = name === base;
    // Nothing to lose when it is all in the base, or all on its upstream; otherwise count what no remote has.
    const unpushed = ahead === 0 || (upstream && track.ahead === 0) ? 0 : await count([line.sha, ...(baseRef ? [`^${baseRef}`] : []), '--not', '--remotes']);
    // A branch that never got a commit of its own is in the base too, but "merged" would be news to you: its oldest
    // reflog entry (where it was made) is still its tip. One made from its remote copy holds that copy's commits.
    let neverCommitted = false;
    if (ahead === 0 && !isBase && !remoteLine) {
      const reflog = (await git(mainPath, ['reflog', 'show', '--format=%H', line.ref], { allowExitCodes: [128] }).catch(() => '')).trim().split('\n').filter(Boolean);
      neverCommitted = reflog.length > 0 && reflog.at(-1) === line.sha;
    }
    const local: LocalBranch = {
      sha: line.sha,
      upstream,
      upstreamGone: track.gone,
      aheadOfUpstream: upstream ? track.ahead : null,
      behindUpstream: upstream ? track.behind : null,
      unpushed,
      checkedOutIn: checkedOut.get(line.ref) ?? null,
      neverCommitted,
    };
    return {
      name,
      local,
      remote: remoteLine ? remoteOf(remoteLine) : null,
      isBase,
      ahead: isBase ? null : ahead,
      behind: isBase ? null : behind,
      merged: !isBase && ahead === 0 && !neverCommitted,
      pr: isBase ? null : (options.pullRequests?.get(name) ?? null),
      lastCommitAt: line.committedAt,
      subject: line.subject || null,
      author: line.author || null,
    };
  });

  const remoteOnly = await mapLimit(
    [...remoteLines.values()].filter((line) => !used.has(line.ref)),
    6,
    async (line): Promise<BranchEntry | null> => {
      const remote = remoteOf(line);
      if (!remote) return null;
      const name = remote.ref.slice(remote.remote.length + 1);
      const isBase = remote.isDefault || (remote.remote === 'origin' && name === base);
      const { ahead, behind } = await againstBase(line);
      return {
        name,
        local: null,
        remote,
        isBase,
        ahead: isBase ? null : ahead,
        behind: isBase ? null : behind,
        merged: !isBase && ahead === 0,
        // Pull requests are origin's; a fork's branch of the same name isn't the same branch.
        pr: isBase || remote.remote !== (fallbackRemote ?? 'origin') ? null : (options.pullRequests?.get(name) ?? null),
        lastCommitAt: line.committedAt,
        subject: line.subject || null,
        author: line.author || null,
      };
    },
  );

  return { root: mainPath, baseBranch: base, remotes, pullRequests: options.pullRequests != null, branches: [...localEntries, ...remoteOnly.filter((e): e is BranchEntry => e !== null)] };
}

/** `git fetch --all --prune`: brings every remote's branches up to date and drops the ones deleted there. */
export async function fetchAllRemotes(root: string, env: Record<string, string>): Promise<void> {
  await git(root, ['fetch', '--all', '--prune', '--quiet'], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000 });
}

/** Deleting a branch was refused before anything happened. */
export class BranchRefusal extends GitError {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Why a branch's local copy must not be deleted, or null. */
export function localRefusal(entry: BranchEntry): BranchRefusal | null {
  if (entry.isBase) return new BranchRefusal('BASE', `${entry.name} is the base branch. It is never deleted.`);
  if (!entry.local) return new BranchRefusal('NOT_FOUND', `There is no local branch ${entry.name}.`);
  if (entry.local.checkedOutIn) return new BranchRefusal('CHECKED_OUT', `It is checked out in ${entry.local.checkedOutIn}. Switch branches there, or remove the worktree first.`);
  return null;
}

/**
 * Why a branch must not be deleted on its remote, or null. `base` is the base branch's name (never deleted on any
 * remote); `openPr` is the branch's open pull request, when known.
 */
export function remoteRefusal(entry: BranchEntry, base: string | null, openPr: WorktreePullRequest | null): BranchRefusal | null {
  if (!entry.remote) return new BranchRefusal('NOT_FOUND', `${entry.name} isn't on a remote.`);
  if (entry.isBase || entry.remote.ref.slice(entry.remote.remote.length + 1) === base) return new BranchRefusal('BASE', `${entry.remote.ref} is the base branch. It is never deleted.`);
  if (entry.remote.isDefault) return new BranchRefusal('DEFAULT_BRANCH', `${entry.remote.ref} is the remote's default branch.`);
  if (openPr) return new BranchRefusal('OPEN_PR', `Pull request #${openPr.number} is open for it. Deleting the branch on the remote would close it.`);
  return null;
}

/**
 * Deletes branches of the repository at `root`, one after the other, each judged on a fresh list: the local copy with
 * `git branch -D` (after a recovery ref, when asked), then the remote copy with `git push <remote> --delete`. One
 * failure doesn't stop the rest: every item gets its own result. `openPullRequest` says whether a branch has an open
 * pull request (deleting it on the remote would close it). `env` is the login shell's, so pushing can authenticate.
 */
export async function deleteBranches(
  root: string,
  items: readonly BranchDeleteItem[],
  hooks: { env: Record<string, string>; openPullRequest(name: string): WorktreePullRequest | null; now?: Date },
): Promise<BranchDeleteResult[]> {
  const { root: mainPath, baseBranch: base, branches } = await listBranchOverview(root);
  const results: BranchDeleteResult[] = [];
  for (const item of items) {
    const result: BranchDeleteResult = { name: item.name, ok: false, code: null, error: null, localDeleted: false, remoteDeleted: false, recoveryRef: null };
    results.push(result);
    try {
      // The local branch by name; the remote one by its ref, since a remote-only row may share a name with a local one.
      const local = item.local ? branches.find((b) => b.local && b.name === item.name) : undefined;
      const remote = item.remoteRef ? branches.find((b) => b.remote?.ref === item.remoteRef) : undefined;
      if (item.local) {
        const refusal = local ? localRefusal(local) : new BranchRefusal('NOT_FOUND', `There is no local branch ${item.name}.`);
        if (refusal) throw refusal;
      }
      if (item.remoteRef) {
        const refusal = remote ? remoteRefusal(remote, base, hooks.openPullRequest(remote.name)) : new BranchRefusal('NOT_FOUND', `${item.remoteRef} is no longer on the remote. Refresh to see the branches as they are now.`);
        if (refusal) throw refusal;
      }
      if (local?.local) {
        if (item.recoveryRef) result.recoveryRef = await saveRecoveryRef(mainPath, local.name, local.local.sha, hooks.now ?? new Date());
        await git(mainPath, ['branch', '-D', local.name]);
        result.localDeleted = true;
      }
      if (remote?.remote) {
        const branch = remote.remote.ref.slice(remote.remote.remote.length + 1);
        // Never let a branch name be read as an option.
        if (branch.startsWith('-')) throw new GitError(`Not a branch name: ${branch}`);
        await git(mainPath, ['push', '--quiet', remote.remote.remote, '--delete', `refs/heads/${branch}`], { env: { ...hooks.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000 });
        result.remoteDeleted = true;
      }
      result.ok = true;
    } catch (error) {
      result.code = error instanceof BranchRefusal ? error.code : 'GIT_FAILED';
      result.error = (error as Error).message;
    }
  }
  return results;
}
