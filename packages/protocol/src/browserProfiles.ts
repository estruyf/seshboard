/**
 * Browser profiles (docs/browser.md, Browser profiles): separate stores for browser pages (cookies, storage, cache), so
 * one web app can be tried under several accounts side by side. Not Claude profiles (Settings › Profiles): those are
 * Claude Code's logins. Plain TypeScript, shared by the engine (the agent's `open`), main and the UI.
 */

/** The built-in profile's name: every page that names no other profile, in the partition the browser always had. */
export const DEFAULT_BROWSER_PROFILE_NAME = 'Default';

/** How long a browser profile's name may be. */
export const BROWSER_PROFILE_NAME_MAX = 60;

/** What the matching needs of a browser profile. */
export interface BrowserProfileRef {
  id: string;
  name: string;
  /** The project it belongs to (its root), or null for everywhere. */
  projectRoot: string | null;
}

/** A name typed for a browser profile, as kept: spaces folded and trimmed, cut to the limit; null when empty. */
export function cleanBrowserProfileName(text: string): string | null {
  const name = text.replace(/\s+/g, ' ').trim().slice(0, BROWSER_PROFILE_NAME_MAX);
  return name || null;
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

/**
 * The browser profiles a place can use: the project's (`projectRoot`), then the ones for everywhere, each group in the
 * order given. With `projectRoot` undefined (the Browser view, which belongs to no project), every profile.
 */
export function browserProfilesFor<T extends BrowserProfileRef>(profiles: readonly T[], projectRoot: string | null | undefined): T[] {
  if (projectRoot === undefined) return [...profiles.filter((p) => p.projectRoot === null), ...profiles.filter((p) => p.projectRoot !== null)];
  return [...profiles.filter((p) => projectRoot !== null && p.projectRoot === projectRoot), ...profiles.filter((p) => p.projectRoot === null)];
}

/**
 * Why a name can't be used for a profile in `projectRoot` (another one would answer to it in some place), or null when
 * it can. Names are compared without case; "Default" is the built-in profile's. `exceptId`: the profile being renamed.
 */
export function browserProfileNameClash(profiles: readonly BrowserProfileRef[], name: string, projectRoot: string | null, exceptId?: string): string | null {
  if (sameName(name, DEFAULT_BROWSER_PROFILE_NAME)) return `${DEFAULT_BROWSER_PROFILE_NAME} is the built-in profile's name.`;
  const clash = profiles.find((p) => p.id !== exceptId && sameName(p.name, name) && (p.projectRoot === null || projectRoot === null || p.projectRoot === projectRoot));
  return clash ? `A browser profile called ${clash.name} is already there.` : null;
}

/**
 * The browser profile an agent named (`open`'s `profile`), matched without case among the ones its session's project
 * can use; "Default" (or no name) is the built-in one (`profile` null). Unknown: an error that lists the names.
 */
export function findBrowserProfile<T extends BrowserProfileRef>(profiles: readonly T[], name: string | null | undefined, projectRoot: string | null): { profile: T | null } | { error: string } {
  const wanted = (name ?? '').trim();
  if (!wanted || sameName(wanted, DEFAULT_BROWSER_PROFILE_NAME)) return { profile: null };
  const usable = browserProfilesFor(profiles, projectRoot);
  const found = usable.find((p) => sameName(p.name, wanted));
  if (found) return { profile: found };
  const names = [DEFAULT_BROWSER_PROFILE_NAME, ...usable.map((p) => p.name)].join(', ');
  return { error: `No browser profile called “${wanted}”. The profiles here are: ${names}.` };
}

/** What Reset forgets of a browser profile: each part can be kept. */
export interface BrowserProfileReset {
  /** Cookies, and the passwords typed for HTTP sign-ins (the auth cache): the logins. */
  cookies: boolean;
  /** Local storage, IndexedDB, service workers, Cache Storage and file systems the sites kept. */
  siteData: boolean;
  /** The HTTP cache and the compiled code caches. */
  cache: boolean;
  /** The profile's history, which the address bar suggests from. */
  history: boolean;
}

/** Everything: what Delete clears, and what Reset ticks to start with. */
export const RESET_EVERYTHING: BrowserProfileReset = { cookies: true, siteData: true, cache: true, history: true };
