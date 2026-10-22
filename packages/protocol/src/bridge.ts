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
import { DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from "./costEstimate.ts";
import { DEFAULT_APP_ICON, isAppIconKey, type AppIconKey } from "./appIcons.ts";

export * from "./retention.ts";
export * from "./autoModel.ts";
export * from "./appIcons.ts";

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
  pasteClipboard: "switchboard:paste-clipboard",
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
  quitContext: "switchboard:quit-context",
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
  listSounds: "switchboard:list-sounds",
  playSound: "switchboard:play-sound",
  notificationPermission: "switchboard:notification-permission",
  openNotificationSettings: "switchboard:open-notification-settings",
  testNotification: "switchboard:test-notification",
  getOpenAtLogin: "switchboard:get-open-at-login",
  setOpenAtLogin: "switchboard:set-open-at-login",
  openLoginItemsSettings: "switchboard:open-login-items-settings",
  keepAwakeStatus: "switchboard:keep-awake-status",
  getPopouts: "switchboard:get-popouts",
  popOut: "switchboard:pop-out",
  popIn: "switchboard:pop-in",
  showSession: "switchboard:show-session",
  forwardKeys: "switchboard:forward-keys",
  keysForwarded: "switchboard:keys-forwarded",
  showInMain: "switchboard:show-in-main",
  mainRequested: "switchboard:main-requested",
  popoutsChanged: "switchboard:popouts-changed",
  relayDrafts: "switchboard:relay-drafts",
  draftsRelayed: "switchboard:drafts-relayed",
  requestDrafts: "switchboard:request-drafts",
  draftsRequested: "switchboard:drafts-requested",
  getPopoutView: "switchboard:get-popout-view",
  reportView: "switchboard:report-view",
  viewReturned: "switchboard:view-returned",
} as const;

/** The query parameter that makes a window a pop-out: the id of the one session it shows. */
export const POPOUT_QUERY = "popout";

/**
 * Unsent messages that changed in one window, by draft key (`null`: the draft is gone). Main passes them on to
 * the other windows, so a session's draft is the same wherever it is shown. Only the main window saves drafts.
 */
export type DraftsChange = Record<string, unknown>;

/**
 * Which panels a session has open and how (the tab in front, the agent picked, the Ask thread, the terminal), as the
 * renderer collects it (`state/sessionViewState.ts`, which also checks one it receives). Main only carries it between
 * the windows a session moves between, in memory, and never looks inside.
 */
export type SessionView = Record<string, unknown>;

/** A key press a pop-out hands to the main window (an app-wide shortcut: the palette, search, New session…). */
export interface ForwardedKeys {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Something a pop-out asks the main window to show or do, because it has no such view itself: a page of Settings, the
 * Usage view, a project's page, New session (on a folder, in a new worktree), Go to, Search, or a step to another
 * session in the sidebar's order, or Upcoming (on a filter, with a schedule's run in view). `section` and `tab` are the names the main window's views use; it ignores one it
 * doesn't know.
 */
export type MainWindowRequest =
  | { kind: "settings"; section: string | null }
  | { kind: "usage"; profileId: string | null }
  | { kind: "project"; root: string; tab: string | null }
  | { kind: "new-session"; cwd: string | null; worktree: boolean }
  | { kind: "go-to" }
  | { kind: "search"; memory: boolean }
  | { kind: "navigate"; to: "next" | "previous" | "needs-you" }
  | { kind: "upcoming"; filter: "all" | "queue" | "schedules" | "triggers" | null; scheduleId: string | null };

/** Appearance: follow macOS, or always light or dark. */
export type ColorScheme = "system" | "light" | "dark";
/** Sidebar rows: a large project icon beside three lines, three lines, or one line. */
export type SidebarStyle = "large" | "standard" | "compact";
/** What collapsing the sidebar (⌘B) does: the narrow rail of project icons, or hide it. */
export type SidebarCollapsed = "minimal" | "closed";
/** Tool calls in a conversation: one summary line per run (click for the steps), or every step. */
export type ToolActivity = "summary" | "steps";
/** Settings › Conversation, "Under each reply": what a finished turn's line shows after the reply's actions. */
export type TurnDetails = "none" | "time" | "duration" | "tokens";
/**
 * What a click on a file link in the conversation does: open it in Switchboard (Markdown, HTML and code preview there,
 * other files show in the file manager), always show it in the file manager, or open it in the editor.
 */
