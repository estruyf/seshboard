import { fileManagerName } from '../../lib/platform.ts';
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownCircle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  Bell,
  BellOff,
  BellRing,
  Blocks,
  Brain,
  CloudDownload,
  Code,
  ChevronsDown,
  ChevronsUp,
  ClipboardCopy,
  ClipboardPaste,
  Columns2,
  Copy,
  Cpu,
  Download,
  FileDiff,
  Folder,
  FolderCog,
  FolderGit2,
  FolderPlus,
  Gauge,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitFork,
  GitMerge,
  GitPullRequest,
  Hash,
  House,
  Info,
  Keyboard,
  ListChecks,
  ListEnd,
  ListPlus,
  PencilLine,
  Maximize2,
  MessageSquare,
  MessageCircleQuestion,
  MessagesSquare,
  Monitor,
  Moon,
  Palette,
  Paperclip,
  PanelBottom,
  PanelLeft,
  PanelLeftClose,
  PanelLeftDashed,
  PanelLeftOpen,
  PanelRight,
  PanelsTopLeft,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows2,
  Save,
  Settings,
  Settings2,
  Share2,
  ShieldCheck,
  Shrink,
  SlidersHorizontal,
  Square,
  SquareCode,
  SquarePen,
  SquareTerminal,
  Stethoscope,
  StopCircle,
  Sun,
  Target,
  TextQuote,
  TextSearch,
  Trash2,
  Undo2,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ColorScheme, PreferencesPatch, SidebarStyle } from '@switchboard/protocol/bridge';
import { fuzzyMatch } from '../../lib/fuzzy.ts';
import { keysFor } from '../../lib/shortcuts.ts';
import type { SettingsSection } from '../../state/sessionsStore.ts';
import type { Way } from '../../state/tilingGeometry.ts';
import type { SidebarState } from '../../state/sidebarWidth.ts';
import { ACTION_ICON } from '../actions/actionIcon.ts';
import type { TerminalDock } from '../terminal/terminalLayout.ts';
import { APP_TERMINAL } from '../terminal/appTerminal.ts';
import type { PaletteContext } from './paletteContext.ts';
import { NEW_SESSION_STEP, type PaletteMode, type PaletteStep } from './paletteState.ts';

/** Requests the session view answers, because the dialog or menu they open lives there. */
export type SessionRequest = 'commit' | 'create-pr' | 'branch-menu' | 'edit-actions' | 'new-action' | 'ask';
/** Requests the New session view answers: they change its own choices. */
export type NewSessionRequest = 'toggle-worktree' | 'save-defaults' | 'add-to-queue' | 'catch-up';

/** What commands do, implemented against the stores in `paletteApi.ts` (and faked in tests). */
export interface PaletteApi {
  goHome(): void;
  /** The Usage view, for the default profile. */
  openUsage(): void;
  showSearch(): void;
  /** Search, on memory only. */
  showMemorySearch(): void;
  /** The keyboard shortcuts sheet (⌘/). */
  showShortcuts(): void;
  /** The Unsent messages list. */
  showUnsent(): void;
  openSettings(section?: SettingsSection): void;
  /** Settings › Sessions: every session, or with the delete switch focused. */
  manageSessions(options?: { focus?: 'archive' | 'delete' }): void;
  setPreferences(patch: PreferencesPatch): void;
  setSidebar(state: SidebarState): void;
  /** ⌘B: open, or collapsed as Settings says. */
  toggleSidebar(): void;
  /** The next (1) or previous (-1) session in the sidebar's order. */
  goToSession(direction: 1 | -1): void;
  goToNextNeedsYou(): void;
  manageProjects(): void;
  /** A project's page, on a tab or the one it was last left on. */
  openProject(root: string, tab?: 'worktrees' | 'branches' | 'memory'): void;
  /** A project's Worktrees tab with the clean-up confirmation for what it suggests. */
  cleanUpWorktrees(root: string): void;
  /** Memory in and out of the Claude app: Import from Claude export…, Paste from Claude app…, Copy for Claude app…. */
  memoryTransfer(kind: 'import-export' | 'paste' | 'copy'): void;
  addProject(): void;
  checkClaudeUpdate(): void;
  reloadSkills(): void;
  backup(kind: 'export' | 'import'): void;
  selectTheme(id: string): void;
  importTheme(): void;
  exportTheme(): void;
  setFocusLimit(on: boolean): void;
  renameSession(): void;
  setFlags(change: { pinned?: boolean; archived?: boolean }): void;
  compact(): void;
  copyLastReply(): void;
  /** Remember this…: the selected text in the conversation, else Claude's last reply, as a memory. */
  rememberThis(): void;
  /** Quote in reply: the selected text in the conversation, else Claude's last reply, quoted in the message box. */
  quoteInReply(): void;
  copySessionId(): void;
  checkTranscript(): void;
  toggleTerminal(): void;
  newTerminalTab(): void;
  toggleChanges(): void;
  showTools(): void;
  openInEditor(): void;
  revealInFinder(): void;
  /** The Add context picker, for the message box on screen. */
  addContext(): void;
  /** Stops the session here and continues it in VS Code's Claude Code extension. */
  continueInVSCode(): void;
  closeSession(): void;
  deleteSession(): void;
  stop(): void;
  goToWaiting(): void;
  sessionRequest(kind: SessionRequest): void;
  /** A web page, in the browser (a pull request). */
  openUrl(url: string): void;
  syncWithRemote(): void;
  stageAll(): void;
  revertAll(): void;
  runAction(id: string): void;
  hideTerminal(): void;
  toggleMaximizeTerminal(): void;
  dockTerminal(dock: TerminalDock): void;
  stopAction(): void;
  restartAction(): void;
  focusNextPane(): void;
  /** Goes to the pane next door in a direction. */
  focusPane(way: Way): void;
  swapPanes(): void;
  /** Turns the split holding the active pane the other way. */
  flipSplit(): void;
  closePane(): void;
  closeOtherPanes(): void;
  newSessionRequest(kind: NewSessionRequest): void;
  /** Opens the New session view (Add to queue… outside it). */
  openNewSession(): void;
  /** Starts a queued item (through the focus limit's gate). */
  startQueued(id: string): void;
}

