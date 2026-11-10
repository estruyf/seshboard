/**
 * The browser: a page from anywhere on the web (a pull request, a CI run, the docs) shown in a main view beside the
 * sessions, where the web preview (`webPreview.ts`) only shows this computer's dev servers. Plain TypeScript, for main
 * (which checks every navigation) and the renderer (the address bar).
 */

/**
 * The browser's own storage: not the app's and not the web preview's, so a sign-in (GitHub, say) lasts between runs
 * and a dev server on this computer can't read it.
 */
export const BROWSER_PARTITION = 'persist:browser';

/** The page the browser opens on before anything was typed. */
export const BROWSER_HOME = 'https://github.com/';

/** `url` as the browser loads it, or null when it may not: http and https only, without credentials in the address. */
export function browserPageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // `github.com@evil.example` would read as GitHub to a person; refuse it, as the web preview does.
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

/** A host this computer serves: the address bar reaches it over http, every other host over https. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.localhost)(:\d+)?([/?#]|$)/i;

/**
 * What was typed in the browser's address bar, as an address: a full `http(s)://` address as it is, a bare
 * `github.com/owner/repo` with `https://` (`http://` for this computer). Null for text that is not an address
 * (no dot, or spaces): the browser doesn't search.
 */
export function browserAddress(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/:]+:\d+([/?#]|$)/.test(text)) return browserPageUrl(text);
  if (LOCAL_HOST.test(text)) return browserPageUrl(`http://${text}`);
  const host = text.split(/[/?#]/)[0]!;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;
  return browserPageUrl(`https://${text}`);
}

/** Where a navigation in the browser's page goes: it stays in the browser, opens in another app (mail), or goes nowhere. */
export function browserNavigation(url: string): 'stay' | 'external' | 'block' {
  if (browserPageUrl(url) !== null) return 'stay';
  return /^mailto:/i.test(url) ? 'external' : 'block';
}
