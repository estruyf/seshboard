import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, ChevronLeft, FileDiff, ImagePlus, Send, Square, X } from 'lucide-react';
import { REMOTE_MAX_IMAGES, type CatchUp, type QueuedMessage, type RemoteImage, type RemoteMessage, type RemoteOptions, type RemoteSessions } from '@switchboard/protocol/remote-client';
import { commitTitle, showsCatchUp } from '../lib/catchUp.ts';
import { transcriptItems } from '../lib/steps.ts';
import { appendMessages, applyStream, applyUpdate, NOT_STREAMING, prependMessages, resultsByCall, type Streaming } from '../lib/transcript.ts';
import type { Client } from './Connected.tsx';
import { ItemView } from './MessageView.tsx';
import { StreamingMarkdown } from './Markdown.tsx';
import { formatDuration, turnStart, workingLabel } from '../lib/working.ts';
import { answer } from './answer.ts';
import { CatchUpCard } from './CatchUpCard.tsx';
import { ChangesSheet, CommitSheet, type ChangesState } from './ChangesSheet.tsx';
import { useNow } from './SessionList.tsx';
import { MenuButton, type MenuItem } from './Menu.tsx';
import { ModeChip, ModelChip } from './OptionChips.tsx';
import { DockedPrompt } from './PermissionCard.tsx';
import { toast } from './Toasts.tsx';
import { useFinePointer, useMedia } from '../lib/media.ts';
import { addReason, imageFiles, toImage } from '../lib/images.ts';
import { MODE_DOT, MODE_SHORT, modelLabel, PROFILE_DOT } from '../lib/options.ts';
import { ChangesPanel, panelWasOpen, rememberPanel } from './ChangesPanel.tsx';
import { Button, STATUS_LABEL, StatusDot } from './ui.tsx';

const PAGE = 50;

/** The connection dropped while it was asked: the banner says so, not an error line. */
const lostConnection = (error: unknown) => (error as { code?: string }).code === 'DISCONNECTED';

/**
 * One session: its conversation (the last page, older pages on request, live updates), what Claude is writing, the
 * prompts it waits on (docked above the message box), Up next and the message box. A finished session starts with its
 * catch-up, the conversation folded under it. After a reconnect it resumes after the last message it has.
 */
