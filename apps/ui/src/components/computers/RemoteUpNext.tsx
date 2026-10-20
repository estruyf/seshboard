import { X } from 'lucide-react';
import { withoutContext, type Computer, type Contract, type QueuedMessage, type RpcClient } from '@switchboard/protocol/client';
import { toast } from '../../state/toastStore.ts';
import { attachmentLabel, firstLine, holdNote, upNextTitle } from '../composer/upNext.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { callComputer } from './callComputer.ts';

/**
 * The messages waiting in the Up next of a session on another computer, above the message box as for a local session.
 * The remote contract only takes one back (`session.queue.remove`): editing, moving and Send now stay on that
 * computer. While its profile is at a usage limit the list says they are held.
 */
export function RemoteUpNext({ client, computer, sessionId, queue, limited }: {
  client: RpcClient<Contract>;
  computer: Computer;
  sessionId: string;
  queue: readonly QueuedMessage[];
  limited: boolean;
}) {
  if (queue.length === 0) return null;
  const note = holdNote(null, queue.length, limited);
  const remove = (message: QueuedMessage) =>
    void callComputer(client, computer.id, 'session.queue.remove', { sessionId, id: message.id }).catch((e: Error) => toast(e.message));
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
      <ul className="grid max-h-[calc(5*1.75rem+4px)] grid-cols-[minmax(0,1fr)] gap-px overflow-x-hidden overflow-y-auto" aria-label="Messages waiting for Claude" data-queue-list>
        {queue.map((message) => {
          const typed = withoutContext(message.text);
          const text = firstLine(typed);
          const attachments = attachmentLabel(message.attachments);
          return (
            <li key={message.id} className="group/up flex h-7 min-w-0 items-center gap-1.5 rounded-lg pr-1 pl-3 hover:bg-border/45 focus-within:bg-border/45" data-queue-item-row={message.id}>
              <span className="flex min-w-0 flex-1 items-center gap-2" data-tooltip={typed.length > 400 ? `${typed.slice(0, 399)}…` : typed || undefined}>
                <span className="min-w-0 truncate text-ui text-text/90">{text || <span className="text-muted">{attachments ?? 'Message'}</span>}</span>
                {text && attachments && <span className="shrink-0 rounded-full bg-border/60 px-1.5 text-meta text-muted">{attachments}</span>}
              </span>
              <Button variant="quiet" size="sm" iconOnly icon={<X size={12} aria-hidden />} aria-label={`Remove from Up next: ${text || 'message'}`} onClick={() => remove(message)} className="opacity-0 group-hover/up:opacity-100 focus-visible:opacity-100" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
