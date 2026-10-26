import { createContext, Fragment, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { TurnDetails } from '@seshboard/protocol/bridge';
import { useSecondClock } from '../../lib/secondClock.ts';
import { SHOW_DELAY } from '../ui/Tooltip.tsx';
import { placeTooltip } from '../ui/tooltipPlacement.ts';
import { TOKEN_COLOR, TOKEN_LABEL, TOKEN_TYPES } from '../usage/usageModel.ts';
import { describeTurn, formatLiveDuration, formatTurnTokens, liveParts, modelTitle, tokensHeading } from './turnFormat.ts';
import { liveTurn, type Turn, type TurnTokens } from './turns.ts';

/** The finished turns of the conversation by their last reply, and how to show them; provided by the session view. */
export interface TurnMetaValue {
  byReply: ReadonlyMap<string, Turn>;
  mode: TurnDetails;
  /** The conversation's width: narrow panes drop parts. */
  width: number | null;
}

export const TurnMetaContext = createContext<TurnMetaValue | null>(null);

/** The `·` between the parts, in the border colour. */
const Sep = () => (
  <span aria-hidden className="text-border">
    ·
  </span>
);

/**
 * A finished turn's line, after the actions under its last reply: when it ended, how long it took and its tokens, as
 * the setting says ("14:32 · 2m 14s · 18.4k tokens"). Faint and on one line; a narrow pane drops the tokens, then the
 * duration, and the time's tooltip still has everything. In the session view it shows with the actions, on hover or
 * focus (`REVEAL_IN_REPLY_ROW`); its label stays in the page for screen readers either way.
 */
export function TurnMetaLine({ itemKey, className = '' }: { itemKey: string; className?: string }) {
  const value = useContext(TurnMetaContext);
  const turn = value?.byReply.get(itemKey);
  if (!value || !turn) return null;
  const line = describeTurn(turn, value.mode, value.width);
  if (!line) return null;
  // The label says it all for screen readers; only the tokens stay reachable, for their details.
  const parts: Array<{ key: string; node: ReactNode }> = [
    {
      key: 'time',
      node: (
        <span aria-hidden data-tooltip={line.tooltip} data-turn-time>
          {line.time}
        </span>
      ),
    },
  ];
  if (line.duration) {
    parts.push({
      key: 'duration',
      node: (
        <span aria-hidden className={line.duration.failed ? 'text-error' : undefined} data-turn-duration>
          {line.duration.text}
          {line.duration.waiting && <span className="text-muted"> ({line.duration.waiting})</span>}
        </span>
      ),
    });
  }
  if (line.tokens && turn.tokens) parts.push({ key: 'tokens', node: <TokensPart text={line.tokens} tokens={turn.tokens} /> });
  return (
    <span className={`flex min-w-0 shrink-0 items-center gap-1.5 overflow-hidden text-meta whitespace-nowrap text-faint tabular-nums ${className}`} data-turn-meta={turn.outcome}>
      <span className="sr-only">{line.label}</span>
      {parts.map((part, i) => (
        <Fragment key={part.key}>
          {i > 0 && <Sep />}
          {part.node}
        </Fragment>
      ))}
    </span>
  );
}

/** The tokens, underlined with dots: hover or focus shows what they were made of, Esc closes it. */
function TokensPart({ text, tokens }: { text: string; tokens: TurnTokens }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipId = useId();
  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  // A short grace period, so the pointer can move onto the tooltip.
  const hide = (delay = 120) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    // Esc closes it from anywhere, without moving the pointer.
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    // Only a scroll around the tokens moves them: another pane following Claude's output doesn't.
    const onScroll = (event: Event) => {
      const scroller = event.target;
      if (scroller === document || (scroller instanceof Node && ref.current && scroller.contains(ref.current))) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="Token details"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onPointerEnter={() => show(SHOW_DELAY)}
        onPointerLeave={() => hide()}
        onFocus={() => show(0)}
        onBlur={() => hide(0)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return;
          // This Escape was the tooltip's: it doesn't stop Claude or close anything else.
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
        className="cursor-default rounded-sm underline decoration-faint/70 decoration-dotted underline-offset-[3px] outline-none hover:text-muted focus-visible:text-muted focus-visible:ring-2 focus-visible:ring-focus-ring"
        data-turn-tokens
      >
        {text}
      </button>
      {open && <TokensTooltip id={tipId} anchor={ref} tokens={tokens} onEnter={() => clearTimeout(timer.current)} onLeave={() => hide()} />}
    </>
  );
}

function TokensTooltip({ id, anchor, tokens, onEnter, onLeave }: { id: string; anchor: RefObject<HTMLElement | null>; tokens: TurnTokens; onEnter(): void; onLeave(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const target = anchor.current;
    if (!el || !target) return;
    // Above: the line sits at the end of a turn, often just over the message box.
    setPosition(placeTooltip(target.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, 'above'));
  }, [anchor]);
  const shown = TOKEN_TYPES.filter((type) => tokens[type] > 0);
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      className="overlay fixed z-[100] grid w-[248px] gap-2 rounded-lg border px-3 py-2.5 text-meta text-text tabular-nums"
      data-turn-tokens-tooltip
    >
      <p className="font-medium">{tokensHeading(tokens)}</p>
      {/* Stacked like the Usage view's bars, in its order and colours, with a gap in the card's colour between parts. */}
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {shown.map((type) => (
          <span key={type} className="h-full min-w-0.5" style={{ flexGrow: tokens[type], background: TOKEN_COLOR[type] }} />
        ))}
      </div>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
        {TOKEN_TYPES.map((type) => (
          <Fragment key={type}>
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: TOKEN_COLOR[type] }} />
            <dt className="text-muted">{TOKEN_LABEL[type]}</dt>
            <dd className="text-right" data-tooltip-row={type}>
              {tokens[type].toLocaleString()}
            </dd>
          </Fragment>
        ))}
      </dl>
      {tokens.model && <p className="border-t border-border pt-1.5 text-muted">{modelTitle(tokens.model)}</p>}
    </div>,
    document.body,
  );
}

/** What the working line needs to count: the open turn, and whether (and since when) a prompt waits on you. */
export interface LiveTurnInfo {
  turn: Turn | null;
  /** When the prompt that waits on you now asked; null while Claude works. */
  waitingSince: number | null;
  mode: TurnDetails;
}

/**
 * The live part of the working line: "· 0m 37s · 3.2k tokens", ticking on the window's one clock; "· 1m 10s · paused"
 * while a prompt waits on you, since that time isn't Claude's. Nothing with Nothing or Time. Not a live region: only
 * the end of the turn is announced.
 */
export function LiveTurnParts({ live, startedAt }: { live: LiveTurnInfo; startedAt: number | null }) {
  const parts = liveParts(live.mode);
  const waiting = live.waitingSince !== null;
  const now = useSecondClock(parts.duration && !waiting);
  const turn = live.turn ?? { startedAt, waitingMs: undefined };
  if (!parts.duration || turn.startedAt === null) return null;
  const { workedMs } = liveTurn(turn, now || Date.now(), live.waitingSince);
  const tokens = parts.tokens && live.turn?.tokens ? formatTurnTokens(live.turn.tokens.total) : null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-faint tabular-nums" aria-hidden data-turn-live={waiting ? 'paused' : 'running'}>
      <Sep />
      <span>{formatLiveDuration(workedMs ?? 0)}</span>
      {waiting ? (
        <>
          <Sep />
          <span>paused</span>
        </>
      ) : (
        tokens && (
          <>
            <Sep />
            <span>{tokens} tokens</span>
          </>
        )
      )}
    </span>
  );
}
