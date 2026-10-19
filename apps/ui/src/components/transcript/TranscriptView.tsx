import { isKeptUnread, releaseUnread } from '../../state/keptUnread.ts';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AppWindow, ArrowDown, Blocks, Bot, ChevronDown, CircleAlert, FileDiff, GitBranch, ListTodo, LoaderCircle, MessageCircleQuestion, ScrollText, SquareArrowDownLeft, SquareTerminal, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { pathInside, type ChangesBase, type GitChanges, type ImageAttachment, type PermissionRequest, type RewindResult, type SendMode, type SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { clearFindHighlights, rangesIn, setFindHighlights } from '../../lib/findHighlights.ts';
import { basename, shortAge, tildify } from '../../lib/format.ts';
import { nextMode } from '../../lib/modes.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { hostAsLive, isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { passFocusGate } from '../../state/focusGate.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePaletteBus, useSessionRequests, type SessionDigest } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { realBranch, useSessions } from '../../state/sessionsStore.ts';
import { popOut, popoutSession, showInMain } from '../../state/popoutsStore.ts';
import { currentPlatform } from '../../lib/platform.ts';
import { runAndSendOutput, runInTerminal, useTerminals } from '../../state/terminalsStore.ts';
import { sessionDraftBanner, draftMessage } from '../../state/drafts.ts';
import { useDrafts, type ComposerDraft } from '../../state/draftsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useUpNext } from '../../state/upNextStore.ts';
import { useLimits } from '../../state/limitsStore.ts';
import { UsageLimitNotice } from '../session/UsageLimitNotice.tsx';
import { DraftBanner } from '../drafts/DraftBanner.tsx';
// xterm.js is large; it loads the first time a terminal panel opens, not at startup.
const TerminalPanel = lazy(() => import('../terminal/TerminalPanel.tsx').then((m) => ({ default: m.TerminalPanel })));
import { Composer } from '../composer/Composer.tsx';
import { AutoWand } from '../composer/ComposerChips.tsx';
import { QueueButton } from '../composer/QueueButton.tsx';
import { queueButtonState } from '../composer/queueButton.ts';
import { UpNext, type UpNextActions } from '../composer/UpNext.tsx';
import { ModBands } from '../mods/ModBands.tsx';
import { ModPanePanel } from '../mods/ModPanePanel.tsx';
import { ModFooterChips } from '../mods/ModFooterChips.tsx';
import { ModsChip } from '../mods/ModsChip.tsx';
import { shownMods } from '../mods/modVisibility.ts';
import { useMods, useSessionMods } from '../../state/modsStore.ts';
import { ModReplaced } from '../mods/ModReplaced.tsx';
import { lastQueued, mergeIntoBox } from '../composer/upNext.ts';
import { contextFromPrompt } from '../composer/contextItems.ts';
import { sessionHistory } from '../composer/promptHistory.ts';
import { ActionPills } from '../actions/ActionPills.tsx';
import { useActionsMenu } from '../actions/useActionsMenu.tsx';
import { CapabilitiesDialog } from '../capabilities/CapabilitiesDialog.tsx';
import { ChangesPanel, useChangesLayout } from '../changes/ChangesPanel.tsx';
import { ContextMeter } from '../session/ContextMeter.tsx';
import { LargeContextNotice } from '../session/LargeContextNotice.tsx';
import { effectiveDock, rightBlocked } from '../terminal/terminalLayout.ts';
import { useHeight } from '../ui/useHeight.ts';
import { useWidth } from '../ui/useWidth.ts';
import { BranchMenu } from '../worktree/BranchMenu.tsx';
import { inWorktree } from '../worktree/branchMenu.ts';
import { WorktreeMenu } from '../worktree/WorktreeMenu.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { GitButton } from '../git/GitButton.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { isQuestionsFolder, QUESTION_LABEL, sessionOptions } from '../../lib/questions.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { SplitDirectionControl } from '../split/SplitDirectionControl.tsx';
import { PermissionCard, permissionTitle } from '../session/PermissionCard.tsx';
import { MoreMenu } from '../session/MoreMenu.tsx';
import { SavedSessionControls, SessionControls } from '../session/StatusBar.tsx';
import { AutoPickLine, AutoPickPopover, AutoSuggestNote, useSessionAutoPick } from '../session/AutoPick.tsx';
import { UsageBand, useUsageLines } from '../UsageBand.tsx';
import { SessionCost } from '../usage/SessionCost.tsx';
import { liveLabel, StatusDot } from '../StatusDot.tsx';
import { formatDuration, useTicker, WorkingDots } from './ActivityGroup.tsx';
import { BackgroundTaskList } from './BackgroundTaskList.tsx';
import { agentForTask } from './agentRuns.ts';
import { useAgentRuns } from './useAgentRuns.ts';
import { commandForTask } from './commandRuns.ts';
import { useCommandRuns } from './useCommandRuns.ts';
import { backgroundSummary } from './backgroundTasks.ts';
import { PromptExpansionContext, type PromptExpansion } from './ClampedPrompt.tsx';
import { buildDisplayItems, groupActivity, type RenderItem } from './displayItems.ts';
import { durationWords, liveParts, tokenWords } from './turnFormat.ts';
import { LiveTurnParts, TurnMetaContext, type LiveTurnInfo, type TurnMetaValue } from './TurnMeta.tsx';
import { claudeMs, liveTurn, type Turn } from './turns.ts';
import { useAgentTokens, useTurns } from './useTurns.ts';
import { memoryWriteOf } from './memoryWrites.ts';
import { useKnownMemoryFolders, useMemoryFoldersSync } from '../memory/useMemoryFolders.ts';
import { MessageMenuContext, useRememberLayer } from '../memory/RememberLayer.tsx';
import { FindBar } from './FindBar.tsx';
import { findMatches, searchableText, startMatch } from './findInSession.ts';
import { FileLinksProvider } from './FileLink.tsx';
import { StreamingMarkdown } from './Markdown.tsx';
import { AgentsPanel } from '../agents/AgentsPanel.tsx';
import { CommandsPanel } from '../commands/CommandsPanel.tsx';
import { AskPanel } from '../ask/AskPanel.tsx';
import { modPaneTab, paneOfTab, rightPanel, type RightTab } from '../ask/askWidth.ts';
import { RightPanelTabs } from '../ask/RightPanelTabs.tsx';
import { itemCount } from '../../state/ask.ts';
import { askAbout, closeAsk, loadAskThreads, newAskThread, openAsk, pickAskThread, retryAsk, toggleAskPanel, useSessionAsk } from '../../state/askStore.ts';
import { closeAgents, openAgents, pickAgent, toggleAgentsPanel, useSessionAgents } from '../../state/agentsPanelStore.ts';
import { closeCommands, openCommands, pickCommand, toggleCommandsPanel, useSessionCommands } from '../../state/commandsPanelStore.ts';
import { closeChanges, toggleChangesPanel, useSessionChanges } from '../../state/changesPanelStore.ts';
import { toggleTerminalPanel, useRightPanel, useRightTab } from '../../state/rightPanelStore.ts';
import { useTaskStrip } from '../../state/taskStripStore.ts';
import { MessageActionsContext, messageUuid, type MessageActions } from './messageActions.tsx';
import { parseTodos, TodoList } from './TodoList.tsx';
import { TranscriptItem } from './TranscriptItem.tsx';
import { useTranscript } from './useTranscript.ts';
import { PromptOutline } from './PromptOutline.tsx';
import { currentPrompt, isPrompt, LAND_OFFSET, MIN_PROMPTS, MIN_WIDTH, nextPrompt, outlinePrompts, previousPrompt, promptKeysBlocked, type OutlinePrompt } from './promptOutline.ts';
import { startNewSession } from '../newSession/startSession.ts';
import { GIT_POLL_MS, sameChanges } from './gitChangesRefresh.ts';
import { restartAsNew } from './restartAsNew.ts';
import { formatKeys, keysFor, matches as isShortcut } from '../../lib/shortcuts.ts';
import { CatchUpSlot } from '../catchUp/CatchUp.tsx';
import { replyPlaceholder } from '../catchUp/catchUpModel.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { useCatchUpShow } from '../../state/catchUpShow.ts';
import { useWhy } from '../../state/whyStore.ts';
import { WhyPanel } from '../session/WhyPanel.tsx';

const ORIGIN_LABEL = { cli: 'Terminal', desktop: 'Claude desktop', ide: 'IDE', sdk: 'SDK', app: 'Switchboard', unknown: '' } as const;

/**
 * The status word in the header's meta line takes the colour of its state: yellow while working,
 * pink when it needs you, green only while background tasks run. Idle is quiet, like the rest of the line.
 */
const STATUS_TONE = { running: 'text-accent-ink', 'needs-you': 'text-warn', idle: 'text-muted' } as const;

/** A pop-out narrower than this (the session view's width) gives a panel on the right the whole view. */
const NARROW_POPOUT_PANEL = 640;
/** Within this many pixels of the end counts as at the end (rounding), so the conversation follows new output again. */
const AT_END_PX = 4;
/** Further up than this, Jump to latest shows. */
const AWAY_PX = 24;
const distanceFromEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;


/** The dot between the parts of the header's meta line (a narrow pane shows only the status dot and the branch, no separators). */
const Sep = () => (
  <span aria-hidden className="shrink-0 text-faint @max-[860px]:hidden">
    ·
  </span>
);

/**
 * What Claude is doing right now, before it lands in the transcript: the text it's writing,
 * or (when no step line is already showing it) dots, the time since your message, and the step.
 */
/** The working line, drawn by a mod that replaces the Spinner. */
function SpinnerSlot({ sessionId, message, children }: { sessionId: string; message: string; children: ReactNode }) {
  const hooked = useMods((s) => s.sessions.get(sessionId)?.state.hooked.includes('Spinner') ?? false);
  const target = useMemo(() => ({ component: 'Spinner' as const, instanceId: 'spinner', props: { message } }), [message]);
  return hooked ? (
    <ModReplaced sessionId={sessionId} target={target}>
      {children}
    </ModReplaced>
  ) : (
    <>{children}</>
  );
}

function StreamingBlock({ sessionId, since, showIndicator, live }: { sessionId: string; since: number | null; showIndicator: boolean; live: LiveTurnInfo }) {
  const block = useHosts((s) => s.streaming.get(sessionId));
  const running = useHosts((s) => s.hosts.get(sessionId)?.state === 'running');
  // A new session on Auto: your message waits until Auto has picked its model.
  const choosing = useHosts((s) => s.hosts.get(sessionId)?.autoChoosing === true);
  const now = useTicker(choosing && showIndicator);
  if (choosing) {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming data-auto-choosing>
        <p className="flex min-w-0 items-center gap-2 text-ui text-muted">
          <span className="flex w-4 shrink-0 justify-center">
            <WorkingDots />
          </span>
          {since !== null && <span className="shrink-0 text-faint tabular-nums">{formatDuration(now - since)} ·</span>}
          <AutoWand />
          <span className="shrink-0">Auto is choosing a model…</span>
        </p>
      </div>
    );
  }
  if (block?.kind === 'text') {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming>
        <StreamingMarkdown text={block.text} />
        <span className="mt-0.5 block h-3.5 w-1.5 animate-pulse bg-accent-ink" aria-hidden />
      </div>
    );
  }
  if (!running || !showIndicator) return null;
  const label = live.waitingSince !== null ? 'Waiting for you' : block?.kind === 'tool' ? `Using ${block.text}` : block?.kind === 'thinking' ? 'Thinking' : 'Working';
  return (
    <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming>
      <SpinnerSlot sessionId={sessionId} message={label}>
      <p className="flex min-w-0 items-center gap-2 text-ui text-muted">
        <span className="flex w-4 shrink-0 justify-center">
          <WorkingDots />
        </span>
        <span className="shrink-0">{label}</span>
        {/* The turn's time and tokens so far, as Settings › Conversation says. */}
        <LiveTurnParts live={live} startedAt={since} />
        {block?.kind === 'thinking' && block.text && <span className="min-w-0 truncate text-faint italic">{block.text.slice(-160)}</span>}
      </p>
      </SpinnerSlot>
    </div>
  );
}

