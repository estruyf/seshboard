import { Minus, Plus } from 'lucide-react';
import { useEffect, useState, type Ref } from 'react';
import { Button } from './Button.tsx';

interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  /** Accessible name of the group and the field ("Days before archiving"). */
  label: string;
  /** What − and + say to screen readers ("Fewer days", "More days"). */
  less: string;
  more: string;
  disabled?: boolean;
  /** `data-*` hooks: on the group, and `-less`, `-more`, `-value` versions on its parts. */
  hook?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A whole number with − and + on either side (Settings: the focus limit, archive days). The number can be typed too:
 * it is applied on Enter or when the field loses focus, kept within `min` and `max`; Escape puts the old one back.
 */
export function Stepper({ value, min, max, onChange, label, less, more, disabled, hook, ref }: StepperProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next))));
  const commit = () => {
    const typed = Number.parseInt(text, 10);
    if (Number.isFinite(typed) && typed !== value) set(typed);
    else setText(String(value));
  };
  const data = (part: string) => (hook ? { [`data-${hook}${part}`]: true } : {});
  return (
    <div role="group" aria-label={label} className={`flex shrink-0 items-center rounded-md border border-edge ${disabled ? 'opacity-50' : ''}`} {...data('')}>
      <Button variant="quiet" iconOnly icon={<Minus size={13} aria-hidden />} aria-label={less} disabled={disabled || value <= min} onClick={() => set(value - 1)} className="rounded-r-none!" {...data('-less')} />
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            set(value + (e.key === 'ArrowUp' ? 1 : -1));
          } else if (e.key === 'Escape' && text !== String(value)) {
            // Only a typed number takes Escape; otherwise it closes what the field is in.
            e.preventDefault();
            setText(String(value));
          }
        }}
        className="h-7 w-12 border-x border-edge bg-transparent text-center text-ui font-semibold tabular-nums text-text outline-none disabled:cursor-not-allowed"
        {...data('-value')}
      />
      <Button variant="quiet" iconOnly icon={<Plus size={13} aria-hidden />} aria-label={more} disabled={disabled || value >= max} onClick={() => set(value + 1)} className="rounded-l-none!" {...data('-more')} />
    </div>
  );
}
