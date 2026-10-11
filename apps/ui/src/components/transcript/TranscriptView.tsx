import { useVirtualizer } from '@tanstack/react-virtual';
import { Blocks, ChevronDown, CircleAlert, FileDiff, GitBranch, ListTodo, LoaderCircle, SquareTerminal, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { pathInside, type ChangesBase, type GitChanges, type ImageAttachment, type PermissionRequest, type RewindResult, type SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { clearFindHighlights, rangesIn, setFindHighlights } from '../../lib/findHighlights.ts';
import { basename, guessHome, shortAge, tildify } from '../../lib/format.ts';
import { nextMode } from '../../lib/modes.ts';
import { hostAsLive, isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { passFocusGate } from '../../state/focusGate.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePaletteBus, useSessionRequests, type SessionDigest } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { realBranch, useSessions, type Pane } from '../../state/sessionsStore.ts';
import { runInTerminal, useTerminals } from '../../state/terminalsStore.ts';
import { sessionDraftBanner } from '../../state/drafts.ts';
import { useDrafts, type ComposerDraft } from '../../state/draftsStore.ts';
import { DraftBanner } from '../drafts/DraftBanner.tsx';
// xterm.js is large; it loads the first time a terminal panel opens, not at startup.
const TerminalPanel = lazy(() => import('../terminal/TerminalPanel.tsx').then((m) => ({ default: m.TerminalPanel })));
import { Composer } from '../composer/Composer.tsx';
import { QueueButton } from '../composer/QueueButton.tsx';
import { queueButtonState } from '../composer/queueButton.ts';
import { sessionHistory } from '../composer/promptHistory.ts';
import { ActionPills } from '../actions/ActionPills.tsx';
import { useActionsMenu } from '../actions/useActionsMenu.tsx';
import { CapabilitiesDialog } from '../capabilities/CapabilitiesDialog.tsx';
import { ChangesPanel, useChangesLayout } from '../changes/ChangesPanel.tsx';
import { ContextMeter } from '../session/ContextMeter.tsx';
import { effectiveDock, rightBlocked } from '../terminal/terminalLayout.ts';
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
import { PermissionCard, permissionTitle } from '../session/PermissionCard.tsx';
import { MoreMenu } from '../session/MoreMenu.tsx';
import { SessionControls } from '../session/StatusBar.tsx';
import { UsageBand, useUsageLines } from '../UsageBand.tsx';
import { liveLabel, StatusDot } from '../StatusDot.tsx';
import { formatDuration, useTicker, WorkingDots } from './ActivityGroup.tsx';
import { BackgroundTaskList } from './BackgroundTaskList.tsx';
import { backgroundSummary } from './backgroundTasks.ts';
import { PromptExpansionContext, type PromptExpansion } from './ClampedPrompt.tsx';
import { buildDisplayItems, groupActivity, type RenderItem } from './displayItems.ts';
import { FindBar } from './FindBar.tsx';
import { findMatches, searchableText, startMatch } from './findInSession.ts';
import { FileLinksProvider } from './FileLink.tsx';
import { StreamingMarkdown } from './Markdown.tsx';
import { MessageActionsContext, messageUuid, type MessageActions } from './messageActions.tsx';
import { parseTodos, TodoList } from './TodoList.tsx';
import { TranscriptItem } from './TranscriptItem.tsx';
import { useTranscript } from './useTranscript.ts';
import { formatKeys, keysFor, matches as isShortcut } from '../../lib/shortcuts.ts';

const ORIGIN_LABEL = { cli: 'Terminal', desktop: 'Claude desktop', ide: 'IDE', sdk: 'SDK', app: 'Switchboard', unknown: '' } as const;

/**
 * The status word in the header's meta line takes the colour of its state: yellow while working,
 * pink when it needs you, green only while background tasks run. Idle is quiet, like the rest of the line.
 */
const STATUS_TONE = { running: 'text-accent-ink', 'needs-you': 'text-warn', idle: 'text-muted' } as const;


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
function StreamingBlock({ sessionId, since, showIndicator }: { sessionId: string; since: number | null; showIndicator: boolean }) {
  const block = useHosts((s) => s.streaming.get(sessionId));
  const running = useHosts((s) => s.hosts.get(sessionId)?.state === 'running');
  const now = useTicker(running && showIndicator && block?.kind !== 'text');
  if (block?.kind === 'text') {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming>
        <StreamingMarkdown text={block.text} />
        <span className="mt-0.5 block h-3.5 w-1.5 animate-pulse bg-accent-ink" aria-hidden />
      </div>
    );
  }
  if (!running || !showIndicator) return null;
  const label = block?.kind === 'tool' ? `Using ${block.text}` : block?.kind === 'thinking' ? 'Thinking' : 'Working';
  return (
    <div className="mx-auto max-w-3xl px-6 pt-3 pb-2" data-streaming>
      <p className="flex min-w-0 items-center gap-2 text-ui text-muted">
        <span className="flex w-4 shrink-0 justify-center">
          <WorkingDots />
        </span>
        {since !== null && <span className="shrink-0 text-faint tabular-nums">{formatDuration(now - since)} ·</span>}
        <span className="shrink-0">{label}</span>
        {block?.kind === 'thinking' && block.text && <span className="min-w-0 truncate text-faint italic">{block.text.slice(-160)}</span>}
      </p>
    </div>
  );
}

/**
 * A polite screen-reader announcement when Claude finishes a turn or needs you to answer something.
 * The transcript itself is not a live region: streamed text and rows the list mounts while you
 * scroll would be read out non-stop.
 */
function Announcer({ sessionId, working, failed, permissions, cwd }: { sessionId: string; working: boolean; failed: boolean; permissions: PermissionRequest[]; cwd: string | null }) {
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
    if (was.sessionId === sessionId && was.working && !working) say(failed ? 'Claude stopped with an error.' : 'Claude finished.');
  }, [sessionId, working, failed]);
  return (
    <p className="sr-only" role="status" aria-live="polite" data-announcer>
      {message}
    </p>
  );
}

