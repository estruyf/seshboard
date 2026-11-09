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
 * What was typed in the address bar, as a local address: `5173` and `:5173` are a port on localhost, a bare
 * `localhost:3000/docs` gets `http://`. Null for anything the preview won't load.
 */
export function addressBarUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const port = /^:?(\d{1,5})(\/.*)?$/.exec(text);
  if (port) return Number(port[1]) > 0 && Number(port[1]) < 65536 ? localPreviewUrl(`http://localhost:${port[1]}${port[2] ?? '/'}`) : null;
  return localPreviewUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
}

/** An address as the toolbar and the offers show it: no scheme, no trailing slash on the root. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^([^/?#]+)\/$/, '$1');
}