export type FileLinkClick = "switchboard" | "file-manager" | "editor";
/**
 * The version of the `fileLinkClick` choices. Preferences are saved whole, so a saved "file-manager" can't be told
 * apart from the old default (before "switchboard" existed). It counts as a choice only from this revision on.
 */
export const FILE_LINK_CLICK_REVISION = 2;
/** Sessions in the sidebar: only those started or continued in Switchboard, or every Claude Code session. */
export type SessionScope = "switchboard" | "all";
/** What a new window shows: Home, the session open last time, or New session. */
export type StartupView = "home" | "last" | "new";
/** Which releases to update to: published releases, or the beta pre-releases too. */
export type UpdateChannel = "stable" | "beta";
/** How New session, Home and the palette list your projects: most recently used first, or in the order you set. */
export type ProjectOrder = "recent" | "yours";
/**
 * The global permission mode (Settings › General): what a new session starts in where neither its Claude profile
 * nor its project sets a mode. One mode, or the one you picked last (`remember`). Bypass permissions is never
 * offered, as in the mode menus. Older builds stored `project` (the project's or profile's mode, else Ask first)
 * and `last`; neither is read any more, so both become Ask first, and projects and profiles still come first.
 */
export type NewSessionMode = "remember" | "default" | "acceptEdits" | "plan" | "auto";
export const NEW_SESSION_MODES: readonly NewSessionMode[] = ["remember", "default", "acceptEdits", "plan", "auto"];
/** What Enter does while Claude is working: hold the message until the turn ends (`queue`), or hand it to Claude now (`steer`). */
export type WhileWorking = "queue" | "steer";
/** After a usage limit stops a session: offer to resume when it resets (`ask`), or arm that straight away (`always`). */
export type ResumeAtLimit = "ask" | "always";
/** The sidebar's order: by time and state (`recent`), or what takes least to unblock first (`quickest`). */
export type SidebarSort = "recent" | "quickest";

/** At the focus limit: ask first and allow going over (`nudge`), or wait until a session is finished (`strict`). */
export type FocusMode = "nudge" | "strict";

/** The focus limit's range: at least one session, at most ten. */
export const FOCUS_LIMIT_MIN = 1;
export const FOCUS_LIMIT_MAX = 10;
/** What the limit starts at when it is turned on. */
export const FOCUS_LIMIT_DEFAULT = 3;
/**
 * The sidebar's Star on GitHub button: shown (`ask`) until Switchboard is starred, its page was opened instead, or
 * you dismissed it (`done`). It never asks again after that.
 */
export type GithubStar = "ask" | "done";

/**
 * The moments that can play a sound: Claude needs you (a permission, a question or a plan), finished a turn,
 * stopped with an error, and a project action that ended.
 */
export type SoundEvent = "needsYou" | "finished" | "error" | "actionEnded";
export const SOUND_EVENTS: readonly SoundEvent[] = ["needsYou", "finished", "error", "actionEnded"];
/** What a moment set to no sound saves. */
export const NO_SOUND = "none";
/** A system sound's name, or `none`. */
export type SoundChoice = string;

/** A system notification when Claude needs you, finishes or stops with an error, and when a project action ends. The badge shows either way. */
export interface NotificationPrefs {
  enabled: boolean;
}

export interface SoundPrefs {
  /** Off keeps the choices below, so turning sounds on again brings them back. */
  enabled: boolean;
  /** Each moment's sound: a system sound's name, or `none`. */
  byEvent: Record<SoundEvent, SoundChoice>;
  /** 0 to 1, for every sound. */
  volume: number;
  /** The defaults these sounds were last brought up to (`SOUNDS_REVISION`). Not shown in Settings. */
  revision: number;
}

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = { enabled: true };

/**
 * Settings › Usage › Large context. A session whose context is at least `percent` full is "large": its ring turns
 * orange there, and the session says when its prompt cache lapses (after which the next message writes all of that
 * context again, `contextCache.ts`).
 */