/** How the turn that just ended went, as the setting shows it, for its announcement: " It took 2 minutes 14 seconds, 18.4 thousand tokens." */
function finishedDetails(live: LiveTurnInfo | null): string {
  if (!live?.turn) return '';
  const parts = liveParts(live.mode);
  const worked = claudeMs(live.turn) ?? liveTurn(live.turn, Date.now(), null).workedMs;
  const said = [...(parts.duration && worked !== null ? [`It took ${durationWords(worked)}`] : []), ...(parts.tokens && live.turn.tokens ? [tokenWords(live.turn.tokens.total)] : [])];
  return said.length ? ` ${said.join(', ')}.` : '';
}

/**
 * A polite screen-reader announcement when Claude finishes a turn or needs you to answer something.
 * The transcript itself is not a live region: streamed text and rows the list mounts while you
 * scroll would be read out non-stop.
 */
function Announcer({ sessionId, working, failed, permissions, cwd, turn }: { sessionId: string; working: boolean; failed: boolean; permissions: PermissionRequest[]; cwd: string | null; turn: RefObject<LiveTurnInfo | null> }) {
  const [message, setMessage] = useState('');
  // A trailing no-break space makes a repeated message a change, so it's read out again.
  const say = (text: string) => setMessage((current) => (current.replace(/\u00a0$/, '') === text ? `${text}\u00a0` : text));
  const announced = useRef(new Set<string>());
  useEffect(() => {
    const fresh = permissions.filter((p) => !announced.current.has(p.requestId));
    fresh.forEach((p) => announced.current.add(p.requestId));
    if (fresh.length > 0) say(`${permissionTitle(fresh[0]!, cwd)}. Answer it above the message box.`);
  }, [permissions, cwd]);
  // Switching to another session isn't Claude finishing: only a change within one session counts.
  const previous = useRef({ sessionId, working });
  useEffect(() => {
    const was = previous.current;
    previous.current = { sessionId, working };
    if (was.sessionId === sessionId && was.working && !working) say(`${failed ? 'Claude stopped with an error.' : 'Claude finished.'}${finishedDetails(turn.current)}`);
  }, [sessionId, working, failed, turn]);
  return (
    <p className="sr-only" role="status" aria-live="polite" data-announcer>
      {message}
    </p>
  );
}

/**
 * The checkout's git changes, refreshed when the session does something (debounced), when the Changes panel
 * opens, when the window comes back into focus or into view, on request, and every few seconds while the window
 * is visible: files also change from the terminal, a project action or another app. `open`: the Changes panel
 * shows them. `isRepo` is false outside git.
 */
function useGitChanges(cwd: string | null, base: ChangesBase, activity: string, open: boolean) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [isRepo, setIsRepo] = useState(true);
  /** Asks for a check after `delay` ms (a later ask replaces a waiting one); a no-op without a folder. */
  const request = useRef<(delay: number) => void>(() => {});
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    // One git.changes at a time: an ask while one runs checks again once it is back.
    let busy = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      timer = undefined;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      client
        .call('git.changes', { cwd, base })
        .then(
          (result) => {
            if (cancelled) return;
            // The open panel takes every new list (its open diffs reload with it); the header's count only needs news.
            setChanges((current) => (!openRef.current && sameChanges(current, result) ? current : result));
            setIsRepo(true);
          },
          () => !cancelled && (setChanges(null), setIsRepo(false)),
        )
        .finally(() => {
          busy = false;
          if (cancelled || !again) return;
          again = false;
          load();
        });
    };
    const ask = (delay: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(load, delay);
    };
    request.current = ask;
    ask(500);
    const visible = () => document.visibilityState === 'visible';
    // Nothing is checked while the window is hidden; it checks once it shows again.
    const poll = setInterval(() => visible() && !busy && timer === undefined && load(), GIT_POLL_MS);
    const onVisible = () => visible() && ask(0);
    const onFocus = () => ask(500);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      request.current = () => {};
    };
  }, [client, cwd, base]);
  // The session did something (or the branch changed): check again once it settles.
  useEffect(() => request.current(500), [activity]);
  // Opening the panel shows what is there now, not what was there at the last check.
  useEffect(() => {
    if (open) request.current(0);
  }, [open]);
  const refresh = useCallback(() => request.current(500), []);
  return { changes, isRepo, refresh };
}

/**
 * A session: live transcript, plus composer and controls when it can run here. `tiled`: it is one of several
 * panes, so its header has the handle to drag it by and a close for the pane, and an inactive one dims.
 * `leading`: it is the pane at the window's top left, which carries the sidebar toggle.
 */