/**
 * Where a command belongs. With nothing typed, the groups for where you are come first (This session,
 * Git, …), then recently used commands, then the rest (`general`).
 */
export type CommandGroup = 'session' | 'git' | 'actions' | 'terminal' | 'panes' | 'new-session' | 'settings' | 'general';

export const GROUP_LABEL: Record<CommandGroup, string> = {
  session: 'This session',
  git: 'Git',
  actions: 'Project actions',
  terminal: 'Terminal',
  panes: 'Split view',
  'new-session': 'New session',
  settings: 'Settings',
  general: 'Commands',
};

/** The context groups, in the order they show. */
const CONTEXT_GROUPS: CommandGroup[] = ['session', 'git', 'actions', 'terminal', 'panes', 'new-session', 'settings'];

/**
 * One command. It shows only while `when(ctx)` holds (never disabled), and picking it does one of
 * three things: `run`, show the step `next` returns (its title ends in "…" and the row has a chevron),
 * or switch the palette to `mode`.
 */
export interface PaletteCommand {
  id: string;
  title: string | ((ctx: PaletteContext) => string);
  group: CommandGroup;
  /** Other words it answers to. */
  keywords?: string;
  /** Stored (`cmd+shift+p`): `keysFor(id)` from the registry for Switchboard's own, an action's own shortcut for actions. */
  shortcut?: string;
  /** A quiet note on the right when there is no shortcut ("current project"), or one made from where you are. */
  hint?: string | ((ctx: PaletteContext) => string);
  /** The note in a status colour: `ok` for a ready queue item. */
  hintTone?: 'ok';
  icon: LucideIcon;
  when(ctx: PaletteContext): boolean;
  run?(api: PaletteApi, ctx: PaletteContext): void;
  next?(ctx: PaletteContext): PaletteStep;
  mode?: PaletteMode;
}

export const titleOf = (command: PaletteCommand, ctx: PaletteContext) => (typeof command.title === 'string' ? command.title : command.title(ctx));
export const hintOf = (command: PaletteCommand, ctx: PaletteContext) => (typeof command.hint === 'function' ? command.hint(ctx) : command.hint);

const always = () => true;
const hasSession = (ctx: PaletteContext) => ctx.view === 'session' && ctx.session !== null;
/** The session view is on screen with a session: the precondition of everything in "This session". */
const session = (ctx: PaletteContext) => (hasSession(ctx) ? ctx.session! : null);
const indexed = (ctx: PaletteContext) => session(ctx)?.indexed === true;
const withCwd = (ctx: PaletteContext) => !!session(ctx)?.cwd;
const hosted = (ctx: PaletteContext) => !!session(ctx)?.host && ctx.connected;
const inGit = (ctx: PaletteContext) => withCwd(ctx) && ctx.git !== null && ctx.connected;
/** The panel ⌘J works on is open: the session's, or outside a session the window's own. */
const terminalOpen = (ctx: PaletteContext) => ctx.terminal.owner !== null && ctx.terminal.open;
/** More than one pane is open, in the session view: the commands that arrange them. */
const panes = (ctx: PaletteContext) => ctx.split && ctx.view === 'session';
/** Outside a session, where the window's own terminal is. */
const appTerminal = (ctx: PaletteContext) => ctx.terminal.owner === APP_TERMINAL;

const THEMES: Array<{ value: ColorScheme; label: string; icon: LucideIcon }> = [
  { value: 'system', label: 'Match System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];
const SIDEBAR_STYLES: Array<{ value: SidebarStyle; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large icons' },
];
/** Settings' pages, in the order of its own sidebar. */
const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'sidebar', label: 'Sidebar', icon: PanelLeft },
  { id: 'sessions', label: 'Sessions', icon: Archive },
  { id: 'conversation', label: 'Conversation', icon: MessageSquare },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'focus', label: 'Focus', icon: Target },
  { id: 'profiles', label: 'Claude profiles', icon: Users },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'vscode', label: 'VS Code', icon: SquareCode },
  { id: 'backup', label: 'Backup', icon: ArchiveRestore },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'about', label: 'About', icon: Info },
];

