import { describe, expect, it, vi } from 'vitest';
import { arrangeCommands, COMMANDS, hintOf, rememberIn, titleOf, visibleCommands, type PaletteApi } from './commands.ts';
import type { PaletteContext, PaletteGit, PaletteSession } from './paletteContext.ts';
import { shortcutGlyphs } from '../../lib/shortcuts.ts';
import { APP_TERMINAL } from '../terminal/appTerminal.ts';

const SESSION: PaletteSession = {
  id: 's1',
  title: 'Fix the login',
  indexed: true,
  pinned: false,
  archived: false,
  cwd: '/work/app',
  projectRoot: '/work/app',
  isWorktree: false,
  host: null,
  running: false,
  waiting: null,
  prompts: 0,
  hasReply: false,
};

/** Home, connected, nothing open: the context every test changes a little. */
function context(over: Partial<PaletteContext> = {}): PaletteContext {
  return {
    view: 'home',
    connected: true,
    session: null,
    git: null,
    terminal: { owner: null, cwd: null, open: false, maximized: false, dock: 'bottom', action: null },
    split: false,
    splitDirection: null,
    paneWays: [],
    focusLimit: null,
    notifications: true,
    sounds: false,
    queue: { count: 0, readyCount: 0, firstReady: null },
    unsent: 0,
    projectCount: 2,
    projects: [
      { root: '/work/app', name: 'app' },
      { root: '/work/site', name: 'site' },
    ],
    currentProject: null,
    actions: [],
    canEditActions: false,
    colorScheme: 'system',
    themes: [
      { id: 'demo-time', name: 'Demo Time' },
      { id: 'solarized', name: 'Solarized' },
    ],
    themeId: 'demo-time',
    sidebarStyle: 'standard',
    sidebar: 'open',
    settingsSection: 'general',
    newSession: null,
    questionsDir: '/data/questions',
    composer: null,
    canContinueInVSCode: false,
    ...over,
  };
}

/** A clean checkout with a GitHub remote. */
const GIT: PaletteGit = { changed: 0, unstaged: 0, hasRemote: true, prBlocked: null, github: true, pr: null, pullable: false };
const inSession = (session: Partial<PaletteSession> = {}, over: Partial<PaletteContext> = {}) =>
  context({ view: 'session', session: { ...SESSION, ...session }, terminal: { ...context().terminal, owner: 's1', cwd: '/work/app' }, ...over });
const ids = (ctx: PaletteContext) => visibleCommands(ctx).map((c) => c.id);
const groupIds = (ctx: PaletteContext, group: string) => visibleCommands(ctx).filter((c) => c.group === group).map((c) => c.id);

