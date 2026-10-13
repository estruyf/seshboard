import { useEffect, useState, type CSSProperties } from 'react';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Called once the value is let go (the pointer is released, a key is let up, or focus leaves), not on every step of a drag. */
  onChange(value: number): void;
  /** Accessible name ("Volume"). */
  label: string;
  /** What screen readers say for a value ("50%"); also shown after the slider. */
  format?: (value: number) => string;
  disabled?: boolean;
  dataAttrs?: Record<`data-${string}`, string | boolean | undefined>;
}

/**
 * A themed range slider (the sound volume). It follows the pointer or the arrow keys at once, and reports the
 * value when it settles, so a drag saves once instead of on every step.
 */
export function Slider({ value, min, max, step = 1, onChange, label, format = String, disabled, dataAttrs }: SliderProps) {
  const [current, setCurrent] = useState(value);
  useEffect(() => setCurrent(value), [value]);
  const commit = () => {
    if (current !== value) onChange(current);
  };
  const fill = max > min ? ((current - min) / (max - min)) * 100 : 0;
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={format(current)}
        onChange={(event) => setCurrent(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="slider w-36"
        style={{ '--fill': `${fill}%` } as CSSProperties}
        {...dataAttrs}
      />
      <output aria-hidden className="w-9 text-right text-meta tabular-nums text-muted">
        {format(current)}
      </output>
    </span>
  );
}