export interface ContextWarningPrefs {
  enabled: boolean;
  /** 40–95, in steps of 5. */
  percent: number;
  /** A notification a few minutes before a large session's hour-long cache lapses. */
  notifyExpiry: boolean;
  /** Quitting with a large session open asks first, and says what it costs to pick up later. Off by default. */
  onQuit: boolean;
  /** The quit prompt has said once that it can warn about this. Not shown in Settings. */
  quitTipShown: boolean;
}

export const CONTEXT_WARNING_PERCENTS = [40, 50, 60, 70, 80, 90, 95] as const;
export const DEFAULT_CONTEXT_WARNING: ContextWarningPrefs = { enabled: true, percent: 60, notifyExpiry: true, onQuit: false, quitTipShown: false };

function sanitizeContextWarning(raw: unknown): ContextWarningPrefs | null {
  const r = raw as Partial<Record<keyof ContextWarningPrefs, unknown>> | null | undefined;
  if (!r || typeof r !== "object") return null;
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const d = DEFAULT_CONTEXT_WARNING;
  const percent = typeof r.percent === "number" && Number.isFinite(r.percent) ? Math.min(95, Math.max(40, Math.round(r.percent / 5) * 5)) : d.percent;
  return { enabled: flag(r.enabled, d.enabled), percent, notifyExpiry: flag(r.notifyExpiry, d.notifyExpiry), onQuit: flag(r.onQuit, d.onQuit), quitTipShown: flag(r.quitTipShown, d.quitTipShown) };
}
/** Bumped when the default sounds change, so sounds nobody picked move to the new defaults once (`sanitizeSounds`). */
export const SOUNDS_REVISION = 2;
export const DEFAULT_SOUNDS: SoundPrefs = {
  enabled: false,
  // A different sound per moment: Ping calls you over, Glass says done, Basso is a low thud for a failure and Pop
  // a short, light one for an action that ended. macOS names; another computer that lacks them plays its own
  // fallback (`resolveSound`).
  byEvent: { needsYou: "Ping", finished: "Glass", error: "Basso", actionEnded: "Pop" },
  volume: 0.5,
  revision: SOUNDS_REVISION,
};

/**
 * Sounds that were never picked, as earlier versions saved them: the move from one Session complete sound (Glass for
 * Finished, Stopped with an error and Project action ended), and the first defaults (no sound for an action).
 */
const UNPICKED_SOUNDS: ReadonlyArray<SoundPrefs["byEvent"]> = [
  { needsYou: "Ping", finished: "Glass", error: "Glass", actionEnded: "Glass" },
  { needsYou: "Ping", finished: "Glass", error: "Basso", actionEnded: NO_SOUND },
];

