/**
 * Pages in the browser a session can start from (the address bar's Start session and the page menu's entry): a pull
 * request or an issue on GitHub. Pure, so main (the page menu, the check before New session opens) and the renderer
 * (the button) read a page the same way.
 */

/** A GitHub pull request or issue a page shows. */
export interface GithubPage {
  /** `owner/name`, as in the address. */
  repo: string;
  type: 'pr' | 'issue';
  number: number;
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
/** Owners in GitHub's own pages (`/orgs/acme/…`), never a repository's. */
const NOT_OWNERS = new Set(['orgs', 'settings', 'notifications', 'marketplace', 'sponsors', 'topics', 'apps', 'users', 'search']);

/**
 * The pull request or issue at `url` (any of its tabs: `/pull/151/files`, `/issues/32#issuecomment-…`), or null for
 * any other page. Only github.com over HTTPS.
 */
export function githubPage(url: string): GithubPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.port) return null;
  const [owner, name, kind, number] = parsed.pathname.split('/').filter(Boolean);
  if (!owner || !name || !number || !NAME.test(owner) || !NAME.test(name) || NOT_OWNERS.has(owner.toLowerCase()) || name === '.' || name === '..') return null;
  if (kind !== 'pull' && kind !== 'issues') return null;
  if (!/^[1-9]\d{0,8}$/.test(number)) return null;
  return { repo: `${owner}/${name}`, type: kind === 'pull' ? 'pr' : 'issue', number: Number(number) };
}

/** The page menu's entry and the button's tooltip. */
export const startFromPageLabel = (page: GithubPage) => `Start session from ${page.type === 'pr' ? 'pull request' : 'issue'} #${page.number}`;
