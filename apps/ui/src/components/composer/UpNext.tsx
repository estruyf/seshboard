import { GripVertical, Pencil, Play, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { QueuedMessage, SessionHostInfo } from '@switchboard/protocol/client';
import { matches } from '../../lib/shortcuts.ts';
import { moveTarget } from '../../state/queue.ts';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { attachmentLabel, firstLine, focusAfterRemoval, holdNote, upNextTitle } from './upNext.ts';

export interface UpNextActions {
  /** Takes the message back into the message box. */
  edit(message: QueuedMessage): void;
  remove(message: QueuedMessage): void;
  /** Sends this one now, stopping Claude's turn; the rest keep waiting. */
  sendNow(message: QueuedMessage): void;
  move(id: string, toIndex: number): void;
  /** After a stopped or failed turn: sends the next one and lets the list move on again. */
  resume(): void;
}

const DRAG_TYPE = 'application/x-switchboard-up-next';

/**
 * The list's mask while rows wait out of view above or below it: that edge fades out, so a cut-off list reads as one
 * to scroll rather than as rows hidden behind the message box.
 */
function edgeMask(edges: { above: boolean; below: boolean }): string | undefined {
  if (!edges.above && !edges.below) return undefined;
  const top = edges.above ? 'transparent, #000 0.75rem' : '#000';
  const bottom = edges.below ? '#000 calc(100% - 0.75rem), transparent' : '#000';
  return `linear-gradient(to bottom, ${top}, ${bottom})`;
}

/**
 * The messages you sent while Claude was working, pinned above the message box until their turn comes: one goes
 * each time Claude finishes. Each can be edited (back into the message box), removed, moved (drag, or ⌥↑ ⌥↓) or
 * sent now. They are not in the conversation yet, so none of this changes what Claude has seen.
 */
export function UpNext({ queue, hold, limited = false, actions }: { queue: readonly QueuedMessage[]; hold: SessionHostInfo['queueHold']; limited?: boolean; actions: UpNextActions }) {
  const listRef = useRef<HTMLUListElement>(null);
  const idsRef = useRef<string[]>([]);
  idsRef.current = queue.map((m) => m.id);
  const drag = useQueueDrag({ ids: () => idsRef.current, move: (id, to) => actions.move(id, to), mime: DRAG_TYPE });
  const note = holdNote(hold, queue.length, limited);

  // Whether rows wait out of view above or below, measured as it scrolls, resizes and changes.
  const [edges, setEdges] = useState({ above: false, below: false });
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const above = list.scrollTop > 1;
      const below = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
      setEdges((current) => (current.above === above && current.below === below ? current : { above, below }));
    };
    measure();
    list.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      list.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [queue.length]);

  // After a row is removed or sent, focus would fall to the page: keep it in the list.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(id)}"]`)?.focus();
  }, [queue]);

  if (queue.length === 0) return null;

  const leave = (message: QueuedMessage, act: (message: QueuedMessage) => void) => {
    pendingFocus.current = focusAfterRemoval(idsRef.current, message.id);
    act(message);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, message: QueuedMessage) => {
    const native = event.nativeEvent;
    if (matches(native, 'upnext.move')) {
      event.preventDefault();
      const to = moveTarget(idsRef.current, message.id, native.key === 'ArrowUp' ? -1 : 1);
      if (to !== null) {
        pendingFocus.current = message.id;
        actions.move(message.id, to);
      }
    } else if (matches(native, 'upnext.remove') || event.key === 'Delete') {
      event.preventDefault();
      leave(message, actions.remove);
    }
  };

  return (
    <section aria-label="Up next" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5" data-queue>
      <SectionHeader count={queue.length}>Up next</SectionHeader>
      {/* Heard once when the list changes, not once per row. */}
      <span role="status" className="sr-only">
        {upNextTitle(queue.length)}
      </span>
      {note && (
        <div className="flex items-center gap-2 px-1 text-meta text-muted" data-queue-hold={limited ? 'limit' : hold}>
          <span className="min-w-0 flex-1 truncate">{note}</span>
          {/* Sending into the limit would only fail: Resume in the notice above lets it go. */}
          {!limited && (
            <Button size="sm" icon={<Play size={10} fill="currentColor" aria-hidden />} onClick={actions.resume} data-queue-resume>
              Send next
            </Button>
          )}
        </div>
      )}
      {/*
        One column that can shrink: a long message is cut with an ellipsis instead of widening every row past the
        pane (which pushed the row's actions out of view). Five whole rows show (28px each, 1px apart); more scroll,
        a whole row at a time, never stopping with one half under the message box.
      */}
      <ul
        ref={listRef}
        className="grid max-h-[calc(5*1.75rem+4px)] snap-y snap-mandatory grid-cols-[minmax(0,1fr)] gap-px overflow-x-hidden overflow-y-auto"
        style={{ maskImage: edgeMask(edges) }}
        aria-label="Messages waiting for Claude"
        data-queue-list
        data-queue-more={edges.below || undefined}
      >
        {queue.map((message, index) => {
          const text = firstLine(message.text);
          const attachments = attachmentLabel(message.attachments);
          const mark = drag.markFor(message.id);
          return (
            <li
              key={message.id}
              className={`group/up relative flex h-7 min-w-0 snap-start items-center gap-1.5 rounded-lg pr-1 pl-3 hover:bg-border/45 focus-within:bg-border/45 ${drag.dragging === message.id ? 'opacity-50' : ''}`}
              data-queue-item-row={message.id}
              {...drag.props(message.id)}
            >
              {mark && <span aria-hidden className={`absolute inset-x-2 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-px' : '-bottom-px'}`} data-queue-drop={mark} />}
              <GripVertical size={12} className="absolute left-0 shrink-0 cursor-grab text-faint opacity-0 group-hover/up:opacity-100" aria-hidden />
              <button
                type="button"
                data-queue-item={message.id}
                aria-label={`Up next, ${index + 1} of ${queue.length}: ${text || attachments || 'message'}. Enter edits it, Option and arrows move it, Backspace removes it.`}
                data-tooltip={message.text.length > 400 ? `${message.text.slice(0, 399)}…` : message.text || undefined}
                onClick={() => actions.edit(message)}
                onKeyDown={(event) => onKeyDown(event, message)}
                className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md py-1 text-left"
              >
                <span className="min-w-0 truncate text-ui text-text/90">{text || <span className="text-muted">{attachments ?? 'Message'}</span>}</span>
                {text && attachments && <span className="shrink-0 rounded-full bg-border/60 px-1.5 text-meta text-muted">{attachments}</span>}
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button variant="quiet" size="sm" icon={<Zap size={11} aria-hidden />} onClick={() => leave(message, actions.sendNow)} data-tooltip="Stop Claude and send this now" aria-label={`Send now: ${text || 'message'}`} data-queue-send-now={message.id}>
                  Send now
                </Button>
                <Button variant="quiet" size="sm" iconOnly icon={<Pencil size={12} aria-hidden />} aria-label="Edit" onClick={() => actions.edit(message)} tabIndex={-1} className="opacity-0 group-hover/up:opacity-100 group-focus-within/up:opacity-100" />
                <Button variant="quiet" size="sm" iconOnly icon={<X size={12} aria-hidden />} aria-label="Remove" onClick={() => leave(message, actions.remove)} tabIndex={-1} className="opacity-0 group-hover/up:opacity-100 group-focus-within/up:opacity-100" data-queue-remove={message.id} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