/** Every command that doesn't depend on the project's actions. */
export const COMMANDS: PaletteCommand[] = [
  // Always
  { id: 'new-session', title: 'New session…', group: 'general', shortcut: keysFor('session.new'), icon: SquarePen, keywords: 'start create prompt', when: always, next: () => NEW_SESSION_STEP },
  {
    id: 'new-session-here',
    title: (ctx) => `New session in ${ctx.currentProject?.name ?? 'this project'}`,
    group: 'general',
    hint: 'current project',
    icon: SquarePen,
    keywords: 'start create prompt',
    when: (ctx) => ctx.currentProject !== null,
    next: (ctx) => ({ kind: 'prompt', root: ctx.currentProject!.root, worktree: false, chip: 'New session' }),
  },
  {
    id: 'quick-question',
    title: 'Quick question…',
    group: 'general',
    shortcut: keysFor('session.question'),
    icon: MessageCircleQuestion,
    keywords: 'ask chat no project scratch',
    // The prompt step, in the scratch folder the engine keeps: no project to pick.
    when: (ctx) => ctx.connected && ctx.questionsDir !== null,
    next: (ctx) => ({ kind: 'prompt', root: ctx.questionsDir!, worktree: false, chip: 'Quick question' }),
  },
  {
    id: 'new-session-worktree',
    title: 'New session in a worktree…',
    group: 'general',
    icon: GitBranchPlus,
    keywords: 'start create isolated branch',
    when: always,
    next: () => ({ kind: 'projects', purpose: 'new-session', worktree: true, chip: 'New session in a worktree' }),
  },
  // The window's own terminal, outside a session (a session's are under This session).
  { id: 'toggle-app-terminal', title: 'Toggle terminal', group: 'general', shortcut: keysFor('terminal.toggle'), icon: SquareTerminal, keywords: 'shell panel', when: appTerminal, run: (api) => api.toggleTerminal() },
  { id: 'new-app-terminal-tab', title: 'New terminal tab', group: 'general', icon: Plus, keywords: 'shell', when: (ctx) => appTerminal(ctx) && ctx.connected, run: (api) => api.newTerminalTab() },
  { id: 'go-to-session', title: 'Go to session…', group: 'general', shortcut: keysFor('palette.goto'), icon: MessagesSquare, keywords: 'open switch find project quick', when: always, mode: 'goto' },
  { id: 'next-session', title: 'Next session', group: 'general', shortcut: keysFor('session.next'), icon: ChevronsDown, keywords: 'switch cycle down sidebar order', when: always, run: (api) => api.goToSession(1) },
  { id: 'previous-session', title: 'Previous session', group: 'general', shortcut: keysFor('session.previous'), icon: ChevronsUp, keywords: 'switch cycle up sidebar order back', when: always, run: (api) => api.goToSession(-1) },
  { id: 'next-needs-you', title: 'Go to next session that needs you', group: 'general', shortcut: keysFor('session.next-needs-you'), icon: BellRing, keywords: 'waiting permission question attention', when: always, run: (api) => api.goToNextNeedsYou() },
  { id: 'toggle-sidebar', title: 'Toggle sidebar', group: 'general', shortcut: keysFor('sidebar.toggle'), icon: PanelLeft, keywords: 'hide show collapse rail', when: always, run: (api) => api.toggleSidebar() },
  { id: 'sidebar-open', title: 'Open sidebar', group: 'general', icon: PanelLeftOpen, keywords: 'show expand', when: (ctx) => ctx.sidebar !== 'open', run: (api) => api.setSidebar('open') },
  { id: 'sidebar-minimize', title: 'Minimize sidebar', group: 'general', icon: PanelLeftDashed, keywords: 'rail icons collapse narrow', when: (ctx) => ctx.sidebar !== 'minimal', run: (api) => api.setSidebar('minimal') },
  { id: 'sidebar-close', title: 'Close sidebar', group: 'general', icon: PanelLeftClose, keywords: 'hide collapse full width', when: (ctx) => ctx.sidebar !== 'closed', run: (api) => api.setSidebar('closed') },
  { id: 'home', title: 'Home', group: 'general', shortcut: keysFor('home'), icon: House, keywords: 'start overview dashboard', when: (ctx) => ctx.view !== 'home', run: (api) => api.goHome() },
  { id: 'open-usage', title: 'Open usage', group: 'general', icon: Gauge, keywords: 'plan limits tokens usage insights session weekly cache', when: (ctx) => ctx.view !== 'usage', run: (api) => api.openUsage() },
  { id: 'search-memory', title: 'Search memory…', group: 'general', icon: Brain, keywords: 'find memories knowledge notes', when: (ctx) => ctx.connected, run: (api) => api.showMemorySearch() },
  { id: 'search', title: 'Search conversations', group: 'general', shortcut: keysFor('search'), icon: TextSearch, keywords: 'find text', when: always, run: (api) => api.showSearch() },
  { id: 'settings', title: 'Settings', group: 'general', shortcut: keysFor('settings'), icon: Settings, keywords: 'preferences', when: (ctx) => ctx.view !== 'settings', run: (api) => api.openSettings() },
  ...SIDEBAR_STYLES.map(
    ({ value, label }): PaletteCommand => ({
      id: `sidebar-${value}`,
      title: `Sidebar: ${label}`,
      group: 'general',
      icon: PanelLeft,
      keywords: 'rows density',
      when: (ctx) => ctx.sidebarStyle !== value,
      run: (api) => api.setPreferences({ sidebarStyle: value }),
    }),
  ),
  ...THEMES.map(
    ({ value, label, icon }): PaletteCommand => ({
      id: `theme-${value}`,
      title: `Appearance: ${label}`,
      group: 'general',
      icon,
      keywords: 'theme colour color dark light mode',
      when: (ctx) => ctx.colorScheme !== value,
      run: (api) => api.setPreferences({ colorScheme: value }),
    }),
  ),
  { id: 'import-theme', title: 'Import theme…', group: 'general', icon: Upload, keywords: 'colours colors json file', when: always, run: (api) => api.importTheme() },
  { id: 'export-theme', title: 'Export current theme…', group: 'general', icon: Download, keywords: 'colours colors json file save', when: always, run: (api) => api.exportTheme() },
  { id: 'manage-projects', title: 'Manage projects', group: 'general', icon: FolderCog, keywords: 'folders defaults', when: (ctx) => ctx.view !== 'projects', run: (api) => api.manageProjects() },
  { id: 'add-project', title: 'Add project…', group: 'general', icon: FolderPlus, keywords: 'folder', when: always, run: (api) => api.addProject() },
  {
    id: 'worktrees-here',
    title: (ctx) => `Worktrees in ${ctx.currentProject?.name ?? 'this project'}`,
    group: 'general',
    hint: 'current project',
    icon: FolderGit2,
    keywords: 'worktree branches clean up remove disk space overview',
    when: (ctx) => ctx.currentProject !== null && ctx.projects.some((p) => p.root === ctx.currentProject!.root),
    run: (api, ctx) => api.openProject(ctx.currentProject!.root, 'worktrees'),
  },
  {
    id: 'worktrees',
    title: 'Worktrees…',
    group: 'general',
    icon: FolderGit2,
    keywords: 'worktree branches clean up remove disk space overview project',
    when: (ctx) => ctx.projects.length > 0 && ctx.connected,
    next: () => ({ kind: 'projects', purpose: 'worktrees', worktree: false, chip: 'Worktrees' }),
  },
  {
    id: 'branches-here',
    title: (ctx) => `Branches in ${ctx.currentProject?.name ?? 'this project'}`,
    group: 'general',
    hint: 'current project',
    icon: GitBranch,
    keywords: 'git branches local remote origin delete prune merged clean up overview',
    when: (ctx) => ctx.currentProject !== null && ctx.projects.some((p) => p.root === ctx.currentProject!.root),
    run: (api, ctx) => api.openProject(ctx.currentProject!.root, 'branches'),
  },
  {
    id: 'branches',
    title: 'Branches…',
    group: 'general',
    icon: GitBranch,
    keywords: 'git branches local remote origin delete prune merged clean up overview project',
    when: (ctx) => ctx.projects.length > 0 && ctx.connected,
    next: () => ({ kind: 'projects', purpose: 'branches', worktree: false, chip: 'Branches' }),
  },
  {
    id: 'memory',
    title: 'Memory…',
    group: 'general',
    hint: (ctx) => (ctx.currentProject && ctx.projects.some((p) => p.root === ctx.currentProject!.root) ? ctx.currentProject.name : 'Settings'),
    icon: Brain,
    keywords: 'claude.md rules instructions knowledge remember memory.md personal',
    when: always,
    // The current project's Memory tab; with no project in view, every project's in Settings.
    run: (api, ctx) => (ctx.currentProject && ctx.projects.some((p) => p.root === ctx.currentProject!.root) ? api.openProject(ctx.currentProject.root, 'memory') : api.openSettings('memory')),
  },
  { id: 'memory-settings', title: 'Memory settings…', group: 'general', icon: Brain, keywords: 'personal memory folder claude.md block sync icloud dropbox', when: always, run: (api) => api.openSettings('memory') },
  {
    id: 'memory-import-export',
    title: 'Import memory from Claude export…',
    group: 'general',
    icon: Download,
    keywords: 'claude app data export zip memories',
    when: (ctx) => ctx.connected,
    run: (api) => api.memoryTransfer('import-export'),
  },
  { id: 'memory-paste', title: 'Paste memory from Claude app…', group: 'general', icon: ClipboardPaste, keywords: 'claude app memory import', when: (ctx) => ctx.connected, run: (api) => api.memoryTransfer('paste') },
  { id: 'memory-copy-app', title: 'Copy memory for Claude app…', group: 'general', icon: ClipboardCopy, keywords: 'claude app memory export', when: (ctx) => ctx.connected, run: (api) => api.memoryTransfer('copy') },
  {
    id: 'share-memory',
    title: 'Share memory with the team…',
    group: 'general',
    icon: Share2,
    keywords: 'memory claude.md rules instructions promote move project knowledge',
    when: (ctx) => ctx.connected && ctx.currentProject !== null && ctx.projects.some((p) => p.root === ctx.currentProject!.root),
    next: () => ({ kind: 'pick', list: 'memory', chip: 'Share memory' }),
  },
  {
    id: 'clean-up-worktrees',
    title: (ctx) => `Clean up worktrees in ${ctx.currentProject?.name ?? 'this project'}…`,
    group: 'general',
    icon: Trash2,
    keywords: 'worktree remove prune merged disk space',
    when: (ctx) => ctx.connected && ctx.currentProject !== null && ctx.projects.some((p) => p.root === ctx.currentProject!.root),
    run: (api, ctx) => api.cleanUpWorktrees(ctx.currentProject!.root),
  },
  {
    id: 'rename-project',
    title: 'Rename project…',
    group: 'general',
    icon: Pencil,
    keywords: 'name folder',
    when: (ctx) => ctx.projectCount > 0 && ctx.connected,
    next: () => ({ kind: 'projects', purpose: 'rename-project', worktree: false, chip: 'Rename project' }),
  },
  { id: 'claude-update', title: 'Check for Claude Code updates…', group: 'general', icon: ArrowDownCircle, keywords: 'upgrade version cli', when: always, run: (api) => api.checkClaudeUpdate() },
  { id: 'reload-skills', title: 'Reload skills', group: 'general', icon: RefreshCw, keywords: 'refresh slash commands plugins', when: (ctx) => ctx.connected, run: (api) => api.reloadSkills() },
  { id: 'export-settings', title: 'Export settings…', group: 'general', icon: Upload, keywords: 'backup save move mac projects actions preferences', when: always, run: (api) => api.backup('export') },
  { id: 'import-settings', title: 'Import settings…', group: 'general', icon: Download, keywords: 'backup restore move mac projects actions preferences', when: always, run: (api) => api.backup('import') },
  { id: 'vscode-extension', title: 'VS Code extension', group: 'general', icon: SquareCode, keywords: 'companion cursor windsurf install marketplace settings', when: always, run: (api) => api.openSettings('vscode') },
  { id: 'manage-sessions', title: 'Manage sessions', group: 'general', icon: Archive, keywords: 'archived archive delete trash clean up old all sessions overview size disk', when: always, run: (api) => api.manageSessions() },
  {
    id: 'delete-archived-sessions',
    title: 'Delete archived sessions…',
    group: 'general',
    icon: Trash2,
    keywords: 'auto delete clean up old archived trash retention days cleanupPeriodDays',
    when: always,
    run: (api) => api.manageSessions({ focus: 'delete' }),
  },
  { id: 'diagnostics', title: 'Engine diagnostics', group: 'general', icon: Activity, keywords: 'settings log version', when: always, run: (api) => api.openSettings('diagnostics') },
  { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'general', shortcut: keysFor('shortcuts'), icon: Keyboard, keywords: 'help keys hotkeys cheat sheet', when: always, run: (api) => api.showShortcuts() },
  { id: 'focus-on', title: 'Focus limit: turn on', group: 'general', icon: Target, keywords: 'limit sessions', when: (ctx) => ctx.focusLimit === null, run: (api) => api.setFocusLimit(true) },
  { id: 'focus-off', title: 'Focus limit: turn off', group: 'general', icon: Target, keywords: 'limit sessions', when: (ctx) => ctx.focusLimit !== null, run: (api) => api.setFocusLimit(false) },
  { id: 'notifications-off', title: 'Notifications: turn off', group: 'general', icon: BellOff, keywords: 'alerts quiet do not disturb', when: (ctx) => ctx.notifications, run: (api) => api.setPreferences({ notifications: { enabled: false } }) },
  { id: 'notifications-on', title: 'Notifications: turn on', group: 'general', icon: Bell, keywords: 'alerts', when: (ctx) => !ctx.notifications, run: (api) => api.setPreferences({ notifications: { enabled: true } }) },
  { id: 'sounds-on', title: 'Sounds: turn on', group: 'general', icon: Volume2, keywords: 'sound audio chime alert notifications', when: (ctx) => !ctx.sounds, run: (api) => api.setPreferences({ sounds: { enabled: true } }) },
  { id: 'sounds-off', title: 'Sounds: turn off', group: 'general', icon: VolumeX, keywords: 'sound audio mute quiet notifications', when: (ctx) => ctx.sounds, run: (api) => api.setPreferences({ sounds: { enabled: false } }) },
  { id: 'focus-set', title: 'Focus limit: set limit…', group: 'general', icon: Target, keywords: 'limit sessions number', when: always, next: () => ({ kind: 'pick', list: 'focus-limit', chip: 'Focus limit' }) },
  {
    id: 'unsent',
    title: 'Unsent messages…',
    group: 'general',
    icon: PencilLine,
    keywords: 'drafts unsent kept typed not sent',
    hint: (ctx) => `${ctx.unsent} unsent`,
    when: (ctx) => ctx.unsent > 0,
    run: (api) => api.showUnsent(),
  },
  {
    id: 'queue-start-next',
    title: 'Start next in queue',
    group: 'general',
    icon: Play,
    keywords: 'queue ready later saved prompt',
    hint: (ctx) => ctx.queue.firstReady?.prompt ?? '',
    hintTone: 'ok',
    when: (ctx) => ctx.queue.readyCount > 0 && ctx.connected,
    run: (api, ctx) => api.startQueued(ctx.queue.firstReady!.id),
  },
  {
    id: 'queue-pick',
    title: 'Queue: pick one to start…',
    group: 'general',
    icon: ListEnd,
    keywords: 'later saved prompts waiting',
    hint: (ctx) => `${ctx.queue.count} queued`,
    when: (ctx) => ctx.queue.count > 0 && ctx.connected,
    next: () => ({ kind: 'pick', list: 'queue', chip: 'Queue' }),
  },
  {
    id: 'queue-add',
    title: (ctx) => (ctx.newSession?.canQueue ? 'Add to queue' : 'Add to queue…'),
    group: 'general',
    shortcut: keysFor('new-session.queue'),
    icon: ListPlus,
    keywords: 'later save park prompt',
    hint: (ctx) => (ctx.newSession?.canQueue ? '' : 'opens New session'),
    when: (ctx) => ctx.connected,
    // In New session with a prompt: queue it. Anywhere else: New session, to write one.
    run: (api, ctx) => (ctx.newSession?.canQueue ? api.newSessionRequest('add-to-queue') : api.openNewSession()),
  },

  // A session is open
  { id: 'rename-session', title: 'Rename session…', group: 'session', icon: Pencil, keywords: 'title name', when: indexed, run: (api) => api.renameSession() },
  {
    id: 'pin',
    title: (ctx) => (ctx.session?.pinned ? 'Unpin' : 'Pin'),
    group: 'session',
    icon: Pin,
    keywords: 'unpin keep top',
    when: indexed,
    run: (api, ctx) => api.setFlags({ pinned: !ctx.session!.pinned }),
  },
  {
    id: 'archive',
    title: (ctx) => (ctx.session?.archived ? 'Unarchive' : 'Archive'),
    group: 'session',
    icon: Archive,
    keywords: 'unarchive settle hide done',
    when: indexed,
    run: (api, ctx) => api.setFlags(ctx.session!.archived ? { archived: false } : { archived: true, pinned: false }),
  },
  {
    id: 'fork',
    title: 'Fork session…',
    group: 'session',
    icon: GitFork,
    keywords: 'copy branch conversation',
    when: (ctx) => indexed(ctx) && ctx.connected && (session(ctx)!.prompts > 0 || session(ctx)!.hasReply),
    next: () => ({ kind: 'pick', list: 'fork', chip: 'Fork session' }),
  },
  {
    id: 'rewind',
    title: 'Rewind to a message…',
    group: 'session',
    icon: Undo2,
    keywords: 'undo file changes checkpoint',
    when: (ctx) => ctx.connected && (session(ctx)?.prompts ?? 0) > 0,
    next: () => ({ kind: 'pick', list: 'rewind', chip: 'Rewind to a message' }),
  },
  { id: 'compact', title: 'Compact context', group: 'session', icon: Shrink, keywords: '/compact summarise', when: (ctx) => hosted(ctx) && (session(ctx)!.host!.contextTokens ?? 0) > 0, run: (api) => api.compact() },
  { id: 'change-model', title: 'Change model…', group: 'session', icon: Cpu, keywords: 'opus sonnet haiku', when: hosted, next: () => ({ kind: 'pick', list: 'model', chip: 'Model' }) },
  { id: 'change-effort', title: 'Change effort…', group: 'session', icon: Gauge, keywords: 'thinking', when: (ctx) => hosted(ctx) && session(ctx)!.host!.supportsEffort, next: () => ({ kind: 'pick', list: 'effort', chip: 'Effort' }) },
  { id: 'change-mode', title: 'Change permission mode…', group: 'session', shortcut: keysFor('mode.cycle'), icon: ShieldCheck, keywords: 'plan accept edits auto', when: hosted, next: () => ({ kind: 'pick', list: 'mode', chip: 'Permission mode' }) },
  {
    id: 'ask-session',
    title: 'Ask about this session',
    group: 'session',
    icon: MessageCircleQuestion,
    keywords: '/btw side question by the way aside threads not added to the conversation',
    when: (ctx) => session(ctx) !== null && ctx.connected,
    run: (api) => api.sessionRequest('ask'),
  },
  { id: 'remember-this', title: 'Remember this…', group: 'session', icon: Brain, keywords: 'memory save note selection reply', when: (ctx) => !!session(ctx)?.hasReply && ctx.connected, run: (api) => api.rememberThis() },
  { id: 'quote-in-reply', title: 'Quote in reply', group: 'session', icon: TextQuote, keywords: 'quote answer question selection reply message box', when: (ctx) => !!session(ctx)?.hasReply, run: (api) => api.quoteInReply() },
  { id: 'copy-last-reply', title: 'Copy last reply', group: 'session', icon: Copy, keywords: 'clipboard markdown answer', when: (ctx) => !!session(ctx)?.hasReply, run: (api) => api.copyLastReply() },
  { id: 'copy-session-id', title: 'Copy session id', group: 'session', icon: Hash, keywords: 'clipboard uuid resume', when: (ctx) => session(ctx) !== null, run: (api) => api.copySessionId() },
  { id: 'check-transcript', title: 'Check transcript…', group: 'session', icon: Stethoscope, keywords: 'diagnose empty missing messages error debug compacted', when: (ctx) => session(ctx) !== null && ctx.connected, run: (api) => api.checkTranscript() },
  { id: 'toggle-terminal', title: 'Toggle terminal', group: 'session', shortcut: keysFor('terminal.toggle'), icon: SquareTerminal, keywords: 'shell panel', when: (ctx) => session(ctx) !== null, run: (api) => api.toggleTerminal() },
  { id: 'new-terminal-tab', title: 'New terminal tab', group: 'session', icon: Plus, keywords: 'shell', when: (ctx) => withCwd(ctx) && ctx.connected, run: (api) => api.newTerminalTab() },
  { id: 'toggle-changes', title: 'Toggle changes', group: 'session', shortcut: keysFor('changes.toggle'), icon: FileDiff, keywords: 'diff git panel', when: inGit, run: (api) => api.toggleChanges() },
  { id: 'tools', title: 'Tools: MCP servers, skills, agents, plugins', group: 'session', icon: Blocks, keywords: 'mcp extensions capabilities', when: withCwd, run: (api) => api.showTools() },
  { id: 'open-in-editor', title: 'Open folder in editor', group: 'session', shortcut: keysFor('editor.open'), icon: Code, keywords: 'vscode cursor', when: withCwd, run: (api) => api.openInEditor() },
  { id: 'reveal-in-finder', title: `Reveal folder in ${fileManagerName()}`, group: 'session', icon: Folder, keywords: 'show files', when: withCwd, run: (api) => api.revealInFinder() },
  {
    id: 'add-context',
    title: 'Add context…',
    group: 'session',
    shortcut: keysFor('composer.add-context'),
    icon: Paperclip,
    keywords: 'files attach mention @ chips several',
    when: (ctx) => ctx.composer !== null && ctx.connected,
    run: (api) => api.addContext(),
  },
  {
    id: 'continue-in-vscode',
    title: 'Continue in VS Code',
    group: 'session',
    icon: Code,
    keywords: 'editor claude code extension hand off move',
    when: (ctx) => indexed(ctx) && withCwd(ctx) && !session(ctx)!.running && ctx.canContinueInVSCode && ctx.connected,
    run: (api) => api.continueInVSCode(),
  },
  { id: 'close-session', title: 'Close session', group: 'session', icon: X, keywords: 'home', when: (ctx) => session(ctx) !== null, run: (api) => api.closeSession() },
  { id: 'delete-session', title: 'Delete session…', group: 'session', icon: Trash2, keywords: 'trash remove', when: (ctx) => indexed(ctx) && ctx.connected, run: (api) => api.deleteSession() },
  { id: 'stop', title: 'Stop Claude', group: 'session', shortcut: keysFor('claude.stop'), icon: StopCircle, keywords: 'interrupt cancel', when: (ctx) => !!session(ctx)?.running && !!session(ctx)?.host && ctx.connected, run: (api) => api.stop() },
  {
    id: 'go-to-waiting',
    title: (ctx) => (ctx.session?.waiting === 'question' ? 'Go to the question' : 'Go to the permission'),
    group: 'session',
    icon: BellRing,
    keywords: 'needs you answer allow',
    when: (ctx) => !!session(ctx)?.waiting,
    run: (api) => api.goToWaiting(),
  },

  // The folder is a git repository
  { id: 'commit', title: 'Commit…', group: 'git', icon: GitCommitHorizontal, keywords: 'git message', when: (ctx) => inGit(ctx) && ctx.git!.changed > 0, run: (api) => api.sessionRequest('commit') },
  {
    id: 'create-pr',
    // Once the branch has an open pull request, the same command opens it.
    title: (ctx) => (ctx.git?.pr ? `View pull request #${ctx.git.pr.number}` : 'Create pull request…'),
    group: 'git',
    icon: GitPullRequest,
    keywords: 'git github pr gh open view',
    when: (ctx) => inGit(ctx) && ctx.git!.github && (ctx.git!.pr !== null || ctx.git!.prBlocked === null),
    run: (api, ctx) => (ctx.git?.pr ? api.openUrl(ctx.git.pr.url) : api.sessionRequest('create-pr')),
  },
  { id: 'sync', title: 'Sync with remote', group: 'git', icon: RefreshCw, keywords: 'git pull push fetch', when: (ctx) => inGit(ctx) && ctx.git!.hasRemote, run: (api) => api.syncWithRemote() },
  { id: 'switch-branch', title: 'Switch branch…', group: 'git', icon: GitBranch, keywords: 'git checkout', when: (ctx) => inGit(ctx) && !session(ctx)!.isWorktree && !session(ctx)!.running, run: (api) => api.sessionRequest('branch-menu') },
  { id: 'stage-all', title: 'Stage all', group: 'git', icon: ListChecks, keywords: 'git add', when: (ctx) => inGit(ctx) && ctx.git!.unstaged > 0, run: (api) => api.stageAll() },
  { id: 'revert-all', title: 'Revert all changes…', group: 'git', icon: Undo2, keywords: 'git discard reset', when: (ctx) => inGit(ctx) && ctx.git!.changed > 0, run: (api) => api.revertAll() },
  { id: 'finish-worktree', title: 'Finish worktree…', group: 'git', icon: GitMerge, keywords: 'git merge remove', when: (ctx) => inGit(ctx) && session(ctx)!.isWorktree, run: (api) => api.sessionRequest('branch-menu') },

  // Project actions (the actions themselves come from `actionCommands`)
  { id: 'edit-actions', title: 'Edit actions…', group: 'actions', icon: Settings2, keywords: 'project scripts', when: (ctx) => hasSession(ctx) && ctx.canEditActions && ctx.actions.length > 0, run: (api) => api.sessionRequest('edit-actions') },
  { id: 'new-action', title: 'New action…', group: 'actions', icon: Plus, keywords: 'project scripts add', when: (ctx) => hasSession(ctx) && ctx.canEditActions, run: (api) => api.sessionRequest('new-action') },

  // The terminal is open
  { id: 'hide-terminal', title: 'Hide terminal', group: 'terminal', shortcut: keysFor('terminal.toggle'), icon: SquareTerminal, keywords: 'close panel', when: terminalOpen, run: (api) => api.hideTerminal() },
  {
    id: 'maximize-terminal',
    title: (ctx) => (ctx.terminal.maximized ? 'Restore terminal' : 'Maximize terminal'),
    group: 'terminal',
    shortcut: keysFor('terminal.maximize'),
    icon: Maximize2,
    keywords: 'full size',
    when: terminalOpen,
    run: (api) => api.toggleMaximizeTerminal(),
  },
  { id: 'dock-right', title: 'Dock terminal right', group: 'terminal', icon: PanelRight, keywords: 'side', when: (ctx) => terminalOpen(ctx) && ctx.terminal.dock === 'bottom', run: (api) => api.dockTerminal('right') },
  { id: 'dock-below', title: 'Dock terminal below', group: 'terminal', icon: PanelBottom, keywords: 'bottom', when: (ctx) => terminalOpen(ctx) && ctx.terminal.dock === 'right', run: (api) => api.dockTerminal('bottom') },
  { id: 'stop-action', title: 'Stop action', group: 'terminal', shortcut: keysFor('terminal.stop-action'), icon: Square, keywords: 'kill command', when: (ctx) => terminalOpen(ctx) && !!ctx.terminal.action?.running, run: (api) => api.stopAction() },
  { id: 'restart-action', title: 'Restart action', group: 'terminal', icon: RotateCcw, keywords: 'run again', when: (ctx) => terminalOpen(ctx) && ctx.terminal.action !== null && ctx.connected, run: (api) => api.restartAction() },

  // Split view
  { id: 'focus-other-pane', title: 'Focus next pane', group: 'panes', icon: ArrowLeftRight, keywords: 'split switch other tile', when: panes, run: (api) => api.focusNextPane() },
  { id: 'focus-pane-left', title: 'Focus pane on the left', group: 'panes', shortcut: keysFor('pane.focus-left'), icon: ArrowLeft, keywords: 'split tile go', when: (ctx) => panes(ctx) && ctx.paneWays.includes('left'), run: (api) => api.focusPane('left') },
  { id: 'focus-pane-right', title: 'Focus pane on the right', group: 'panes', shortcut: keysFor('pane.focus-right'), icon: ArrowRight, keywords: 'split tile go', when: (ctx) => panes(ctx) && ctx.paneWays.includes('right'), run: (api) => api.focusPane('right') },
  { id: 'focus-pane-up', title: 'Focus pane above', group: 'panes', shortcut: keysFor('pane.focus-up'), icon: ArrowUp, keywords: 'split tile go top', when: (ctx) => panes(ctx) && ctx.paneWays.includes('up'), run: (api) => api.focusPane('up') },
  { id: 'focus-pane-down', title: 'Focus pane below', group: 'panes', shortcut: keysFor('pane.focus-down'), icon: ArrowDown, keywords: 'split tile go bottom', when: (ctx) => panes(ctx) && ctx.paneWays.includes('down'), run: (api) => api.focusPane('down') },
  { id: 'swap-panes', title: 'Swap panes', group: 'panes', shortcut: keysFor('pane.swap'), icon: ArrowRightLeft, keywords: 'split exchange switch move left right top bottom next tile', when: panes, run: (api) => api.swapPanes() },
  { id: 'stack-panes', title: 'Stack panes', group: 'panes', shortcut: keysFor('pane.orientation'), icon: Rows2, keywords: 'split layout orientation direction flip vertical rows above below tile', when: (ctx) => panes(ctx) && ctx.splitDirection === 'row', run: (api) => api.flipSplit() },
  { id: 'panes-side-by-side', title: 'Show panes side by side', group: 'panes', shortcut: keysFor('pane.orientation'), icon: Columns2, keywords: 'split layout orientation direction flip horizontal columns left right tile', when: (ctx) => panes(ctx) && ctx.splitDirection === 'column', run: (api) => api.flipSplit() },
  { id: 'close-pane', title: 'Close this pane', group: 'panes', shortcut: keysFor('pane.close'), icon: X, keywords: 'split tile', when: panes, run: (api) => api.closePane() },
  { id: 'close-other-panes', title: 'Close other panes', group: 'panes', shortcut: keysFor('pane.close-other'), icon: PanelsTopLeft, keywords: 'split tile only keep', when: panes, run: (api) => api.closeOtherPanes() },

  // New session is on screen
  { id: 'toggle-worktree', title: 'Toggle worktree', group: 'new-session', icon: FolderGit2, keywords: 'isolated checkout', when: (ctx) => !!ctx.newSession?.canWorktree, run: (api) => api.newSessionRequest('toggle-worktree') },
  { id: 'save-defaults', title: 'Save as project default', group: 'new-session', icon: Save, keywords: 'model effort mode', when: (ctx) => !!ctx.newSession?.canSaveDefaults, run: (api) => api.newSessionRequest('save-defaults') },
  { id: 'catch-up', title: 'Update from remote', group: 'new-session', icon: CloudDownload, keywords: 'git pull fetch sync latest', when: (ctx) => !!ctx.newSession?.canCatchUp, run: (api) => api.newSessionRequest('catch-up') },

  // Settings is open: its pages
  ...SETTINGS_SECTIONS.map(
    ({ id, label, icon }): PaletteCommand => ({
      id: `settings-${id}`,
      title: `Settings: ${label}`,
      group: 'settings',
      icon,
      keywords: 'preferences page',
      when: (ctx) => ctx.view === 'settings' && ctx.settingsSection !== id,
      run: (api) => api.openSettings(id),
    }),
  ),
];

