import { useMemo, type CSSProperties } from 'react';
import { FREE_JACK_CELLS, jackCell, jackDelayMs, WORKING_ROUND_MS } from '@seshboard/protocol/working-panel';

/** `working`: the light moves. `still`: every free jack softly lit (Compacting). `waiting`: every free jack lit in `warn`. */
export type WorkingState = 'working' | 'still' | 'waiting';

/**
 * The plugged jacks (cells of the 3×3 grid), each in its `--sb-working-plug-*` token: the cable colours of the app icon
 * the theme goes with. a and b are one cable's ends, c and d the other's.
 */
const PLUGS: readonly (readonly [cell: number, plug: string])[] = [
  [0, 'plug-a'],
  [5, 'plug-b'],
  [6, 'plug-c'],
  [7, 'plug-d'],
];

/**
 * The drawing, in units: three jacks of `PITCH` square, 16px at the default size (1px is 1.875 units). Every jack is a
 * 3px dot, plugged or free; the glow is a ring 2px wide around a lit one, which narrows as it fades (styles.css).
 */
const PITCH = 10;
const JACK = 2.8;
const GLOW = 6.55;

const centre = (cell: number) => {
  const { row, col } = jackCell(cell);
  return { cx: PITCH / 2 + col * PITCH, cy: PITCH / 2 + row * PITCH };
};

const pageClock = () => (typeof performance === 'undefined' ? 0 : performance.now());

/**
 * Claude is working: the app icon's patch panel, its free jacks lighting up in turn like the Dock's (the order and the
 * round's time are shared with it, `@seshboard/protocol/working-panel`). Pure CSS keyframes (`.working-panel` in
 * styles.css), each jack set to its place in the round on the page's clock, so every instance shows the same frame and
 * no timer runs. With Reduce motion every state shows its still frame. Decorative: the label next to it says what is
 * happening. The phone has a copy (`apps/remote/src/components/WorkingPanel.tsx`).
 */
export function WorkingPanel({ size = 16, state = 'working', className = '' }: { size?: number; state?: WorkingState; className?: string }) {
  // When the light started moving here: the delays count from it, so a panel mounted later is still in step.
  const startedAt = useMemo(() => (state === 'working' ? pageClock() : 0), [state]);
  return (
    <svg
      viewBox={`0 0 ${PITCH * 3} ${PITCH * 3}`}
      width={size}
      height={size}
      className={`working-panel shrink-0 ${className}`}
      aria-hidden
      data-working-panel=""
      data-working-state={state}
      style={state === 'working' ? ({ '--working-round': `${WORKING_ROUND_MS}ms` } as CSSProperties) : undefined}
    >
      {PLUGS.map(([cell, plug]) => (
        <circle key={cell} {...centre(cell)} r={JACK} className={`jack-${plug}`} data-jack="plugged" />
      ))}
      {FREE_JACK_CELLS.map((cell, i) => {
        const at = centre(cell);
        return (
          <g key={cell} data-jack="free">
            <circle {...at} r={JACK} className="jack-hole" />
            <g className="jack-light" style={state === 'working' ? ({ '--jack-delay': `${jackDelayMs(i, startedAt)}ms` } as CSSProperties) : undefined}>
              <circle {...at} r={GLOW} className="jack-glow" />
              <circle {...at} r={JACK} className="jack-lit" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
