/**
 * Pages in the browser a session can start from (the address bar's Start session and the page menu's entries): the
 * site actions of Settings › Browser, GitHub's pull requests and issues built in. Pure, so main (the page menu, the
 * check before New session opens) and the renderer (the button, Settings) read a page the same way.
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


/**
 * A site action (Settings › Browser › Site actions): on the pages it names, the browser's address bar offers Start
 * session and the page menu lists it. It opens New session with its folder and prompt, and never starts on its own.
 * The two built-in ones (`github-pr`, `github-issue`) read GitHub's addresses and look for a checkout of the page's
 * repository, through the same steps as a `pr=` or `issue=` link. You can turn them off and change their name and
 * prompt. Your own ones name their pages, a folder (or ask for one) and a prompt.
 */
export interface SiteAction {
  /** `github-pr` and `github-issue` for the built-in ones, else made when added (`site-…`). */
  id: string;
  /** The entry in the page menu and the address bar's menu. */
  name: string;
  /**
   * The pages it is offered on: an address where `*` stands for any text, such as `https://*.sentry.io/issues/*`. Its
   * query and `#` part are ignored unless it has a `?` itself. Empty for the built-in ones.
   */
  pages: string;
  /** The project's folder New session opens in; null opens the folder list. The built-in ones ignore it. */
  folder: string | null;
  /**
   * The prompt, with `{url}`, `{title}` and `{selection}` filled in (the built-in ones add `{repo}` and `{number}`).
   * Empty: the built-in ones fill in their own ("Work on #151: …"), your own ones leave the box empty.
   */
  prompt: string;
  enabled: boolean;
}

export const GITHUB_PR_ACTION = 'github-pr';
export const GITHUB_ISSUE_ACTION = 'github-issue';
export const SITE_ACTIONS_MAX = 40;
export const SITE_ACTION_NAME_MAX = 80;
export const SITE_ACTION_PAGES_MAX = 500;
/** As much as a link may fill in (`MAX_LINK_PROMPT` in main's `deepLink.ts`). */
export const SITE_ACTION_PROMPT_MAX = 5000;
/** The words a prompt can use, as Settings lists them. */
export const SITE_PROMPT_FIELDS = ['url', 'title', 'selection'] as const;
export const GITHUB_PROMPT_FIELDS = ['url', 'title', 'selection', 'repo', 'number'] as const;

/** The built-in actions, as they come. */
export const DEFAULT_SITE_ACTIONS: readonly SiteAction[] = [
  { id: GITHUB_PR_ACTION, name: 'Start session from this pull request', pages: '', folder: null, prompt: '', enabled: true },
  { id: GITHUB_ISSUE_ACTION, name: 'Start session from this issue', pages: '', folder: null, prompt: '', enabled: true },
];

export const isBuiltInSiteAction = (id: string) => id === GITHUB_PR_ACTION || id === GITHUB_ISSUE_ACTION;

/** The built-in action as it comes, for Reset; null for one of yours. */
export const defaultSiteAction = (id: string): SiteAction | null => DEFAULT_SITE_ACTIONS.find((action) => action.id === id) ?? null;

/** Why `pages` can't be saved, or null when it can. */
export function sitePagesProblem(pages: string): string | null {
  const text = pages.trim();
  if (!text) return 'Name the pages, such as https://example.com/issues/*.';
  if (text.length > SITE_ACTION_PAGES_MAX) return `Keep the pages under ${SITE_ACTION_PAGES_MAX} characters.`;
  if (/\s/.test(text)) return 'The pages have no spaces.';
  const match = /^https?:\/\/([^/?#]+)/i.exec(text);
  if (!match) return 'Start the pages with https:// or http://.';
  if (!/^[A-Za-z0-9*.:[\]-]+$/.test(match[1]!) || match[1]!.replace(/\*/g, '').replace(/[.:-]/g, '') === '') return 'Give the pages a site, such as https://*.example.com/*.';
  return null;
}

const escapeRegex = (text: string) => text.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');

/** Whether `url` is one of `pages` (see `SiteAction.pages`). */
export function pageMatches(pages: string, url: string): boolean {
  if (sitePagesProblem(pages)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const pattern = pages.trim();
  parsed.hash = '';
  if (!pattern.includes('?')) parsed.search = '';
  const pattern$ = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`, 'i');
  // `https://example.com` and `https://example.com/` are the same page.
  const href = parsed.href;
  return pattern$.test(href) || (href.endsWith('/') && pattern$.test(href.slice(0, -1)));
}

/** The enabled actions for the page at `url`, in their order. */
export function siteActionsFor(url: string, actions: readonly SiteAction[]): SiteAction[] {
  const github = githubPage(url);
  return actions.filter((action) => {
    if (!action.enabled) return false;
    if (action.id === GITHUB_PR_ACTION) return github?.type === 'pr';
    if (action.id === GITHUB_ISSUE_ACTION) return github?.type === 'issue';
    return pageMatches(action.pages, url);
  });
}

/** What a prompt's words stand for. */
export interface SitePromptValues {
  url: string;
  title: string;
  selection: string;
  repo?: string;
  number?: string;
}

// Control characters (but new lines and tabs) and the invisible ones that hide text, as a link refuses them.
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** `template` with its words filled in from the page, without hidden characters, cut at `SITE_ACTION_PROMPT_MAX`. */
export function fillSitePrompt(template: string, values: SitePromptValues): string {
  const filled = template.replace(/\{(url|title|selection|repo|number)\}/g, (_, key: keyof SitePromptValues) => values[key] ?? '');
  return filled.replace(/\r\n?/g, '\n').replace(HIDDEN, '').trim().slice(0, SITE_ACTION_PROMPT_MAX);
}

/** A new action's id. */
export const newSiteActionId = () => `site-${Math.random().toString(36).slice(2, 10)}`;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * The actions as saved, checked: the built-in ones once each (put back first if missing), your own ones with a name
 * and pages that work, at most `SITE_ACTIONS_MAX`.
 */
export function sanitizeSiteActions(raw: unknown): SiteAction[] {
  const out: SiteAction[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const id = typeof value.id === 'string' && /^[a-z0-9-]{1,40}$/.test(value.id) ? value.id : null;
    if (!id || seen.has(id)) continue;
    const builtIn = defaultSiteAction(id);
    const name = text(value.name, SITE_ACTION_NAME_MAX).trim() || builtIn?.name || '';
    const pages = builtIn ? '' : text(value.pages, SITE_ACTION_PAGES_MAX).trim();
    if (!name || (!builtIn && sitePagesProblem(pages))) continue;
    const folder = builtIn || typeof value.folder !== 'string' || !value.folder || value.folder.length > 4096 ? null : value.folder;
    seen.add(id);
    out.push({ id, name, pages, folder, prompt: text(value.prompt, SITE_ACTION_PROMPT_MAX), enabled: typeof value.enabled === 'boolean' ? value.enabled : true });
  }
  const missing = DEFAULT_SITE_ACTIONS.filter((action) => !seen.has(action.id)).map((action) => ({ ...action }));
  return [...missing, ...out].slice(0, SITE_ACTIONS_MAX);
}
