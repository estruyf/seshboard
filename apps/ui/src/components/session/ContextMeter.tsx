import { useEffect, useId, useRef, useState } from 'react';
import type { ContextUsage, TranscriptMessage } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { Meter } from '../ui/Meter.tsx';
import { formatPercent } from '../ui/meter.ts';
import { LEVEL_TEXT } from '../../lib/levels.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { compactTokens, contextLevel } from './largeContext.ts';
import { foldedMeter, type UsageLine } from './foldedMeter.ts';


/** Context at the end of the last turn, from the transcript (for sessions not running here). */
export function lastTurnTokens(messages: readonly TranscriptMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || m.parentToolUseId !== null || !m.usage) continue;
    const total = m.usage.input + m.usage.cacheRead + m.usage.cacheCreation + m.usage.output;
    if (total > 0) return total;
  }
  return null;
}

const PALETTE = ['#74c0fc', '#d0bfff', '#ffd43b', '#51cf66', '#ff922b', '#66d9ef', '#ed217c', '#a8b2c4'];
/** Claude Code may name its colours after its terminal theme; fall back to a palette then. */
const colorFor = (color: string, index: number) => (typeof CSS !== 'undefined' && CSS.supports('color', color) ? color : PALETTE[index % PALETTE.length]!);

/**
 * How full the context window is, like Claude Code's /context: a ring, "Context 42%" and used/total
 * tokens. For a session running here, click for the breakdown by category and to compact the
 * conversation (`onCompact`). Otherwise it shows what the last turn used, from the transcript.
 * `compact`: only a ring, standing in for the whole session footer (plan usage too, from `usage`) in the
 * message box while the terminal is open below; hover for every number, click for the same popup.
 */
