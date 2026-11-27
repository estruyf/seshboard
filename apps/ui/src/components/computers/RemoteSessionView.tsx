import { RemoteOrchestratorCrumb, RemoteOrchestratorOverview } from '../orchestrator/OrchestratorOverview.tsx';
import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, BookOpen, ChevronDown, ChevronRight, Ellipsis, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react';
import { agentName, apiRetryLine, localPreviewUrl, triggerOriginOf, type Computer, type Contract, type PermissionDecision, type PermissionMode, type RemotePermissionMode, type QueuedMessage, type RemoteLimitStanding, type RemoteMessage, type RemotePrompt, type RemoteSession, type RpcClient, type SendMode, type SlashCommand } from '@seshboard/protocol/client';
import { MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { ariaKeysFor, ariaShortcut, formatKeys, keysFor, matches, shortcutGlyphs } from '../../lib/shortcuts.ts';
import { clearRemoteDraft, loadRemoteDraft, remoteSessionDraftKey, saveRemoteDraft } from '../../state/remoteDrafts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { askThrough, closeAsk, newAskThread, openAskThrough, pickAskThread, retryAskThrough, useAsk, useSessionAsk, type AskBackend } from '../../state/askStore.ts';
import { useRightPanel, useRightTab, useSidePanelFull } from '../../state/rightPanelStore.ts';
import { panelWidthFor, rightPanel } from '../ask/askWidth.ts';
import { ToolRail, useRailItems, type RailButton, type RailItem } from '../transcript/ToolRail.tsx';
import { railEntries, railLabel, railStep, railToolState, type RailAvailable, type RailToolId } from '../transcript/toolRail.ts';
import { RAIL_ICONS } from '../transcript/railIcons.tsx';
import { PanelLauncher } from '../transcript/PanelLauncher.tsx';
import { launcherEntries, launcherPick, launcherShown } from '../transcript/panelLauncher.ts';
import { closePanelLauncher, openPanelLauncher, usePanelLauncher } from '../../state/panelLauncherStore.ts';
import { toggleWebPanel, useSessionWeb, useTabCount, useWebPreview } from '../../state/webPreviewStore.ts';
import { useBrowserPopouts } from '../../state/popoutsStore.ts';
import { useLayout } from '../../state/layoutStore.ts';
import { WebPreviewPanel } from '../webPreview/WebPreviewPanel.tsx';
import type { ServerOffer } from '../webPreview/serverOffers.ts';
import { openLinkInBrowser } from '../transcript/openLinkInBrowser.ts';
import { useStableCallback } from '../../lib/useStableCallback.ts';
import { AskPanel } from '../ask/AskPanel.tsx';
import { CatchUpPassBar, CatchUpSlot } from '../catchUp/CatchUp.tsx';
import { catchUpShow } from '../catchUp/catchUpModel.ts';
import { turnKey, useCatchUp } from '../../state/catchUpStore.ts';
import { RemoteChangesPanel, type RemoteChanges } from './RemoteChangesPanel.tsx';
import { RemoteRunCard } from './RemoteRunCard.tsx';
import { useComputers } from '../../state/computersStore.ts';
import { pipelineMeta, REMOTE_FEATURE_COMMANDS, REMOTE_FEATURE_FILES, REMOTE_FEATURE_PIPELINES, REMOTE_FEATURE_SEND_ATTACHMENTS_ONLY, runIsActive, runOfParent, runOfStep, type RemotePipeline, type RemoteRunState } from '@seshboard/protocol/client';
import { useRemoteCatchUpActions } from './useRemoteCatchUpActions.tsx';
import type { CatchUp } from '@seshboard/protocol/client';
import { useReadMode } from '../../state/readModeStore.ts';
import { remoteRowId } from '../../state/remoteSelection.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { onlyThereLine, remoteProfileColor, remoteRowStatus } from '../../state/remoteRows.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { statusLine } from '../../state/sidebarOrder.ts';
import { toast } from '../../state/toastStore.ts';
import { useTaskStrip } from '../../state/taskStripStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { OVERLAY_SELECTOR } from '../session/permissionKeys.ts';
import { ClampedPrompt } from '../transcript/ClampedPrompt.tsx';
import { WorkingPanel } from '../ui/WorkingPanel.tsx';
import { BackgroundTaskList } from '../transcript/BackgroundTaskList.tsx';
import { useReceivedRetry } from '../../lib/receivedRetry.ts';
import { useSecondClock } from '../../lib/secondClock.ts';
import { backgroundSummary } from '../transcript/backgroundTasks.ts';
import { DropOverlay } from '../composer/Attachments.tsx';
import { PromptFiller } from '../savedPrompts/PromptFiller.tsx';
import { SavedPromptMenu, useRemoteSavedPrompts } from './useRemoteSavedPrompts.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { RemoteLimitNotice } from './RemoteLimitNotice.tsx';
import { RemoteUpNext } from './RemoteUpNext.tsx';
import { QueueButton } from '../composer/QueueButton.tsx';
import { EscapeStopHint } from '../composer/EscapeStopHint.tsx';
import { useEscapeStop } from '../composer/useEscapeStop.ts';
import { queueButtonState, sendKeyMode } from '../composer/queueButton.ts';
import { Pill } from '../ui/Pill.tsx';
import { callComputer, onComputerEvent } from './callComputer.ts';
import { ComputerChip } from './ComputerChip.tsx';
import { computerTint } from './computerColor.ts';
import { ComputerPrompt } from './ComputerPrompt.tsx';
import { applyStream, applyUpdate, awayBanner, inBackground, NOT_STREAMING, prependMessages, remoteDisplay, remoteItems, toolsSummary, type RemoteTool, type Streaming } from './computerSessions.ts';
import { RemoteAttachButton, RemoteAttachmentList, useRemoteAttachments } from './RemoteAttachments.tsx';
import { useRemoteOptions } from './RemoteChips.tsx';
import { remoteModelChoice, remoteModelLabel, remoteTakesEffort } from './remoteNewSession.ts';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';
import { ComposerTray } from '../composer/ComposerTray.tsx';
import { ReadOnlyNotice } from '../providers/ReadOnlyNotice.tsx';
import { RemoteText } from './RemoteText.tsx';
import { useCleanCopy } from '../transcript/useCleanCopy.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { RemoteSessionCost } from '../usage/SessionCost.tsx';
import { useWidth } from '../ui/useWidth.ts';
import { useScrollEdge } from '../ui/useScrollEdge.ts';
import { PANE_HEADER } from '../ui/paneHeader.ts';
import { sentLine } from '../transcript/turnFormat.ts';
import { LiveTurnParts, TurnMetaContext, TurnMetaLine, type LiveTurnInfo, type TurnMetaValue } from '../transcript/TurnMeta.tsx';
import { MessageToolbar, REVEAL_IN_REPLY_ROW } from '../transcript/messageActions.tsx';
import { readableTurns, readReply } from '../transcript/readReply.ts';
import { ReadMode } from '../readMode/ReadMode.tsx';
import { RemoteFileContext, type RemoteFileSession } from '../filePreview/remotePreview.ts';
import { useRememberLayer } from '../memory/RememberLayer.tsx';
import { appendQuote, applyEdit, editKey } from '../composer/editing.ts';
import { RemoteToolList } from './RemoteToolList.tsx';
import { useRemoteFind } from './useRemoteFind.ts';
import { FindBar } from '../transcript/FindBar.tsx';
import { remoteSessionEntries, respondRemote } from './remoteActions.ts';
import { paneHandle, paneHeader, remoteLine, type PaneProps } from './ComputerView.tsx';
import { PaneClose } from '../split/PaneClose.tsx';
import { RemoteTriggerOriginBar } from '../triggers/TriggerOriginBar.tsx';

const PAGE = 100;
/** Test hooks of the tray's chips: `data-remote-model-select`, `data-menu="remote-model"`. */
const REMOTE_CHIP_NAMES = { profile: 'remote-profile', model: 'remote-model', effort: 'remote-effort', mode: 'remote-mode' };
const NO_RUNS: RemoteRunState[] = [];
/** A remote session's servers run on that computer: its browser has none to offer here. */
const NO_OFFERS: readonly ServerOffer[] = [];

const DOT_TONE = { warn: 'bg-warn', accent: 'bg-accent-ink animate-pulse', unread: 'bg-unread', ok: 'bg-ok', error: 'bg-error', faint: 'bg-faint' } as const;
const TEXT_TONE = { warn: 'text-warn', accent: 'text-accent-ink', unread: 'text-unread', ok: 'text-ok', error: 'text-error', faint: 'text-muted' } as const;

/** Ticks once a second while `active`, so "Trying again in 30s" counts down. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * A session on another computer, in the same view as a local one (docs/remote-access.md, Other computers): the local
 * header with the computer's chip and a 2px `remote` line along its top, the conversation in the same column, what it
 * waits on docked above the message box, Stop, and what it runs in the background with a Stop for each task. As in a
 * local session: the catch-up, Changes and Commit, Ask, reading mode, Quote, Find (⌘F), Jump to latest and a pipeline
 * run's card, all acting on that computer. The rail of tools at its right edge has Changes, Ask and the browser, which
 * runs here: a web link in the conversation opens in it. What needs the folder (Files, the terminal, the editor) is left
 * off the rail, and the ⋯ menu says why. The transcript is `RemoteText`: nothing else in it acts here. While the computer
 * is away the last messages stay, under a banner, and the message box is off. It is a pane like a local session
 * (`pane`): dragged by its title, beside local ones and other remote ones.
 */
export function RemoteSessionView({ client, computer, session, prompts, pane }: { client: RpcClient<Contract>; computer: Computer; session: RemoteSession; prompts: RemotePrompt[]; pane: PaneProps }) {
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [streaming, setStreaming] = useState<Streaming>(NOT_STREAMING);
  /** Its Up next and how it stands with its usage limit, kept up to date by the watch below. */
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [limit, setLimit] = useState<RemoteLimitStanding | null>(null);
  /** The catch-up of its last turn, as that computer writes it. */
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useCleanCopy(scroller);
  // The header's hairline shows only while the conversation scrolls under it.
  const edge = useScrollEdge(scroller);
  const atBottom = useRef(true);
  /** Scrolled up far enough to show Jump to latest. */
  const [scrolledUp, setScrolledUp] = useState(false);
  const connected = computer.state === 'connected';
  const id = computer.id;
  const name = computer.name;
  const status = remoteRowStatus(session, prompts.length > 0);
  const working = session.status === 'working';
  /** Its turn ended but a task it started still runs: still at work, and Stop is per task (the pill above the message box). */
  const background = inBackground(session);
  const tasks = session.background ?? [];
  const now = useNow(computer.state === 'offline');
  // Claude Code retries a failed API call there: say so, counting down from when this window heard of it.
  const retry = useReceivedRetry(working ? session.apiRetry : null);
  const retryNow = useSecondClock(retry !== null && connected);
  const away = awayBanner(computer, now);
  const line = statusLine(status) ?? { text: 'Idle', tone: 'faint' as const };
  const rowId = remoteRowId({ computerId: id, sessionId: session.id });
  const handle = paneHandle(pane);

  useEffect(() => {
    if (!connected) return;
    let current = true;
    setError(null);
    setStreaming(NOT_STREAMING);
    setQueue([]);
    setLimit(null);
    setCatchUp(null);
    const offs = [
      onComputerEvent(client, id, 'transcript.updated', (update) => update.sessionId === session.id && setMessages((m) => applyUpdate(m, update))),
      onComputerEvent(client, id, 'upNext.changed', (event) => event.sessionId === session.id && setQueue(event.queue)),
      onComputerEvent(client, id, 'limits.changed', (event) => event.sessionId === session.id && setLimit(event.limit)),
      onComputerEvent(client, id, 'session.stream', (delta) => delta.sessionId === session.id && setStreaming((s) => applyStream(s, delta))),
      onComputerEvent(client, id, 'catchup.changed', (event) => event.sessionId === session.id && setCatchUp(event.catchUp)),
      // Ask's answers, into the panel keyed by this row.
      onComputerEvent(client, id, 'session.ask', (event) => event.sessionId === session.id && useAsk.getState().receive({ ...event, sessionId: rowId })),
    ];
    void callComputer(client, id, 'transcript.get', { sessionId: session.id, limit: PAGE }).then(
      (page) => {
        if (!current) return;
        atBottom.current = true;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setLoaded(true);
      },
      (e: Error) => current && setError(e.message),
    );
    void callComputer(client, id, 'catchup.get', { sessionId: session.id }).then((r) => current && setCatchUp(r.catchUp), () => {});
    void callComputer(client, id, 'transcript.watch', { sessionId: session.id }).catch(() => {});
    void callComputer(client, id, 'session.markRead', { sessionId: session.id }).catch(() => {});
    return () => {
      current = false;
      offs.forEach((off) => off());
      void callComputer(client, id, 'transcript.unwatch', { sessionId: session.id }).catch(() => {});
    };
  }, [client, id, session.id, rowId, connected]);

  // New messages keep the end in view, unless you scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, prompts.length]);

  const loadEarlier = () => {
    const first = messages[0];
    if (!first) return;
    void callComputer(client, id, 'transcript.get', { sessionId: session.id, before: first.uuid, limit: PAGE }).then((page) => {
      atBottom.current = false;
      setMessages((m) => prependMessages(m, page.messages));
      setHasMore(page.hasMore);
    });
  };

  const respond = (prompt: RemotePrompt, decision: PermissionDecision): Promise<boolean> => respondRemote(client, id, prompt, decision);

  const stop = () => void callComputer(client, id, 'session.interrupt', { sessionId: session.id }).catch((e: Error) => toast(e.message));
  const stopTask = async (taskId: string) => {
    try {
      await callComputer(client, id, 'session.stopTask', { sessionId: session.id, taskId });
    } catch (e) {
      toast(`Could not stop the task: ${(e as Error).message}`);
      throw e;
    }
  };
  const tasksId = useId();
  const tasksOpen = useTaskStrip((s) => s.open.get(rowId) === 'background') && tasks.length > 0;

  // Pipelines: the run this session started, or the one it is a step of, and the pipelines its project can run there.
  const runs = useComputers((s) => s.lists.get(id)?.runs ?? NO_RUNS);
  const ownRun = runOfParent(runs, session.id);
  const stepOf = runOfStep(runs, session.id);
  const runState = ownRun ?? stepOf?.state ?? null;
  const runNow = useNow(!!runState && runIsActive(runState));
  const takesPipelines = computer.features.includes(REMOTE_FEATURE_PIPELINES);
  // Paths in the conversation preview the file through that computer, which gives only files the session made.
  const readsFiles = computer.features.includes(REMOTE_FEATURE_FILES);
  const fileSession = useMemo<RemoteFileSession | null>(() => (readsFiles ? { computerId: id, sessionId: session.id } : null), [readsFiles, id, session.id]);
  const [pipelines, setPipelines] = useState<RemotePipeline[]>([]);
  useEffect(() => {
    if (!connected || !takesPipelines) return;
    let live = true;
    void callComputer(client, id, 'pipelines.list', { projectId: session.projectId }).then(
      (r) => live && setPipelines(r.pipelines),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, id, session.projectId, connected, takesPipelines]);
  const runPipeline = (pipeline: RemotePipeline) =>
    void callComputer(client, id, 'pipelines.run', { pipelineId: pipeline.id, parentSessionId: session.id, images: [], files: [] }).then(
      () => toast(`Started ${pipeline.name}`, { body: `On ${name}. Its steps show under this session.` }),
      (e: Error) => toast(e.message, { body: `It didn’t start on ${name}.` }),
    );
  // A step of a run starts no other run, and neither does a session whose run goes on.
  const pipelineEntries: MenuEntry[] =
    takesPipelines && !stepOf
      ? [
          {
            label: 'Run a pipeline',
            disabled: !connected || pipelines.length === 0 || (ownRun !== null && runIsActive(ownRun)),
            submenu: pipelines.map((pipeline): MenuEntry => ({ label: pipeline.name, detail: pipelineMeta(pipeline), onSelect: () => runPipeline(pipeline), data: { 'data-remote-run-pipeline': pipeline.id } })),
            data: { 'data-remote-pipelines-menu': true },
          },
        ]
      : [];

  const openMenu = (at: { x: number; y: number }) =>
    setMenu({
      ...at,
      entries: [
        // Done takes the run's tree with it, as from the sidebar.
        ...remoteSessionEntries(client, computer, { ...session, treeRunId: ownRun?.run.id ?? null }, { open: false }),
        ...pipelineEntries,
        { label: 'Copy last reply', disabled: !lastReply, onSelect: () => void navigator.clipboard.writeText(lastReply ?? '').then(() => toast('Copied the last reply'), () => toast("Couldn't copy")), data: { 'data-remote-copy-last-reply': true } },
        'separator',
        { label: 'Open folder in editor', disabled: true, onSelect: () => {} },
        { label: 'Create pull request…', disabled: true, onSelect: () => {} },
        { note: onlyThereLine('Files', name) },
      ],
    });

  const items = useMemo(() => remoteItems(messages), [messages]);
  /** Claude's last reply, for Copy last reply in the ⋯ menu. */
  const lastReply = items.findLast((item) => item.kind === 'text')?.text ?? null;
  // Each finished turn's time, duration and tokens under its last reply, from the messages (the computer's usage),
  // and the open turn's clock on the working line. Reading mode takes its reply from the same display items.
  const display = useMemo(() => remoteDisplay(messages), [messages]);
  const turns = display.turns;
  // Reading mode, as for a session here (`TranscriptView`), keyed by the row's id: a portal from here over the window.
  const reading = useReadMode((s) => (s.open?.sessionId === rowId ? s.open : null));
  const readingReply = useMemo(() => {
    if (!reading) return null;
    const key = reading.turnKey === 'last' ? readableTurns(display.items, turns).at(-1)?.key : reading.turnKey;
    return key ? readReply(display.items, turns, key) : null;
  }, [reading, display.items, turns]);
  useEffect(() => {
    if (!reading) return;
    // Nothing to read (yet), or the reply went: leave rather than sit invisible over the app.
    if (!readingReply) useReadMode.getState().close();
    else if (reading.turnKey === 'last') useReadMode.getState().resolve(readingReply.turnKey);
  }, [reading, readingReply]);
  // Leaving goes back to the Read button of the reply the reader was at, scrolled into view if they moved to another.
  const readingBefore = useRef<{ turnKey: string; openedFrom: string } | null>(null);
  if (reading) readingBefore.current = reading;
  useEffect(() => {
    if (reading) return;
    const left = readingBefore.current;
    readingBefore.current = null;
    if (!left || useReadMode.getState().leaveTo === 'elsewhere' || useSessions.getState().selectedId !== rowId) return;
    requestAnimationFrame(() => {
      const button = scroller.current?.querySelector<HTMLElement>(`[data-remote-read][data-turn-key="${CSS.escape(left.turnKey)}"]`);
      if (button && left.openedFrom && left.turnKey !== left.openedFrom) button.scrollIntoView({ block: 'end' });
      button?.focus({ preventScroll: true });
    });
  }, [reading]);
  // Quote from a selection or a whole message (right-click, or the buttons over a selection) into this message box.
  // There is no Remember this: the memories of that session's project are on that computer.
  const draftKey = remoteSessionDraftKey(id, session.id);
  // Ask about this session: Claude answers on that computer, from the conversation and the project, read-only.
  const ask = useSessionAsk(rowId);
  const askBackend = useMemo<AskBackend>(
    () => ({
      ask: (params) => callComputer(client, id, 'session.ask', { sessionId: session.id, ...params }),
      threads: () => callComputer(client, id, 'session.askThreads', { sessionId: session.id }),
    }),
    [client, id, session.id],
  );
  // Changes: what is not committed in its checkout there, read when the panel opens, when a turn ends and on Refresh.
  const [changesOpen, setChangesOpen] = useState(false);
  const [changes, setChanges] = useState<RemoteChanges | null>(null);
  const changesRead = useRef(0);
  const refreshChanges = () => {
    if (!connected) return;
    const read = ++changesRead.current;
    void callComputer(client, id, 'changes.get', { sessionId: session.id }).then(
      (result) => read === changesRead.current && setChanges(result),
      (e: Error) => read === changesRead.current && setChanges({ branch: null, files: [], error: e.message }),
    );
  };
  useEffect(() => {
    setChanges(null);
    if (changesOpen) refreshChanges();
  }, [changesOpen, session.id, connected]);
  useEffect(() => {
    if (changesOpen && !working) refreshChanges();
  }, [working]);
  // Opened, Changes comes to the front of the side panel; Ask or the browser stay open behind it.
  const showChanges = (open: boolean) => {
    setChangesOpen(open);
    if (open) useRightPanel.getState().setTab(rowId, 'changes');
  };

  // The side panel and the rail of tools, as in a session here, with what works from this computer: Changes and Ask,
  // read and done there, and the browser, which runs here (its tabs are kept under the row's id). The rest (Files,
  // the terminal, Agents, Commands, the apps) needs the folder, which is on that computer, so the rail leaves it out.
  const browserOn = usePreferences((s) => s.prefs.browserEnabled);
  const web = useSessionWeb(rowId);
  const browserAway = useBrowserPopouts((s) => s.tabs.has(rowId));
  const rightTab = useRightTab(rowId);
  const right = rightPanel({ changes: changesOpen, ask: ask.open, web: web !== null, files: false, agents: false, commands: false, note: false, terminal: false }, rightTab);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyWidth = useWidth(bodyRef);
  const sizing = useRightPanel((s) => s.sizing);
  const rightWidth = useRightPanel((s) => s.width);
  const setRightWidth = useRightPanel((s) => s.setWidth);
  // Half: the panel takes half the session area as the window resizes; Side: the width you dragged.
  const panelWidth = panelWidthFor(sizing, rightWidth, bodyWidth);
  // The side panel with nothing in it (the title bar's Tools panel, or a new session with Settings asking for it).
  const launcherRequested = usePanelLauncher((s) => s.open.has(rowId));
  const launcherQuiet = usePanelLauncher((s) => s.quiet.has(rowId));
  const showLauncher = launcherShown(launcherRequested, right.open.length, false);
  // Once a tool opens on the side, the empty panel is done: closing that tool closes the side.
  useEffect(() => {
    if (launcherRequested && right.open.length > 0) closePanelLauncher(rowId);
  }, [launcherRequested, right.open.length, rowId]);
  const sharedFull = useSidePanelFull(rowId);
  const setSharedFull = useCallback((full: boolean) => useRightPanel.getState().setFull(rowId, full), [rowId]);
  // At Full a panel takes the whole session area: the conversation stays mounted, hidden.
  const conversationHidden = (sharedFull && (showLauncher || right.tab === 'ask')) || (right.tab === 'web' && browserOn && web?.full === true);
  const othersOpen = (tool: RailToolId) => right.open.some((tab) => tab !== tool);
  // A click on the rail (or its shortcut): a closed tool opens in front, one behind comes to the front, the one in front closes.
  const toggleChangesHere = () => showChanges(railStep(railToolState('changes', right.open, right.tab), othersOpen('changes')) !== 'close');
  const toggleAskHere = () => {
    if (railStep(railToolState('ask', right.open, right.tab), othersOpen('ask')) === 'close') closeAsk(rowId);
    else void openAskThrough(connected ? askBackend : null, rowId);
  };
  const toggleWebHere = () => toggleWebPanel(rowId, othersOpen('web'));
  const webTabs = useTabCount(rowId);
  const railCounts = { changes: changesOpen ? (changes?.files.length ?? 0) : 0, web: browserOn ? webTabs : 0 };
  const railOrder = usePreferences((s) => s.prefs.railOrder);
  const railHidden = usePreferences((s) => s.prefs.railHidden);
  const railAvailable: RailAvailable = {
    files: false,
    changes: true,
    terminal: false,
    web: browserOn || web !== null || browserAway,
    ask: true,
    agents: false,
    commands: false,
    note: false,
    mods: [],
    apps: [],
  };
  const railName = (tool: RailToolId) => (tool === 'web' && browserAway ? 'Browser (own window)' : undefined);
  const railTool = (tool: RailToolId): RailButton => {
    const shortcut = tool === 'changes' ? 'changes.toggle' : tool === 'web' ? 'web.toggle' : null;
    const ready = tool === 'ask' && ask.ready && !ask.open;
    const name = railName(tool);
    return {
      id: tool,
      icon: RAIL_ICONS[tool as keyof typeof RAIL_ICONS],
      label: `${railLabel(tool, railCounts, { name })}${ready ? ' · An answer is ready' : ''}`,
      ariaLabel: `${railLabel(tool, railCounts, { name, separator: ', ' })}${ready ? ', an answer is ready' : ''}`,
      kbd: shortcut ? formatKeys(keysFor(shortcut)) : undefined,
      count: railCounts[tool as keyof typeof railCounts],
      dot: ready,
      state: railToolState(tool, right.open, right.tab),
      // `data-remote-changes`: the hook the Changes button had in the header.
      data: { [`data-toggle-${tool}`]: true, ...(tool === 'changes' ? { 'data-remote-changes': true } : {}), ...(tool === 'web' && browserAway ? { 'data-browser-away': true } : {}) },
      onClick: () => (tool === 'changes' ? toggleChangesHere() : tool === 'ask' ? toggleAskHere() : toggleWebHere()),
    };
  };
  const railItems = useRailItems(railEntries(railAvailable, railHidden, railOrder).map((entry): RailItem => (entry.kind === 'tool' ? railTool(entry.id) : 'divider')));
  const launcherRows = showLauncher
    ? launcherEntries(railAvailable, railOrder).map((entry) => {
        if (entry.kind === 'divider') return 'divider' as const;
        const item = railTool(entry.id);
        return { id: entry.id, icon: item.icon, name: railLabel(entry.id, {}, { name: railName(entry.id) }), kbd: item.kbd };
      })
    : [];
  const pickFromLauncher = (tool: RailToolId) => {
    closePanelLauncher(rowId);
    if (launcherPick(railToolState(tool, right.open, right.tab))) railTool(tool).onClick();
  };
  // The title bar's Tools panel button works on the active pane's side panel: Hide panel while it shows something.
  const sideShows = right.open.length > 0 || showLauncher;
  const onPanelButton = useStableCallback(() => {
    if (!sideShows) return openPanelLauncher(rowId);
    closePanelLauncher(rowId);
    useRightPanel.getState().setFull(rowId, false);
    setChangesOpen(false);
    if (ask.open) closeAsk(rowId);
    if (web) useWebPreview.getState().hide(rowId);
  });
  useEffect(() => {
    if (pane.active) useLayout.setState({ toolsPanel: { shows: sideShows, toggle: onPanelButton } });
  }, [pane.active, sideShows, onPanelButton]);
  useEffect(() => {
    if (!pane.active) return;
    // Another pane may have taken it over in the same render: only clear what is still this pane's.
    return () => {
      if (useLayout.getState().toolsPanel?.toggle === onPanelButton) useLayout.setState({ toolsPanel: null });
    };
  }, [pane.active, onPanelButton]);
  // A web link in the conversation opens in this session's browser, here. A localhost link is on that computer, so
  // the page won't load here (or shows this computer's own server): a toast says so.
  const openLink = (event: ReactMouseEvent<HTMLElement>) => {
    const href = (event.target as HTMLElement).closest('a[href]')?.getAttribute('href') ?? '';
    const local = event.button === 0 && localPreviewUrl(href) !== null;
    if (browserOn) openLinkInBrowser(event, rowId);
    if (local) toast(`This page is on ${name}`, { body: 'localhost there isn’t reachable from this computer, so the page won’t load here.' });
  };
  // The rail's shortcuts: ⌘⇧D for Changes, ⌘⇧B for the browser, while this pane is the active one.
  const onViewKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!pane.active || useSessions.getState().view !== 'session' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
    if (matches(event, 'changes.toggle')) {
      event.preventDefault();
      toggleChangesHere();
    } else if (matches(event, 'web.toggle') && railAvailable.web) {
      event.preventDefault();
      toggleWebHere();
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onViewKey);
    return () => window.removeEventListener('keydown', onViewKey);
  }, []);
  // The catch-up over the conversation, as for a session here; its buttons act there.
  const collapsed = useCatchUp((s) => (catchUp ? (s.collapsed.get(turnKey(catchUp)) ?? null) : null));
  const catchUpEnabled = usePreferences((s) => s.prefs.catchUpSummaries);
  const catchUpFolded = usePreferences((s) => s.prefs.catchUpFolded);
  const show = catchUpShow(catchUp, { enabled: catchUpEnabled, folded: catchUpFolded, unread: session.unread, working, waiting: prompts.length > 0, collapsed });
  const catchUpActions = useRemoteCatchUpActions({
    card: catchUp,
    client,
    computer,
    draftKey,
    changes,
    changesOpen,
    onChanges: showChanges,
    onCommitted: refreshChanges,
  });
  const find = useRemoteFind(scroller, { active: pane.active, content: messages, resetKey: rowId });
  const remember = useRememberLayer({
    container: scroller,
    textOf: (key) => {
      const item = items.find((i) => i.key === key);
      return item && (item.kind === 'user' || item.kind === 'text') ? item.text : null;
    },
    onQuote: (text) => useDrafts.getState().requestQuote(draftKey, text),
  });
  const turnDetails = usePreferences((s) => s.prefs.turnDetails);
  const width = useWidth(scroller);
  const openTurn = working ? (turns.at(-1) ?? null) : null;
  const turnMeta = useMemo<TurnMetaValue>(
    () => ({ byReply: new Map(turns.filter((t) => t !== openTurn && t.replyKey).map((t) => [t.replyKey!, t])), mode: turnDetails, width }),
    [turns, openTurn, turnDetails, width],
  );
  const waitingSince = prompts.length ? Math.min(...prompts.map((p) => p.createdAt)) : null;
  const live = useMemo<LiveTurnInfo>(() => ({ turn: openTurn, waitingSince, mode: turnDetails }), [openTurn, waitingSince, turnDetails]);

  return (
    <RemoteFileContext.Provider value={fileSession}>
      <div className="flex h-full min-h-0" style={computerTint(computer.color)} data-current-session={rowId} data-remote-session={session.id} data-remote-computer={id} data-drop-zone>
      {/* `@container`: the header compacts itself when the pane is narrow. The rail of tools sits beside it, as in a session here. */}
      <div className="@container flex min-w-0 flex-1 flex-col">
        <header className={`${PANE_HEADER} ${remoteLine(pane)}`} data-scrolled={!edge.atTop || undefined} data-remote-header {...paneHeader(pane)}>
          <span className="flex shrink-0 @max-[400px]:hidden">
            <ProjectIcon project={undefined} root={session.projectId} name={session.projectName} size={22} remote />
          </span>
          {/* With several panes this is the handle to drag the pane by (useTileDrag). */}
          <div className={`min-w-24 flex-1 @max-[400px]:min-w-16 ${handle.className}`} data-pane-handle={handle['data-pane-handle']}>
            <h1 className="truncate text-body leading-snug font-semibold" data-tooltip={session.title}>
              {session.title}
            </h1>
            <div className="flex min-w-0 items-center gap-1.5 text-meta text-muted" data-session-meta>
              {/* A session its orchestrator there started: the way back to it. */}
              <RemoteOrchestratorCrumb computerId={id} sessionId={session.id} />
              <span className={`flex shrink-0 items-center gap-1.5 ${TEXT_TONE[line.tone]}`} data-session-status>
                <span className={`inline-block size-2 shrink-0 rounded-full ${DOT_TONE[line.tone]}`} aria-hidden />
                <span className="@max-[860px]:sr-only">{line.text}</span>
              </span>
              <Sep />
              <span className="min-w-0 shrink truncate @max-[860px]:hidden">{session.projectName}</span>
              {session.branch && (
                <>
                  <Sep />
                  <span className="flex min-w-0 items-center gap-1">
                    <GitBranch size={11} className="shrink-0" aria-hidden />
                    <span className="truncate">{session.branch}</span>
                  </span>
                </>
              )}
            </div>
          </div>
          <ComputerChip name={name} size="header" offline={!connected} className="no-drag @max-[420px]:hidden" data-remote-chip data-tooltip={`Claude runs on ${name}. You follow it from here.`}>
            on {name}
          </ComputerChip>
          <Button
            variant="quiet"
            iconOnly
            icon={<Ellipsis size={15} aria-hidden />}
            aria-label="More"
            aria-haspopup="menu"
            className="no-drag shrink-0"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu({ x: rect.right - 240, y: rect.bottom + 4 });
            }}
            data-remote-more
          />
          <PaneClose id={pane.id} tiled={pane.tiled} closeTooltip={`Close session and go Home (it keeps running on ${name})`} />
        </header>
        {/* A trigger there started it: which, and the link to the CI run or the issue. */}
        <RemoteTriggerOriginBar origin={triggerOriginOf(session.trigger)} />

        {/* The conversation and the message box, with the side panel (Changes, Browser, Ask) on the right. */}
        <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div className={`min-w-0 flex-1 flex-col ${conversationHidden ? 'hidden' : 'flex'}`}>
        {/* The conversation, with Find over its top right corner. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
        {!(catchUp && show) && <CatchUpPassBar rowId={rowId} active={pane.active} />}
        {catchUp && show && <CatchUpSlot card={catchUp} show={show} cwd={null} changes={null} active={pane.active} changesOpen={changesOpen} remote={{ actions: catchUpActions, rowId }} />}
        {/* An orchestrator there: its sessions, by what needs you first. */}
        <RemoteOrchestratorOverview computerId={id} sessionId={session.id} />
        {find.query !== null && <FindBar query={find.query} onQuery={find.setQuery} count={find.count} current={find.current} onStep={find.step} onClose={find.close} focusNonce={find.focusNonce} />}
        <div
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            setScrolledUp(!atBottom.current);
            remember.handlers.onScroll();
          }}
          onContextMenu={remember.handlers.onContextMenu}
          onClick={openLink}
          role="region"
          aria-label="Conversation"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          data-transcript
        >
          <TurnMetaContext.Provider value={turnMeta}>
          <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-3 px-6 pt-3 pb-6">
            {error && <Notice tone="error">{error}</Notice>}
            {!loaded && !error && (
              <p className="p-8 text-center text-ui text-muted" role="status">
                {connected ? 'Loading the conversation…' : `The conversation loads once ${name} is back.`}
              </p>
            )}
            {hasMore && (
              <Button variant="quiet" size="sm" className="justify-self-center" onClick={loadEarlier}>
                Show earlier messages
              </Button>
            )}
            {items.map((item) =>
              item.kind === 'user' ? (
                <div key={item.key} className="flex justify-end">
                  <div className="group/message relative max-w-[80%] min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5" data-prompt-bubble data-remember-from="user" data-message-key={item.key} data-tooltip={item.at !== null ? sentLine(item.at, item.device) : undefined}>
                    <ClampedPrompt itemKey={item.key} className="text-body whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
                      {item.text}
                    </ClampedPrompt>
                    {item.device && <p className="mt-1 text-meta text-faint">from {item.device}</p>}
                    <MessageToolbar itemKey={item.key} kind="user" text={item.text} copyOnly />
                  </div>
                </div>
              ) : item.kind === 'notice' ? (
                <p key={item.key} className="text-center text-meta whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">
                  {item.text}
                </p>
              ) : item.kind === 'text' ? (
                <div key={item.key} className="group/message relative text-body">
                  {/* The text only, so a right-click on the row of actions under it is not a right-click on the message. */}
                  <div data-remember-from="claude" data-message-key={item.key}>
                    <RemoteText text={item.text} />
                  </div>
                  {/* As on this computer: the actions, then the turn's line under a turn's last reply, shown on hover or focus. */}
                  <div className="group/reply-row -ml-1 mt-1 flex h-6 min-w-0 items-center gap-2">
                    <MessageToolbar itemKey={item.key} kind="text" text={item.text} copyOnly />
                    {turnMeta.byReply.has(item.key) && (
                      <Button
                        variant="quiet"
                        size="sm"
                        icon={<BookOpen size={13} />}
                        aria-keyshortcuts={ariaKeysFor('read.toggle')}
                        data-tooltip={`Read this reply (${shortcutGlyphs(keysFor('read.toggle'))})`}
                        className={`h-6 shrink-0 ${REVEAL_IN_REPLY_ROW}`}
                        onClick={() => useReadMode.getState().openReply(rowId, turnMeta.byReply.get(item.key)!.key)}
                        data-remote-read
                        data-turn-key={turnMeta.byReply.get(item.key)!.key}
                      >
                        Read
                      </Button>
                    )}
                    <TurnMetaLine itemKey={item.key} className={REVEAL_IN_REPLY_ROW} />
                  </div>
                </div>
              ) : (
                <ToolRun key={item.key} tools={item.tools} />
              ),
            )}
            {streaming.kind === 'text' && streaming.text && (
              <div className="text-body">
                <RemoteText text={streaming.text} />
              </div>
            )}
            {working && connected && (
              <p className="flex h-6.5 items-center gap-2 text-ui text-text/85" role="status" data-computer-working>
                <span className="flex w-4 shrink-0 justify-center">
                  <WorkingPanel state={prompts.length ? 'waiting' : 'working'} />
                </span>
                <span className="min-w-0 truncate">{prompts.length ? 'Waiting for you' : retry ? apiRetryLine(retry, retryNow) : streaming.kind === 'tool' ? `Using ${streaming.text}…` : streaming.kind === 'thinking' ? 'Thinking…' : 'Working…'}</span>
                <LiveTurnParts live={live} startedAt={null} />
              </p>
            )}
            {!working && background && connected && (
              <p className="flex h-6.5 items-center gap-2 text-ui text-ok" role="status" data-computer-background>
                <span className="flex w-4 shrink-0 justify-center" aria-hidden>
                  <LoaderCircle size={13} className="animate-[spin_2s_linear_infinite]" />
                </span>
                <span className="min-w-0 truncate">{tasks.length ? `${backgroundSummary(tasks.map((t) => t.type))} running` : 'Running in the background'}</span>
              </p>
            )}
          </div>
          {/* Sticks to the bottom of the view while you read further up; takes no room at the end. */}
          {scrolledUp && (
            <div className="pointer-events-none sticky bottom-3 z-10 h-0">
              <div className="absolute inset-x-0 bottom-0 flex justify-center">
                <span className="overlay pointer-events-auto rounded-md">
                  <Button
                    variant="quiet"
                    size="sm"
                    icon={<ArrowDown size={13} aria-hidden />}
                    onClick={() => {
                      const el = scroller.current;
                      if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
                    }}
                    data-jump-to-latest
                  >
                    {working ? 'New output below' : 'Jump to latest'}
                  </Button>
                </span>
              </div>
            </div>
          )}
          {/* Room for the fade over the composer, so the Working line and a reply's end aren't under it. */}
          <div className="composer-fade-room" aria-hidden />
          </TurnMetaContext.Provider>
        </div>
        </div>
        {remember.overlay}
        {readingReply && createPortal(<ReadMode sessionId={rowId} title={session.title} live={null} cwd={null} reply={readingReply} remote={{ draftKey, ask: connected ? askBackend : null }} />, document.body)}

        <div className="relative mx-auto grid w-full max-w-4xl shrink-0 grid-cols-[minmax(0,1fr)] gap-2 px-6 pb-3 @max-[860px]:px-4" data-composer-area>
          <div className="composer-fade absolute inset-x-0 bottom-full" aria-hidden data-composer-fade />
          {away && (
            <Notice
              tone="caution"
              data-remote-away={computer.state}
              actions={
                computer.state === 'offline' ? (
                  <Button size="sm" icon={<RefreshCw size={12} aria-hidden />} onClick={() => void client.call('computers.retry', { id })}>
                    Try again
                  </Button>
                ) : computer.state === 'unpaired' ? (
                  <Button size="sm" onClick={() => useSessions.getState().openSettings('remote')}>
                    Pair again
                  </Button>
                ) : undefined
              }
            >
              {away}
            </Notice>
          )}
          {connected && tasks.length > 0 && (
            <div className="grid gap-1.5">
              <Pill
                tone="ok"
                shrink
                selected={tasksOpen}
                className="justify-self-end"
                icon={<LoaderCircle size={11} className="shrink-0 animate-[spin_2s_linear_infinite]" aria-hidden />}
                onClick={() => useTaskStrip.getState().toggle(rowId, 'background')}
                aria-expanded={tasksOpen}
                aria-controls={tasksOpen ? tasksId : undefined}
                data-tooltip={tasksOpen ? 'Hide what runs in the background' : `Show what runs in the background on ${name}`}
                data-status-background
              >
                <span className="truncate">{backgroundSummary(tasks.map((t) => t.type))}</span>
                <ChevronDown size={11} className={`shrink-0 transition-transform ${tasksOpen ? 'rotate-180' : ''}`} aria-hidden />
              </Pill>
              {tasksOpen && <BackgroundTaskList id={tasksId} tasks={tasks} onStop={stopTask} />}
            </div>
          )}
          {runState && <RemoteRunCard client={client} computer={computer} state={runState} now={runNow} />}
          {connected && prompts.length > 0 && (
            <div className="-m-1 grid max-h-[55vh] gap-2 overflow-y-auto p-1" data-permissions>
              {prompts.map((prompt) => (
                <ComputerPrompt key={prompt.requestId} prompt={prompt} respond={(decision) => respond(prompt, decision)} agent={agentName(session.provider)} />
              ))}
            </div>
          )}
          {connected && <RemoteLimitNotice client={client} computer={computer} sessionId={session.id} limit={limit} held={queue.length} busy={working || prompts.length > 0} />}
          {connected && <RemoteUpNext client={client} computer={computer} sessionId={session.id} queue={queue} limited={limit?.stopped === true} />}
          {session.readOnly ? (
            // Its provider can't continue it there (a read-only provider): that computer's command to continue it in its CLI.
            <ReadOnlyNotice provider={session.provider ?? null} sessionId={session.id} command={session.readOnly.resumeCommand} />
          ) : (
            <RemoteComposer client={client} computer={computer} session={session} working={working} onSent={() => (atBottom.current = true)} onStop={stop} />
          )}
        </div>
        </div>
        {showLauncher && <PanelLauncher rows={launcherRows} width={panelWidth} onWidth={setRightWidth} full={sharedFull} onFull={setSharedFull} quiet={launcherQuiet} onPick={pickFromLauncher} onClose={() => closePanelLauncher(rowId)} />}
        {right.tab === 'changes' && (
          <RemoteChangesPanel
            client={client}
            computer={computer}
            sessionId={session.id}
            changes={changes}
            onRefresh={refreshChanges}
            onCommitted={() => {
              refreshChanges();
              if (catchUp) useCatchUp.getState().markCommitted(catchUp);
              toast(`Committed on ${name}`);
            }}
            onClose={() => showChanges(false)}
            width={panelWidth}
            onWidth={setRightWidth}
          />
        )}
        {right.tab === 'ask' && (
          <AskPanel
            sessionId={rowId}
            state={ask}
            working={working}
            width={panelWidth}
            onWidth={setRightWidth}
            full={sharedFull}
            onFull={setSharedFull}
            onAsk={(question) => askThrough(askBackend, rowId, question)}
            onRetry={(threadId, item) => void retryAskThrough(askBackend, rowId, threadId, item.id, item.question).catch((e: Error) => toast(`Could not ask: ${e.message}`))}
            onQuote={(answer) => useDrafts.getState().requestQuote(draftKey, answer)}
            onNewThread={() => newAskThread(rowId)}
            onPickThread={(threadId) => pickAskThread(rowId, threadId)}
            onClose={() => closeAsk(rowId)}
            disabledReason={connected ? null : `${name} is not connected`}
          />
        )}
        {/* Its pages run on this computer (webPreviewPages.ts), kept under the row's id, so they stay while another tab is in front. */}
        {right.tab === 'web' && web && <WebPreviewPanel sessionId={rowId} web={web} offers={NO_OFFERS} width={panelWidth} onWidth={setRightWidth} />}
        </div>
        {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} width={240} label={`Session “${session.title}”`} onClose={() => setMenu(null)} />}
      </div>
      <ToolRail items={railItems} />
      </div>
    </RemoteFileContext.Provider>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-faint">
      ·
    </span>
  );
}

