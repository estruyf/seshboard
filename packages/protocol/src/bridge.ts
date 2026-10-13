import {
  DEFAULT_THEME_ID,
  type ThemeFileCheck,
  type ThemeState,
} from "./themeFormat.ts";
import {
  ARCHIVE_AFTER_DAYS,
  clampDays,
  DEFAULT_DELETE_ARCHIVED,
  DELETE_AFTER_DAYS,
  type DeleteArchived,
} from "./retention.ts";

import { DEFAULT_AUTO_MODEL, sanitizeAutoModel, type AutoModelPrefs } from "./autoModel.ts";

export * from "./retention.ts";
export * from "./autoModel.ts";

/**
 * The small API the preload script exposes on `window.switchboard`.
 * Everything else goes over the engine MessagePort, not Electron IPC.
 */

/** `window.postMessage` tag the preload uses to hand the engine port to the page. */
export const ENGINE_PORT_MESSAGE = "switchboard:engine-port";

/** IPC channel names shared by main and preload. */
export const IpcChannel = {
  requestEnginePort: "switchboard:request-engine-port",
  enginePort: "switchboard:engine-port",
  engineRestarted: "switchboard:engine-restarted",
  rendererReady: "switchboard:renderer-ready",
  pickFolder: "switchboard:pick-folder",
  pickImage: "switchboard:pick-image",
  pickContextFiles: "switchboard:pick-context-files",
  chooseExportFile: "switchboard:choose-export-file",
  chooseImportFile: "switchboard:choose-import-file",
  chooseMemoryExport: "switchboard:choose-memory-export",
  saveImage: "switchboard:save-image",
  showSavedImage: "switchboard:show-saved-image",
  focusSession: "switchboard:focus-session",
  selectSession: "switchboard:select-session",
  quitRequested: "switchboard:quit-requested",
  quitAnswer: "switchboard:quit-answer",
  getPreferences: "switchboard:get-preferences",
  setPreferences: "switchboard:set-preferences",
  preferencesChanged: "switchboard:preferences-changed",
  openSettings: "switchboard:open-settings",
  toggleShortcuts: "switchboard:toggle-shortcuts",
  getAppInfo: "switchboard:get-app-info",
  getUpdateState: "switchboard:get-update-state",
  updateState: "switchboard:update-state",
  updateCommand: "switchboard:update-command",
  deepLink: "switchboard:deep-link",
  getThemes: "switchboard:get-themes",
  themesChanged: "switchboard:themes-changed",
  themeCommand: "switchboard:theme-command",
  windowButtons: "switchboard:window-buttons",
  focusWindow: "switchboard:focus-window",
} as const;

/** Appearance: follow macOS, or always light or dark. */
export type ColorScheme = "system" | "light" | "dark";
/** Sidebar rows: a large project icon beside three lines, three lines, or one line. */
export type SidebarStyle = "large" | "standard" | "compact";
/** What collapsing the sidebar (⌘B) does: the narrow rail of project icons, or hide it. */
export type SidebarCollapsed = "minimal" | "closed";
/** Tool calls in a conversation: one summary line per run (click for the steps), or every step. */
export type ToolActivity = "summary" | "steps";
/** Sessions in the sidebar: only those started or continued in Switchboard, or every Claude Code session. */
export type SessionScope = "switchboard" | "all";
/** What a new window shows: Home, the session open last time, or New session. */
export type StartupView = "home" | "last" | "new";
/** Which releases to update to: published releases, or the nightly pre-releases too. */
export type UpdateChannel = "stable" | "nightly";
/** How New session, Home and the palette list your projects: most recently used first, or in the order you set. */
export type ProjectOrder = "recent" | "yours";
/**
 * The permission mode a new session starts in: the one you picked last (`last`), or always the same one. Bypass
 * permissions is never offered, as in the mode menus.
 */
export type NewSessionMode = "last" | "default" | "acceptEdits" | "plan" | "auto";
export const NEW_SESSION_MODES: readonly NewSessionMode[] = ["last", "default", "acceptEdits", "plan", "auto"];
/** What Enter does while Claude is working: hold the message until the turn ends (`queue`), or hand it to Claude now (`steer`). */
export type WhileWorking = "queue" | "steer";