export function ContextMeter({
  sessionId,
  live,
  messages,
  onCompact,
  compact = false,
  usage = [],
}: {
  sessionId: string;
  live: { tokens: number; max: number; percent: number } | null;
  messages: readonly TranscriptMessage[];
  /** Sends /compact. */
  onCompact?: () => void;
  compact?: boolean;
  /** Compact only: the plan usage windows the hidden footer showed. */
  usage?: readonly UsageLine[];
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [open, setOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<ContextUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popupId = useId();
  // Orange from Settings › Usage › Large context's percentage, so the ring and the notice above the box agree.
  const warning = usePreferences((s) => s.prefs.contextWarning);

  // Running here (it can be compacted) but no usage report yet, e.g. resumed and not sent to: ask
  // Claude Code once, so the ring shows right away instead of only an estimate.
  const running = onCompact !== undefined;
  useEffect(() => {
    if (!client || !running || live) return;
    let cancelled = false;
    client.call('session.context', { sessionId }).then(
      (usage) => !cancelled && setBreakdown(usage),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, running, sessionId, live]);
  useEffect(() => {
    if (!open || !client || !running) return;
    setError(null);
    client.call('session.context', { sessionId }).then(setBreakdown, (e: Error) => setError(e.message));
  }, [open, client, sessionId, running]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const known = live ?? (breakdown ? { tokens: breakdown.totalTokens, max: breakdown.maxTokens, percent: breakdown.percentage } : null);
  const estimate = known ? null : lastTurnTokens(messages);
  const hasContext = known !== null || estimate !== null;
  const folded = compact
    ? foldedMeter(usage, known ? { percent: known.percent, detail: `${compactTokens(known.tokens)} / ${compactTokens(known.max)}` } : estimate !== null ? { percent: null, detail: `≈${compactTokens(estimate)}` } : null)
    : null;
  if (compact ? !folded : !hasContext) return null;

  const used = breakdown?.categories.filter((c) => c.kind === 'used' && c.tokens > 0) ?? [];
  const trigger = folded ? (
    <Button
      variant="quiet"
      size="sm"
      iconOnly
      selected={open}
      icon={folded.percent === null ? <span className="size-4 shrink-0 rounded-full border-2 border-selected" aria-hidden /> : <Meter kind="ring" size="md" percent={folded.percent} />}
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? popupId : undefined}
      aria-label={`Usage and context: ${folded.lines.join(', ')}. Show more`}
      data-tooltip={folded.lines.join('\n')}
      data-folded-meter
    />
  ) : (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? popupId : undefined}
      // The ring and a bare percentage mean little on their own: say what they measure.
      aria-label={
        known
          ? `Context window ${Math.round(known.percent)}% full, ${compactTokens(known.tokens)} of ${compactTokens(known.max)} tokens: show what fills it`
          : `Context window: about ${compactTokens(estimate ?? 0)} tokens at the end of the last turn`
      }
      data-tooltip={`How full Claude’s context window is (what it keeps in mind for this conversation). Click for ${known ? 'what fills it' : 'more'}${onCompact ? ', and to compact it' : ''}.`}
      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 whitespace-nowrap tabular-nums hover:bg-border/50 hover:text-text"
    >
      {known ? (
        <>
          {/* Decoration: the button's label says how full it is. */}
          <Meter kind="ring" percent={known.percent} level={contextLevel(known.percent, known.tokens, warning)} />
          Context <span className={LEVEL_TEXT[contextLevel(known.percent, known.tokens, warning)]}>{formatPercent(known.percent)}</span>
          <span className="text-faint @max-[860px]:hidden">
            {compactTokens(known.tokens)} / {compactTokens(known.max)}
          </span>
        </>
      ) : (
        <>
          {/* An empty ring: the size of the window isn't known until the session runs here. */}
          <span className="size-3 shrink-0 rounded-full border-[1.5px] border-selected" aria-hidden />
          Context <span className="text-faint">≈{compactTokens(estimate ?? 0)}</span>
        </>
      )}
    </button>
  );
  const details = hasContext && (
    <>
      <p className="font-semibold">Context window</p>
      <p className="mt-0.5 text-meta text-muted">
        {known
          ? `${compactTokens(known.tokens)} of ${compactTokens(known.max)} tokens (${Math.round(known.percent)}%)${breakdown ? ` · ${breakdown.model}` : ''}`
          : `About ${compactTokens(estimate ?? 0)} tokens at the end of the last turn`}
      </p>
      {!running && (
        <p className="mt-2 text-muted">Send a message to pick this session up in Switchboard. Then you can see what fills the context and compact it.</p>
      )}
      {running && error && <p className="mt-2 text-error">{error}</p>}
      {running && !breakdown && !error && <p className="mt-2 text-muted">Loading…</p>}
      {breakdown && (
        <>
          {/* One bar, each category its own colour, like /context. The list below says the same in words. */}
          {/* The track is outlined so the free part reads against the popup, and every category keeps a sliver so a nearly empty window still shows them. */}
          <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full border border-faint/60 bg-bg" aria-hidden>
            {used.map((c, i) => (
              <span key={c.name} className="shrink-0" style={{ width: `${(c.tokens / breakdown.maxTokens) * 100}%`, minWidth: 3, background: colorFor(c.color, i) }} data-tooltip={c.name} />
            ))}
          </div>
          <ul className="mt-2.5 grid gap-1">
            {used.map((c, i) => (
              <li key={c.name} className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-sm" style={{ background: colorFor(c.color, i) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-muted">{c.name}</span>
                <span className="tabular-nums">{compactTokens(c.tokens)}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 border-t border-border pt-1">
              <span className="size-2 shrink-0 rounded-sm border border-faint/60 bg-bg" aria-hidden />
              <span className="min-w-0 flex-1 text-muted">Free</span>
              <span className="tabular-nums">{compactTokens(Math.max(0, breakdown.maxTokens - breakdown.totalTokens))}</span>
            </li>
          </ul>
        </>
      )}
      {onCompact && (
        <Button
          variant="primary"
          onClick={() => {
            setOpen(false);
            onCompact();
          }}
          data-compact
          className="mt-3 w-full"
          data-tooltip="Sends /compact: Claude summarises the conversation so far to free up context"
        >
          Compact now
        </Button>
      )}
    </>
  );
  return (
    <div ref={ref} className="relative" data-context-meter>
      {trigger}
      {open && (
        <div id={popupId} role="dialog" aria-label={compact ? 'Usage and context' : 'Context window'} className="absolute right-0 bottom-full z-30 mb-1.5 w-72 rounded-lg border overlay p-3 text-ui text-text" data-context-breakdown>
          {/* Folded into the ring, the footer's plan usage has no other place on screen. */}
          {compact && usage.length > 0 && (
            <div className={`grid gap-2 ${hasContext ? 'mb-3 border-b border-edge pb-3' : ''}`} data-folded-usage>
              <p className="font-semibold">Plan usage</p>
              {usage.map((u) => (
                <Meter key={u.label} size="md" percent={u.percent} showValue label={`${u.label}: ${Math.round(u.percent)}% used`}>
                  <span className="text-muted">{u.label}</span>
                </Meter>
              ))}
            </div>
          )}
          {details}
        </div>
      )}
    </div>
  );
}
