import { ArrowUp, Clock, Copy, EyeOff, MessageCircleQuestion, Plus, Quote, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { MAX_SIDE_QUESTION_LENGTH } from '@seshboard/protocol/client';
import { agoText } from '../../lib/format.ts';
import { currentThread, lastQuestion, threadRows, type AskEntry, type SessionAsk } from '../../state/ask.ts';
import { useAsk } from '../../state/askStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { Markdown, StreamingMarkdown } from '../transcript/Markdown.tsx';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from './askWidth.ts';

/** The questions the first open offers; a click asks one. */
export const ASK_SUGGESTIONS = ['What changed so far?', 'Which files did it touch?', 'Why this approach?', 'What is left to do?'] as const;

interface AskPanelProps {
  sessionId: string;
  state: SessionAsk;
  /** Claude is working on a turn right now. */
  working: boolean;
  width: number;
  onWidth(width: number): void;
  /** Changes is open too: this row of tabs stands in for the title, with the panel's buttons on its right. */
  tabs?: (actions: ReactNode) => ReactNode;
  /** Asks in the thread on screen (a new thread when none is). */
  onAsk(question: string): Promise<void>;
  onRetry(threadId: string, item: AskEntry): void;
  /** Quote in message: the answer goes into the message box as a quote. */
  onQuote(answer: string): void;
  onNewThread(): void;
  onPickThread(threadId: string): void;
  onClose(): void;
  /** Why nothing can be asked now (not connected, no folder). */
  disabledReason?: string | null;
}

/**
 * Ask about this session: questions about the session on the right, next to the conversation, that never reach it.
 * Each thread shows its questions as bubbles with Claude's answers under them; the field at the bottom asks a
 * follow-up, which goes with the thread's earlier questions and answers. Claude answers while it keeps working.
 */
export function AskPanel(props: AskPanelProps) {
  const { sessionId, state } = props;
  const thread = currentThread(state);
  const items = thread?.items ?? [];
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const menu = useMenu();
  const threadsRef = useRef<HTMLButtonElement>(null);

  // The Ask button with an empty box, the palette and New thread put the caret here, once (the panel may only mount
  // after the request).
  const focus = useAsk((s) => (s.focus?.sessionId === sessionId ? s.focus.nonce : 0));
  useEffect(() => {
    if (!focus) return;
    // Ask about this (from reading mode) starts the field with the selection quoted, the caret under it.
    const prefill = useAsk.getState().focus?.prefill;
    useAsk.setState({ focus: null });
    if (prefill) setText(prefill);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      if (prefill) field.setSelectionRange(prefill.length, prefill.length);
    });
  }, [focus]);

  // The thread sticks to the bottom while an answer comes in, unless you scrolled up to read.
  const stick = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const last = items.at(-1);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [last?.answer, last?.status, items.length, thread?.id]);
  // A question just asked, or another thread: back to the bottom.
  useLayoutEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, thread?.id]);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || sending || props.disabledReason) return;
    if (trimmed.length > MAX_SIDE_QUESTION_LENGTH) return setNotice(`A question can be up to ${MAX_SIDE_QUESTION_LENGTH.toLocaleString('en-US')} characters.`);
    setSending(true);
    setNotice(null);
    try {
      await props.onAsk(trimmed);
      setText((current) => (current === question ? '' : current));
    } catch (error) {
      setNotice(`Not asked: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
      fieldRef.current?.focus();
    }
  };

  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void ask(text);
    } else if (event.key === 'Escape') {
      // First the field lets go; Escape again (on the panel) closes it.
      event.preventDefault();
      event.stopPropagation();
      asideRef.current?.focus();
    } else if (event.key === 'ArrowUp' && !text) {
      const previous = lastQuestion(state);
      if (!previous) return;
      event.preventDefault();
      setText(previous);
      requestAnimationFrame(() => fieldRef.current?.setSelectionRange(previous.length, previous.length));
    }
  };
  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
    event.preventDefault();
    props.onClose();
  };

  // Drag the left edge to resize; ← → do the same from the keyboard.
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = props.width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => props.onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = askWidthForKey(event.key, props.width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    props.onWidth(next);
  };

  const rows = threadRows(state);
  const threadEntries: MenuEntry[] = [
    { title: 'Threads in this session' },
    ...(rows.length
      ? rows.map(
          (row): MenuEntry => ({
            label: row.title,
            detail: `${row.count} ${row.count === 1 ? 'question' : 'questions'} · ${agoText(row.createdAt)}`,
            checked: row.current,
            onSelect: () => props.onPickThread(row.id),
            data: { 'data-ask-thread': row.id },
          }),
        )
      : [{ note: 'No threads yet. Your questions will show here.' }]),
  ];

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        ref={threadsRef}
        variant="quiet"
        size="sm"
        iconOnly
        icon={<Clock size={13} aria-hidden />}
        aria-label="Earlier threads"
        aria-haspopup="menu"
        aria-expanded={!!menu.at}
        selected={!!menu.at}
        onClick={(e) => (menu.at ? menu.close() : menu.openBelow(e.currentTarget))}
        data-ask-threads
      />
      <Button variant="quiet" size="sm" iconOnly icon={<Plus size={14} aria-hidden />} aria-label="New thread" onClick={props.onNewThread} data-ask-new-thread />
      <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close" kbd="Esc" onClick={props.onClose} data-ask-close />
    </div>
  );
  const notInConversation = (
    <span className="flex min-w-0 items-center gap-1 text-meta text-muted">
      <EyeOff size={12} aria-hidden className="shrink-0" />
      <span className="truncate">not added to the conversation</span>
    </span>
  );

  return (
    <aside
      ref={asideRef}
      aria-label="Ask about this session"
      tabIndex={-1}
      onKeyDown={onPanelKey}
      className="relative flex max-w-[85%] min-w-0 shrink-0 flex-col border-l border-border bg-bg outline-none"
      style={{ width: props.width }}
      data-ask-panel
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ask panel width"
        aria-valuenow={props.width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-link/40 focus-visible:bg-link/40"
        data-tooltip="Drag (or use ← →) to resize"
        data-ask-resize
      />
      {props.tabs ? (
        <>
          {props.tabs(actions)}
          <div className="flex h-7 shrink-0 items-center border-b border-border px-3">{notInConversation}</div>
        </>
      ) : (
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 pt-2.5 pb-2">
          <MessageCircleQuestion size={16} aria-hidden className="mt-0.5 shrink-0 text-link" />
          <div className="grid min-w-0 flex-1">
            <h2 className="truncate text-ui font-semibold text-text">Ask about this session</h2>
            {notInConversation}
          </div>
          {actions}
        </header>
      )}
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={300} entries={threadEntries} onClose={menu.close} label="Threads in this session" anchor={threadsRef} />}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3" data-ask-thread-view={thread?.id ?? 'new'}>
        {items.length === 0 ? (
          <Intro disabled={!!props.disabledReason || sending} onAsk={(q) => void ask(q)} />
        ) : (
          items.map((item) => <Item key={item.id} item={item} onRetry={() => thread && props.onRetry(thread.id, item)} onQuote={() => props.onQuote(item.answer)} />)
        )}
      </div>

      <div className="shrink-0 px-3 pt-1 pb-3">
        {notice && (
          <p role="alert" className="mb-1 text-meta text-error">
            {notice}
          </p>
        )}
        <div className="rounded-lg border border-link/45 bg-card px-2.5 pt-2 pb-1.5 focus-within:border-link">
          <textarea
            ref={fieldRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onFieldKey}
            disabled={!!props.disabledReason}
            placeholder={props.disabledReason ?? (items.length ? 'Ask a follow-up…' : 'Ask a question…')}
            aria-label="Question about this session"
            spellCheck
            className="block field-sizing-content max-h-40 w-full resize-none bg-transparent text-body leading-relaxed text-text outline-none placeholder:text-faint disabled:opacity-60"
            data-ask-field
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-meta text-muted" data-ask-claude={props.working ? 'working' : 'idle'}>
              {props.working ? 'Claude keeps working' : 'Claude is idle'}
            </span>
            <Button
              variant="side"
              filled
              round
              size="sm"
              iconOnly
              icon={<ArrowUp size={13} aria-hidden />}
              aria-label="Ask"
              kbd="↵"
              onClick={() => void ask(text)}
              disabled={!text.trim() || sending || !!props.disabledReason}
              data-ask-send
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

/** A thread with no questions yet: what this is, and four questions to start with. */
function Intro({ disabled, onAsk }: { disabled: boolean; onAsk(question: string): void }) {
  return (
    <div className="py-4" data-ask-intro>
      <p className="text-body leading-relaxed text-muted">Ask anything about this session. Claude answers from the conversation and the project, while it keeps working. Nothing is added to the conversation.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ASK_SUGGESTIONS.map((question) => (
          <Pill key={question} tone="link" onClick={() => onAsk(question)} disabled={disabled} data-ask-suggestion={question}>
            {question}
          </Pill>
        ))}
      </div>
    </div>
  );
}

/** One question as a bubble on the right, and its answer under it as a normal reply. */
function Item({ item, onRetry, onQuote }: { item: AskEntry; onRetry(): void; onQuote(): void }) {
  const [copied, flashCopied] = useFlash(1000);
  return (
    <div className="border-b border-border py-3 last:border-b-0" data-ask-item={item.status}>
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-xl border border-border bg-card px-3 py-1.5 text-body break-words whitespace-pre-wrap text-text" data-ask-question>
          {item.question}
        </p>
      </div>
      <div className="mt-2 min-w-0 text-body" data-ask-answer={item.status}>
        {item.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            <span className="min-w-0 text-error select-text">{item.error}</span>
            <Button size="sm" onClick={onRetry} data-ask-retry>
              Try again
            </Button>
          </div>
        ) : item.status === 'answering' ? (
          <>
            <div className="stream-caret" aria-busy="true">
              {item.answer && <StreamingMarkdown text={item.answer} />}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-meta text-link" role="status" data-ask-answering>
              <span className="size-3 animate-spin rounded-full border-[1.5px] border-link/25 border-t-link" aria-hidden />
              Answering
            </p>
          </>
        ) : (
          <>
            <Markdown text={item.answer} />
            <div className="mt-1 -ml-1.5 flex items-center gap-0.5">
              <Button
                variant="quiet"
                size="sm"
                icon={<Copy size={12} aria-hidden />}
                onClick={() => void navigator.clipboard.writeText(item.answer).then(() => flashCopied('Copied'), () => {})}
                data-tooltip="Copy the answer as markdown"
                data-ask-copy={copied ? 'copied' : ''}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="quiet" size="sm" icon={<Quote size={12} aria-hidden />} onClick={onQuote} data-tooltip="Put the answer in the message box as a quote" data-ask-quote>
                Quote in message
              </Button>
            </div>
            {copied && (
              <span className="sr-only" role="status">
                Copied
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