/** At the focus limit: ask first and allow going over (`nudge`), or wait until a session is finished (`strict`). */
export type FocusMode = "nudge" | "strict";

/** The focus limit's range: at least one session, at most ten. */
export const FOCUS_LIMIT_MIN = 1;
export const FOCUS_LIMIT_MAX = 10;
/** What the limit starts at when it is turned on. */
export const FOCUS_LIMIT_DEFAULT = 3;

/** App preferences, kept by main in the app's data folder. */
export interface Preferences {
  colorScheme: ColorScheme;
  sidebarStyle: SidebarStyle;
  sidebarCollapsed: SidebarCollapsed;
  toolActivity: ToolActivity;
  /** ⌘Q asks first (a second ⌘Q quits). */
  confirmQuit: boolean;
  sessionScope: SessionScope;
  startupView: StartupView;
  projectOrder: ProjectOrder;
  /** What New session and the palette's prompt start in, unless the project has its own default. */
  newSessionMode: NewSessionMode;
  /** Check GitHub for a newer release shortly after launch and every few hours. */
  autoUpdate: boolean;
  updateChannel: UpdateChannel;
  /** The most sessions going at the same time (1–10); null turns the focus limit off. */
  focusLimit: number | null;
  focusMode: FocusMode;
  /** Also count live sessions started outside Switchboard (terminal, IDE). */
  focusCountExternal: boolean;
  /** The colour theme: a built-in's id (`demo-time`, `github`…) or an imported theme's file name. */
  themeId: string;
  /** Finished sessions leave the sidebar's main list after this many days without activity (1–365). */
  archiveAfterDays: number;
  /** Moves archived sessions to the Trash after some days in Archived (1–3650). Off by default. */
  deleteArchived: DeleteArchived;
  /** What Enter does in the message box while Claude is working (Settings › Conversation). */
  whileWorking: WhileWorking;
  /** Auto in the model menus: Haiku reads the first prompt and picks the model (Settings › Conversation). */
  autoModel: AutoModelPrefs;
}

export const DEFAULT_PREFERENCES: Preferences = {
  colorScheme: "system",
  sidebarStyle: "standard",
  sidebarCollapsed: "minimal",
  toolActivity: "summary",
  confirmQuit: true,
  sessionScope: "switchboard",
  startupView: "home",
  projectOrder: "recent",
  newSessionMode: "last",
  autoUpdate: true,
  updateChannel: "stable",
  focusLimit: null,
  focusMode: "nudge",
  focusCountExternal: false,
  themeId: DEFAULT_THEME_ID,
  archiveAfterDays: ARCHIVE_AFTER_DAYS.default,
  deleteArchived: DEFAULT_DELETE_ARCHIVED,
  whileWorking: "queue",
  autoModel: DEFAULT_AUTO_MODEL,
};

/** A theme id: lower-case letters, digits and dashes (built-in ids and the file names of imported themes). */
export const isThemeId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);

const oneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => values.includes(value as T);