/** "Run: <action>" for each of the open session's project actions, with its shortcut. */
export function actionCommands(ctx: PaletteContext): PaletteCommand[] {
  return ctx.actions.map((action) => ({
    id: `action:${action.id}`,
    title: `Run: ${action.name}`,
    group: 'actions',
    shortcut: action.shortcut ?? undefined,
    icon: ACTION_ICON[action.icon] ?? Square,
    keywords: 'project action',
    when: hasSession,
    run: (api) => api.runAction(action.id),
  }));
}

/** "Theme: <name>" for each theme but the one in use. */
export function themeCommands(ctx: PaletteContext): PaletteCommand[] {
  return ctx.themes.map((theme) => ({
    id: `theme:${theme.id}`,
    title: `Theme: ${theme.name}`,
    group: 'general',
    icon: Palette,
    keywords: 'colours colors appearance',
    when: (c) => c.themeId !== theme.id,
    run: (api) => api.selectTheme(theme.id),
  }));
}

/** "Project: <name>" for each of your projects, opening its page (not the one already on screen). */
export function projectCommands(ctx: PaletteContext): PaletteCommand[] {
  return ctx.projects.map((project) => ({
    id: `project:${project.root}`,
    title: `Project: ${project.name}`,
    group: 'general',
    icon: Folder,
    keywords: 'open page sessions worktrees actions defaults',
    when: (c) => !(c.view === 'project' && c.currentProject?.root === project.root),
    run: (api) => api.openProject(project.root),
  }));
}

