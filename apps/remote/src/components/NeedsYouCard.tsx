import { useState, type MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PermissionDecision, RemoteSession } from '@seshboard/protocol/remote-client';
import type { ListedPrompt } from '../lib/everywhere.ts';
import { age } from '../lib/groups.ts';
import { DECLINED, promptKind, promptLine, promptSubject, promptTag } from '../lib/prompts.ts';
import { answer } from './answer.ts';
import type { Client } from './Connected.tsx';
import { Button, ComputerTag } from './ui.tsx';

/**
 * A prompt at the top of the list, so it can be answered without opening the session: a tool gets Deny and Allow
 * (Always allow stays in the session, where there is room to read what it does); a question or a plan is a compact
 * row that opens the session. A tap anywhere outside the buttons opens it too. With more than one computer, it says
 * which one asks.
 */
export function NeedsYouCard({ prompt, session, client, computer, now, onOpen, onAnswered }: { prompt: ListedPrompt; session: RemoteSession | undefined; client: Client; /** The computer's name, with more than one. */ computer?: string | undefined; now: number; onOpen: () => void; onAnswered: (result: 'done' | 'gone') => void }) {
  const [busy, setBusy] = useState(false);
  const kind = promptKind(prompt);
  const title = session?.title ?? 'Session';
  const open = (event: MouseEvent) => {
    if (!(event.target as HTMLElement).closest('button')) onOpen();
  };
  const respond = async (decision: PermissionDecision) => {
    if (!client || busy) return;
    setBusy(true);
    const result = await answer(client, prompt.original, decision, title);
    if (result === 'failed') setBusy(false);
    else onAnswered(result);
  };

  if (kind !== 'tool') {
    return (
      <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-warn bg-card px-3 py-2 text-left hover:bg-border/30" data-remote-prompt-card={prompt.requestId}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-meta">
            <span className="font-semibold tracking-wide text-warn uppercase">{promptTag(prompt)}</span>
            {computer && <ComputerTag name={computer} />}
            <span className="truncate text-faint">
              {session?.projectName} · {age(prompt.createdAt, now)}
            </span>
          </span>
          <span className="block truncate text-body font-semibold">{title}</span>
          {promptLine(prompt) && <span className="block truncate text-ui text-muted">{promptLine(prompt)}</span>}
        </span>
        <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
      </button>
    );
  }

  return (
    // The card opens the session on a tap; the title is the button for keyboards and screen readers.
    <article onClick={open} aria-label={`${promptTag(prompt)}: ${title}`} className="flex cursor-pointer flex-col gap-2 rounded-xl border-2 border-warn bg-card p-3" data-remote-prompt-card={prompt.requestId}>
      <div className="flex items-center gap-2 text-meta">
        <span className="font-semibold tracking-wide text-warn uppercase">{promptTag(prompt)}</span>
        {computer && <ComputerTag name={computer} />}
        <span className="ml-auto truncate text-faint">
          {session?.projectName} · {age(prompt.createdAt, now)}
        </span>
      </div>
      <button type="button" onClick={onOpen} className="-my-0.5 truncate text-left text-body font-semibold">
        {title}
      </button>
      <code className="block truncate rounded-lg bg-code px-2.5 py-2 font-mono text-ui">{promptSubject(prompt)}</code>
      <div className="grid grid-cols-3 gap-2 pt-1">
        <Button variant="danger" disabled={busy || !client} onClick={() => void respond({ behavior: 'deny', message: DECLINED })} data-remote-deny>
          Deny
        </Button>
        <Button variant="primary" disabled={busy || !client} onClick={() => void respond({ behavior: 'allow' })} className="col-span-2" data-remote-allow>
          Allow
        </Button>
      </div>
    </article>
  );
}