/** App preferences, kept by main in the app's data folder. */
export interface Preferences {
  colorScheme: ColorScheme;
  sidebarStyle: SidebarStyle;
  sidebarCollapsed: SidebarCollapsed;
  toolActivity: ToolActivity;
  /** What a click on a file link in the conversation does (Settings › Conversation); Shift-click does the other. */
  fileLinkClick: FileLinkClick;
  /** Internal: which version of the `fileLinkClick` choices was saved; "file-manager" without the current one is the old default. */
  fileLinkClickRevision: number;
  /** Settings › Conversation: "Show prompt outline", the rail beside the conversation with a mark for each of your prompts. */
  promptOutline: boolean;
  /** Settings › Conversation: "Under each reply", when a turn ended, how long it took and its tokens. */
  turnDetails: TurnDetails;
  /** Settings › Conversation: "Fade inactive panes". Off, the panes other than the active one look the same as it; the active one keeps its line. */
  fadeInactivePanes: boolean;
  /** ⌘Q asks first (a second ⌘Q quits). */
  confirmQuit: boolean;
  /** Settings › Remote: "Show in the sidebar when nobody is connected", the quiet "Remote on · nobody connected" line. */
  remoteIdleLine: boolean;
  sessionScope: SessionScope;
  startupView: StartupView;
  projectOrder: ProjectOrder;
  /** The global permission mode: what new sessions start in where the profile and the project set none (Settings › General). */
  newSessionMode: NewSessionMode;
  /**
   * Settings › General: "Use Claude in Chrome". On, sessions start with `--chrome`, so they get the Claude in Chrome
   * extension's browser tools. Claude Code's own "Enabled by default" only applies in a terminal, so an SDK host has to
   * ask for it. Off by default: not everyone has the extension.
   */
  chrome: boolean;
  /**
   * Settings › General: "Keep this Mac awake" ("this PC" elsewhere). On, the computer doesn't go to sleep while
   * Switchboard is open, so schedules, triggers and remote access keep working; the display can still sleep. macOS
   * runs `caffeinate -s` (on power only), Windows and Linux use Electron's sleep blocker. Off by default.
   */
  keepAwake: boolean;
  /** Check GitHub for a newer release shortly after launch and every few hours. */
  autoUpdate: boolean;
  updateChannel: UpdateChannel;
  /** The most sessions going at the same time (1–10); null turns the focus limit off. */
  focusLimit: number | null;
  focusMode: FocusMode;
  /** Also count live sessions started outside Switchboard (terminal, IDE). */
  focusCountExternal: boolean;
  /** Also count the sessions working on other paired computers (Remote access). On by default. */
  focusCountRemote: boolean;
  /** The colour theme: a built-in's id (`demo-time`, `github`…) or an imported theme's file name. */
  themeId: string;
  /**
   * Settings › Theme › App icon: the colourway of the icon in the Dock and the app switcher (macOS), or on the windows
   * and the taskbar. Main applies it at launch, before the first window. The bundle's own icon stays Graphite.
   */
  appIcon: AppIconKey;
  /** Settings › Theme › App icon: "Use it on your phone too", the remote app's icon and its browser tab. Off is Graphite there. */
  appIconOnRemote: boolean;
  /** Finished sessions leave the sidebar's main list after this many days without activity (1–365). */
  archiveAfterDays: number;
  /** Moves archived sessions to the Trash after some days in Archived (1–3650). Off by default. */
  deleteArchived: DeleteArchived;
  /** What Enter does in the message box while Claude is working (Settings › Conversation). */
  whileWorking: WhileWorking;
  /** Auto in the model menus: Haiku reads the first prompt and picks the model (Settings › Conversation). */
  autoModel: AutoModelPrefs;
  /**
   * Settings › Conversation: "Write catch-up summaries with Haiku". On, a finished session shows the catch-up banner and
   * Haiku writes its lines (and explains a permission when you ask why); off, there is no banner and no Haiku call.
   */
  catchUpSummaries: boolean;
  /**
   * Settings › Conversation: "Resume after a usage limit resets". `ask`: a session a usage limit stopped offers
   * Resume when it resets; `always`: it is armed to continue by itself at once.
   */
  resumeAtLimit: ResumeAtLimit;
  /**
   * Settings › Usage: "Show estimated cost". On, the usage bars under the message box and in New session say what the
   * tokens of each plan window would cost at API prices.
   */
  showCost: boolean;
  /**
   * Settings › Usage: "Show it on the usage bars". With "Show estimated cost" on, whether the bars under the message box
   * and in New session carry the estimate too. Off keeps it in the Usage view and next to Context.
   */
  showBarCost: boolean;
  /** Settings › Usage: the currency of the cost estimate. */
  costCurrency: CurrencyCode;
  /** Settings › Usage › Large context: when a session's context counts as large, and what that warns about. */
  contextWarning: ContextWarningPrefs;
  /**
   * Settings › Mods: "Show mods". Off, sessions don't attach their Claude Code mods: no bands, panes, statuses, toasts
   * or replaced views. Prompt screening still shows, since it happens in Claude Code.
   */
  showMods: boolean;
  /** Mods whose UI is hidden here, as `modKey(profileId, name)`; kept while Show mods is off. */
  hiddenMods: string[];
  /**
   * Projects (their roots) where the `#` list already showed its one hint about the GitHub CLI: there `#` stays plain
   * text until gh works.
   */
  githubHintSeen: string[];
  /** The sidebar's order (its Recent | Quickest to unblock control). */
  sidebarSort: SidebarSort;
  githubStar: GithubStar;
  /** Settings › Notifications: system notifications, separate from the sounds. */
  notifications: NotificationPrefs;
  /** Settings › Notifications: a sound per moment, with or without the notification. */
  sounds: SoundPrefs;
}

