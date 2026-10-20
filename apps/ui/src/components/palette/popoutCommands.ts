import type { MainWindowRequest } from '@switchboard/protocol/bridge';
import type { PaletteContext } from './paletteContext.ts';

/**
 * What each palette command does in a pop-out, the palette of one session in a window of its own:
 *
 * - `here`: works as it does in the main window, on this window's session (its commands, git, terminal and actions,
 *   and what only changes a preference).
 * - `main`: runs in the main window, which comes to the front. Either the command's own code already routes there
 *   (Settings, Usage and a project's page go through `showInMain` in their stores), or it is a request built here
 *   (New session, Go to, Search, a step to another session).
 * - `hide`: makes no sense here, or needs something only the main window has (the sidebar, the panes, Home, dialogs
 *   mounted in the main window only). It is left out, as any command whose `when()` is false.
 */
export type PopoutClass = 'here' | 'main' | 'hide';

type Plan = 'here' | 'hide' | 'main' | ((ctx: PaletteContext) => MainWindowRequest);

const newSession = (cwd: (ctx: PaletteContext) => string | null) => (ctx: PaletteContext): MainWindowRequest => ({ kind: 'new-session', cwd: cwd(ctx), worktree: false });
const search = (memory: boolean) => (): MainWindowRequest => ({ kind: 'search', memory });
const navigate = (to: 'next' | 'previous' | 'needs-you') => (): MainWindowRequest => ({ kind: 'navigate', to });

/** Every command of `COMMANDS` by id (a test fails while one is missing, so a new command is decided on). */
const PLANS: Record<string, Plan> = {
  // Starting and finding sessions: the main window has the sidebar, New session and the list.
  'new-session': newSession(() => null),
  'new-session-here': newSession((ctx) => ctx.currentProject?.root ?? null),
  'quick-question': newSession((ctx) => ctx.questionsDir),
  'new-session-clone': 'hide',
  'new-session-worktree': 'hide',
  // The picker is a dialog of the main window.
  'new-session-from-issue': 'hide',
  'new-session-from-pr': 'hide',
  'queue-add': newSession(() => null),
  // Schedules: New session (and its dialog) are the main window's.
  'schedule-add': newSession(() => null),
  'go-to-session': () => ({ kind: 'go-to' }),
  'next-session': navigate('next'),
  'previous-session': navigate('previous'),
  'next-needs-you': navigate('needs-you'),
  search: search(false),
  'search-memory': search(true),

  // The main window's own: the sidebar, Home, the window's terminal outside a session, its dialogs and its queue.
  'toggle-sidebar': 'hide',
  home: 'hide',
  'toggle-app-terminal': 'hide',
  'new-app-terminal-tab': 'hide',
  'manage-projects': 'hide',
  'add-project': 'hide',
  'rename-project': 'hide',
  'clean-up-worktrees': 'hide',
  'import-theme': 'hide',
  'claude-update': 'hide',
  'export-settings': 'hide',
  'import-settings': 'hide',
  'memory-import-export': 'hide',
  'memory-paste': 'hide',
  'memory-copy-app': 'hide',
  'share-memory': 'hide',
  unsent: 'hide',
  'queue-start-next': 'hide',
  'queue-pick': 'hide',
  schedules: 'hide',
  // Triggers: the editor is a dialog of the main window.
  'trigger-new': 'hide',
  triggers: 'hide',
  'open-in-new-window': 'hide',

  // Settings, Usage, Upcoming and project pages: their stores send them to the main window.
  settings: 'main',
  'open-usage': 'main',
  upcoming: 'main',
  'queue-view': 'main',
  'schedules-view': 'main',
  'worktrees-here': 'main',
  worktrees: 'main',
  'branches-here': 'main',
  branches: 'main',
  'triggers-here': 'main',
  'triggers-page': 'main',
  memory: 'main',
  'memory-settings': 'main',
  'connect-computer': 'main',
  'vscode-extension': 'main',
  'manage-sessions': 'main',
  'delete-archived-sessions': 'main',
  diagnostics: 'main',

  // Preferences apply to every window.
  'export-theme': 'here',
  'reload-skills': 'here',
  shortcuts: 'here',
  'focus-on': 'here',
  'focus-off': 'here',
  'focus-set': 'here',
  'notifications-off': 'here',
  'notifications-on': 'here',
  'sounds-on': 'here',
  'sounds-off': 'here',
  'use-saved-prompt': 'here',
  'new-saved-prompt': 'here',

  // This session.
  'show-catch-up': 'here',
  'build-catch-up': 'here',
  'why-request': 'here',
  'rename-session': 'here',
  // New session lives in the main window, and its box is the one the link goes in.
  'new-session-linked': 'hide',
  'start-after-session': 'hide',
  pin: 'here',
  archive: 'here',
  fork: 'here',
  rewind: 'here',
  compact: 'here',
  'change-model': 'here',
  'change-effort': 'here',
  'change-mode': 'here',
  'ask-session': 'here',
  'prompt-previous': 'here',
  'prompt-next': 'here',
  'remember-this': 'here',
  'quote-in-reply': 'here',
  'copy-last-reply': 'here',
  'copy-session-id': 'here',
  'check-transcript': 'here',
  'toggle-terminal': 'here',
  'new-terminal-tab': 'here',
  'toggle-agents': 'here',
  'toggle-commands': 'here',
  'toggle-changes': 'here',
  tools: 'here',
  'open-in-editor': 'here',
  'reveal-in-finder': 'here',
  'add-context': 'here',
  'continue-in-vscode': 'here',
  'close-session': 'here',
  'delete-session': 'here',
  stop: 'here',
  'go-to-waiting': 'here',

  // Git, project actions and the session's terminal.
  commit: 'here',
  'create-pr': 'here',
  'fix-checks': 'here',
  sync: 'here',
  'switch-branch': 'here',
  'stage-all': 'here',
  'revert-all': 'here',
  'finish-worktree': 'here',
  'edit-actions': 'here',
  'new-action': 'here',
  'hide-terminal': 'here',
  'maximize-terminal': 'here',
  'dock-right': 'here',
  'dock-below': 'here',
  'stop-action': 'here',
  'restart-action': 'here',

  // Split view: a pop-out is one session, with no panes. New session's own commands and Settings' pages need their view.
  'focus-other-pane': 'hide',
  'focus-pane-left': 'hide',
  'focus-pane-right': 'hide',
  'focus-pane-up': 'hide',
  'focus-pane-down': 'hide',
  'swap-panes': 'hide',
  'stack-panes': 'hide',
  'panes-side-by-side': 'hide',
  'close-pane': 'hide',
  'close-other-panes': 'hide',
  'toggle-worktree': 'hide',
  'save-defaults': 'hide',
  'catch-up': 'hide',
};

