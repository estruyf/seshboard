import { GripVertical, X, Zap } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { REMOTE_FEATURE_QUEUE_MOVE, REMOTE_FEATURE_QUEUE_SEND_NOW, withoutContext, type Computer, type Contract, type QueuedMessage, type RpcClient } from '@seshboard/protocol/client';
import { matches } from '../../lib/shortcuts.ts';
import { moveTarget } from '../../state/queue.ts';
import { toast } from '../../state/toastStore.ts';
import { attachmentLabel, firstLine, holdNote, upNextTitle } from '../composer/upNext.ts';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { callComputer } from './callComputer.ts';

const DRAG_TYPE = 'application/x-seshboard-remote-up-next';

/**
 * The messages waiting in the Up next of a session on another computer, above the message box as for a local session.
 * Send now (from a computer with `REMOTE_FEATURE_QUEUE_SEND_NOW`) stops Claude there and sends it, and the remote
 * contract takes one back (`session.queue.remove`). From a computer with `REMOTE_FEATURE_QUEUE_MOVE` they can be put in
 * another order (drag, or ⌥↑ ⌥↓), as on this one; editing stays on that computer. While its profile is at a usage limit
 * the list says they are held.
 */
export function RemoteUpNext({ client, computer, sessionId, queue, limited }: {
  client: RpcClient<Contract>;
  computer: Computer;
  sessionId: string;
  queue: readonly QueuedMessage[];
  limited: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const idsRef = useRef<string[]>([]);
  idsRef.current = queue.map((m) => m.id);
  const canMove = computer.features.includes(REMOTE_FEATURE_QUEUE_MOVE);
  const move = (id: string, toIndex: number) => callComputer(client, computer.id, 'session.queue.move', { sessionId, id, toIndex }).catch((e: Error) => toast(`Could not move the message: ${e.message}`));
  const drag = useQueueDrag({ ids: () => idsRef.current, move, mime: DRAG_TYPE });

  // The row moved with the keys keeps the focus once the other computer sends the new order.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(id)}"]`)?.focus();
  }, [queue]);

  if (queue.length === 0) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, message: QueuedMessage) => {
    const native = event.nativeEvent;
    if (!matches(native, 'upnext.move')) return;
    event.preventDefault();
    const to = moveTarget(idsRef.current, message.id, native.key === 'ArrowUp' ? -1 : 1);
    if (to === null) return;
    pendingFocus.current = message.id;
    void move(message.id, to);
  };
  const note = holdNote(null, queue.length, limited);
  const remove = (message: QueuedMessage) =>
    void callComputer(client, computer.id, 'session.queue.remove', { sessionId, id: message.id }).catch((e: Error) => toast(e.message));
  const sendNow = computer.features.includes(REMOTE_FEATURE_QUEUE_SEND_NOW)
    ? (message: QueuedMessage) => void callComputer(client, computer.id, 'session.queue.sendNow', { sessionId, id: message.id }).catch((e: Error) => toast(`Could not send the message: ${e.message}`))
    : null;
  return (
    <section aria-label="Up next" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5" data-queue>
      <SectionHeader count={queue.length}>Up next</SectionHeader>
      <span role="status" className="sr-only">
        {upNextTitle(queue.length)}
      </span>
      {note && (
        <div className="px-1 text-meta text-muted" data-queue-hold={limited ? 'limit' : undefined}>
          <span className="block truncate">{note}</span>
        </div>
      )}
      <ul ref={listRef} className="grid max-h-[calc(5*1.75rem+4px)] grid-cols-[minmax(0,1fr)] gap-px overflow-x-hidden overflow-y-auto" aria-label="Messages waiting for Claude" data-queue-list>
        {queue.map((message, index) => {
          const typed = withoutContext(message.text);
          const text = firstLine(typed);
          const attachments = attachmentLabel(message.attachments);
          const mark = canMove ? drag.markFor(message.id) : null;
          const tooltip = typed.length > 400 ? `${typed.slice(0, 399)}…` : typed || undefined;
          const content = (
            <>
              <span className="min-w-0 truncate text-ui text-text/90">{text || <span className="text-muted">{attachments ?? 'Message'}</span>}</span>
              {text && attachments && <span className="shrink-0 rounded-full bg-border/60 px-1.5 text-meta text-muted">{attachments}</span>}
            </>
          );
          return (
            <li
              key={message.id}
              className={`group/up relative flex h-7 min-w-0 items-center gap-1.5 rounded-lg pr-1 pl-3 hover:bg-border/45 focus-within:bg-border/45 ${canMove && drag.dragging === message.id ? 'opacity-50' : ''}`}
              data-queue-item-row={message.id}
              {...(canMove ? drag.props(message.id) : {})}
            >
              {mark && <span aria-hidden className={`absolute inset-x-2 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-px' : '-bottom-px'}`} data-queue-drop={mark} />}
              {canMove ? (
                <>
                  <GripVertical size={12} className="absolute left-0 shrink-0 cursor-grab text-faint opacity-0 group-hover/up:opacity-100" aria-hidden />
                  {/* Focusable so ⌥↑ ⌥↓ can move it; editing stays on that computer, so it does nothing on Enter. */}
                  <span
                    tabIndex={0}
                    data-queue-item={message.id}
                    aria-label={`Up next, ${index + 1} of ${queue.length}: ${text || attachments || 'message'}. Option and arrows move it.`}
                    data-tooltip={tooltip}
                    onKeyDown={(event) => onKeyDown(event, message)}
                    className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md py-1"
                  >
                    {content}
                  </span>
                </>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-2" data-tooltip={tooltip}>
                  {content}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                {sendNow && (
                  <Button variant="quiet" size="sm" icon={<Zap size={11} aria-hidden />} onClick={() => sendNow(message)} data-tooltip={`Stop Claude on ${computer.name} and send this now`} aria-label={`Send now: ${text || 'message'}`} data-queue-send-now={message.id}>
                    Send now
                  </Button>
                )}
                <Button variant="quiet" size="sm" iconOnly icon={<X size={12} aria-hidden />} aria-label={`Remove from Up next: ${text || 'message'}`} onClick={() => remove(message)} className="opacity-0 group-hover/up:opacity-100 focus-visible:opacity-100" />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