/** Every command that can show here, before matching what is typed. */
export function visibleCommands(ctx: PaletteContext, commands: readonly PaletteCommand[] = COMMANDS): PaletteCommand[] {
  return [...commands, ...actionCommands(ctx), ...themeCommands(ctx), ...projectCommands(ctx)].filter((command) => command.when(ctx));
}

/** A command as a row: its title for this context, and which letters matched what was typed. */
export interface RankedCommand {
  command: PaletteCommand;
  title: string;
  indices: number[];
}

export interface CommandSection {
  id: string;
  label: string;
  items: RankedCommand[];
}

/** How many recently used commands are remembered (in memory, for this window). */
export const RECENT_LIMIT = 5;

/** `id` moved to the front of the recently used list. */
export function rememberIn(recent: readonly string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...recent.filter((other) => other !== id)].slice(0, limit);
}

let recentIds: string[] = [];
/** The commands used most recently in this window, newest first. */
export const recentCommands = (): readonly string[] => recentIds;
export function rememberCommand(id: string): void {
  recentIds = rememberIn(recentIds, id);
}

/**
 * The palette's command list. With nothing typed: the groups for where you are first (This session,
 * Git, Project actions, Terminal, …), then recently used, then the rest. With a query: the best
 * matches by title (or keywords, a little lower), ties going to the commands for where you are.
 */