export function TranscriptView({ sessionId, tiled = false, active = true, leading = true }: { sessionId: string; tiled?: boolean; active?: boolean; leading?: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const summary = useSessions((s) => s.sessions.get(sessionId) ?? null);
  const registryLive = useSessions((s) => s.live.get(sessionId) ?? null);
  const select = useSessions((s) => s.select);
  const host = useHosts((s) => s.hosts.get(sessionId));
  const permissionMap = useHosts((s) => s.permissions);
  const commandsVersion = useHosts((s) => s.commandsVersion);
  const permissions = useMemo(() => [...permissionMap.values()].filter((p) => p.sessionId === sessionId), [permissionMap, sessionId]);
  const home = useHomeFolder();
  const { status, messages, error: readError, retry: retryRead } = useTranscript(sessionId);
  // The terminal panel belongs to this session's view: another session doesn't show it.
  const panelOpen = useTerminals((s) => s.openFor.has(sessionId));
  const terminalCount = useTerminals((s) => [...s.terminals.values()].filter((t) => t.sessionId === sessionId && t.exitCode === null).length);

  // Setup and project actions open their own terminal tab: show it as soon as one starts.
  const actionTerminals = useTerminals((s) => [...s.terminals.values()].filter((t) => t.sessionId === sessionId && t.kind === 'action').map((t) => t.id).join(','));
  const seenActionTerminals = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = actionTerminals ? actionTerminals.split(',') : [];
    if (seenActionTerminals.current === null) {
      seenActionTerminals.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seenActionTerminals.current!.has(id));
    ids.forEach((id) => seenActionTerminals.current!.add(id));
    if (fresh.length) {
      useTerminals.getState().togglePanel(sessionId, true);
      useTerminals.getState().setActive(sessionId, fresh.at(-1)!);
    }
  }, [actionTerminals, sessionId]);
  const items = useMemo(() => buildDisplayItems(messages), [messages]);
  /** What Auto picked when this session started (null: it didn't). */
  const autoPick = useSessionAutoPick(sessionId);
  /** Your earlier messages here, for ↑ in the message box. */
  const promptHistory = useMemo(() => sessionHistory(items), [items]);
  const toolActivity = usePreferences((s) => s.prefs.toolActivity);
  // A memory Claude saved shows as its own line, also between summarised runs of tool calls.
  useMemoryFoldersSync();
  const memoryFolders = useKnownMemoryFolders();
  const renderItems = useMemo<RenderItem[]>(
    () => (toolActivity === 'summary' ? groupActivity(items, (item) => item.kind === 'tool' && memoryWriteOf(item.name, item.input, memoryFolders) !== null) : items),
    [items, toolActivity, memoryFolders],
  );
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  /** The first answer after your first message: Auto's line goes above it (-1 before Claude answers). */
  const firstAnswer = useMemo(() => {
    if (!autoPick) return -1;
    const first = renderItems.findIndex((item) => item.kind === 'user');
    return first < 0 ? -1 : renderItems.findIndex((item, index) => index > first && item.kind !== 'user');
  }, [renderItems, autoPick]);

  const projectRoot = summary?.projectRoot ?? registryLive?.projectRoot ?? null;
  const project = useProjects((s) => (projectRoot ? s.projects.get(projectRoot) : undefined));

  // The catch-up: a briefing on the last turn, as a banner over the conversation.
  const { card: catchUp, show: catchUpShow } = useCatchUpShow(sessionId);
  const replying = useCatchUp((s) => s.replying === sessionId);
  // When you opened this session: a catch-up made before that is what you came back to.
  const openedAt = useRef({ sessionId, at: Date.now() });
  if (openedAt.current.sessionId !== sessionId) openedAt.current = { sessionId, at: Date.now() };
  /**
   * Opening a session with a catch-up doesn't mark it read: Mark as read, or anything that ends what it needs, does. A
   * card made while you were looking (you watched the turn end) is no news, so the session is read as usual then.
   */
  const keepUnread = catchUp !== null && catchUpShow !== null && catchUp.generatedAt < openedAt.current.at;

  // Looking at a session marks it read, also while new output keeps arriving.
  const unread = summary?.unread ?? false;
  useEffect(() => {
    if (!client || !unread || keepUnread || isKeptUnread(sessionId)) return;
    const timer = setTimeout(() => void client.call('sessions.markViewed', { sessionId }).catch(() => {}), 600);
    return () => clearTimeout(timer);
  }, [client, sessionId, unread, summary?.updatedAt, keepUnread]);
  // Marked as unread while open: it stays so until you leave the session.
  useEffect(() => () => releaseUnread(sessionId), [sessionId]);
  // Reply put you in the message box: another session isn't a reply to this one.
  useEffect(() => () => useCatchUp.setState((s) => (s.replying === sessionId ? { replying: null } : {})), [sessionId]);

  // The latest task list, pinned above the composer while there's still work on it.
  const todos = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if (item.kind === 'tool' && item.name === 'TodoWrite') return parseTodos(item.input);
    }
    return [];
  }, [items]);
  // The task list and the background tasks start folded into their pills (the pills say how far
  // along, and how many); one opens below them at a time.
  // Per session, so the strip is as you left it when you come back to the session.
  const openStrip = useTaskStrip((s) => s.open.get(sessionId)) ?? null;
  const todosOpen = openStrip === 'todos';
  const todosId = useId();
  const backgroundId = useId();

  const activeHost = isActiveHost(host) ? host : null;
  const live = activeHost ? hostAsLive(activeHost) : registryLive;
  const openElsewhere = !activeHost && registryLive !== null;
  // Last, the host's own folder: a session whose Claude Code failed (or stopped) before it wrote a transcript has no
  // other, and without one the message box would stay shut.
  const cwd = activeHost?.cwd ?? summary?.cwd ?? registryLive?.cwd ?? host?.cwd ?? null;
  /** Failed before it wrote a transcript: nothing to resume, so the next message starts it again as a new session. */
  const restart = restartAsNew(host, { hasTranscript: summary !== null, openElsewhere });
  /** A quick question: no project actions, and no git (nothing to diff, commit or branch). The terminal still opens, in its folder. */
  const question = useProjects((s) => isQuestionsFolder(projectRoot ?? cwd, s.questionsDir));
  const options = sessionOptions(question);
  const running = activeHost?.state === 'running' || activeHost?.state === 'needs-you';
  const showTodos = todos.some((t) => t.status !== 'completed') && (live !== null || activeHost !== null);
  const backgroundTasks = activeHost?.backgroundTasks ?? [];
  const backgroundOpen = openStrip === 'background' && backgroundTasks.length > 0;
  const stopTask = async (taskId: string) => {
    try {
      await client!.call('session.stopTask', { sessionId, taskId });
    } catch (error) {
      setActionError(`Could not stop the task: ${(error as Error).message}`);
      throw error;
    }
  };
  /** The Claude profile (account) the session bills to. */
  const profileId = activeHost?.profileId ?? summary?.profileId ?? registryLive?.profileId ?? null;
  // Project actions: called once here (it listens for their shortcuts and owns their dialogs), then
  // shared by the pills above the message box and the header's ⋯ menu.
  const actionsMenu = useActionsMenu({ sessionId, projectRoot: options.projectActions ? projectRoot : null, cwd, active });

  // The Changes panel (⌘⇧D): the checkout's git diff, with stage and revert.
  const changesOpen = useSessionChanges(sessionId);
  // With two panes, dialogs belong to the active one; the side panels are each session's own.
  const toolsOpen = useOverlay((s) => s.open === 'tools') && active;
  const [changesBase, setChangesBase] = useState<ChangesBase>('uncommitted');
  // A branch switch (here or in another pane on the same checkout) changes what the panel shows.
  const branchSwitches = useCheckoutBranches((s) => s.switches);
  const { changes, isRepo: inRepo, refresh: refreshChanges } = useGitChanges(options.git ? cwd : null, changesBase, `${items.length}:${live?.status ?? ''}:${branchSwitches}`, changesOpen);
  const isRepo = options.git && inRepo;
  // The badge on the Changes button counts uncommitted files only (the panel can compare with a branch too).
  const changedCount = changesBase === 'uncommitted' && changes ? changes.files.length : 0;
  // A session in its own window (a pop-out) is a full session: it has every panel, each window keeping its own. Only the
  // header's window buttons differ (`inPopout`).
  const inPopout = popoutSession === sessionId;
  const showChanges = Boolean(changesOpen && cwd && isRepo);
  // "Why is Claude asking?" on a permission card: its panel takes the Changes panel's place while it is open.
  const whyOpen = useWhy((s) => s.open);
  const whyRequest = active && whyOpen?.sessionId === sessionId ? (permissions.find((p) => p.requestId === whyOpen.requestId) ?? null) : null;
  // Answered (here, in a terminal or by a hook): the panel goes with the request.
  useEffect(() => {
    if (whyOpen?.sessionId === sessionId && !permissions.some((p) => p.requestId === whyOpen.requestId)) useWhy.getState().close();
  }, [whyOpen, permissions, sessionId]);
  const changesExpanded = useChangesLayout((s) => s.expanded);
  // Ask about this session shares the right side with Changes: both open, they are tabs (the last one picked in front).
  const ask = useSessionAsk(sessionId);
  const rightTab = useRightTab(sessionId);
  const rightWidth = useRightPanel((s) => s.width);
  const setRightWidth = useRightPanel((s) => s.setWidth);
  // Agents joins them: the agents Claude started in this session, with the running ones counted on their tab.
  const { agents, running: agentsRunning } = useAgentRuns(items, live !== null);
  const agentsState = useSessionAgents(sessionId);
  // Their open state is per session, so unlike Changes (one flag for the window) they stay when another pane is focused.
  const showAgents = agentsState.open;
  // And Commands: the shell commands and monitors Claude ran in the background, with their output.
  const { commands: backgroundCommands, running: commandsRunning } = useCommandRuns(items, live !== null, activeHost?.backgroundTasks ?? null);
  const commandsState = useSessionCommands(sessionId);
  const showCommands = commandsState.open;
  // The terminal docks below or on the right. On the right it is a tab like the others, so opening Changes, Ask,
  // Agents or Commands next to it keeps it there. Maximized, it takes the whole view: the conversation (and the other panels) stay
  // mounted but hidden. Each pane shows its own session's terminal, so with two panes both can have one.
  const terminalShown = panelOpen;
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyWidth = useWidth(bodyRef);
  const bodyHeight = useHeight(bodyRef);
  // "Why?" takes the whole right side while it is open.
  const terminalBlocked = rightBlocked(whyRequest ? 'changes' : null, bodyWidth);
  const terminalDock = effectiveDock(useTerminals((s) => s.dock), terminalBlocked);
  const terminalMaximized = useTerminals((s) => s.maximizedFor.has(sessionId)) && terminalShown;
  const terminalOnRight = terminalShown && terminalDock === 'right' && !terminalMaximized;
  // Mods' panes are tabs too, while Claude Code has them open (and Show mods and the mod's own switch are on).
  const sessionMods = useSessionMods(sessionId);
  const showMods = usePreferences((s) => s.prefs.showMods);
  const hiddenMods = usePreferences((s) => s.prefs.hiddenMods);
  const modPrefs = useMemo(() => ({ showMods, hiddenMods }), [showMods, hiddenMods]);
  const modPanes = useMemo(
    () => (sessionMods.state.attached ? shownMods(modPrefs, profileId, sessionMods.panes.panes) : []),
    [sessionMods.state.attached, sessionMods.panes.panes, modPrefs, profileId],
  );
  const right = rightPanel({ changes: showChanges, ask: ask.open, agents: showAgents, commands: showCommands, terminal: terminalOnRight }, rightTab, modPanes.map((p) => p.id));
  const modPaneFront = paneOfTab(right.tab);
  const frontPane = modPaneFront === null ? null : (modPanes.find((p) => p.id === modPaneFront) ?? null);
  // Open panels share the right side as tabs: the one in front shows, the others wait behind it. The header's buttons say which.
  const changesFront = right.tabs && showChanges ? right.tab === 'changes' : undefined;
  const askFront = right.tabs && ask.open ? right.tab === 'ask' : undefined;
  const agentsFront = right.tabs && showAgents ? right.tab === 'agents' : undefined;
  const commandsFront = right.tabs && showCommands ? right.tab === 'commands' : undefined;
  const terminalFront = right.tabs && terminalOnRight ? right.tab === 'terminal' : undefined;
  const panesOpen = modPanes.length > 0;
  // A pop-out can be narrower than a panel and a usable conversation together: then the panel takes the whole view,
  // and the header's buttons (or the panel's ×) bring the conversation back.
  const narrowPanel = inPopout && (right.open.length > 0 || whyRequest !== null) && !terminalMaximized && bodyWidth !== null && bodyWidth < NARROW_POPOUT_PANEL;
  const toggleChangesHere = () => toggleChangesPanel(sessionId, ask.open || showAgents || showCommands || terminalOnRight || panesOpen);
  const toggleAskHere = () => toggleAskPanel(client, sessionId, showChanges || showAgents || showCommands || terminalOnRight || panesOpen);
  const toggleAgentsHere = () => toggleAgentsPanel(sessionId, showChanges || ask.open || showCommands || terminalOnRight || panesOpen);
  const toggleCommandsHere = () => toggleCommandsPanel(sessionId, showChanges || ask.open || showAgents || terminalOnRight || panesOpen);
  // Picking a mod's tab tells Claude Code which pane is shown.
  const pickRightTab = (tab: RightTab) => {
    useRightPanel.getState().setTab(sessionId, tab);
    const pane = paneOfTab(tab);
    if (pane && client) void client.call('mods.pane', { sessionId, action: 'show', id: pane }).catch(() => {});
  };
  const closeModPane = (id: string) => {
    if (client) void client.call('mods.pane', { sessionId, action: 'close', id }).catch(() => {});
  };
  const rightTabs = (actions: ReactNode) => (
    <RightPanelTabs
      tab={right.tab ?? 'changes'}
      open={right.open}
      onTab={pickRightTab}
      counts={{ changes: changes?.files.length ?? 0, ask: itemCount(ask), agents: agentsRunning, commands: commandsRunning, terminal: terminalCount }}
      titles={Object.fromEntries(modPanes.map((p) => [p.id, p.title]))}
    >
      {actions}
    </RightPanelTabs>
  );
  // A mod asked for one of its panes to take the keyboard: its tab comes to the front and takes focus.
  const [paneFocus, setPaneFocus] = useState({ id: null as string | null, nonce: 0 });
  const focusRequested = active ? sessionMods.panes.focusRequestedId : null;
  useEffect(() => {
    if (!focusRequested || !modPanes.some((p) => p.id === focusRequested)) return;
    useRightPanel.getState().setTab(sessionId, modPaneTab(focusRequested));
    setPaneFocus((f) => ({ id: focusRequested, nonce: f.nonce + 1 }));
  }, [focusRequested, modPanes]);
  // The terminal coming to the right (opened, or docked there) comes to the front, as a panel opened there does.
  const terminalWasOnRight = useRef(terminalOnRight);
  useEffect(() => {
    if (terminalOnRight && !terminalWasOnRight.current) useRightPanel.getState().setTab(sessionId, 'terminal');
    terminalWasOnRight.current = terminalOnRight;
  }, [terminalOnRight]);
  // Docked below, the terminal takes the room of the footer under the message box: a ring in the box stands in for it.
  const foldFooter = terminalShown && terminalDock === 'bottom' && !terminalMaximized;
  const usageLines = useUsageLines(profileId);
  // Opening Changes (⌘⇧D) while the terminal fills the view brings the view back, or Changes would open out of sight.
  useEffect(() => {
    if (showChanges) useTerminals.getState().setMaximized(sessionId, false);
  }, [showChanges, sessionId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Behind the Settings sheet the session stays mounted (inert); its shortcuts wait until Settings closes.
      if (useSessions.getState().view !== 'session') return;
      // A key something else already took (a shortcut recorder), or one pressed while a dialog is open, isn't for this view.
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      if (active && isShortcut(event, 'changes.toggle')) {
        event.preventDefault();
        toggleChangesHere();
      }
      if (active && isShortcut(event, 'agents.toggle')) {
        event.preventDefault();
        toggleAgentsHere();
      }
      if (active && isShortcut(event, 'commands.toggle')) {
        event.preventDefault();
        toggleCommandsHere();
      }
      // ⌘F finds in this conversation (the terminal keeps its own keys).
      if (active && isShortcut(event, 'find') && !(event.target as HTMLElement | null)?.closest?.('.xterm')) {
        event.preventDefault();
        setFindQuery((q) => q ?? '');
        setFindFocus((n) => n + 1);
      }
      // ⌘⇧↑ / ⌘⇧↓ move between your prompts, also with the rail hidden. Not in the terminal, nor in a field with
      // text, where they select to the start or the end.
      const promptStep = isShortcut(event, 'transcript.prompt-previous') ? -1 : isShortcut(event, 'transcript.prompt-next') ? 1 : 0;
      if (active && promptStep !== 0 && !(event.target as HTMLElement | null)?.closest?.('.xterm') && !promptKeysBlocked(document.activeElement as HTMLElement | null)) {
        event.preventDefault();
        stepPrompt(promptStep);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The run of steps Claude is on now (summary mode), and what to call it between steps.
  const lastRender = renderItems.at(-1);
  // Sessions running elsewhere (a terminal, Claude desktop) count too: their status comes from the registry.
  const working = running || live?.status === 'running' || live?.status === 'needs-you';
  const activeGroupKey = working && lastRender?.kind === 'activity' ? lastRender.key : null;
  const streamKind = useHosts((s) => s.streaming.get(sessionId)?.kind ?? null);
  const streamTool = useHosts((s) => (s.streaming.get(sessionId)?.kind === 'tool' ? s.streaming.get(sessionId)!.text : null));
  const activeLabel =
    live?.status === 'needs-you' ? 'Waiting for you' : streamKind === 'thinking' ? 'Thinking' : streamKind === 'tool' && streamTool ? `Using ${streamTool}` : null;
  // When your last message went in, for the "9s · Thinking" timer.
  // Turns: the line under each finished one, and the working line's numbers for the open one.
  const agentTokens = useAgentTokens(client, sessionId, items, working);
  const turns = useTurns(sessionId, items, agentTokens);
  const turnDetails = usePreferences((s) => s.prefs.turnDetails);
  const openTurn = working ? (turns.at(-1) ?? null) : null;
  const finishedByReply = useMemo(() => {
    const map = new Map<string, Turn>();
    for (const turn of turns) if (turn !== openTurn && turn.replyKey) map.set(turn.replyKey, turn);
    return map;
  }, [turns, openTurn]);
  // While a prompt waits on you, the clock stops: that time isn't Claude's.
  const waitingSince = live?.status === 'needs-you' && permissions.length > 0 ? Math.min(...permissions.map((p) => p.createdAt)) : null;
  const liveTurnInfo = useMemo<LiveTurnInfo>(() => ({ turn: openTurn, waitingSince, mode: turnDetails }), [openTurn, waitingSince, turnDetails]);
  // The latest turn, for the announcement when it ends.
  const lastTurnRef = useRef<LiveTurnInfo | null>(null);
  lastTurnRef.current = { turn: turns.at(-1) ?? null, waitingSince: null, mode: turnDetails };
  const turnStart = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if ((item.kind === 'user' && !item.subagent) || item.kind === 'command') return item.at;
    }
    return null;
  }, [items]);

  useEffect(() => {
    if (!client) return;
    // A slower, older answer must not replace the list for the current folder; a failure keeps the last list.
    let cancelled = false;
    client.call('session.commands', { sessionId, ...(cwd ? { cwd } : {}) }).then(
      (r) => !cancelled && setCommands(r.commands),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, cwd, activeHost?.state === 'idle', commandsVersion]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 6,
    getItemKey: (i) => renderItems[i]!.key,
    // Room above the first message and between the last one and the composer.
    paddingStart: 16,
    paddingEnd: 28,
    scrollPaddingEnd: 28,
  });

  // Start at the bottom, and keep following new output while the user is at the bottom.
  // Following the end stops as soon as *you* scroll up (wheel, trackpad, keys, scrollbar), even by a
  // few pixels: new output must not pull you back down. The list also moves itself while rows are
  // measured, and that must never count as leaving. Getting back to the very end, by any means
  // (or with Jump to latest), follows again.
  const stickToBottom = useRef(true);
  // Away from the end while not following: shows Jump to latest.
  const [away, setAway] = useState(false);
  const syncAway = () => {
    const el = scrollRef.current;
    setAway(Boolean(el) && !stickToBottom.current && distanceFromEnd(el!) > AWAY_PX);
  };
  const follow = (on: boolean) => {
    stickToBottom.current = on;
    syncAway();
  };
  const userScrollAt = useRef(0);
  const lastScrollTop = useRef(0);
  const markUserScroll = () => (userScrollAt.current = Date.now());
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const movedUp = el.scrollTop < lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (distanceFromEnd(el) <= AT_END_PX) stickToBottom.current = true;
    else if (movedUp && Date.now() - userScrollAt.current < 1_000) stickToBottom.current = false;
    syncAway();
    // Rows mount and unmount while scrolling; their matches need highlighting again.
    if (findQuery !== null) schedulePaint();
    if (showOutline) scheduleCurrent();
  };
  // Scrolling up stops following at once, before the scroll lands: the next token would pull it back.
  const leaveEnd = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop > 0) follow(false);
  };
  const onWheel = (event: { deltaY: number }) => {
    markUserScroll();
    if (event.deltaY < 0) leaveEnd();
  };
  const onScrollKey = (event: { key: string; shiftKey: boolean }) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markUserScroll();
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) leaveEnd();
  };
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    follow(true);
    el.scrollTop = el.scrollHeight;
  };
  const streamingText = useHosts((s) => s.streaming.get(sessionId)?.text.length ?? 0);
  // Rows start at an estimated height and grow once measured, so follow the total size too:
  // otherwise the first jump lands short of the end and the last message sits under the composer.
  // This sets scrollTop itself: the virtualizer's scrollToIndex keeps chasing its target for seconds,
  // and would pull the view back down after you scroll up.
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current && renderItems.length > 0) {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => stickToBottom.current && (el.scrollTop = el.scrollHeight));
    } else syncAway();
  }, [renderItems.length, totalSize, streamingText, permissions.length, virtualizer]);
  // The view shrinks when the message box grows (a long prompt, an attachment, a permission card),
  // and the browser keeps scrollTop without a scroll event, so the last lines slide under the box.
  // The "Working…" line below the list grows the end the same way: on a session's first message it
  // appears only once Claude Code has started, after everything above has settled.
  // Following the end again on every height change keeps them in sight.
  const tailRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastHeight = el.clientHeight;
    const observer = new ResizeObserver((entries) => {
      const height = el.clientHeight;
      const tailChanged = entries.some((entry) => entry.target === tailRef.current);
      if (height === lastHeight && !tailChanged) return;
      lastHeight = height;
      if (stickToBottom.current && height > 0) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    if (tailRef.current) observer.observe(tailRef.current);
    return () => observer.disconnect();
  }, []);

  // The prompt outline: a mark for each of your prompts beside the conversation, and ⌘⇧↑ / ⌘⇧↓ to move between them.
  // The list only changes when a prompt comes or goes, so the rail doesn't redraw for every new line from Claude.
  const promptList = useRef<OutlinePrompt[]>([]);
  const prompts = useMemo(() => {
    const next = outlinePrompts(renderItems);
    const was = promptList.current;
    if (next.length === was.length && next.every((p, i) => p.key === was[i]!.key && p.index === was[i]!.index)) return was;
    return (promptList.current = next);
  }, [renderItems]);
  const showOutlinePref = usePreferences((s) => s.prefs.promptOutline);
  const transcriptWidth = useWidth(scrollRef);
  const turnMeta = useMemo<TurnMetaValue>(() => ({ byReply: finishedByReply, mode: turnDetails, width: transcriptWidth }), [finishedByReply, turnDetails, transcriptWidth]);
  const showOutline = showOutlinePref && prompts.length >= MIN_PROMPTS && (transcriptWidth ?? 0) >= MIN_WIDTH && status === 'ready' && !terminalMaximized;
  /** Where each prompt's row starts, from the virtualizer: measured, or estimated for rows not rendered yet. */
  const promptStarts = () => {
    virtualizer.getTotalSize(); // brings the measurements up to date
    return prompts.map((p) => virtualizer.measurementsCache[p.index]?.start ?? 0);
  };
  // The rail's positions follow the measurements, at most once a frame.
  const [outlineMeasure, setOutlineMeasure] = useState<{ starts: number[]; total: number; gutter: number }>({ starts: [], total: 0, gutter: 0 });
  useEffect(() => {
    if (!showOutline) return;
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current;
      const starts = promptStarts();
      const total = virtualizer.getTotalSize();
      // The scrollbar's width: the rail sits just left of it.
      const gutter = el ? el.offsetWidth - el.clientWidth : 0;
      setOutlineMeasure((was) => (was.total === total && was.gutter === gutter && was.starts.length === starts.length && was.starts.every((s, i) => s === starts[i]) ? was : { starts, total, gutter }));
    });
    return () => cancelAnimationFrame(frame);
  }, [showOutline, prompts, totalSize, transcriptWidth, virtualizer]);
  // A jump that couldn't bring its prompt to the top (near the end) still makes it the current one, until you scroll.
  const pinnedPrompt = useRef<{ index: number; top: number } | null>(null);
  const findCurrentPrompt = () => {
    const el = scrollRef.current;
    if (!el || prompts.length === 0) return -1;
    const pinned = pinnedPrompt.current;
    if (pinned && pinned.index < prompts.length && Math.abs(el.scrollTop - pinned.top) <= 2) return pinned.index;
    pinnedPrompt.current = null;
    return currentPrompt(promptStarts(), el.scrollTop);
  };
  const [currentMark, setCurrentMark] = useState(-1);
  const currentFrame = useRef(0);
  const scheduleCurrent = () => {
    cancelAnimationFrame(currentFrame.current);
    currentFrame.current = requestAnimationFrame(() => setCurrentMark(findCurrentPrompt()));
  };
  useEffect(() => {
    if (showOutline) scheduleCurrent();
  }, [showOutline, outlineMeasure]);
  useEffect(() => () => cancelAnimationFrame(currentFrame.current), []);
  // The prompt a jump landed on: a short accent ring on it (none with reduced motion, see styles.css).
  const [landingKey, setLandingKey] = useState<string | null>(null);
  useEffect(() => {
    if (!landingKey) return;
    const timer = setTimeout(() => setLandingKey(null), 1_200);
    return () => clearTimeout(timer);
  }, [landingKey]);
  /** Scrolls so prompt `index` (of `prompts`) sits LAND_OFFSET below the top of the view. Stops following the end. */
  const jumpToPrompt = (index: number) => {
    const el = scrollRef.current;
    const prompt = prompts[index];
    if (!el || !prompt) return;
    follow(false);
    // Sets scrollTop itself, like following the end does: scrollToIndex keeps chasing its target and fights a scroll.
    const place = () => {
      const start = promptStarts()[index];
      if (start === undefined) return;
      el.scrollTop = Math.max(0, start - LAND_OFFSET);
      pinnedPrompt.current = { index, top: el.scrollTop };
    };
    place();
    setCurrentMark(index);
    // The rows around it are measured once they render: settle on the exact spot over the next frames.
    requestAnimationFrame(() => {
      place();
      requestAnimationFrame(place);
    });
    // A second jump to the same prompt plays the ring again.
    setLandingKey(null);
    requestAnimationFrame(() => setLandingKey(prompt.key));
  };
  const jumpRef = useRef(jumpToPrompt);
  jumpRef.current = jumpToPrompt;
  const onOutlineJump = useCallback((index: number) => jumpRef.current(index), []);
  /** Previous prompt (-1) or Next prompt (1); from the last prompt, Next goes to the end. */
  const stepPrompt = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el || prompts.length === 0 || terminalMaximized) return;
    const starts = promptStarts();
    const current = findCurrentPrompt();
    const target = direction === 1 ? nextPrompt(starts, el.scrollTop, current) : previousPrompt(starts, el.scrollTop, current);
    if (target === 'end') jumpToLatest();
    else if (target !== null) jumpToPrompt(target);
  };
  // Another session in this pane starts at its end, with nothing pinned.
  useEffect(() => {
    pinnedPrompt.current = null;
    setLandingKey(null);
  }, [sessionId]);

  // Search opened this session at a message: scroll there once it's loaded, and highlight it briefly.
  const focusMessage = useOverlay((s) => (s.focusMessage?.sessionId === sessionId ? s.focusMessage.messageUuid : null));
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  useEffect(() => {
    if (!focusMessage) return;
    const index = renderItems.findIndex((item) =>
      item.kind === 'activity' ? item.items.some((i) => messageUuid(i.key) === focusMessage) : messageUuid(item.key) === focusMessage,
    );
    if (index === -1) return;
    follow(false);
    virtualizer.scrollToIndex(index, { align: 'center' });
    // Rows are measured as they render; settle on the exact spot a frame later.
    requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'center' }));
    setHighlightKey(renderItems[index]!.key);
    useOverlay.getState().focus(null);
  }, [focusMessage, renderItems, virtualizer]);
  // The highlight fades on its own timer: clearing focusMessage above re-runs that effect, which must not cancel it.
  useEffect(() => {
    if (!highlightKey) return;
    const timer = setTimeout(() => setHighlightKey(null), 2_500);
    return () => clearTimeout(timer);
  }, [highlightKey]);

  // Find in the conversation (⌘F). Matches come from the messages' text, so rows that aren't
  // mounted count too; the highlights are drawn on the rows that are.
  const [findQuery, setFindQuery] = useState<string | null>(null);
  const [findFocus, setFindFocus] = useState(0);
  const [findCurrent, setFindCurrent] = useState(-1);
  const findOwner = useId();
  const matches = useMemo(() => (findQuery === null ? [] : findMatches(renderItems, findQuery)), [findQuery, renderItems]);
  const needle = findQuery?.trim().toLowerCase() ?? '';
  // Scroll the current match into view on the next paint (after the row has been mounted).
  const revealCurrent = useRef(false);
  const paintFrame = useRef(0);
  const paint = () => {
    const root = scrollRef.current;
    if (!root || !needle) return clearFindHighlights(findOwner);
    const match = matches[findCurrent];
    const all: Range[] = [];
    let current: Range | null = null;
    for (const row of root.querySelectorAll<HTMLElement>('[data-transcript-item]')) {
      const index = Number(row.dataset.index);
      const item = renderItems[index];
      if (!item || searchableText(item) === null) continue;
      const ranges = rangesIn(row, needle);
      all.push(...ranges);
      // The text renders as Markdown, so a row can show fewer matches than its source has.
      if (match?.index === index) current = ranges[Math.min(match.nth, ranges.length - 1)] ?? null;
    }
    setFindHighlights(findOwner, all, current);
    if (revealCurrent.current && current) {
      revealCurrent.current = false;
      // A long message is taller than the view: centre the match itself, not its row.
      const box = root.getBoundingClientRect();
      const rect = current.getBoundingClientRect();
      if (rect.top < box.top + 48 || rect.bottom > box.bottom - 48) root.scrollTop += rect.top - (box.top + box.height / 2);
    }
  };
  const schedulePaint = () => {
    cancelAnimationFrame(paintFrame.current);
    paintFrame.current = requestAnimationFrame(paint);
  };
  // A new search starts at the first match from the top of the view down.
  useEffect(() => {
    if (findQuery === null) return;
    const top = scrollRef.current?.scrollTop ?? 0;
    const firstVisible = virtualizer.getVirtualItems().find((row) => row.end > top)?.index ?? 0;
    setFindCurrent(startMatch(matches, firstVisible));
    revealCurrent.current = true;
    // Only when the text changes: new messages arriving mustn't move you to another match.
  }, [needle]);
  const stepFind = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    setFindCurrent((current) => (current + direction + matches.length) % matches.length);
    revealCurrent.current = true;
  };
  // Long prompts show two lines until you open them; find opens the one its current match is in.
  const [openPrompts, setOpenPrompts] = useState<ReadonlySet<string>>(() => new Set());
  const promptExpansion = useMemo<PromptExpansion>(
    () => ({
      isOpen: (key) => openPrompts.has(key),
      toggle: (key) =>
        setOpenPrompts((open) => {
          const next = new Set(open);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
    }),
    [openPrompts],
  );
  const findKey = findCurrent >= 0 ? (renderItems[matches[findCurrent]?.index ?? -1]?.key ?? null) : null;
  useEffect(() => {
    if (findKey && !openPrompts.has(findKey)) setOpenPrompts((open) => new Set(open).add(findKey));
  }, [findKey]);
  useEffect(() => {
    const match = matches[findCurrent];
    if (match && revealCurrent.current) {
      follow(false);
      virtualizer.scrollToIndex(match.index, { align: 'center' });
      // Rows are measured as they render: settle a frame later, then find the match in the row.
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(match.index, { align: 'center' });
        schedulePaint();
      });
    } else {
      schedulePaint();
    }
  }, [findCurrent, matches, totalSize]);
  const closeFind = () => {
    setFindQuery(null);
    setFindCurrent(-1);
    clearFindHighlights(findOwner);
  };
  useEffect(() => () => clearFindHighlights(findOwner), [findOwner]);
  // Another session in this pane starts without a search.
  useEffect(() => {
    closeFind();
    setOpenPrompts(new Set());
  }, [sessionId]);

  // A draft kept from before (switching sessions, or a restart): a quiet line above the box until it is edited or sent.
  const [restored, setRestored] = useState<ComposerDraft | null>(null);
  /** Something put in the message box from outside (Discard empties it, Edit in Up next brings a message back): each one is a new preset. */
  const [boxPreset, setBoxPreset] = useState<{ text: string; attachments: ImageAttachment[]; seq: number } | null>(null);
  const presetSeq = useRef(0);
  const presetBox = useCallback((text: string, attachments: ImageAttachment[]) => setBoxPreset({ text, attachments, seq: ++presetSeq.current }), []);
  // Claude Code failed before the session started: its first prompt is now the session's unsent message (the drafts
  // store moved it there), and a box that was open already shows it too, ready to start the session again.
  const restarting = restart !== null;
  useEffect(() => {
    if (!restarting) return;
    const kept = useDrafts.getState().drafts[sessionId];
    if (kept?.startIn) presetBox(kept.text, kept.attachments);
  }, [restarting, sessionId]);
  const onDraftLoaded = (draft: ComposerDraft) => setRestored(draft.seeded ? null : draft);
  const onDraftText = useCallback((text: string) => setRestored((current) => (current && draftMessage(current) !== text ? null : current)), []);

  // Fork, edit and rewind from a message.
  const [actionError, setActionError] = useState<string | null>(null);
  const [rewinding, setRewinding] = useState<{ uuid: string; preview: RewindResult | null; error: string | null } | null>(null);
  // The undo dialog opens while it is still checking, before its confirm button exists: give the
  // button focus when it appears, so Enter confirms as in every other confirmation.
  const rewindReady = Boolean(rewinding && !rewinding.error && rewinding.preview?.canRewind && rewinding.preview.files.length > 0);
  useEffect(() => {
    if (!rewindReady) return;
    const frame = requestAnimationFrame(() => {
      const dialog = document.activeElement?.closest('[role="alertdialog"]') ?? null;
      dialog?.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [rewindReady]);
  const messageActions = useMemo<MessageActions | null>(() => {
    if (!client) return null;
    // The message before each one (by uuid), for forking just before a prompt.
    const previous = new Map<string, string>();
    let last: string | null = null;
    for (const item of items) {
      const uuid = messageUuid(item.key);
      if (uuid === last) continue;
      if (last) previous.set(uuid, last);
      last = uuid;
    }
    const fail = (error: unknown) => setActionError(error instanceof Error ? error.message : String(error));
    return {
      fork: (uuid) => void client.call('session.forkAt', { sessionId, messageUuid: uuid }).then((r) => select(r.sessionId), fail),
      edit: (uuid, text) => {
        const before = previous.get(uuid);
        if (!before) return;
        void client.call('session.forkAt', { sessionId, messageUuid: before }).then((r) => {
          useDrafts.getState().seedDraft(r.sessionId, text);
          select(r.sessionId);
        }, fail);
      },
      rewind: (uuid) => {
        setRewinding({ uuid, preview: null, error: null });
        client.call('session.rewind', { sessionId, messageUuid: uuid, dryRun: true }).then(
          (preview) => setRewinding((r) => (r?.uuid === uuid ? { ...r, preview } : r)),
          (error: Error) => setRewinding((r) => (r?.uuid === uuid ? { ...r, error: error.message } : r)),
        );
      },
      canEdit: (uuid) => previous.has(uuid),
      runCommand: cwd ? (command) => void runInTerminal(client, sessionId, cwd, command).catch(fail) : null,
      runAndSend: cwd ? (command) => void runAndSendOutput(client, sessionId, cwd, command).catch(fail) : null,
      remember: (text, from) => usePaletteBus.getState().showDialog({ kind: 'remember', text, from, sessionId, root: projectRoot }),
      savePrompt: (text) => usePaletteBus.getState().showDialog({ kind: 'prompt-editor', editing: null, text, fromMessage: true, root: options.projectActions ? projectRoot : null }),
    };
  }, [client, items, sessionId, select, cwd, projectRoot, options.projectActions]);

  // Quote and Remember this… from a selection or a whole message (right-click, or the buttons over a selection).
  const remember = useRememberLayer({
    container: scrollRef,
    textOf: (key) => {
      const item = items.find((i) => i.key === key);
      return item && (item.kind === 'user' || item.kind === 'text') ? item.text : null;
    },
    onRemember: (text, from) => usePaletteBus.getState().showDialog({ kind: 'remember', text, from, sessionId, root: projectRoot }),
    onQuote: (text) => useDrafts.getState().requestQuote(sessionId, text),
    onSavePrompt: (text) => usePaletteBus.getState().showDialog({ kind: 'prompt-editor', editing: null, text, fromMessage: true, root: options.projectActions ? projectRoot : null }),
  });

  // The command palette's Fork…, Rewind…, Copy last reply: your prompts and Claude's last reply, from the active pane.
  useEffect(() => {
    if (!active) return;
    const prompts: SessionDigest['prompts'] = [];
    let before: string | null = null;
    let lastReply: string | null = null;
    for (const item of items) {
      const uuid = messageUuid(item.key);
      if (isPrompt(item) && uuid !== before) prompts.push({ uuid, text: item.text, at: item.at, before });
      if (item.kind === 'text' && !item.subagent) lastReply = item.text;
      before = uuid;
    }
    usePaletteBus.setState({ digest: { sessionId, prompts, lastUuid: before, lastReply } });
  }, [active, items, sessionId]);
  useEffect(() => () => usePaletteBus.setState((s) => (s.digest?.sessionId === sessionId ? { digest: null } : {})), [sessionId]);
  // Ask about this session: its threads are read once per session, so the panel opens on them at once.
  useEffect(() => {
    if (client) void loadAskThreads(client, sessionId).catch(() => {});
  }, [client, sessionId]);
  const closeAskHere = () => {
    closeAsk(sessionId);
    useDrafts.getState().requestFocus(sessionId);
  };
  const askHere = async (question: string) => {
    if (!client) throw new Error('Not connected to the engine');
    await askAbout(client, sessionId, question);
  };

  // The palette's Switch branch… and Finish worktree… open the header's branch menu; Rewind… asks to undo since a message.
  useSessionRequests(active, (request) => {
    if (request.kind === 'branch-menu') setBranchMenuRequest((n) => n + 1);
    else if (request.kind === 'ask') void openAsk(client, sessionId);
    else if (request.kind === 'rewind' && request.arg) messageActions?.rewind(request.arg);
    else if (request.kind === 'prompt-previous') stepPrompt(-1);
    else if (request.kind === 'prompt-next') stepPrompt(1);
  });

  /**
   * Sends a message (resuming the session when it isn't running here). A message that brings a session
   * back, or a fork, goes through the focus limit's gate; answering a session that already counts never
   * does. `ungated`: finishing work (commit, compact), which the limit never stands in the way of.
   * `mode`: what the message does while Claude is working (queue it, steer, or stop and send now).
   */
  const send = async (text: string, attachments: ImageAttachment[], fork = false, ungated = false, mode?: SendMode): Promise<void | false> => {
    if (!client) throw new Error('Not connected to the engine');
    if (restart) {
      // The engine can't resume a session it has no transcript or folder for: start it again, and show the new one.
      const outcome = await startNewSession(
        { ...restart, prompt: text, attachments, skipGate: ungated },
        { createSession: (params) => client.call('session.create', params), gate: passFocusGate, addProject: async () => {}, keep: useDrafts.getState().keepFirstPrompt, open: select },
      );
      return outcome.kind === 'started' ? undefined : false;
    }
    if (!ungated && (await passFocusGate({ target: fork ? null : sessionId })) !== 'start') return false;
    const sentAt = Date.now();
    const result = await client.call('session.send', { sessionId, text, attachments, fork, ...(mode ? { mode } : {}) });
    if (useCatchUp.getState().replying === sessionId) useCatchUp.getState().setReplying(null);
    // A queued message waits in Up next, so the conversation has nothing new to scroll to. The answer
    // can be well under way by now: if you scrolled up to read it, stay there.
    if (!result.queued && userScrollAt.current < sentAt) follow(true);
    if (result.sessionId !== sessionId) select(result.sessionId);
  };

  // Up next: the messages queued while Claude works. Edit brings one back into the message box. A session that isn't
  // running here (stopped, or from before the app quit) shows what the engine kept, waiting for you.
  const keptUpNext = useUpNext((s) => s.queues.get(sessionId));
  const upNext = activeHost ? activeHost.queue : (keptUpNext ?? []);
  const upNextHold = activeHost ? activeHost.queueHold : upNext.length ? 'saved' : null;
  // The profile is at a usage limit: Up next waits for it rather than sending into it.
  const limitHeld = useLimits((s) => profileId !== null && s.state.limits.some((l) => l.profileId === profileId));
  /** Sending from Up next brings a session that isn't running back, which the focus limit has a say in. */
  const resumeAllowed = async () => Boolean(activeHost) || (await passFocusGate({ target: sessionId })) === 'start';
  const takeBack = async (id: string): Promise<boolean> => {
    if (!client) return false;
    const { message } = await client.call('session.queue.remove', { sessionId, id });
    if (!message) return false;
    const draft = useDrafts.getState().drafts[sessionId];
    const merged = mergeIntoBox({ text: draft?.text ?? '', attachments: draft?.attachments ?? [] }, backInBox(message.text, message.attachments));
    presetBox(merged.text, merged.attachments);
    return true;
  };
  /** A message back in the box: its file mentions become chips again, as they were when it was written. */
  const backInBox = (prompt: string, attachments: ImageAttachment[]) => {
    const { text, context } = contextFromPrompt(prompt, cwd);
    if (context.length) useDrafts.getState().addContext(sessionId, context);
    return { text, attachments };
  };
  const upNextActions: UpNextActions = {
    edit: (message) => void takeBack(message.id).catch((e: Error) => setActionError(`Could not take the message back: ${e.message}`)),
    remove: (message) =>
      void client
        ?.call('session.queue.remove', { sessionId, id: message.id })
        .then(({ message: removed }) => {
          if (!removed) return;
          const at = upNext.findIndex((m) => m.id === message.id);
          toast('Removed from Up next', {
            undo: () => {
              // Still working: back in its place. Otherwise it would go at once, so it returns to the message box instead.
              if (!running) {
                const back = backInBox(removed.text, removed.attachments);
                return presetBox(back.text, back.attachments);
              }
              void client
                .call('session.send', { sessionId, text: removed.text, attachments: removed.attachments, fork: false, mode: 'queue' })
                .then((r) => (r.queued && at > 0 ? client.call('session.queue.move', { sessionId, id: r.messageUuid, toIndex: at }) : undefined))
                .catch(() => {});
            },
          });
        })
        .catch((e: Error) => setActionError(`Could not remove the message: ${e.message}`)),
    sendNow: (message) =>
      void resumeAllowed()
        .then((go) => (go ? client?.call('session.queue.sendNow', { sessionId, id: message.id }) : undefined))
        .catch((e: Error) => setActionError(`Could not send the message: ${e.message}`)),
    move: (id, toIndex) => void client?.call('session.queue.move', { sessionId, id, toIndex }).catch(() => {}),
    resume: () =>
      void resumeAllowed()
        .then((go) => (go ? client?.call('session.queue.resume', { sessionId }) : undefined))
        .catch((e: Error) => setActionError(`Could not send the next message: ${e.message}`)),
  };

  const isWorktree = Boolean(summary?.worktree || (cwd && inWorktree(cwd)));
  // On this checkout the branch button shows the live branch; the transcript's is out of date once you switch.
  const branchButton = Boolean(cwd && isRepo && !isWorktree);
  const branch = summary?.worktree?.branch ?? realBranch(summary?.gitBranch ?? null);
  // The git menu's "Switch branch…" (or, in a worktree, "Merge or remove worktree…") opens the branch's own menu.
  const [branchMenuRequest, setBranchMenuRequest] = useState(0);
  const origin = summary ? ORIGIN_LABEL[summary.origin] : activeHost ? ORIGIN_LABEL.app : registryLive ? ORIGIN_LABEL[registryLive.origin] : '';
  const title = summary?.title ?? registryLive?.name ?? 'New session';
  // What the meta line leaves out, for the title's tooltip.
  const titleTooltip = [
    title,
    cwd && tildify(cwd, home),
    origin && `Started in ${origin}`,
    summary && (shortAge(summary.updatedAt) === 'now' ? 'Updated just now' : `Updated ${shortAge(summary.updatedAt)} ago`),
  ]
    .filter(Boolean)
    .join('\n');
  const projectName = question ? QUESTION_LABEL : (project?.name ?? (projectRoot ? basename(projectRoot) : null));
  const failed = !activeHost && host?.state === 'error';
  const statusLabel = live ? liveLabel(live) : failed ? 'Failed' : 'Not running';
  const statusTone = live ? (live.status === 'idle' && live.background?.length ? 'text-ok' : STATUS_TONE[live.status]) : failed ? 'text-error' : 'text-muted';
  const gitActivity = `${items.length}:${live?.status ?? ''}:${branchSwitches}`;
  const contextLive =
    activeHost && activeHost.contextTokens !== null && activeHost.contextMax
      ? { tokens: activeHost.contextTokens, max: activeHost.contextMax, percent: activeHost.contextPercent ?? (activeHost.contextTokens / activeHost.contextMax) * 100 }
      : null;
  const checkTranscript = () => usePaletteBus.getState().showDialog({ kind: 'transcript-diagnosis', sessionId, title: summary ? title : null });
  // While Claude works here, Enter queues or steers (Settings › Conversation); Send now stops the current turn first.
  const canSendNow = running && Boolean(activeHost);
  const whileWorking = usePreferences((p) => p.prefs.whileWorking);
  const otherMode: SendMode = whileWorking === 'queue' ? 'steer' : 'queue';
  const compact = activeHost ?() => void send('/compact', [], false, true).catch((e: Error) => setActionError(e.message)) : undefined;
  // One element for both docks: below it sits in the conversation's column, on the right next to it.
  const terminalPanel = (
    <Suspense fallback={<div className={`theme-dark shrink-0 bg-terminal ${terminalDock === 'right' ? 'w-90 border-l border-border' : 'h-40 border-t border-border'}`} />}>
      <TerminalPanel
        sessionId={sessionId}
        cwd={cwd}
        projectRoot={options.projectActions ? projectRoot : null}
        home={home}
        dock={terminalDock}
        rightBlocked={terminalBlocked}
        viewWidth={bodyWidth}
        viewHeight={bodyHeight}
        tabs={terminalOnRight && right.tabs ? rightTabs : undefined}
        shared={terminalOnRight && right.tabs ? { width: rightWidth, setWidth: setRightWidth } : undefined}
      />
    </Suspense>
  );

  return (
    // `@container`: the header compacts itself when the pane is narrow (two sessions side by side).
    <div className="@container flex h-full min-h-0 flex-col" data-current-session={sessionId} data-project-root={projectRoot ?? undefined} data-cwd={cwd ?? undefined} data-drop-zone>
      {/* With two panes, the active one has an accent line along the top. */}
      <header
        className={`drag flex h-13 shrink-0 items-center gap-3 overflow-hidden border-b border-border px-6 @max-[860px]:gap-2 @max-[860px]:px-4 ${tiled && active ? 'shadow-[inset_0_2px_0_var(--sb-accent)]' : ''}`}
        data-pane={tiled ? sessionId : undefined}
        data-pane-active={tiled ? active : undefined}
      >
        {/* The sidebar toggle belongs to the window's top left corner: of the panes, only the one there has it. */}
        {leading && !inPopout && <SidebarToggle />}
        {/* A pop-out's traffic lights sit over its header's left end (macOS); elsewhere the window has its own title bar. */}
        {inPopout && currentPlatform() === 'darwin' && <span className="w-11 shrink-0" aria-hidden />}
        {/* In a pane under 400px wide the header has no room for the icon: the title and the buttons come first. */}
        {projectRoot && (
          <span className="flex shrink-0 @max-[400px]:hidden">
            <ProjectIcon project={project} root={projectRoot} size={22} />
          </span>
        )}
        {/* With several panes this is the handle to drag the pane by (useTileDrag); it can't be part of the window's drag region, which takes the mouse. */}
        <div className={`min-w-24 flex-1 @max-[400px]:min-w-16 ${tiled ? 'no-drag cursor-grab select-none' : ''}`} data-pane-handle={tiled ? true : undefined}>
          <h1 className="truncate text-body leading-snug font-semibold" data-tooltip={titleTooltip}>
            {title}
          </h1>
          {/* Status · project · branch. In a narrow pane: the dot and the branch. */}
          <div className="flex min-w-0 items-center gap-1.5 text-meta text-muted" data-session-meta>
            <span className={`flex shrink-0 items-center gap-1.5 ${statusTone}`} data-session-status>
              {live ? <StatusDot live={live} /> : <span className={`inline-block size-2 shrink-0 rounded-full ${failed ? 'bg-error' : 'bg-faint'}`} aria-hidden />}
              <span className="@max-[860px]:sr-only" data-tooltip={failed ? (host?.error ?? undefined) : undefined}>
                {statusLabel}
              </span>
            </span>
            {projectName && (
              <>
                <Sep />
                <span className="min-w-0 shrink truncate @max-[860px]:hidden" data-session-project={question ? 'question' : undefined}>
                  {projectName}
                </span>
              </>
            )}
            {cwd && isWorktree && options.git ? (
              <>
                <Sep />
                <WorktreeMenu sessionId={sessionId} cwd={cwd} branch={branch} openRequest={branchMenuRequest} />
              </>
            ) : cwd && branchButton ? (
              <>
                <Sep />
                <BranchMenu sessionId={sessionId} cwd={cwd} root={projectRoot ?? cwd} busy={working} onSwitched={refreshChanges} openRequest={branchMenuRequest} />
              </>
            ) : (
              options.git &&
              branch && (
                <>
                  <Sep />
                  <span className="flex min-w-0 items-center gap-1">
                    <GitBranch size={11} className="shrink-0" aria-hidden />
                    <span className="truncate">{branch}</span>
                  </span>
                </>
              )
            )}
          </div>
        </div>
        {/* Changes | Ask | Agents | Commands | Terminal: the side panels as one compact, icon-only segmented control. */}
        <SegmentedControl
          mode="toggle"
          label="Panels"
          className="no-drag"
          data-panel-toggles
          pressed={[...(changesOpen ? ['changes' as const] : []), ...(ask.open ? ['ask' as const] : []), ...(agentsState.open ? ['agents' as const] : []), ...(commandsState.open ? ['commands' as const] : []), ...(panelOpen ? ['terminal' as const] : [])]}
          onToggle={(panel) => (panel === 'changes' ? toggleChangesHere() : panel === 'ask' ? toggleAskHere() : panel === 'agents' ? toggleAgentsHere() : panel === 'commands' ? toggleCommandsHere() : toggleTerminalPanel(sessionId))}
          segments={[
            ...(cwd && isRepo
              ? [
                  {
                    value: 'changes' as const,
                    label: 'Changes',
                    icon: <FileDiff size={14} aria-hidden />,
                    iconOnly: true,
                    badge: changedCount,
                    tooltip: `${changesFront === false ? 'Bring changed files to the front' : changesOpen ? 'Hide changed files' : 'Show changed files'} (${formatKeys(keysFor('changes.toggle'))})`,
                    ariaLabel: `${changesFront === false ? 'Bring changed files to the front' : changesOpen ? 'Hide changed files' : 'Show changed files'}${changedCount ? `, ${changedCount} changed` : ''} (${formatKeys(keysFor('changes.toggle'))})`,
                    kbd: keysFor('changes.toggle'),
                    front: changesFront,
                    expanded: changesOpen && changesFront !== false,
                    data: { 'data-toggle-changes': true },
                  },
                ]
              : []),
            {
              value: 'ask' as const,
              label: 'Ask',
              icon: <MessageCircleQuestion size={14} aria-hidden />,
              iconOnly: true,
              // An answer came in while the panel was closed.
              dot: ask.ready && !ask.open ? 'link' : false,
              tooltip: `${askFront === false ? 'Bring Ask to the front' : ask.open ? 'Hide Ask' : 'Ask about this session'}${ask.ready && !ask.open ? ' · An answer is ready' : ''}`,
              ariaLabel: `${askFront === false ? 'Bring Ask to the front' : ask.open ? 'Hide Ask' : 'Ask about this session'}${ask.ready && !ask.open ? ', an answer is ready' : ''}`,
              front: askFront,
              expanded: ask.open && askFront !== false,
              data: { 'data-toggle-ask': true },
            },
            // Only a session that has started agents has this; the panel stays reachable while it is open.
            ...(agents.length > 0 || agentsState.open
              ? [
                  {
                    value: 'agents' as const,
                    label: 'Agents',
                    icon: <Bot size={14} aria-hidden />,
                    iconOnly: true,
                    badge: agentsRunning,
                    tooltip: `${agentsFront === false ? 'Bring agents to the front' : agentsState.open ? 'Hide agents' : 'Show agents'} (${formatKeys(keysFor('agents.toggle'))})${agentsRunning ? ` · ${agentsRunning} running` : ''}`,
                    ariaLabel: `${agentsFront === false ? 'Bring agents to the front' : agentsState.open ? 'Hide agents' : 'Show agents'}${agentsRunning ? `, ${agentsRunning} running` : ''} (${formatKeys(keysFor('agents.toggle'))})`,
                    kbd: keysFor('agents.toggle'),
                    front: agentsFront,
                    expanded: showAgents && agentsFront !== false,
                    data: { 'data-toggle-agents': true },
                  },
                ]
              : []),
            // Only a session that has run background commands has this; the panel stays reachable while it is open.
            ...(backgroundCommands.length > 0 || commandsState.open
              ? [
                  {
                    value: 'commands' as const,
                    label: 'Commands',
                    icon: <ScrollText size={14} aria-hidden />,
                    iconOnly: true,
                    badge: commandsRunning,
                    tooltip: `${commandsFront === false ? 'Bring commands to the front' : commandsState.open ? 'Hide commands' : 'Show background commands'} (${formatKeys(keysFor('commands.toggle'))})${commandsRunning ? ` · ${commandsRunning} running` : ''}`,
                    ariaLabel: `${commandsFront === false ? 'Bring commands to the front' : commandsState.open ? 'Hide commands' : 'Show background commands'}${commandsRunning ? `, ${commandsRunning} running` : ''} (${formatKeys(keysFor('commands.toggle'))})`,
                    kbd: keysFor('commands.toggle'),
                    front: commandsFront,
                    expanded: showCommands && commandsFront !== false,
                    data: { 'data-toggle-commands': true },
                  },
                ]
              : []),
            {
              value: 'terminal' as const,
              label: 'Terminal',
              icon: <SquareTerminal size={14} aria-hidden />,
              iconOnly: true,
              dot: terminalCount > 0,
              tooltip: `${terminalFront === false ? 'Bring the terminal to the front' : panelOpen ? 'Hide terminal' : 'Show terminal'} (${formatKeys(keysFor('terminal.toggle'))})${terminalCount ? ` · ${terminalCount} running` : ''}`,
              ariaLabel: `${terminalFront === false ? 'Bring the terminal to the front' : panelOpen ? 'Hide terminal' : 'Show terminal'}${terminalCount ? `, ${terminalCount} running` : ''} (${formatKeys(keysFor('terminal.toggle'))})`,
              kbd: keysFor('terminal.toggle'),
              front: terminalFront,
              expanded: panelOpen && terminalFront !== false,
              data: { 'data-toggle-terminal': true },
            },
          ]}
        />
        {cwd && isRepo && (
          <GitButton
            sessionId={sessionId}
            cwd={cwd}
            busy={working}
            active={active}
            activity={gitActivity}
            isWorktree={isWorktree}
            projectBase={project?.defaults.branch ?? null}
            onCommit={() => void send('Commit the current changes with a clear, conventional commit message.', [], openElsewhere, true).catch((e: Error) => setActionError(e.message))}
            onBranchMenu={() => setBranchMenuRequest((n) => n + 1)}
            onNewWorktree={() => {
              // New session is the main window's view: from a pop-out it opens there.
              if (showInMain({ kind: 'new-session', cwd: projectRoot ?? cwd, worktree: true })) return;
              useProjects.getState().startIn(projectRoot ?? cwd, { worktree: true });
              useSessions.getState().setView('new');
            }}
          />
        )}
        <ModsChip sessionId={sessionId} profileId={profileId} />
        <MoreMenu
          sessionId={sessionId}
          actions={actionsMenu}
          cwd={cwd}
          agents={{ total: agents.length, running: agentsRunning }}
          onAgents={() => openAgents(sessionId)}
          commands={{ total: backgroundCommands.length, running: commandsRunning }}
          onCommands={() => openCommands(sessionId)}
          profileId={profileId}
          title={summary ? title : null}
          onStop={activeHost ? () => void client?.call('session.close', { sessionId }) : null}
        />
        {!inPopout ? (
          <Button
            variant="quiet"
            iconOnly
            icon={<AppWindow size={15} aria-hidden />}
            data-open-in-new-window
            onClick={() => popOut(sessionId)}
            aria-label="Open in new window"
            shortcut="session.new-window"
            className="no-drag shrink-0 @max-[420px]:hidden"
          />
        ) : (
          <Button
            variant="quiet"
            iconOnly
            icon={<SquareArrowDownLeft size={15} aria-hidden />}
            data-move-to-main-window
            onClick={() => window.switchboard?.popIn()}
            data-tooltip="Move back to main window"
            aria-label="Move back to main window"
            className="no-drag shrink-0"
          />
        )}
        {inPopout && (
          <Button
            variant="quiet"
            iconOnly
            icon={<X size={15} />}
            data-close-window
            onClick={() => window.close()}
            data-tooltip="Close window (the session keeps running)"
            aria-label="Close window"
            className="no-drag shrink-0"
          />
        )}
        {!tiled && !inPopout && (
          <Button
            variant="quiet"
            iconOnly
            icon={<X size={15} />}
            data-close-session
            onClick={() => useSessions.getState().closeSession()}
            data-tooltip="Close session and go Home (it keeps running)"
            aria-label="Close session"
            className="no-drag shrink-0"
          />
        )}
        {tiled && <SplitDirectionControl sessionId={sessionId} />}
        {tiled && (
          <Button
            variant="quiet"
            iconOnly
            icon={<X size={15} />}
            data-close-pane
            onClick={() => useSessions.getState().closePane(sessionId)}
            aria-label="Close this pane"
            shortcut="pane.close"
            className="no-drag shrink-0"
          />
        )}
      </header>

      {/* In a narrow pop-out a panel on the right fills the view (the rule in styles.css), as an expanded Changes does. */}
      <div ref={bodyRef} className="flex min-h-0 flex-1" data-narrow-panel={narrowPanel || undefined}>
        {/* An expanded Changes panel takes the whole view; the conversation stays mounted (scroll position, drafts) but hidden. */}
        <div className={`relative min-w-0 flex-1 flex-col ${narrowPanel || (right.tab === 'changes' && !whyRequest && changesExpanded && !terminalMaximized) || (terminalMaximized && terminalDock === 'right') ? 'hidden' : 'flex'}`}>
          {findQuery !== null && !terminalMaximized && (
            <FindBar
              query={findQuery}
              onQuery={setFindQuery}
              count={matches.length}
              current={findCurrent}
              onStep={stepFind}
              onClose={closeFind}
              focusNonce={findFocus}
            />
          )}
          {catchUp && catchUpShow && !terminalMaximized && (
            <CatchUpSlot
              card={catchUp}
              show={catchUpShow}
              cwd={cwd}
              changes={changes}
              active={active}
              changesOpen={showChanges}
            />
          )}
          <MessageActionsContext.Provider value={messageActions}>
          <PromptExpansionContext.Provider value={promptExpansion}>
          <MessageMenuContext.Provider value={remember.openMenu}>
          <FileLinksProvider cwd={cwd}>
          <TurnMetaContext.Provider value={turnMeta}>
            {/* The conversation, and the prompt outline beside it in the gutter (outside the scroll, so it stays put). */}
            <div className={`relative min-h-0 flex-1 flex-col ${terminalMaximized ? 'hidden' : 'flex'}`} data-transcript-area>
            <div
              ref={scrollRef}
              onScroll={() => (onScroll(), remember.handlers.onScroll())}
              onContextMenu={remember.handlers.onContextMenu}
              onWheel={onWheel}
              onTouchMove={markUserScroll}
              onPointerDown={markUserScroll}
              onKeyDown={onScrollKey}
              role="region"
              aria-label="Conversation"
              className={`min-h-0 flex-1 overflow-y-auto ${terminalMaximized ? 'hidden' : ''}`}
              data-transcript
              // How many items the conversation has: the list is virtualised, so the rows in the DOM are only the ones in view.
              data-transcript-count={renderItems.length}
            >
              {status === 'loading' ? (
                <p className="p-8 text-center text-ui text-muted" role="status">
                  Loading the conversation…
                </p>
              ) : status === 'error' ? (
                <div className="mx-auto max-w-3xl p-6" data-transcript-error>
                  <Notice
                    tone="error"
                    icon={<CircleAlert size={14} aria-hidden />}
                    actions={
                      <>
                        <Button size="sm" onClick={checkTranscript} data-transcript-error-details>
                          Show details
                        </Button>
                        <Button size="sm" variant="quiet" onClick={retryRead}>
                          Try again
                        </Button>
                      </>
                    }
                  >
                    Couldn't read this conversation: {readError}
                  </Notice>
                </div>
              ) : items.length === 0 && !activeHost ? (
                <div className="grid justify-items-center gap-2 p-8 text-center">
                  <p className="text-ui text-muted">This session has no messages yet.</p>
                  {/* An empty view for a session that has a transcript is worth a look. */}
                  {summary && (
                    <Button size="sm" variant="quiet" onClick={checkTranscript} data-transcript-empty-check>
                      Check transcript
                    </Button>
                  )}
                </div>
              ) : (
                <div className="relative mx-auto max-w-3xl px-6" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualizer.getVirtualItems().map((row) => (
                    <div
                      key={row.key}
                      data-index={row.index}
                      data-transcript-item
                      data-item-kind={renderItems[row.index]!.kind}
                      ref={virtualizer.measureElement}
                      className={`absolute inset-x-6 pt-3 ${row.key === highlightKey ? 'search-highlight' : ''} ${row.key === landingKey ? 'prompt-landing' : ''}`}
                      style={{ transform: `translateY(${row.start}px)` }}
                    >
                      {autoPick && row.index === firstAnswer && <AutoPickLine sessionId={sessionId} pick={autoPick} />}
                      <TranscriptItem
                        item={renderItems[row.index]!}
                        cwd={cwd}
                        sessionId={sessionId}
                        active={renderItems[row.index]!.key === activeGroupKey}
                        activeLabel={renderItems[row.index]!.key === activeGroupKey ? activeLabel : null}
                        live={renderItems[row.index]!.key === activeGroupKey ? liveTurnInfo : null}
                      />
                    </div>
                  ))}
                </div>
              )}
              {autoPick && firstAnswer < 0 && renderItems.length > 0 && (
                <div className="mx-auto max-w-3xl px-6 pt-3">
                  <AutoPickLine sessionId={sessionId} pick={autoPick} />
                </div>
              )}
              <div ref={tailRef}>
                <StreamingBlock sessionId={sessionId} since={turnStart} showIndicator={activeGroupKey === null} live={liveTurnInfo} />
              </div>
              {/* Sticks to the bottom of the view while you read further up; takes no room at the end. */}
              {away && (
                <div className="pointer-events-none sticky bottom-3 z-10 h-0">
                  <div className="absolute inset-x-0 bottom-0 flex justify-center">
                    <span className="overlay pointer-events-auto rounded-md">
                      <Button variant="quiet" size="sm" icon={<ArrowDown size={13} aria-hidden />} onClick={jumpToLatest} data-jump-to-latest>
                        {working ? 'New output below' : 'Jump to latest'}
                      </Button>
                    </span>
                  </div>
                </div>
              )}
            </div>
            {showOutline && (
              <PromptOutline prompts={prompts} starts={outlineMeasure.starts} total={outlineMeasure.total} current={currentMark} right={outlineMeasure.gutter} onJump={onOutlineJump} />
            )}
            </div>
          </TurnMetaContext.Provider>
          </FileLinksProvider>
          </MessageMenuContext.Provider>
          </PromptExpansionContext.Provider>
          </MessageActionsContext.Provider>
          {remember.overlay}
          <Announcer sessionId={sessionId} working={working} failed={host?.state === 'error'} permissions={permissions} cwd={cwd} turn={lastTurnRef} />

          {toolsOpen && cwd && <CapabilitiesDialog sessionId={sessionId} cwd={cwd} profileId={profileId} onClose={() => useOverlay.getState().close()} />}
      {rewinding && (
            <ConfirmDialog
              title="Undo file changes since this message?"
              danger
              confirmLabel="Undo changes"
              blockedReason={
                rewinding.error ??
                (!rewinding.preview
                  ? 'Checking what changed…'
                  : !rewinding.preview.canRewind
                    ? (rewinding.preview.error ?? 'Claude Code has no checkpoint for this message.')
                    : rewinding.preview.files.length === 0
                      ? 'Nothing to undo: no files changed after this message.'
                      : null)
              }
              // Still loading, or nothing to undo, isn't something going wrong.
              blockedTone={!rewinding.error && (!rewinding.preview || (rewinding.preview.canRewind && rewinding.preview.files.length === 0)) ? 'info' : 'error'}
              body={
                <>
                  <p>Files go back to how they were before this message. The conversation stays as it is.</p>
                  {rewinding.preview && rewinding.preview.files.length > 0 && (
                    <>
                      <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-meta text-text" data-rewind-files>
                        {rewinding.preview.files.map((file) => (
                          <li key={file} className="truncate">
                            {(cwd && pathInside(file, cwd)) || file}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-meta">
                        <span className="text-ok">+{rewinding.preview.insertions}</span> <span className="text-error">−{rewinding.preview.deletions}</span>
                      </p>
                    </>
                  )}
                </>
              }
              onConfirm={async () => {
                const result = await client!.call('session.rewind', { sessionId, messageUuid: rewinding.uuid, dryRun: false });
                if (!result.canRewind) throw new Error(result.error ?? 'Could not undo the changes');
              }}
              onClose={() => setRewinding(null)}
            />
          )}

          <div className={`shrink-0 border-t border-border bg-bg ${terminalMaximized ? 'hidden' : ''}`}>
            {/* minmax(0,1fr): the column stays as wide as the pane, so long lines truncate instead of pushing it wider. */}
            <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-2 px-6 pt-3 pb-1.5 @max-[860px]:px-4">
              {(actionsMenu.openEditor || showTodos || backgroundTasks.length > 0) && (
                <div className="grid gap-1.5">
                  {/* The project's actions on the left; Claude's task list and its background tasks on the right, as small pills. The task list opens below them. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <ActionPills actions={actionsMenu} />
                    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                      {showTodos && (
                        <Pill
                          tone="muted"
                          selected={todosOpen}
                          icon={<ListTodo size={12} aria-hidden />}
                          onClick={() => useTaskStrip.getState().toggle(sessionId, 'todos')}
                          aria-expanded={todosOpen}
                          aria-controls={todosOpen ? todosId : undefined}
                          data-tooltip={todosOpen ? 'Hide Claude’s task list' : 'Show Claude’s task list'}
                          data-todo-strip
                        >
                          <span className="tabular-nums">
                            Tasks {todos.filter((t) => t.status === 'completed').length} of {todos.length}
                          </span>
                          <ChevronDown size={11} className={`transition-transform ${todosOpen ? 'rotate-180' : ''}`} aria-hidden />
                        </Pill>
                      )}
                      {backgroundTasks.length > 0 && (
                        <Pill
                          tone="ok"
                          shrink
                          selected={backgroundOpen}
                          icon={<LoaderCircle size={11} className="shrink-0 animate-[spin_2s_linear_infinite]" aria-hidden />}
                          onClick={() => useTaskStrip.getState().toggle(sessionId, 'background')}
                          aria-expanded={backgroundOpen}
                          aria-controls={backgroundOpen ? backgroundId : undefined}
                          data-tooltip={backgroundOpen ? 'Hide what runs in the background' : 'Show what runs in the background'}
                          data-status-background
                        >
                          <span className="truncate">{backgroundSummary(backgroundTasks.map((t) => t.type))}</span>
                          <ChevronDown size={11} className={`shrink-0 transition-transform ${backgroundOpen ? 'rotate-180' : ''}`} aria-hidden />
                        </Pill>
                      )}
                    </div>
                  </div>
                  {showTodos && todosOpen && (
                    <div id={todosId} className="max-h-40 overflow-y-auto px-1" data-todo-list>
                      <TodoList todos={todos} compact />
                    </div>
                  )}
                  {backgroundOpen && (
                    <BackgroundTaskList
                      id={backgroundId}
                      tasks={backgroundTasks}
                      onStop={stopTask}
                      agentFor={(task) => agentForTask(task, agents)}
                      onOpenAgent={(run) => openAgents(sessionId, run.item.id)}
                      commandFor={(task) => commandForTask(task, backgroundCommands)}
                      onOpenCommand={(run) => openCommands(sessionId, run.taskId)}
                    />
                  )}
                </div>
              )}
              {/* Long questions scroll inside here, so the window itself never scrolls. */}
              {/* Padding (cancelled by the negative margin) so the cards' pink ring isn't clipped by the scroll box. */}
              {permissions.length > 0 && (
                <div className="-m-1 grid max-h-[55vh] gap-2 overflow-y-auto p-1" data-permissions>
                  {permissions.map((request) => (
                    <PermissionCard key={request.requestId} request={request} cwd={cwd} />
                  ))}
                </div>
              )}
              {/* Mods' bands: under Switchboard's own cards, above Up next. */}
              <ModBands sessionId={sessionId} profileId={profileId} working={running} />
              {openElsewhere && (
                <Notice role="note" data-open-elsewhere>
                  This session is open in {ORIGIN_LABEL[registryLive.origin] || 'another Claude Code window'} right now. Sending here starts a{' '}
                  <strong className="font-medium text-text">fork</strong>: a new session that continues from this conversation, leaving the original untouched.
                </Notice>
              )}
              {actionError && (
                <Notice tone="error" onDismiss={() => setActionError(null)} data-action-error>
                  {actionError}
                </Notice>
              )}
              <AutoSuggestNote sessionId={sessionId} pick={autoPick} items={items} contextTokens={host?.contextTokens ?? null} />
              <LargeContextNotice sessionId={sessionId} live={contextLive} host={host} messages={messages} working={running} onCompact={compact} />
              {autoPick && <AutoPickPopover sessionId={sessionId} pick={autoPick} items={items} cwd={cwd} />}
              {actionsMenu.overlays}
              {restored && (
                <DraftBanner
                  text={sessionDraftBanner(restored, Date.now())}
                  onDiscard={() => {
                    useDrafts.getState().removeDraft(sessionId);
                    setRestored(null);
                    presetBox('', []);
                  }}
                />
              )}
              {profileId && <UsageLimitNotice sessionId={sessionId} profileId={profileId} busy={running || live?.status === 'running' || live?.status === 'needs-you'} held={upNext.length} resumeAllowed={resumeAllowed} />}
              <UpNext queue={upNext} hold={upNextHold} limited={limitHeld} actions={upNextActions} />
              <div className="relative">
                <Composer
                  draftKey={sessionId}
                  savedPrompts={{ root: options.projectActions ? projectRoot : null, projectName: projectName ?? 'This project' }}
                  links={{ sessionId, root: projectRoot }}
                  github={{ root: options.projectActions ? projectRoot : null }}
                  status={<ModFooterChips sessionId={sessionId} profileId={profileId} />}
                  onDraftLoaded={onDraftLoaded}
                  onTextChange={onDraftText}
                  restored={restored !== null}
                  preset={boxPreset ?? undefined}
                  history={promptHistory}
                  cwd={cwd}
                  commands={commands}
                  running={running}
                  placeholder={replying && !running ? replyPlaceholder(title) : running ? (whileWorking === 'queue' ? `Message Claude. It goes in Up next until Claude finishes, or ${formatKeys(keysFor('composer.send-now'))} sends it now.` : `Message Claude. Claude reads it at its next step, or ${formatKeys(keysFor('composer.send-now'))} stops Claude and sends it now.`) : activeHost ? 'Message Claude' : restart ? 'Message Claude to start this session again' : 'Message Claude to resume this session'}
                  submitLabel={openElsewhere ? 'Fork and send' : undefined}
                  dropHint={status === 'ready' && messages.length === 0}
                  disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'The folder for this session is unknown' : null}
                  runningHint={
                    canSendNow
                      ? `${whileWorking === 'queue' ? 'Messages wait in Up next' : 'Messages go to Claude now'} · ${formatKeys(keysFor('composer.send-other'))} to ${otherMode} · ${formatKeys(keysFor('composer.send-now'))} sends now`
                      : undefined
                  }
                  onSubmit={(text, attachments) => send(text, attachments, openElsewhere, false, whileWorking)}
                  secondary={canSendNow ? { shortcut: 'composer.send-now', onSubmit: (text, attachments) => send(text, attachments, false, false, 'now') } : undefined}
                  others={canSendNow ? [{ shortcut: 'composer.send-other', onSubmit: (text, attachments) => send(text, attachments, false, false, otherMode) }] : undefined}
                  onRecallQueued={() => {
                    const last = lastQueued(upNext);
                    if (!last) return false;
                    upNextActions.edit(last);
                    return true;
                  }}
                  submitControl={
                    canSendNow
                      ? (box) => (
                          <QueueButton
                            state={queueButtonState({ ...box, whileWorking })}
                            onAction={(action) => (action === 'send-now' ? box.submitSecondary() : action === whileWorking ? box.submit() : box.submitOther('composer.send-other'))}
                          />
                        )
                      : undefined
                  }
                  onInterrupt={() => void client?.call('session.interrupt', { sessionId })}
                  ask={{ onAsk: askHere, onOpen: () => void openAsk(client, sessionId), open: ask.open, ready: ask.ready }}
                  onEscape={() => {
                    // Esc after Reply leaves the message box and goes back to the catch-up.
                    if (useCatchUp.getState().replying !== sessionId) return false;
                    useCatchUp.getState().setReplying(null);
                    (document.activeElement as HTMLElement | null)?.blur();
                    return true;
                  }}
                  onCycleMode={
                    activeHost ? () => void client?.call('session.setPermissionMode', { sessionId, mode: nextMode(activeHost.permissionMode) }) : undefined
                  }
                  controls={
                    activeHost ? (
                      <SessionControls host={activeHost} />
                    ) : !restart && !registryLive ? (
                      // Not running here: the chips set what the next message resumes it with. The header already says it isn't running.
                      <SavedSessionControls
                        sessionId={sessionId}
                        profileId={profileId}
                        note={
                          host?.state === 'error' && (
                            <span className="min-w-0 shrink truncate px-1.5 text-meta text-error" data-tooltip={host.error ?? undefined} data-session-elsewhere>
                              Last run failed: {host.error}
                            </span>
                          )
                        }
                      />
                    ) : (
                      <span className="min-w-0 truncate px-1.5 text-meta text-muted" data-tooltip={host?.state === 'error' ? (host.error ?? undefined) : undefined} data-session-elsewhere>
                        {host?.state === 'error' ? (
                          <span className="text-error">Last run failed: {host.error}</span>
                        ) : registryLive ? (
                          `Open in ${ORIGIN_LABEL[registryLive.origin] || 'another Claude Code window'}, not in Switchboard.`
                        ) : (
                          'Not running in Switchboard. Send a message to pick it up here.'
                        )}
                      </span>
                    )
                  }
                  meter={foldFooter && <ContextMeter sessionId={sessionId} live={contextLive} messages={messages} onCompact={compact} compact usage={usageLines} />}
                  actions={
                    cwd && (
                      <Button
                        variant="quiet"
                        size="sm"
                        iconOnly
                        icon={<Blocks size={15} aria-hidden />}
                        data-open-tools
                        onClick={() => useOverlay.getState().show('tools')}
                        data-tooltip="Tools: the MCP servers, skills, agents and plugins this session can use"
                        aria-label="Tools: MCP servers, skills, agents and plugins"
                        aria-haspopup="dialog"
                      />
                    )
                  }
                />
              </div>
              {/* One quiet line: plan usage (of the session's profile, which is a chip in the box) and how full the context is. */}
              {!foldFooter && (
                <div className="flex min-h-6 items-center gap-3 px-1 text-meta text-muted" data-session-footer>
                  {/* Its own container: the bars hide when this row is short of room, not when the pane is narrow. */}
                  <div className="@container/meters flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                    <UsageBand profileId={profileId} footer />
                  </div>
                  <SessionCost sessionId={sessionId} profileId={profileId} />
                  <ContextMeter sessionId={sessionId} live={contextLive} messages={messages} onCompact={compact} />
                </div>
              )}
            </div>
          </div>
          {terminalShown && terminalDock === 'bottom' && terminalPanel}
        </div>
        {/* Behind another tab on the right, the terminal steps out; its shells keep running and it comes back as it was. */}
        {terminalShown && terminalDock === 'right' && (!terminalOnRight || right.tab === 'terminal') && terminalPanel}
        {whyRequest && !terminalMaximized && <WhyPanel request={whyRequest} cwd={cwd} />}
        {!whyRequest && right.tab === 'changes' && cwd && !terminalMaximized && (
          <ChangesPanel
            sessionId={sessionId}
            cwd={cwd}
            changes={changes}
            base={changesBase}
            onBase={setChangesBase}
            onRefresh={refreshChanges}
            onClose={() => closeChanges(sessionId)}
            outside={catchUp?.signals.outOfScope}
            tabs={right.tabs ? rightTabs : undefined}
            shared={right.tabs ? { width: rightWidth, setWidth: setRightWidth } : undefined}
          />
        )}
        {!whyRequest && right.tab === 'ask' && !terminalMaximized && (
          <AskPanel
            sessionId={sessionId}
            state={ask}
            working={working}
            width={rightWidth}
            onWidth={setRightWidth}
            tabs={right.tabs ? rightTabs : undefined}
            onAsk={askHere}
            onRetry={(threadId, item) => client && void retryAsk(client, sessionId, threadId, item.id, item.question).catch((e: Error) => setActionError(`Could not ask: ${e.message}`))}
            onQuote={(answer) => useDrafts.getState().requestQuote(sessionId, answer)}
            onNewThread={() => newAskThread(sessionId)}
            onPickThread={(threadId) => pickAskThread(sessionId, threadId)}
            onClose={closeAskHere}
            disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'The folder for this session is unknown' : null}
          />
        )}
        {!whyRequest && frontPane && !terminalMaximized && (
          <ModPanePanel
            key={frontPane.id}
            sessionId={sessionId}
            pane={frontPane}
            width={rightWidth}
            onWidth={setRightWidth}
            tabs={right.tabs ? rightTabs : undefined}
            onClose={() => closeModPane(frontPane.id)}
            focusNonce={paneFocus.id === frontPane.id ? paneFocus.nonce : 0}
          />
        )}
        {!whyRequest && right.tab === 'agents' && !terminalMaximized && (
          <AgentsPanel
            sessionId={sessionId}
            cwd={cwd}
            runs={agents}
            tokens={agentTokens}
            tasks={backgroundTasks}
            picked={agentsState.picked}
            onPick={(agent) => pickAgent(sessionId, agent)}
            onStop={stopTask}
            width={rightWidth}
            onWidth={setRightWidth}
            tabs={right.tabs ? rightTabs : undefined}
            onClose={() => closeAgents(sessionId)}
          />
        )}
        {!whyRequest && right.tab === 'commands' && !terminalMaximized && (
          <CommandsPanel
            sessionId={sessionId}
            runs={backgroundCommands}
            tasks={backgroundTasks}
            picked={commandsState.picked}
            onPick={(taskId) => pickCommand(sessionId, taskId)}
            onStop={stopTask}
            width={rightWidth}
            onWidth={setRightWidth}
            tabs={right.tabs ? rightTabs : undefined}
            onClose={() => closeCommands(sessionId)}
          />
        )}
      </div>
    </div>
  );
}
