import { git } from './gitChanges.ts';

/**
 * The GitHub `owner/name` a remote URL points at, lowercased; null for other hosts.
 * Understands the forms git accepts: `git@github.com:o/n.git`, `https://github.com/o/n`,
 * `ssh://git@github.com/o/n.git` and `git://github.com/o/n`.
 */
export function githubRepoFromUrl(url: string): string | null {
  return githubRepoAsWritten(url)?.toLowerCase() ?? null;
}

/** Like `githubRepoFromUrl`, but keeps the case the remote was written in (for showing and linking). */
function githubRepoAsWritten(url: string): string | null {
  const match = /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|(?:[^@/]+@)?github\.com:)([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Remote name → URL, from the checkout's git config (empty when it isn't a git checkout). */
async function remoteUrls(cwd: string): Promise<Map<string, string>> {
  const out = await git(cwd, ['config', '--local', '--get-regexp', '^remote\\..*\\.url$'], { allowExitCodes: [1, 128] }).catch(() => '');
  const remotes = new Map<string, string>();
  for (const line of out.split('\n')) {
    const match = /^remote\.(.+)\.url (.+)$/.exec(line.trim());
    if (match) remotes.set(match[1]!, match[2]!);
  }
  return remotes;
}

/** The GitHub repositories a checkout's remotes point at (none when it isn't a git checkout). */
export async function githubRepos(cwd: string): Promise<string[]> {
  const repos = [...(await remoteUrls(cwd)).values()].map(githubRepoFromUrl).filter((repo): repo is string => repo !== null);
  return [...new Set(repos)];
}

/** The GitHub repository a checkout is (`owner/name`, lowercased): `origin`'s when it is on GitHub, else the first that is; null without one. */
export async function githubRepo(cwd: string): Promise<string | null> {
  const remotes = await remoteUrls(cwd);
  const origin = remotes.get('origin');
  const fromOrigin = origin ? githubRepoFromUrl(origin) : null;
  return fromOrigin ?? [...remotes.values()].map(githubRepoFromUrl).find((repo) => repo !== null) ?? null;
}

/**
 * The checkout on github.com: the remote the current branch tracks when that one is on GitHub, else
 * `origin`, else any GitHub remote. The link opens the branch when it tracks one on that remote (so a
 * branch that was never pushed doesn't land on a 404), and the repository otherwise. Null when no
 * remote is on GitHub.
 */
export async function githubPage(cwd: string): Promise<{ repo: string; url: string } | null> {
  const remotes = await remoteUrls(cwd);
  const onGithub = [...remotes].flatMap(([name, url]) => {
    const repo = githubRepoAsWritten(url);
    return repo ? [{ name, repo }] : [];
  });
  if (onGithub.length === 0) return null;
  const head = (await git(cwd, ['symbolic-ref', '-q', 'HEAD'], { allowExitCodes: [1, 128] }).catch(() => '')).trim();
  const [upstreamRemote = '', upstreamBranch = ''] = head
    ? (await git(cwd, ['for-each-ref', '--format=%(upstream:remotename)%09%(upstream:lstrip=3)', head]).catch(() => '')).trim().split('\t')
    : [];
  const remote = onGithub.find((r) => r.name === upstreamRemote) ?? onGithub.find((r) => r.name === 'origin') ?? onGithub[0]!;
  const base = `https://github.com/${remote.repo}`;
  const branch = remote.name === upstreamRemote ? upstreamBranch : '';
  return { repo: remote.repo, url: branch ? `${base}/tree/${branch.split('/').map(encodeURIComponent).join('/')}` : base };
}

/**
 * The first folder, in the order given, with a remote on GitHub's `owner/name`. Folders are checked a
 * few at a time so a long list doesn't start hundreds of git processes, and the search stops at the
 * first batch with a match.
 */
export async function findCheckout(folders: string[], repo: string, reposOf: (cwd: string) => Promise<string[]> = githubRepos, batch = 12): Promise<string | null> {
  const wanted = repo.toLowerCase().replace(/\.git$/, '');
  for (let i = 0; i < folders.length; i += batch) {
    const slice = folders.slice(i, i + batch);
    const found = await Promise.all(slice.map(async (cwd) => (await reposOf(cwd)).includes(wanted)));
    const index = found.indexOf(true);
    if (index >= 0) return slice[index]!;
  }
  return null;
}
