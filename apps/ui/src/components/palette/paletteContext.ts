import type { PromptScope } from '@switchboard/protocol/client';
import type { ColorScheme, SidebarStyle } from '@switchboard/protocol/bridge';
import type { SidebarState } from '../../state/sidebarWidth.ts';
import type { ActionIcon, HostState } from '@switchboard/protocol/client';
import type { TerminalDock } from '../terminal/terminalLayout.ts';
import type { SettingsSection } from '../../state/sessionsStore.ts';
import type { Direction } from '../../state/tiling.ts';
import type { Way } from '../../state/tilingGeometry.ts';

/** Where you are: what the main area shows. */
/** `projects` is the list of projects; `project` one project's page. */
export type PaletteView = 'home' | 'new-session' | 'session' | 'settings' | 'projects' | 'project' | 'usage' | 'upcoming';

/** The session in the active pane, as far as the palette's commands care. */
export interface PaletteSession {
  id: string;
  title: string;
  /** It has a transcript, so it can be renamed, pinned, archived and deleted. */
  indexed: boolean;
  pinned: boolean;
  /** In the sidebar's Archived group (archived by you, or quiet for a while). */
  archived: boolean;
  cwd: string | null;
  projectRoot: string | null;
  isWorktree: boolean;
  /** Running in this app (its model, effort and mode can change); null otherwise. */
  host: { state: HostState; contextTokens: number | null; supportsEffort: boolean } | null;
  /** Claude is working or waiting for you here, so it can be stopped. */
  running: boolean;
  /** What it is waiting for. */
  waiting: 'question' | 'permission' | null;
  /** How its catch-up shows: in full (the card or the banner), folded into the strip, or not at all. */
  catchUp: 'full' | 'strip' | null;
  /** Your prompts in it (to fork from or rewind to). */
  prompts: number;
  /** Claude has replied at least once (Copy last reply). */
  hasReply: boolean;
}

/** The session's checkout, once read (null outside git, or until it has been read). */
export interface PaletteGit {
  /** Changed files, staged or not. */
  changed: number;
  /** Changed files not staged yet. */
  unstaged: number;
  hasRemote: boolean;
  /** Why a pull request can't be opened now, or null when it can. */
  prBlocked: string | null;
  /** A remote is on GitHub, so gh can open a pull request there. */
  github: boolean;
  /** The branch's open pull request, from gh. */
  pr: { number: number; url: string } | null;
  /** The branch is behind its upstream and can be pulled now (⌘⇧L). */
  pullable: boolean;
  /** Checks of the open pull request that failed. */
  failingChecks: number;
}

export interface PaletteTerminal {
  /** Whose panel ⌘J works on: the session's id, `APP_TERMINAL` for the window's own outside a session, null in Settings. */
  owner: string | null;
  /** Where a new tab starts: the session's folder, or for the window's terminal the project on screen (null: the home folder). */
  cwd: string | null;
  /** The panel shows. */
  open: boolean;
  maximized: boolean;
  dock: TerminalDock;
  /** The active tab runs a project action: whether it is still running. */
  action: { running: boolean } | null;
}

/** What the palette knows about where you are; every command's `when()` reads it. Built from the stores. */
export interface PaletteContext {
  /**
   * This is a pop-out: the palette of a session in a window of its own. Its context is that session. Commands for what
   * the main window owns (the sidebar, panes, Home) are left out and the ones that start or find another session run there
   * (`popoutCommands.ts`).
   */
  popout: boolean;
  view: PaletteView;
  /** Connected to the engine. */
  connected: boolean;
  session: PaletteSession | null;
  git: PaletteGit | null;
  terminal: PaletteTerminal;
  /** More than one pane open. */
  split: boolean;
  /** How the split holding the active pane lays its panes out: `row` side by side, `column` one above the other; null with one pane. */
  splitDirection: Direction | null;
  /** The directions in which the active pane has a neighbour to go to. */
  paneWays: readonly Way[];
  /** Null while the focus limit is off. */
  focusLimit: number | null;
  /** Settings › Notifications: notifications and sounds on or off. */
  notifications: boolean;
  sounds: boolean;
  /** The queue: how many items, how many are ready, and the first ready one ("Start next in queue"). */
  queue: { count: number; readyCount: number; firstReady: { id: string; prompt: string } | null };
  /** How many scheduled sessions there are (#173). */
  schedules: number;
  /** Unsent messages (sessions and New session prompts) that count. */
  unsent: number;
  projectCount: number;
  /** Your projects, in your order ("Project: <name>"). */
  projects: Array<{ root: string; name: string }>;
  /** The project a "New session in …" starts in: the page on screen, the open session's, else the sidebar's filter. */
  currentProject: { root: string; name: string } | null;
  /** The open session's project actions. */
  actions: Array<{ id: string; name: string; shortcut: string | null; icon: ActionIcon }>;
  /** The session has a project to keep actions in. */
  canEditActions: boolean;
  colorScheme: ColorScheme;
  /** Every theme, for "Theme: <name>", and the one in use. */
  themes: Array<{ id: string; name: string }>;
  themeId: string;
  sidebarStyle: SidebarStyle;
  /** Open, the minimal rail, or closed. */
  sidebar: SidebarState;
  settingsSection: SettingsSection;
  /** New session is on screen: what its route can do. */
  newSession: { canWorktree: boolean; canSaveDefaults: boolean; canQueue: boolean; canCatchUp: boolean; root?: string | null } | null;
  /** The scratch folder quick questions run in; null until the engine has said. */
  questionsDir: string | null;
  /** The saved prompts the message box on screen can use ("Prompt: <name>", Use saved prompt…). */
  prompts: Array<{ id: string; name: string; scope: PromptScope }>;
  /** The message box Add context… adds to (the session's, or New session's), once its folder is known. */
  composer: { key: string; cwd: string } | null;
  /** VS Code is installed, so a session can continue in its Claude Code extension. */
  canContinueInVSCode: boolean;
  /** Clone from GitHub is on (Settings › Projects): "New session from a GitHub repository…". */
  cloneEnabled: boolean;
  /** Paired computers that are connected: "New session on <name>…" and "Show only <name>". */
  computers: Array<{ id: string; name: string }>;
}
