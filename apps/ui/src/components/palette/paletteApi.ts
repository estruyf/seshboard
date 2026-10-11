import { fileManagerName } from '../../lib/platform.ts';
import type { EngineClient } from '../../engine/connection.ts';
import { useBackup } from '../../state/backupStore.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { startQueued, useLater } from '../../state/laterStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { cleanUpWorktrees, openProject } from '../../state/projectPageStore.ts';
import { copyForClaudeApp, importFromClaudeExport, pasteFromClaudeApp } from '../memory/memoryDialogs.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { goToAdjacentSession, goToNextNeedsYou } from '../../state/sessionNav.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { openTerminal, restartTerminal, useTerminals } from '../../state/terminalsStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { useComposerTargets } from '../../state/composerTargets.ts';
import { toast } from '../../state/toastStore.ts';
import { lastLimit } from '../focus/focusLimit.ts';
import { syncStep } from '../git/gitPlan.ts';
import { manage } from '../sidebar/ProjectMenu.tsx';
import { archiveSessions } from '../drafts/ArchiveDraftDialog.tsx';
import { openUnsentList } from '../drafts/UnsentList.tsx';
import { basename } from '../../lib/format.ts';
import type { PaletteApi } from './commands.ts';
import type { PaletteContext } from './paletteContext.ts';

/** Says why a command didn't work: the palette has closed by then, so it can't say it itself. */
const failed = (what: string) => (error: unknown) => toast(`Couldn't ${what}: ${error instanceof Error ? error.message : String(error)}`);

/** Shows a terminal tab the engine just opened for the session. */
function showTerminal(sessionId: string, terminalId: string) {
  useTerminals.getState().togglePanel(sessionId, true);
  useTerminals.getState().setActive(sessionId, terminalId);
}

/**
 * The palette's commands, carried out against the stores and the engine. Commands only run when their
 * `when()` holds, so the session (and its folder) are there when a session command needs them.
 * `openIn` is `useOpenIn()`'s opener (⌘O's default editor).
 */