/** Keeps only valid fields (for files on disk and values from the renderer). */
export function sanitizePreferences(input: unknown): Partial<Preferences> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (oneOf(["system", "light", "dark"] as const, raw.colorScheme))
    out.colorScheme = raw.colorScheme;
  if (oneOf(["large", "standard", "compact"] as const, raw.sidebarStyle))
    out.sidebarStyle = raw.sidebarStyle;
  if (oneOf(["minimal", "closed"] as const, raw.sidebarCollapsed))
    out.sidebarCollapsed = raw.sidebarCollapsed;
  if (oneOf(["summary", "steps"] as const, raw.toolActivity))
    out.toolActivity = raw.toolActivity;
  if (typeof raw.confirmQuit === "boolean") out.confirmQuit = raw.confirmQuit;
  if (oneOf(["switchboard", "all"] as const, raw.sessionScope))
    out.sessionScope = raw.sessionScope;
  if (oneOf(["home", "last", "new"] as const, raw.startupView))
    out.startupView = raw.startupView;
  if (oneOf(["recent", "yours"] as const, raw.projectOrder))
    out.projectOrder = raw.projectOrder;
  if (oneOf(NEW_SESSION_MODES, raw.newSessionMode))
    out.newSessionMode = raw.newSessionMode;
  if (typeof raw.autoUpdate === "boolean") out.autoUpdate = raw.autoUpdate;
  if (oneOf(["stable", "nightly"] as const, raw.updateChannel))
    out.updateChannel = raw.updateChannel;
  if (raw.focusLimit === null) out.focusLimit = null;
  else if (
    typeof raw.focusLimit === "number" &&
    Number.isFinite(raw.focusLimit)
  ) {
    out.focusLimit = Math.min(
      FOCUS_LIMIT_MAX,
      Math.max(FOCUS_LIMIT_MIN, Math.round(raw.focusLimit)),
    );
  }
  if (oneOf(["nudge", "strict"] as const, raw.focusMode))
    out.focusMode = raw.focusMode;
  if (typeof raw.focusCountExternal === "boolean")
    out.focusCountExternal = raw.focusCountExternal;
  if (isThemeId(raw.themeId)) out.themeId = raw.themeId;
  const archiveAfterDays = clampDays(raw.archiveAfterDays, ARCHIVE_AFTER_DAYS);
  if (archiveAfterDays !== null) out.archiveAfterDays = archiveAfterDays;
  // Both fields or neither: half a setting would turn deleting on or off by accident.
  const deleting = raw.deleteArchived as Record<string, unknown> | null | undefined;
  const afterDays = clampDays(deleting?.afterDays, DELETE_AFTER_DAYS);
  if (typeof deleting?.enabled === "boolean" && afterDays !== null)
    out.deleteArchived = { enabled: deleting.enabled, afterDays };
  if (oneOf(["queue", "steer"] as const, raw.whileWorking))
    out.whileWorking = raw.whileWorking;
  const autoModel = sanitizeAutoModel(raw.autoModel);
  if (autoModel) out.autoModel = autoModel;
  return out;
}

/** The running build, for Settings → About and bug reports. */
export interface AppInfo {
  /** `app.getVersion()`: the release's version (from the tag) in a release build. */
  version: string;
  /** Short commit hash the build was made from; null when git wasn't available at build time. */
  commit: string | null;
  /** A development or unpackaged build: show `dev`, never a release number. */
  dev: boolean;
}

/** `releases/tag/v…` for a version, where its release notes are. */
export const releaseUrl = (version: string) =>
  `https://github.com/estruyf/switchboard/releases/tag/v${version}`;
export const CHANGELOG_URL =
  "https://github.com/estruyf/switchboard/blob/main/CHANGELOG.md";

/** Where the VS Code companion is published: the Marketplace for VS Code, Open VSX for Cursor and Windsurf. */
export const VSCODE_EXTENSION_URLS = {
  marketplace:
    "https://marketplace.visualstudio.com/items?itemName=eliostruyf.switchboard-companion",
  openVsx: "https://open-vsx.org/extension/eliostruyf/switchboard-companion",
  guide: "https://github.com/estruyf/switchboard#vs-code-companion",
} as const;

/**
 * Where the updater is. `idle` hasn't checked yet; `disabled` never will (see `disabledReason`).
 * `error` keeps what was known before it failed, so Retry knows what to try again.
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error"
  | "disabled";

/** The updater's whole state: one plain object that main pushes to every window on each change. */
export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  /** A newer version on the chosen channel, once a check found one. */
  availableVersion: string | null;
  /** Downloaded and ready to install on restart. */
  downloadedVersion: string | null;
  /** 0–100 while downloading. */
  downloadPercent: number | null;
  /** The new version's notes as plain text, cleaned up and capped; null when there are none (or they were unusable). */
  releaseNotes: string | null;
  error: string | null;
  /** Retry makes sense (a network error, say), as opposed to a failure that would just happen again. */
  canRetry: boolean;
  /** Why updates are off for this build (development, unpackaged, no feed, turned off by the environment). */
  disabledReason: string | null;
  channel: UpdateChannel;
  /** Epoch ms of the last finished check. */
  checkedAt: number | null;
  /** Set after relaunching into a freshly installed update, so the UI can say so once. */
  updatedTo: string | null;
}