describe('when(): always', () => {
  it('shows the commands that need nothing open, and never the ones for a session', () => {
    const shown = ids(context());
    for (const id of ['new-session', 'new-session-worktree', 'go-to-session', 'search', 'settings', 'manage-projects', 'add-project', 'rename-project', 'claude-update', 'reload-skills', 'export-settings', 'import-settings', 'diagnostics', 'shortcuts', 'focus-on', 'focus-set']) {
      expect(shown, id).toContain(id);
    }
    expect(groupIds(context(), 'session')).toEqual([]);
    expect(groupIds(context(), 'git')).toEqual([]);
  });

  it('hides what is already the case', () => {
    const shown = ids(context({ colorScheme: 'dark', sidebarStyle: 'compact' }));
    expect(shown).not.toContain('theme-dark');
    expect(shown).toEqual(expect.arrayContaining(['theme-light', 'theme-system', 'sidebar-standard', 'sidebar-large']));
    expect(shown).not.toContain('sidebar-compact');
    expect(shown).not.toContain('home');
    expect(ids(context({ view: 'settings' }))).not.toContain('settings');
  });

  it('turns the focus limit on or off', () => {
    expect(ids(context())).not.toContain('focus-off');
    expect(ids(context({ focusLimit: 3 }))).toEqual(expect.arrayContaining(['focus-off', 'focus-set']));
    expect(ids(context({ focusLimit: 3 }))).not.toContain('focus-on');
  });

  it('turns notifications and sounds on or off', () => {
    expect(ids(context())).toEqual(expect.arrayContaining(['notifications-off', 'sounds-on']));
    expect(ids(context())).not.toContain('notifications-on');
    expect(ids(context())).not.toContain('sounds-off');
    expect(ids(context({ notifications: false, sounds: true }))).toEqual(expect.arrayContaining(['notifications-on', 'sounds-off']));
  });

  it('offers the queue commands without the focus limit: start next only when one is ready, pick only with items', () => {
    expect(ids(context())).not.toContain('queue-start-next');
    expect(ids(context())).not.toContain('queue-pick');
    expect(ids(context())).toContain('queue-add');
    const queue = { count: 3, readyCount: 1, firstReady: { id: 'q1', prompt: 'Add a Queue section…' } };
    const ctx = context({ queue });
    expect(ids(ctx)).toEqual(expect.arrayContaining(['queue-start-next', 'queue-pick', 'queue-add']));
    expect(ids(context({ queue: { ...queue, readyCount: 0, firstReady: null } }))).not.toContain('queue-start-next');
    const next = visibleCommands(ctx).find((c) => c.id === 'queue-start-next')!;
    expect(hintOf(next, ctx)).toBe('Add a Queue section…');
    const api = { startQueued: vi.fn(), openNewSession: vi.fn(), newSessionRequest: vi.fn() } as unknown as PaletteApi;
    next.run!(api, ctx);
    expect(api.startQueued).toHaveBeenCalledWith('q1');
    expect(hintOf(visibleCommands(ctx).find((c) => c.id === 'queue-pick')!, ctx)).toBe('3 queued');
    // Add to queue… opens New session, or queues the prompt when New session has one.
    const add = visibleCommands(ctx).find((c) => c.id === 'queue-add')!;
    expect(titleOf(add, ctx)).toBe('Add to queue…');
    add.run!(api, ctx);
    expect(api.openNewSession).toHaveBeenCalled();
    const inNew = context({ view: 'new-session', newSession: { canWorktree: false, canSaveDefaults: false, canQueue: true, canCatchUp: false } });
    expect(titleOf(add, inNew)).toBe('Add to queue');
    add.run!(api, inNew);
    expect(api.newSessionRequest).toHaveBeenCalledWith('add-to-queue');
  });

  it('asks a quick question in the scratch folder, once the engine has said where it is', () => {
    const ctx = context();
    const ask = visibleCommands(ctx).find((c) => c.id === 'quick-question')!;
    expect(ask.next!(ctx)).toEqual({ kind: 'prompt', root: '/data/questions', worktree: false, chip: 'Quick question' });
    expect(ids(context({ questionsDir: null }))).not.toContain('quick-question');
    expect(ids(context({ connected: false }))).not.toContain('quick-question');
  });

  it('names the current project in "New session in …", and needs projects to rename one', () => {
    const ctx = context({ currentProject: { root: '/work/app', name: 'app' } });
    const here = visibleCommands(ctx).find((c) => c.id === 'new-session-here')!;
    expect(titleOf(here, ctx)).toBe('New session in app');
    expect(here.next!(ctx)).toEqual({ kind: 'prompt', root: '/work/app', worktree: false, chip: 'New session' });
    expect(ids(context())).not.toContain('new-session-here');
    expect(ids(context({ projectCount: 0 }))).not.toContain('rename-project');
  });

  it('leaves out what needs the engine while it is away', () => {
    expect(ids(context({ connected: false }))).not.toContain('reload-skills');
  });
});

