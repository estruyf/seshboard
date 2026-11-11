/**
 * The web preview: a session's running dev server, shown in a `<webview>` beside the conversation. Only local
 * addresses load there; anything else (an outside link, `window.open`, a sign-in redirect) opens in the browser.
 * Plain TypeScript, for the engine (which finds the addresses in a command's output), main (which checks every
 * navigation) and the renderer (the address bar).
 */

/**
 * The page's own storage, never the app's: it can't read Seshboard's, and sign-ins last between runs. One for all
 * projects, as a browser has.
 */
export const WEB_PREVIEW_PARTITION = 'persist:web-preview';

/** The phone width the toolbar's toggle shows the page at. */
export const WEB_PREVIEW_PHONE_WIDTH = 390;

/** Hosts that are this computer. `0.0.0.0` and `[::]` (a server listening on every interface) become `localhost`. */
const isLocalHost = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
const ANY_INTERFACE = new Set(['0.0.0.0', '[::]']);

/**
 * `url` as the preview loads it, or null when it may not: http(s) to `localhost`, `*.localhost`, `127.0.0.1` or
 * `[::1]`, with `0.0.0.0` turned into `localhost`. Main uses it for every navigation, redirect and new window.
 */
export function localPreviewUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // Credentials in the address would let `localhost@evil.example` read as local to a person; refuse them.
  if (parsed.username || parsed.password) return null;
  if (ANY_INTERFACE.has(parsed.hostname)) parsed.hostname = 'localhost';
  return isLocalHost(parsed.hostname.toLowerCase()) ? parsed.href : null;
}

/**
 * `url` as the browser (Settings › General › Enable browser) loads it, or null when it may not: http(s) to any
 * host, without credentials in the address. Everything else (`file:`, `javascript:`, `data:`, an app's own scheme)
 * never loads in the page.
 */
export function webPageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // `github.com@evil.example` would read as GitHub to a person; refuse it.
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

/**
 * Schemes that never leave the page for the system either: they reach this computer's files or run code
 * (`search-ms:` and `ms-msdt:` were both ways in on Windows). Any other scheme is an app's link (`vscode:`, `slack:`).
 */
const BLOCKED_SCHEMES = new Set([
  'file', 'javascript', 'data', 'blob', 'about', 'chrome', 'chrome-extension', 'devtools', 'view-source', 'filesystem',
  'ws', 'wss', 'ftp', 'smb', 'afp', 'nfs', 'jar', 'search-ms', 'search', 'ms-msdt', 'ms-officecmd', 'ms-cxh', 'ms-cxh-full',
  'shell', 'res', 'its', 'mk', 'ms-its', 'hcp', 'help', 'vbscript', 'x-apple-systempreferences', 'applescript',
]);

/** An app's link the system may open (`vscode:`, `slack:`, `mailto:`), or false for anything else. */
export function externalSchemeAllowed(url: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())?.[1]?.toLowerCase();
  return !!scheme && scheme !== 'http' && scheme !== 'https' && !BLOCKED_SCHEMES.has(scheme) && url.length <= 2048;
}

/** Where a navigation in the browser goes: it stays in the page, opens with the system (an app's link), or goes nowhere. */
export function browserNavigation(url: string): 'stay' | 'system' | 'block' {
  if (webPageUrl(url)) return 'stay';
  return externalSchemeAllowed(url) ? 'system' : 'block';
}

/** Hosts the address bar reaches over http: this computer's own names. Every other host gets https. */
const LOCAL_NAME = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[^/:?#]+\.localhost)(:\d+)?([/?#]|$)/i;

/**
 * What was typed in the address bar: `5173` and `:5173` are a port on localhost. With `anyHost` off (the web preview),
 * a bare `localhost:3000/docs` gets `http://` and only local addresses load. With it on (the browser), a bare host gets
 * `https://` (`localhost` and `*.localhost` get `http://`) and any web address loads; text with a space or without a
 * dot is not an address (the address bar doesn't search). Null for anything that won't load.
 */
export function addressBarUrl(input: string, options: { anyHost?: boolean } = {}): string | null {
  const text = input.trim();
  if (!text) return null;
  const port = /^:?(\d{1,5})(\/.*)?$/.exec(text);
  if (port) return Number(port[1]) > 0 && Number(port[1]) < 65536 ? localPreviewUrl(`http://localhost:${port[1]}${port[2] ?? '/'}`) : null;
  if (!options.anyHost) return localPreviewUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  if (/\s/.test(text)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return webPageUrl(text);
  if (LOCAL_NAME.test(text)) return localPreviewUrl(`http://${text}`);
  const host = text.split(/[/?#]/)[0]!.replace(/:\d+$/, '');
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;
  return webPageUrl(`https://${text}`);
}

/** An address as the toolbar and the offers show it: no scheme, no trailing slash on the root. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^([^/?#]+)\/$/, '$1');
}