/** A run of tool calls as one line, like `ActivityGroup`: "Read 4 files · Edited ContentOverview.tsx +42 −6". A click shows each call. */
function ToolRun({ tools }: { tools: RemoteTool[] }) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  const failures = tools.filter((tool) => tool.failed).length;
  return (
    <div data-activity="done" data-remote-tools={tools.length}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? stepsId : undefined}
        className="group flex h-6.5 w-full min-w-0 items-center gap-2 text-left text-ui"
        data-tooltip={open ? 'Hide steps' : 'Show each step'}
      >
        <span className="flex w-4 shrink-0 justify-center" aria-hidden>
          <ChevronRight size={13} className={`text-faint transition ${open ? 'rotate-90' : ''}`} />
        </span>
        <span className="min-w-0 truncate text-muted group-hover:text-text">{toolsSummary(tools)}</span>
        {failures > 0 && <span className="shrink-0 text-meta text-error">· {failures} failed</span>}
      </button>
      {open && <RemoteToolList id={stepsId} tools={tools} className="mt-0.5 ml-6 pb-1" />}
    </div>
  );
}

/**
 * The message box, as a local session's (the box, and the tray under it): on the tray, the computer's chip and the
 * session's profile (it keeps it, as a local one does) before the model, effort and mode chips, which change them there
 * while it runs in Seshboard; a computer too old for `options.get` shows them as text. The cost, as that computer
 * counts it, is on the right. Stop while Claude works, and a `remote` frame. Images and files go with the message
 * (`RemoteAttachments.tsx`): files only to a computer whose Seshboard takes them.
 */