/** What the renderer can ask the updater to do. `retry` repeats whatever failed; `dismiss` clears "Updated to vX". */
export type UpdateCommand =
  | "check"
  | "download"
  | "install"
  | "retry"
  | "dismiss";

/**
 * A validated `switchboard://` link, from main to the renderer. It opens New session with the folder and
 * prompt filled in (and starts the session only with `autostart`), or shows an existing session.
 */
export type DeepLink =
  | {
      action: "new-session";
      /** Text for the message box (at most 5,000 characters). */
      prompt: string | null;
      /** An absolute local folder. */
      cwd: string | null;
      /** One of your projects, by name; only when there is no `cwd`. */
      project: string | null;
      /** GitHub `owner/name`, resolved to a known checkout; only when there is neither `cwd` nor `project`. */
      repo: string | null;
      /** Start the session at once instead of waiting for Enter. Needs a prompt and a folder the link names. */
      autostart: boolean;
      /** A quick question: no project, in the scratch folder the engine keeps (`cwd`, `project` and `repo` are null). */
      question: boolean;
    }
  | { action: "session"; sessionId: string };

/** A link to act on, or why one was refused (shown briefly; nothing changes). */
export type DeepLinkMessage = { link: DeepLink } | { error: string };

/** What the renderer can ask main to do with themes (they live in main, next to the preferences). */
export type ThemeCommand =
  | { kind: "choose-file" }
  | { kind: "check-file"; path: string }
  | { kind: "add"; raw: unknown; how: "add" | "replace" | "keep-both" }
  | { kind: "remove"; id: string }
  | { kind: "duplicate"; id: string }
  | { kind: "export"; fileName: string; content: string }
  | { kind: "open-folder" }
  | { kind: "show-file"; id: string };

/** File extensions for the image types a transcript can hold (what Claude accepts), by media type. */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** An image from the conversation to save: base64 `data` of `mediaType`, suggested as `fileName`. */
/** A file or folder picked in the native open dialog, for a message's context. */
export interface PickedPath {
  path: string;
  directory: boolean;
}

export interface SaveImageRequest {
  mediaType: string;
  data: string;
  fileName: string;
}

/** Sent once per engine connection by the renderer. Used for startup timing and the smoke test. */
export interface RendererReadyReport {
  /** Epoch ms when the first ping came back, i.e. when the UI could talk to the engine. */
  connectedAt: number;
  engineVersion: string;
  claudeVersion: string | null;
  pingMs: number;
  /** Sessions in the first `sessions.list` answer (from cache or scan). */
  sessionCount: number;
}