/** A mod in `hiddenMods`: its name per Claude profile (the same plugin can be in two profiles). */
export function modKey(profileId: string, name: string): string {
  return `${profileId}:${name}`;
}

export const DEFAULT_PREFERENCES: Preferences = {
  colorScheme: "system",
  sidebarStyle: "standard",
  sidebarCollapsed: "minimal",
  toolActivity: "summary",
  fileLinkClick: "switchboard",
  fileLinkClickRevision: FILE_LINK_CLICK_REVISION,
  promptOutline: true,
  turnDetails: "duration",
  fadeInactivePanes: true,
  confirmQuit: true,
  remoteIdleLine: true,
  sessionScope: "switchboard",
  startupView: "home",
  projectOrder: "recent",
  newSessionMode: "default",
  chrome: false,
  keepAwake: false,
  autoUpdate: true,
  updateChannel: "stable",
  focusLimit: null,
  focusMode: "nudge",
  focusCountExternal: false,
  focusCountRemote: true,
  themeId: DEFAULT_THEME_ID,
  appIcon: DEFAULT_APP_ICON,
  appIconOnRemote: true,
  archiveAfterDays: ARCHIVE_AFTER_DAYS.default,
  deleteArchived: DEFAULT_DELETE_ARCHIVED,
  whileWorking: "queue",
  autoModel: DEFAULT_AUTO_MODEL,
  catchUpSummaries: true,
  resumeAtLimit: "ask",
  showCost: true,
  showBarCost: true,
  costCurrency: DEFAULT_CURRENCY,
  contextWarning: DEFAULT_CONTEXT_WARNING,
  showMods: true,
  hiddenMods: [],
  githubHintSeen: [],
  sidebarSort: "recent",
  githubStar: "ask",
  notifications: DEFAULT_NOTIFICATIONS,
  sounds: DEFAULT_SOUNDS,
};

/** The sounds this computer has to pick from (its system sounds), and what each moment plays when the saved one is missing. */
export interface SoundList {
  sounds: string[];
  fallback: Record<SoundEvent, string | null>;
}

/** A sound's name: a system sound's file name without its extension ("Glass", "Windows Notify Messaging"). */
export const isSoundId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][\w .()'-]{0,63}$/.test(value);

/**
 * The sound a saved choice plays here: itself when this computer has it, otherwise the moment's fallback (a
 * Mac's "Glass" on Windows, after an import). None stays none.
 */
export function resolveSound(id: SoundChoice | null, list: SoundList, event: SoundEvent): string | null {
  if (id === null || id === NO_SOUND) return null;
  return list.sounds.includes(id) ? id : list.fallback[event];
}

const clampVolume = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, Math.round(value * 100) / 100)) : null;
/** A saved sound: a name, or `none` (null before, in the settings from before a sound per moment). */
const soundChoice = (value: unknown): SoundChoice | undefined =>
  value === null || value === NO_SOUND ? NO_SOUND : isSoundId(value) ? value : undefined;

/**
 * The sounds, from what is saved. The settings from before a sound per moment (`sounds: true`, `soundComplete`,
 * `soundNeedsInput`, `soundVolume`) move over: a sound you picked (or None) stays on every moment it played for (Needs
 * input is Needs you; Session complete is Finished, Stopped with an error and Project action ended), and one still at
 * its old default takes each moment's own default. Sounds saved before the current defaults, still as they were set
 * then, take the current defaults once. Undefined when nothing is saved.
 */
