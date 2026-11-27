/**
 * Plain values shared by the engine's companion socket and the VS Code companion extension (no zod, so the
 * extension can import them without the schemas).
 */

/** Bumped when a change to the companion contract would break an older extension or engine. */
export const COMPANION_PROTOCOL = 1;

/** At most this many context items in one message. */
export const MAX_CONTEXT_ITEMS = 100;

/**
 * The folder, inside the app's data folder, where a running engine writes `engine.json`: the socket's path and
 * its token. Readable only by you (`0600` in a `0700` folder).
 */
export const COMPANION_DIR = 'companion';
export const COMPANION_INFO_FILE = 'engine.json';

/**
 * The app's data folders (under `~/Library/Application Support`, `%APPDATA%` on Windows), in the order the extension prefers them:
 * the installed app, then a development build (`npm run dev`), then both by their names from before the rename (an
 * app that couldn't move its folder keeps using it, and one older than the rename is still called that).
 */
export const APP_DATA_FOLDERS = ['Seshboard', 'Seshboard Dev', 'Switchboard', 'Switchboard Dev'] as const;

/** What `engine.json` holds. */
export interface CompanionInfo {
  protocol: number;
  /** The Unix socket to connect to, or a named pipe (`\\.\pipe\…`) on Windows. */
  socket: string;
  /** Sent with `hello`; a connection without it is closed. */
  token: string;
  /** The engine process, to tell a file left behind by a crash from a running app. */
  pid: number;
  startedAt: number;
  appVersion: string;
}

/** The longest line (one message) either side accepts before it drops the connection. */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

/** Editors whose Claude Code extension can continue a session (`<scheme>://anthropic.claude-code/open?session=<id>`). */
export const CONTINUE_EDITORS = ['vscode', 'vscode-insiders', 'cursor', 'windsurf'] as const;
export type ContinueEditor = (typeof CONTINUE_EDITORS)[number];

/**
 * The browser extension's native messaging host: the program Chrome, Edge or Firefox starts for the extension, which
 * relays its messages to the engine's socket (docs/browser-extension.md). Its manifest in each browser has this name.
 */
export const BROWSER_HOST_NAME = 'app.seshboard.companion';

/**
 * The extension's ids, the only ones the host's manifests let in. Chromium's comes from the `key` in the extension's
 * manifest (so a build loaded unpacked keeps it); add the store's id here once it is published. Firefox's is
 * `browser_specific_settings.gecko.id`.
 */
export const BROWSER_EXTENSION_IDS = {
  chromium: ['bgffnbmaoadkminaadlghmhpicbloplk'],
  firefox: 'seshboard@eliostruyf.com',
} as const;

/** What the host and the extension say to each other over native messaging (each message one JSON frame). */
export type BrowserHostMessage =
  /** Host to extension: whether it reached Seshboard. `not-running`: no engine to connect to; it keeps looking. */
  | { type: 'status'; state: 'connecting' | 'connected' | 'not-running' | 'incompatible'; appVersion?: string; detail?: string; canLaunch?: boolean }
  /** Either way: a companion RPC message (request, response or event), as on the socket. */
  | { type: 'wire'; message: import('./wire.ts').WireMessage }
  /** Extension to host: open Seshboard, then connect once it is up. */
  | { type: 'launch' };
