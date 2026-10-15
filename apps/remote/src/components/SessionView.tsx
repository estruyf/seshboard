import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronLeft, Send, Square, X } from 'lucide-react';
import type { QueuedMessage, RemoteMessage, RemoteSessions } from '@switchboard/protocol/remote-client';
import { appendMessages, applyStream, applyUpdate, NOT_STREAMING, prependMessages, resultsByCall, visibleMessages, type Streaming } from '../lib/transcript.ts';
import type { Client } from './Connected.tsx';
import { MessageView } from './MessageView.tsx';
import { PermissionCard } from './PermissionCard.tsx';
import { useFinePointer } from '../lib/media.ts';
import { Button, STATUS_LABEL, StatusDot } from './ui.tsx';

const PAGE = 50;

/**
 * One session: its conversation (the last page, older pages on request, live updates), what Claude is writing, the
 * prompts it waits on, Up next, the message box and Stop. After a reconnect it resumes after the last message it has.
 */
export function SessionView({ client, sessionId, sessions, banner, onBack }: { client: Client; sessionId: string; sessions: RemoteSessions; banner: ReactNode; onBack: (() => void) | null }) {
  const session = sessions.sessions.find((s) => s.id === sessionId) ?? null;
  const prompts = sessions.prompts.filter((p) => p.sessionId === sessionId);
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [streaming, setStreaming] = useState<Streaming>(NOT_STREAMING);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
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
      .catch((e: Error) => live && setError(e.message));
    void client.call('transcript.watch', { sessionId }).catch(() => {});
    const offs = [
      client.on('transcript.updated', (update) => update.sessionId === sessionId && setMessages((current) => applyUpdate(current, update))),
      client.on('session.stream', (delta) => delta.sessionId === sessionId && setStreaming((current) => applyStream(current, delta))),
      client.on('upNext.changed', (event) => event.sessionId === sessionId && setQueue(event.queue)),
    ];
    return () => {
      live = false;
      offs.forEach((off) => off());
      void client.call('transcript.unwatch', { sessionId }).catch(() => {});
    };
  }, [client, sessionId]);

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

  return (
    <div className="flex h-full flex-col">
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
            </p>
          )}
        </div>
        {working && (
          <Button variant="secondary" size="md" onClick={() => void client?.call('session.interrupt', { sessionId }).catch((e: Error) => setError(e.message))} data-remote-stop>
            <Square className="size-3" aria-hidden fill="currentColor" />
            Stop
          </Button>
        )}
      </header>
      {banner}
      <Transcript messages={messages} results={results} streaming={streaming} hasMore={hasMore} onOlder={() => void loadOlder()}>
        {prompts.map((prompt) => (
          <PermissionCard key={prompt.requestId} prompt={prompt} client={client} onError={setError} />
        ))}
      </Transcript>
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
      <Composer disabled={!client} working={working} onSend={(text) => client!.call('session.send', { sessionId, text, mode: 'queue' })} onError={setError} />
    </div>
  );
}

/**
 * The conversation, kept scrolled to the end while you are at the end. Scrolled up to read, a button takes you back
 * down, and says when something new arrived below.
 */
function Transcript({ messages, results, streaming, hasMore, onOlder, children }: { messages: RemoteMessage[]; results: ReturnType<typeof resultsByCall>; streaming: Streaming; hasMore: boolean; onOlder: () => void; children: ReactNode }) {
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
          {hasMore && (
            <div className="pb-3 text-center">
              <Button variant="quiet" size="md" onClick={onOlder}>
                Show earlier messages
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-4">
            {visibleMessages(messages).map((message) => (
              <MessageView key={message.uuid} message={message} results={results} />
            ))}
            {streaming.kind && (
              <p className={`text-body whitespace-pre-wrap ${streaming.kind === 'text' ? '' : 'text-muted italic'}`} aria-live="polite">
                {streaming.kind === 'tool' ? `Running ${streaming.text}…` : streaming.text}
              </p>
            )}
            {children}
          </div>
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

/** The message box. While Claude works, a message waits in Up next for the turn to end, as on the computer. */
function Composer({ disabled, working, onSend, onError }: { disabled: boolean; working: boolean; onSend: (text: string) => Promise<{ queued: boolean }>; onError: (message: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fine = useFinePointer();
  const box = useRef<HTMLTextAreaElement>(null);
  // With a keyboard, the box is ready to type in when the session opens; on a phone the keyboard waits for a tap.
  useEffect(() => {
    if (fine) box.current?.focus({ preventScroll: true });
  }, [fine]);
  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      await onSend(message);
      setText('');
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
    >
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border border-edge bg-card p-1.5 pl-3 transition-[border-color,box-shadow] focus-within:border-accent-ink focus-within:ring-4 focus-within:ring-accent/20">
        <textarea
          ref={box}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // With a keyboard, Enter sends and Shift+Enter starts a new line, as on the computer.
            if (fine && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={working ? 'Add to Up next' : 'Message Claude'}
          aria-label="Message"
          data-remote-message
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-2 text-body text-text outline-none [field-sizing:content] placeholder:text-faint pointer-fine:min-h-7 pointer-fine:py-1"
        />
        <Button type="submit" variant="primary" size="md" disabled={disabled || busy || !text.trim()} aria-label={working ? 'Add to Up next' : 'Send'} className="px-3!">
          <Send className="size-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}
