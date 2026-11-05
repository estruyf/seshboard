import { createContext, Fragment, useContext, useMemo } from 'react';
import type { CatchUpTests } from '@seshboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import type { DisplayItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { MessageToolbar, ReadButton, REVEAL_IN_REPLY_ROW } from './messageActions.tsx';
import { statParts, turnStats, type StatPart } from './skim.ts';
import { fadeCountOf } from './skimFade.ts';
import { Sep, TurnMetaContext, TurnMetaLine } from './TurnMeta.tsx';
import type { Turn } from './turns.ts';
import { useOpenKey } from './useOpenKey.ts';

/** What Skim needs under the session view; null (Full) leaves the conversation as written. */
export interface SkimValue {
  items: readonly DisplayItem[];
  /** The latest turn's tests, from its catch-up card; older turns' aren't kept. */
  latest: { turn: Turn; tests: CatchUpTests } | null;
  /** Find is open: it works on the whole text, as Full shows it. The text only changes colour, so nothing moves. */
  finding: boolean;
}

export const SkimContext = createContext<SkimValue | null>(null);

/** Says who wrote a message, for screen readers; it also lets VoiceOver jump between messages by heading. */
export function Speaker({ name }: { name: string }) {
  return <h2 className="sr-only">{name}</h2>;
}

/** A failing test run is what the line is most there to say. */
const toneOf = ({ key, tone }: StatPart) => (tone === 'ok' ? 'text-ok' : tone === 'error' ? `text-error${key === 'tests' ? ' font-semibold' : ''}` : undefined);

/** A finished turn's numbers, above its reply. */
function SkimStats({ parts }: { parts: StatPart[] }) {
  return (
    <p className="mb-1 flex flex-wrap items-center gap-x-1.5 text-meta text-faint tabular-nums" data-skim-stats>
      {parts.map((part, i) => (
        <Fragment key={part.key}>
          {i > 0 && <Sep />}
          <span className={toneOf(part)} data-skim-stat={part.key}>
            {part.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/** A finished turn's last reply in Skim: the stats line, the text with its less important sentences faded, Show all text. */
function SkimReply({ item, turn, skim }: { item: Extract<DisplayItem, { kind: 'text' }>; turn: Turn; skim: SkimValue }) {
  const [showAll, toggle] = useOpenKey(`show-all:${item.key}`);
  const count = useMemo(() => fadeCountOf(item.text), [item.text]);
  const tests = skim.latest?.turn === turn ? skim.latest.tests : null;
  // A finished turn's items don't change while its Turn stays the same one (`updateTurns` keeps it).
  const parts = useMemo(() => statParts(turnStats(skim.items, turn, tests)), [turn, tests]);
  const fades = count.faded > 0;
  return (
    <>
      {parts.length > 0 && <SkimStats parts={parts} />}
      <Markdown text={item.text} fade={fades && !showAll && !skim.finding} />
      {fades && (
        <div className="-ml-1 mt-1 flex min-w-0 flex-wrap items-center gap-x-2" data-skim-fade-row>
          <Button variant="quiet" size="sm" onClick={toggle} data-skim-show-all>
            {showAll ? 'Fade text' : 'Show all text'}
          </Button>
          {!showAll && (
            <span className="text-meta text-faint tabular-nums">
              {count.faded} of {count.total} sentences faded
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** One of Claude's messages (or a subagent's), in the conversation or opened in an activity group. */
export function MessageText({ item, className = '' }: { item: Extract<DisplayItem, { kind: 'text' }>; className?: string }) {
  const skim = useContext(SkimContext);
  const turn = useContext(TurnMetaContext)?.byReply.get(item.key);
  return (
    <div className={`group/message relative text-body ${className}`} data-remember-from={item.subagent ? undefined : 'claude'} data-message-key={item.key}>
      <Speaker name={item.subagent ? 'Subagent' : 'Claude'} />
      {skim && turn ? <SkimReply item={item} turn={turn} skim={skim} /> : <Markdown text={item.text} />}
      {/* The actions, then (under a turn's last reply) when the turn ended, how long it took and its tokens: both
          hidden until the reply is hovered or the row has focus, with their space kept. */}
      <div className="group/reply-row -ml-1 mt-1 flex h-6 min-w-0 items-center gap-2">
        <MessageToolbar itemKey={item.key} kind="text" text={item.text} copyOnly={item.subagent} />
        {!item.subagent && <ReadButton itemKey={item.key} />}
        {!item.subagent && <TurnMetaLine itemKey={item.key} className={REVEAL_IN_REPLY_ROW} />}
      </div>
    </div>
  );
}