function RemoteComposer({ client, computer, session, working, onSent, onStop }: { client: RpcClient<Contract>; computer: Computer; session: RemoteSession; working: boolean; onSent(): void; onStop(): void }) {
  const localProfiles = useProfiles((s) => s.profiles);
  // What you typed stays with the session when you go elsewhere and come back, also after a restart, until it is sent.
  const draftKey = remoteSessionDraftKey(computer.id, session.id);
  const [saved] = useState(() => loadRemoteDraft(draftKey));
  const [draft, setDraft] = useState(saved.text);
  const [sending, setSending] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const connected = computer.state === 'connected';
  // The session's skills and commands there, for the / menu. Asked again when a turn ends: a skill may have come or gone.
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const listsCommands = connected && computer.features.includes(REMOTE_FEATURE_COMMANDS);
  useEffect(() => {
    if (!listsCommands || working) return;
    // A slower, older answer must not replace the list of the session on screen; a failure keeps the last list.
    let cancelled = false;
    callComputer(client, computer.id, 'session.commands', { sessionId: session.id }).then(
      (r) => !cancelled && setCommands(r.commands),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, computer.id, session.id, listsCommands, working]);
  const savedPrompts = useRemoteSavedPrompts({ key: draftKey, draft, setDraft, areaRef, initialFill: saved.fill, disabled: !connected, commands });
  const { fill: fillState, setFill, fillerRef, menu, setMenu, updateMenu, choose, clearFill } = savedPrompts;
  useEffect(() => saveRemoteDraft(draftKey, { text: draft, ...(fillState ? { fill: fillState } : {}) }), [draftKey, draft, fillState]);
  const name = computer.name;
  // Reply on the catch-up puts the caret here.
  const focusRequest = useDrafts((s) => (s.focus?.key === draftKey ? s.focus.nonce : null));
  useEffect(() => {
    if (focusRequest === null) return;
    useDrafts.getState().clearFocus();
    areaRef.current?.focus();
  }, [focusRequest]);
  // Quote from the conversation or reading mode: at the end, as if typed (so ⌘Z takes it out), with the caret under it.
  const quote = useDrafts((s) => (s.quote?.key === draftKey ? s.quote : null));
  useEffect(() => {
    if (!quote) return;
    useDrafts.getState().clearQuote();
    const el = areaRef.current;
    const edit = appendQuote(el?.value ?? draft, quote.text);
    if (!edit) return;
    if (!el || el.disabled) return setDraft((current) => current + edit.insert);
    el.focus();
    applyEdit(el, edit, setDraft);
    el.scrollTop = el.scrollHeight;
    // The frame lights up once, so you see where the quote went.
    const card = cardRef.current;
    if (card) {
      card.classList.remove('composer-flash');
      void card.offsetWidth;
      card.classList.add('composer-flash');
    }
  }, [quote]);
  const attachments = useRemoteAttachments({ computer, rootRef: root, disabledReason: connected ? null : `${name} is not connected` });
  const options = useRemoteOptions(client, computer);
  // Only a session that runs in Seshboard there has a mode, and only then can its model, effort and mode change.
  const running = session.permissionMode != null;
  const fail = (e: Error) => toast(e.message, { body: `It didn’t change on ${name}.` });
  // Images or files alone are a message too, as for a local session, where that computer takes them without text.
  const attachedOnly = computer.features.includes(REMOTE_FEATURE_SEND_ATTACHMENTS_ONLY) && attachments.items.length > 0;
  const hasMessage = !!draft.trim() || !!fillState || attachedOnly;
  // While Claude works there, Enter queues or steers (Settings › Conversation, this computer's), as for a local session.
  const whileWorking = usePreferences((p) => p.prefs.whileWorking);
  const otherMode: SendMode = whileWorking === 'queue' ? 'steer' : 'queue';
  // Esc stops Claude there, by default only when pressed twice (Settings › Conversation).
  const escapeStop = useEscapeStop(working && connected, onStop);
  const send = (mode: SendMode = whileWorking) => {
    const sentFill = fillState;
    const text = savedPrompts.message();
    if (text === null) return;
    if ((!text && !attachedOnly) || sending || attachments.reading || !connected) return;
    setSending(true);
    onSent();
    const { images, files } = attachments;
    void callComputer(client, computer.id, 'session.send', { sessionId: session.id, text, mode, images, ...(files.length ? { files } : {}) })
      .then(
        () => {
          // Also when you went to another session while it was sending.
          // A queued message needs no toast: it shows in Up next, right above the box (#372).
          clearRemoteDraft(draftKey);
          setDraft('');
          savedPrompts.sent(sentFill);
          attachments.clear();
        },
        (e: Error) => toast(e.message),
      )
      .finally(() => setSending(false));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (savedPrompts.onMenuKey(event)) return;
    if (editKey(event, setDraft)) return;
    const mode = event.nativeEvent.isComposing ? null : sendKeyMode(event.nativeEvent, working, whileWorking);
    if (mode) {
      event.preventDefault();
      send(mode);
    } else if (working && matches(event.nativeEvent, 'claude.stop') && !document.querySelector(OVERLAY_SELECTOR)) {
      event.preventDefault();
      escapeStop.press();
    }
  };
  const sendNow = formatKeys(keysFor('composer.send-now'));
  const placeholder = !connected
    ? `${name} is not connected`
    : working
      ? whileWorking === 'queue'
        ? `Message Claude on ${name}. It waits in Up next, or ${sendNow} sends it now.`
        : `Message Claude on ${name}. Claude reads it at its next step, or ${sendNow} sends it now.`
      : `Message Claude on ${name}`;
  const blocked = !connected ? `${name} is not connected` : attachments.reading ? 'Reading the attachments' : null;
  // Where it runs and whose login, before the chips: neither changes for a running session.
  const lead = (
    <>
      <ComputerChip name={name} size="header" offline={!connected} data-tooltip={`Claude runs on ${name}, with its Claude profile.`} />
      {session.profile && (
        <span className="flex shrink-0 items-center gap-1.5 px-1.5 text-ui text-muted" data-tooltip={`Claude profile: ${session.profile.name}. A running session keeps its profile.`} data-remote-session-profile={session.profile.id}>
          <span className={`size-2 rounded-full ${PROFILE_DOT[remoteProfileColor(session.profile, localProfiles)]}`} aria-hidden />
          {session.profile.name}
        </span>
      )}
    </>
  );
  const model = options ? remoteModelChoice(options.models, session) : null;
  const controls =
    running && options && model ? (
      <ComposerChipRow
        lead={lead}
        profile={null}
        model={{ ...model, onChange: (value) => void callComputer(client, computer.id, 'session.setModel', { sessionId: session.id, model: value || null }).catch(fail) }}
        effort={
          // Only from a Seshboard that sends the effort, and for a model that takes one.
          session.effort !== undefined && options.efforts.length > 0 && remoteTakesEffort(options.models, session.model)
            ? { value: session.effort ?? '', levels: options.efforts, onChange: (effort) => void callComputer(client, computer.id, 'session.setEffort', { sessionId: session.id, effort: effort || null }).catch(fail) }
            : null
        }
        mode={{
          value: session.permissionMode!,
          // Bypass shows when that computer set it, but only it can pick it.
          onChange: (mode) => {
            if ((options.modes as PermissionMode[]).includes(mode)) void callComputer(client, computer.id, 'session.setPermissionMode', { sessionId: session.id, mode: mode as RemotePermissionMode }).catch(fail);
          },
        }}
        disabled={!connected}
        names={REMOTE_CHIP_NAMES}
      />
    ) : (
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {lead}
        {session.model && (
          <span className="truncate px-1.5 text-ui text-muted" data-tooltip={`Model: ${session.model}`} data-remote-model>
            {options ? remoteModelLabel(options.models, session.model) : session.model}
          </span>
        )}
        {session.permissionMode && (
          <span className="flex shrink-0 items-center gap-1.5 px-1.5 text-ui text-muted" data-tooltip={`Mode: ${MODE_LABEL[session.permissionMode]}`} data-remote-mode>
            <span className={`size-2 rounded-full ${MODE_DOT[session.permissionMode] ?? 'bg-faint'}`} aria-hidden />
            {MODE_LABEL[session.permissionMode]}
          </span>
        )}
      </div>
    );
  return (
    <div ref={root} className="@container/box relative" data-remote-composer>
      <DropOverlay drop={attachments.drop} />
      {menu && <SavedPromptMenu menu={menu} onChoose={choose} projectName={name} />}
      <div
        ref={cardRef}
        onAnimationEnd={(e) => e.animationName === 'composer-flash' && e.currentTarget.classList.remove('composer-flash')}
        className={`relative z-[1] rounded-[18px] border bg-card px-3 pt-3 pb-2 shadow-md transition-colors ${connected ? 'border-remote/45 focus-within:border-remote/80' : 'border-border'}`}
        data-composer-card
      >
        {fillState && (
          <>
            <PromptFiller ref={fillerRef} state={fillState} onChange={setFill} projectName={name} root={null} cwd={null} disabled={!connected} onClear={clearFill} onSend={() => send()} onLeave={() => areaRef.current?.focus()} />
            <div aria-hidden className="my-2 border-t border-dashed border-edge" />
          </>
        )}
        <RemoteAttachmentList state={attachments} className="mb-2" />
        <textarea
          ref={areaRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            updateMenu(event.target.value, event.target.selectionStart);
          }}
          onBlur={() => setTimeout(() => setMenu(null), 100)}
          onKeyDown={onKeyDown}
          onPaste={attachments.onPaste}
          rows={1}
          disabled={!connected}
          placeholder={fillState ? 'Add more context… (optional, sent after the prompt)' : placeholder}
          aria-label={`Message Claude on ${name}`}
          aria-keyshortcuts={working ? ariaShortcut('escape') : undefined}
          className="block field-sizing-content max-h-[10lh] min-h-[3lh] w-full min-w-0 resize-none bg-transparent px-1 text-body leading-relaxed text-text outline-none placeholder:text-faint disabled:opacity-60"
          data-computer-composer
        />
        {/* The box's own row: what goes into the message on the left, what sends it on the right. How it runs is on the tray. */}
        <div className="mt-1.5 flex items-center gap-x-2" data-composer-footer>
          <div className="-ml-1 flex shrink-0 items-center gap-0.5" data-composer-footer-start>
            <RemoteAttachButton state={attachments} computer={computer} disabled={!connected} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5" data-composer-footer-end>
            <EscapeStopHint armed={escapeStop.armed} agent={agentName(session.provider)} />
            {working && (
              <Button variant="danger" size="lg" icon={<span className="size-2 rounded-[2px] bg-current" aria-hidden />} disabled={!connected} onClick={onStop} data-tooltip={`Stop ${agentName(session.provider)} on ${name} (${formatKeys(keysFor('claude.stop'))}${escapeStop.twice ? ' twice' : ''})`} data-computer-stop>
                Stop
              </Button>
            )}
            {working ? (
              <QueueButton state={queueButtonState({ blocked, sending, hasMessage, whileWorking })} onAction={(action) => send(action === 'send-now' ? 'now' : action)} />
            ) : (
              // A disabled button gets no hover, so the reason it's unavailable sits on this wrapper.
              <span className="flex" data-tooltip={!sending ? (blocked ?? (!hasMessage ? 'Type a message first' : undefined)) : undefined}>
                <Button variant="primary" size="lg" disabled={!!blocked || sending || !hasMessage} onClick={() => send()} className="disabled:pointer-events-none" data-composer-submit data-computer-send>
                  {sending ? 'Sending…' : 'Send'}
                </Button>
              </span>
            )}
          </div>
        </div>
      </div>
      {/* What the session would cost at API prices, as that computer counts it, where a local session shows its own. */}
      <ComposerTray controls={controls} info={<RemoteSessionCost client={client} computer={computer} sessionId={session.id} working={working} />} />
    </div>
  );
}
