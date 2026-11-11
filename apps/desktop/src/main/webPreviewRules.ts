import { browserNavigation, externalSchemeAllowed, localPreviewUrl, webPageUrl, WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';

/**
 * What main does with a key typed in the web preview's page: hand it to the app (`forward`), reload the page, or go
 * back or ahead in the page's own history (`back`, `ahead`).
 */
export type PreviewKeyAction = 'forward' | 'reload' | 'back' | 'ahead' | 'swallow' | null;

/** The slice of Electron's `Input` the rules read. */
export interface PreviewKeyInput {
  type: string;
  key: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
  /** The physical key (`KeyV`), for Paste and Match Style, whose `key` Option changes. */
  code?: string;
  /** Typing through an input method (IME): its keys are the page's. */
  isComposing?: boolean;
  /** The key held down. */
  isAutoRepeat?: boolean;
}

/**
 * The page's own editing keys, as T3 Code lists them: copy, cut, paste, select all, undo and redo, ⇧ for redo and
 * Paste and Match Style (⌥⇧⌘V on a Mac, Ctrl+⇧V elsewhere), and Ctrl+Y for redo on Windows only. Any other ⇧ or ⌥
 * combination is the app's (⌘⇧A, ⌘⇧C).
 */
export function isEditingKey(input: PreviewKeyInput, platform: NodeJS.Platform): boolean {
  const mac = platform === 'darwin';
  if (mac ? !input.meta || input.control : !input.control || input.meta) return false;
  const key = input.key.toLowerCase();
  // Option changes the key Paste and Match Style gives on a Mac (to ◊).
  if (mac && input.alt && input.shift && input.code === 'KeyV') return true;
  if (key === 'v' && input.shift) return input.alt === mac;
  if (input.alt) return false;
  if (key === 'z') return !input.shift || platform !== 'win32';
  if (input.shift) return false;
  return key === 'a' || key === 'c' || key === 'v' || key === 'x' || (key === 'y' && platform === 'win32');
}

/** AltGr on Windows and Linux arrives as Ctrl+Alt: with it a symbol (`@`, `{`, `\`) or a dead key is typed, not a shortcut. */
export function isAltGrCharacter(input: PreviewKeyInput, platform: NodeJS.Platform): boolean {
  return platform !== 'darwin' && input.control && input.alt && /^(?:[^a-zA-Z0-9]|Dead)$/u.test(input.key);
}

/**
 * A key typed in the page: ⌘R (Ctrl+R) reloads the page rather than the app, other ⌘ (Ctrl) keys are the app's
 * shortcuts and go to it (⌘T, ⌘W and ⌘L among them, for the tabs), and everything else, editing keys included, stays
 * the page's. With the browser on, ⌘[ and ⌘] go back and ahead in the page.
 */
/** Keys whose `KeyboardEvent.key` differs from the name `sendInputEvent` takes. */
const KEY_CODES: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Enter: 'Return',
};
/** Named keys passed on as they are. */
const NAMED_KEYS = new Set(['Backspace', 'Delete', 'Tab', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Insert']);

/**
 * A key typed in a page whose keys go to the window (the window took the focus from it, see `webPreview.ts`): the
 * events `sendInputEvent` takes for it there, a key down or up, and with a printable key down the character it types.
 * Null for a key with no such event (a modifier alone, a function key).
 */
export function keyForWindow(input: PreviewKeyInput): { type: 'keyDown' | 'keyUp'; keyCode: string; char: string | null; modifiers: Array<'shift' | 'control' | 'alt' | 'meta'> } | null {
  if (input.type !== 'keyDown' && input.type !== 'keyUp') return null;
  const keyCode = KEY_CODES[input.key] ?? (NAMED_KEYS.has(input.key) || [...input.key].length === 1 ? input.key : null);
  if (!keyCode) return null;
  const modifiers = [...(input.shift ? (['shift'] as const) : []), ...(input.control ? (['control'] as const) : []), ...(input.alt ? (['alt'] as const) : []), ...(input.meta ? (['meta'] as const) : [])];
  // A character only for a key that types one: not with ⌘ or Ctrl held (a shortcut), and not for a named key.
  const types = input.type === 'keyDown' && !input.meta && !input.control && ([...input.key].length === 1);
  return { type: input.type, keyCode, char: types ? input.key : null, modifiers };
}

export function previewKeyAction(input: PreviewKeyInput, platform: NodeJS.Platform, browser = false): PreviewKeyAction {
  if (input.type !== 'keyDown' || input.isComposing) return null;
  const mod = platform === 'darwin' ? input.meta : input.control;
  if (!mod || isAltGrCharacter(input, platform) || isEditingKey(input, platform)) return null;
  const key = input.key.toLowerCase();
  // A bare modifier press is not a shortcut yet.
  if (['meta', 'control', 'alt', 'shift'].includes(key)) return null;
  // Held down, a shortcut runs once: ⌘W kept down closes one tab, not one per repeat.
  if (input.isAutoRepeat) return 'swallow';
  if (key === 'r' && !input.shift && !input.alt) return 'reload';
  if (browser && !input.shift && !input.alt && (key === '[' || key === ']')) return key === '[' ? 'back' : 'ahead';
  return 'forward';
}

/** The `<webview>` attributes main checks before one attaches, as `will-attach-webview` hands them over. */
export interface WebviewAttach {
  src?: string;
  partition?: string;
}

/**
 * Whether a `<webview>` may attach: only the web preview's, in its own partition, on a local address (any web address
 * with the browser on), or still blank, before its first load. None with both the browser and previews off. Main
 * forces the rest of its preferences itself.
 */
export function webviewAllowed(params: WebviewAttach, browser = false, preview = true): boolean {
  if (params.partition !== WEB_PREVIEW_PARTITION || (!browser && !preview)) return false;
  if (!params.src || params.src === 'about:blank') return true;
  return (browser ? webPageUrl(params.src) : localPreviewUrl(params.src)) !== null;
}

/**
 * Whether the preview accepts a certificate Chromium refused: only for this computer, where a dev server's own
 * self-signed certificate (`vite --https`, `mkcert`) is normal and no one else is on the line.
 */
/**
 * Whether a cookie goes with a site's sign-out (Clear data for this site): a cookie for the site's host or for a domain
 * above it (`.github.com` for gist.github.com), never one for a sibling or a domain merely ending the same way.
 */
export function cookieOfSite(hostname: string, cookieDomain: string | undefined): boolean {
  const domain = (cookieDomain ?? '').replace(/^\./, '').toLowerCase();
  const host = hostname.toLowerCase();
  return domain !== '' && (host === domain || host.endsWith(`.${domain}`));
}

/**
 * The most bytes of a page's icon that are read, by its type: an SVG may be large (some sites put a photo inside one),
 * a PNG or GIF has its size checked in its header too (`iconTooLarge`), any other image stays small.
 */
export function faviconCap(type: string): number {
  if (type === 'image/svg+xml') return 4 * 1024 * 1024;
  if (type === 'image/png' || type === 'image/gif') return 1024 * 1024;
  return 256 * 1024;
}

/** The most pixels a side of a PNG or GIF icon may have: a few compressed bytes can say 20,000 × 20,000, which would take gigabytes to draw. */
export const FAVICON_MAX_SIDE = 4096;

/** A PNG or GIF whose header gives a side over `FAVICON_MAX_SIDE` (any other type: false, its size is capped by bytes). */
export function iconTooLarge(bytes: Uint8Array, type: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') return bytes.length < 24 || view.getUint32(16) > FAVICON_MAX_SIDE || view.getUint32(20) > FAVICON_MAX_SIDE;
  if (type === 'image/gif') return bytes.length < 10 || view.getUint16(6, true) > FAVICON_MAX_SIDE || view.getUint16(8, true) > FAVICON_MAX_SIDE;
  return false;
}

export function acceptsLocalCertificate(hostname: string): boolean {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return localPreviewUrl(`https://${host}/`) !== null;
}

/**
 * Where a navigation in the page goes: it stays in the page, opens in the browser (the system's), opens with the
 * system (an app's own link, with the browser on), or goes nowhere. Off, only local addresses stay; on, any web address.
 */
export function previewNavigation(url: string, browser = false): 'stay' | 'browser' | 'system' | 'block' {
  if (browser) return browserNavigation(url);
  if (localPreviewUrl(url) !== null) return 'stay';
  return /^https?:\/\//i.test(url) ? 'browser' : 'block';
}

/**
 * Where a new window the page asks for (`window.open`, `target=_blank`, a sign-in popup) goes. It is never a window:
 * with the browser on, a web address becomes a tab of the same owner and an app's link opens with the system; off, a
 * local address loads in the page itself and any other opens in the browser.
 */
export function popupTarget(url: string, browser = false, disposition?: string): 'tab' | 'window' | 'same' | 'browser' | 'system' | 'none' {
  // A window the page asks for with a size (`window.open` with features: a sign-in with Google, Stripe, MSAL) keeps
  // `window.opener`, which the sign-in reports back through; as a tab it would lose it. A link with target=_blank is a tab.
  if (browser) return webPageUrl(url) ? (disposition === 'new-window' ? 'window' : 'tab') : externalSchemeAllowed(url) ? 'system' : 'none';
  return localPreviewUrl(url) ? 'same' : 'browser';
}

/**
 * What a page may use without asking, as T3 Code allows it: writing to the clipboard (a site's Copy buttons),
 * fullscreen (kept inside the panel), pointer lock, and asking whether this computer is reachable (sign-in widgets
 * check first). Anything else, location, the camera, notifications, reading the clipboard, is refused.
 */
const PAGE_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'loopback-network']);
export const pagePermissionAllowed = (permission: string): boolean => PAGE_PERMISSIONS.has(permission);

