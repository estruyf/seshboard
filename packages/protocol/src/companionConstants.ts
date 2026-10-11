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
 * the installed app, then a development build (`npm run dev`).
 */
export const APP_DATA_FOLDERS = ['Switchboard', 'Switchboard Dev'] as const;

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