describe('when(): a session is open', () => {
  it('shows This session only in the session view', () => {
    const shown = groupIds(inSession({}, { git: GIT }), 'session');
    expect(shown).toEqual(expect.arrayContaining(['rename-session', 'pin', 'archive', 'copy-session-id', 'toggle-terminal', 'new-terminal-tab', 'toggle-changes', 'tools', 'open-in-editor', 'reveal-in-finder', 'close-session', 'delete-session']));
    expect(groupIds({ ...inSession(), view: 'settings' }, 'session')).toEqual([]);
  });

  it('needs a transcript to rename, pin, archive or delete, and a folder for the folder commands', () => {
    const fresh = groupIds(inSession({ indexed: false, cwd: null }), 'session');
    expect(fresh).not.toEqual(expect.arrayContaining(['rename-session']));
    for (const id of ['rename-session', 'pin', 'archive', 'delete-session', 'open-in-editor', 'toggle-changes', 'tools']) expect(fresh, id).not.toContain(id);
    expect(fresh).toEqual(expect.arrayContaining(['copy-session-id', 'close-session']));
  });

  it('offers Toggle changes only in a git checkout, where the Changes panel can show', () => {
    expect(ids(inSession({}, { git: GIT }))).toContain('toggle-changes');
    expect(ids(inSession())).not.toContain('toggle-changes');
    // The folder commands still work outside git.
    expect(ids(inSession())).toEqual(expect.arrayContaining(['open-in-editor', 'reveal-in-finder', 'tools']));
  });

  it('says Pin or Unpin, Archive or Unarchive, from the session', () => {
    const pinned = inSession({ pinned: true, archived: true });
    const byId = (id: string) => COMMANDS.find((c) => c.id === id)!;
    expect(titleOf(byId('pin'), pinned)).toBe('Unpin');
    expect(titleOf(byId('archive'), pinned)).toBe('Unarchive');
    expect(titleOf(byId('pin'), inSession())).toBe('Pin');
    const api = { setFlags: vi.fn() } as unknown as PaletteApi;
    byId('archive').run!(api, pinned);
    expect(api.setFlags).toHaveBeenCalledWith({ archived: false });
    byId('archive').run!(api, inSession({ pinned: true }));
    expect(api.setFlags).toHaveBeenLastCalledWith({ archived: true, pinned: false });
  });

  it('changes model, effort and mode, and compacts, only while it runs here', () => {
    expect(ids(inSession())).not.toEqual(expect.arrayContaining(['change-model']));
    const hosted = inSession({ host: { state: 'idle', contextTokens: 1200, supportsEffort: true } });
    expect(ids(hosted)).toEqual(expect.arrayContaining(['change-model', 'change-effort', 'change-mode', 'compact']));
    expect(ids(inSession({ host: { state: 'idle', contextTokens: 0, supportsEffort: false } }))).not.toEqual(expect.arrayContaining(['compact']));
    expect(ids(inSession({ host: { state: 'idle', contextTokens: null, supportsEffort: false } }))).not.toContain('change-effort');
  });

  it('forks, rewinds and copies once there is a conversation', () => {
    expect(ids(inSession())).not.toContain('fork');
    const talked = ids(inSession({ prompts: 2, hasReply: true }));
    expect(talked).toEqual(expect.arrayContaining(['fork', 'rewind', 'copy-last-reply']));
  });

  it('asks about the session in an open session, through the Ask panel', () => {
    expect(ids(context())).not.toContain('ask-session');
    expect(ids(inSession())).toContain('ask-session');
    expect(ids(inSession({}, { connected: false }))).not.toContain('ask-session');
    const api = { sessionRequest: vi.fn() } as unknown as PaletteApi;
    const ctx = inSession();
    visibleCommands(ctx).find((c) => c.id === 'ask-session')!.run!(api, ctx);
    expect(api.sessionRequest).toHaveBeenCalledWith('ask');
  });

  it('stops Claude only while it runs here, and goes to what it waits for', () => {
    expect(ids(inSession({ running: true }))).not.toContain('stop');
    const running = inSession({ running: true, host: { state: 'running', contextTokens: 10, supportsEffort: true } });
    expect(ids(running)).toContain('stop');
    const asking = inSession({ waiting: 'question' });
    const go = visibleCommands(asking).find((c) => c.id === 'go-to-waiting')!;
    expect(titleOf(go, asking)).toBe('Go to the question');
    expect(titleOf(go, inSession({ waiting: 'permission' }))).toBe('Go to the permission');
    expect(ids(inSession())).not.toContain('go-to-waiting');
  });
});

