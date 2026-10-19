import type { GithubItemType, GithubPrDetail, WorktreeStatus } from '@switchboard/protocol/client';

/**
 * New session from an issue or pull request, as plain functions: the worktree's name, the prompt, where a pull request
 * can be worked on, and when Switchboard can't push it back. Plain TypeScript, so it is tested without a window.
 */

/** How long the title part of a worktree's name gets, at most. */
export const SLUG_MAX = 40;

/**
 * A title as the end of a worktree's name: lowercase, ASCII only (accents dropped), words joined by `-`, cut at 40
 * characters on a word boundary. Only letters and digits stay, so it is a valid folder name on macOS and Windows.
 */
export function slugOf(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > SLUG_MAX) break;
    slug = next;
  }
  // One word longer than the limit is cut rather than left out.
  return slug || (words[0] ?? '').slice(0, SLUG_MAX);
}

/** `issue-32-start-a-session-from-a-github`, `pr-151-start-sessions-from-issues`. */
export function worktreeNameFor(type: GithubItemType, number: number, title: string): string {
  const slug = slugOf(title);
  return `${type === 'pr' ? 'pr' : 'issue'}-${number}${slug ? `-${slug}` : ''}`;
}

/** `name`, or `name-2`, `name-3` and on while a worktree or its branch already has the name. */
export function uniqueWorktreeName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  let n = 2;
  while (used.has(`${name}-${n}`.toLowerCase())) n++;
  return `${name}-${n}`;
}

/** The worktree names in use in a repository: its worktrees' folders, and the `worktree-<name>` branches. */
export function takenWorktreeNames(worktrees: ReadonlyArray<{ name: string; isMain: boolean }>, branches: readonly string[]): string[] {
  return [...worktrees.filter((w) => !w.isMain).map((w) => w.name), ...branches.filter((b) => b.startsWith('worktree-')).map((b) => b.slice('worktree-'.length))];
}

/** What New session's message box starts with: "Fix #32: <title>", "Work on #151: <title>". */
export const startPrompt = (type: GithubItemType, number: number, title: string) => `${type === 'pr' ? 'Work on' : 'Fix'} #${number}: ${title.replace(/\s+/g, ' ').trim()}`;

/** The line under New session's message box while it is filled in from an issue or pull request. */
export const startNote = (type: GithubItemType) => `Nothing runs until you start. The ${type === 'pr' ? 'pull request' : 'issue'} goes to Claude as context to read, not as instructions.`;

/**
 * The local branch a pull request is worked on in a new worktree: its own branch name, or `owner/branch` for one from
 * a fork (so a fork's `main` or `patch-1` never lands on a branch of yours).
 */
export const prBranch = (pr: Pick<GithubPrDetail, 'headRefName' | 'isCrossRepository' | 'headOwner'>) =>
  pr.isCrossRepository && pr.headOwner ? `${pr.headOwner}/${pr.headRefName}` : pr.headRefName;

/** Where New session works on a pull request. */
export type PrWhere = 'current' | 'worktree';

/** Why Current checkout can't take the pull request now (the folder has changes), or null when it can. */
export function currentCheckoutBlocked(status: Pick<WorktreeStatus, 'uncommitted'> | null): string | null {
  if (!status || status.uncommitted === 0) return null;
  return `${status.uncommitted === 1 ? '1 changed file' : `${status.uncommitted} changed files`}. Commit or stash them first.`;
}

/**
 * Whether Switchboard can't push a pull request back from where it is worked on: one from a fork you can't push to,
 * and any fork's in a new worktree (its branch there tracks nothing, so a push would go to this repository instead).
 * Push and Create pull request are then off in that session. Current checkout uses `gh pr checkout`, which sets up a
 * fork you can push to.
 */
export const readOnlyFork = (pr: Pick<GithubPrDetail, 'isCrossRepository' | 'canPush'>, where: PrWhere) => pr.isCrossRepository && (!pr.canPush || where === 'worktree');

/** The caution line in the Where menu for a pull request Switchboard can't push back. */
export const forkCaution = (number: number) => `#${number} is from a fork. Claude can change it here, but Switchboard can't push it back. Create pull request is off for it.`;

/** A link's or the list's item from another repository than the project's. */
export const otherRepository = (type: GithubItemType, projectName: string) => `This ${type === 'pr' ? 'pull request' : 'issue'} is from another repository than ${projectName}.`;

/** The banner over New session when a link filled it in. */
export const linkBanner = (type: GithubItemType, number: number) => `Opened from a link with ${type === 'pr' ? 'pull request' : 'issue'} #${number}. Check the prompt, then start.`;
/** What the banner adds when the link also asked to start on its own. */
export const NO_AUTOSTART = 'Links with an issue or pull request never start on their own.';
