import { ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Copy, EyeOff, MessageCircleDashed, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { StreamingMarkdown, Markdown } from '../transcript/Markdown.tsx';
import { Button } from '../ui/Button.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useClaudeUpdate } from '../../state/claudeUpdateStore.ts';
import { chipLabel, current, position, type SessionSide, type SideItem } from '../../state/sideQuestions.ts';
import { SIDE_TOKEN } from '../composer/sideToken.ts';

interface PanelProps {
  state: SessionSide;
  onClose(): void;
  onMove(step: -1 | 1): void;
  onExpand(): void;
  onRetry(item: SideItem): void;
}

/**
 * The side question panel (/btw) over the message box: the question as its title and Claude's answer, which is
 * never part of the conversation. It floats over the transcript, so the conversation doesn't move, and is at most
 * 40% of the window (70% after Show all, with its own scroll).
 */
export function SideQuestionPanel({ state, onClose, onMove, onExpand, onRetry }: PanelProps) {
  const item = current(state);
  const { index, count } = position(state);
  const view = state.view?.kind ?? 'usage';
  const [copied, flashCopied] = useFlash(1000);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };
  return (
    <section
      role="region"
      aria-label="Side question"
      className="side-panel flex max-h-[40vh] flex-col rounded-xl px-4 pt-3 pb-3 data-[expanded]:max-h-[70vh]"
      data-btw-panel={view}
      data-expanded={state.expanded || undefined}
      onKeyDown={onKeyDown}
    >
      <header className="flex min-h-6 shrink-0 items-center gap-2">
        <span className="flex items-center gap-1.5 text-meta font-semibold tracking-wider text-link uppercase">
          <MessageCircleDashed size={13} aria-hidden />
          Side question
        </span>
        <span className="flex min-w-0 items-center gap-1 text-meta text-muted">
          <EyeOff size={12} aria-hidden className="shrink-0" />
          <span className="truncate">not in the conversation</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {item?.status === 'answering' && (
            <span className="mr-1.5 flex items-center gap-1.5 text-meta text-link" role="status" data-btw-answering>
              <span className="size-3 animate-spin rounded-full border-[1.5px] border-link/25 border-t-link" aria-hidden />
              Answering
            </span>
          )}
          {item && (
            <>
              <Button variant="quiet" size="sm" iconOnly icon={<ChevronLeft size={14} aria-hidden />} aria-label="Earlier side question" disabled={index <= 0} onClick={() => onMove(-1)} data-btw-prev />
              <span className="min-w-12 text-center text-meta text-muted tabular-nums" data-btw-position>
                {index + 1} of {count}
              </span>
              <Button variant="quiet" size="sm" iconOnly icon={<ChevronRight size={14} aria-hidden />} aria-label="Later side question" disabled={index >= count - 1} onClick={() => onMove(1)} data-btw-next />
              {item.status === 'done' && (
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={<Copy size={13} aria-hidden />}
                  aria-label={copied ? 'Copied' : 'Copy answer'}
                  data-tooltip={copied ? 'Copied' : 'Copy the answer as markdown'}
                  onClick={() => void navigator.clipboard.writeText(item.answer).then(() => flashCopied('Copied'), () => {})}
                  data-btw-copy={copied ? 'copied' : ''}
                />
              )}
            </>
          )}
          <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close" data-tooltip="Close (Esc)" onClick={onClose} data-btw-close />
        </div>
      </header>
      {item ? <ItemBody item={item} expanded={state.expanded} onExpand={onExpand} onRetry={() => onRetry(item)} /> : view === 'needs-question' ? <NeedsQuestion /> : <Usage />}
      {copied && (
        <span className="sr-only" role="status">
          Copied
        </span>
      )}
    </section>
  );
}

function ItemBody({ item, expanded, onExpand, onRetry }: { item: SideItem; expanded: boolean; onExpand(): void; onRetry(): void }) {
  const body = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  // A long answer fades out under Show all; measured again as it grows and when the window changes size.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || expanded) return setOverflows(false);
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.answer, item.id, expanded]);
  return (
    <>
      <h2 className="mt-2 shrink-0 text-title font-semibold text-text" data-btw-question>
        {item.question}
      </h2>
      <div className="relative mt-1 flex min-h-0 flex-1 flex-col">
        <div ref={body} className={`min-h-0 flex-1 ${expanded ? 'overflow-y-auto' : 'overflow-hidden'}`} data-btw-answer={item.status}>
          {item.status === 'error' ? (
            <div className="flex flex-wrap items-center gap-2 py-1 text-body text-error" role="alert">
              <span className="min-w-0">{item.error}</span>
              <Button size="sm" onClick={onRetry} data-btw-retry>
                Try again
              </Button>
            </div>
          ) : item.status === 'answering' ? (
            <div className="stream-caret" aria-busy="true">
              {item.answer && <StreamingMarkdown text={item.answer} />}
            </div>
          ) : (
            <Markdown text={item.answer} />
          )}
        </div>
        {overflows && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-linear-to-t from-popover to-transparent">
            <Button variant="quiet" size="sm" className="pointer-events-auto" onClick={onExpand} data-btw-show-all>
              Show all
              <ChevronDown size={13} aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function Message({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <>
      <h2 className="mt-2 text-title font-semibold text-text">{title}</h2>
      <p className="mt-1 text-body leading-relaxed text-muted">{children}</p>
      {action && <div className="mt-2.5">{action}</div>}
    </>
  );
}

const Command = () => <code className="rounded bg-link/12 px-1 py-px font-mono text-ui text-link">{SIDE_TOKEN}</code>;

/** `/btw` without a question, before any was asked. */
function Usage() {
  return (
    <Message title={`Ask a side question with ${SIDE_TOKEN}`}>
      Type <Command /> and your question. Claude answers from this session, while it keeps working. The answer isn't added to the conversation.
    </Message>
  );
}

/** `/btw` without a question, on a Claude Code that can't show earlier side questions. */
function NeedsQuestion() {
  const claude = useClaudeUpdate((s) => s.state);
  return (
    <Message
      title={`${SIDE_TOKEN} needs a question`}
      action={
        <Button
          size="sm"
          icon={<ArrowUp size={13} aria-hidden />}
          onClick={() => {
            // As the update toast does: the output (and any error) shows in Settings → About.
            useSessions.getState().openSettings('about');
            if (claude?.canUpdate) useClaudeUpdate.getState().update();
          }}
          data-tooltip={claude?.canUpdate && claude.command ? `Runs ${claude.command}` : undefined}
          data-btw-update
        >
          Update Claude Code
        </Button>
      }
    >
      This version of Claude Code can't show earlier side questions. Add a question after <Command />, or update Claude Code to browse them.
    </Message>
  );
}

/** Above the message box after the panel was closed: brings back the side question asked here. */
export function SideQuestionChip({ item, onOpen }: { item: SideItem; onOpen(): void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-ui ${item.status === 'error' ? 'border-error/40 bg-error/10 text-error' : 'border-link/40 bg-link/10 text-link'} hover:bg-link/15`}
      data-btw-chip={item.status}
      data-tooltip="Show the side question"
    >
      {item.status === 'answering' ? <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-link/25 border-t-link" aria-hidden /> : <MessageCircleDashed size={13} aria-hidden className="shrink-0" />}
      <span className="shrink-0 font-medium">{chipLabel(item)}</span>
      <span className="min-w-0 truncate text-muted">· {item.question}</span>
    </button>
  );
}