describe('when(): git, actions, terminal, panes', () => {
  const git = { changed: 0, unstaged: 0, hasRemote: true, prBlocked: null, github: true, pr: null, pullable: false };

  it('offers git commands in a repository, the ones for changes only with changes', () => {
    expect(groupIds(inSession(), 'git')).toEqual([]);
    expect(groupIds(inSession({}, { git }), 'git')).toEqual(['create-pr', 'sync', 'switch-branch']);
    const dirty = groupIds(inSession({}, { git: { ...git, changed: 3, unstaged: 1 } }), 'git');
    expect(dirty).toEqual(expect.arrayContaining(['commit', 'stage-all', 'revert-all']));
    expect(groupIds(inSession({}, { git: { ...git, changed: 2, unstaged: 0 } }), 'git')).not.toContain('stage-all');
    expect(groupIds(inSession({}, { git: { ...git, hasRemote: false, prBlocked: 'No remote' } }), 'git')).toEqual(['switch-branch']);
  });

  it('creates a pull request only on GitHub, and views the open one instead', () => {
    expect(groupIds(inSession({}, { git: { ...git, github: false } }), 'git')).not.toContain('create-pr');
    const ctx = inSession({}, { git: { ...git, prBlocked: 'No commits ahead of main', pr: { number: 123, url: 'https://github.com/o/r/pull/123' } } });
    const command = COMMANDS.find((c) => c.id === 'create-pr')!;
    expect(command.when!(ctx)).toBe(true);
    expect(titleOf(command, ctx)).toBe('View pull request #123');
    const api = { openUrl: vi.fn(), sessionRequest: vi.fn() } as unknown as PaletteApi;
    command.run!(api, ctx);
    expect(api.openUrl).toHaveBeenCalledWith('https://github.com/o/r/pull/123');
    command.run!(api, inSession({}, { git }));
    expect(api.sessionRequest).toHaveBeenCalledWith('create-pr');
  });

  it('finishes a worktree instead of switching branch in one', () => {
    const worktree = groupIds(inSession({ isWorktree: true }, { git }), 'git');
    expect(worktree).toContain('finish-worktree');
    expect(worktree).not.toContain('switch-branch');
    expect(groupIds(inSession({ running: true }, { git }), 'git')).not.toContain('switch-branch');
  });

  it('runs each project action with its shortcut, and edits them when there is a project', () => {
    const ctx = inSession({}, { canEditActions: true, actions: [{ id: 'test', name: 'Test', shortcut: 'cmd+shift+t', icon: 'flask' }] });
    const run = visibleCommands(ctx).find((c) => c.id === 'action:test')!;
    expect(titleOf(run, ctx)).toBe('Run: Test');
    expect(run.shortcut).toBe('cmd+shift+t');
    expect(groupIds(ctx, 'actions')).toEqual(['edit-actions', 'new-action', 'action:test']);
    expect(groupIds(inSession({}, { canEditActions: true }), 'actions')).toEqual(['new-action']);
    expect(groupIds(context({ canEditActions: true, actions: [{ id: 'x', name: 'X', shortcut: null, icon: 'play' }] }), 'actions')).toEqual([]);
  });

  it('shows the terminal commands while it is open, and docks to the other side', () => {
    expect(groupIds(inSession(), 'terminal')).toEqual([]);
    const open = { owner: 's1', cwd: '/work/app', open: true, maximized: false, dock: 'bottom' as const, action: null };
    expect(groupIds(inSession({}, { terminal: open }), 'terminal')).toEqual(['hide-terminal', 'maximize-terminal', 'dock-right']);
    expect(groupIds(inSession({}, { terminal: { ...open, dock: 'right' } }), 'terminal')).toContain('dock-below');
    expect(groupIds(inSession({}, { terminal: { ...open, action: { running: true } } }), 'terminal')).toEqual(expect.arrayContaining(['stop-action', 'restart-action']));
    expect(groupIds(inSession({}, { terminal: { ...open, action: { running: false } } }), 'terminal')).not.toContain('stop-action');
  });

  it("offers the window's own terminal outside a session", () => {
    const home = context({ terminal: { ...context().terminal, owner: APP_TERMINAL } });
    expect(ids(home)).toEqual(expect.arrayContaining(['toggle-app-terminal', 'new-app-terminal-tab']));
    expect(ids(home)).not.toContain('toggle-terminal');
    expect(ids(inSession())).not.toContain('toggle-app-terminal');
    const open = context({ terminal: { ...home.terminal, open: true } });
    expect(groupIds(open, 'terminal')).toEqual(['hide-terminal', 'maximize-terminal', 'dock-right']);
  });

  it('offers the pane commands with more than one pane open', () => {
    expect(groupIds(inSession(), 'panes')).toEqual([]);
    expect(groupIds(inSession({}, { split: true, splitDirection: 'row' }), 'panes')).toEqual(['focus-other-pane', 'swap-panes', 'stack-panes', 'close-pane', 'close-other-panes']);
  });

  it('offers the other direction of the split the active pane is in, never the one it has', () => {
    expect(groupIds(inSession({}, { split: true, splitDirection: 'column' }), 'panes')).toEqual(['focus-other-pane', 'swap-panes', 'panes-side-by-side', 'close-pane', 'close-other-panes']);
    expect(ids(inSession({}, { splitDirection: 'column' }))).not.toContain('panes-side-by-side');
    expect(ids(context({ view: 'settings', split: true, splitDirection: 'row' }))).not.toContain('swap-panes');
  });

  it('offers to go only where the active pane has a neighbour', () => {
    const open = (paneWays: PaletteContext['paneWays']) => groupIds(inSession({}, { split: true, splitDirection: 'row', paneWays }), 'panes').filter((id) => id.startsWith('focus-pane-'));
    expect(open([])).toEqual([]);
    expect(open(['right'])).toEqual(['focus-pane-right']);
    expect(open(['left', 'right', 'up', 'down'])).toEqual(['focus-pane-left', 'focus-pane-right', 'focus-pane-up', 'focus-pane-down']);
  });
});

