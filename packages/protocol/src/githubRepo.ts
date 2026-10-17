import type { RepoBrings } from './clone.ts';

/**
 * Clone from GitHub: the repository a typed or pasted text names, and the folder it goes in. Plain TypeScript (no
 * zod), so the windows check what's typed with the same rules the engine applies.
 */

/** A GitHub repository, and the branch a `/tree/<branch>` URL names (null: its default branch). */
export interface GithubRepoRef {
  owner: string;
  name: string;
  branch: string | null;
}

export type GithubRepoParse = { ok: true; repo: GithubRepoRef } | { ok: false; error: string };

export const ONLY_GITHUB = 'Only GitHub repositories can be cloned here.';
export const NOT_A_REPO = 'That isn’t a GitHub repository. Paste its URL, such as https://github.com/owner/name.';

/** GitHub's rules: an account is letters, digits and single hyphens (39 at most); a repository letters, digits, `.`, `_` and `-`. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** A branch name git would take (`git check-ref-format --branch`, the parts that matter for a typed one). */
export function isBranchName(branch: string): boolean {
  return (
    branch.length > 0 &&
    branch.length <= 250 &&
    !branch.startsWith('-') &&
    !branch.startsWith('/') &&
    !branch.endsWith('/') &&
    !branch.endsWith('.') &&
    !branch.endsWith('.lock') &&
    !branch.includes('..') &&
    !branch.includes('//') &&
    !branch.includes('@{') &&
    !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(branch)
  );
}

function repoOf(owner: string | undefined, rawName: string | undefined, branch: string | null): GithubRepoParse {
  const name = rawName?.replace(/\.git$/i, '');
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return { ok: false, error: NOT_A_REPO };
  if (branch !== null && !isBranchName(branch)) return { ok: false, error: `“${branch}” isn’t a branch name git takes.` };
  return { ok: true, repo: { owner, name, branch } };
}

/** `%2F` and friends in a URL's path; the text as it is when it isn't valid encoding. */
function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * The repository a text names: `https://github.com/owner/name` (with or without `.git`, `www.`, the scheme or a
 * trailing slash), `git@github.com:owner/name.git`, `ssh://git@github.com/owner/name`, and `owner/name` when
 * `shorthand` is on. `https://github.com/owner/name/tree/<branch>` names a branch too; other pages of a repository
 * (an issue, a file) name the repository. Null when the text doesn't look like a repository at all (with
 * `shorthand` off: anything that isn't a URL), so a field can tell "not meant as one" from "wrong".
 */
export function parseGithubRepo(input: string, { shorthand = true }: { shorthand?: boolean } = {}): GithubRepoParse | null {
  const text = input.trim();
  if (!text) return null;

  const scp = /^(?:[^@\s/]+@)?([A-Za-z0-9.-]+):(?!\/\/)([^\s]+)$/.exec(text);
  if (scp && /^[^@\s/]+@/.test(text)) {
    if (scp[1]!.toLowerCase() !== 'github.com') return { ok: false, error: ONLY_GITHUB };
    const [owner, name, ...rest] = scp[2]!.replace(/\/+$/, '').split('/');
    return rest.length ? { ok: false, error: NOT_A_REPO } : repoOf(owner, name, null);
  }

  const url = /^(?:(https?|ssh|git):\/\/)?(?:[^@\s/]+@)?((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?::\d+)?(\/[^\s]*)?$/i.exec(text);
  if (url && (url[1] || url[3])) {
    const host = url[2]!.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return { ok: false, error: ONLY_GITHUB };
    const path = (url[3] ?? '').replace(/[?#].*$/, '');
    const [owner, name, page, ...rest] = path.split('/').filter(Boolean).map(decode);
    const branch = page === 'tree' && rest.length ? rest.join('/') : null;
    return repoOf(owner, name, branch);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return { ok: false, error: ONLY_GITHUB };

  if (!shorthand) return null;
  const short = /^([^\s/]+)\/([^\s/]+)$/.exec(text);
  if (short) return repoOf(short[1], short[2], null);
  return { ok: false, error: NOT_A_REPO };
}

/** `owner/name`, as the UI shows a repository. */
export const repoLabel = (repo: Pick<GithubRepoRef, 'owner' | 'name'>) => `${repo.owner}/${repo.name}`;

/**
 * Why a folder name can't be used for a clone, or null when it can: one folder (no separators), not `.` or `..`, and
 * on Windows none of the characters it refuses, no trailing dot or space and no reserved device name.
 */
export function cloneFolderProblem(name: string, platform: string): string | null {
  if (!name.trim()) return 'Give the folder a name.';
  if (name !== name.trim()) return 'A folder name can’t start or end with a space.';
  if (name.length > 255) return 'That name is too long for a folder.';
  if (name === '.' || name === '..') return 'Choose another name for the folder.';
  if (/[/\\]/.test(name)) return 'A folder name can’t contain / or \\.';
  if (/[\x00-\x1f]/.test(name)) return 'A folder name can’t contain control characters.';
  if (platform === 'win32') {
    if (/[<>:"|?*]/.test(name)) return 'A folder name can’t contain < > : " | ? or *.';
    if (/[. ]$/.test(name)) return 'A folder name can’t end with a dot on Windows.';
    if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i.test(name)) return 'Windows keeps that name for itself. Choose another one.';
  }
  return null;
}

/** Anything in `brings`: a session there would run something without asking first. */
export const bringsAnything = (brings: RepoBrings | null | undefined): brings is RepoBrings =>
  !!brings && (brings.hooks.length > 0 || brings.mcpServers.length > 0 || brings.allow.length > 0 || brings.plugins.length > 0 || brings.settings.length > 0);
