import type { CatchUp } from '@switchboard/protocol/remote-client';
import { age } from '../lib/groups.ts';
import { catchUpChips, reviewLabel, stateLabel, type CatchUpTone } from '../lib/catchUp.ts';
import { Button } from './ui.tsx';

const DOT: Record<CatchUpTone, string> = { unread: 'bg-unread', error: 'bg-error', ok: 'bg-ok', neutral: 'bg-faint' };
const TEXT: Record<CatchUpTone, string> = { unread: 'text-unread', error: 'text-error', ok: 'text-ok', neutral: 'text-muted' };

/**
 * The briefing at the top of a finished session, as on the computer: how it ended and when, how long it takes to
 * review, what Claude did, the tests and the diff's size, and Changes and Commit.
 */
export function CatchUpCard({ card, now, committed, onChanges, onCommit, canCommit }: { card: CatchUp; now: number; committed: boolean; onChanges: () => void; onCommit: () => void; canCommit: boolean }) {
  const state = stateLabel(card, committed);
  const hasDiff = (card.signals.diff?.files ?? 0) > 0 && !committed;
  return (
    <section aria-label="Catch-up" className="flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3 break-words shadow-sm" data-remote-catchup>
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1.5 text-ui font-semibold ${TEXT[state.tone]}`}>
          <span aria-hidden className={`size-2 rounded-full ${DOT[state.tone]}`} />
          {state.label}
        </span>
        <span className="text-meta text-faint">{age(card.generatedAt, now)}</span>
        <span className="ml-auto text-ui font-semibold">{reviewLabel(card)}</span>
      </div>
      <p className="text-body text-muted">{card.ask}</p>
      {card.did.length > 0 && (
        <div>
          <h3 className="text-meta font-semibold tracking-wide text-faint uppercase">What it did</h3>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-body marker:text-faint">
            {card.did.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {card.skipped.length > 0 && (
        <div>
          <h3 className="text-meta font-semibold tracking-wide text-faint uppercase">Skipped or not finished</h3>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-body marker:text-faint">
            {card.skipped.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {catchUpChips(card).map((chip) => (
          <span key={chip.id} className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-meta ${TEXT[chip.tone]}`} data-remote-chip={chip.id}>
            <span aria-hidden className={`size-1.5 rounded-full ${DOT[chip.tone]}`} />
            {chip.text}
          </span>
        ))}
      </div>
      {hasDiff && (
        <div className="flex gap-2 pt-0.5">
          <Button onClick={onChanges} className="flex-1" data-remote-catchup-changes>
            Changes
          </Button>
          <Button variant={card.need.kind === 'commit' ? 'primary' : 'secondary'} onClick={onCommit} disabled={!canCommit} className="flex-1" data-remote-catchup-commit>
            Commit
          </Button>
        </div>
      )}
    </section>
  );
}
