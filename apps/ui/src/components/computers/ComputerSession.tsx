import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Square, Wrench } from 'lucide-react';
import type { Computer, Contract, PermissionDecision, RemoteMessage, RemotePrompt, RemoteSession, RpcClient } from '@switchboard/protocol/client';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { callComputer, onComputerEvent } from './callComputer.ts';
import { applyStream, applyUpdate, NOT_STREAMING, prependMessages, toolLine, visibleMessages, type Streaming } from './computerSessions.ts';
import { ComputerPrompt } from './ComputerPrompt.tsx';
import { RemoteText } from './RemoteText.tsx';

const PAGE = 100;

/**
 * A session on another computer: its conversation as it happens, what it waits on you for, Stop, and a message box
 * that sends (or queues, while Claude works) a prompt there. What only that computer can do (the terminal, files,
 * pushing) stays there.
 */
export function ComputerSession({ client, computer, session, prompts }: { client: RpcClient<Contract>; computer: Computer; session: RemoteSession; prompts: RemotePrompt[] }) {
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [streaming, setStreaming] = useState<Streaming>(NOT_STREAMING);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const connected = computer.state === 'connected';
  const id = computer.id;
  const working = session.status === 'working' || session.status === 'background';

  useEffect(() => {
    if (!connected) return;
    let current = true;
    setError(null);
    setStreaming(NOT_STREAMING);
    const offs = [
      onComputerEvent(client, id, 'transcript.updated', (update) => update.sessionId === session.id && setMessages((m) => applyUpdate(m, update))),
      onComputerEvent(client, id, 'session.stream', (delta) => delta.sessionId === session.id && setStreaming((s) => applyStream(s, delta))),
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
    void callComputer(client, id, 'transcript.watch', { sessionId: session.id }).catch(() => {});
    void callComputer(client, id, 'session.markRead', { sessionId: session.id }).catch(() => {});
    return () => {
      current = false;
      offs.forEach((off) => off());
      void callComputer(client, id, 'transcript.unwatch', { sessionId: session.id }).catch(() => {});
    };
  }, [client, id, session.id, connected]);

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

  const respond = async (prompt: RemotePrompt, decision: PermissionDecision) => {
    try {
      await callComputer(client, id, 'session.respond', { requestId: prompt.requestId, decision });
    } catch (e) {
      toast((e as { code?: string }).code === 'NOT_FOUND' ? 'Already answered' : (e as Error).message);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || sending || !connected) return;
    setSending(true);
    atBottom.current = true;
    void callComputer(client, id, 'session.send', { sessionId: session.id, text, mode: 'queue', images: [] }).then(
      ({ queued }) => {
        setDraft('');
        if (queued) toast('Added to Up next', { icon: 'queue', body: `Claude is working on ${computer.name}. It goes next.` });
      },
      (e: Error) => toast(e.message),
    ).finally(() => setSending(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const shown = visibleMessages(messages);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={session.title} data-computer-session={session.id}>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-ui font-semibold">{session.title}</h2>
          <p className="truncate text-meta text-muted">
            {session.projectName}
            {session.branch && ` · ${session.branch}`}
            {session.model && ` · ${session.model}`}
          </p>
        </div>
        {working && (
          <Button size="sm" icon={<Square size={11} aria-hidden />} disabled={!connected} onClick={() => void callComputer(client, id, 'session.interrupt', { sessionId: session.id }).catch((e: Error) => toast(e.message))} data-computer-stop>
            Stop
          </Button>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-5 py-5">
          {error && <Notice tone="error">{error}</Notice>}
          {!loaded && !error && <p className="text-ui text-muted">{connected ? 'Loading the conversation…' : `Waiting for ${computer.name}…`}</p>}
          {hasMore && (
            <Button variant="quiet" size="sm" className="justify-self-center" onClick={loadEarlier}>
              Show earlier messages
            </Button>
          )}
          {shown.map((message) => (
            <Message key={message.uuid} message={message} />
          ))}
          {streaming.kind === 'text' && streaming.text && <RemoteText text={streaming.text} />}
          {working && (
            <p className="text-meta text-muted" role="status" data-computer-working>
              {streaming.kind === 'tool' ? `Using ${streaming.text}…` : streaming.kind === 'thinking' ? 'Thinking…' : 'Working…'}
            </p>
          )}
          {prompts.map((prompt) => (
            <ComputerPrompt key={prompt.requestId} prompt={prompt} respond={(decision) => respond(prompt, decision)} />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-5 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-edge bg-card p-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={Math.min(8, Math.max(1, draft.split('\n').length))}
            disabled={!connected}
            placeholder={connected ? `Message Claude on ${computer.name}` : `${computer.name} is not connected`}
            aria-label={`Message Claude on ${computer.name}`}
            className="min-h-7 flex-1 resize-none bg-transparent px-1.5 py-1 text-body text-text placeholder:text-faint focus:outline-none"
            data-computer-composer
          />
          <Button variant="primary" iconOnly icon={<ArrowUp size={15} aria-hidden />} aria-label={working ? 'Add to Up next' : 'Send'} disabled={!connected || sending || !draft.trim()} onClick={send} data-computer-send />
        </div>
      </div>
    </section>
  );
}

/** One message: your prompts in a bubble, Claude's answers as formatted text, and each tool call as one line. */
function Message({ message }: { message: RemoteMessage }) {
  if (message.role === 'user') {
    const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : b.type === 'image' ? ['[image]'] : [])).join('\n\n');
    if (!text.trim()) return null;
    return (
      <div className="grid justify-items-end gap-1">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-border/60 px-3.5 py-2 text-body">{text}</div>
        {message.device && <span className="text-meta text-faint">from {message.device}</span>}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
      {message.blocks.map((block, index) => {
        if (block.type === 'text') return <RemoteText key={index} text={block.text} />;
        if (block.type === 'tool_use') {
          const line = toolLine(block.name, block.input);
          return (
            <p key={index} className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
              <Wrench size={11} aria-hidden className="shrink-0" />
              <span className="shrink-0 font-medium">{block.name}</span>
              {line && <span className="min-w-0 truncate font-mono">{line}</span>}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}
