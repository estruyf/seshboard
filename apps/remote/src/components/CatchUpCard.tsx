import { useState } from 'react';
import type { CatchUp } from '@seshboard/protocol/remote-client';
import { age } from '../lib/groups.ts';
import { catchUpChips, reviewLabel, stateLabel, withHashes, type CatchUpTone } from '../lib/catchUp.ts';
import { promptTitle } from '../lib/promptTitle.ts';
import { Markdown } from './Markdown.tsx';
import { Sheet } from './Sheet.tsx';
import { Button } from './ui.tsx';

const DOT: Record<CatchUpTone, string> = { unread: 'bg-unread', error: 'bg-error', ok: 'bg-ok', neutral: 'bg-faint' };
const TEXT: Record<CatchUpTone, string> = { unread: 'text-unread', error: 'text-error', ok: 'text-ok', neutral: 'text-muted' };

/** "5m ago", or "just now". */
const ago = (short: string) => (short === 'now' ? 'just now' : `${short} ago`);

/** A line of What it did, its commit hashes in mono. */
function Line({ text }: { text: string }) {
  return (
    <>
      {withHashes(text).map((part, i) =>
        part.hash ? (
          <code key={i} className="font-mono text-[0.92em]">
            {part.text}
          </code>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/**
 * The briefing at the top of a finished session, as on the computer: how it ended and when, how long it takes to
 * review, what you asked (the prompt's title; Show the prompt has all of it, as Markdown), what Claude did, the tests
 * and the diff's size. On a phone the diff's chip opens Changes (Commit is in there); on a wide screen Changes and
 * Commit are buttons under the chips. `prompt` is the whole prompt from the transcript, when it is loaded; the card's
 * own `ask` is cut short.
 */
export function CatchUpCard({ card, prompt, now, committed, onChanges, onCommit, canCommit, wide }: { card: CatchUp; prompt: string | null; now: number; committed: boolean; onChanges: () => void; onCommit: () => void; canCommit: boolean; wide: boolean }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const state = stateLabel(card, committed);
  const hasDiff = (card.signals.diff?.files ?? 0) > 0 && !committed;
  const whole = prompt ?? card.ask;
  const title = promptTitle(whole) || card.ask;
  const chipClass = (tone: CatchUpTone) => `inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-meta ${TEXT[tone]}`;
  return (
    <section aria-label="Catch-up" className="flex min-w-0 flex-col gap-3 rounded-[18px] border border-border bg-card p-4 break-words shadow-sm" data-remote-catchup>
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1.5 text-ui font-semibold ${TEXT[state.tone]}`}>
          <span aria-hidden className={`size-2 rounded-full ${DOT[state.tone]}`} />
          {state.label}
        </span>
        <span className="text-meta text-faint">{ago(age(card.generatedAt, now))}</span>
        <span className="ml-auto text-meta text-muted">{reviewLabel(card)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-meta text-muted">You asked</h3>
        <p className="line-clamp-2 text-body font-semibold" data-remote-catchup-title>
          {title}
        </p>
        <button type="button" onClick={() => setPromptOpen(true)} className="-my-1 self-start py-1 text-ui text-accent-ink" data-remote-catchup-prompt>
          Show the prompt
        </button>
      </div>
      {card.did.length > 0 && (
        <div>
          <h3 className="text-meta text-muted">What it did</h3>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-body marker:text-faint">
            {card.did.map((line, i) => (
              <li key={i}>
                <Line text={line} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {card.skipped.length > 0 && (
        <div>
          <h3 className="text-meta text-muted">Skipped or not finished</h3>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-body marker:text-faint">
            {card.skipped.map((line, i) => (
              <li key={i}>
                <Line text={line} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {catchUpChips(card).map((chip) =>
          chip.id === 'diff' && hasDiff && !wide ? (
            <button key={chip.id} type="button" onClick={onChanges} aria-label={`${chip.text}, open Changes`} className={`${chipClass('neutral')} text-text! active:bg-selected`} data-remote-chip={chip.id} data-remote-catchup-changes>
              {chip.text}
            </button>
          ) : (
            <span key={chip.id} className={chipClass(chip.tone)} data-remote-chip={chip.id}>
              <span aria-hidden className={`size-1.5 rounded-full ${DOT[chip.tone]}`} />
              {chip.text}
            </span>
          ),
        )}
      </div>
      {hasDiff && wide && (
        <div className="flex gap-2 pt-0.5">
          <Button onClick={onChanges} className="flex-1" data-remote-catchup-changes>
            Changes
          </Button>
          <Button variant={card.need.kind === 'commit' ? 'primary' : 'secondary'} onClick={onCommit} disabled={!canCommit} className="flex-1" data-remote-catchup-commit>
            Commit
          </Button>
        </div>
      )}
      {promptOpen && (
        <Sheet title="You asked" onClose={() => setPromptOpen(false)} hook="prompt" tall={whole.length > 600}>
          <Markdown text={whole} />
          {!prompt && <p className="pt-3 text-meta text-faint">The start of the prompt. The rest is earlier in the conversation.</p>}
        </Sheet>
      )}
    </section>
  );
}
