import { useMemo, type CSSProperties } from 'react';
import { FREE_JACK_CELLS, jackCell, jackDelayMs, WORKING_ROUND_MS } from '@seshboard/protocol/working-panel';
import { useWindowActive } from '../../lib/windowActivity.ts';

/** `working`: the light moves. `compacting`: every free jack lit, pulsing together. `waiting`: every free jack lit in `warn`. */
export type WorkingState = 'working' | 'compacting' | 'waiting';

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
const SPAN = PITCH * 3;
const JACK = 2.8;
const GLOW = 6.55;
const percent = (units: number) => `${(units / SPAN) * 100}%`;
/** The lit dot's inset in the light's square: the dot is JACK / GLOW of it, centred. */
const LIT_INSET = `${((1 - JACK / GLOW) / 2) * 100}%`;

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
 * happening. The panel and its plugs are a still SVG; the lights over the free jacks are HTML elements that animate only
 * `opacity` and `transform`, which Chromium runs on the compositor (animations of SVG children it paints on the main
 * thread, a frame at a time, 120 times a second on a ProMotion screen). The phone has a copy
 * (`apps/remote/src/components/WorkingPanel.tsx`).
 */
export function WorkingPanel({ size = 16, state = 'working', className = '' }: { size?: number; state?: WorkingState; className?: string }) {
  // When the light started moving here: the delays count from it, so a panel mounted later is still in step. A window in
  // the background pauses every panel's animations (styles.css), each on its own clock, so when the window comes back
  // the lights start over, together.
  const active = useWindowActive();
  const startedAt = useMemo(() => (state === 'working' ? pageClock() : 0), [state, active]);
  return (
    <span
      className={`working-panel relative block shrink-0 ${className}`}
      style={{ width: size, height: size, ...(state === 'working' ? ({ '--working-round': `${WORKING_ROUND_MS}ms` } as CSSProperties) : {}) }}
      aria-hidden
      data-working-panel=""
      data-working-state={state}
    >
      <svg viewBox={`0 0 ${SPAN} ${SPAN}`} width="100%" height="100%" className="absolute inset-0">
        {PLUGS.map(([cell, plug]) => (
          <circle key={cell} {...centre(cell)} r={JACK} className={`jack-${plug}`} data-jack="plugged" />
        ))}
        {FREE_JACK_CELLS.map((cell) => (
          <circle key={cell} {...centre(cell)} r={JACK} className="jack-hole" />
        ))}
      </svg>
      {FREE_JACK_CELLS.map((cell, i) => {
        const { cx, cy } = centre(cell);
        // The light fills the glow's square, centred on its jack: the glow is the whole of it, the lit dot a share in the middle.
        const style = { left: percent(cx - GLOW), top: percent(cy - GLOW), width: percent(GLOW * 2), height: percent(GLOW * 2), ...(state === 'working' ? { '--jack-delay': `${jackDelayMs(i, startedAt)}ms` } : {}) } as CSSProperties;
        return (
          <span key={`${cell}-${startedAt}`} className="jack-light" style={style} data-jack="free">
            <span className="jack-glow" />
            <span className="jack-lit" style={{ inset: LIT_INSET }} />
          </span>
        );
      })}
    </span>
  );
}