/**
 * The checkout's git changes, refreshed when the session does something (debounced),
 * when the window comes back into focus, and on request. `isRepo` is false outside git.
 */
function useGitChanges(cwd: string | null, base: ChangesBase, activity: string) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [isRepo, setIsRepo] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.call('git.changes', { cwd, base }).then(
        (result) => !cancelled && (setChanges(result), setIsRepo(true)),
        () => !cancelled && (setChanges(null), setIsRepo(false)),
      );
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, cwd, base, activity, version]);
  useEffect(() => {
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  return { changes, isRepo, refresh: () => setVersion((v) => v + 1) };
}

/** An element's width, following resizes (null until it has been measured). */
function useWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** A session: live transcript, plus composer and controls when it can run here. */
export function TranscriptView({ sessionId, pane = null, active = true }: { sessionId: string; pane?: Pane | null; active?: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const summary = useSessions((s) => s.sessions.get(sessionId) ?? null);
  const registryLive = useSessions((s) => s.live.get(sessionId) ?? null);
  const select = useSessions((s) => s.select);
  const host = useHosts((s) => s.hosts.get(sessionId));
  const permissionMap = useHosts((s) => s.permissions);
  const commandsVersion = useHosts((s) => s.commandsVersion);
  const permissions = useMemo(() => [...permissionMap.values()].filter((p) => p.sessionId === sessionId), [permissionMap, sessionId]);
  const home = useSessions((s) => guessHome([...s.sessions.values()].slice(0, 20).flatMap((x) => (x.cwd ? [x.cwd] : []))));
  const { status, messages, error: readError, retry: retryRead } = useTranscript(sessionId);
  // The terminal panel belongs to this session's view: another session doesn't show it.
  const panelOpen = useTerminals((s) => s.openFor.has(sessionId));
  const togglePanel = useTerminals((s) => s.togglePanel);
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
  /** Your earlier messages here, for ↑ in the message box. */
  const promptHistory = useMemo(() => sessionHistory(items), [items]);
  const toolActivity = usePreferences((s) => s.prefs.toolActivity);
  const renderItems = useMemo<RenderItem[]>(() => (toolActivity === 'summary' ? groupActivity(items) : items), [items, toolActivity]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);

  const projectRoot = summary?.projectRoot ?? registryLive?.projectRoot ?? null;
  const project = useProjects((s) => (projectRoot ? s.projects.get(projectRoot) : undefined));

  // Looking at a session marks it read, also while new output keeps arriving.
  const unread = summary?.unread ?? false;
  useEffect(() => {
    if (!client || !unread) return;
    const timer = setTimeout(() => void client.call('sessions.markViewed', { sessionId }).catch(() => {}), 600);
    return () => clearTimeout(timer);
  }, [client, sessionId, unread, summary?.updatedAt]);

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
  const [openStrip, setOpenStrip] = useState<'todos' | 'background' | null>(null);
  const todosOpen = openStrip === 'todos';
  const todosId = useId();
  const backgroundId = useId();

  const activeHost = isActiveHost(host) ? host : null;
  const live = activeHost ? hostAsLive(activeHost) : registryLive;
  const openElsewhere = !activeHost && registryLive !== null;
  const cwd = activeHost?.cwd ?? summary?.cwd ?? registryLive?.cwd ?? null;
  /** A quick question: no project actions, and no git (nothing to diff, commit or branch). The terminal still opens, in its folder. */
  const question = useProjects((s) => isQuestionsFolder(projectRoot ?? cwd, s.questionsDir));
  const options = sessionOptions(question);
  const running = activeHost?.state === 'running' || activeHost?.state === 'needs-you';
  const showTodos = todos.some((t) => t.status !== 'completed') && (live !== null || activeHost !== null);
  const backgroundTasks = activeHost?.backgroundTasks ?? [];
  const backgroundOpen = openStrip === 'background' && backgroundTasks.length > 0;
  /** The Claude profile (account) the session bills to. */
  const profileId = activeHost?.profileId ?? summary?.profileId ?? registryLive?.profileId ?? null;
  // Project actions: called once here (it listens for their shortcuts and owns their dialogs), then
  // shared by the pills above the message box and the header's ⋯ menu.
  const actionsMenu = useActionsMenu({ sessionId, projectRoot: options.projectActions ? projectRoot : null, cwd, active });

  // The Changes panel (⌘⇧D): the checkout's git diff, with stage and revert.
  const changesOpen = useOverlay((s) => s.changesOpen);
  // With two panes, panels and dialogs belong to the active one.
  const toolsOpen = useOverlay((s) => s.open === 'tools') && active;
  const toggleChanges = useOverlay((s) => s.toggleChanges);
  const [changesBase, setChangesBase] = useState<ChangesBase>('uncommitted');
  // A branch switch (here or in another pane on the same checkout) changes what the panel shows.
  const branchSwitches = useCheckoutBranches((s) => s.switches);
  const { changes, isRepo: inRepo, refresh: refreshChanges } = useGitChanges(options.git ? cwd : null, changesBase, `${items.length}:${live?.status ?? ''}:${branchSwitches}`);
  const isRepo = options.git && inRepo;
  // The badge on the Changes button counts uncommitted files only (the panel can compare with a branch too).
  const changedCount = changesBase === 'uncommitted' && changes ? changes.files.length : 0;
  const showChanges = Boolean(changesOpen && active && cwd && isRepo);
  const changesExpanded = useChangesLayout((s) => s.expanded);
  // The terminal docks below or on the right; the right side goes to Changes when both want it. Maximized, it
  // takes the whole view: the conversation (and Changes) stay mounted but hidden.
  // Each pane shows its own session's terminal, so with two panes both can have one.
  const terminalShown = panelOpen;
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyWidth = useWidth(bodyRef);
  const terminalBlocked = rightBlocked(showChanges, bodyWidth);
  const terminalDock = effectiveDock(useTerminals((s) => s.dock), terminalBlocked);
  const terminalMaximized = useTerminals((s) => s.maximizedFor.has(sessionId)) && terminalShown;
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
        toggleChanges();
      }
      // ⌘F finds in this conversation (the terminal keeps its own keys).
      if (active && isShortcut(event, 'find') && !(event.target as HTMLElement | null)?.closest?.('.xterm')) {
        event.preventDefault();
        setFindQuery((q) => q ?? '');
        setFindFocus((n) => n + 1);
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
  // Following the end stops only when *you* scroll away (wheel, trackpad, keys, scrollbar): the
  // list also moves itself while rows are measured, and that must never count as leaving.
  // Getting back near the end, by any means, follows again.
  const stickToBottom = useRef(true);
  const userScrollAt = useRef(0);
  const markUserScroll = () => (userScrollAt.current = Date.now());
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) stickToBottom.current = true;
    else if (Date.now() - userScrollAt.current < 1_000) stickToBottom.current = false;
    // Rows mount and unmount while scrolling; their matches need highlighting again.
    if (findQuery !== null) schedulePaint();
  };
  const onScrollKey = (event: { key: string }) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markUserScroll();
  };
  const streamingText = useHosts((s) => s.streaming.get(sessionId)?.text.length ?? 0);
  // Rows start at an estimated height and grow once measured, so follow the total size too:
  // otherwise the first jump lands short of the end and the last message sits under the composer.
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current && renderItems.length > 0) {
      virtualizer.scrollToIndex(renderItems.length - 1, { align: 'end' });
      requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    }
  }, [renderItems.length, totalSize, streamingText, permissions.length, virtualizer]);
  // The view shrinks when the message box grows (a long prompt, an attachment, a permission card),
  // and the browser keeps scrollTop without a scroll event, so the last lines slide under the box.
  // Following the end again on every height change keeps them in sight.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastHeight = el.clientHeight;
    const observer = new ResizeObserver(() => {
      const height = el.clientHeight;
      if (height === lastHeight) return;
      lastHeight = height;
      if (stickToBottom.current && height > 0) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Search opened this session at a message: scroll there once it's loaded, and highlight it briefly.
  const focusMessage = useOverlay((s) => (s.focusMessage?.sessionId === sessionId ? s.focusMessage.messageUuid : null));
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  useEffect(() => {
    if (!focusMessage) return;
    const index = renderItems.findIndex((item) =>
      item.kind === 'activity' ? item.items.some((i) => messageUuid(i.key) === focusMessage) : messageUuid(item.key) === focusMessage,
    );
    if (index === -1) return;
    stickToBottom.current = false;
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
      stickToBottom.current = false;
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
  /** Discard empties the box: each one is a new preset. */
  const [discards, setDiscards] = useState(0);
  const onDraftLoaded = (draft: ComposerDraft) => setRestored(draft.seeded ? null : draft);
  const onDraftText = useCallback((text: string) => setRestored((current) => (current && current.text !== text ? null : current)), []);

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
    };
  }, [client, items, sessionId, select, cwd]);

  // The command palette's Fork…, Rewind…, Copy last reply: your prompts and Claude's last reply, from the active pane.
  useEffect(() => {
    if (!active) return;
    const prompts: SessionDigest['prompts'] = [];
    let before: string | null = null;
    let lastReply: string | null = null;
    for (const item of items) {
      const uuid = messageUuid(item.key);
      if (item.kind === 'user' && !item.subagent && uuid !== before) prompts.push({ uuid, text: item.text, at: item.at, before });
      if (item.kind === 'text' && !item.subagent) lastReply = item.text;
      before = uuid;
    }
    usePaletteBus.setState({ digest: { sessionId, prompts, lastUuid: before, lastReply } });
  }, [active, items, sessionId]);
  useEffect(() => () => usePaletteBus.setState((s) => (s.digest?.sessionId === sessionId ? { digest: null } : {})), [sessionId]);
  // The palette's Switch branch… and Finish worktree… open the header's branch menu; Rewind… asks to undo since a message.
  useSessionRequests(active, (request) => {
    if (request.kind === 'branch-menu') setBranchMenuRequest((n) => n + 1);
    else if (request.kind === 'rewind' && request.arg) messageActions?.rewind(request.arg);
  });

  /**
   * Sends a message (resuming the session when it isn't running here). A message that brings a session
   * back, or a fork, goes through the focus limit's gate; answering a session that already counts never
   * does. `ungated`: finishing work (commit, compact), which the limit never stands in the way of.
   */
  const send = async (text: string, attachments: ImageAttachment[], fork = false, ungated = false, now = false): Promise<void | false> => {
    if (!client) throw new Error('Not connected to the engine');
    if (!ungated && (await passFocusGate({ target: fork ? null : sessionId })) !== 'start') return false;
    stickToBottom.current = true;
    const result = await client.call('session.send', { sessionId, text, attachments, fork, now });
    if (result.sessionId !== sessionId) select(result.sessionId);
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
  // While Claude works here, a message can skip the wait: Send now stops the current turn first.
  const canSendNow = running && Boolean(activeHost);
  const compact = activeHost ?() => void send('/compact', [], false, true).catch((e: Error) => setActionError(e.message)) : undefined;
  // One element for both docks: below it sits in the conversation's column, on the right next to it.
  const terminalPanel = (
    <Suspense fallback={<div className={`theme-dark shrink-0 bg-terminal ${terminalDock === 'right' ? 'w-90 border-l border-border' : 'h-40 border-t border-border'}`} />}>
      <TerminalPanel sessionId={sessionId} cwd={cwd} projectRoot={options.projectActions ? projectRoot : null} home={home} dock={terminalDock} rightBlocked={terminalBlocked} viewWidth={bodyWidth} />
    </Suspense>
  );

  return (
    // `@container`: the header compacts itself when the pane is narrow (two sessions side by side).
    <div className="@container flex h-full min-h-0 flex-col" data-current-session={sessionId} data-project-root={projectRoot ?? undefined} data-cwd={cwd ?? undefined} data-drop-zone>
      {/* With two panes, the active one has an accent line along the top. */}
      <header
        className={`drag flex h-13 shrink-0 items-center gap-3 overflow-hidden border-b border-border px-6 @max-[860px]:gap-2 @max-[860px]:px-4 ${pane && active ? 'shadow-[inset_0_2px_0_var(--sb-accent)]' : ''}`}
        data-pane={pane ?? undefined}
        data-pane-active={pane ? active : undefined}
      >
        {/* The sidebar toggle belongs to the window's left edge: in split view, only the left pane has it. */}
        {pane !== 'split' && <SidebarToggle />}
        {projectRoot && <ProjectIcon project={project} root={projectRoot} size={22} />}
        <div className="min-w-24 flex-1">
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
        {/* Changes | Terminal: the two side panels as one compact, icon-only segmented control. */}
        <SegmentedControl
          mode="toggle"
          label="Panels"
          className="no-drag"
          data-panel-toggles
          pressed={[...(changesOpen ? ['changes' as const] : []), ...(panelOpen ? ['terminal' as const] : [])]}
          onToggle={(panel) => (panel === 'changes' ? toggleChanges() : togglePanel(sessionId))}
          segments={[
            ...(cwd && isRepo
              ? [
                  {
                    value: 'changes' as const,
                    label: 'Changes',
                    icon: <FileDiff size={14} aria-hidden />,
                    iconOnly: true,
                    badge: changedCount,
                    tooltip: `${changesOpen ? 'Hide' : 'Show'} changed files (${formatKeys(keysFor('changes.toggle'))})`,
                    ariaLabel: `${changesOpen ? 'Hide' : 'Show'} changed files${changedCount ? `, ${changedCount} changed` : ''} (${formatKeys(keysFor('changes.toggle'))})`,
                    kbd: keysFor('changes.toggle'),
                    expanded: changesOpen && active,
                    data: { 'data-toggle-changes': true },
                  },
                ]
              : []),
            {
              value: 'terminal' as const,
              label: 'Terminal',
              icon: <SquareTerminal size={14} aria-hidden />,
              iconOnly: true,
              dot: terminalCount > 0,
              tooltip: `${panelOpen ? 'Hide' : 'Show'} terminal (${formatKeys(keysFor('terminal.toggle'))})${terminalCount ? ` · ${terminalCount} running` : ''}`,
              ariaLabel: `${panelOpen ? 'Hide' : 'Show'} terminal${terminalCount ? `, ${terminalCount} running` : ''} (${formatKeys(keysFor('terminal.toggle'))})`,
              kbd: keysFor('terminal.toggle'),
              expanded: panelOpen,
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
            onCommit={() => void send('Commit the current changes with a clear, conventional commit message.', [], openElsewhere, true).catch((e: Error) => setActionError(e.message))}
            onBranchMenu={() => setBranchMenuRequest((n) => n + 1)}
            onNewWorktree={() => {
              useProjects.getState().startIn(projectRoot ?? cwd, { worktree: true });
              useSessions.getState().setView('new');
            }}
          />
        )}
        <MoreMenu
          sessionId={sessionId}
          actions={actionsMenu}
          cwd={cwd}
          items={items}
          sessionOpen={live !== null}
          profileId={profileId}
          title={summary ? title : null}
          onStop={activeHost ? () => void client?.call('session.close', { sessionId }) : null}
        />
        {!pane && (
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
        {pane && (
          <Button
            variant="quiet"
            iconOnly
            icon={<X size={15} />}
            data-close-pane
            onClick={() => useSessions.getState().closePane(pane)}
            // Braces, because a plain JSX attribute string keeps both backslashes of `\\`.
            data-tooltip={`Close this pane (${formatKeys(keysFor('pane.close-other'))} closes the other one)`}
            aria-label="Close this pane"
            className="no-drag shrink-0"
          />
        )}
      </header>

      <div ref={bodyRef} className="flex min-h-0 flex-1">
        {/* An expanded Changes panel takes the whole view; the conversation stays mounted (scroll position, drafts) but hidden. */}
        <div className={`relative min-w-0 flex-1 flex-col ${(showChanges && changesExpanded && !terminalMaximized) || (terminalMaximized && terminalDock === 'right') ? 'hidden' : 'flex'}`}>
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
          <MessageActionsContext.Provider value={messageActions}>
          <PromptExpansionContext.Provider value={promptExpansion}>
          <FileLinksProvider cwd={cwd}>
            <div
              ref={scrollRef}
              onScroll={onScroll}
              onWheel={markUserScroll}
              onTouchMove={markUserScroll}
              onPointerDown={markUserScroll}
              onKeyDown={onScrollKey}
              role="region"
              aria-label="Conversation"
              className={`min-h-0 flex-1 overflow-y-auto ${terminalMaximized ? 'hidden' : ''}`}
              data-transcript
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
                      className={`absolute inset-x-6 pt-3 ${row.key === highlightKey ? 'search-highlight' : ''}`}
                      style={{ transform: `translateY(${row.start}px)` }}
                    >
                      <TranscriptItem
                        item={renderItems[row.index]!}
                        cwd={cwd}
                        sessionId={sessionId}
                        active={renderItems[row.index]!.key === activeGroupKey}
                        activeLabel={renderItems[row.index]!.key === activeGroupKey ? activeLabel : null}
                      />
                    </div>
                  ))}
                </div>
              )}
              <StreamingBlock sessionId={sessionId} since={turnStart} showIndicator={activeGroupKey === null} />
            </div>
          </FileLinksProvider>
          </PromptExpansionContext.Provider>
          </MessageActionsContext.Provider>
          <Announcer sessionId={sessionId} working={working} failed={host?.state === 'error'} permissions={permissions} cwd={cwd} />

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
                          onClick={() => setOpenStrip((o) => (o === 'todos' ? null : 'todos'))}
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
                          onClick={() => setOpenStrip((o) => (o === 'background' ? null : 'background'))}
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
                      onStop={async (taskId) => {
                        try {
                          await client!.call('session.stopTask', { sessionId, taskId });
                        } catch (error) {
                          setActionError(`Could not stop the task: ${(error as Error).message}`);
                          throw error;
                        }
                      }}
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
              {actionsMenu.overlays}
              {restored && (
                <DraftBanner
                  text={sessionDraftBanner(restored, Date.now())}
                  onDiscard={() => {
                    useDrafts.getState().removeDraft(sessionId);
                    setRestored(null);
                    setDiscards((n) => n + 1);
                  }}
                />
              )}
              <Composer
                draftKey={sessionId}
                onDraftLoaded={onDraftLoaded}
                onTextChange={onDraftText}
                restored={restored !== null}
                preset={discards ? { text: '', attachments: [], seq: discards } : undefined}
                history={promptHistory}
                cwd={cwd}
                commands={commands}
                running={running}
                placeholder={running ? `Message Claude. It waits until Claude finishes, or ${formatKeys(keysFor('composer.send-now'))} sends it now.` : activeHost ? 'Message Claude' : 'Message Claude to resume this session'}
                submitLabel={openElsewhere ? 'Fork and send' : undefined}
                dropHint={status === 'ready' && messages.length === 0}
                disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'The folder for this session is unknown' : null}
                onSubmit={(text, attachments) => send(text, attachments, openElsewhere)}
                secondary={canSendNow ? { shortcut: 'composer.send-now', onSubmit: (text, attachments) => send(text, attachments, false, false, true) } : undefined}
                submitControl={
                  canSendNow
                    ? (box) => <QueueButton state={queueButtonState(box)} onAction={(action) => (action === 'send-now' ? box.submitSecondary() : box.submit())} />
                    : undefined
                }
                onInterrupt={() => void client?.call('session.interrupt', { sessionId })}
                onCycleMode={
                  activeHost ? () => void client?.call('session.setPermissionMode', { sessionId, mode: nextMode(activeHost.permissionMode) }) : undefined
                }
                controls={
                  activeHost ? (
                    <SessionControls host={activeHost} />
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
              {/* One quiet line: plan usage (of the session's profile, which is a chip in the box) and how full the context is. */}
              {!foldFooter && (
                <div className="flex min-h-6 items-center gap-3 px-1 text-meta text-muted" data-session-footer>
                  {/* Its own container: the bars hide when this row is short of room, not when the pane is narrow. */}
                  <div className="@container/meters flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                    <UsageBand profileId={profileId} footer />
                  </div>
                  <ContextMeter sessionId={sessionId} live={contextLive} messages={messages} onCompact={compact} />
                </div>
              )}
            </div>
          </div>
          {terminalShown && terminalDock === 'bottom' && terminalPanel}
        </div>
        {terminalShown && terminalDock === 'right' && terminalPanel}
        {showChanges && cwd && !terminalMaximized && (
          <ChangesPanel cwd={cwd} changes={changes} base={changesBase} onBase={setChangesBase} onRefresh={refreshChanges} onClose={() => toggleChanges(false)} />
        )}
      </div>
    </div>
  );
}
