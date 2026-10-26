import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, Copy, EyeOff, MessageCircleQuestion, Plus, Quote, X } from 'lucide-react';
import { MAX_SIDE_QUESTION_LENGTH } from '@seshboard/protocol/remote-client';
import { age } from '../lib/groups.ts';
import { ASK_SUGGESTIONS, currentThread, lastQuestion, newThread, pickedThread, threadRows, type AskEntry, type SessionAsk } from '../lib/ask.ts';
import { askAbout, retryAsk, updateAsk } from './askStore.ts';
import type { Client } from './Connected.tsx';
import { Markdown, StreamingMarkdown } from './Markdown.tsx';
import { MenuButton, type MenuItem } from './Menu.tsx';
import { Sheet } from './Sheet.tsx';
import { useNow } from './SessionList.tsx';
import { toast } from './Toasts.tsx';
import { Button } from './ui.tsx';

interface AskProps {
  client: Client;
  sessionId: string;
  state: SessionAsk;
  /** Claude is working on a turn right now. */
  working: boolean;
  /** Quote in message: the answer goes into the message box as a quote. */
  onQuote: (answer: string) => void;
  onClose: () => void;
}

const TITLE = 'Ask about this session';

/**
 * Ask about this session in a bottom sheet (a phone, or a window too narrow for the panel): questions about the
 * session that never reach the conversation. Claude answers from the conversation and the project while it keeps
 * working.
 */
export function AskSheet(props: AskProps) {
  const thread = currentThread(props.state);
  return (
    <Sheet title={<AskTitle />} label={TITLE} subtitle={<NotInConversation />} onClose={props.onClose} tall hook="ask" footer={<AskField {...props} />}>
      {threadRows(props.state).length > 0 && (
        <div className="-mt-1 -ml-4 flex items-center gap-1 pb-1 pointer-fine:-ml-2.5">
          <ThreadActions {...props} />
        </div>
      )}
      <AskThreadView {...props} key={thread?.id ?? 'new'} />
    </Sheet>
  );
}

/** The same on the right of a wide window (1280px and more), in the Changes panel's place. */
export function AskPanel(props: AskProps) {
  const thread = currentThread(props.state);
  return (
    <aside aria-label={TITLE} className="flex w-[390px] shrink-0 flex-col border-l border-border bg-bg" data-remote-ask-panel>
      <header className="safe-top border-b border-border px-4 pb-1.5">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-title font-semibold">
            <AskTitle />
          </h2>
          <Button variant="quiet" size="md" aria-label="Close Ask" onClick={props.onClose} className="-mr-2 px-2!">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="flex min-h-7 items-center gap-1">
          <span className="min-w-0 flex-1">
            <NotInConversation />
          </span>
          <ThreadActions {...props} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" data-remote-ask-scroll>
        <AskThreadView {...props} key={thread?.id ?? 'new'} />
      </div>
      <footer className="safe-bottom border-t border-border px-4 pt-3">
        <AskField {...props} />
      </footer>
    </aside>
  );
}

function AskTitle() {
  return (
    <span className="flex items-center gap-1.5">
      <MessageCircleQuestion className="size-4 shrink-0 text-link" aria-hidden />
      {TITLE}
    </span>
  );
}

function NotInConversation() {
  return (
    <span className="flex items-center gap-1 text-meta text-muted">
      <EyeOff className="size-3 shrink-0" aria-hidden />
      Not added to the conversation
    </span>
  );
}

/** New thread while one is on screen, and Earlier threads (the `⋯` menu) once there are some. */
function ThreadActions({ sessionId, state }: AskProps) {
  const now = useNow();
  const rows = threadRows(state);
  const items: MenuItem[] = [
    { kind: 'note', label: 'Earlier threads' },
    ...rows.map(
      (row): MenuItem => ({
        label: row.title,
        hint: row.current ? 'On screen' : `${row.count} ${row.count === 1 ? 'question' : 'questions'} · ${age(row.createdAt, now)}`,
        onSelect: () => updateAsk(sessionId, (s) => pickedThread(s, row.id)),
      }),
    ),
  ];
  return (
    <>
      {currentThread(state) && (
        <Button variant="quiet" size="md" onClick={() => updateAsk(sessionId, newThread)} data-remote-ask-new>
          <Plus className="size-4" aria-hidden />
          New thread
        </Button>
      )}
      {rows.length > 0 && <MenuButton label="Earlier threads" items={items} />}
    </>
  );
}

/**
 * The thread on screen: each question as a bubble on the right, Claude's answer under it, with Copy and Quote in
 * message. It follows an answer as it comes in, unless you scrolled up to read. A new thread starts with what Ask is
 * and four questions to tap.
 */
function AskThreadView({ client, sessionId, state, onQuote }: AskProps) {
  const thread = currentThread(state);
  const items = thread?.items ?? [];
  const end = useRef<HTMLDivElement>(null);
  const last = items.at(-1);
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const scroller = end.current?.closest<HTMLElement>('.overflow-y-auto');
    if (!scroller) return;
    const onScroll = () => (stuck.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);
  // A question just asked: back to the bottom.
  useLayoutEffect(() => {
    stuck.current = true;
  }, [items.length]);
  useLayoutEffect(() => {
    if (stuck.current) end.current?.scrollIntoView({ block: 'end' });
  }, [last?.answer, last?.status, items.length]);

  if (!items.length) return <Intro client={client} sessionId={sessionId} />;
  return (
    <>
      <div data-remote-ask-thread={thread?.id}>
        {items.map((item) => (
          <Item
            key={item.id}
            item={item}
            onQuote={() => onQuote(item.answer)}
            onRetry={() => thread && void retryAsk(client, sessionId, thread.id, item.id, item.question).catch((e: Error) => toast(e.message, { tone: 'error' }))}
          />
        ))}
      </div>
      <div ref={end} />
    </>
  );
}

