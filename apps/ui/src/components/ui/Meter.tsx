import type { HTMLAttributes, ReactNode } from 'react';
import { levelOf, LEVEL_COLOR, LEVEL_FILL, type Level } from '../../lib/levels.ts';
import { barWidth, clampPercent, formatPercent, ringDegrees, valueTone } from './meter.ts';

interface MeterProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  percent: number;
  /** `bar` for usage, `ring` where space is tight (the context window). */
  kind?: 'bar' | 'ring';
  /** `sm`: a 48x4 bar or a 12px ring, inline. `md`: a full-width 6px bar under its caption (a 16px ring for `kind="ring"`). */
  size?: 'sm' | 'md';
  /** What it measures, read as one sentence ("5-hour limit: 6% used"). Without it the meter is decoration, for a control that names itself. */
  label?: string;
  /** Show the percentage after the graphic (`md`: at the end of the caption line). */
  showValue?: boolean;
  /**
   * Drop the graphic when there is no room for it and keep the number: `true` when the row of meters
   * it sits in (an `@container/meters`, such as a session's footer) is under 240px, `'tight'` below
   * 480px of the nearest container (a small one of its own, such as New session's footer).
   */
  hideTrackNarrow?: boolean | 'tight';
  /** The level to colour it in, when its thresholds aren't the usual 60% and 85% (MEMORY.md: caution from 180 of 200 lines). */
  level?: Level;
  /** A caption before the graphic (`md`: the line above the bar). */
  children?: ReactNode;
  'data-tooltip'?: string;
}

/**
 * How full something is (plan usage, the context window), in the level's colour: green, orange from
 * 60%, red from 85% (`lib/levels.ts`). The track is `bg-selected`, which shows on every surface.
 */
export function Meter({ percent, kind = 'bar', size = 'sm', label, showValue = false, hideTrackNarrow = false, level: forced, className = '', children, ...rest }: MeterProps) {
  const level = forced ?? levelOf(percent);
  const a11y = label
    ? { role: 'meter', 'aria-label': label, 'aria-valuenow': Math.round(clampPercent(percent)), 'aria-valuemin': 0, 'aria-valuemax': 100 }
    : { 'aria-hidden': true };
  const narrow = hideTrackNarrow === 'tight' ? '@max-[480px]:hidden' : hideTrackNarrow ? '@max-[240px]/meters:hidden' : '';
  const value = showValue && <span className={`tabular-nums ${size === 'md' ? 'font-semibold' : ''} ${valueTone(percent)}`}>{formatPercent(percent)}</span>;

  if (kind === 'ring') {
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`} {...a11y} {...rest}>
        {children}
        {/* Filled clockwise as a conic gradient, with a hole cut by the mask. */}
        <span
          className={`shrink-0 rounded-full ${size === 'md' ? 'size-4' : 'size-3'} ${narrow}`}
          style={{ background: `conic-gradient(${LEVEL_COLOR[level]} ${ringDegrees(percent)}deg, var(--sb-selected) 0deg)`, mask: 'radial-gradient(farthest-side, transparent 58%, #000 60%)' }}
          aria-hidden
        />
        {value}
      </span>
    );
  }

  const bar = (
    <span className={`block shrink-0 overflow-hidden rounded-full bg-selected ${size === 'md' ? 'h-1.5 w-full' : 'h-1 w-12'} ${narrow}`} aria-hidden>
      <span className={`block h-full rounded-full ${LEVEL_FILL[level]}`} style={{ width: barWidth(percent) }} />
    </span>
  );
  if (size === 'md') {
    return (
      <div className={`grid gap-1 ${className}`} {...a11y} {...rest}>
        {(children || value) && (
          <div className="flex items-baseline gap-2 text-meta">
            {children}
            {value}
          </div>
        )}
        {bar}
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`} {...a11y} {...rest}>
      {children}
      {bar}
      {value}
    </span>
  );
}