describe('when(): New session and Settings', () => {
  it('changes New session only when it can', () => {
    expect(groupIds(context({ view: 'new-session' }), 'new-session')).toEqual([]);
    const info = { canWorktree: true, canSaveDefaults: true, canQueue: true, canCatchUp: false };
    expect(groupIds(context({ view: 'new-session', newSession: info }), 'new-session')).toEqual(['toggle-worktree', 'save-defaults']);
    expect(groupIds(context({ view: 'new-session', newSession: { ...info, canCatchUp: true } }), 'new-session')).toContain('catch-up');
  });

  it('jumps to every other Settings page while Settings is open', () => {
    expect(groupIds(context(), 'settings')).toEqual([]);
    const pages = groupIds(context({ view: 'settings', settingsSection: 'theme' }), 'settings');
    expect(pages).toEqual(expect.arrayContaining(['settings-general', 'settings-sidebar', 'settings-profiles', 'settings-focus', 'settings-backup', 'settings-diagnostics']));
    expect(pages).not.toContain('settings-theme');
  });
});

describe('arrangeCommands', () => {
  it('puts where you are first, then recently used, then the rest', () => {
    const ctx = inSession({}, { git: { changed: 1, unstaged: 1, hasRemote: true, prBlocked: null, github: true, pr: null, pullable: false } });
    const sections = arrangeCommands(visibleCommands(ctx), ctx, ['theme-dark', 'rename-session', 'unknown'], '');
    expect(sections.map((s) => s.label)).toEqual(['This session', 'Git', 'Recently used', 'Commands']);
    // A recent command already shown for where you are isn't listed twice.
    expect(sections[2]!.items.map((i) => i.command.id)).toEqual(['theme-dark']);
    expect(sections[3]!.items.map((i) => i.command.id)).not.toContain('theme-dark');
  });

  it('lists recently used first on Home, newest first', () => {
    const sections = arrangeCommands(visibleCommands(context()), context(), ['search', 'add-project'], '');
    expect(sections[0]!.label).toBe('Recently used');
    expect(sections[0]!.items.map((i) => i.command.id)).toEqual(['search', 'add-project']);
  });

  it('ranks matches by title, highlights the letters, and finds keywords too', () => {
    const ctx = inSession({}, { git: GIT });
    const [matches] = arrangeCommands(visibleCommands(ctx), ctx, [], 'tog chan');
    expect(matches!.items[0]!.command.id).toBe('toggle-changes');
    expect(matches!.items[0]!.indices.length).toBeGreaterThan(0);
    const [byKeyword] = arrangeCommands(visibleCommands(ctx), ctx, [], 'uuid');
    expect(byKeyword!.items[0]!.command.id).toBe('copy-session-id');
    expect(byKeyword!.items[0]!.indices).toEqual([]);
    expect(arrangeCommands(visibleCommands(ctx), ctx, [], 'zzzz')).toEqual([]);
  });
});