function Intro({ client, sessionId }: { client: Client; sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const ask = (question: string) => {
    setBusy(true);
    void askAbout(client, sessionId, question)
      .catch((e: Error) => toast(`Not asked: ${e.message}`, { tone: 'error' }))
      .finally(() => setBusy(false));
  };
  return (
    <div className="py-3" data-remote-ask-intro>
      <p className="text-body text-muted">Ask anything about this session. Claude answers from the conversation and the project, while it keeps working. Nothing is added to the conversation.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ASK_SUGGESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => ask(question)}
            disabled={busy || !client}
            className="flex min-h-9 items-center rounded-full border border-link/40 bg-link/10 px-3 text-ui text-link transition-colors enabled:hover:bg-link/20 disabled:opacity-50 pointer-fine:min-h-7"
            data-remote-ask-suggestion={question}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

function Item({ item, onQuote, onRetry }: { item: AskEntry; onQuote: () => void; onRetry: () => void }) {
  const copy = () =>
    void navigator.clipboard.writeText(item.answer).then(
      () => toast('Copied'),
      () => toast("Couldn't copy.", { tone: 'error' }),
    );
  return (
    <div className="border-b border-border py-3 last:border-b-0" data-remote-ask-item={item.status}>
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-xl border border-border bg-card px-3 py-1.5 text-body break-words whitespace-pre-wrap">{item.question}</p>
      </div>
      <div className="mt-2 min-w-0">
        {item.status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 text-ui text-error">{item.error}</span>
            <Button size="md" onClick={onRetry} data-remote-ask-retry>
              Try again
            </Button>
          </div>
        ) : item.status === 'answering' ? (
          <div aria-busy="true">
            {item.answer && <StreamingMarkdown text={item.answer} />}
            <p role="status" className="mt-1.5 flex items-center gap-1.5 text-meta text-link" data-remote-ask-answering>
              <span aria-hidden className="size-3 animate-spin rounded-full border-[1.5px] border-link/25 border-t-link" />
              Answering
            </p>
          </div>
        ) : (
          <>
            <Markdown text={item.answer} />
            <div className="mt-1 -ml-2 flex items-center gap-0.5">
              <Button variant="quiet" size="md" onClick={copy} data-remote-ask-copy>
                <Copy className="size-3.5" aria-hidden />
                Copy
              </Button>
              <Button variant="quiet" size="md" onClick={onQuote} data-remote-ask-quote>
                <Quote className="size-3.5" aria-hidden />
                Quote in message
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The question field: ↵ asks (⇧↵ for a new line, with a keyboard), ↑ in an empty field brings back the last question. */
function AskField({ client, sessionId, state, working }: AskProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const hasItems = Boolean(currentThread(state)?.items.length);
  const ask = async () => {
    const question = text.trim();
    if (!question || sending) return;
    if (question.length > MAX_SIDE_QUESTION_LENGTH) return setNotice(`A question can be up to ${MAX_SIDE_QUESTION_LENGTH.toLocaleString('en-US')} characters.`);
    setSending(true);
    setNotice(null);
    try {
      await askAbout(client, sessionId, question);
      setText((current) => (current === text ? '' : current));
    } catch (error) {
      setNotice(`Not asked: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    // On a touch screen ↵ is a new line: the button asks.
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && matchMedia('(pointer: fine)').matches) {
      event.preventDefault();
      void ask();
    } else if (event.key === 'ArrowUp' && !text) {
      const previous = lastQuestion(state);
      if (!previous) return;
      event.preventDefault();
      setText(previous);
      requestAnimationFrame(() => field.current?.setSelectionRange(previous.length, previous.length));
    }
  };
  return (
    <Field notice={notice}>
      <textarea
        ref={field}
        value={text}
        rows={1}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKey}
        disabled={!client}
        placeholder={client ? (hasItems ? 'Ask a follow-up…' : 'Ask a question…') : 'Waiting for your computer…'}
        aria-label="Question about this session"
        enterKeyHint="send"
        className="block max-h-40 w-full resize-none bg-transparent text-body outline-none [field-sizing:content] placeholder:text-faint disabled:opacity-60"
        data-remote-ask-field
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-meta text-muted">{working ? 'Claude keeps working' : 'Claude is idle'}</span>
        <button
          type="button"
          aria-label="Ask"
          onClick={() => void ask()}
          disabled={!text.trim() || sending || !client}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-link text-bg transition-colors enabled:hover:bg-link/85 disabled:opacity-40 pointer-fine:size-7"
          data-remote-ask-send
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      </div>
    </Field>
  );
}

function Field({ notice, children }: { notice: string | null; children: ReactNode }) {
  return (
    <div>
      {notice && (
        <p role="alert" className="mb-1 text-meta text-error">
          {notice}
        </p>
      )}
      <div className="rounded-lg border border-link/45 bg-card px-2.5 pt-2 pb-1.5 focus-within:border-link">{children}</div>
    </div>
  );
}
