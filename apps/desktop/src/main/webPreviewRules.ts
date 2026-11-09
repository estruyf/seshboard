import { localPreviewUrl, WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';

/** What main does with a key typed in the web preview's page. */
export type PreviewKeyAction = 'forward' | 'reload' | null;

/** The slice of Electron's `Input` the rules read. */
export interface PreviewKeyInput {
  type: string;
  key: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

/** Editing keys stay the page's: copy, cut, paste, select all, undo and redo. */
const EDITING_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y']);

/**
 * A key typed in the page: ⌘R (Ctrl+R) reloads the page rather than the app, other ⌘ (Ctrl) keys are the app's
 * shortcuts and go to it, and everything else, editing keys included, stays the page's.
 */
export function previewKeyAction(input: PreviewKeyInput, platform: NodeJS.Platform): PreviewKeyAction {
  if (input.type !== 'keyDown') return null;
  const mod = platform === 'darwin' ? input.meta : input.control;
  if (!mod) return null;
  const key = input.key.toLowerCase();
  if (key === 'r' && !input.shift && !input.alt) return 'reload';
  if (EDITING_KEYS.has(key) && !input.alt) return null;
  // A bare modifier press is not a shortcut yet.
  if (['meta', 'control', 'alt', 'shift'].includes(key)) return null;
  return 'forward';
}

/** The `<webview>` attributes main checks before one attaches, as `will-attach-webview` hands them over. */
export interface WebviewAttach {
  src?: string;
  partition?: string;
}

/**
 * Whether a `<webview>` may attach: only the web preview's, in its own partition, on a local address (or still
 * blank, before its first load). Main forces the rest of its preferences itself.
 */
export function webviewAllowed(params: WebviewAttach): boolean {
  if (params.partition !== WEB_PREVIEW_PARTITION) return false;
  return !params.src || params.src === 'about:blank' || localPreviewUrl(params.src) !== null;
}

/**
 * Whether the preview accepts a certificate Chromium refused: only for this computer, where a dev server's own
 * self-signed certificate (`vite --https`, `mkcert`) is normal and no one else is on the line.
 */
export function acceptsLocalCertificate(hostname: string): boolean {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return localPreviewUrl(`https://${host}/`) !== null;
}

/** Where a navigation in the page goes: it stays in the preview, opens in the browser, or goes nowhere. */
export function previewNavigation(url: string): 'stay' | 'browser' | 'block' {
  if (localPreviewUrl(url) !== null) return 'stay';
  return /^https?:\/\//i.test(url) ? 'browser' : 'block';
}
