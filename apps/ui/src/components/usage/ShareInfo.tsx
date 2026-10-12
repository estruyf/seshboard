import { useRef, useState, type ReactNode } from 'react';
import { Popover } from '../ui/Popover.tsx';

/**
 * A button (the Share (est.) column header, or a "How it's counted" link) that opens how shares are counted: the
 * weights against input, and when a measured change in plan % is used instead. Never a share of a limit, never money.
 */
export function ShareInfo({ children, className = '', ...rest }: { children: ReactNode; className?: string; [data: `data-${string}`]: unknown }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!at}
        className={className}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: box.right - 340, y: box.bottom + 6 });
        }}
        {...rest}
      >
        {children}
      </button>
      {at && (
        <Popover x={at.x} y={at.y} width={340} onClose={() => setAt(null)} anchor={anchor} role="dialog" aria-label="How shares are counted" className="px-4 py-3" data-usage-share-info>
          <h3 className="text-ui font-semibold text-text">How shares are counted</h3>
          <p className="mt-2 text-ui text-muted normal-case tracking-normal">Tokens weigh differently against your plan. Compared to input, a cache write counts 1.25×, a cache read 0.1× and output 5×.</p>
          <p className="mt-2 text-ui text-muted normal-case tracking-normal">
            When only one session ran, the share uses the measured change in plan %. Otherwise it's an estimate. No prices, no dollars.
          </p>
        </Popover>
      )}
    </>
  );
}