describe('themes', () => {
  it('offers every theme but the one in use, and import and export', () => {
    const shown = visibleCommands(context());
    expect(shown.map((c) => c.id)).toEqual(expect.arrayContaining(['theme:solarized', 'import-theme', 'export-theme']));
    expect(shown.map((c) => c.id)).not.toContain('theme:demo-time');
    expect(titleOf(shown.find((c) => c.id === 'theme:solarized')!, context())).toBe('Theme: Solarized');
    expect(titleOf(shown.find((c) => c.id === 'theme-dark')!, context())).toBe('Appearance: Dark');
    const api = { selectTheme: vi.fn() } as unknown as PaletteApi;
    shown.find((c) => c.id === 'theme:solarized')!.run!(api, context());
    expect(api.selectTheme).toHaveBeenCalledWith('solarized');
  });
});

describe('rememberIn', () => {
  it('keeps the last five, newest first, without repeats', () => {
    let recent: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) recent = rememberIn(recent, id);
    expect(recent).toEqual(['c', 'f', 'e', 'd', 'b']);
  });
});

describe('sidebar and session navigation', () => {
  it('offers only the sidebar states that change something, and always the toggle', () => {
    const open = ids(context());
    expect(open).toEqual(expect.arrayContaining(['toggle-sidebar', 'sidebar-minimize', 'sidebar-close']));
    expect(open).not.toContain('sidebar-open');
    const minimal = ids(context({ sidebar: 'minimal' }));
    expect(minimal).toEqual(expect.arrayContaining(['toggle-sidebar', 'sidebar-open', 'sidebar-close']));
    expect(minimal).not.toContain('sidebar-minimize');
    expect(ids(context({ sidebar: 'closed' }))).not.toContain('sidebar-close');
  });

  it('puts ⌘B on Toggle sidebar and ⌘\\ on closing the other panes', () => {
    const byShortcut = (keys: string) => COMMANDS.filter((c) => c.shortcut && shortcutGlyphs(c.shortcut) === keys).map((c) => c.id);
    expect(byShortcut('⌘B')).toEqual(['toggle-sidebar']);
    expect(byShortcut('⌘\\')).toEqual(['close-other-panes']);
  });

  it('steps through sessions with their shortcuts', () => {
    const api = { goToSession: vi.fn(), goToNextNeedsYou: vi.fn(), setSidebar: vi.fn(), toggleSidebar: vi.fn() } as unknown as PaletteApi;
    const ctx = context();
    const byId = (id: string) => COMMANDS.find((c) => c.id === id)!;
    expect([byId('next-session').shortcut, byId('previous-session').shortcut, byId('next-needs-you').shortcut].map((k) => shortcutGlyphs(k!))).toEqual(['⌃⇥', '⌃⇧⇥', '⌘⇧U']);
    byId('next-session').run!(api, ctx);
    byId('previous-session').run!(api, ctx);
    byId('next-needs-you').run!(api, ctx);
    byId('sidebar-close').run!(api, ctx);
    expect(api.goToSession).toHaveBeenNthCalledWith(1, 1);
    expect(api.goToSession).toHaveBeenNthCalledWith(2, -1);
    expect(api.goToNextNeedsYou).toHaveBeenCalled();
    expect(api.setSidebar).toHaveBeenCalledWith('closed');
  });
});

