import { createContext, Fragment, useContext, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { PROVIDER_NAMES, type CatchUpTests } from '@seshboard/protocol/client';
import type { EngineClient as Client } from '../../engine/connection.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { requestSkimHighlight, useSkimHighlight, useSkimModel } from '../../state/skimHighlightsStore.ts';
import { Button } from '../ui/Button.tsx';
import type { DisplayItem } from './displayItems.ts';
import { Markdown } from './Markdown.tsx';
import { MessageToolbar, ReadButton, REVEAL_IN_REPLY_ROW } from './messageActions.tsx';
import { statParts, turnStats, type StatPart } from './skim.ts';
import { fadeCountOf, SKIM_MIN_SENTENCES, skimOutline } from './skimFade.ts';
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
  sessionId: string;
  client: Client | null;
  /** The reply that may go to Haiku: the session's last. */
  lastReplyKey: string | null;
  /** Another provider's session: Skim's picks run on that account, with their own setting. */
  provider: string | null;
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

/** The once-only offer under a long reply: nothing goes to Haiku before Try it. */
function SkimInvitation({ model, account, onAnswer }: { model: string; account: string; onAnswer: (tryIt: boolean) => void }) {
  return (
    <div className="-ml-1 mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-skim-invitation>
      <span className="ml-1 text-meta text-muted">Fade the less important sentences with {model}? This uses {account}.</span>
      <Button size="sm" onClick={() => onAnswer(true)} data-skim-try>
        Try it
      </Button>
      <Button variant="quiet" size="sm" onClick={() => onAnswer(false)} data-skim-not-now>
        Not now
      </Button>
    </div>
  );
}

/** A finished turn's last reply in Skim: the stats line, the text with what Haiku didn't keep faded, Show all text. */
function SkimReply({ item, turn, skim }: { item: Extract<DisplayItem, { kind: 'text' }>; turn: Turn; skim: SkimValue }) {
  const [showAll, toggle] = useOpenKey(`show-all:${item.key}`);
  const tests = skim.latest?.turn === turn ? skim.latest.tests : null;
  // A finished turn's items don't change while its Turn stays the same one (`updateTurns` keeps it).
  const parts = useMemo(() => statParts(turnStats(skim.items, turn, tests)), [turn, tests]);
  const copilot = skim.provider !== null;
  const on = usePreferences((s) => (copilot ? s.prefs.skimHighlightsCopilot : s.prefs.skimHighlights));
  const asked = usePreferences((s) => (copilot ? s.prefs.skimHighlightsCopilotAsked : s.prefs.skimHighlightsAsked));
  const update = usePreferences((s) => s.update);
  const setOn = (value: boolean) => update(copilot ? { skimHighlightsCopilot: value, skimHighlightsCopilotAsked: true } : { skimHighlights: value, skimHighlightsAsked: true });
  const outline = useMemo(() => skimOutline(item.text), [item.text]);
  const enough = outline.total >= SKIM_MIN_SENTENCES;
  // Another provider is asked for a model only once there is something to offer or to fade.
  const model = useSkimModel(skim.client, skim.sessionId, skim.provider, enough && (on || !asked));
  const long = enough && model !== null;
  const prompt = skim.items[turn.start];
  // Only a session's last reply goes to Haiku, so opening a long session never spends a call per turn.
  const request = {
    sessionId: skim.sessionId,
    replyKey: item.key,
    total: outline.total,
    ask: skim.lastReplyKey === item.key,
    message: prompt?.kind === 'user' ? prompt.text : '',
    outline: outline.text,
  };
  const highlight = useSkimHighlight(skim.client, request, on && long);
  const keep = highlight?.state === 'ready' ? highlight.keep : null;
  const count = useMemo(() => (keep ? fadeCountOf(item.text, keep) : null), [item.text, keep]);
  const fades = !!count && count.faded > 0;
  return (
    <>
      {parts.length > 0 && <SkimStats parts={parts} />}
      <Markdown text={item.text} keep={fades && !showAll && !skim.finding ? keep : null} />
      {!on && !asked && long && request.ask && <SkimInvitation model={model} account={copilot ? `your ${PROVIDER_NAMES[skim.provider as keyof typeof PROVIDER_NAMES] ?? PROVIDER_NAMES.copilot} account` : 'your plan'} onAnswer={setOn} />}
      {highlight?.state === 'loading' && request.ask && (
        <div className="mt-1 flex items-center gap-1.5 text-meta text-muted" role="status" aria-busy data-skim-fading>
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Fading…
        </div>
      )}
      {highlight?.state === 'failed' && (
        <div className="-ml-1 mt-1 flex min-w-0 flex-wrap items-center gap-x-2" data-skim-failed>
          <span className="ml-1 text-meta text-muted">{model} did not answer.</span>
          <Button variant="quiet" size="sm" onClick={() => skim.client && requestSkimHighlight(skim.client, request)} data-skim-retry>
            Try again
          </Button>
        </div>
      )}
      {fades && (
        <div className="-ml-1 mt-1 flex min-w-0 flex-wrap items-center gap-x-2" data-skim-fade-row>
          <Button variant="quiet" size="sm" onClick={toggle} data-skim-show-all>
            {showAll ? 'Fade text' : 'Show all text'}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setOn(false)} data-skim-turn-off>
            Turn off
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