export function createPaletteApi(ctx: PaletteContext, client: EngineClient | null, openIn: (path: string) => Promise<void>): PaletteApi {
  const session = ctx.session;
  const sessionId = session?.id ?? '';
  const cwd = session?.cwd ?? null;
  const call = <T>(what: string, run: (client: EngineClient) => Promise<T>) => {
    if (client) void run(client).catch(failed(what));
  };
  const activeTerminal = () => {
    const { terminals, active } = useTerminals.getState();
    return terminals.get(active.get(sessionId) ?? '') ?? [...terminals.values()].filter((t) => t.sessionId === sessionId).at(-1);
  };

  return {
    goHome: () => useSessions.getState().goHome(),
    showSearch: () => useOverlay.getState().show('search'),
    showMemorySearch: () => useOverlay.getState().searchMemory(),
    showShortcuts: () => useOverlay.getState().show('shortcuts'),
    showUnsent: () => openUnsentList(),
    openSettings: (section) => useSessions.getState().openSettings(section),
    setPreferences: (patch) => usePreferences.getState().update(patch),
    setSidebar: (state) => useSidebar.getState().setState(state),
    toggleSidebar: () => useSidebar.getState().toggle(),
    goToSession: (direction) => goToAdjacentSession(direction),
    goToNextNeedsYou: () => goToNextNeedsYou(),
    manageProjects: () => manage(),
    openProject: (root, tab) => openProject(root, tab),
    cleanUpWorktrees: (root) => cleanUpWorktrees(root),
    memoryTransfer: (kind) => (kind === 'import-export' ? void importFromClaudeExport() : kind === 'paste' ? pasteFromClaudeApp() : copyForClaudeApp()),
    addProject: () => useProjects.getState().showAdd(true),
    checkClaudeUpdate: () => {
      useSessions.getState().openSettings('about');
      useClaudeUpdate.getState().check();
    },
    reloadSkills: () => call('reload skills', (c) => c.call('skills.reload', {})),
    backup: (kind) => useBackup.getState().show(kind),
    selectTheme: (id) => useThemes.getState().select(id, { announce: true }),
    importTheme: () => void useThemes.getState().chooseImport(),
    exportTheme: () => {
      const { active, exportTheme } = useThemes.getState();
      void exportTheme(active.entry.id).then((path) => path && toast(`Exported ${active.entry.file.name} to ${basename(path)}`), failed('export the theme'));
    },
    setFocusLimit: (on) => usePreferences.getState().update({ focusLimit: on ? lastLimit() : null }),

    renameSession: () => session && usePaletteBus.getState().showDialog({ kind: 'rename-session', sessionId, title: session.title }),
    setFlags: (change) => {
      const apply = () => call('change the session', (c) => c.call('sessions.setFlags', { sessionId, ...change }));
      // Archiving a session with an unsent message asks first.
      if (change.archived && session) archiveSessions([{ id: sessionId, title: session.title }], apply);
      else apply();
    },
    // Finishing work: the focus limit never stands in the way of compacting.
    compact: () => call('compact the context', (c) => c.call('session.send', { sessionId, text: '/compact', attachments: [], fork: false })),
    copyLastReply: () => {
      const reply = usePaletteBus.getState().digest?.lastReply;
      if (reply) void navigator.clipboard.writeText(reply).catch(failed('copy the reply'));
    },
    rememberThis: () => {
      // What you selected in the conversation, else Claude's last reply.
      const selection = window.getSelection();
      const node = selection && selection.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
      const source = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-remember-from]');
      const selected = source ? selection!.toString().trim() : '';
      const text = selected || usePaletteBus.getState().digest?.lastReply || '';
      if (!text) return;
      usePaletteBus.getState().showDialog({ kind: 'remember', text, from: selected && source?.dataset.rememberFrom === 'user' ? 'user' : 'claude', sessionId, root: session?.projectRoot ?? null });
    },
    copySessionId: () => void navigator.clipboard.writeText(sessionId).catch(failed('copy the session id')),
    checkTranscript: () => usePaletteBus.getState().showDialog({ kind: 'transcript-diagnosis', sessionId, title: session?.title ?? null }),
    toggleTerminal: () => useTerminals.getState().togglePanel(sessionId),
    newTerminalTab: () => cwd && call('open a terminal', (c) => openTerminal(c, sessionId, cwd, 'shell')),
    toggleChanges: () => useOverlay.getState().toggleChanges(),
    // After the palette's own close, so the Tools dialog isn't closed along with it.
    showTools: () => setTimeout(() => useOverlay.getState().show('tools')),
    openInEditor: () => cwd && void openIn(cwd).catch(failed('open the folder')),
    addContext: () => {
      // After the palette's own close, so the picker isn't closed along with it.
      if (ctx.composer) setTimeout(() => useComposerTargets.getState().openPicker(ctx.composer!));
    },
    continueInVSCode: () => call('continue in VS Code', (c) => c.call('session.continueInEditor', { sessionId, editorId: 'vscode' })),
    revealInFinder: () =>
      cwd &&
      call(`show the folder in ${fileManagerName()}`, async (c) => {
        const known = useHosts.getState().editors;
        const editors = known.length ? known : (await c.call('editors.list', {})).editors;
        const finder = editors.find((editor) => editor.kind === 'finder');
        if (!finder) throw new Error(`${fileManagerName()} is not available`);
        await c.call('editors.open', { path: cwd, editorId: finder.id });
      }),
    closeSession: () => {
      const { splitId, activePane, closePane, closeSession } = useSessions.getState();
      // With two panes, close this one (as its ×); otherwise go Home.
      if (splitId) closePane(activePane);
      else closeSession();
    },
    deleteSession: () => session && usePaletteBus.getState().showDialog({ kind: 'delete-session', sessionId, title: session.title }),
    stop: () => call('stop Claude', (c) => c.call('session.interrupt', { sessionId })),
    goToWaiting: () => {
      // After the palette has closed and handed focus back, or that would take it again.
      setTimeout(() => {
        const card = document.querySelector<HTMLElement>(`[data-current-session="${CSS.escape(sessionId)}"] [data-permission-request]`);
        if (!card) return;
        card.scrollIntoView({ block: 'nearest' });
        card.querySelector<HTMLElement>('[data-permission-allow], [data-question-option], button')?.focus();
      }, 50);
    },
    sessionRequest: (kind) => usePaletteBus.getState().requestSession(kind),
    createPullRequest: () =>
      cwd && call('create the pull request', async (c) => showTerminal(sessionId, (await c.call('git.sync', { sessionId, cwd, action: 'pr' })).terminalId)),
    syncWithRemote: () =>
      cwd &&
      call('sync with the remote', async (c) => {
        const status = await c.call('worktree.status', { cwd });
        const { terminalId } = await c.call('git.sync', { sessionId, cwd, action: syncStep(status, session?.running ?? false) });
        showTerminal(sessionId, terminalId);
      }),
    stageAll: () =>
      cwd &&
      call('stage the files', async (c) => {
        const { files } = await c.call('git.changes', { cwd, base: 'uncommitted' });
        const paths = files.filter((file) => !file.staged).map((file) => file.path);
        if (paths.length) await c.call('git.stage', { cwd, paths, staged: true });
        // The checkout changed under the session view: its Changes panel and git button read it again.
        useCheckoutBranches.getState().switched();
      }),
    revertAll: () =>
      cwd &&
      call('read the changes', async (c) => {
        const { files } = await c.call('git.changes', { cwd, base: 'uncommitted' });
        if (files.length) usePaletteBus.getState().showDialog({ kind: 'revert-all', cwd, paths: files.map((file) => file.path) });
      }),
    runAction: (id) => useOverlay.getState().requestAction(id),
    hideTerminal: () => useTerminals.getState().togglePanel(sessionId, false),
    toggleMaximizeTerminal: () => useTerminals.getState().setMaximized(sessionId),
    dockTerminal: (dock) => {
      useTerminals.getState().setDock(dock);
      useTerminals.getState().setMaximized(sessionId, false);
    },
    stopAction: () => {
      const terminal = activeTerminal();
      if (terminal) call('stop the action', (c) => c.call('terminal.stop', { id: terminal.id }));
    },
    restartAction: () => {
      const terminal = activeTerminal();
      if (terminal) call('restart the action', (c) => restartTerminal(c, terminal));
    },
    focusOtherPane: () => {
      const { activePane, focusPane } = useSessions.getState();
      focusPane(activePane === 'main' ? 'split' : 'main');
    },
    closePane: () => {
      const { activePane, closePane } = useSessions.getState();
      closePane(activePane);
    },
    newSessionRequest: (kind) => usePaletteBus.getState().requestNewSession(kind),
    openNewSession: () => useSessions.getState().openNewSession(),
    startQueued: (id) => {
      const item = useLater.getState().items.find((i) => i.id === id);
      if (item) void startQueued(item);
    },
  };
}