/** The slice of Electron's `ContextMenuParams` the page's right-click menu reads. */
export interface PageMenuParams {
  linkURL: string;
  srcURL: string;
  mediaType: string;
  selectionText: string;
  isEditable: boolean;
  dictionarySuggestions: string[];
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

/** One entry of a page's right-click menu: what it does, as main runs it (`webPreview.ts`), or a line. */
export type PageMenuEntry =
  | { id: 'spelling'; label: string; word: string }
  | { id: 'open-link' | 'copy-link' | 'copy-email' | 'copy-image' | 'copy-image-address' | 'cut' | 'copy' | 'paste' | 'select-all' | 'back' | 'forward' | 'reload' | 'inspect'; label: string; enabled: boolean }
  | 'separator';

/**
 * A page's right-click menu: spelling suggestions, then what was clicked (a link, an email address, an image), then
 * editing, or back, forward and reload when nothing else applies, then Inspect.
 */
export function pageMenuEntries(params: PageMenuParams, page: { browser: boolean; back: boolean; forward: boolean }): PageMenuEntry[] {
  const groups: PageMenuEntry[][] = [];
  if (params.isEditable && params.dictionarySuggestions.length) groups.push(params.dictionarySuggestions.slice(0, 5).map((word) => ({ id: 'spelling', label: word, word })));
  const mail = /^mailto:/i.test(params.linkURL);
  const link = !mail && webPageUrl(params.linkURL) !== null;
  if (link) groups.push([...(page.browser ? [{ id: 'open-link', label: 'Open link in new tab', enabled: true } as const] : []), { id: 'copy-link', label: 'Copy link address', enabled: true }]);
  if (mail) groups.push([{ id: 'copy-email', label: 'Copy email address', enabled: true }]);
  if (params.mediaType === 'image' && params.srcURL) groups.push([{ id: 'copy-image', label: 'Copy image', enabled: true }, { id: 'copy-image-address', label: 'Copy image address', enabled: true }]);
  if (params.isEditable) {
    groups.push([
      { id: 'cut', label: 'Cut', enabled: params.editFlags.canCut },
      { id: 'copy', label: 'Copy', enabled: params.editFlags.canCopy },
      { id: 'paste', label: 'Paste', enabled: params.editFlags.canPaste },
      { id: 'select-all', label: 'Select all', enabled: params.editFlags.canSelectAll },
    ]);
  } else if (params.selectionText.trim()) groups.push([{ id: 'copy', label: 'Copy', enabled: true }]);
  if (!groups.length) {
    groups.push([
      { id: 'back', label: 'Back', enabled: page.back },
      { id: 'forward', label: 'Forward', enabled: page.forward },
      { id: 'reload', label: 'Reload', enabled: true },
    ]);
  }
  groups.push([{ id: 'inspect', label: 'Inspect', enabled: true }]);
  return groups.flatMap((group, i) => (i ? ['separator' as const, ...group] : group));
}

