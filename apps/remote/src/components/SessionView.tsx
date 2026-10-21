import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, FileDiff, LoaderCircle, MessageCircleQuestion, Send, Square, X } from 'lucide-react';
import { PARENT_PLACEHOLDER, REMOTE_FEATURE_PIPELINES, replyToStepPlaceholder, waitsOnStep, type CatchUp, type QueuedMessage, type RemoteLimitStanding, type RemoteFile, type RemoteImage, type RemoteMessage, type RemoteOptions, type RemoteSessions, type SendMode } from '@switchboard/protocol/remote-client';
import { backgroundLine, inBackground } from '../lib/background.ts';
import { runsOf } from '../lib/runs.ts';
import { RunBar, RunPipelineSheet, RunSheet } from './RunParts.tsx';
import { commitTitle, showsCatchUp } from '../lib/catchUp.ts';
import { clearDraft, loadDraft, saveDraft, type DraftKey } from '../lib/drafts.ts';
import { transcriptItems } from '../lib/steps.ts';
import { appendMessages, applyStream, applyUpdate, NOT_STREAMING, prependMessages, resultsByCall, type Streaming } from '../lib/transcript.ts';
import type { Client } from './Connected.tsx';
import { ItemView } from './MessageView.tsx';
import { StreamingMarkdown } from './Markdown.tsx';
import { formatDuration, turnStart, workingLabel } from '../lib/working.ts';
import { turnEnds, turnLine } from '../lib/turns.ts';
import { answer } from './answer.ts';
import { CatchUpCard } from './CatchUpCard.tsx';
import { ChangesSheet, CommitSheet, type ChangesState } from './ChangesSheet.tsx';
import { useNow } from './SessionList.tsx';
import { AnchoredMenu, MenuButton, type MenuItem } from './Menu.tsx';
import { EffortChip, ModeChip, ModelChip } from './OptionChips.tsx';
import { DockedPrompt } from './PermissionCard.tsx';
import { toast } from './Toasts.tsx';
import { useFinePointer, useMedia } from '../lib/media.ts';
import { useVisualViewport } from './useVisualViewport.ts';
import { AttachButton, AttachmentTray, useAttachments } from './Attachments.tsx';
import { autoFace, MODE_DOT, MODE_SHORT, modelLabel, PROFILE_DOT, takesEffort } from '../lib/options.ts';
import { ChangesPanel, panelWasOpen, rememberPanel } from './ChangesPanel.tsx';
import { AskPanel, AskSheet } from './AskPanel.tsx';
import { BackgroundTasks } from './BackgroundTasks.tsx';
import { LimitNotice } from './LimitNotice.tsx';
import { closeAsk, openAsk, useSessionAsk } from './askStore.ts';
import { withQuote } from '../lib/ask.ts';
import { SEND_MODES, SEND_MODES_NOTE, sendKey } from '../lib/sendMode.ts';
import { keys, MAC } from '../lib/platform.ts';
import { Button, ComputerTag, STATUS_LABEL, StatusDot } from './ui.tsx';

const PAGE = 50;

/** What goes in the message box: Ask Claude to fix… replaces what is there, Quote in message adds to it. */
type Fill = { text: string; id: number; quote?: boolean };

/** The connection dropped while it was asked: the banner says so, not an error line. */
const lostConnection = (error: unknown) => (error as { code?: string }).code === 'DISCONNECTED';

/**
 * One session: its conversation (the last page, older pages on request, live updates), what Claude is writing, the
 * prompts it waits on (docked above the message box), Up next and the message box. A finished session starts with its
 * catch-up, the conversation folded under it. After a reconnect it resumes after the last message it has.
 */