describe('project pages and worktrees', () => {
  const app = { root: '/work/app', name: 'app' };
  const byId = (ctx: PaletteContext, id: string) => visibleCommands(ctx).find((c) => c.id === id);

  it('opens any project as "Project: <name>", but not the page already on screen', () => {
    const api = { openProject: vi.fn() } as unknown as PaletteApi;
    const ctx = context();
    expect(titleOf(byId(ctx, 'project:/work/site')!, ctx)).toBe('Project: site');
    byId(ctx, 'project:/work/site')!.run!(api, ctx);
    expect(api.openProject).toHaveBeenCalledWith('/work/site');
    expect(ids(context({ view: 'project', currentProject: app }))).not.toContain('project:/work/app');
  });

  it("opens the current project's worktrees, or asks which project", () => {
    const api = { openProject: vi.fn(), cleanUpWorktrees: vi.fn() } as unknown as PaletteApi;
    expect(ids(context())).toContain('worktrees');
    expect(ids(context())).not.toContain('worktrees-here');
    expect(ids(context())).not.toContain('clean-up-worktrees');
    expect(byId(context(), 'worktrees')!.next!(context())).toEqual({ kind: 'projects', purpose: 'worktrees', worktree: false, chip: 'Worktrees' });

    const ctx = context({ view: 'project', currentProject: app });
    expect(titleOf(byId(ctx, 'worktrees-here')!, ctx)).toBe('Worktrees in app');
    byId(ctx, 'worktrees-here')!.run!(api, ctx);
    expect(api.openProject).toHaveBeenCalledWith('/work/app', 'worktrees');
    expect(titleOf(byId(ctx, 'clean-up-worktrees')!, ctx)).toBe('Clean up worktrees in app…');
    byId(ctx, 'clean-up-worktrees')!.run!(api, ctx);
    expect(api.cleanUpWorktrees).toHaveBeenCalledWith('/work/app');
    // A folder that isn't one of your projects has no page.
    expect(ids(context({ currentProject: { root: '/tmp/x', name: 'x' } }))).not.toContain('clean-up-worktrees');
    expect(ids(context({ projects: [] }))).not.toContain('worktrees');
  });

  it("opens the current project's branches, or asks which project", () => {
    const api = { openProject: vi.fn() } as unknown as PaletteApi;
    expect(ids(context())).toContain('branches');
    expect(ids(context())).not.toContain('branches-here');
    expect(byId(context(), 'branches')!.next!(context())).toEqual({ kind: 'projects', purpose: 'branches', worktree: false, chip: 'Branches' });

    const ctx = context({ view: 'project', currentProject: app });
    expect(titleOf(byId(ctx, 'branches-here')!, ctx)).toBe('Branches in app');
    byId(ctx, 'branches-here')!.run!(api, ctx);
    expect(api.openProject).toHaveBeenCalledWith('/work/app', 'branches');
    expect(ids(context({ projects: [] }))).not.toContain('branches');
  });
});