function sanitizeSounds(raw: Record<string, unknown>): SoundPrefs | undefined {
  const legacy = typeof raw.sounds === "boolean" || "soundComplete" in raw || "soundNeedsInput" in raw || "soundVolume" in raw;
  if (legacy && (raw.sounds === undefined || typeof raw.sounds === "boolean")) {
    const complete = soundChoice(raw.soundComplete) ?? "Glass";
    const needsInput = soundChoice(raw.soundNeedsInput) ?? "Ping";
    const picked = (sound: SoundChoice, oldDefault: string, event: SoundEvent) => (sound === oldDefault ? DEFAULT_SOUNDS.byEvent[event] : sound);
    return {
      enabled: typeof raw.sounds === "boolean" ? raw.sounds : DEFAULT_SOUNDS.enabled,
      byEvent: {
        needsYou: picked(needsInput, "Ping", "needsYou"),
        finished: picked(complete, "Glass", "finished"),
        error: picked(complete, "Glass", "error"),
        actionEnded: picked(complete, "Glass", "actionEnded"),
      },
      volume: clampVolume(raw.soundVolume) ?? DEFAULT_SOUNDS.volume,
      revision: SOUNDS_REVISION,
    };
  }
  const sounds = raw.sounds as Record<string, unknown> | null | undefined;
  if (typeof sounds !== "object" || sounds === null) return undefined;
  const saved = (typeof sounds.byEvent === "object" && sounds.byEvent !== null ? sounds.byEvent : {}) as Record<string, unknown>;
  // A field that is missing or wrong keeps its default; the rest stay as saved.
  const byEvent = Object.fromEntries(SOUND_EVENTS.map((event) => [event, soundChoice(saved[event]) ?? DEFAULT_SOUNDS.byEvent[event]])) as SoundPrefs["byEvent"];
  const outdated = sounds.revision !== SOUNDS_REVISION && UNPICKED_SOUNDS.some((old) => SOUND_EVENTS.every((event) => old[event] === byEvent[event]));
  return {
    enabled: typeof sounds.enabled === "boolean" ? sounds.enabled : DEFAULT_SOUNDS.enabled,
    byEvent: outdated ? { ...DEFAULT_SOUNDS.byEvent } : byEvent,
    volume: clampVolume(sounds.volume) ?? DEFAULT_SOUNDS.volume,
    revision: SOUNDS_REVISION,
  };
}

/** A change to the preferences: like the preferences, but the notification, sound and large context settings may name only some fields. */
export type PreferencesPatch = Partial<Omit<Preferences, "notifications" | "sounds" | "contextWarning">> & {
  notifications?: Partial<NotificationPrefs>;
  contextWarning?: Partial<ContextWarningPrefs>;
  sounds?: Partial<Omit<SoundPrefs, "byEvent" | "revision">> & { byEvent?: Partial<SoundPrefs["byEvent"]> };
};

/**
 * Applies a change to the preferences (unvalidated; sanitize the result). The notification, sound and large context
 * settings merge field by field, so `{ sounds: { enabled: false } }` keeps every sound.
 */
