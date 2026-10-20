import { ImageIcon } from 'lucide-react';
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Kbd } from '../ui/Kbd.tsx';
import { SHOW_DELAY, WARM_WINDOW } from '../ui/Tooltip.tsx';
import { useHeight } from '../ui/useHeight.ts';
import { layoutMarks, markLabel, nearestMark, promptTime, type OutlinePrompt } from './promptOutline.ts';

/** Each mark's hit area: the rail's full width, and this tall. */
const HIT = 8;
/** On a rail with room to spare, the pointer finds a mark this many pixels away, not further. */
const REACH = 12;
const TOOLTIP_WIDTH = 300;

export interface PromptOutlineProps {
  prompts: readonly OutlinePrompt[];
  /** Where each prompt's row starts in the transcript (in the order of `prompts`) and its full height: the virtualizer's measurements. */
  starts: readonly number[];
  total: number;
  /** The prompt at the top of the view (an index into `prompts`). */
  current: number;
  /** Room to leave on the right for the scrollbar, in pixels. */
  right: number;
  onJump(index: number): void;
}

/**
 * The prompt outline: a thin rail beside the conversation with a mark for each of your prompts. The current one is
 * highlighted; hover shows the start of a prompt, a click scrolls to it. One Tab stop: ↑ and ↓ move between the marks,
 * ↩ or Space jumps, Home and End go to the first and the last.
 */
export const PromptOutline = memo(function PromptOutline({ prompts, starts, total, current, right, onJump }: PromptOutlineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const height = useHeight(trackRef) ?? 0;
  const layout = useMemo(() => {
    const byRow = new Map(prompts.map((prompt, i) => [prompt.index, starts[i] ?? 0]));
    return layoutMarks(prompts, { start: (row) => byRow.get(row) ?? 0, total }, height);
  }, [prompts, starts, total, height]);
  const { marks, dense } = layout;
  const count = marks.length;

  // The mark under the pointer (the nearest one), and the one keyboard focus is on.
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const pointAt = (event: PointerEvent) => {
    const track = trackRef.current;
    if (!track || height <= 0) return;
    const y = event.clientY - track.getBoundingClientRect().top;
    const index = nearestMark(marks, y / height);
    // A dense rail always has a mark near; a sparse one only answers close to a mark.
    setHovered(index >= 0 && (dense || Math.abs(marks[index]!.top * height - y) <= REACH) ? index : null);
  };

  const focusMark = (index: number) => {
    const clamped = Math.max(0, Math.min(count - 1, index));
    buttons.current[clamped]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
    if (to === null) return;
    event.preventDefault();
    focusMark(to);
  };

  // The tooltip: after the usual delay, at once when moving from one mark to the next.
  const target = hovered ?? (keyboardFocus ? focused : null);
  const [shown, setShown] = useState<number | null>(null);
  const hiddenAt = useRef(0);
  useEffect(() => {
    if (target === null) {
      setShown((was) => {
        if (was !== null) hiddenAt.current = Date.now();
        return null;
      });
      return;
    }
    if (shown !== null || Date.now() - hiddenAt.current < WARM_WINDOW) {
      setShown(target);
      return;
    }
    const timer = setTimeout(() => setShown(target), SHOW_DELAY);
    return () => clearTimeout(timer);
  }, [target]);
  // A prompt list that got shorter (another session in the pane) can't show a mark that's gone.
  const tip = shown !== null && shown < count ? marks[shown]! : null;

  const tipRef = useRef<HTMLDivElement>(null);
  const [tipHeight, setTipHeight] = useState(0);
  useLayoutEffect(() => setTipHeight(tipRef.current?.offsetHeight ?? 0), [tip?.key]);
  const tipId = useId();

  // One Tab stop: the focused mark, else the current one.
  const tabStop = focused !== null && focused < count ? focused : Math.max(0, Math.min(count - 1, current));

  return (
    <nav aria-label="Your prompts" className="absolute top-2 bottom-2 z-20 w-[22px]" style={{ right }} data-prompt-outline data-prompt-count={count} data-dense={dense || undefined}>
      <div
        ref={trackRef}
        className={`relative h-full ${hovered !== null ? 'cursor-pointer' : ''}`}
        onPointerMove={pointAt}
        onPointerLeave={() => setHovered(null)}
        // Between marks, a click goes to the nearest one, as hover shows it.
        onClick={(event) => hovered !== null && !(event.target as Element).closest('[data-prompt-mark]') && onJump(hovered)}
      >
        {marks.map((mark, index) => {
          const isCurrent = index === current;
          const isHovered = index === hovered;
          const size = isCurrent ? 'h-[3px] w-4 bg-accent-ink' : isHovered ? 'h-0.5 w-3.5 bg-text' : `h-0.5 bg-faint ${dense ? 'w-[7px]' : 'w-2.5'}`;
          return (
            <button
              key={mark.key}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              tabIndex={index === tabStop ? 0 : -1}
              aria-label={markLabel(index, count, mark.text, mark.images)}
              aria-current={isCurrent ? 'true' : undefined}
              aria-describedby={shown === index ? tipId : undefined}
              className="group absolute right-0 flex w-[22px] items-center justify-end"
              style={{ top: mark.top * height - HIT / 2, height: HIT }}
              // A key press (detail 0) jumps to the focused mark; a click to the one hover shows, the nearest.
              onClick={(event) => onJump(event.detail === 0 ? index : (hovered ?? index))}
              onKeyDown={(event) => onKeyDown(event, index)}
              onFocus={(event) => {
                setFocused(index);
                // Only keyboard focus shows the tooltip (and the ring); a click focusing the mark doesn't.
                setKeyboardFocus(event.currentTarget.matches(':focus-visible'));
              }}
              onBlur={() => {
                setFocused(null);
                setKeyboardFocus(false);
              }}
              data-prompt-mark={index}
              data-prompt-row={mark.index}
              data-current={isCurrent || undefined}
            >
              <span
                aria-hidden
                className={`block rounded-full outline-link group-focus-visible:outline-2 group-focus-visible:outline-offset-2 motion-safe:transition-[width,height,background-color] motion-safe:duration-150 ${size}`}
              />
            </button>
          );
        })}
      </div>
      {tip && (
        <div
          ref={tipRef}
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute grid gap-1 rounded-lg border overlay px-3 py-2.5 text-left"
          style={{
            width: TOOLTIP_WIDTH,
            right: 30,
            // Beside its mark, kept inside the rail's height.
            top: Math.max(-8, Math.min(tip.top * height - tipHeight / 2, height + 8 - tipHeight)),
            visibility: tipHeight ? 'visible' : 'hidden',
          }}
          data-prompt-tooltip
        >
          <span className="text-meta text-muted tabular-nums">{[`Prompt ${(shown ?? 0) + 1} of ${count}`, promptTime(tip.at)].filter(Boolean).join(' · ')}</span>
          {tip.text && <span className="line-clamp-3 text-ui leading-snug text-text wrap-anywhere">{tip.text.replace(/\s+/g, ' ').trim()}</span>}
          {tip.hasImage && (
            <span className="flex items-center gap-1.5 text-meta text-muted">
              <ImageIcon size={12} aria-hidden />
              {tip.images === 1 ? '1 image' : `${tip.images} images`}
            </span>
          )}
          <span className="mt-1 flex items-center gap-1.5 border-t border-edge pt-2 text-meta text-muted">
            <Kbd shortcut="transcript.prompt-previous" />
            <Kbd shortcut="transcript.prompt-next" />
            <span>previous and next prompt</span>
          </span>
        </div>
      )}
    </nav>
  );
});