export function arrangeCommands(commands: readonly PaletteCommand[], ctx: PaletteContext, recent: readonly string[], query: string): CommandSection[] {
  const rank = (command: PaletteCommand): RankedCommand => ({ command, title: titleOf(command, ctx), indices: [] });
  if (query.trim()) {
    const contextFirst = (command: PaletteCommand) => (command.group === 'general' ? 1 : 0);
    const matches = commands
      .map((command) => {
        const title = titleOf(command, ctx);
        const byTitle = fuzzyMatch(query, title);
        const byKeywords = command.keywords ? fuzzyMatch(query, command.keywords) : null;
        const keywordScore = byKeywords ? byKeywords.score - 2 : -Infinity;
        const score = Math.max(byTitle?.score ?? -Infinity, keywordScore);
        return { command, title, score, indices: byTitle && byTitle.score >= keywordScore ? byTitle.indices : [] };
      })
      .filter((match) => match.score > -Infinity)
      .sort((a, b) => b.score - a.score || contextFirst(a.command) - contextFirst(b.command));
    return matches.length ? [{ id: 'matches', label: 'Commands', items: matches.map(({ command, title, indices }) => ({ command, title, indices })) }] : [];
  }
  const sections: CommandSection[] = [];
  const shown = new Set<string>();
  for (const group of CONTEXT_GROUPS) {
    const items = commands.filter((command) => command.group === group);
    if (items.length === 0) continue;
    items.forEach((command) => shown.add(command.id));
    sections.push({ id: group, label: GROUP_LABEL[group], items: items.map(rank) });
  }
  const byId = new Map(commands.map((command) => [command.id, command]));
  const recentItems = recent.flatMap((id) => (byId.has(id) && !shown.has(id) ? [byId.get(id)!] : []));
  recentItems.forEach((command) => shown.add(command.id));
  if (recentItems.length) sections.push({ id: 'recent', label: 'Recently used', items: recentItems.map(rank) });
  const rest = commands.filter((command) => !shown.has(command.id));
  if (rest.length) sections.push({ id: 'general', label: GROUP_LABEL.general, items: rest.map(rank) });
  return sections;
}

