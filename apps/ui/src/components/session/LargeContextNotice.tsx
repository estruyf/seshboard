import { useState } from 'react';
import { Layers } from 'lucide-react';
import { cacheRewriteCost, isLargeContext, type SessionHostInfo, type TranscriptMessage } from '@seshboard/protocol/client';
import { useHosts } from '../../state/hostsStore.ts';
import { useSecondClock } from '../../lib/secondClock.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { useCostFormat } from '../usage/useCost.ts';
import { lastTurnTokens } from './ContextMeter.tsx';
import { agoText, cacheState, cacheUseOf, compactTokens, nextMessageModel, untilText } from './largeContext.ts';

/** Notices dismissed this run, per session and cache state: a lapsed cache still shows after dismissing the countdown. */
const dismissed = new Set<string>();

/** The model of the last reply, for a session not running here. */
const lastModel = (messages: readonly TranscriptMessage[]) => messages.findLast((m) => m.role === 'assistant' && m.parentToolUseId === null && m.model && m.model !== '<synthetic>')?.model ?? null;

/**
 * Above the message box while a session with a large context waits for you (Settings › Usage › Large context): how
 * big it is, and when its prompt cache lapses. After that the next message reads all of that context again, at the
 * cache write price instead of the much lower read price. Compacting while the cache is kept is cheap; after, it
 * reads everything again too, so Compact now is only offered before.
 */
export function LargeContextNotice({
  sessionId,
  live,
  host,
  messages,
  working,
  chosenModel,
  onCompact,
}: {
  sessionId: string;
  live: { tokens: number; max: number; percent: number } | null;
  /** Also a stopped one: it still knows when the cache was last used. */
  host: SessionHostInfo | null | undefined;
  messages: readonly TranscriptMessage[];
  working: boolean;
  /** What the model chip shows, which the next message goes to: null is Claude Code's default, undefined when not known. */
  chosenModel?: string | null;
  onCompact?: () => void;
}) {
  const warning = usePreferences((s) => s.prefs.contextWarning);
  const format = useCostFormat();
  const models = useHosts((s) => s.models);
  const [, setDismissed] = useState(0);
  const estimate = live ? null : lastTurnTokens(messages);
  const tokens = live?.tokens ?? estimate;
  const large = !working && tokens !== null && isLargeContext(tokens, warning);
  const now = useSecondClock(large) || Date.now();
  if (!large) return null;

  const use = cacheUseOf(host, messages);
  const state = cacheState(use, now);
  const key = `${sessionId}:${state.kind}`;
  if (dismissed.has(key)) return null;
  const model = nextMessageModel(chosenModel, models, [host?.model, lastModel(messages)]);
  const usd = use && model ? cacheRewriteCost(tokens, model, use.ttl) : null;
  const cost = format && usd !== null ? ` (${format(usd)})` : '';
  const size = live ? `${compactTokens(tokens)} tokens (${Math.round(live.percent)}%)` : `about ${compactTokens(tokens)} tokens`;

  return (
    <Notice
      tone={state.kind === 'cold' ? 'caution' : 'neutral'}
      icon={<Layers size={14} aria-hidden />}
      onDismiss={() => {
        dismissed.add(key);
        setDismissed((n) => n + 1);
      }}
      actions={
        onCompact &&
        state.kind !== 'cold' && (
          <Button size="sm" variant="quiet" onClick={onCompact} data-tooltip="Sends /compact: Claude summarises the conversation so far, so each message carries less" data-large-context-compact>
            Compact now
          </Button>
        )
      }
      data-large-context={state.kind}
    >
      <span className="font-medium text-text">Large context:</span> {size}.{' '}
      {state.kind === 'warm' && (
        <>
          Its cache expires in {untilText(state.expiresAt - now)}. After that, your next message reads all of it again{cost}.
        </>
      )}
      {state.kind === 'cold' && (
        <>
          Its cache expired {agoText(now - state.since)} ago, so your next message reads all of it again{cost}.
        </>
      )}
      {state.kind === 'unknown' && <>Every message carries all of it. Compacting summarises it, so each one carries less.</>}
    </Notice>
  );
}