/** The commands made from a list (`sidebar-compact`, `settings-memory`, `theme:solarized`, …) go by their prefix. */
const PREFIX_PLANS: ReadonlyArray<readonly [string, Plan]> = [
  ['sidebar-', 'hide'],
  ['settings-', 'hide'],
  ['theme-', 'here'],
  ['theme:', 'here'],
  ['action:', 'here'],
  ['prompt:', 'here'],
  ['project:', 'main'],
  ['new-session-on:', 'hide'],
  ['show-only:', 'hide'],
];

/** The plan of a command, or null when nobody has decided on it yet. */
function planOf(id: string): Plan | null {
  return PLANS[id] ?? PREFIX_PLANS.find(([prefix]) => id.startsWith(prefix))?.[1] ?? null;
}

/** Whether a command has been classified for a pop-out. */
export const isClassified = (id: string): boolean => planOf(id) !== null;

/** What a command does in a pop-out. One nobody has classified is left out, rather than run on the wrong window. */
export function popoutClass(id: string): PopoutClass {
  const plan = planOf(id);
  return plan === null || plan === 'hide' ? 'hide' : plan === 'here' ? 'here' : 'main';
}

/**
 * The request a command makes of the main window in a pop-out, or null when it runs here (or its own code routes it
 * there). Picking such a command sends this instead of running it or showing its next step.
 */
export function mainRequestFor(id: string, ctx: PaletteContext): MainWindowRequest | null {
  const plan = planOf(id);
  return typeof plan === 'function' ? plan(ctx) : null;
}
