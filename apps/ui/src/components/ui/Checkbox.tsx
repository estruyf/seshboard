import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

interface CheckboxProps {
  /** `mixed`: some of what it stands for is checked (a group's box); a click checks all. */
  checked: boolean | 'mixed';
  onChange(checked: boolean): void;
  disabled?: boolean;
  /** Visible label; the whole row is clickable. Without one, pass `label` for the accessible name. */
  children?: ReactNode;
  /** Accessible name (and tooltip) when there are no children. */
  label?: string;
  tooltip?: string;
  className?: string;
  dataAttrs?: Record<`data-${string}`, string | boolean | undefined>;
}

/** The themed check box, shared by `Checkbox` and the multi-select rows in the permission card. */
export function CheckMark({ checked, className = '' }: { checked: boolean | 'mixed'; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${checked ? 'border-accent-ink bg-accent text-on-accent' : 'border-faint bg-card'} ${className}`}
    >
      {checked === 'mixed' ? <Minus size={10} strokeWidth={3} /> : checked && <Check size={10} strokeWidth={3} />}
    </span>
  );
}

/** A themed checkbox (`role="checkbox"`); Space toggles it, like a native one. */
export function Checkbox({ checked, onChange, disabled, children, label, tooltip, className = '', dataAttrs }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={children ? undefined : label}
      data-tooltip={tooltip ?? (children ? undefined : label)}
      disabled={disabled}
      onClick={() => onChange(checked !== true)}
      className={`group inline-flex items-start gap-2 text-left disabled:opacity-50 ${className}`}
      {...dataAttrs}
    >
      <CheckMark checked={checked} className={children ? 'mt-px' : ''} />
      {children && <span className="min-w-0">{children}</span>}
    </button>
  );
}