export function SessionView({
  client,
  features,
  sessionId,
  sessions,
  banner,
  lead,
  onLeave,
  onRefresh,
  wide = false,
  initialChanges = false,
  computerName,
  onOpenSession,
}: {
  client: Client;
  /** What the computer takes beyond what every version does (its hello). */
  features: readonly string[];
  sessionId: string;
  sessions: RemoteSessions;
  banner: ReactNode;
  /** In the header's left corner: the drawer button on a phone, the sidebar's toggle where it can fold. */
  lead: ReactNode;
  /** Back to the list (after Archive): the back gesture on a phone, the empty view on a wide screen. */
  onLeave: () => void;
  onRefresh: () => void;
  /** A wide screen: the header has the model and mode, Changes and Stop, and the prompt's buttons show their keys. */
  wide?: boolean;
  /** Opened from a card's Changes: Changes open from the start. */
  initialChanges?: boolean;
  /** The computer it runs on, with more than one paired: the header says it. */
  computerName?: string | undefined;
  /** Opens another session (or run row) of this computer: a pipeline run's parent or one of its steps. */
  onOpenSession?: (sessionId: string) => void;
}) {
  const session = sessions.sessions.find((s) => s.id === sessionId) ?? null;
  // Pipelines (#179): the run this session started, or the run and step it is a sub-session of.
  const takesPipelines = features.includes(REMOTE_FEATURE_PIPELINES);
  const runs = runsOf(sessions, sessionId);
  const runState = runs.parent ?? runs.step?.state ?? null;
  const [runSheet, setRunSheet] = useState(false);
  const [pipelineSheet, setPipelineSheet] = useState(false);
  const listed = new Set(sessions.sessions.map((s) => s.id));
  const runParentId = runs.step && !runs.parent ? (runs.step.state.run.parentSessionId ?? runs.step.state.run.id) : null;
  const canOpenParent = runParentId !== null && (listed.has(runParentId) || runs.step?.state.run.parentSessionId === null);
  const stepName = runs.step ? runs.step.state.run.pipeline.steps[runs.step.index]?.name : undefined;
  const idlePlaceholder = runs.parent ? PARENT_PLACEHOLDER : runs.step && waitsOnStep(runs.step.state, runs.step.index, runs.step.round) ? replyToStepPlaceholder(stepName ?? 'the step') : undefined;
  const prompts = sessions.prompts.filter((p) => p.sessionId === sessionId);
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [streaming, setStreaming] = useState<Streaming>(NOT_STREAMING);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  /** How the session stands with its profile's usage limit; null while it isn't at one. */
  const [limit, setLimit] = useState<RemoteLimitStanding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const [changes, setChanges] = useState<ChangesState | null>(null);
  const ask = useSessionAsk(sessionId);
  /** At 1280px and wider Changes is a panel on the right (remembered in this browser); below that, a sheet. */
  const panelFits = useMedia('(min-width: 1280px)') && wide;
  const [panel, setPanel] = useState(() => (initialChanges || panelWasOpen()));
  /** Ask takes the right side while it is open; Changes comes back when it closes. */
  const panelOpen = panelFits && panel && !ask.open;
  const [sheet, setSheet] = useState<'changes' | 'commit' | null>(() => (initialChanges && !(wide && window.matchMedia('(min-width: 1280px)').matches) ? 'changes' : null));
  const [unfolded, setUnfolded] = useState(false);
  /** The turn committed from here, so its card says Committed. */
  const [committed, setCommitted] = useState<string | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [options, setOptions] = useState<RemoteOptions | null>(null);
  const now = useNow();
  /** The message box has focus on a touch screen: the keyboard is up. */
  const [typing, setTyping] = useState(false);
  const fine = useFinePointer();
  // On an iPhone the view takes what the keyboard leaves, so the box stays above it (`lib/viewport.ts`).
  const frame = useVisualViewport(typing && !wide);
  const lastUuid = useRef<string | undefined>(undefined);
  lastUuid.current = messages.at(-1)?.uuid;

  // Load (or resume) and watch whenever the connection is (re)made.
  useEffect(() => {
    if (!client) return;
    let live = true;
    /**
     * The watch starts with the whole transcript (a `replace`), and the page asked for first can land after it: the
     * page was read earlier, so it may miss what came since (your first message in a new session), and later updates
     * only append. Once a replace is in, the page has nothing to add.
     */
    let whole = false;
    const after = lastUuid.current;
    void client
      .call('transcript.get', { sessionId, limit: PAGE, ...(after ? { after } : {}) })
      .then((page) => {
        if (!live || whole) return;
        setMessages((current) => (page.reset || !after ? page.messages : appendMessages(current, page.messages)));
        if (page.reset || !after) setHasMore(page.hasMore);
      })
      .catch((e: Error) => live && !lostConnection(e) && setError(e.message));
    void client.call('transcript.watch', { sessionId }).catch(() => {});
    const offs = [
      client.on('transcript.updated', (update) => {
        if (update.sessionId !== sessionId) return;
        if (update.mode === 'replace') {
          whole = true;
          setHasMore(false);
        }
        setMessages((current) => applyUpdate(current, update));
      }),
      client.on('session.stream', (delta) => delta.sessionId === sessionId && setStreaming((current) => applyStream(current, delta))),
      client.on('upNext.changed', (event) => event.sessionId === sessionId && setQueue(event.queue)),
      client.on('limits.changed', (event) => event.sessionId === sessionId && setLimit(event.limit)),
      client.on('catchup.changed', (event) => event.sessionId === sessionId && setCatchUp(event.catchUp)),
    ];
    void client.call('catchup.get', { sessionId }).then((r) => live && setCatchUp(r.catchUp), () => {});
    return () => {
      live = false;
      offs.forEach((off) => off());
      void client.call('transcript.unwatch', { sessionId }).catch(() => {});
    };
  }, [client, sessionId]);

  // Opening a session reads it, as on the computer; so does news arriving while it is open.
  const unread = session?.unread ?? false;
  useEffect(() => {
    if (client && unread && document.visibilityState === 'visible') void client.call('session.markRead', { sessionId }).catch(() => {});
  }, [client, sessionId, unread]);

  // What changed in its checkout: again whenever a turn ends (the status leaves working) or a new catch-up comes.
  const status = session?.status;
  const loadChanges = () => {
    if (!client) return;
    void client.call('changes.get', { sessionId }).then(setChanges, (e: Error) => setChanges({ files: [], branch: null, error: e.message }));
  };
  // A session running in Switchboard can change its model and mode from here: the chips need the lists.
  const running = session?.permissionMode != null;
  useEffect(() => {
    if (client && running && !options) void client.call('options.get', {}).then(setOptions, () => {});
  }, [client, running, options]);
  const profile = session?.profile ?? null;

  const turnEnded = status !== 'working';
  useEffect(loadChanges, [client, sessionId, turnEnded, catchUp?.turnId]);

  // What Claude was writing is in the transcript once its turn moves on.
  useEffect(() => setStreaming(NOT_STREAMING), [messages.length]);

  const loadOlder = async () => {
    const before = messages[0]?.uuid;
    if (!client || !before) return;
    const page = await client.call('transcript.get', { sessionId, before, limit: PAGE });
    setMessages((current) => prependMessages(current, page.messages));
    setHasMore(page.hasMore);
  };

  const working = session?.status === 'working';
  /** Its turn ended but a task it started still runs: still at work, so no catch-up yet. */
  const background = inBackground(session);
  const tasks = session?.background ?? [];
  const results = resultsByCall(messages);
  const fail = (e: Error) => !lostConnection(e) && setError(e.message);
  // A run's parent goes to Archived with its sub-sessions, as on the computer.
  const treeRun = takesPipelines ? runs.parent : null;
  const treeSteps = treeRun ? new Set(treeRun.steps.flatMap((s) => (s.sessionId ? [s.sessionId] : []))).size : 0;
  const setArchived = (archived: boolean) => (treeRun ? client!.call('runs.archive', { runId: treeRun.run.id, archived }) : client!.call('session.setFlags', { sessionId, archived }));
  const menu: MenuItem[] = [
    ...(working ? [{ label: 'Stop', onSelect: () => void client?.call('session.interrupt', { sessionId }).catch(fail) }] : []),
    { label: 'Mark as read', disabled: !client || !unread, onSelect: () => void client?.call('session.markRead', { sessionId }).catch(fail) },
    ...(takesPipelines && session && !runs.step ? [{ label: 'Run pipeline…', disabled: !client, onSelect: () => setPipelineSheet(true) }] : []),
    {
      label: treeSteps ? `Archive with ${treeSteps === 1 ? 'its step' : `its ${treeSteps} steps`}` : 'Archive',
      disabled: !client,
      onSelect: () =>
        void setArchived(true)
          .then(() => {
            toast(`Archived ${session?.title ?? 'the session'}`, { action: { label: 'Undo', run: () => void setArchived(false).catch(fail) } });
            onLeave();
          })
          .catch(fail),
    },
  ];
  const open = prompts[0];
  const card = showsCatchUp(catchUp, working || background, Boolean(open)) ? catchUp : null;
  const files = changes?.files.length ?? 0;
  const send = (text: string, images: RemoteImage[] = [], files: RemoteFile[] = [], mode: SendMode = 'queue') => client!.call('session.send', { sessionId, text, mode, images, ...(files.length ? { files } : {}) }).then(() => setUnfolded(true));
  const askToFix = (path: string | null) => {
    setSheet(null);
    setFill({ text: path ? `In ${path}, ` : '', id: Date.now() });
  };
  const showPanel = (open: boolean) => {
    setPanel(open);
    rememberPanel(open);
  };
  const openChanges = () => {
    if (!panelFits) return setSheet('changes');
    if (ask.open) closeAsk(sessionId);
    showPanel(ask.open || !panelOpen);
  };
  const toggleAsk = () => (ask.open ? closeAsk(sessionId) : openAsk(client, sessionId));
  // Ask belongs to the session on screen: leaving it closes the sheet or panel (an answer still coming keeps coming).
  useEffect(() => () => closeAsk(sessionId), [sessionId]);
  const quote = (answer: string) => {
    // On a phone the sheet covers the message box: it goes, so you see the quote land.
    if (!panelFits) closeAsk(sessionId);
    setFill({ text: answer, id: Date.now(), quote: true });
  };
  // Esc closes the panel once nothing over it (the palette, a sheet, a menu) took the key.
  const askPanel = panelFits && ask.open;
  useEffect(() => {
    if (!panelOpen && !askPanel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role=dialog],[role=menu]')) return;
      event.preventDefault();
      if (askPanel) closeAsk(sessionId);
      else showPanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, askPanel, sessionId]);
  const stop = () => void client?.call('session.interrupt', { sessionId }).catch(fail);
  const stopTask = async (taskId: string) => {
    try {
      await client!.call('session.stopTask', { sessionId, taskId });
    } catch (e) {
      fail(e as Error);
      throw e;
    }
  };
  const modelAndMode = running && options && session ? `${autoFace(session.auto) ?? modelLabel(options.models, session.model)} · ${MODE_SHORT[session.permissionMode!]}` : null;

  return (
    <div className="flex h-full bg-bg" style={frame ? { position: 'fixed', left: 0, right: 0, top: frame.top, height: frame.height, zIndex: 20 } : undefined} data-remote-session-view>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`safe-top flex items-center gap-2 border-b border-border bg-bg pb-2 pointer-fine:pb-2.5 ${lead ? 'px-2' : 'px-5'}`}>
          {lead}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-title font-semibold">{session?.title ?? 'Session'}</h1>
            {session && (
              <p className="flex items-center gap-1.5 truncate text-meta text-muted">
                {computerName && <ComputerTag name={computerName} />}
                <StatusDot status={session.status} />
                {STATUS_LABEL[session.status]} · {session.projectName}
                {session.branch ? ` · ${session.branch}` : ''}
                {profile && (
                  <>
                    {' · '}
                    <span className="inline-flex items-center gap-1" title={`Claude profile: ${profile.name}`} data-remote-profile>
                      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${PROFILE_DOT[profile.color]}`} />
                      {profile.name}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          {wide && modelAndMode && (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-meta text-muted lg:inline-flex" title="Model and permission mode. Change them under the message box." data-remote-model-mode>
              <span aria-hidden className={`size-1.5 rounded-full ${MODE_DOT[session!.permissionMode!]}`} />
              {modelAndMode}
            </span>
          )}
          <Button
            variant="quiet"
            size="md"
            onClick={toggleAsk}
            aria-pressed={ask.open}
            aria-label={ask.ready ? 'Ask about this session, an answer is ready' : 'Ask about this session'}
            title="Ask about this session"
            className={`relative px-2! text-link! ${ask.open ? 'bg-link/15' : ''}`}
            data-remote-ask
          >
            <MessageCircleQuestion className="size-4" aria-hidden />
            {wide && <span>Ask</span>}
            {ask.ready && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-link ring-2 ring-bg" data-remote-ask-ready />}
          </Button>
          {(files > 0 || (wide && changes)) && (
            <Button variant="quiet" size="md" onClick={openChanges} aria-pressed={panelOpen || undefined} aria-label={`Changes, ${files} ${files === 1 ? 'file' : 'files'}`} className={`px-2! ${panelOpen ? 'bg-selected text-text!' : ''}`} data-remote-changes>
              <FileDiff className="size-4" aria-hidden />
              {wide && <span>Changes</span>}
              <span className="tabular-nums">{files}</span>
            </Button>
          )}
          <MenuButton label="Session actions" items={menu} />
        </header>
        {banner}
        {runState && (
          <RunBar
            state={runState}
            step={runs.parent ? null : runs.step && { index: runs.step.index, round: runs.step.round }}
            client={client}
            onSteps={() => setRunSheet(true)}
            onParent={canOpenParent && onOpenSession ? () => onOpenSession(runParentId!) : null}
          />
        )}
        <Transcript
          messages={messages}
          results={results}
          streaming={streaming}
          working={working}
          background={background && !working ? backgroundLine(session?.background) : null}
          hasMore={hasMore}
          onOlder={() => void loadOlder()}
          folded={Boolean(card) && !unfolded}
          onUnfold={() => setUnfolded(true)}
          header={card && <CatchUpCard card={card} now={now} committed={committed === card.turnId} onChanges={() => (panelFits ? showPanel(true) : setSheet('changes'))} onCommit={() => (panelFits ? showPanel(true) : setSheet('commit'))} canCommit={Boolean(client) && files > 0} />}
        />
        {error && (
          <div className="px-3 pt-2 sm:px-6">
            <p role="alert" className="mx-auto flex w-full max-w-3xl items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-ui text-error">
              <span className="flex-1">{error}</span>
              <Button variant="quiet" size="md" aria-label="Dismiss" onClick={() => setError(null)} className="-my-1 -mr-2 px-2! text-error!">
                <X className="size-4" aria-hidden />
              </Button>
            </p>
          </div>
        )}
        {client && (
          <LimitNotice client={client} sessionId={sessionId} limit={limit} held={queue.length} busy={working || prompts.length > 0} now={now} />
        )}
        {queue.length > 0 && <UpNext queue={queue} onRemove={(id) => void client?.call('session.queue.remove', { sessionId, id }).catch((e: Error) => setError(e.message))} />}
        {tasks.length > 0 && <BackgroundTasks tasks={tasks} onStop={client ? stopTask : null} />}
        <DockedPrompt prompts={prompts} client={client} sessionTitle={session?.title} onGone={onRefresh} hints={wide} typing={typing && !fine} />
        <Composer
          sessionId={sessionId}
          fill={fill}
          features={features}
          chips={
            running && options && session ? (
              <>
                <ModelChip options={options} value={session.model} auto={session.auto} placement="above" disabled={!client} onPick={(model) => void client?.call('session.setModel', { sessionId, model }).catch(fail)} />
                {/* Only from a Switchboard that sends the effort, and for a model that takes one. */}
                {session.effort !== undefined && takesEffort(options.models, session.model) && (
                  <EffortChip options={options} value={session.effort} placement="above" disabled={!client} onPick={(effort) => void client?.call('session.setEffort', { sessionId, effort }).catch(fail)} />
                )}
                <ModeChip options={options} value={session.permissionMode!} placement="above" disabled={!client} onPick={(mode) => void client?.call('session.setPermissionMode', { sessionId, mode }).catch(fail)} />
              </>
            ) : null
          }
          disabled={!client}
          working={working}
          answering={Boolean(open)}
          idle={idlePlaceholder}
          onStop={stop}
          onSend={async (text, images, files, mode) => {
            // With a prompt open, what you type is the answer: no, and do this instead (as on the computer).
            if (open) {
              if (images.length || files.length) throw new Error("Attachments can't go with an answer. Remove them, or answer the prompt first.");
              const result = await answer(client!, open, { behavior: 'deny', message: text }, session?.title);
              if (result === 'gone') onRefresh();
              if (result === 'failed') throw new Error("The answer didn't reach your computer.");
              return;
            }
            await send(text, images, files, mode);
          }}
          onError={setError}
          onFocusChange={setTyping}
        />
      </div>
      {runSheet && runState && <RunSheet state={runState} client={client} canOpen={(id) => listed.has(id) && id !== sessionId} onOpenStep={(id) => onOpenSession?.(id)} onClose={() => setRunSheet(false)} />}
      {pipelineSheet && session && <RunPipelineSheet client={client} projectId={session.projectId} sessionId={sessionId} onClose={() => setPipelineSheet(false)} />}
      {ask.open && !panelFits && <AskSheet client={client} sessionId={sessionId} state={ask} working={working} onQuote={quote} onClose={() => closeAsk(sessionId)} />}
      {askPanel && <AskPanel client={client} sessionId={sessionId} state={ask} working={working} onQuote={quote} onClose={() => closeAsk(sessionId)} />}
      {sheet === 'changes' && <ChangesSheet client={client} sessionId={sessionId} changes={changes} onClose={() => setSheet(null)} onAsk={askToFix} onCommit={() => setSheet('commit')} />}
      {panelOpen && (
        <ChangesPanel
          client={client}
          sessionId={sessionId}
          changes={changes}
          initialMessage={commitTitle(catchUp)}
          onClose={() => showPanel(false)}
          onAsk={askToFix}
          onCommitted={() => {
            setCommitted(catchUp?.turnId ?? null);
            loadChanges();
          }}
        />
      )}
      {sheet === 'commit' && (
        <CommitSheet
          client={client}
          sessionId={sessionId}
          initial={commitTitle(catchUp)}
          files={files}
          onClose={() => setSheet(null)}
          onCommitted={() => {
            setCommitted(catchUp?.turnId ?? null);
            loadChanges();
          }}
        />
      )}
    </div>
  );
}

/**
 * The conversation, kept scrolled to the end while you are at the end. Scrolled up to read, a button takes you back
 * down, and says when something new arrived below.
 */
function Transcript({
  messages,
  results,
  streaming,
  working,
  background,
  hasMore,
  onOlder,
  header,
  folded,
  onUnfold,
}: {
  messages: RemoteMessage[];
  results: ReturnType<typeof resultsByCall>;
  streaming: Streaming;
  working: boolean;
  /** What still runs after the turn, for the line at the end (null: nothing). */
  background: string | null;
  hasMore: boolean;
  onOlder: () => void;
  /** The catch-up, over the conversation. */
  header: ReactNode;
  /** The conversation folds under the catch-up until you ask for it. */
  folded: boolean;
  onUnfold: () => void;
}) {
  const items = useMemo(() => transcriptItems(messages), [messages]);
  const since = useMemo(() => turnStart(messages), [messages]);
  // When each finished turn ended and how long it took, under its last reply.
  const ends = useMemo(() => turnEnds(messages, working), [messages, working]);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const [away, setAway] = useState(false);
  const [missed, setMissed] = useState(false);
  const last = messages.at(-1)?.uuid;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    if (!atEnd.current && last) setMissed(true);
  }, [last]);
  /** Where you are, from the geometry: at the end (or past it), or reading further up. */
  const settle = (follow: boolean) => {
    const el = scroller.current;
    if (!el) return;
    if (follow || el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      // Also past the end: iOS keeps the old offset when the content shrinks, and shows blank space under it.
      el.scrollTop = el.scrollHeight;
      atEnd.current = true;
      setAway(false);
      setMissed(false);
    } else {
      atEnd.current = false;
      setAway(true);
    }
  };
  // The size changes without a scroll event: a step you open or close, a run that folds once Claude moves on, a prompt
  // docked under the conversation. Following the end, a smaller view keeps it in view; otherwise, it says where you are.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      const resized = el.clientHeight !== height;
      height = el.clientHeight;
      settle(resized && atEnd.current);
    });
    observer.observe(el);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  const toEnd = () => {
    const el = scroller.current;
    if (!el) return;
    // Nothing left to scroll to: no scroll event will come to say you're at the end.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 1) settle(true);
    else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAway(!atEnd.current);
          if (atEnd.current) setMissed(false);
        }}
        className="h-full overflow-y-auto overscroll-contain px-4 py-3 sm:px-6"
      >
        <div ref={content} className="mx-auto w-full max-w-3xl">
          {header && <div className="pb-4">{header}</div>}
          {folded ? (
            <Button variant="quiet" size="md" onClick={onUnfold} className="w-full" data-remote-unfold>
              <ChevronDown className="size-4" aria-hidden />
              Show the conversation · {items.length} {items.length === 1 ? 'message' : 'messages'}
            </Button>
          ) : (
            <>
              {hasMore && (
                <div className="pb-3 text-center">
                  <Button variant="quiet" size="md" onClick={onOlder}>
                    Show earlier messages
                  </Button>
                </div>
              )}
              <div className="flex flex-col gap-4">
                {items.map((item, index) => {
                  const end = item.kind === 'text' ? ends.get(item.key) : undefined;
                  return (
                    <Fragment key={item.key}>
                      <ItemView item={item} results={results} live={working && index === items.length - 1} />
                      {end && (
                        <p className="-mt-3 text-meta whitespace-nowrap text-faint tabular-nums" data-turn-meta>
                          {turnLine(end)}
                        </p>
                      )}
                    </Fragment>
                  );
                })}
                {streaming.kind === 'text' ? (
                  <div data-remote-streaming>
                    <StreamingMarkdown text={streaming.text} />
                    <span className="mt-0.5 block h-3.5 w-1.5 animate-pulse bg-accent-ink" aria-hidden />
                  </div>
                ) : working || streaming.kind ? (
                  <WorkingLine streaming={streaming} since={since} />
                ) : (
                  background && <BackgroundLine text={background} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {away && (
        <Button size="md" onClick={toEnd} data-remote-jump className={`absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md ${missed ? 'border-accent-ink!' : ''}`}>
          <ArrowDown className="size-4" aria-hidden />
          {missed ? 'New messages' : 'Jump to latest'}
        </Button>
      )}
    </div>
  );
}

/**
 * Claude is working, at the end of the conversation, as on the computer: three dots, how long the turn has taken and
 * what Claude is doing (thinking, using a tool), so a quiet stretch doesn't look like a session that stopped.
 */
function WorkingLine({ streaming, since }: { streaming: Streaming; since: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="flex min-w-0 items-center gap-2 text-ui text-muted" data-remote-working>
      <span className="working-dots flex w-4 shrink-0 justify-center" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      {since !== null && <span className="shrink-0 text-faint tabular-nums">{formatDuration(now - since)} ·</span>}
      <span className="shrink-0" aria-live="polite">
        {workingLabel(streaming)}
      </span>
      {streaming.kind === 'thinking' && streaming.text && <span className="min-w-0 truncate text-faint italic">{streaming.text.slice(-160)}</span>}
    </p>
  );
}

/** Claude's turn ended but something it started still runs, in the background's green: it carries on when that finishes. */
function BackgroundLine({ text }: { text: string }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-ui text-ok" data-remote-background-line>
      <span className="flex w-4 shrink-0 justify-center" aria-hidden>
        <LoaderCircle className="size-3.5 animate-[spin_2s_linear_infinite]" />
      </span>
      <span className="min-w-0 truncate" aria-live="polite">
        {text}
      </span>
    </p>
  );
}

function UpNext({ queue, onRemove }: { queue: QueuedMessage[]; onRemove: (id: string) => void }) {
  return (
    <section aria-label="Up next" className="px-3 pt-2 sm:px-6">
      <div className="mx-auto w-full max-w-3xl px-1">
        <h2 className="text-meta font-semibold tracking-wide text-faint uppercase">Up next</h2>
        <ul>
          {queue.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-0.5">
              <span className="min-w-0 flex-1 truncate text-ui">{item.text}</span>
              <Button variant="quiet" size="md" aria-label="Remove from Up next" onClick={() => onRemove(item.id)} className="px-2!">
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The message box. While Claude works, Stop sits next to Send, and a message waits in Up next for the turn to end, as
 * on the computer; the menu next to Send can steer it or send it now instead (`lib/sendMode.ts`). While a prompt is
 * open, what you send answers it instead. Images and files come from the attach button, a paste or a drop
 * (`Attachments.tsx`), and show above the box with a remove button.
 */
function Composer({
  sessionId,
  fill,
  features,
  chips,
  disabled,
  working,
  answering,
  idle,
  onStop,
  onSend,
  onError,
  onFocusChange,
}: {
  /** Whose draft the box keeps when you go to another view and come back. */
  sessionId: string;
  /** Text to put in the box and focus it (Ask Claude to fix…), or to quote at its end; a new `id` each time. */
  fill: Fill | null;
  features: readonly string[];
  /** The running session's model and mode, under the box. */
  chips: ReactNode;
  disabled: boolean;
  working: boolean;
  answering: boolean;
  /** What the box says while Claude waits for you: a run's parent and a step the run waits on say what writing does. */
  idle?: string | undefined;
  onStop: () => void;
  onSend: (text: string, images: RemoteImage[], files: RemoteFile[], mode: SendMode) => Promise<void>;
  onError: (message: string) => void;
  /** The box got or lost focus: on a touch screen, the keyboard came up or went. */
  onFocusChange: (focused: boolean) => void;
}) {
  const draft: DraftKey = { kind: 'session', sessionId };
  const [text, setText] = useState(() => loadDraft(draft));
  const [busy, setBusy] = useState(false);
  const attachments = useAttachments({ features, blocked: answering ? "Attachments can't go with an answer. Answer the prompt first." : null, onError });
  const { reading, dragging } = attachments;
  const fine = useFinePointer();
  const box = useRef<HTMLTextAreaElement>(null);
  // With a keyboard, the box is ready to type in when the session opens (after a draft you left there); on a phone
  // the keyboard waits for a tap.
  useEffect(() => {
    const el = box.current;
    if (!fine || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [fine]);
  useEffect(() => saveDraft(draft, text), [sessionId, text]);
  useEffect(() => {
    if (!fill) return;
    const next = fill.quote ? withQuote(box.current?.value ?? '', fill.text) : fill.text;
    setText(next);
    const el = box.current;
    el?.focus();
    // After React has put the text in: the caret at its end, ready to say what to fix.
    requestAnimationFrame(() => {
      el?.setSelectionRange(next.length, next.length);
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [fill]);
  const cantSend = disabled || busy || reading || !text.trim();
  /** While Claude works, Send queues; its menu can steer or send now instead. An answer to a prompt has one way. */
  const modes = working && !answering;
  const send = async (mode: SendMode = 'queue') => {
    const message = text.trim();
    if (!message || busy || reading) return;
    setBusy(true);
    try {
      await onSend(message, attachments.images, attachments.files, mode);
      // Also when you went to another view while it was sending.
      clearDraft(draft);
      setText('');
      attachments.clear();
    } catch (error) {
      onError(error instanceof Error ? error.message : "The message wasn't sent.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="safe-bottom px-3 pt-2 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragOver={(event) => {
        if (!disabled) attachments.dropProps.onDragOver(event);
      }}
      onDragLeave={attachments.dropProps.onDragLeave}
      onDrop={attachments.dropProps.onDrop}
    >
      <AttachmentTray state={attachments} className="mx-auto w-full max-w-3xl pb-2" />
      <div className={`mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border bg-card p-1.5 pl-1.5 transition-[border-color,box-shadow] focus-within:border-accent-ink focus-within:ring-4 focus-within:ring-accent/20 ${dragging ? 'border-accent-ink ring-4 ring-accent/20' : 'border-edge'}`}>
        <AttachButton state={attachments} disabled={disabled || answering} title={answering ? 'Answer the prompt first' : undefined} />
        <textarea
          ref={box}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={attachments.onPaste}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={(event) => {
            // With a keyboard, Enter sends and Shift+Enter starts a new line, as on the computer; ⌥↵ steers, ⌘⇧↵ sends now.
            const mode = fine ? sendKey({ key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing }, MAC) : null;
            if (mode) {
              event.preventDefault();
              void send(mode);
            }
          }}
          rows={1}
          placeholder={disabled ? 'Sending waits for the connection' : answering ? 'Or tell Claude what to do instead' : working ? 'Add to Up next' : (idle ?? 'Message Claude')}
          aria-label="Message"
          data-remote-message
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-2 text-body text-text outline-none [field-sizing:content] placeholder:text-faint pointer-fine:min-h-7 pointer-fine:py-1"
        />
        {working && (
          <Button variant="danger" size="md" onClick={onStop} disabled={disabled} aria-label="Stop" title="Stop Claude" className="px-3!" data-remote-stop>
            <Square className="size-3 fill-current" aria-hidden />
            <span className="hidden sm:inline">Stop</span>
          </Button>
        )}
        <div className="flex shrink-0">
          <Button type="submit" variant="primary" size="md" disabled={cantSend} aria-label={answering ? 'Send instead' : working ? 'Add to Up next' : 'Send'} className={`px-3! ${modes ? 'rounded-r-none' : ''}`}>
            <Send className="size-4" aria-hidden />
          </Button>
          {modes && (
            <AnchoredMenu
              label="More ways to send"
              side="above"
              items={[
                ...SEND_MODES.map(({ mode, label, shortcut }) => ({ label, hint: fine ? keys(shortcut) : undefined, onSelect: () => void send(mode) })),
                { kind: 'separator' as const },
                { kind: 'note' as const, label: SEND_MODES_NOTE },
              ]}
            >
              {(trigger) => (
                <Button {...trigger} variant="primary" size="md" disabled={cantSend} aria-label="More ways to send" className="rounded-l-none border-l border-on-accent/20 px-1.5!" data-remote-send-menu>
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
              )}
            </AnchoredMenu>
          )}
        </div>
      </div>
      {/* Wraps on a narrow phone rather than scrolling: a scrolling row would clip the lists that open above the chips. */}
      {chips && <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-1.5 pt-1.5">{chips}</div>}
    </form>
  );
}