export function SessionView({
  client,
  sessionId,
  sessions,
  banner,
  onBack,
  onLeave,
  onRefresh,
  wide = false,
  initialChanges = false,
}: {
  client: Client;
  sessionId: string;
  sessions: RemoteSessions;
  banner: ReactNode;
  onBack: (() => void) | null;
  /** Back to the list (after Archive): the back gesture on a phone, the empty view on a wide screen. */
  onLeave: () => void;
  onRefresh: () => void;
  /** A wide screen: the header has the model and mode, Changes and Stop, and the prompt's buttons show their keys. */
  wide?: boolean;
  /** Opened from a card's Changes: Changes open from the start. */
  initialChanges?: boolean;
}) {
  const session = sessions.sessions.find((s) => s.id === sessionId) ?? null;
  const prompts = sessions.prompts.filter((p) => p.sessionId === sessionId);
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [streaming, setStreaming] = useState<Streaming>(NOT_STREAMING);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const [changes, setChanges] = useState<ChangesState | null>(null);
  /** At 1280px and wider Changes is a panel on the right (remembered in this browser); below that, a sheet. */
  const panelFits = useMedia('(min-width: 1280px)') && wide;
  const [panel, setPanel] = useState(() => (initialChanges || panelWasOpen()));
  const panelOpen = panelFits && panel;
  const [sheet, setSheet] = useState<'changes' | 'commit' | null>(() => (initialChanges && !(wide && window.matchMedia('(min-width: 1280px)').matches) ? 'changes' : null));
  const [unfolded, setUnfolded] = useState(false);
  /** The turn committed from here, so its card says Committed. */
  const [committed, setCommitted] = useState<string | null>(null);
  const [fill, setFill] = useState<{ text: string; id: number } | null>(null);
  const [options, setOptions] = useState<RemoteOptions | null>(null);
  const now = useNow();
  const lastUuid = useRef<string | undefined>(undefined);
  lastUuid.current = messages.at(-1)?.uuid;

  // Load (or resume) and watch whenever the connection is (re)made.
  useEffect(() => {
    if (!client) return;
    let live = true;
    const after = lastUuid.current;
    void client
      .call('transcript.get', { sessionId, limit: PAGE, ...(after ? { after } : {}) })
      .then((page) => {
        if (!live) return;
        setMessages((current) => (page.reset || !after ? page.messages : appendMessages(current, page.messages)));
        if (page.reset || !after) setHasMore(page.hasMore);
      })
      .catch((e: Error) => live && !lostConnection(e) && setError(e.message));
    void client.call('transcript.watch', { sessionId }).catch(() => {});
    const offs = [
      client.on('transcript.updated', (update) => update.sessionId === sessionId && setMessages((current) => applyUpdate(current, update))),
      client.on('session.stream', (delta) => delta.sessionId === sessionId && setStreaming((current) => applyStream(current, delta))),
      client.on('upNext.changed', (event) => event.sessionId === sessionId && setQueue(event.queue)),
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
  const results = resultsByCall(messages);
  const fail = (e: Error) => !lostConnection(e) && setError(e.message);
  const menu: MenuItem[] = [
    ...(working ? [{ label: 'Stop', onSelect: () => void client?.call('session.interrupt', { sessionId }).catch(fail) }] : []),
    { label: 'Mark as read', disabled: !client || !unread, onSelect: () => void client?.call('session.markRead', { sessionId }).catch(fail) },
    {
      label: 'Archive',
      disabled: !client,
      onSelect: () =>
        void client
          ?.call('session.setFlags', { sessionId, archived: true })
          .then(() => {
            toast('Archived', { detail: session?.title });
            onLeave();
          })
          .catch(fail),
    },
  ];
  const open = prompts[0];
  const card = showsCatchUp(catchUp, working, Boolean(open)) ? catchUp : null;
  const files = changes?.files.length ?? 0;
  const send = (text: string, images: RemoteImage[] = []) => client!.call('session.send', { sessionId, text, mode: 'queue', images }).then(() => setUnfolded(true));
  const askToFix = (path: string | null) => {
    setSheet(null);
    setFill({ text: path ? `In ${path}, ` : '', id: Date.now() });
  };
  const showPanel = (open: boolean) => {
    setPanel(open);
    rememberPanel(open);
  };
  const openChanges = () => (panelFits ? showPanel(!panelOpen) : setSheet('changes'));
  // Esc closes the panel once nothing over it (the palette, a sheet, a menu) took the key.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role=dialog],[role=menu]')) return;
      event.preventDefault();
      showPanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);
  const stop = () => void client?.call('session.interrupt', { sessionId }).catch(fail);
  const modelAndMode = running && options && session ? `${modelLabel(options.models, session.model)} · ${MODE_SHORT[session.permissionMode!]}` : null;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`safe-top flex items-center gap-2 border-b border-border bg-bg pb-2 pointer-fine:pb-2.5 ${onBack ? 'px-2' : 'px-5'}`}>
          {onBack && (
            <Button variant="quiet" onClick={onBack} aria-label="Back" className="px-2!">
              <ChevronLeft className="size-5" aria-hidden />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-title font-semibold">{session?.title ?? 'Session'}</h1>
            {session && (
              <p className="flex items-center gap-1.5 truncate text-meta text-muted">
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
          {(files > 0 || (wide && changes)) && (
            <Button variant="quiet" size="md" onClick={openChanges} aria-pressed={panelOpen || undefined} aria-label={`Changes, ${files} ${files === 1 ? 'file' : 'files'}`} className={`px-2! ${panelOpen ? 'bg-selected text-text!' : ''}`} data-remote-changes>
              <FileDiff className="size-4" aria-hidden />
              {wide && <span>Changes</span>}
              <span className="tabular-nums">{files}</span>
            </Button>
          )}
          {wide && working && (
            <Button size="md" onClick={stop} disabled={!client} data-remote-stop>
              <Square className="size-3 fill-current" aria-hidden />
              Stop
            </Button>
          )}
          <MenuButton label="Session actions" items={menu} />
        </header>
        {banner}
        <Transcript
          messages={messages}
          results={results}
          streaming={streaming}
          working={working}
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
        {queue.length > 0 && <UpNext queue={queue} onRemove={(id) => void client?.call('session.queue.remove', { sessionId, id }).catch((e: Error) => setError(e.message))} />}
        <DockedPrompt prompts={prompts} client={client} sessionTitle={session?.title} onGone={onRefresh} hints={wide} />
        <Composer
          fill={fill}
          chips={
            running && options && session ? (
              <>
                <ModelChip options={options} value={session.model} placement="above" disabled={!client} onPick={(model) => void client?.call('session.setModel', { sessionId, model }).catch(fail)} />
                <ModeChip options={options} value={session.permissionMode!} placement="above" disabled={!client} onPick={(mode) => void client?.call('session.setPermissionMode', { sessionId, mode }).catch(fail)} />
              </>
            ) : null
          }
          disabled={!client}
          working={working}
          answering={Boolean(open)}
          onSend={async (text, images) => {
            // With a prompt open, what you type is the answer: no, and do this instead (as on the computer).
            if (open) {
              if (images.length) throw new Error("Images can't go with an answer. Remove them, or answer the prompt first.");
              const result = await answer(client!, open, { behavior: 'deny', message: text }, session?.title);
              if (result === 'gone') onRefresh();
              if (result === 'failed') throw new Error("The answer didn't reach your computer.");
              return;
            }
            await send(text, images);
          }}
          onError={setError}
        />
      </div>
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
  const scroller = useRef<HTMLDivElement>(null);
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
  const toEnd = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
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
        <div className="mx-auto w-full max-w-3xl">
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
                {items.map((item, index) => (
                  <ItemView key={item.key} item={item} results={results} live={working && index === items.length - 1} />
                ))}
                {streaming.kind === 'text' ? (
                  <div data-remote-streaming>
                    <StreamingMarkdown text={streaming.text} />
                    <span className="mt-0.5 block h-3.5 w-1.5 animate-pulse bg-accent-ink" aria-hidden />
                  </div>
                ) : (
                  (working || streaming.kind) && <WorkingLine streaming={streaming} since={since} />
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

/** An image waiting in the message box, with its thumbnail. */
interface Attached {
  id: number;
  image: RemoteImage;
}

let nextImage = 1;

/**
 * The message box. While Claude works, a message waits in Up next for the turn to end, as on the computer. While a
 * prompt is open, what you send answers it instead. Images come from the camera button, a paste or a drop; each is
 * resized on this device first (`lib/images.ts`), and shows as a thumbnail above the box with a remove button.
 */
function Composer({
  fill,
  chips,
  disabled,
  working,
  answering,
  onSend,
  onError,
}: {
  /** Text to put in the box and focus it (Ask Claude to fix…); a new `id` each time. */
  fill: { text: string; id: number } | null;
  /** The running session's model and mode, under the box. */
  chips: ReactNode;
  disabled: boolean;
  working: boolean;
  answering: boolean;
  onSend: (text: string, images: RemoteImage[]) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<Attached[]>([]);
  const [reading, setReading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const add = async (files: readonly File[]) => {
    const taken = images.length + reading;
    const fitting = imageFiles(files, taken);
    if (!fitting.length) {
      const reason = files.some((f) => f.type.startsWith('image/')) ? addReason(taken) : null;
      if (reason) onError(reason);
      return;
    }
    if (fitting.length < files.filter((f) => f.type.startsWith('image/')).length) onError(addReason(taken + fitting.length) ?? '');
    setReading((n) => n + fitting.length);
    for (const file of fitting) {
      try {
        const image = await toImage(file);
        setImages((current) => [...current, { id: nextImage++, image }]);
      } catch (error) {
        onError(error instanceof Error ? error.message : "That image couldn't be read.");
      } finally {
        setReading((n) => n - 1);
      }
    }
  };
  const fine = useFinePointer();
  const box = useRef<HTMLTextAreaElement>(null);
  // With a keyboard, the box is ready to type in when the session opens; on a phone the keyboard waits for a tap.
  useEffect(() => {
    if (fine) box.current?.focus({ preventScroll: true });
  }, [fine]);
  useEffect(() => {
    if (!fill) return;
    setText(fill.text);
    const el = box.current;
    el?.focus();
    // After React has put the text in: the caret at its end, ready to say what to fix.
    requestAnimationFrame(() => el?.setSelectionRange(fill.text.length, fill.text.length));
  }, [fill]);
  const send = async () => {
    const message = text.trim();
    if (!message || busy || reading) return;
    setBusy(true);
    try {
      await onSend(
        message,
        images.map((a) => a.image),
      );
      setText('');
      setImages([]);
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
        if (disabled || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        void add([...event.dataTransfer.files]);
      }}
    >
      {(images.length > 0 || reading > 0) && (
        <ul className="mx-auto flex w-full max-w-3xl gap-2 pb-2" aria-label="Images to send" data-remote-images>
          {images.map((attached) => (
            <li key={attached.id} className="group relative size-14 shrink-0 overflow-hidden rounded-lg border border-edge bg-code">
              <img src={`data:${attached.image.mediaType};base64,${attached.image.data}`} alt={attached.image.name ?? 'Image'} className="size-full object-cover" />
              <button
                type="button"
                aria-label={`Remove ${attached.image.name ?? 'image'}`}
                onClick={() => setImages((current) => current.filter((a) => a.id !== attached.id))}
                className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                data-remote-image-remove
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
          {reading > 0 && <li className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-edge text-meta text-faint">Reading…</li>}
        </ul>
      )}
      <div className={`mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border bg-card p-1.5 pl-1.5 transition-[border-color,box-shadow] focus-within:border-accent-ink focus-within:ring-4 focus-within:ring-accent/20 ${dragging ? 'border-accent-ink ring-4 ring-accent/20' : 'border-edge'}`}>
        <Button variant="quiet" size="md" aria-label="Add an image" title={answering ? 'Answer the prompt first' : 'Add an image'} disabled={disabled || answering || images.length + reading >= REMOTE_MAX_IMAGES} onClick={() => picker.current?.click()} className="px-2!" data-remote-attach>
          <ImagePlus className="size-4" aria-hidden />
        </Button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <textarea
          ref={box}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            // A screenshot pastes as an image; a copied page with text in it pastes its text.
            const files = [...event.clipboardData.files];
            if (!files.some((f) => f.type.startsWith('image/')) || event.clipboardData.types.includes('text/plain')) return;
            event.preventDefault();
            if (!answering) void add(files);
            else onError("Images can't go with an answer. Answer the prompt first.");
          }}
          onKeyDown={(event) => {
            // With a keyboard, Enter sends and Shift+Enter starts a new line, as on the computer.
            if (fine && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={disabled ? 'Sending waits for the connection' : answering ? 'Or tell Claude what to do instead' : working ? 'Add to Up next' : 'Message Claude'}
          aria-label="Message"
          data-remote-message
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-2 text-body text-text outline-none [field-sizing:content] placeholder:text-faint pointer-fine:min-h-7 pointer-fine:py-1"
        />
        <Button type="submit" variant="primary" size="md" disabled={disabled || busy || reading > 0 || !text.trim()} aria-label={answering ? 'Send instead' : working ? 'Add to Up next' : 'Send'} className="px-3!">
          <Send className="size-4" aria-hidden />
        </Button>
      </div>
      {chips && <div className="mx-auto flex w-full max-w-3xl gap-1.5 pt-1.5">{chips}</div>}
    </form>
  );
}