export function mergePreferences(current: Preferences, patch: unknown): Record<string, unknown> {
  const raw = (patch ?? {}) as Record<string, unknown>;
  const object = (value: unknown) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null);
  const merged: Record<string, unknown> = { ...current, ...raw };
  const notifications = object(raw.notifications);
  if (notifications) merged.notifications = { ...current.notifications, ...notifications };
  const contextWarning = object(raw.contextWarning);
  if (contextWarning) merged.contextWarning = { ...current.contextWarning, ...contextWarning };
  const sounds = object(raw.sounds);
  if (sounds) merged.sounds = { ...current.sounds, ...sounds, byEvent: { ...current.sounds.byEvent, ...object(sounds.byEvent) } };
  return merged;
}

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
  // An unknown value (a newer version's choice) is left out, so the default or the last good one stays.
  // "file-manager" saved before the revision was the old default, not a choice: leave it out so "switchboard" applies.
  if (
    oneOf(["switchboard", "editor"] as const, raw.fileLinkClick) ||
    (raw.fileLinkClick === "file-manager" && raw.fileLinkClickRevision === FILE_LINK_CLICK_REVISION)
  )
    out.fileLinkClick = raw.fileLinkClick as FileLinkClick;
  // The revision itself is never read back: the default carries the current one, so every save marks the choice as picked.
  if (typeof raw.promptOutline === "boolean") out.promptOutline = raw.promptOutline;
  if (oneOf(["none", "time", "duration", "tokens"] as const, raw.turnDetails))
    out.turnDetails = raw.turnDetails;
  if (typeof raw.fadeInactivePanes === "boolean") out.fadeInactivePanes = raw.fadeInactivePanes;
  if (typeof raw.confirmQuit === "boolean") out.confirmQuit = raw.confirmQuit;
  if (typeof raw.remoteIdleLine === "boolean") out.remoteIdleLine = raw.remoteIdleLine;
  if (oneOf(["switchboard", "all"] as const, raw.sessionScope))
    out.sessionScope = raw.sessionScope;
  if (oneOf(["home", "last", "new"] as const, raw.startupView))
    out.startupView = raw.startupView;
  if (oneOf(["recent", "yours"] as const, raw.projectOrder))
    out.projectOrder = raw.projectOrder;
  if (oneOf(NEW_SESSION_MODES, raw.newSessionMode))
    out.newSessionMode = raw.newSessionMode;
  if (typeof raw.chrome === "boolean") out.chrome = raw.chrome;
  if (typeof raw.keepAwake === "boolean") out.keepAwake = raw.keepAwake;
  if (typeof raw.autoUpdate === "boolean") out.autoUpdate = raw.autoUpdate;
  if (oneOf(["stable", "beta"] as const, raw.updateChannel))
    out.updateChannel = raw.updateChannel;
  // Nightly was replaced by Beta: whoever chose it keeps getting pre-releases.
  else if (raw.updateChannel === "nightly") out.updateChannel = "beta";
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
  if (typeof raw.focusCountRemote === "boolean")
    out.focusCountRemote = raw.focusCountRemote;
  if (isThemeId(raw.themeId)) out.themeId = raw.themeId;
  if (isAppIconKey(raw.appIcon)) out.appIcon = raw.appIcon;
  if (typeof raw.appIconOnRemote === "boolean") out.appIconOnRemote = raw.appIconOnRemote;
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
  if (typeof raw.catchUpSummaries === "boolean") out.catchUpSummaries = raw.catchUpSummaries;
  if (oneOf(["ask", "always"] as const, raw.resumeAtLimit))
    out.resumeAtLimit = raw.resumeAtLimit;
  if (typeof raw.showCost === "boolean") out.showCost = raw.showCost;
  if (typeof raw.showBarCost === "boolean") out.showBarCost = raw.showBarCost;
  if (isCurrencyCode(raw.costCurrency)) out.costCurrency = raw.costCurrency;
  const contextWarning = sanitizeContextWarning(raw.contextWarning);
  if (contextWarning) out.contextWarning = contextWarning;
  if (typeof raw.showMods === "boolean") out.showMods = raw.showMods;
  if (Array.isArray(raw.hiddenMods))
    out.hiddenMods = [...new Set(raw.hiddenMods.filter((m): m is string => typeof m === "string" && m.length > 0 && m.length <= 400))].slice(0, 500);
  if (Array.isArray(raw.githubHintSeen))
    out.githubHintSeen = [...new Set(raw.githubHintSeen.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 4096))].slice(-500);
  if (oneOf(["recent", "quickest"] as const, raw.sidebarSort))
    out.sidebarSort = raw.sidebarSort;
  if (oneOf(["ask", "done"] as const, raw.githubStar))
    out.githubStar = raw.githubStar;
  // Before notifications and sounds had a card each, Show notifications was a plain switch.
  if (typeof raw.notifications === "boolean") out.notifications = { enabled: raw.notifications };
  else if (typeof (raw.notifications as NotificationPrefs | null)?.enabled === "boolean")
    out.notifications = { enabled: (raw.notifications as NotificationPrefs).enabled };
  const sounds = sanitizeSounds(raw);
  if (sounds) out.sounds = sounds;
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
/** Switchboard's repository, which Star on GitHub opens when gh can't star it. */
export const REPO_URL = "https://github.com/estruyf/switchboard";

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
      /**
       * New session from this issue or pull request of the project (a number, or a link to it on GitHub): the worktree,
       * chip and prompt are filled in. Such a link never starts a session, whatever `autostart` says.
       */
      issue?: string | null;
      pr?: string | null;
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
  /** Pastes the clipboard into the focused field as Cmd/Ctrl+V does, so images and files reach the field's paste handler too. */
  pasteClipboard(): Promise<void>;
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
  /** Whether quitting should ask because of a session with a large context (Settings › Usage), even with Ask before quitting off. */
  setQuitContext(ask: boolean): void;
  /** Read once when the page loads, so the first paint already uses them. */
  readonly preferences: Preferences;
  /** Applies at once (the colour scheme flips prefers-color-scheme) and is remembered. */
  setPreferences(patch: PreferencesPatch): void;
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
  /** The system sounds to pick from in Settings › Notifications. */
  listSounds(): Promise<SoundList>;
  /** Plays a sound once at a volume (0 to 1), to try it. Only sounds from `listSounds`. */
  playSound(id: string, volume: number): void;
  /** Whether the system lets Switchboard show notifications (System Settings, or Windows settings). */
  notificationPermission(): Promise<NotificationPermission>;
  /** Opens the system's notification settings, at Switchboard where the system allows. */
  openNotificationSettings(): void;
  /** Shows one notification like a Needs you one, with its sound when sounds are on. */
  testNotification(): void;
  /** Whether Switchboard opens when you log in to this computer, as the system has it. */
  openAtLogin(): Promise<OpenAtLogin>;
  /** Adds Switchboard to the system's login items, or takes it off; answers how it stands afterwards. */
  setOpenAtLogin(on: boolean): Promise<OpenAtLogin>;
  /** Opens the system's list of apps that open at login (Login Items, or Startup apps on Windows). */
  openLoginItemsSettings(): void;
  /** Whether Keep awake is holding sleep off right now (on, and `caffeinate` or the sleep blocker is running). */
  keepAwakeStatus(): Promise<boolean>;
  /** The session this window shows on its own (a pop-out), or null for the main window. Read once when the page loads. */
  readonly popout: string | null;
  /** The sessions shown in pop-out windows, read once when the page loads; then follow `onPopoutsChanged`. */
  readonly popouts: readonly string[];
  /** Fires in every window when a pop-out opens or closes. */
  onPopoutsChanged(listener: (sessionIds: string[]) => void): () => void;
  /**
   * Shows a session in a window of its own, or brings its pop-out to the front when it has one. `view` is how the session's
   * panels stand here: a new pop-out starts with them (one that exists keeps its own).
   */
  popOut(sessionId: string, view?: SessionView): void;
  /** In a pop-out: the panels the session had open in the main window when it popped out, or null. Read once when the page loads. */
  readonly popoutView: SessionView | null;
  /** From a pop-out: tells main how its session's panels stand, so they go back to the main window with the session. */
  reportView(view: SessionView): void;
  /** In the main window: a session came back from its pop-out (moved back or closed) with its panels as they were left there. */
  onViewReturned(listener: (sessionId: string, view: SessionView) => void): () => void;
  /** From a pop-out: shows its session in the main window again and closes the pop-out. */
  popIn(): void;
  /** Shows a session where it is: its pop-out when it has one, otherwise the main window (both brought to the front). */
  showSession(sessionId: string): void;
  /** From a pop-out: brings the main window to the front and presses these keys there. */
  forwardKeys(keys: ForwardedKeys): void;
  /** In the main window: keys a pop-out handed over. */
  onKeysForwarded(listener: (keys: ForwardedKeys) => void): () => void;
  /** From a pop-out: brings the main window to the front and shows this view there (Settings, Usage, a project, New session). */
  showInMain(request: MainWindowRequest): void;
  /** In the main window: a view a pop-out asked it to show. */
  onMainRequest(listener: (request: MainWindowRequest) => void): () => void;
  /** Sends unsent messages that changed here to the other windows. */
  relayDrafts(change: DraftsChange): void;
  /** Unsent messages that changed in another window. */
  onDraftsRelayed(listener: (change: DraftsChange) => void): () => void;
  /** From a pop-out: asks the main window to relay all its unsent messages, images included (those are never saved). */
  requestDrafts(): void;
  /** In the main window: a pop-out asked for every unsent message. */
  onDraftsRequested(listener: () => void): () => void;
}

/**
 * Whether Switchboard opens at login. The system holds it (System Settings › General › Login Items, or Startup apps
 * on Windows), not the preferences, so a change made there shows here. `needs-approval`: macOS added it but waits for
 * you to allow it there. `unavailable`: a development build, which would add Electron itself, or Linux.
 */
export type OpenAtLogin = "on" | "off" | "needs-approval" | "unavailable";

/** `blocked`: notifications are turned off for Switchboard (or for every app) in the system's settings. `unknown` when it can't be told. */
export type NotificationPermission = "allowed" | "blocked" | "unknown";
