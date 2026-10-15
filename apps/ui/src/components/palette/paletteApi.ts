import { fileManagerName } from '../../lib/platform.ts';
import type { EngineClient } from '../../engine/connection.ts';
import { useBackup } from '../../state/backupStore.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { startQueued, useLater } from '../../state/laterStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { isAskOpen } from '../../state/askStore.ts';
import { isAgentsOpen, toggleAgentsPanel } from '../../state/agentsPanelStore.ts';
import { toggleChangesPanel } from '../../state/rightPanelStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { cleanUpWorktrees, openProject } from '../../state/projectPageStore.ts';
import { copyForClaudeApp, importFromClaudeExport, pasteFromClaudeApp } from '../memory/memoryDialogs.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { goToAdjacentSession, goToNextNeedsYou } from '../../state/sessionNav.ts';
import { openSessionManager } from '../../state/sessionManagerStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openUsage } from '../../state/usageViewStore.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { openTerminal, restartTerminal, useTerminals } from '../../state/terminalsStore.ts';
import { ownerSession } from '../terminal/appTerminal.ts';
import { useThemes } from '../../state/themeStore.ts';
import { useWhy } from '../../state/whyStore.ts';
import { useComposerTargets } from '../../state/composerTargets.ts';
import { useDrafts } from '../../state/draftsStore.ts';
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

/** The text selected in a message of the conversation (empty when there is none), and whose message it is. */
function conversationSelection(): { selected: string; from: 'user' | 'claude' } {
  const selection = window.getSelection();
  const node = selection && selection.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
  const source = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-remember-from]');
  return { selected: source ? selection!.toString().trim() : '', from: source?.dataset.rememberFrom === 'user' ? 'user' : 'claude' };
}

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
  // ⌘J's panel: the session's, or outside a session the window's own. Terminal commands only run while there is one.
  const owner = ctx.terminal.owner ?? '';
  const activeTerminal = () => {
    const { terminals, active } = useTerminals.getState();
    return terminals.get(active.get(owner) ?? '') ?? [...terminals.values()].filter((t) => t.sessionId === ownerSession(owner)).at(-1);
  };

  return {
    goHome: () => useSessions.getState().goHome(),
    openUsage: () => openUsage(),
    showSearch: () => useOverlay.getState().show('search'),
    showMemorySearch: () => useOverlay.getState().searchMemory(),
    showShortcuts: () => useOverlay.getState().show('shortcuts'),
    showUnsent: () => openUnsentList(),
    openSettings: (section) => useSessions.getState().openSettings(section),
    manageSessions: (options) => openSessionManager(options),
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
    showCatchUp: () => {
      const card = useCatchUp.getState().cards.get(sessionId);
      if (card) useCatchUp.getState().setCollapsed(card, false);
    },
    showWhy: () => {
      const request = [...useHosts.getState().permissions.values()].filter((p) => p.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (request && useWhy.getState().open?.requestId !== request.requestId) useWhy.getState().toggle(sessionId, request.requestId);
    },
    buildCatchUp: () =>
      call('catch up on this session', async (c) => {
        const { catchUp } = await c.call('catchup.build', { sessionId });
        useCatchUp.getState().set(sessionId, catchUp);
        useCatchUp.getState().setCollapsed(catchUp, false);
      }),
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
      const { selected, from } = conversationSelection();
      const text = selected || usePaletteBus.getState().digest?.lastReply || '';
      if (!text) return;
      usePaletteBus.getState().showDialog({ kind: 'remember', text, from: selected ? from : 'claude', sessionId, root: session?.projectRoot ?? null });
    },
    quoteInReply: () => {
      const text = conversationSelection().selected || usePaletteBus.getState().digest?.lastReply || '';
      // After the palette's own close, which gives focus back to where it was.
      if (text) setTimeout(() => useDrafts.getState().requestQuote(sessionId, text));
    },
    copySessionId: () => void navigator.clipboard.writeText(sessionId).catch(failed('copy the session id')),
    checkTranscript: () => usePaletteBus.getState().showDialog({ kind: 'transcript-diagnosis', sessionId, title: session?.title ?? null }),
    toggleTerminal: () => owner && useTerminals.getState().togglePanel(owner),
    newTerminalTab: () => owner && call('open a terminal', (c) => openTerminal(c, owner, ctx.terminal.cwd, 'shell')),
    toggleChanges: () => toggleChangesPanel(isAskOpen(useSessions.getState().selectedId) || isAgentsOpen(useSessions.getState().selectedId)),
    toggleAgents: () => {
      const id = useSessions.getState().selectedId;
      if (id) toggleAgentsPanel(id, useOverlay.getState().changesOpen || isAskOpen(id));
    },
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
      const { paneIds, closePane, closeSession } = useSessions.getState();
      // With several panes, close this one (as its ×); otherwise go Home.
      if (paneIds.length > 1) closePane();
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
    openUrl: (url) => void window.open(url, '_blank'),
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
    hideTerminal: () => useTerminals.getState().togglePanel(owner, false),
    toggleMaximizeTerminal: () => useTerminals.getState().setMaximized(owner),
    dockTerminal: (dock) => {
      useTerminals.getState().setDock(dock);
      useTerminals.getState().setMaximized(owner, false);
    },
    stopAction: () => {
      const terminal = activeTerminal();
      if (terminal) call('stop the action', (c) => c.call('terminal.stop', { id: terminal.id }));
    },
    restartAction: () => {
      const terminal = activeTerminal();
      if (terminal) call('restart the action', (c) => restartTerminal(c, terminal));
    },
    focusNextPane: () => useSessions.getState().focusNext(),
    focusPane: (way) => useSessions.getState().focusWay(way),
    swapPanes: () => useSessions.getState().swapPanes(),
    flipSplit: () => useSessions.getState().flipSplit(),
    closePane: () => useSessions.getState().closePane(),
    closeOtherPanes: () => useSessions.getState().closeOtherPanes(),
    newSessionRequest: (kind) => usePaletteBus.getState().requestNewSession(kind),
    openNewSession: () => useSessions.getState().openNewSession(),
    startQueued: (id) => {
      const item = useLater.getState().items.find((i) => i.id === id);
      if (item) void startQueued(item);
    },
  };
}