export interface SwitchboardBridge {
  readonly platform: string;
  /** Asks main for a fresh engine port; it arrives as a window message tagged ENGINE_PORT_MESSAGE. */
  requestEnginePort(): void;
  /** Fires when the engine process was restarted and the old port is dead. */
  onEngineRestarted(listener: () => void): () => void;
  reportReady(report: RendererReadyReport): void;
  /** Native folder picker. Resolves to null when cancelled. */
  pickFolder(defaultPath?: string): Promise<string | null>;
  /** Tells main which session is on screen, so it doesn't notify about what you're already watching. */
  reportFocus(sessionId: string | null): void;
  /** Brings the window to the front (context arrived from the VS Code companion, which asked for it). */
  focusWindow(): void;
  /** Main asks to show a session (e.g. a notification was clicked). */
  onSelectSession(listener: (sessionId: string) => void): () => void;
  /** Native image picker (for project icons). Resolves to null when cancelled. */
  pickImage(defaultPath?: string): Promise<string | null>;
  /** Native open dialog for files (and folders, on macOS) to add as context, starting in `defaultPath`. Empty when cancelled. */
  pickContextFiles(defaultPath?: string): Promise<PickedPath[]>;
  /** Native save dialog for a settings export, suggesting `defaultName`. Resolves to null when cancelled. */
  chooseExportFile(defaultName: string): Promise<string | null>;
  /** Native open dialog for a settings file to import. Resolves to null when cancelled. */
  chooseImportFile(): Promise<string | null>;
  /** Native open dialog for a Claude data export: the memories and projects zips, an unzipped folder or the manifest JSON. Empty when cancelled. */
  chooseMemoryExport(): Promise<string[]>;
  /** Native save dialog for an image from the conversation, then writes it. Resolves to the path, or null when cancelled. */
  saveImage(request: SaveImageRequest): Promise<string | null>;
  /** Shows an image saved with `saveImage` in Finder (only those, never any other path). */
  showSavedImage(path: string): void;
  /** The path on disk of a dropped file or folder; empty for files that aren't on disk (made in the page, pasted). */
  getPathForFile(file: File): string;
  /** ⌘Q was pressed: show the quit prompt. Pressing ⌘Q again while it's open quits without it. */
  onQuitRequested(listener: () => void): () => void;
  answerQuit(answer: "quit" | "cancel"): void;
  /** Read once when the page loads, so the first paint already uses them. */
  readonly preferences: Preferences;
  /** Applies at once (the colour scheme flips prefers-color-scheme) and is remembered. */
  setPreferences(patch: Partial<Preferences>): void;
  /** Fires in every window after any change, including from the menu bar. */
  onPreferencesChanged(
    listener: (preferences: Preferences) => void,
  ): () => void;
  /** Switchboard → Settings… (⌘,) in the menu bar, or Check for Updates… (which opens About). */
  onOpenSettings(listener: (section: "about" | null) => void): () => void;
  /** Help › Keyboard Shortcuts (⌘/) in the menu bar: open the shortcuts sheet, or close it. */
  onToggleShortcuts(listener: () => void): () => void;
  /** Read once when the page loads. */
  readonly appInfo: AppInfo;
  /** Read once when the page loads; then follow `onUpdateState`. */
  readonly updateState: UpdateState;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  /** Check, download, install (restarts the app) or retry. The state arrives through `onUpdateState`. */
  update(command: UpdateCommand): void;
  /** Saves the channel in Preferences and checks again right away. */
  setUpdateChannel(channel: UpdateChannel): void;
  /**
   * Where the window's traffic lights sit: `rail` tucks them into the 64px minimal sidebar, `default`
   * puts them back. macOS only; elsewhere it does nothing.
   */
  setWindowButtons(position: "default" | "rail"): void;
  /** A `switchboard://` link was opened (main holds links until this window's renderer is ready). */
  onDeepLink(listener: (message: DeepLinkMessage) => void): () => void;
  /** Every theme, read once when the page loads (with the preferences), so the first paint has the right colours. */
  readonly themes: ThemeState;
  /** Fires after a theme is added, removed, or its file in the themes folder changes. */
  onThemesChanged(listener: (state: ThemeState) => void): () => void;
  /** Native open dialog for a theme file. Resolves to null when cancelled. */
  chooseThemeFile(): Promise<string | null>;
  /** Reads and validates a theme file someone wants to import. Nothing is added yet. */
  checkThemeFile(path: string): Promise<ThemeFileCheck>;
  /**
   * Adds a theme (validated again in main). `replace` overwrites the imported theme with the same name,
   * `keep-both` saves it as "<name> 2". Resolves to the new theme's id.
   */
  addTheme(raw: unknown, how: "add" | "replace" | "keep-both"): Promise<string>;
  /** Moves an imported theme's file to the Trash. Built-in themes can't be removed. */
  removeTheme(id: string): Promise<void>;
  /** Saves a copy of any theme as a new imported one ("<name> 2"). Resolves to its id. */
  duplicateTheme(id: string): Promise<string>;
  /** Native save dialog for a theme, then writes `content` (validated again). Resolves to the path, or null when cancelled. */
  exportTheme(fileName: string, content: string): Promise<string | null>;
  openThemesFolder(): void;
  /** Shows an imported theme's file in Finder. */
  showThemeFile(id: string): void;
}
